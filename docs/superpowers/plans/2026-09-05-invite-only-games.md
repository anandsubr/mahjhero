# Invite-Only Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club default new games to "open play" (any member can see/join) or "invite-only" (only people the organizer explicitly adds can see or join), with a per-game override, and extend the existing "Bring someone" feature (renamed "Invite") so it books existing members immediately and can also invite a non-member guest via a link — who becomes a full club member on acceptance and is seated at that one game.

**Architecture:** A new `game_mode` enum (`open_play`/`invite_only`) lives on `clubs` (the default), `event_series` and `events` (the effective per-occurrence value, following the exact pattern `check_in_required`/`fee_cents` already established: template → materialization → per-occurrence override tracked in `events.overrides`). Visibility and booking permission for `invite_only` events are enforced in Postgres (RLS plus two security-definer functions), not just in the UI. Guest-to-a-specific-game invites reuse the existing `club_invites` token/accept machinery with one new nullable `event_id` column, rather than a parallel table.

**Tech Stack:** Supabase Postgres migrations + RLS + pgTAP (`supabase test db`), TypeScript data layer (`lib/*.ts`), Expo Router screens (`app/**/*.tsx`), Vitest for pure-function coverage.

## Global Constraints

- Every migration file name follows `YYYYMMDDHHMMSS_snake_case_description.sql`, timestamps increasing through the day in whole-hour-or-more steps (see `supabase/migrations/` for precedent). This plan uses `20260905060000` through `20260905130000`.
- Never hand-edit an already-applied migration. Every fix or extension is a new migration on top (see `supabase/migrations/20260822040732_close_club_members_escalation.sql`'s own header for why).
- A Postgres function's **signature** (parameter list) cannot be changed via `create or replace` — it must be `drop function <old signature>;` then `create function <new signature>`, followed by `revoke ... from public, anon;` / `grant ... to authenticated;` with the **new** signature (see `supabase/migrations/20260903140000_event_fee_mutations.sql` for the exact pattern). A function whose **body** changes but whose signature is unchanged uses a plain `create or replace function`.
- RLS **policies** cannot be alteres in place either — use `drop policy <name> on <table>;` then `create policy <name> on <table> ...` with the same name.
- Every new/changed security-definer function follows this repo's grant convention: `revoke execute ... from public, anon;` then `grant execute ... to authenticated;` (both revokes are needed — a bare `revoke ... from public` does not undo Supabase's own direct bootstrap grant to `anon`).
- Every pgTAP test file starts with `begin; set local search_path to extensions, public; select plan(<N>);` and ends with `select * from finish(); rollback;` (see `supabase/tests/database/fixtures/clubs.test.sql`).
- Client-side error messages are matched by **message substring only**, never by SQLSTATE code (the same code is raised by different functions for different meanings) — see `lib/bookings.ts`'s `BOOKING_REFUSALS` and `lib/events.ts`'s `RPC_ERROR_MESSAGES` doc comments.
- Run migrations locally with `npx supabase db reset` (re-applies every migration from scratch against the local db) and pgTAP tests with `npx supabase test db --local` before every commit in this plan that touches `supabase/`.
- Run `npm run test` (Vitest) before every commit in this plan that touches `lib/` or `app/`.

---

## File Structure

**New migrations** (`supabase/migrations/`):
- `20260905060000_game_mode.sql` — enum, columns on `clubs`/`event_series`/`events`, widened `overrides` constraint, `materialize_one_series` carries `game_mode` forward.
- `20260905070000_event_visibility_and_privacy.sql` — `events_select_member` RLS branch, `event_seating`/`event_accepted_count` rewritten for invite-only visibility and attendee-list privacy.
- `20260905080000_bookings_privacy.sql` — `bookings_select_member` RLS branch (the club-list dashboard embed).
- `20260905090000_invite_only_booking_gate.sql` — `propose_booking`/`commit_booking` require an organizer caller for `invite_only` events.
- `20260905100000_set_default_game_mode.sql` — new RPC for the club-level default toggle.
- `20260905110000_event_game_mode_mutations.sql` — `game_mode` param on `create_event`/`update_event`/`create_event_series`/`update_event_series`.
- `20260905120000_club_invites_event_id.sql` — `club_invites.event_id` column + cross-club validation trigger.
- `20260905130000_accept_invite_seats_guest.sql` — `accept_club_invite` return-type change (`uuid` → `jsonb`) + seat-on-accept logic.

**New pgTAP tests** (`supabase/tests/database/fixtures/`):
- `game_mode.test.sql`, `event_visibility_and_privacy.test.sql`, `bookings_privacy.test.sql`, `invite_only_booking_gate.test.sql`, `set_default_game_mode.test.sql`, `event_game_mode_mutations.test.sql`, `club_invites_event_id.test.sql`, `accept_invite_seats_guest.test.sql` — one per migration above.

**Modified:**
- `lib/clubs.ts` — `GameMode` type, `Club.default_game_mode`, `setDefaultGameMode`, `createInvite` gains optional `eventId`, `acceptInvite` return shape.
- `lib/events.ts` — `ClubEvent.game_mode`, `EventSeries.game_mode`, `game_mode`/`gameMode` threaded through `createEvent`/`updateEvent`/`createEventSeries`/`updateEventSeries`.
- `lib/bookings.ts` — `fetchEventAcceptedCount`.
- `app/clubs/[id]/index.tsx` — club-default toggle.
- `app/clubs/[id]/events/new.tsx` — per-game override toggle (create).
- `app/clubs/[id]/events/[eventId]/edit.tsx` — per-game override toggle (edit, dual event/series scope).
- `app/join/[token].tsx` — redirect to the tied event when present.
- `app/clubs/[id]/events/[eventId]/index.tsx` — "Invite" gating/label, new "Invite a guest" action, headcount-only view for a not-yet-placed invitee on an invite-only game.

No new files outside migrations/tests — every UI change extends an existing screen/component with an existing, established pattern (`checkInRequired`'s `Toggle`, the club page's `inviteUrl` Card).

---

## Task 1: `game_mode` schema foundation

**Files:**
- Create: `supabase/migrations/20260905060000_game_mode.sql`
- Test: `supabase/tests/database/fixtures/game_mode.test.sql`

**Interfaces:**
- Produces: enum `public.game_mode` (`'open_play' | 'invite_only'`); columns `clubs.default_game_mode`, `event_series.game_mode`, `events.game_mode` (all `not null default 'open_play'`); `events.overrides` now also accepts `'game_mode'`; `materialize_one_series` copies `game_mode` from series to each new occurrence.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/game_mode.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(9);

select has_column('public', 'clubs', 'default_game_mode', 'clubs has default_game_mode');
select has_column('public', 'event_series', 'game_mode', 'event_series has game_mode');
select has_column('public', 'events', 'game_mode', 'events has game_mode');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000gm01', 'gm-host@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000gm01', 'Game Mode Club', 'game-mode-club',
   'aaaaaaaa-0000-0000-0000-00000000gm01');

select is(
  (select default_game_mode::text from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000gm01'),
  'open_play',
  'a club defaults to open_play'
);

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000gm01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000gm01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at
) values (
  '22222222-0000-0000-0000-00000000gm01', 'c1c1c1c1-0000-0000-0000-00000000gm01',
  'Test Game', '11111111-0000-0000-0000-00000000gm01',
  now() + interval '1 day', now() + interval '1 day 3 hours'
);

select is(
  (select game_mode::text from public.events
   where id = '22222222-0000-0000-0000-00000000gm01'),
  'open_play',
  'an event defaults to open_play'
);

select throws_ok(
  $$update public.events set overrides = array['bogus_key']
    where id = '22222222-0000-0000-0000-00000000gm01'$$,
  '23514',
  null,
  'overrides still rejects an unknown key'
);

select lives_ok(
  $$update public.events set overrides = array['game_mode']
    where id = '22222222-0000-0000-0000-00000000gm01'$$,
  'overrides now accepts game_mode as a known key'
);

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  starts_on, game_mode, created_by
) values (
  '33333333-0000-0000-0000-00000000gm01', 'c1c1c1c1-0000-0000-0000-00000000gm01',
  'Weekly Test', '11111111-0000-0000-0000-00000000gm01', 'weekly', 2, '19:00',
  current_date, 'invite_only', 'aaaaaaaa-0000-0000-0000-00000000gm01'
);

select public.materialize_one_series('33333333-0000-0000-0000-00000000gm01');

select is(
  (select game_mode::text from public.events
   where series_id = '33333333-0000-0000-0000-00000000gm01'
   order by occurrence_date limit 1),
  'invite_only',
  'materialize_one_series carries the series game_mode onto each occurrence'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — `has_column` assertions fail (`default_game_mode`/`game_mode` do not exist yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905060000_game_mode.sql`:

```sql
/*
 * A club-level default for whether new games are open to the whole
 * roster or visible only to people the organizer invites, plus a
 * per-occurrence override carried the same way check_in_required and
 * fee_cents already are: template (event_series) -> materialization
 * (events) -> per-occurrence override tracked in events.overrides.
 *
 * Deliberately a new column, not a repurposing of clubs.visibility
 * (public/private) -- that column already has a different, documented,
 * not-yet-built meaning (an invite LINK that either admits instantly or
 * raises a host-approved join REQUEST for club membership). This is
 * about who can see/join one GAME, not who can join the club.
 */
create type public.game_mode as enum ('open_play', 'invite_only');

alter table public.clubs
  add column default_game_mode public.game_mode not null default 'open_play';

alter table public.event_series
  add column game_mode public.game_mode not null default 'open_play';

alter table public.events
  add column game_mode public.game_mode not null default 'open_play';

-- One more override key. Dropped and re-added rather than altered: a check
-- constraint's expression cannot be modified in place.
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required', 'fee_cents', 'min_spend_cents',
                       'game_mode']
    and array_ndims(overrides) = 1
  );

/*
 * Replaced only to carry game_mode onto each occurrence, same shape as
 * 20260903130000's own replacement for fee_cents/min_spend_cents.
 * Signature is unchanged, so this is a plain create or replace.
 */
