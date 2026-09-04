/*
 * Admin-managed greeting templates for the Dashboard's daily greeting
 * (app/clubs/index.tsx). Every signed-in member can read the list; only an
 * admin (profiles.is_admin, 20260903080000) can write it.
 */
create table public.greetings (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  created_at timestamptz not null default now()
);

alter table public.greetings enable row level security;

-- Any signed-in member reads the whole list -- the daily pick is shown to
-- everyone, not just admins. `using (true)` is safe here because the grant
-- below is `authenticated`-only; anon has no grant at all and this policy
-- never runs for it.
create policy greetings_select_all on public.greetings
  for select using (true);

-- Writes require the caller's OWN profile to be flagged admin. The
-- subquery only ever sees the caller's own row (profiles_select_own from
-- 20260801221252_create_profiles.sql), so this is exactly "is auth.uid()
-- an admin" -- the same shape that policy already establishes for reads.
create policy greetings_admin_write on public.greetings
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

grant select, insert, update, delete on public.greetings to authenticated;
