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
begin
  if length(stem) = 0 then
    stem := 'CLUB';
  end if;
  loop
    candidate := stem || lpad(floor(random() * 1000)::int::text, 3, '0');
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

-- Fills a missing code on insert and normalizes any code written, so fixture
-- inserts, create_club and a host's direct update all land in one shape.
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
-- Body otherwise identical to 20260822040732_close_club_members_escalation.sql.
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

  insert into public.clubs (name, slug, rhythm, created_by, code)
  values (
    trim(club_name),
    base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    trim(coalesce(club_rhythm, '')),
    caller,
    nullif(regexp_replace(coalesce(club_code, ''), '\s', '', 'g'), '')
  )
  returning id into new_id;

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

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  insert into public.club_members (club_id, profile_id, role)
  values (target, caller, 'member');

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

  update public.clubs set code = normalized where id = target_club;
  return normalized;
end;
$$;
revoke execute on function public.set_club_code(uuid, text) from public, anon;
grant execute on function public.set_club_code(uuid, text) to authenticated;