create or replace function public.materialize_one_series(
  target_series uuid,
  horizon_days  int default 42
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s            record;
  d            date;
  new_event    uuid;
  created      int := 0;
  window_start date;
  window_end   date;
begin
  select es.*, c.timezone as club_timezone
    into s
    from public.event_series es
    join public.clubs c on c.id = es.club_id
    where es.id = target_series;

  if not found then
    return 0;
  end if;

  if s.ended_at is not null then
    return 0;
  end if;

  window_start := greatest(
    s.starts_on,
    coalesce(s.materialized_through + 1, s.starts_on),
    current_date
  );
  window_end := least(
    current_date + horizon_days,
    coalesce(s.ends_on, current_date + horizon_days)
  );

  if window_end < window_start then
    return 0;
  end if;

  for d in
    select * from public.series_occurrence_dates(
      s.frequency, s.weekday, s.nth_week,
      s.starts_on, s.ends_on, window_start, window_end
    )
  loop
    new_event := null;

    insert into public.events (
      club_id, series_id, title, venue_id, notes,
      starts_at, ends_at, occurrence_date, check_in_required,
      fee_cents, min_spend_cents, game_mode, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.fee_cents, s.min_spend_cents, s.game_mode,
      s.created_by
    )
    on conflict (series_id, occurrence_date) where series_id is not null
    do nothing
    returning id into new_event;

    if new_event is not null then
      insert into public.event_tables (event_id, club_id, label, position)
      select new_event, s.club_id, 'Table ' || g, g
      from generate_series(1, s.table_count) g;

      update public.event_series
        set materialized_through = greatest(
          coalesce(materialized_through, d), d)
        where id = target_series;

      created := created + 1;
    end if;
  end loop;

  return created;
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 9 assertions in `game_mode.test.sql`), and every pre-existing pgTAP test still passes (the `materialize_one_series` body inside this loop must stay byte-identical to `20260903130000`'s version aside from the `game_mode` additions — check `git diff` against that migration's body if any assertion elsewhere regresses).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905060000_game_mode.sql supabase/tests/database/fixtures/game_mode.test.sql
git commit -m "feat(db): add game_mode enum and columns for invite-only games"
```

---

## Task 2: Event visibility and attendee-list privacy

**Files:**
- Create: `supabase/migrations/20260905070000_event_visibility_and_privacy.sql`
- Test: `supabase/tests/database/fixtures/event_visibility_and_privacy.test.sql`

**Interfaces:**
- Consumes: `events.game_mode` (Task 1), `is_club_organizer(uuid)` (existing), `is_club_member(uuid)` (existing).
- Produces: `events_select_member` RLS (updated `using` clause); `event_seating(uuid)` (rewritten body, same signature/return type); new `event_accepted_count(uuid) returns int`.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/event_visibility_and_privacy.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ev01', 'ev-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ev02', 'ev-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000ev03', 'ev-outsider@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ev01', 'Visibility Club', 'visibility-club',
   'aaaaaaaa-0000-0000-0000-00000000ev01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ev01',
   'aaaaaaaa-0000-0000-0000-00000000ev01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ev01',
   'bbbbbbbb-0000-0000-0000-00000000ev02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000ev01',
   'cccccccc-0000-0000-0000-00000000ev03', 'member');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000ev01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ev01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode
) values (
  '22222222-0000-0000-0000-00000000ev01', 'c1c1c1c1-0000-0000-0000-00000000ev01',
  'Private Game', '11111111-0000-0000-0000-00000000ev01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only'
);

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000ev01', '22222222-0000-0000-0000-00000000ev01',
   'c1c1c1c1-0000-0000-0000-00000000ev01', 'Table 1', 1);

-- Bob is invited-and-booked but not yet placed at a table.
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('55555555-0000-0000-0000-00000000ev01', '22222222-0000-0000-0000-00000000ev01',
   'c1c1c1c1-0000-0000-0000-00000000ev01',
   'aaaaaaaa-0000-0000-0000-00000000ev01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('55555555-0000-0000-0000-00000000ev01', '22222222-0000-0000-0000-00000000ev01',
   'c1c1c1c1-0000-0000-0000-00000000ev01',
   'bbbbbbbb-0000-0000-0000-00000000ev02',
   'aaaaaaaa-0000-0000-0000-00000000ev01');

-- Outsider (Carol) is a club member but never invited to this private game.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ev03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where id = '22222222-0000-0000-0000-00000000ev01'),
  0,
  'an uninvited member cannot see the invite-only event at all'
);

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ev01')),
  0,
  'event_seating returns nothing to an uninvited member'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ev01'),
  null,
  'event_accepted_count returns null to someone who cannot see the event'
);

-- Bob: invited and booked, but not yet placed at a table.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ev02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where id = '22222222-0000-0000-0000-00000000ev01'),
  1,
  'an invited-and-booked member can see the private event'
);

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ev01')),
  1,
  'a not-yet-placed invitee sees only their own booking via event_seating'
);

select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000ev01')),
  'bbbbbbbb-0000-0000-0000-00000000ev02'::uuid,
  'the one row a not-yet-placed invitee sees is their own'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ev01'),
  1,
  'a not-yet-placed invitee still gets the headcount'
);

-- Now place Bob at a table -- the full list should unlock for him.
set local role postgres;
reset request.jwt.claims;
update public.bookings set event_table_id = '44444444-0000-0000-0000-00000000ev01'
where group_id = '55555555-0000-0000-0000-00000000ev01';

-- A second, still-unplaced invitee (Carol, now invited) so there is
-- something for placement to unlock visibility of.
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('66666666-0000-0000-0000-00000000ev01', '22222222-0000-0000-0000-00000000ev01',
   'c1c1c1c1-0000-0000-0000-00000000ev01',
   'aaaaaaaa-0000-0000-0000-00000000ev01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('66666666-0000-0000-0000-00000000ev01', '22222222-0000-0000-0000-00000000ev01',
   'c1c1c1c1-0000-0000-0000-00000000ev01',
   'cccccccc-0000-0000-0000-00000000ev03',
   'aaaaaaaa-0000-0000-0000-00000000ev01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ev02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ev01')),
  2,
  'once placed at a table, the invitee sees every booking for the event'
);

-- Organizer always sees everything, placed or not.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ev01", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ev01')),
  2,
  'the organizer sees every booking regardless of placement'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ev01'),
  2,
  'the organizer gets the correct headcount too'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — the outsider can currently see the event and its full seating (no `invite_only` branch exists yet), and `event_accepted_count` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905070000_event_visibility_and_privacy.sql`:

```sql
/*
 * Invite-only games: visibility and attendee-list privacy.
 *
 * Visibility: an invite_only event is visible only to its organizer or to
 * someone who already holds an active booking on it (being booked IS being
 * invited -- see the design doc, there is no separate "invited but not
 * booked" state for an existing club member).
 *
 * Attendee-list privacy, ON TOP of visibility: for an invite_only event, a
 * non-organizer who can see the event at all still sees only their OWN
 * booking until they themselves are placed at a table -- being seated
 * unlocks the full list, not just their own table. event_accepted_count
 * gives a not-yet-placed invitee a headcount without identities.
 */

drop policy events_select_member on public.events;

create policy events_select_member on public.events
  for select using (
    public.is_club_member(club_id)
    and (status <> 'draft' or public.is_club_organizer(club_id))
    and (
      game_mode = 'open_play'
      or public.is_club_organizer(club_id)
      or exists (
        select 1 from public.bookings b
        where b.event_id = events.id
          and b.profile_id = auth.uid()
          and b.status in ('confirmed', 'waitlisted')
      )
    )
  );

create or replace function public.event_seating(target_event uuid)
returns table (
  booking_id      uuid,
  group_id        uuid,
  profile_id      uuid,
  display_name    text,
  skill_level     public.skill_level,
  event_table_id  uuid,
  status          public.booking_status,
  booked_by       uuid,
  booked_by_name  text,
  group_status    public.booking_group_status,
  waitlist_position int,
  created_at      timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with ev as (
    select id, club_id, game_mode from public.events where id = target_event
  ),
  my_seat as (
    select b.event_table_id from public.bookings b
    where b.event_id = target_event and b.profile_id = auth.uid()
      and b.status in ('confirmed', 'waitlisted')
    limit 1
  )
  select
    b.id,
    b.group_id,
    b.profile_id,
    p.display_name,
    p.skill_level,
    b.event_table_id,
    b.status,
    b.booked_by,
    bp.display_name,
    g.status,
    case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    b.created_at
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.profiles p  on p.id = b.profile_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  cross join ev
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted')
    and public.is_club_member(ev.club_id)
    -- Visibility: same test as events_select_member's own invite_only
    -- branch, re-asked here because this function bypasses RLS entirely.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or exists (select 1 from my_seat)
    )
    -- Attendee-list privacy: full list only once placed, for invite_only.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or exists (select 1 from my_seat where event_table_id is not null)
      or b.profile_id = auth.uid()
    )
  order by t.position nulls last, b.created_at, b.id;
$$;

/*
 * Headcount only, no identities -- what a not-yet-placed invitee's UI shows
 * instead of a roster. Returns null rather than raising for someone who
 * cannot see the event at all, since this is a soft read the client only
 * calls once it already believes the caller has access.
 */
create function public.event_accepted_count(target_event uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case when exists (
    select 1 from public.events e
    where e.id = target_event
      and public.is_club_member(e.club_id)
      and (
        e.game_mode = 'open_play'
        or public.is_club_organizer(e.club_id)
        or exists (
          select 1 from public.bookings b
          where b.event_id = target_event and b.profile_id = auth.uid()
            and b.status in ('confirmed', 'waitlisted')
        )
      )
  )
  then (
    select count(*)::int from public.bookings b
    where b.event_id = target_event and b.status in ('confirmed', 'waitlisted')
  )
  else null end;
$$;

revoke execute on function public.event_accepted_count(uuid) from public, anon;
grant  execute on function public.event_accepted_count(uuid) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 11 assertions), and `events.test.sql` (existing) still passes — its draft/cancelled visibility assertions all use `open_play` events by default (the column's own default), so the new `invite_only` branch is a no-op for them.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905070000_event_visibility_and_privacy.sql supabase/tests/database/fixtures/event_visibility_and_privacy.test.sql
git commit -m "feat(db): gate event visibility and attendee lists for invite-only games"
```

---

## Task 3: Dashboard embed privacy (`bookings` RLS)

**Files:**
- Create: `supabase/migrations/20260905080000_bookings_privacy.sql`
- Test: `supabase/tests/database/fixtures/bookings_privacy.test.sql`

**Interfaces:**
- Consumes: `events.game_mode` (Task 1).
- Produces: `bookings_select_member` RLS (updated `using` clause). This is what gates `lib/events.ts`'s `EVENT_COLUMNS` embed (`bookings(profile_id, status, event_table_id)`), used by the club dashboard's `eventStatusLine`.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/bookings_privacy.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000bk01', 'bk-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000bk02', 'bk-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000bk03', 'bk-outsider@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000bk01', 'Bookings Privacy Club',
   'bookings-privacy-club', 'aaaaaaaa-0000-0000-0000-00000000bk01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000bk01',
   'aaaaaaaa-0000-0000-0000-00000000bk01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000bk01',
   'bbbbbbbb-0000-0000-0000-00000000bk02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000bk01',
   'cccccccc-0000-0000-0000-00000000bk03', 'member');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000bk01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000bk01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode
) values (
  '22222222-0000-0000-0000-00000000bk01', 'c1c1c1c1-0000-0000-0000-00000000bk01',
  'Private Game', '11111111-0000-0000-0000-00000000bk01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only'
);

insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('55555555-0000-0000-0000-00000000bk01', '22222222-0000-0000-0000-00000000bk01',
   'c1c1c1c1-0000-0000-0000-00000000bk01',
   'aaaaaaaa-0000-0000-0000-00000000bk01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('55555555-0000-0000-0000-00000000bk01', '22222222-0000-0000-0000-00000000bk01',
   'c1c1c1c1-0000-0000-0000-00000000bk01',
   'bbbbbbbb-0000-0000-0000-00000000bk02',
   'aaaaaaaa-0000-0000-0000-00000000bk01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000bk03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000bk01'),
  0,
  'an uninvited member reads zero booking rows for a private event'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000bk02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000bk01'),
  1,
  'a not-yet-placed invitee reads only their own booking row'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000bk01", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000bk01'),
  1,
  'the organizer reads the booking row too'
);

-- Open-play events are unaffected: a plain member sees every booking.
set local role postgres;
reset request.jwt.claims;
update public.events set game_mode = 'open_play'
where id = '22222222-0000-0000-0000-00000000bk01';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000bk03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000bk01'),
  1,
  'open_play bookings are unaffected -- any club member reads every row'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — the outsider currently reads the booking row (the policy only checks club membership today).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905080000_bookings_privacy.sql`:

```sql
/*
 * The same invite-only visibility/placement rule Task 2 applies to
 * event_seating (used by the event detail screen), applied here to the
 * bookings table itself -- what actually gates lib/events.ts's EVENT_COLUMNS
 * embed (`bookings(profile_id, status, event_table_id)`), read directly by
 * PostgREST rather than through a security-definer function, so RLS is the
 * only place this can be enforced for that path.
 */
drop policy bookings_select_member on public.bookings;

create policy bookings_select_member on public.bookings
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = bookings.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      or profile_id = auth.uid()
      or exists (
        select 1 from public.bookings mine
        where mine.event_id = bookings.event_id
          and mine.profile_id = auth.uid()
          and mine.event_table_id is not null
          and mine.status in ('confirmed', 'waitlisted')
      )
    )
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 4 assertions), and `bookings_schema.test.sql`/`bookings_commit.test.sql`/`bookings_cancellation.test.sql` (existing, all use `open_play`-default events) still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905080000_bookings_privacy.sql supabase/tests/database/fixtures/bookings_privacy.test.sql
git commit -m "feat(db): restrict the bookings dashboard embed for invite-only games"
```

---

## Task 4: Organizer-only booking gate for invite-only games

**Files:**
- Create: `supabase/migrations/20260905090000_invite_only_booking_gate.sql`
- Test: `supabase/tests/database/fixtures/invite_only_booking_gate.test.sql`

**Interfaces:**
- Consumes: `events.game_mode` (Task 1), `is_club_organizer(uuid)`/`assert_club_organizer(uuid)` (existing).
- Produces: `propose_booking`/`commit_booking` (same signatures, bodies gain one check each). Deliberately does NOT touch `assert_players_bookable`, `plan_seating`, `promote_waitlist`, or `confirm_group_seats` — waitlist auto-promotion reassigns an existing booking's table rather than adding a new player, so it never re-enters this gate.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/invite_only_booking_gate.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ig01', 'ig-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ig02', 'ig-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000ig03', 'ig-friend@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ig01', 'Gate Club', 'gate-club',
   'aaaaaaaa-0000-0000-0000-00000000ig01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ig01',
   'aaaaaaaa-0000-0000-0000-00000000ig01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ig01',
   'bbbbbbbb-0000-0000-0000-00000000ig02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000ig01',
   'cccccccc-0000-0000-0000-00000000ig03', 'member');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000ig01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ig01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode
) values (
  '22222222-0000-0000-0000-00000000ig01', 'c1c1c1c1-0000-0000-0000-00000000ig01',
  'Private Game', '11111111-0000-0000-0000-00000000ig01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only'
);

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000ig01', '22222222-0000-0000-0000-00000000ig01',
   'c1c1c1c1-0000-0000-0000-00000000ig01', 'Table 1', 1);

-- A plain member cannot book themselves onto the private game.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ig02", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ig01',
      array['bbbbbbbb-0000-0000-0000-00000000ig02']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot self-book onto an invite-only game'
);

select throws_ok(
  $$select public.propose_booking('22222222-0000-0000-0000-00000000ig01',
      array['bbbbbbbb-0000-0000-0000-00000000ig02']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot even propose a booking onto an invite-only game'
);

-- A plain member cannot bring a friend onto it either.
select throws_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ig01',
      array['cccccccc-0000-0000-0000-00000000ig03']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot bring someone else onto an invite-only game either'
);

-- The organizer CAN book a member in.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ig01", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ig01',
      array['bbbbbbbb-0000-0000-0000-00000000ig02']::uuid[],
      '44444444-0000-0000-0000-00000000ig01', true)$$,
  'the organizer can invite (book) a member onto an invite-only game'
);

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000ig01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ig02'
     and status = 'confirmed'),
  1,
  'the invited member is actually seated'
);

-- An open_play event is unaffected -- the member can still self-book.
set local role postgres;
reset request.jwt.claims;
update public.events set game_mode = 'open_play'
where id = '22222222-0000-0000-0000-00000000ig01';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ig03", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ig01',
      array['cccccccc-0000-0000-0000-00000000ig03']::uuid[], null, true)$$,
  'open_play events are unaffected -- a plain member can still self-book'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — a plain member currently books freely onto any event, including `invite_only` ones.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905090000_invite_only_booking_gate.sql`:

```sql
/*
 * For an invite_only event, only the organizer may add players -- an
 * existing member's only way in is the organizer's own Invite action,
 * which is exactly this same commit_booking call made BY the organizer.
 *
 * Deliberately checks the CALLER (auth.uid()), not the players being
 * added, so this reads "who may invite" rather than "who may be invited" --
 * an organizer inviting themselves onto their own private game passes too.
 *
 * Deliberately NOT added to assert_players_bookable: accept_club_invite
 * (a later migration in this plan) seats a freshly-joined guest at a
 * private game the SAME WAY commit_booking would, but the guest is by
 * definition not an organizer -- their invite was already
 * organizer-authorized at CREATION time, so re-checking organizer status
 * at ACCEPTANCE time would wrongly refuse the very case the invite exists
 * for. accept_club_invite does its own seating insert directly rather than
 * calling commit_booking, so it never passes through this check at all.
 */
create or replace function public.propose_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_club uuid;
  mode        public.game_mode;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  return public.plan_seating(target_event, players, preferred, allow_split)
       || jsonb_build_object('group_id', null,
                             'waitlist_position', null,
                             'offer', null);
end;
$$;

create or replace function public.commit_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club uuid;
  mode        public.game_mode;
  seating     jsonb;
  new_group   uuid;
  placement   jsonb;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  -- Everything after this line is inside the event's lock. Two members
  -- racing for the last seat serialize here, which is what makes the
  -- race impossible rather than unlikely.
  perform 1 from public.events where id = target_event for update;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  seating := public.plan_seating(target_event, players, preferred, allow_split);

  insert into public.booking_groups
    (event_id, club_id, created_by, preferred_table_id, allow_split,
     status, waitlisted_at)
  values (
    target_event, target_club, auth.uid(), preferred, allow_split,
    case when seating->>'outcome' = 'seated' then 'confirmed'::public.booking_group_status
         else 'waitlisted'::public.booking_group_status end,
    case when seating->>'outcome' = 'seated' then null else now() end)
  returning id into new_group;

  if seating->>'outcome' = 'seated' then
    for placement in select * from jsonb_array_elements(seating->'placements')
    loop
      insert into public.bookings
        (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
      values (new_group, target_event, target_club,
              (placement->>'event_table_id')::uuid,
              (placement->>'profile_id')::uuid,
              auth.uid());
    end loop;
  else
    insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by, status)
    select new_group, target_event, target_club, p, auth.uid(), 'waitlisted'
    from unnest(players) p;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booked_by_friend',
         jsonb_build_object('booking_id', b.id, 'booked_by', auth.uid()),
         'booked_by_friend:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.profile_id <> auth.uid();

  if seating->>'outcome' <> 'seated' then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 6 assertions), and `bookings_commit.test.sql`/`need_a_fourth.test.sql`/waitlist-promotion tests (existing, all `open_play`) still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905090000_invite_only_booking_gate.sql supabase/tests/database/fixtures/invite_only_booking_gate.test.sql
git commit -m "feat(db): only an organizer may add players to an invite-only game"
```

---

## Task 5: `set_default_game_mode` RPC

**Files:**
- Create: `supabase/migrations/20260905100000_set_default_game_mode.sql`
- Test: `supabase/tests/database/fixtures/set_default_game_mode.test.sql`

**Interfaces:**
- Consumes: `clubs.default_game_mode` (Task 1), `assert_club_organizer(uuid)` (existing).
- Produces: `set_default_game_mode(target_club uuid, new_mode public.game_mode) returns void`.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/set_default_game_mode.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000sd01', 'sd-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000sd02', 'sd-coorg@example.com'),
  ('cccccccc-0000-0000-0000-00000000sd03', 'sd-member@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000sd01', 'Settings Club', 'settings-club',
   'aaaaaaaa-0000-0000-0000-00000000sd01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000sd01',
   'aaaaaaaa-0000-0000-0000-00000000sd01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000sd01',
   'bbbbbbbb-0000-0000-0000-00000000sd02', 'co_organizer'),
  ('c1c1c1c1-0000-0000-0000-00000000sd01',
   'cccccccc-0000-0000-0000-00000000sd03', 'member');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000sd03", "role": "authenticated"}';

select throws_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000sd01', 'invite_only')$$,
  '42501',
  null,
  'a plain member cannot change the club default'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000sd02", "role": "authenticated"}';

select lives_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000sd01', 'invite_only')$$,
  'a co-organizer can change the club default'
);

