/*
 * One row per hand played at a table: who won, how many points, who
 * recorded it. A table accumulates many of these over one game — this is a
 * log, not a single per-table result.
 *
 * No round_number. Order is created_at, the same call booking_groups made
 * dropping a stored waitlist_position (20260825000000): a stored sequence
 * is a second source of truth for something created_at already answers,
 * and it would need renumbering on delete, which this table explicitly
 * allows (organizer-only, see the mutations migration).
 *
 * No status/voided column for a deleted round — deletion here is a hard
 * delete. Nothing downstream references a round by id, so nothing a hard
 * delete could orphan.
 */
create table public.table_rounds (
  id                uuid primary key default gen_random_uuid(),
  event_table_id    uuid not null,
  event_id          uuid not null,
  club_id           uuid not null,
  winner_profile_id uuid not null references public.profiles(id),
  points            int not null check (points > 0),
  recorded_by       uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),

  -- Composite, so a row whose club or event disagrees with its table's is
  -- unrepresentable rather than merely unlikely — the same shape every
  -- club-scoped table in this app uses.
  foreign key (event_table_id, event_id)
    references public.event_tables (id, event_id) on delete cascade,
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade
);

-- The table card's own read: every round for one table, newest first.
create index table_rounds_table_idx on public.table_rounds (event_table_id, created_at);
-- The event screen's read: every round for one event, joined client-side
-- per table.
create index table_rounds_event_idx on public.table_rounds (event_id);

alter table public.table_rounds enable row level security;

-- Who won is the club's business, same call booking_groups/bookings made
-- (20260825000000) — not self-only like check_ins, which the brainstorming
-- for THIS feature explicitly chose against ("anyone viewing the game
-- screen").
create policy table_rounds_select_member on public.table_rounds
  for select using (public.is_club_member(club_id));

-- `revoke all` first, and it is not belt-and-braces. Supabase grants ALL on
-- every table in `public` to `authenticated` by default; ALL includes
-- TRUNCATE, which is NOT subject to row-level security.
revoke all on public.table_rounds from anon, authenticated;
grant select on public.table_rounds to authenticated;
