/*
 * A global admin flag, distinct from the per-club host/co-organizer roles
 * lib/clubs.ts's ClubRole already models — this gates the greetings admin
 * screen (app/admin/greetings.tsx), which is an app-wide concern, not a
 * club-scoped one.
 */
alter table public.profiles
  add column is_admin boolean not null default false;

-- One-time seed: this app's sole admin today. Matched by email since
-- public.profiles itself carries no email column (auth.users does) — see
-- 20260801221252_create_profiles.sql's own profiles table definition.
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'anand.subramanian.0@gmail.com');