select is(
  (select default_game_mode::text from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000sd01'),
  'invite_only',
  'the default was actually updated'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000sd01", "role": "authenticated"}';

select lives_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000sd01', 'open_play')$$,
  'the host can change it back'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — `set_default_game_mode` does not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905100000_set_default_game_mode.sql`:

```sql
/*
 * The club-level default toggle. A dedicated RPC rather than a direct
 * client UPDATE through clubs_update_host: that policy is host-only, while
 * every other organizer-facing action in this app (invite, venues, event
 * mutations) is host-OR-co-organizer via assert_club_organizer. Widening
 * clubs_update_host itself would also hand co-organizers every other
 * column that policy guards (name, slug, rhythm, timezone) -- out of scope
 * here and not asked for.
 */
create function public.set_default_game_mode(
  target_club uuid,
  new_mode    public.game_mode
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_club_organizer(target_club);

  update public.clubs set default_game_mode = new_mode
  where id = target_club;
end;
$$;

revoke execute on function public.set_default_game_mode(uuid, public.game_mode)
  from public, anon;
grant execute on function public.set_default_game_mode(uuid, public.game_mode)
  to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 4 assertions).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905100000_set_default_game_mode.sql supabase/tests/database/fixtures/set_default_game_mode.test.sql
git commit -m "feat(db): add set_default_game_mode RPC for the club-level toggle"
```

---

## Task 6: `game_mode` on event/series create and update

**Files:**
- Create: `supabase/migrations/20260905110000_event_game_mode_mutations.sql`
- Test: `supabase/tests/database/fixtures/event_game_mode_mutations.test.sql`

**Interfaces:**
- Consumes: `clubs.default_game_mode`, `events.game_mode`, `event_series.game_mode` (Task 1).
- Produces: `create_event`/`update_event`/`create_event_series`/`update_event_series`, each with one new trailing `public.game_mode` parameter (`null` meaning "use the club default" for create, "leave alone" for update).

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/event_game_mode_mutations.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(7);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000em01', 'em-host@example.com');

insert into public.clubs (id, name, slug, default_game_mode, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000em01', 'Mutation Club', 'mutation-club',
   'invite_only', 'aaaaaaaa-0000-0000-0000-00000000em01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000em01',
   'aaaaaaaa-0000-0000-0000-00000000em01', 'host');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000em01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000em01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000em01", "role": "authenticated"}';

-- create_event with no explicit game_mode inherits the club default.
create temporary table created_event on commit drop as
  select public.create_event(
    'c1c1c1c1-0000-0000-0000-00000000em01', 'Inherited Game',
    '11111111-0000-0000-0000-00000000em01', '', current_date + 1, '19:00'
  ) as id;

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event)),
  'invite_only',
  'create_event with no explicit game_mode inherits the club default'
);

-- create_event with an explicit override wins over the club default.
create temporary table created_event2 on commit drop as
  select public.create_event(
    'c1c1c1c1-0000-0000-0000-00000000em01', 'Overridden Game',
    '11111111-0000-0000-0000-00000000em01', '', current_date + 1, '20:00',
    180, 1, false, 0, 0, 'open_play'
  ) as id;

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'open_play',
  'create_event honours an explicit game_mode override'
);

-- update_event leaves game_mode alone when not passed.
select public.update_event((select id from created_event2), new_title => 'Renamed');

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'open_play',
  'update_event leaves game_mode alone when not passed'
);

-- update_event changes game_mode when passed.
select public.update_event(
  (select id from created_event2), new_game_mode => 'invite_only');

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'invite_only',
  'update_event changes game_mode when passed'
);

-- create_event_series / materialization / update_event_series push-down.
create temporary table created_series on commit drop as
  select public.create_event_series(
    'c1c1c1c1-0000-0000-0000-00000000em01', 'Weekly Series',
    '11111111-0000-0000-0000-00000000em01', '', 'weekly', 2, null, '19:00',
    180, 1, current_date, null, false, 0, 0, 'open_play'
  ) as id;

select is(
  (select game_mode::text from public.event_series
   where id = (select id from created_series)),
  'open_play',
  'create_event_series honours an explicit game_mode override'
);

select is(
  (select game_mode::text from public.events
   where series_id = (select id from created_series)
   order by occurrence_date limit 1),
  'open_play',
  'the first materialized occurrence inherits the series game_mode'
);

select public.update_event_series(
  (select id from created_series), new_game_mode => 'invite_only');

select is(
  (select count(*)::int from public.events
   where series_id = (select id from created_series)
     and status <> 'cancelled'
     and starts_at > now()
     and game_mode <> 'invite_only'),
  0,
  'update_event_series pushes game_mode onto every future, uncustomised occurrence'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — `create_event`/`update_event`/`create_event_series`/`update_event_series` do not accept a `game_mode` argument yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905110000_event_game_mode_mutations.sql`:

```sql
/*
 * Same drop-and-recreate dance as 20260903140000_event_fee_mutations.sql:
 * one new trailing, defaulted argument on each of these four. Bodies are
 * each function's most recent redefinition (20260903140000/20260822040732's
 * update_event_series) plus game_mode threaded through exactly where
 * check_in/check_in_required already are. Unlike every other "new_*"
 * argument, create_event/create_event_series resolve a null game_mode to
 * the CLUB'S default_game_mode rather than a hardcoded literal -- the
 * client always sends an explicit value in practice (seeded from the
 * fetched club), but the database is the one place this guarantee should
 * not depend on the client getting it right.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int);

create function public.create_event(
  target_club      uuid,
  event_title      text,
  target_venue     uuid,
  event_notes      text default '',
  event_date       date default null,
  start_time       time default null,
  duration_minutes int default 180,
  table_count      int default 1,
  check_in         boolean default false,
  fee_cents        int default 0,
  min_spend_cents  int default 0,
  event_game_mode  public.game_mode default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id  uuid;
  club_tz text;
  starts  timestamptz;
  eff_mode public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(event_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if event_date is null or start_time is null then
    raise exception 'an event must have a date and a start time'
      using errcode = '23514';
  end if;
  if duration_minutes is null or duration_minutes not between 15 and 1440 then
    raise exception 'duration out of range' using errcode = '23514';
  end if;
  if table_count < 1 or table_count > 20 then
    raise exception 'table count out of range' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  select c.timezone, coalesce(event_game_mode, c.default_game_mode)
    into club_tz, eff_mode
    from public.clubs c where c.id = target_club;

  starts := (event_date + start_time) at time zone club_tz;

  if starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, game_mode, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, eff_mode, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int, public.game_mode)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int, public.game_mode)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
drop function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int);

create function public.update_event(
  target_event          uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_date              date default null,
  new_start_time        time default null,
  new_duration_minutes  int default null,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  club_tz        text;
  local_start    timestamp;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
  eff_date       date;
  eff_time       time;
  eff_duration   int;
  eff_starts     timestamptz;
  eff_ends       timestamptz;
  eff_check_in   boolean;
  eff_fee        int;
  eff_min_spend  int;
  eff_game_mode  public.game_mode;
  next_overrides text[];
begin
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title := coalesce(new_title, ev.title);
  eff_venue := coalesce(new_venue_id, ev.venue_id);
  eff_notes := coalesce(new_notes, ev.notes);
  eff_check_in := coalesce(new_check_in_required, ev.check_in_required);
  eff_fee := coalesce(new_fee_cents, ev.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, ev.min_spend_cents);
  eff_game_mode := coalesce(new_game_mode, ev.game_mode);

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  if new_date is null and new_start_time is null
     and new_duration_minutes is null then
    eff_starts := ev.starts_at;
    eff_ends   := ev.ends_at;
  else
    if new_duration_minutes is not null
       and new_duration_minutes not between 15 and 1440 then
      raise exception 'duration out of range' using errcode = '23514';
    end if;

    select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

    local_start := ev.starts_at at time zone club_tz;

    eff_date := coalesce(new_date, local_start::date);
    eff_time := coalesce(new_start_time, local_start::time);
    eff_duration := coalesce(
      new_duration_minutes,
      (extract(epoch from (ev.ends_at - ev.starts_at)) / 60)::int);

    eff_starts := (eff_date + eff_time) at time zone club_tz;
    eff_ends   := eff_starts + make_interval(mins => eff_duration);
  end if;

  if eff_venue is distinct from ev.venue_id then
    perform public.assert_venue_available(ev.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  if eff_starts is distinct from ev.starts_at and eff_starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    if trim(eff_title) is distinct from trim(ev.title) then
      next_overrides := array_append(next_overrides, 'title');
    end if;
    if eff_venue is distinct from ev.venue_id then
      next_overrides := array_append(next_overrides, 'venue_id');
    end if;
    if eff_notes is distinct from ev.notes then
      next_overrides := array_append(next_overrides, 'notes');
    end if;
    if eff_starts is distinct from ev.starts_at
       or eff_ends is distinct from ev.ends_at then
      next_overrides := array_append(next_overrides, 'starts_at');
    end if;
    if new_check_in_required is not null
       and new_check_in_required is distinct from ev.check_in_required then
      next_overrides := array_append(next_overrides, 'check_in_required');
    end if;
    if new_fee_cents is not null
       and new_fee_cents is distinct from ev.fee_cents then
      next_overrides := array_append(next_overrides, 'fee_cents');
    end if;
    if new_min_spend_cents is not null
       and new_min_spend_cents is distinct from ev.min_spend_cents then
      next_overrides := array_append(next_overrides, 'min_spend_cents');
    end if;
    if new_game_mode is not null
       and new_game_mode is distinct from ev.game_mode then
      next_overrides := array_append(next_overrides, 'game_mode');
    end if;

    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title              = trim(eff_title),
    venue_id           = eff_venue,
    notes              = eff_notes,
    starts_at          = eff_starts,
    ends_at            = eff_ends,
    check_in_required  = eff_check_in,
    fee_cents          = eff_fee,
    min_spend_cents    = eff_min_spend,
    game_mode          = eff_game_mode,
    overrides          = next_overrides
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int);

create function public.create_event_series(
  target_club     uuid,
  series_title    text,
  target_venue    uuid,
  series_notes    text default '',
  freq            public.series_frequency default 'weekly',
  weekday         smallint default 2,
  nth_week        smallint default null,
  start_time      time default '19:00',
  duration_minutes int default 180,
  table_count     int default 1,
  starts_on       date default null,
  ends_on         date default null,
  check_in        boolean default false,
  fee_cents       int default 0,
  min_spend_cents int default 0,
  series_game_mode public.game_mode default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
  eff_mode   public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(series_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  select coalesce(series_game_mode, default_game_mode) into eff_mode
    from public.clubs where id = target_club;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, game_mode, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, eff_mode, auth.uid()
  )
  returning id into new_id;

  if ends_on is not null then
    select d into first_date
    from public.series_occurrence_dates(
      freq, weekday, nth_week,
      coalesce(starts_on, current_date), ends_on,
      greatest(coalesce(starts_on, current_date), current_date), ends_on
    ) d
    limit 1;

    if first_date is null then
      raise exception 'no games before that end date' using errcode = '23514';
    end if;
  end if;

  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int, public.game_mode)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int, public.game_mode)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------------
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int);

create function public.update_event_series(
  target_series         uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_start_time        time default null,
  new_duration          int default null,
  new_table_count       int default null,
  new_ends_on           date default null,
  include_overridden    boolean default false,
  clear_ends_on         boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se                public.event_series;
  club_tz           text;
  eff_title         text;
  eff_venue         uuid;
  eff_notes         text;
  eff_start         time;
  eff_dur           int;
  eff_count         int;
  eff_ends          date;
  eff_check_in      boolean;
  eff_fee           int;
  eff_min_spend     int;
  eff_game_mode     public.game_mode;
  touched_title     boolean;
  touched_venue     boolean;
  touched_notes     boolean;
  touched_time      boolean;
  touched_check_in  boolean;
  touched_fee       boolean;
  touched_min_spend boolean;
  touched_game_mode boolean;
begin
  select * into se from public.event_series where id = target_series for update;

  if se.id is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(se.club_id);

  select timezone into club_tz from public.clubs where id = se.club_id;

  eff_title := coalesce(new_title, se.title);
  eff_venue := coalesce(new_venue_id, se.venue_id);
  eff_notes := coalesce(new_notes, se.notes);
  eff_start := coalesce(new_start_time, se.start_time);
  eff_dur   := coalesce(new_duration, se.duration_minutes);
  eff_count := coalesce(new_table_count, se.table_count);
  eff_check_in := coalesce(new_check_in_required, se.check_in_required);
  eff_fee := coalesce(new_fee_cents, se.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, se.min_spend_cents);
  eff_game_mode := coalesce(new_game_mode, se.game_mode);
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;
  touched_check_in := eff_check_in is distinct from se.check_in_required;
  touched_fee := eff_fee is distinct from se.fee_cents;
  touched_min_spend := eff_min_spend is distinct from se.min_spend_cents;
  touched_game_mode := eff_game_mode is distinct from se.game_mode;

  if eff_venue is distinct from se.venue_id then
    perform public.assert_venue_available(se.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  update public.event_series set
    title            = trim(eff_title),
    venue_id         = eff_venue,
    notes            = eff_notes,
    start_time       = eff_start,
    duration_minutes = eff_dur,
    table_count      = eff_count,
    ends_on          = eff_ends,
    check_in_required = eff_check_in,
    fee_cents        = eff_fee,
    min_spend_cents  = eff_min_spend,
    game_mode        = eff_game_mode
  where id = target_series;

  if touched_title then
    update public.events e set title = trim(eff_title)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('notes' = any(e.overrides)));
  end if;

  if touched_check_in then
    update public.events e set check_in_required = eff_check_in
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('check_in_required' = any(e.overrides)));
  end if;

  if touched_fee then
    update public.events e set fee_cents = eff_fee
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('fee_cents' = any(e.overrides)));
  end if;

  if touched_min_spend then
    update public.events e set min_spend_cents = eff_min_spend
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('min_spend_cents' = any(e.overrides)));
  end if;

  if touched_game_mode then
    update public.events e set game_mode = eff_game_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('game_mode' = any(e.overrides)));
  end if;

  if touched_time then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'      and touched_title)
        or (k = 'venue_id' and touched_venue)
        or (k = 'notes'    and touched_notes)
        or (k = 'starts_at' and touched_time)
        or (k = 'check_in_required' and touched_check_in)
        or (k = 'fee_cents' and touched_fee)
        or (k = 'min_spend_cents' and touched_min_spend)
        or (k = 'game_mode' and touched_game_mode)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select distinct on (b.profile_id)
           b.profile_id, b.club_id, null::uuid, 'event_cancelled',
           jsonb_build_object(
             'booking_id', b.id,
             'series_id',  target_series,
             'event_id',   e.id,
             'starts_at',  e.starts_at),
           'series_shortened:' || b.id::text
    from public.bookings b
    join public.events e on e.id = b.event_id
    where e.series_id = target_series
      and e.occurrence_date > eff_ends
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and b.status in ('confirmed', 'waitlisted')
    order by b.profile_id, e.occurrence_date, b.id
    on conflict (dedupe_key) do nothing;

    delete from public.events
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode)
  to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 7 assertions), and `event_mutations.test.sql`/`event_series_edits.test.sql`/`event_recurrence.test.sql` (existing) still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905110000_event_game_mode_mutations.sql supabase/tests/database/fixtures/event_game_mode_mutations.test.sql
git commit -m "feat(db): thread game_mode through event and series create/update"
```

---

## Task 7: `club_invites.event_id`

**Files:**
- Create: `supabase/migrations/20260905120000_club_invites_event_id.sql`
- Test: `supabase/tests/database/fixtures/club_invites_event_id.test.sql`

**Interfaces:**
- Produces: `club_invites.event_id` (nullable FK to `events(id)`, `on delete set null`); trigger `club_invites_event_matches_club` refusing an insert/update where `event_id`'s club does not match `club_id`.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/club_invites_event_id.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(4);

select has_column('public', 'club_invites', 'event_id', 'club_invites has event_id');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ci01', 'ci-host@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ci01', 'Invite Event Club',
   'invite-event-club', 'aaaaaaaa-0000-0000-0000-00000000ci01'),
  ('c2c2c2c2-0000-0000-0000-00000000ci02', 'Other Club', 'other-club-ci',
   'aaaaaaaa-0000-0000-0000-00000000ci01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ci01',
   'aaaaaaaa-0000-0000-0000-00000000ci01', 'host'),
  ('c2c2c2c2-0000-0000-0000-00000000ci02',
   'aaaaaaaa-0000-0000-0000-00000000ci01', 'host');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000ci01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ci01');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at) values
  ('22222222-0000-0000-0000-00000000ci01', 'c1c1c1c1-0000-0000-0000-00000000ci01',
   'Test Game', '11111111-0000-0000-0000-00000000ci01',
   now() + interval '1 day', now() + interval '1 day 3 hours');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ci01", "role": "authenticated"}';

select lives_ok(
  $$insert into public.club_invites (club_id, event_id)
    values ('c1c1c1c1-0000-0000-0000-00000000ci01',
            '22222222-0000-0000-0000-00000000ci01')$$,
  'an invite tied to an event of the SAME club is accepted'
);

select throws_ok(
  $$insert into public.club_invites (club_id, event_id)
    values ('c2c2c2c2-0000-0000-0000-00000000ci02',
            '22222222-0000-0000-0000-00000000ci01')$$,
  '23514',
  null,
  'an invite cannot tie a DIFFERENT club to this event'
);

select lives_ok(
  $$insert into public.club_invites (club_id)
    values ('c1c1c1c1-0000-0000-0000-00000000ci01')$$,
  'a plain club invite with no event_id is still accepted'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — `event_id` column does not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905120000_club_invites_event_id.sql`:

```sql
/*
 * Ties a club invite to one specific game -- accepting it both joins the
 * club (unchanged) and seats the guest at this event (Task 8). Nullable:
 * every existing club_invites row, and most new ones, tie to no event at
 * all and behave exactly as today.
 *
 * A plain CHECK cannot express "event_id's own club_id must match this
 * row's club_id" (no subqueries in a CHECK), so a trigger enforces it
 * instead -- integrity, not a new authorization boundary: RLS already
 * requires the caller to organize club_id, and a mismatched event_id would
 * only ever misbehave harmlessly at accept time (assert_players_bookable
 * would refuse a non-member of the event's real club), but a dangling,
 * wrong reference is still worth refusing outright rather than silently
 * accepting.
 */
alter table public.club_invites
  add column event_id uuid references public.events(id) on delete set null;

create function public.check_club_invite_event_matches_club()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.events where id = new.event_id and club_id = new.club_id
  ) then
    raise exception 'invite event does not belong to this club'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger club_invites_event_matches_club
  before insert or update of event_id, club_id on public.club_invites
  for each row execute function public.check_club_invite_event_matches_club();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 4 assertions), and `clubs.test.sql` (existing) still passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905120000_club_invites_event_id.sql supabase/tests/database/fixtures/club_invites_event_id.test.sql
