/*
 * Personal calendar subscription tokens (club-hub phase 2). The
 * calendar-feed edge function serves a member's games as .ics to anyone
 * holding the token (calendar apps can't sign in), so the token is the
 * only key: random, unguessable, and replaceable from Profile.
 */
create table public.calendar_feeds (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from public, anon, authenticated;

create function public.new_calendar_feed_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
$$;
revoke execute on function public.new_calendar_feed_token() from public, anon, authenticated;

create function public.my_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select token into result from public.calendar_feeds where profile_id = caller;
  if result is null then
    insert into public.calendar_feeds (profile_id, token)
    values (caller, public.new_calendar_feed_token())
    on conflict (profile_id) do nothing;
    select token into result from public.calendar_feeds where profile_id = caller;
  end if;
  return result;
end;
$$;
revoke execute on function public.my_calendar_feed_token() from public, anon;
grant execute on function public.my_calendar_feed_token() to authenticated;

create function public.reset_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result text := public.new_calendar_feed_token();
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.calendar_feeds (profile_id, token) values (caller, result)
  on conflict (profile_id) do update set token = excluded.token, created_at = now();
  return result;
end;
$$;
revoke execute on function public.reset_calendar_feed_token() from public, anon;
grant execute on function public.reset_calendar_feed_token() to authenticated;
