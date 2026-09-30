/*
 * Club codes (club-hub redesign, phase 1).
 *
 * A short, human-chosen code a member types on Home to join a club instantly.
 * Hosts and co-organizers may change it; changing it is how a leaked code is
 * retired. Uniqueness is the database's job (unique index); the format check
 * is a constraint so no write path can bypass it.
 *
 * Removed members cannot rejoin by code: removal is a host decision, and an
 * instant-join code must not undo it. Invite acceptance still reactivates.
 */

-- Generator. security definer so the uniqueness probe sees every club, not
-- just the caller's (RLS would otherwise hide collisions).
--
-- The 3-digit suffix only has 1000 values per stem; a popular stem (or a
-- pathological test) could in principle exhaust them, looping forever. Cap
-- that loop at 50 tries, then fall back to a 6-digit suffix (stem is capped
-- at 8 chars, so 8 + 6 = 14, still within the 16-char format limit) and loop
-- there instead.
create function public.suggest_club_code(club_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  stem text := left(regexp_replace(upper(coalesce(club_name, '')), '[^A-Z0-9]', '', 'g'), 8);
  candidate text;
  tries int := 0;
begin
  if length(stem) = 0 then
    stem := 'CLUB';
  end if;
  loop
    tries := tries + 1;
    exit when tries > 50;
    candidate := stem || lpad(floor(random() * 1000)::int::text, 3, '0');
    if not exists (select 1 from public.clubs where code = candidate) then
      return candidate;
    end if;
  end loop;
  loop
    candidate := stem || lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.clubs where code = candidate);
  end loop;
  return candidate;
end;
$$;
revoke execute on function public.suggest_club_code(text) from public, anon, authenticated;

alter table public.clubs add column code text;

do $$
declare
  r record;
begin
  for r in select id, name from public.clubs where code is null loop
    update public.clubs set code = public.suggest_club_code(r.name) where id = r.id;
  end loop;
end;
$$;

alter table public.clubs
  alter column code set not null,
  add constraint clubs_code_format check (code ~ '^[A-Z0-9]{4,16}$');
create unique index clubs_code_key on public.clubs (code);

-- Fills a missing code on insert and normalizes any code written by
-- create_club or set_club_code, so fixture inserts and both RPCs land in one
-- shape. A host's direct UPDATE of code is a separate, blocked path: see
-- clubs_freeze_identity below.
create function public.clubs_fill_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    if tg_op = 'INSERT' then
      new.code := public.suggest_club_code(new.name);
    end if;
  else
    new.code := upper(regexp_replace(new.code, '\s', '', 'g'));
  end if;
  return new;
end;
$$;
revoke execute on function public.clubs_fill_code() from public, anon, authenticated;

create trigger clubs_fill_code
  before insert or update of code on public.clubs
  for each row execute function public.clubs_fill_code();

/*
 * `code` needs the same freeze as `slug`/`created_by`/`id`: `clubs_update_host`
 * gives every host table-wide UPDATE on their own club, and without this a
 * host's direct PostgREST UPDATE of `code` would bypass set_club_code's rate
 * limit entirely — an unlimited "is this code taken?" oracle via 23505.
 * `create or replace` extends the existing function from
 * 20260822180300_invite_attribution_and_club_identity.sql verbatim, adding
 * one more frozen column; the `current_user` exemption already there is what
 * lets create_club/set_club_code (both security definer, running as the
 * function owner) keep writing it.
 */
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

  return new;
end;
$$;

-- Attempt log for the join rate limit. No policies: only the definer
-- functions below read or write it.
create table public.club_code_attempts (
  id           bigserial primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index club_code_attempts_recent on public.club_code_attempts (profile_id, attempted_at);
alter table public.club_code_attempts enable row level security;
revoke all on public.club_code_attempts from public, anon, authenticated;

-- Shared by join_club_by_code and set_club_code: raises rate_limited once the
-- caller has 10 attempts in the past hour, otherwise records this one.
create function public.record_club_code_attempt(caller uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.club_code_attempts
       where profile_id = caller and attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.club_code_attempts (profile_id) values (caller);
end;
$$;
revoke execute on function public.record_club_code_attempt(uuid) from public, anon, authenticated;

-- create_club gains an optional code. Signature change: drop and recreate,
-- then restate the grants (a new signature starts with EXECUTE to PUBLIC).
-- Body otherwise identical to 20260822040732_close_club_members_escalation.sql,
-- except for the code path below.
--
-- A chosen code is a guess at "is this code taken?", so it spends one of the
-- caller's club-code attempts, the same budget join_club_by_code and
-- set_club_code draw on. A taken code returns null instead of raising 23505:
-- raising would roll back the whole statement, attempt row included, making
-- create_club a free, unlimited oracle. The insert runs in its own
-- subtransaction, so catching unique_violation rolls back only the club row;
-- the attempt recorded before it survives. A blank/null code is generated by
-- the database and records no attempt.
drop function public.create_club(text, text);

create function public.create_club(
  club_name text,
  club_rhythm text default '',
  club_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  new_id uuid;
  base_slug text;
  chosen_code text := nullif(regexp_replace(coalesce(club_code, ''), '\s', '', 'g'), '');
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if length(trim(club_name)) = 0 then
    raise exception 'club name is required' using errcode = '22023';
  end if;

  base_slug := regexp_replace(lower(trim(club_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  if length(base_slug) = 0 then
    raise exception 'club name needs a letter or number'
      using errcode = '22023';
  end if;

  if chosen_code is not null then
    -- Same as join_club_by_code: club_code_attempts.profile_id references
    -- profiles(id), which a brand-new caller may not have yet.
    insert into public.profiles (id, display_name)
    values (caller, '')
    on conflict (id) do nothing;

    perform public.record_club_code_attempt(caller);
  end if;

  begin
    insert into public.clubs (name, slug, rhythm, created_by, code)
    values (
      trim(club_name),
      base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
      trim(coalesce(club_rhythm, '')),
      caller,
      chosen_code
    )
    returning id into new_id;
  exception when unique_violation then
    -- With a chosen code this is the code being taken (the slug carries a
    -- random suffix). Only the club insert is undone; the attempt row stays.
    -- Without one, re-raise: the generated-code path is unchanged.
    if chosen_code is null then
      raise;
    end if;
    return null;
  end;

  insert into public.club_members (club_id, profile_id, role)
  values (new_id, caller, 'host');

  return new_id;
end;
$$;
revoke execute on function public.create_club(text, text, text) from public, anon;
grant execute on function public.create_club(text, text, text) to authenticated;

create function public.join_club_by_code(club_code text)
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

  select id into target from public.clubs where code = normalized;
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

create function public.set_club_code(target_club uuid, new_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(new_code, ''), '\s', '', 'g'));
begin
  if caller is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if normalized !~ '^[A-Z0-9]{4,16}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  perform public.record_club_code_attempt(caller);

  -- A taken code returns null instead of raising: raising would roll back
  -- this statement, including the attempt row record_club_code_attempt just
  -- inserted, making "is this code taken?" a free, unlimited oracle. Null
  -- keeps the probe inside the same 10/hour budget as every other attempt.
  if exists (select 1 from public.clubs where code = normalized and id <> target_club) then
    return null;
  end if;

  update public.clubs set code = normalized where id = target_club;
  return normalized;
end;
$$;
revoke execute on function public.set_club_code(uuid, text) from public, anon;
grant execute on function public.set_club_code(uuid, text) to authenticated;