git commit -m "feat(db): let a club invite tie to one specific game"
```

---

## Task 8: `accept_club_invite` seats a guest at the tied game

**Files:**
- Create: `supabase/migrations/20260905130000_accept_invite_seats_guest.sql`
- Test: `supabase/tests/database/fixtures/accept_invite_seats_guest.test.sql`

**Interfaces:**
- Consumes: `club_invites.event_id` (Task 7), `assert_players_bookable`, `plan_seating` (existing, unchanged).
- Produces: `accept_club_invite(invite_token text) returns jsonb` — **return type change** (`uuid` → `jsonb`, shape `{club_id: uuid, event_id: uuid|null}`), so this is a drop+create, not `create or replace`.

- [ ] **Step 1: Write the failing migration test**

Create `supabase/tests/database/fixtures/accept_invite_seats_guest.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(8);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ai01', 'ai-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ai02', 'ai-guest@example.com'),
  ('cccccccc-0000-0000-0000-00000000ai03', 'ai-guest2@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ai01', 'Accept Club', 'accept-club',
   'aaaaaaaa-0000-0000-0000-00000000ai01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ai01',
   'aaaaaaaa-0000-0000-0000-00000000ai01', 'host');

insert into public.venues (id, name, added_by_club_id) values
  ('11111111-0000-0000-0000-00000000ai01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ai01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode
) values (
  '22222222-0000-0000-0000-00000000ai01', 'c1c1c1c1-0000-0000-0000-00000000ai01',
  'Private Game', '11111111-0000-0000-0000-00000000ai01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only'
), (
  '33333333-0000-0000-0000-00000000ai01', 'c1c1c1c1-0000-0000-0000-00000000ai01',
  'Cancelled Game', '11111111-0000-0000-0000-00000000ai01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only'
);

update public.events set status = 'cancelled'
where id = '33333333-0000-0000-0000-00000000ai01';

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000ai01', '22222222-0000-0000-0000-00000000ai01',
   'c1c1c1c1-0000-0000-0000-00000000ai01', 'Table 1', 1);

insert into public.club_invites (club_id, token, event_id, expires_at) values
  ('c1c1c1c1-0000-0000-0000-00000000ai01', 'game-invite-token',
   '22222222-0000-0000-0000-00000000ai01', now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-00000000ai01', 'plain-invite-token',
   null, now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-00000000ai01', 'cancelled-game-token',
   '33333333-0000-0000-0000-00000000ai01', now() + interval '7 days');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ai02", "role": "authenticated"}';

