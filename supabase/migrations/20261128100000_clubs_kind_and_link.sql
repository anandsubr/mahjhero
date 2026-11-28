/*
 * Mahj Nights (pivot batch 2): a hidden group per event, and a link per group.
 *
 * A Mahj Night is a one-off party. Creating one makes a group behind the
 * scenes (kind = 'event') holding a single game, so seats, tables, messages
 * and every existing RLS rule keep working unchanged. Event groups never show
 * in anyone's group lists; Batch 3's "Keep playing?" turns one into a normal
 * group by flipping kind.
 *
 * The link token is the group's public address. Batch 2 uses it for the
 * event page (/e/<token>); Batch 3 reuses it for the group join link. Anyone
 * holding it can read the event page's public fields -- nothing more -- and
 * that read goes through a service-role edge function, never through a grant
 * to anon (see 20261128130000_mahj_night_functions.sql).
 *
 * kind, theme_id and the link columns are written only by definer functions;
 * a host's direct UPDATE is refused by clubs_freeze_identity below, the same
 * as code, cover and advanced_enabled.
 */

create type public.club_kind as enum ('group', 'event');

alter table public.clubs
  add column kind public.club_kind not null default 'group',
  -- A key into the app's theme list (lib/themes.ts), not a foreign key:
  -- Batch 2 ships two themes defined in code. The format check keeps it a
  -- plain slug either way.
  add column theme_id text
    constraint clubs_theme_id_format check (theme_id ~ '^[a-z0-9_-]{1,40}$'),
  -- 24 random bytes, base64url without padding (32 characters): the same
  -- shape as calendar_feeds.token. Unguessable, and safe in a URL path.
  add column link_token text not null
    default rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '='),
  add column link_enabled boolean not null default true,
  -- Batch 3 (group join link): auto-join unless the host asks for approval.
  add column link_requires_approval boolean not null default false;

create unique index clubs_link_token_key on public.clubs (link_token);

-- create or replace, extending 20261127100000_clubs_advanced_features.sql's
-- definition verbatim with the kind/theme/link guard at the end.
create or replace function public.clubs_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'club slug cannot be changed' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'club created_by cannot be changed' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'club id cannot be changed' using errcode = '42501';
  end if;

  if new.code is distinct from old.code then
    raise exception 'club code cannot be changed directly' using errcode = '42501';
  end if;

  if new.cover_path is distinct from old.cover_path
     or new.cover_color is distinct from old.cover_color then
    raise exception 'club cover cannot be changed directly' using errcode = '42501';
  end if;

  if new.advanced_enabled is distinct from old.advanced_enabled then
    raise exception 'club advanced setting cannot be changed directly' using errcode = '42501';
  end if;

  if new.kind is distinct from old.kind
     or new.theme_id is distinct from old.theme_id
     or new.link_token is distinct from old.link_token
     or new.link_enabled is distinct from old.link_enabled
     or new.link_requires_approval is distinct from old.link_requires_approval then
    raise exception 'club link settings cannot be changed directly' using errcode = '42501';
  end if;

  return new;
end;
$$;

/*
 * Reset: a new token, so the old link stops working at once. Host or
 * co-host. Returns the new token so the app can show the new link.
 */
create function public.reset_club_link(target_club uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fresh text;
begin
  perform public.assert_club_organizer(target_club);

  update public.clubs
     set link_token = rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=')
   where id = target_club
  returning link_token into fresh;

  return fresh;
end;
$$;

revoke execute on function public.reset_club_link(uuid) from public, anon;
grant execute on function public.reset_club_link(uuid) to authenticated;

/* Off and back on. The token is kept, so turning it back on revives the link. */
create function public.set_club_link_enabled(target_club uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_club_organizer(target_club);

  update public.clubs set link_enabled = coalesce(enabled, false)
  where id = target_club;
end;
$$;

revoke execute on function public.set_club_link_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_club_link_enabled(uuid, boolean) to authenticated;

/*
 * Group codes join normal groups only. A Mahj Night's guest list is its
 * RSVPs: a guessed code must not walk someone into a party (and its address)
 * without one. create or replace of 20260929100000_club_codes.sql's
 * definition verbatim, with `and kind = 'group'` on the lookup.
 */
create or replace function public.join_club_by_code(club_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(club_code, ''), '\s', '', 'g'));
  target     uuid;
  membership public.club_members%rowtype;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Before recording the attempt: club_code_attempts.profile_id references
  -- profiles(id), and a caller who has never joined anything yet may have no
  -- profile row at all.
  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  perform public.record_club_code_attempt(caller);

  select id into target from public.clubs
   where code = normalized and kind = 'group';
  if target is null then
    return null;
  end if;

  select * into membership from public.club_members
   where club_id = target and profile_id = caller;
  if found then
    if membership.status = 'removed' then
      raise exception 'removed_member';
    end if;
    return jsonb_build_object('club_id', target, 'already_member', true);
  end if;

  -- A concurrent second join (double tap) can pass the check above before
  -- the first commits; report it as already_member rather than a raw 23505.
  begin
    insert into public.club_members (club_id, profile_id, role)
    values (target, caller, 'member');
  exception when unique_violation then
    return jsonb_build_object('club_id', target, 'already_member', true);
  end;

  return jsonb_build_object('club_id', target, 'already_member', false);
end;
$$;
revoke execute on function public.join_club_by_code(text) from public, anon;
grant execute on function public.join_club_by_code(text) to authenticated;
