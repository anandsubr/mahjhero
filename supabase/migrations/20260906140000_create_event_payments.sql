/*
 * Who has paid, and nothing else.
 *
 * No money moves through MahjHero and none is planned (docs/roadmap.md
 * defers billing indefinitely). This table holds a marker: the organizer
 * ticks somebody off at the door, cash or Venmo having changed hands
 * outside the app entirely. There is no amount column — the event already
 * carries fee_cents (20260903130000), and per-player amounts owed were
 * explicitly out of scope.
 *
 * Three shapes carry the design:
 *
 *   1. Keyed on (event_id, profile_id), not booking_id — the same choice
 *      check_ins made (20260827020000) and for a stronger reason here: a
 *      player who cancels and rebooks has still paid, and a booking churn
 *      must not erase that.
 *
 *   2. ABSENCE OF A ROW MEANS UNPAID. There is no boolean. Marking somebody
 *      unpaid deletes the row, so there is exactly one representation of
 *      each state and no way for a stale `false` to disagree with a missing
 *      row.
 *
 *   3. ORGANIZER-ONLY, by policy. Unlike check_ins there is deliberately no
 *      self-select for members: the design forbids ever showing a player
 *      "unpaid", because the marker lags reality by design — money changes
 *      hands at the door and the organizer may simply not have ticked them
 *      off yet. An accusatory lag is worse than no information. This is the
 *      single most important security property of this feature and
 *      fixtures/event_payments_rls.test.sql exists to pin it.
 */
create table public.event_payments (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null,
  club_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  paid_at    timestamptz not null default now(),
  marked_by  uuid not null references public.profiles(id),

  -- Composite, so a row whose club disagrees with its event's is
  -- unrepresentable rather than merely unlikely. Same shape check_ins and
  -- event_tables already use; it relies on events_id_club_unique.
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,

  unique (event_id, profile_id)
);

-- The door screen's read: every row for one event. There is deliberately no
-- profile_id index, because unlike check_ins no member ever reads their own
-- row — the policy below forbids it.
create index event_payments_event_idx on public.event_payments (event_id);

alter table public.event_payments enable row level security;

/*
 * Organizers of the owning club, and nobody else. is_club_organizer is
 * security definer precisely so a policy can ask this without recursing
 * through club_members' own policy (20260822192000).
 */
create policy event_payments_select_organizer on public.event_payments
  for select using (public.is_club_organizer(club_id));

/*
 * `revoke all` first, and it is not belt-and-braces: Supabase grants ALL on
 * every table in `public` to `authenticated` by default, and ALL includes
 * TRUNCATE, which is NOT subject to row-level security. See
 * supabase/tests/database/portable/grants.test.sql.
 */
revoke all on public.event_payments from anon, authenticated;
grant select on public.event_payments to authenticated;