select is(
  (public.accept_club_invite('game-invite-token')->>'club_id')::uuid,
  'c1c1c1c1-0000-0000-0000-00000000ai01'::uuid,
  'accepting a game-tied invite returns the club id'
);

select is(
  (public.accept_club_invite('game-invite-token')->>'club_id')::uuid,
  null,
  'the same token cannot be redeemed twice'
);

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ai03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000ai01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ai02'),
  1,
  'redeeming a game-tied invite still creates club membership'
);

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000ai01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ai02'
     and status = 'confirmed'),
  1,
  'redeeming a game-tied invite seats the guest at the tied event'
);

-- A plain (non-event) invite is unaffected.
select is(
  (public.accept_club_invite('plain-invite-token')->>'event_id'),
  null,
  'a plain club invite has no event_id in its response'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000ai01'
     and profile_id = 'cccccccc-0000-0000-0000-00000000ai03'),
  1,
  'a plain club invite still creates membership'
);

-- A guest invited to a since-cancelled game still becomes a member.
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-00000000ai04', 'ai-guest3@example.com');
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000ai04", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_club_invite('cancelled-game-token')$$,
  'accepting an invite to a since-cancelled game does not error'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000ai01'
     and profile_id = 'dddddddd-0000-0000-0000-00000000ai04'),
  1,
  'membership is still created even though seating was skipped'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase test db --local`
Expected: FAIL — `accept_club_invite` still returns a bare `uuid` and never seats anyone.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260905130000_accept_invite_seats_guest.sql`:

```sql
/*
 * Return-type change (uuid -> jsonb), so this is drop+create rather than
 * create or replace. Adds: when the invite is tied to an event, attempt to
 * seat the newly-joined guest at it -- full seat if there is room,
 * waitlisted otherwise, mirroring commit_booking's own insert logic. Wrapped
 * in its own BEGIN/EXCEPTION block so a seating failure (the event was
 * since cancelled or ended, a lock contention, anything) rolls back only
 * the seating attempt via an implicit savepoint -- never the membership
 * insert above it. Seating is best-effort by design (see the plan's spec).
 *
 * Deliberately does NOT call commit_booking: commit_booking now refuses a
 * non-organizer caller on an invite_only event (Task 4), and the caller
 * here is the GUEST, never an organizer -- but this invite was already
 * organizer-authorized at CREATION time (creating an event-tied invite is
 * organizer-only, club_invites_insert_organizer), so no caller-permission
 * check belongs here at all. assert_players_bookable is still called
 * (membership + not-already-booked), since that check has nothing to do
 * with organizer status.
 */
drop function public.accept_club_invite(text);

create function public.accept_club_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite     public.club_invites%rowtype;
  caller     uuid := auth.uid();
  seat_event public.events%rowtype;
  new_group  uuid;
  seating    jsonb;
  placement  jsonb;
begin
  if caller is null then
    return null;
  end if;

  select * into invite
  from public.club_invites
  where token = invite_token
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.expires_at < now() then
    return null;
  end if;

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  insert into public.club_members (club_id, profile_id, role)
  values (invite.club_id, caller, 'member')
  on conflict (club_id, profile_id) do update
    set status = 'active'
    where club_members.status = 'removed';

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  if invite.event_id is not null then
    begin
      select * into seat_event
      from public.events where id = invite.event_id for update;

      if seat_event.id is not null
         and seat_event.status = 'published'
         and seat_event.starts_at > now() then
        perform public.assert_players_bookable(
          invite.club_id, invite.event_id, array[caller]);

        seating := public.plan_seating(invite.event_id, array[caller], null, true);

        insert into public.booking_groups
          (event_id, club_id, created_by, preferred_table_id, allow_split,
           status, waitlisted_at)
        values (
          invite.event_id, invite.club_id, caller, null, true,
          case when seating->>'outcome' = 'seated'
               then 'confirmed'::public.booking_group_status
               else 'waitlisted'::public.booking_group_status end,
          case when seating->>'outcome' = 'seated' then null else now() end)
        returning id into new_group;

        if seating->>'outcome' = 'seated' then
          for placement in select * from jsonb_array_elements(seating->'placements')
          loop
            insert into public.bookings
              (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
            values (new_group, invite.event_id, invite.club_id,
                    (placement->>'event_table_id')::uuid, caller, caller);
          end loop;
        else
          insert into public.bookings
            (group_id, event_id, club_id, profile_id, booked_by, status)
          values (new_group, invite.event_id, invite.club_id, caller, caller,
                  'waitlisted');
        end if;
      end if;
    exception when others then
      -- Best-effort: membership must never be undone by a seating failure.
      null;
    end;
  end if;

  return jsonb_build_object('club_id', invite.club_id, 'event_id', invite.event_id);
end;
$$;

grant execute on function public.accept_club_invite(text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS (all 8 assertions), and `clubs.test.sql`'s own `accept_club_invite` assertions still pass (they compare against `'...'::uuid` today — see Step 4a below).

- [ ] **Step 4a: Update the pre-existing `clubs.test.sql` for the new return shape**

`accept_club_invite` now returns `jsonb`, not a bare `uuid`. Edit `supabase/tests/database/fixtures/clubs.test.sql`: every `select is(public.accept_club_invite('...'), '...'::uuid, ...)` assertion must become `select is((public.accept_club_invite('...')->>'club_id')::uuid, '...'::uuid, ...)`, and every `select is(public.accept_club_invite('...'), null, ...)` becomes `select is((public.accept_club_invite('...')->>'club_id')::uuid, null, ...)`. There are 4 such call sites in that file (lines ~204-208, ~254-258, ~260-264, ~266-270, ~328-332 per the version read during planning — grep `accept_club_invite(` in that file to find all of them, since line numbers may have shifted since Tasks 1-7 landed).

Run: `npx supabase test db --local`
Expected: PASS — `clubs.test.sql` green again.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905130000_accept_invite_seats_guest.sql supabase/tests/database/fixtures/accept_invite_seats_guest.test.sql supabase/tests/database/fixtures/clubs.test.sql
git commit -m "feat(db): accept_club_invite seats a guest at the game they were invited to"
```

---

## Task 9: TypeScript data layer

**Files:**
- Modify: `lib/clubs.ts`
- Modify: `lib/events.ts`
- Modify: `lib/bookings.ts`

**Interfaces:**
- Consumes: every RPC/column from Tasks 1–8.
- Produces: `GameMode` type; `Club.default_game_mode`; `setDefaultGameMode`; `createInvite` gains optional `eventId`; `acceptInvite` returns `{ clubId, eventId, error }`; `ClubEvent.game_mode`/`EventSeries.game_mode`; `createEvent`/`updateEvent`/`createEventSeries`/`updateEventSeries` gain `gameMode`; `fetchEventAcceptedCount`.

- [ ] **Step 1: Edit `lib/clubs.ts` — types and column list**

In `lib/clubs.ts`, after line 6 (`export type ClubVisibility = 'public' | 'private';`), add:

```ts
export type GameMode = 'open_play' | 'invite_only';
```

Change the `Club` type (lines 8–15) to add the new field:

```ts
export type Club = {
  id: string;
  name: string;
  slug: string;
  rhythm: string;
  visibility: ClubVisibility;
  timezone: string;
  default_game_mode: GameMode;
};
```

Change `CLUB_COLUMNS` (line 48):

```ts
const CLUB_COLUMNS = 'id, name, slug, rhythm, visibility, timezone, default_game_mode';
```

- [ ] **Step 2: Edit `lib/clubs.ts` — `setDefaultGameMode`**

Add this function after `canAnnounce` (after line 103):

```ts
/**
 * The club-level default new games are created with. Goes through the
 * set_default_game_mode RPC (host-or-co-organizer, same test canInvite
 * mirrors) rather than a direct table UPDATE — see that migration's own
 * comment for why clubs_update_host (host-only) is not reused here.
 */
export async function setDefaultGameMode(
  clubId: string,
  mode: GameMode,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_default_game_mode', {
      target_club: clubId,
      new_mode: mode,
    });
    if (error) {
      console.error('setDefaultGameMode failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('setDefaultGameMode failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 3: Edit `lib/clubs.ts` — `createInvite` gains `eventId`**

Replace `createInvite` (lines 429–454) with:

```ts
export async function createInvite(
  clubId: string,
  target?: { email: string; display_name: string; skill_level: SkillLevel | null },
  eventId?: string,
): Promise<{ token: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('club_invites')
      .insert({
        club_id: clubId,
        email: target?.email ?? null,
        display_name: target?.display_name ?? null,
        skill_level: target?.skill_level ?? null,
        event_id: eventId ?? null,
      })
      .select('token')
      .single();

    if (error || !data) {
      console.error('createInvite failed', error);
      return { token: null, error: GENERIC_ERROR };
    }
    return { token: data.token as string, error: null };
  } catch (cause) {
    console.error('createInvite failed', cause);
    return { token: null, error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 4: Edit `lib/clubs.ts` — `acceptInvite`'s new return shape**

Replace `acceptInvite` (lines 512–535) with:

```ts
export async function acceptInvite(
  token: string,
): Promise<{ clubId: string | null; eventId: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_club_invite', {
      invite_token: token,
    });

    if (error) {
      console.error('acceptInvite failed', error);
      return { clubId: null, eventId: null, error: GENERIC_ERROR };
    }
    if (!data) {
      return {
        clubId: null,
        eventId: null,
        error: 'That invite link has expired or has already been used.',
      };
    }
    const result = data as { club_id: string; event_id: string | null };
    return { clubId: result.club_id, eventId: result.event_id, error: null };
  } catch (cause) {
    console.error('acceptInvite failed', cause);
    return { clubId: null, eventId: null, error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 5: Edit `lib/events.ts` — types and columns**

Add near the top of `lib/events.ts`, after line 3 (`import type { SkillLevel } from './profile';` — actually after the existing imports, before `export type EventStatus`):

```ts
import type { GameMode } from './clubs';
export type { GameMode } from './clubs';
```

Add `game_mode: GameMode;` to `ClubEvent` (after `min_spend_cents: number;` at line 55) and to `EventSeries` (after `min_spend_cents: number;` at line 113).

Change `EVENT_COLUMNS` (lines 151–155) to include `game_mode`:

```ts
export const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, check_in_required, fee_cents, ' +
  'min_spend_cents, game_mode, venues(name), ' +
  'event_tables(id, capacity, label), bookings(profile_id, status, event_table_id)';
```

Change `SERIES_COLUMNS` (line 158) to include `game_mode`:

```ts
export const SERIES_COLUMNS =
  'id, club_id, title, venue_id, notes, frequency, weekday, nth_week, start_time, duration_minutes, table_count, starts_on, ends_on, ended_at, check_in_required, fee_cents, min_spend_cents, game_mode, venues(name)';
```

- [ ] **Step 6: Edit `lib/events.ts` — thread `gameMode` through the four mutation functions**

In `createEvent`'s input type (after line 867 `minSpendCents: number;`), add:

```ts
  /** Which visibility this game uses. Seeded from the club's
   *  default_game_mode by the caller; the RPC itself also falls back to
   *  the club's default if this is somehow omitted. */
  gameMode: GameMode;
```

In `createEvent`'s RPC call (the `supabase.rpc('create_event', {...})` block, lines 873–885), add a trailing key:

```ts
      event_game_mode: input.gameMode,
```

In `updateEvent`'s input type (after line 933 `minSpendCents?: number | null;`), add:

```ts
    /** Null/omitted means "leave this alone". */
    gameMode?: GameMode | null;
```

In `updateEvent`'s RPC call (lines 937–948), add:

```ts
      new_game_mode: input.gameMode ?? null,
```

In `createEventSeries`'s input type (after line 1110 `minSpendCents: number;`), add:

```ts
  gameMode: GameMode;
```

In `createEventSeries`'s RPC call (lines 1116–1132), add:

```ts
      series_game_mode: input.gameMode,
```

In `updateEventSeries`'s input type (after line 1178 `minSpendCents?: number | null;`), add:

```ts
    gameMode?: GameMode | null;
```

In `updateEventSeries`'s RPC call (lines 1182–1196), add:

```ts
      new_game_mode: input.gameMode ?? null,
```

- [ ] **Step 7: Edit `lib/bookings.ts` — `fetchEventAcceptedCount`**

Add after `fetchEventSeating` (after line 478):

```ts
/**
 * Headcount only, no identities — what a not-yet-placed invitee's own view
 * of an invite-only game shows instead of the full roster (see
 * event_seating's own privacy rule). Null covers both "not determined yet"
 * and "the caller cannot see this event at all" — event_accepted_count
 * returns null rather than raising for the latter, so there is no error to
 * distinguish here.
 */
export async function fetchEventAcceptedCount(
  eventId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('event_accepted_count', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventAcceptedCount failed', error);
      return null;
    }
    return (data as number | null) ?? null;
  } catch (cause) {
    console.error('fetchEventAcceptedCount failed', cause);
    return null;
  }
}
```

- [ ] **Step 8: Check the schema-contract test for column drift**

Run: `grep -n "EVENT_COLUMNS\|CLUB_COLUMNS\|SERIES_COLUMNS" lib/schema-contract.test.ts`

If that file asserts an exact column list (rather than importing the constants directly), add `default_game_mode`/`game_mode` to the expected lists there too, matching whatever pattern the existing `check_in_required`/`fee_cents` entries use in that same file.

- [ ] **Step 9: Run the full Vitest suite**

Run: `npm run test`
Expected: PASS. (`REQUIRE_LOCAL_SUPABASE=1 npm run test:contract` also, if a local Supabase instance is running, to catch any column-list drift against the real database from Tasks 1–8.)

- [ ] **Step 10: Commit**

```bash
git add lib/clubs.ts lib/events.ts lib/bookings.ts lib/schema-contract.test.ts
git commit -m "feat: add game_mode/default_game_mode to the TypeScript data layer"
```

---

## Task 10: Club settings toggle

**Files:**
- Modify: `app/clubs/[id]/index.tsx`

**Interfaces:**
- Consumes: `Club.default_game_mode`, `setDefaultGameMode` (Task 9).

- [ ] **Step 1: Add the import and local state**

In `app/clubs/[id]/index.tsx`, change the import at line 21–28 to add `setDefaultGameMode`:

```tsx
import {
  canInvite,
  createInvite,
  deleteInvite,
  fetchClub,
  fetchPendingInvites,
  fetchRoster,
  setDefaultGameMode,
} from '../../../lib/clubs';
```

Add `Toggle` to the component imports, after line 19 (`import TextField ...`):

```tsx
import Toggle from '../../../components/Toggle';
```

Add state after `const [error, setError] = useState<string | null>(null);` (line 51):

```tsx
  const [gameModeBusy, setGameModeBusy] = useState(false);
```

- [ ] **Step 2: Add the toggle handler**

Add after `onDeleteInvite` (after line 197):

```tsx
  async function onToggleDefaultGameMode(nextInviteOnly: boolean) {
    if (!club) return;
    setError(null);
    setGameModeBusy(true);
    const nextMode = nextInviteOnly ? 'invite_only' : 'open_play';
    const { error: toggleError } = await setDefaultGameMode(club.id, nextMode);
    setGameModeBusy(false);
    if (toggleError) {
      setError(toggleError);
      return;
    }
    setClub({ ...club, default_game_mode: nextMode });
  }
```

- [ ] **Step 3: Add the toggle to the organizer-only actions block**

In the JSX, inside the `{mayInvite ? (<> ... </>) : null}` block (lines 410–444), add the toggle right after the "Venues" button and before the closing `</>`:

```tsx
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/venues`)}
            accessibilityLabel="Venues"
          >
            Venues
          </Button>
          <View style={styles.gameModeRow}>
            <Text style={styles.help}>
              New games default to invite-only
            </Text>
            <Toggle
              value={club.default_game_mode === 'invite_only'}
              onValueChange={onToggleDefaultGameMode}
              disabled={gameModeBusy}
              accessibilityLabel="New games default to invite-only"
            />
          </View>
```

- [ ] **Step 4: Add the `gameModeRow` style**

In the `StyleSheet.create` block (after `inviteUrl` at line 529–533), add:

```tsx
  gameModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    marginTop: space[2],
  },
```

- [ ] **Step 5: Verify manually**

Run: `npx supabase start` (if not already running) then start the app per this project's own dev-server instructions, sign in as a host, open a club's management page, and confirm the toggle appears, flips, and persists across a reload (re-fetch `fetchClub` — its `default_game_mode` should reflect the new value).

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/index.tsx"
git commit -m "feat(ui): add the club-level default game mode toggle"
```

---

## Task 11: Create-event form override

**Files:**
- Modify: `app/clubs/[id]/events/new.tsx`

**Interfaces:**
- Consumes: `Club.default_game_mode`, `createEvent`/`createEventSeries` gain `gameMode` (Task 9).

- [ ] **Step 1: Add state, seeded from the club once it loads**

In `app/clubs/[id]/events/new.tsx`, add after `const [checkInRequired, setCheckInRequired] = useState(false);` (line 194):

```tsx
  const [gameMode, setGameMode] = useState<GameMode>('open_play');
```

Add `GameMode` to the `lib/clubs` import (line 14):

```tsx
import { fetchClub, type Club, type GameMode } from '../../../../lib/clubs';
```

Seed it once the club loads — change the `fetchClub` effect (lines 201–212):

```tsx
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchClub(clubId).then((result) => {
      if (cancelled) return;
      setClub(result);
      if (result) setGameMode(result.default_game_mode);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, session]);
```

- [ ] **Step 2: Pass it to both save calls**

In `onSave` (lines 273–333), add `gameMode` to the `createEvent` call (after `checkInRequired,` at line 291):

```tsx
        gameMode,
```

and to the `createEventSeries` call (after `checkInRequired,` at line 322):

```tsx
      gameMode,
```

- [ ] **Step 3: Add the Toggle to the form**

After the check-in `Toggle` block (lines 409–418), add:

```tsx
      <Text style={styles.label}>Invite-only</Text>
      <Toggle
        value={gameMode === 'invite_only'}
        onValueChange={(next) => setGameMode(next ? 'invite_only' : 'open_play')}
        accessibilityLabel="Invite-only"
      />
      <Text style={styles.help}>
        Turn this on and only people you invite can see or join this game.
        Off means any club member can join.
      </Text>
```

- [ ] **Step 4: Verify manually**

Run the app, open "Create a game" for a club whose default is invite-only, and confirm the toggle starts on; flip it and save; confirm the created event's `game_mode` matches (check via the event edit screen once Task 12 lands, or directly in the local database with `select game_mode from events order by created_at desc limit 1;`).

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/events/new.tsx"
git commit -m "feat(ui): add the per-game invite-only override to the create form"
```

---

## Task 12: Edit-event form override

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/edit.tsx`

**Interfaces:**
- Consumes: `ClubEvent.game_mode`, `EventSeries.game_mode`, `updateEvent`/`updateEventSeries` gain `gameMode` (Task 9).

- [ ] **Step 1: Add dual event/series state, mirroring `checkInRequired` exactly**

In `app/clubs/[id]/events/[eventId]/edit.tsx`, add alongside `const [eventCheckInRequired, setEventCheckInRequired] = useState(false);` (line 249):

```tsx
  const [eventGameMode, setEventGameMode] = useState<GameMode>('open_play');
```

and alongside `const [seriesCheckInRequired, setSeriesCheckInRequired] = useState(false);` (line 259):

```tsx
  const [seriesGameMode, setSeriesGameMode] = useState<GameMode>('open_play');
```

Import `GameMode` alongside this file's existing `lib/clubs`/`lib/events` imports (add `type GameMode` to whichever of those two imports already brings in `lib/clubs` types, or add `import type { GameMode } from '../../../../../lib/clubs';` if neither does).

- [ ] **Step 2: Seed both from their loaded rows**

Alongside `setEventCheckInRequired(loadedEvent.check_in_required);` (line 312):

```tsx
        setEventGameMode(loadedEvent.game_mode);
```

Alongside the `checkInRequired: loadedEvent.check_in_required,` snapshot into `original` (line 320):

```tsx
          gameMode: loadedEvent.game_mode,
```

Alongside `setSeriesCheckInRequired(loadedSeries.check_in_required);` (line 352):

```tsx
          setSeriesGameMode(loadedSeries.game_mode);
```

- [ ] **Step 3: Wire the scope-aware getter/setter**

Alongside lines 451–454:

```tsx
  const checkInRequired = isSeriesScope ? seriesCheckInRequired : eventCheckInRequired;
  const setCheckInRequired = isSeriesScope
    ? setSeriesCheckInRequired
    : setEventCheckInRequired;
```

add:

```tsx
  const gameMode = isSeriesScope ? seriesGameMode : eventGameMode;
  const setGameMode = isSeriesScope ? setSeriesGameMode : setEventGameMode;
```

- [ ] **Step 4: Thread it into the save handler**

Alongside `checkInRequired,` in the series-scope save call (near line 487):

```tsx
        gameMode,
```

Alongside the event-scope diffing logic (`checkInChanged`, near lines 508 and 522) — add the equivalent pair:

```tsx
        gameModeChanged !== undefined ? gameMode : undefined
```

Concretely, find the line `checkInChanged ? checkInRequired : null,` (line 522) and its companion boolean definition (`checkInChanged = ... !== original.checkInRequired`, line 508); add directly beside each:

```tsx
        gameModeChanged: gameMode !== original.gameMode,
```

(at the `checkInChanged` definition) and

```tsx
        gameMode: gameModeChanged ? gameMode : null,
```

(at the `updateEvent` call's argument list, alongside `checkInRequired: checkInChanged ? checkInRequired : null,`).

- [ ] **Step 5: Add the Toggle to the form**

Alongside the existing check-in toggle (near lines 618–619), add:

```tsx
      <Text style={styles.label}>Invite-only</Text>
      <Toggle
        value={gameMode === 'invite_only'}
        onValueChange={(next) => setGameMode(next ? 'invite_only' : 'open_play')}
        accessibilityLabel="Invite-only"
      />
```

- [ ] **Step 6: Verify manually**

Run the app; open an existing event's edit screen; confirm the toggle shows the event's current mode; flip and save for both the "just this game" and "the whole series" scopes; confirm future occurrences pick up a series-scope change (query `events` for that `series_id`) while a past/customised occurrence does not (matching `check_in_required`'s own already-verified behavior).

- [ ] **Step 7: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/edit.tsx"
git commit -m "feat(ui): add the per-game invite-only override to the edit form"
```

---

## Task 13: Join screen redirects to the tied event

**Files:**
- Modify: `app/join/[token].tsx`

**Interfaces:**
- Consumes: `acceptInvite`'s new `{ clubId, eventId, error }` shape (Task 9).

- [ ] **Step 1: Update the redirect**

In `app/join/[token].tsx`, change the `.then` callback (lines 82–93):

```tsx
    acceptInvite(token)
      .then(async ({ clubId, eventId, error: acceptError }) => {
        if (cancelled) return;
        await AsyncStorage.removeItem(PENDING_INVITE_KEY).catch((cause) => {
          console.error('Failed to clear pending invite', cause);
        });
        if (cancelled) return;
        if (acceptError || !clubId) {
          setError(acceptError ?? 'That invite link is no longer valid.');
          return;
        }
        if (eventId) {
          router.replace(`/clubs/${clubId}/events/${eventId}`);
        } else {
          router.replace(`/clubs/${clubId}`);
        }
      });
```

- [ ] **Step 2: Verify manually**

Create a game-tied invite (via Task 14's guest-invite button once it lands, or directly via `createInvite(clubId, undefined, eventId)` in a scratch script against local Supabase), open the resulting `/join/<token>` link signed out, sign in, and confirm the redirect lands on that event's own screen rather than the club page.

- [ ] **Step 3: Commit**

```bash
git add "app/join/[token].tsx"
git commit -m "feat(ui): redirect a redeemed game invite to its event"
```

---

## Task 14: "Invite" gating and the guest-invite action

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: `ClubEvent.game_mode`, `isOrganizer` (already computed in this file), `createInvite` (Task 9).

- [ ] **Step 1: Gate "Bring someone" → "Invite" on organizer status for invite-only games**

Change the `canBringSomeone` derivation (line 505):

```tsx
  const canBringSomeone =
    canBook && !rosterFailed && (event.game_mode === 'open_play' || isOrganizer);
```

Change the button's label and accessibility label at the call site (originally "Bring someone", per the earlier research at lines ~1041–1050):

```tsx
      {canBringSomeone ? (
        <Button
          variant="secondary"
          disabled={busy}
          onPress={openBringSomeone}
          accessibilityLabel="Invite"
        >
          Invite
        </Button>
      ) : null}
```

- [ ] **Step 2: Add guest-invite state**

Add alongside `const [inviteUrl, setInviteUrl] = useState<string | null>(null);`-equivalent state in this file — add fresh state (this file does not yet have an `inviteUrl`, unlike the club page):

```tsx
  const [guestInviteUrl, setGuestInviteUrl] = useState<string | null>(null);
```

Import `createInvite` and `Platform` (the latter is likely already imported for other reasons; if not, add it) alongside this file's existing `lib/clubs` import (`canInvite, fetchClub, fetchRoster`):

```tsx
import { canInvite, createInvite, fetchClub, fetchRoster } from '../../../../../lib/clubs';
```

- [ ] **Step 3: Add the handler**

Add near `onMessageMembers`-equivalent handlers in this file (or, if this file has no such precedent, alongside `bookSeat`):

```tsx
  async function onInviteGuest() {
    setError(null);
    if (Platform.OS !== 'web') {
      setError('Invite links can only be created from the web app for now.');
      return;
    }
    const { token, error: inviteError } = await createInvite(clubId, undefined, eventId);
    if (inviteError || !token) {
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    setGuestInviteUrl(`${window.location.origin}/join/${token}`);
  }
```

(`GENERIC_ERROR` is already imported in this file per the earlier research; `Platform` needs adding to the `react-native` import at the top if not already present.)

- [ ] **Step 4: Add the button and link card, organizer-only, regardless of game mode**

Add directly after the "Invite" button block from Step 1:

```tsx
      {isOrganizer ? (
        <Button
          variant="secondary"
          disabled={busy}
          onPress={onInviteGuest}
          accessibilityLabel="Invite a guest"
        >
          Invite a guest
        </Button>
      ) : null}

      {guestInviteUrl ? (
        <Card>
          <Text style={styles.help}>
            Share this link. It works for 30 days and seats them at this game.
          </Text>
          <Text style={styles.inviteUrl} selectable>
            {guestInviteUrl}
          </Text>
        </Card>
      ) : null}
```

Add an `inviteUrl` style matching the club page's own (find this file's `StyleSheet.create` block and add, mirroring `app/clubs/[id]/index.tsx`'s `inviteUrl` style):

```tsx
  inviteUrl: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
```

- [ ] **Step 5: Verify manually**

As an organizer, open an invite-only game with no other members yet invited; confirm "Invite" is visible (organizer sees it) while a second, non-organizer test account does NOT see "Invite" on that same game. Confirm "Invite a guest" is visible to the organizer on both open-play and invite-only games. Generate a guest link, open it in a private/incognito window, sign up as a brand-new account, and confirm you land seated at that game.

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx"
git commit -m "feat(ui): rename Bring someone to Invite and gate it for invite-only games"
```

---

## Task 15: Not-yet-placed invitee headcount view

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: `fetchEventAcceptedCount` (Task 9), `myBooking` (already computed in this file, line 454), `isOrganizer`.

- [ ] **Step 1: Add state and fetch the headcount alongside the rest of `load()`**

Add state near `const [seating, setSeating] = useState<SeatOccupant[]>([]);` (line 160):

```tsx
  const [acceptedCount, setAcceptedCount] = useState<number | null>(null);
```

Import `fetchEventAcceptedCount` alongside this file's existing `lib/bookings` import (the block importing `fetchEventSeating`, around line 32):

```tsx
  fetchEventAcceptedCount,
```

In `load()`, add `fetchEventAcceptedCount(eventId)` to the `Promise.all` array (alongside `fetchEventSeating(eventId)` at line 250) and destructure/store it:

```tsx
    const [
      loadedClub,
      loadedEvent,
      loadedTables,
      rosterRows,
      seatingRows,
      openOffer,
      myCheckInState,
      loadedRounds,
      headcount,
    ] = await Promise.all([
      fetchClub(clubId),
      fetchEvent(eventId),
      fetchEventTables(eventId),
      fetchRoster(clubId),
      fetchEventSeating(eventId),
      fetchOpenOffer(eventId),
      fetchMyCheckIn(eventId),
      fetchTableRounds(eventId),
      fetchEventAcceptedCount(eventId),
    ]);
```

and, alongside `setSeries(...)` near the end of `load()`:

```tsx
    setAcceptedCount(headcount);
```

- [ ] **Step 2: Compute the visibility gate**

Add near the `myBooking` derivation (after line 457, `const myHoldsSeat = myBooking !== undefined;`):

```tsx
  const canSeeFullRoster =
    event.game_mode === 'open_play' ||
    isOrganizer ||
    (myBooking?.event_table_id != null);
```

(This line must be placed after `event` is known non-null in this component's control flow — alongside the other derived values that already assume `event`, such as `canBook` at line 414.)

- [ ] **Step 3: Gate the tables section and add the headcount note**

Wrap the existing tables-rendering block (the `{tablesFailed ? (...) : tables.map(...)}` at lines 818–985) and the "Nobody has booked yet" block (lines 987–994) in the new gate:

```tsx
      {canSeeFullRoster ? (
        <>
          {tablesFailed ? (
            <Text style={styles.help}>Could not load the tables for this game.</Text>
          ) : (
            tables.map((table) => {
              /* ...unchanged body... */
            })
          )}

          {seatingFailed ? (
            <Text style={styles.help}>
              Could not load who is coming to this game.
            </Text>
          ) : !tablesFailed &&
            seating.filter((o) => o.status === 'confirmed').length === 0 ? (
            <Text style={styles.help}>Nobody has booked yet.</Text>
          ) : null}
        </>
      ) : (
        <Card>
          <Text style={styles.help}>
            {acceptedCount === null
              ? 'This is an invite-only game.'
              : `${acceptedCount} ${acceptedCount === 1 ? 'person has' : 'people have'} accepted.`}
            {' '}You won't see who else is playing until you're placed on a table.
          </Text>
        </Card>
      )}
```

- [ ] **Step 4: Verify manually**

As a plain invited-but-not-yet-placed member on a private game (booked via the organizer's "Invite" with "Any table" so they land waitlisted or unplaced, if the seeding scenario allows it — otherwise directly clear `event_table_id` on their booking row in the local database for the test), confirm the tables section is replaced by the headcount note and the note's number matches the real accepted count. Place them at a table (as the organizer) and confirm the full table view appears on their next load.

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx"
git commit -m "feat(ui): hide the full roster from a not-yet-placed invitee on invite-only games"
```

---

## Final Verification

- [ ] Run `npx supabase db reset && npx supabase test db --local` — every pgTAP test (existing and new) passes.
- [ ] Run `npm run test` — every Vitest test passes.
- [ ] Manually walk the full story end to end in the running app: create a club, flip its default to invite-only, create a game (confirm it inherits invite-only), confirm a second test account cannot see it at all, invite that account as an existing member via "Invite" (confirm they can now see and are seated), generate a guest link via "Invite a guest", redeem it as a brand-new account, confirm that account is now a club member and seated at the game, and confirm the not-yet-placed headcount note and its later reveal once seated.
- [ ] Invoke `superpowers:finishing-a-development-branch` to open the PR for `feat/invite-only-games` against `main`, per this project's standing branch-per-plan rule.
