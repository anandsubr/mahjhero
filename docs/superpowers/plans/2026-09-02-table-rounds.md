# Table Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer or any seated player log who won a hand at a table, with how many points, while a game is live; show the round-by-round log and each player's running total on that table's card; give the organizer sole delete rights; add a personal, unsynced countdown timer for pacing a round.

**Architecture:** One new table, `table_rounds`, keyed by `event_table_id`/`event_id`/`club_id` (the same denormalized composite-FK shape `bookings`/`check_ins` already use), written only through two `security definer` functions (`record_round`, `delete_round`) that share a guard-ladder helper (`assert_round_writable`). Reads are a plain RLS-scoped `select` — any club member can read, matching the seating screen's own audience — with no read-side function needed. Two new UI components (`RoundLog`, `RoundTimer`) render inside `TableCard`; the round timer is pure client-side `useState`/`setInterval`, never touching the database.

**Tech Stack:** Postgres 15 (Supabase), pgTAP for database tests, Expo/React Native with expo-router, TypeScript, Vitest + @testing-library/react for unit and component tests, Playwright for visual baselines.

**Spec:** [../specs/2026-09-02-table-rounds-design.md](../specs/2026-09-02-table-rounds-design.md)

## Global Constraints

- **Branch:** `feat/table-rounds`, already created off `main`. Never commit to `main`; this plan merges via a PR.
- **RLS does not protect a `security definer` function.** Every definer function's first real check is tenancy — `assert_round_writable` folds "no such table" and "not a club member" into one raise, exactly like `assert_attendance_writable`.
- **`authenticated` gets no DML on `table_rounds` at all.** Supabase grants ALL (including TRUNCATE, which ignores RLS) by default; the new table must be revoked and both new functions added to `supabase/tests/database/portable/grants.test.sql`, asserted in both directions.
- **Every `raise exception` message in a migration must have client-side copy or a justified allowlist entry.** `lib/bookings.test.ts` scans all migrations and fails on an unmapped message. Run `npm test` (not just `npm run test:db`) before every commit.
- **`npm test` must stay runnable with no Docker.** Suites needing the local stack skip with a warning unless `REQUIRE_LOCAL_SUPABASE=1`.
- **Errcodes:** `42501` for "no such thing / not permitted to know" (tenancy, role), `23514` for "refused by a rule" (game state, business validation).
- **Migration timestamps continue the existing sequence.** The last migration is `20260830050000`. This plan uses `20260902060000` upward.
- **Winner pool is confirmed seating only.** `record_round` re-derives "is this person currently seated at this table" from `bookings` at call time — never trust a client-supplied roster.
- **No edit, organizer-only delete, no time tail on delete.** Do not add a correction/edit path to `record_round` or a window check to `delete_round` — both are deliberate scope cuts in the spec.
- **The round timer is local UI state only.** No prop threading it out of `TableCard`, no persistence, no backend call of any kind.

---

## File Structure

**New migrations** (`supabase/migrations/`):

| File | Responsibility |
|---|---|
| `20260902060000_create_table_rounds.sql` | `table_rounds` table, indexes, RLS, grants |
| `20260902070000_table_rounds_mutations.sql` | `assert_round_writable`, `record_round`, `delete_round` |

**New database tests:**

| File | Responsibility |
|---|---|
| `supabase/tests/database/portable/table_rounds_schema.test.sql` | Table shape, RLS enabled, grants absence — no fixture users, runs hosted too |
| `supabase/tests/database/fixtures/table_rounds_rls.test.sql` | The club-member select policy, exercised across two clubs |
| `supabase/tests/database/fixtures/table_rounds_mutations.test.sql` | The full guard ladder for `record_round` and `delete_round` |

**New app files:**

| File | Responsibility |
|---|---|
| `lib/rounds.ts` | Types, `fetchTableRounds`, `recordRound`, `deleteRound`, `roundTotals` |
| `lib/rounds.test.ts` | Unit tests for the above |
| `components/RoundLog.tsx` | Round list, running totals, the record-a-round form, delete affordance |
| `components/__tests__/RoundLog.test.tsx` | Its tests |
| `components/RoundTimer.tsx` | The countdown |
| `components/__tests__/RoundTimer.test.tsx` | Its tests |

**Modified app files:** `lib/bookings.ts` (`BOOKING_REFUSALS` gains six entries), `components/TableCard.tsx` (renders `RoundLog` + `RoundTimer`), `components/__tests__/TableCard.test.tsx`, `app/clubs/[id]/events/[eventId]/index.tsx` (fetches rounds, computes who may record, wires handlers), `app/__tests__/events-detail.test.tsx`, `lib/schema-contract.test.ts`, `e2e/visual.spec.ts`, `supabase/tests/database/portable/grants.test.sql`.

---

## Task 1: The `table_rounds` table

**Files:**
- Create: `supabase/migrations/20260902060000_create_table_rounds.sql`
- Create: `supabase/tests/database/portable/table_rounds_schema.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql:6` (plan count) and end of file (one new TRUNCATE assertion)

**Interfaces:**
- Consumes: `public.is_club_member(uuid)` (`supabase/migrations/20260822033527_create_clubs.sql`), `public.event_tables` (composite unique `(id, event_id)`, `supabase/migrations/20260825000000_create_bookings.sql:54`), `public.events` (composite unique `(id, club_id)`).
- Produces: `public.table_rounds(id, event_table_id, event_id, club_id, winner_profile_id, points, recorded_by, created_at)`. Every later task depends on this table existing.

- [ ] **Step 1: Write the failing schema test**

Create `supabase/tests/database/portable/table_rounds_schema.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(10);

select has_table('public', 'table_rounds', 'table_rounds exists');

select has_column('public', 'table_rounds', 'event_table_id',    'has event_table_id');
select has_column('public', 'table_rounds', 'event_id',          'has event_id');
select has_column('public', 'table_rounds', 'club_id',           'has club_id');
select has_column('public', 'table_rounds', 'winner_profile_id', 'has winner_profile_id');
select has_column('public', 'table_rounds', 'points',            'has points');
select has_column('public', 'table_rounds', 'recorded_by',       'has recorded_by');
select has_column('public', 'table_rounds', 'created_at',        'has created_at');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.table_rounds'::regclass),
  'row level security is enabled on table_rounds'
);

-- The whole reason grants.test.sql exists: ALL includes TRUNCATE, which
-- ignores RLS entirely.
select ok(
  not has_table_privilege('authenticated', 'public.table_rounds', 'TRUNCATE'),
  'authenticated cannot TRUNCATE table_rounds'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase start` (if not already running), then `npm run test:db`
Expected: FAIL — `table_rounds` does not exist yet (`has_table` assertion fails, and every later assertion in the same file fails too since the table cannot be found).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260902060000_create_table_rounds.sql`:

```sql
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
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm run test:db`
Expected: PASS — all 10 assertions in `table_rounds_schema.test.sql` green.

- [ ] **Step 5: Add the TRUNCATE assertion to `grants.test.sql`**

In `supabase/tests/database/portable/grants.test.sql`, change line 6:

```sql
select plan(104);
```
to:
```sql
select plan(105);
```

Then append, immediately before the final `select * from finish();` / `rollback;`:

```sql

-- ---------------------------------------------------------------------------
-- Table rounds (2026-09-02 spec). table_rounds is select-only for
-- authenticated; the two write functions are asserted in the mutations
-- migration's own task.
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.table_rounds', 'TRUNCATE'),
  'authenticated cannot TRUNCATE table_rounds'
);
```

- [ ] **Step 6: Run the grants suite to verify it passes**

Run: `npm run test:db`
Expected: PASS — `grants.test.sql` now plans and reports 105/105.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260902060000_create_table_rounds.sql \
  supabase/tests/database/portable/table_rounds_schema.test.sql \
  supabase/tests/database/portable/grants.test.sql
git commit -m "feat(rounds): add the table_rounds table"
```

---

## Task 2: RLS — any club member reads, no other club, no direct writes

**Files:**
- Create: `supabase/tests/database/fixtures/table_rounds_rls.test.sql`

**Interfaces:**
- Consumes: `public.table_rounds` (Task 1).
- Produces: nothing new — this task only proves Task 1's policy holds under two different callers.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/table_rounds_rls.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(5);

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'host-a@example.com'),
  ('e0000000-0000-0000-0000-000000000002', 'member-a@example.com'),
  ('e0000000-0000-0000-0000-000000000003', 'host-b@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('f0000000-0000-0000-0000-000000000001', 'Club A', 'club-a',
   'America/New_York', 'e0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', 'Club B', 'club-b',
   'America/New_York', 'e0000000-0000-0000-0000-000000000003');

insert into public.club_members (club_id, profile_id, role, status) values
  ('f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('f0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000003', 'host', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by) values
  ('a1000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'Hall A',
   'e0000000-0000-0000-0000-000000000001');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           created_by) values
  ('a2000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'Club A Game',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'e0000000-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, position)
  values ('a3000000-0000-0000-0000-000000000001',
          'a2000000-0000-0000-0000-000000000001',
          'f0000000-0000-0000-0000-000000000001', 'Table 1', 1);

-- Written as the owner (elevated role, bypasses nothing that matters here —
-- this file tests the SELECT POLICY, not record_round's own guard ladder).
insert into public.table_rounds
  (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
values
  ('a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000002', 8,
   'e0000000-0000-0000-0000-000000000001');

-- A plain member of the same club reads it.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.table_rounds),
  1,
  'a member of the round''s own club can read it'
);

reset role;

-- The host of an unrelated club cannot see it at all.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.table_rounds),
  0,
  'a host of a different club reads nothing'
);

select throws_ok(
  $$insert into public.table_rounds
      (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
    values
      ('a3000000-0000-0000-0000-000000000001',
       'a2000000-0000-0000-0000-000000000001',
       'f0000000-0000-0000-0000-000000000001',
       'e0000000-0000-0000-0000-000000000003', 4,
       'e0000000-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'authenticated has no INSERT on table_rounds'
);

select throws_ok(
  $$update public.table_rounds set points = 99$$,
  '42501',
  null,
  'authenticated has no UPDATE on table_rounds'
);

select throws_ok(
  $$delete from public.table_rounds$$,
  '42501',
  null,
  'authenticated has no DELETE on table_rounds'
);

reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify the shape works**

Run: `npm run test:db`
Expected: PASS — Task 1's policy and grants already cover every case this file checks. (If this fails, it means Task 1's policy or grants are wrong, not this test.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/fixtures/table_rounds_rls.test.sql
git commit -m "test(rounds): cover table_rounds' club-member read policy"
```

---

## Task 3: `record_round` and `delete_round`

**Files:**
- Create: `supabase/migrations/20260902070000_table_rounds_mutations.sql`
- Create: `supabase/tests/database/fixtures/table_rounds_mutations.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`

**Interfaces:**
- Consumes: `public.is_club_member(uuid)`, `public.is_club_organizer(uuid)`, `public.assert_club_organizer(uuid)` (`supabase/migrations/20260822192000_create_venues.sql`), `public.bookings` (`event_table_id`, `profile_id`, `status`), `public.table_rounds` (Task 1).
- Produces: `public.record_round(target_table uuid, winner_profile uuid, target_points int) returns public.table_rounds`, `public.delete_round(target_round uuid) returns void`, both granted to `authenticated`. Every raise message below is consumed by Task 4's `lib/bookings.ts` changes.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/table_rounds_mutations.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(16);

-- ------------------------------------------------------------------
-- Fixture.
--   host (organizer), ann + bob (seated at Table 1 of the LIVE game),
--   carol (club member, not seated anywhere), dave (not a club member).
-- ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'host@example.com'),
  ('70000000-0000-0000-0000-000000000002', 'ann@example.com'),
  ('70000000-0000-0000-0000-000000000003', 'bob@example.com'),
  ('70000000-0000-0000-0000-000000000004', 'carol@example.com'),
  ('70000000-0000-0000-0000-000000000005', 'dave@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('80000000-0000-0000-0000-000000000001', 'Rounds Club',
          'rounds-club', 'America/New_York',
          '70000000-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000004', 'member', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by)
  values ('90000000-0000-0000-0000-000000000001',
          '80000000-0000-0000-0000-000000000001', 'The Hall',
          '70000000-0000-0000-0000-000000000001');

-- Four events: live, not-yet-started, already-ended, cancelled.
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           status, created_by) values
  ('a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Live',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Not Started',
   '90000000-0000-0000-0000-000000000001',
   now() + interval '1 hour', now() + interval '3 hours',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000003',
   '80000000-0000-0000-0000-000000000001', 'Ended',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '3 hours', now() - interval '1 hour',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000004',
   '80000000-0000-0000-0000-000000000001', 'Cancelled',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'cancelled', '70000000-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000003',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000004',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1);

-- ann and bob are confirmed at the LIVE game's table.
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003');

insert into public.bookings (group_id, event_id, club_id, event_table_id,
                             profile_id, booked_by, status) values
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002',
   '70000000-0000-0000-0000-000000000002', 'confirmed'),
  ('c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003',
   '70000000-0000-0000-0000-000000000003', 'confirmed');

-- ------------------------------------------------------------------
-- Tenancy.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '42501',
  null,
  'a non-member is refused before anything about the table is revealed'
);

-- ------------------------------------------------------------------
-- Game-state guards. The organizer always passes the authorization rung,
-- so these isolate the state check alone.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'this game has not started yet',
  'a game that has not started refuses'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000003',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'this game has already ended',
  'a game that has ended refuses'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000004',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'event not bookable',
  'a cancelled game refuses'
);

-- ------------------------------------------------------------------
-- The authorization split: organizer or a seated occupant, nobody else.
-- ------------------------------------------------------------------
select lives_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  'the organizer records a round for bob'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 5)$$,
  'ann, seated at the table, records a round for bob too'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 5)$$,
  '42501',
  'only an organizer or a player at this table can record a round',
  'carol, a club member but not seated here, is refused'
);

reset role;
select is(
  (select count(*)::int from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'),
  2,
  'two rounds accumulated at the table -- a log, not a single result'
);

-- ------------------------------------------------------------------
-- Winner and points validation.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000004', 5)$$,
  '23514',
  'the winner is not seated at this table',
  'carol cannot be recorded as the winner -- she has no seat here'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 0)$$,
  '23514',
  'points must be greater than zero',
  'zero points is refused'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', -3)$$,
  '23514',
  'points must be greater than zero',
  'negative points is refused'
);

reset role;

select is(
  (select winner_profile_id from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'
     order by created_at asc limit 1)::text,
  '70000000-0000-0000-0000-000000000003',
  'the first recorded round names bob as the winner'
);

-- ------------------------------------------------------------------
-- delete_round: organizer-only, tenancy-hidden, no time restriction.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  '42501',
  'no such round',
  'a non-member is refused, and the message hides whether it exists'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  '42501',
  'not an organizer of this club',
  'ann, who recorded a round herself, still cannot delete -- organizer only'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  'the organizer deletes a round'
);

reset role;

select is(
  (select count(*)::int from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'),
  1,
  'exactly one round remains after the delete'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db`
Expected: FAIL — `record_round`/`delete_round` do not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260902070000_table_rounds_mutations.sql`:

```sql
/*
 * Recording who won a hand.
 *
 * assert_round_writable is the one ladder rung both record_round and
 * delete_round would otherwise duplicate for TENANCY AND GAME STATE --
 * delete_round deliberately does NOT call it, though: Decision 5/spec
 * "Risks" note that delete carries no live-game requirement at all, on
 * purpose (an organizer fixing a mis-recorded round after the fact is
 * legitimate; there is no "the game must still be happening" reason to
 * refuse it the way there is for a fresh recording).
 */
create function public.assert_round_writable(target_table uuid)
returns public.event_tables
language plpgsql
stable
set search_path = public
as $$
declare
  tbl public.event_tables;
  ev  public.events;
begin
  select * into tbl from public.event_tables where id = target_table;

  -- Tenancy first, folded into the same raise as "does not exist" -- an
  -- outsider holding a guessed uuid learns nothing more than a stranger
  -- guessing at random. Same shape assert_event_bookable and
  -- assert_attendance_writable already use.
  if tbl.id is null or not public.is_club_member(tbl.club_id) then
    raise exception 'no such table' using errcode = '42501';
  end if;

  select * into ev from public.events where id = tbl.event_id;

  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;

  -- The opposite of plan 4's booking freeze on purpose: a round belongs to
  -- the session that is actually happening, not to a game that has not
  -- started or one being rewritten after the fact.
  if ev.starts_at > now() then
    raise exception 'this game has not started yet' using errcode = '23514';
  end if;

  if ev.ends_at <= now() then
    raise exception 'this game has already ended' using errcode = '23514';
  end if;

  return tbl;
end;
$$;

revoke execute on function public.assert_round_writable(uuid)
  from public, anon, authenticated;

create function public.record_round(
  target_table   uuid,
  winner_profile uuid,
  target_points  int
)
returns public.table_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  tbl       public.event_tables;
  caller    uuid := auth.uid();
  organizer boolean;
  round     public.table_rounds;
begin
  tbl := public.assert_round_writable(target_table);
  organizer := public.is_club_organizer(tbl.club_id);

  -- Either role, never neither -- neither role alone is reliably the one
  -- holding the phone at a casual table.
  if not organizer and not exists (
    select 1 from public.bookings b
     where b.event_table_id = target_table
       and b.profile_id = caller
       and b.status = 'confirmed')
  then
    raise exception 'only an organizer or a player at this table can record a round'
      using errcode = '42501';
  end if;

  -- The winner has to be seated at THIS table right now -- re-derived from
  -- bookings, never trusted from the client, the same "ask the current
  -- state" pattern place_booking uses for its own seat checks.
  if not exists (
    select 1 from public.bookings b
     where b.event_table_id = target_table
       and b.profile_id = winner_profile
       and b.status = 'confirmed')
  then
    raise exception 'the winner is not seated at this table' using errcode = '23514';
  end if;

  -- Belt-and-suspenders alongside table_rounds' own check constraint --
  -- the constraint is what actually stops a bad row; this raises the
  -- friendlier, mapped message.
  if target_points <= 0 then
    raise exception 'points must be greater than zero' using errcode = '23514';
  end if;

  insert into public.table_rounds
    (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
  values
    (target_table, tbl.event_id, tbl.club_id, winner_profile, target_points, caller)
  returning * into round;

  return round;
end;
$$;

create function public.delete_round(target_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rnd public.table_rounds;
begin
  select * into rnd from public.table_rounds where id = target_round;

  if rnd.id is null or not public.is_club_member(rnd.club_id) then
    raise exception 'no such round' using errcode = '42501';
  end if;

  -- Organizer only -- not the round's own recorder. There is no
  -- self-correction case here: a player recording someone else's round has
  -- nothing of "their own" to undo, and giving every recorder delete
  -- rights over a shared, everybody-can-see-it log invites exactly the
  -- dispute the spec avoids by not offering edit at all.
  perform public.assert_club_organizer(rnd.club_id);

  delete from public.table_rounds where id = target_round;
end;
$$;

revoke execute on function public.record_round(uuid, uuid, int)
  from public, anon;
grant execute on function public.record_round(uuid, uuid, int)
  to authenticated;

revoke execute on function public.delete_round(uuid) from public, anon;
grant execute on function public.delete_round(uuid) to authenticated;
```

- [ ] **Step 4: Run the fixtures test to verify it passes**

Run: `npm run test:db`
Expected: PASS — all 16 assertions in `table_rounds_mutations.test.sql` green.

- [ ] **Step 5: Add grants coverage**

In `supabase/tests/database/portable/grants.test.sql`, change:
```sql
select plan(105);
```
to:
```sql
select plan(110);
```

Append, after the `table_rounds` TRUNCATE assertion Task 1 added:

```sql

-- record_round and delete_round are table_rounds' only writers.
-- assert_round_writable is the internal ladder rung both would otherwise
-- duplicate for record_round's own tenancy/state check; it is granted to
-- nobody and gets a named negative assertion here, the same treatment
-- assert_attendance_writable already got.

select ok(
  has_function_privilege(
    'authenticated', 'public.record_round(uuid, uuid, int)', 'EXECUTE'),
  'authenticated can execute record_round'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.delete_round(uuid)', 'EXECUTE'),
  'authenticated can execute delete_round'
);
select ok(
  not has_function_privilege(
    'anon', 'public.record_round(uuid, uuid, int)', 'EXECUTE'),
  'anon cannot execute record_round'
);
select ok(
  not has_function_privilege(
    'anon', 'public.delete_round(uuid)', 'EXECUTE'),
  'anon cannot execute delete_round'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.assert_round_writable(uuid)', 'EXECUTE'),
  'authenticated cannot execute assert_round_writable directly'
);
```

- [ ] **Step 6: Run the grants suite to verify it passes**

Run: `npm run test:db`
Expected: PASS — `grants.test.sql` reports 110/110.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260902070000_table_rounds_mutations.sql \
  supabase/tests/database/fixtures/table_rounds_mutations.test.sql \
  supabase/tests/database/portable/grants.test.sql
git commit -m "feat(rounds): add record_round and delete_round"
```

---

## Task 4: Client-side refusal copy

**Files:**
- Modify: `lib/bookings.ts` (the `BOOKING_REFUSALS` array, around line 136)

**Interfaces:**
- Consumes: the exact raise-message strings from Task 3's migration.
- Produces: friendly copy for `bookingErrorMessage`, which `lib/rounds.ts` (Task 5) imports and calls exactly like `lib/attendance.ts` already does.

- [ ] **Step 1: Run the self-audit to see it fail**

Run: `npm test -- lib/bookings.test.ts`
Expected: FAIL — the `'maps, or explicitly allowlists, every message the migrations raise'` test lists the six new unmapped strings from Task 3's migration: `this game has not started yet`, `this game has already ended`, `only an organizer or a player at this table can record a round`, `the winner is not seated at this table`, `points must be greater than zero`, `no such round`.

- [ ] **Step 2: Add the six entries**

In `lib/bookings.ts`, inside the `BOOKING_REFUSALS` array (immediately after the `'no such event'` entry, around line 216), add:

```ts
  {
    contains: 'this game has not started yet',
    message: "This game hasn't started yet.",
    codes: ['23514'],
  },
  {
    contains: 'this game has already ended',
    message: 'This game has already ended.',
    codes: ['23514'],
  },
  {
    contains: 'only an organizer or a player at this table can record a round',
    message: 'Only an organizer or someone seated at this table can record a round.',
    codes: ['42501'],
  },
  {
    contains: 'the winner is not seated at this table',
    message: "The winner isn't seated at this table anymore.",
    codes: ['23514'],
  },
  {
    contains: 'points must be greater than zero',
    message: 'Points must be a positive number.',
    codes: ['23514'],
  },
  {
    contains: 'no such round',
    message: 'That round no longer exists.',
    codes: ['42501'],
  },
```

- [ ] **Step 3: Run the self-audit and the full bookings suite to verify it passes**

Run: `npm test -- lib/bookings.test.ts`
Expected: PASS — all three `BOOKING_REFUSALS (self-audit against the migrations)` tests green, along with everything else in the file.

- [ ] **Step 4: Commit**

```bash
git add lib/bookings.ts
git commit -m "fix(rounds): map table_rounds' refusals to friendly copy"
```

---

## Task 5: `lib/rounds.ts`

**Files:**
- Create: `lib/rounds.ts`
- Create: `lib/rounds.test.ts`

**Interfaces:**
- Consumes: `supabase` (`lib/supabase.ts`), `bookingErrorMessage` + `RpcError` shape (`lib/bookings.ts`), `GENERIC_ERROR` (`lib/constants.ts`).
- Produces:
  - `type TableRound = { id: string; event_table_id: string; winner_profile_id: string; points: number; recorded_by: string; created_at: string }`
  - `fetchTableRounds(eventId: string): Promise<TableRound[] | null>`
  - `recordRound(input: { tableId: string; winnerProfileId: string; points: number }): Promise<{ round: TableRound | null; error: string | null }>`
  - `deleteRound(roundId: string): Promise<{ error: string | null }>`
  - `roundTotals(rounds: TableRound[]): { profileId: string; points: number }[]`
  Task 6 (`RoundLog`) and Task 9 (event screen) both import all four.

- [ ] **Step 1: Write the failing tests**

Create `lib/rounds.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
// fetchTableRounds' read path is
// `.from('table_rounds').select(...).eq('event_id', id).order('created_at', ...)`
// -- the same eq-then-terminal shape lib/events.test.ts's singleAfterSelect
// models, with `order` as the terminal call instead of `single`.
const orderAfterEq = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: orderAfterEq })),
      })),
    })),
  },
}));

import {
  deleteRound,
  fetchTableRounds,
  recordRound,
  roundTotals,
  type TableRound,
} from './rounds';
import { GENERIC_ERROR } from './constants';

beforeEach(() => {
  rpc.mockReset();
  orderAfterEq.mockReset();
});

function round(over: Partial<TableRound> = {}): TableRound {
  return {
    id: 'r1',
    event_table_id: 't1',
    winner_profile_id: 'p1',
    points: 8,
    recorded_by: 'p1',
    created_at: '2026-09-02T20:00:00Z',
    ...over,
  };
}

describe('fetchTableRounds', () => {
  it('returns the rows on success', async () => {
    orderAfterEq.mockResolvedValue({ data: [round()], error: null });
    const result = await fetchTableRounds('event-1');
    expect(result).toEqual([round()]);
  });

  it('returns null on a failed read', async () => {
    orderAfterEq.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    const result = await fetchTableRounds('event-1');
    expect(result).toBeNull();
  });

  it('returns an empty array, not null, when there are no rounds yet', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    const result = await fetchTableRounds('event-1');
    expect(result).toEqual([]);
  });
});

describe('recordRound', () => {
  it('returns the inserted round on success', async () => {
    rpc.mockResolvedValue({ data: round(), error: null });
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 8,
    });
    expect(rpc).toHaveBeenCalledWith('record_round', {
      target_table: 't1',
      winner_profile: 'p1',
      target_points: 8,
    });
    expect(result).toEqual(round());
    expect(error).toBeNull();
  });

  it('maps a refused write to friendly copy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'points must be greater than zero', code: '23514' },
    });
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 0,
    });
    expect(result).toBeNull();
    expect(error).toBe('Points must be a positive number.');
  });

  it('reports the generic error on an unexpected throw', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 8,
    });
    expect(result).toBeNull();
    expect(error).toBe(GENERIC_ERROR);
  });
});

describe('deleteRound', () => {
  it('resolves with no error on success', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { error } = await deleteRound('r1');
    expect(rpc).toHaveBeenCalledWith('delete_round', { target_round: 'r1' });
    expect(error).toBeNull();
  });

  it('maps a refusal to friendly copy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'not an organizer of this club', code: '42501' },
    });
    const { error } = await deleteRound('r1');
    expect(error).toBe('Only a club organizer can do that.');
  });
});

describe('roundTotals', () => {
  it('sums points per winner', () => {
    const rounds = [
      round({ id: 'r1', winner_profile_id: 'p1', points: 8 }),
      round({ id: 'r2', winner_profile_id: 'p2', points: 5 }),
      round({ id: 'r3', winner_profile_id: 'p1', points: 3 }),
    ];
    expect(roundTotals(rounds)).toEqual([
      { profileId: 'p1', points: 11 },
      { profileId: 'p2', points: 5 },
    ]);
  });

  it('returns an empty array for an empty log', () => {
    expect(roundTotals([])).toEqual([]);
  });

  it('orders by first appearance, not by point total', () => {
    const rounds = [
      round({ id: 'r1', winner_profile_id: 'p2', points: 1 }),
      round({ id: 'r2', winner_profile_id: 'p1', points: 100 }),
    ];
    expect(roundTotals(rounds).map((t) => t.profileId)).toEqual(['p2', 'p1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/rounds.test.ts`
Expected: FAIL — `lib/rounds.ts` does not exist yet (module not found).

- [ ] **Step 3: Write `lib/rounds.ts`**

```ts
import { bookingErrorMessage } from './bookings';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type TableRound = {
  id: string;
  event_table_id: string;
  winner_profile_id: string;
  points: number;
  recorded_by: string;
  created_at: string;
};

/**
 * Every round across an event's tables, newest first. Fetched per-event
 * (not per-table) because the event screen already loads once per event
 * and TableCard filters to its own `event_table_id` client-side, the same
 * pattern `seating`/`tableOccupants` already use one level up.
 *
 * A plain RLS-scoped select, not an RPC: `table_rounds_select_member`
 * (20260902060000) is exactly the audience this needs -- any club member
 * -- so there is no organizer-only asymmetry the way `check_ins` has, and
 * no name-resolution to do server-side either (winner display names are
 * joined against the roster the event screen already fetches).
 */
export async function fetchTableRounds(
  eventId: string,
): Promise<TableRound[] | null> {
  try {
    const { data, error } = await supabase
      .from('table_rounds')
      .select('id, event_table_id, winner_profile_id, points, recorded_by, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchTableRounds failed', error);
      return null;
    }
    return (data ?? []) as TableRound[];
  } catch (cause) {
    console.error('fetchTableRounds failed', cause);
    return null;
  }
}

export async function recordRound(input: {
  tableId: string;
  winnerProfileId: string;
  points: number;
}): Promise<{ round: TableRound | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('record_round', {
      target_table: input.tableId,
      winner_profile: input.winnerProfileId,
      target_points: input.points,
    });
    if (error) {
      console.error('recordRound failed', error);
      return { round: null, error: bookingErrorMessage(error) };
    }
    return { round: data as TableRound, error: null };
  } catch (cause) {
    console.error('recordRound failed', cause);
    return { round: null, error: GENERIC_ERROR };
  }
}

export async function deleteRound(
  roundId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('delete_round', {
      target_round: roundId,
    });
    if (error) {
      console.error('deleteRound failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('deleteRound failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * Sums points per winner, in first-seen order (the order they appear in
 * `rounds`, not sorted by total) -- the running-totals line on a table
 * card. Pure, no I/O, so unlike the three functions above this needs no
 * supabase double to test.
 */
export function roundTotals(
  rounds: TableRound[],
): { profileId: string; points: number }[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const r of rounds) {
    if (!totals.has(r.winner_profile_id)) {
      order.push(r.winner_profile_id);
      totals.set(r.winner_profile_id, 0);
    }
    totals.set(r.winner_profile_id, totals.get(r.winner_profile_id)! + r.points);
  }
  return order.map((profileId) => ({ profileId, points: totals.get(profileId)! }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/rounds.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/rounds.ts lib/rounds.test.ts
git commit -m "feat(rounds): add lib/rounds.ts"
```

---

## Task 6: `RoundLog` component

**Files:**
- Create: `components/RoundLog.tsx`
- Create: `components/__tests__/RoundLog.test.tsx`

**Interfaces:**
- Consumes: `space`, `type`, `colors`, `radius` (`lib/theme.ts`), `Button` (`components/Button.tsx`), `TextField` (`components/TextField.tsx`).
- Produces:
  ```ts
  export type DisplayRound = {
    id: string;
    winner_profile_id: string;
    winner_name: string;
    points: number;
  };
  export type RoundPlayer = { profileId: string; name: string };
  type Props = {
    rounds: DisplayRound[];      // newest first
    players: RoundPlayer[];      // this table's currently confirmed occupants
    canRecord: boolean;
    canDelete: boolean;
    busy?: boolean;
    onRecord: (winnerProfileId: string, points: number) => void;
    onDelete: (roundId: string) => void;
  };
  export default function RoundLog(props: Props): JSX.Element
  ```
  Task 8 (`TableCard`) renders this with `players` derived from its own `occupants` prop and `rounds` handed down pre-joined by the event screen (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/RoundLog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoundLog from '../RoundLog';

const players = [
  { profileId: 'p1', name: 'Ann' },
  { profileId: 'p2', name: 'You' },
];

const rounds = [
  { id: 'r2', winner_profile_id: 'p2', winner_name: 'You', points: 5 },
  { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ann', points: 8 },
];

describe('RoundLog', () => {
  it('says nothing has been recorded yet when the log is empty', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('lists rounds newest first with the winner and points', () => {
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('You · 5 pts')).toBeTruthy();
    expect(screen.getByText('Ann · 8 pts')).toBeTruthy();
  });

  it('shows a running total per player', () => {
    render(
      <RoundLog
        rounds={[
          ...rounds,
          { id: 'r3', winner_profile_id: 'p1', winner_name: 'Ann', points: 2 },
        ]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Ann: 10 · You: 5')).toBeTruthy();
  });

  it('hides the record form when canRecord is false', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Record a round')).toBeNull();
  });

  it('records a round for the tapped winner with the entered points', () => {
    const onRecord = vi.fn();
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord
        canDelete={false}
        onRecord={onRecord}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Winner: Ann' }));
    fireEvent.change(screen.getByLabelText('Points'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record a round' }));

    expect(onRecord).toHaveBeenCalledWith('p1', 8);
  });

  it('disables the record button until a winner and valid points are set', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Record a round' }),
    ).toHaveProperty('disabled', true);
  });

  it('shows delete affordances only when canDelete is true', () => {
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: "Delete You's round for 5 points" }),
    ).toBeTruthy();
  });

  it('calls onDelete with the round id', () => {
    const onDelete = vi.fn();
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete
        onRecord={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: "Delete You's round for 5 points" }),
    );
    expect(onDelete).toHaveBeenCalledWith('r2');
  });

  it('explains why recording is unavailable when nobody is seated yet', () => {
    render(
      <RoundLog
        rounds={[]}
        players={[]}
        canRecord
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Seat players before recording a round.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Points')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/RoundLog.test.tsx`
Expected: FAIL — `components/RoundLog.tsx` does not exist yet.

- [ ] **Step 3: Write `components/RoundLog.tsx`**

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import TextField from './TextField';
import { roundTotals } from '../lib/rounds';
import { colors, radius, space, type } from '../lib/theme';

export type DisplayRound = {
  id: string;
  winner_profile_id: string;
  winner_name: string;
  points: number;
};

export type RoundPlayer = { profileId: string; name: string };

type Props = {
  /** Newest first. */
  rounds: DisplayRound[];
  /** This table's currently confirmed occupants -- the winner pool. */
  players: RoundPlayer[];
  canRecord: boolean;
  canDelete: boolean;
  busy?: boolean;
  onRecord: (winnerProfileId: string, points: number) => void;
  onDelete: (roundId: string) => void;
};

/**
 * A table's round-by-round log: who won each hand, a running total per
 * player, and -- gated separately, per the spec's "both roles can record,
 * organizer only deletes" split -- the record form and delete affordances.
 *
 * Totals are computed here from `rounds` via `roundTotals`
 * (lib/rounds.ts), not stored: a derived sum cannot drift from the rows it
 * sums, the same call `booking_groups` made dropping a stored `size`.
 *
 * The record form's own `selectedWinner`/`pointsText` are local state,
 * cleared immediately after calling `onRecord` -- optimistic, not waiting
 * for the parent's reload, the same shape the event screen's own
 * `pendingTier`/`waitlistNote` already use for other in-flight forms.
 */
export default function RoundLog({
  rounds,
  players,
  canRecord,
  canDelete,
  busy = false,
  onRecord,
  onDelete,
}: Props) {
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [pointsText, setPointsText] = useState('');

  const totals = roundTotals(rounds);
  const totalsByPlayer = new Map(players.map((p) => [p.profileId, p.name]));
  const totalsLine = totals
    .map((t) => `${totalsByPlayer.get(t.profileId) ?? '?'}: ${t.points}`)
    .join(' · ');

  const parsedPoints = Number.parseInt(pointsText, 10);
  const validPoints = Number.isInteger(parsedPoints) && parsedPoints > 0;
  const canSubmit = canRecord && selectedWinner !== null && validPoints && !busy;

  function submit() {
    if (!canSubmit || selectedWinner === null) return;
    onRecord(selectedWinner, parsedPoints);
    setSelectedWinner(null);
    setPointsText('');
  }

  return (
    <View style={styles.wrap}>
      {totals.length > 0 ? <Text style={styles.totals}>{totalsLine}</Text> : null}

      {rounds.length === 0 ? (
        <Text style={styles.help}>No rounds recorded yet.</Text>
      ) : (
        rounds.map((round) => (
          <View key={round.id} style={styles.row}>
            <Text style={styles.roundText}>
              {round.winner_name} · {round.points} pts
            </Text>
            {canDelete ? (
              <Button
                variant="ghost"
                big={false}
                disabled={busy}
                onPress={() => onDelete(round.id)}
                accessibilityLabel={`Delete ${round.winner_name}'s round for ${round.points} points`}
              >
                Delete
              </Button>
            ) : null}
          </View>
        ))
      )}

      {canRecord ? (
        <View style={styles.form}>
          <Text style={styles.formLabel}>Record a round</Text>
          {players.length === 0 ? (
            // A table nobody is seated at yet has no winner pool -- the
            // server would refuse every winner as "not seated at this
            // table" anyway. Naming this explicitly (spec's Risks #2)
            // keeps an empty table from reading as the feature being
            // broken.
            <Text style={styles.help}>Seat players before recording a round.</Text>
          ) : (
            <>
              <View style={styles.pickerRow}>
                {players.map((player) => {
                  const selected = player.profileId === selectedWinner;
                  return (
                    <Pressable
                      key={player.profileId}
                      onPress={() => setSelectedWinner(player.profileId)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Winner: ${player.name}`}
                      aria-selected={selected}
                      aria-disabled={busy}
                      style={[
                        styles.pill,
                        selected ? styles.pillSelected : styles.pillUnselected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          selected ? styles.pillTextSelected : null,
                        ]}
                      >
                        {player.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextField
                label="Points"
                value={pointsText}
                onChangeText={setPointsText}
                keyboardType="number-pad"
                editable={!busy}
              />
              <Button
                disabled={!canSubmit}
                onPress={submit}
                accessibilityLabel="Record a round"
              >
                Record a round
              </Button>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
    marginTop: space[3],
  },
  totals: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  roundText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  form: {
    gap: space[2],
    marginTop: space[2],
  },
  formLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pill: {
    borderRadius: radius.pill,
    minHeight: 44,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillSelected: {
    backgroundColor: colors.accentColor,
    borderColor: 'transparent',
  },
  pillUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  pillText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  pillTextSelected: {
    color: colors.bg,
  },
});
```

Move the `import { roundTotals } from '../lib/rounds';` line to the top of the file with the other imports (it is written mid-file above only to keep this step's diff easy to read against the props/JSX it supports — the actual file must have all imports at the top, matching every other file in this codebase).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/RoundLog.test.tsx`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/RoundLog.tsx components/__tests__/RoundLog.test.tsx
git commit -m "feat(rounds): add RoundLog"
```

---

## Task 7: `RoundTimer` component

**Files:**
- Create: `components/RoundTimer.tsx`
- Create: `components/__tests__/RoundTimer.test.tsx`

**Interfaces:**
- Consumes: `Button` (`components/Button.tsx`), `space`/`type`/`colors` (`lib/theme.ts`).
- Produces: `export default function RoundTimer({ tableLabel: string }): JSX.Element` — no other props, and nothing it renders reaches outside this component (Task 8 mounts it with no state threaded through `TableCard`).

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/RoundTimer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoundTimer from '../RoundTimer';

describe('RoundTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers a duration picker before it is started', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    expect(
      screen.getByRole('button', {
        name: 'Start a 15-minute timer for Table 1',
      }),
    ).toBeTruthy();
  });

  it('counts down once started', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );
    expect(screen.getByText('15:00')).toBeTruthy();

    vi.advanceTimersByTime(60_000);
    expect(screen.getByText('14:00')).toBeTruthy();
  });

  it('says time is up at zero, not a negative number', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );

    vi.advanceTimersByTime(10 * 60_000);
    expect(screen.getByText("Time's up")).toBeTruthy();
    expect(screen.queryByText('0:00')).toBeNull();

    // A tick past zero does not go negative.
    vi.advanceTimersByTime(1_000);
    expect(screen.getByText("Time's up")).toBeTruthy();
  });

  it('resets back to the duration picker', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
    expect(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/RoundTimer.test.tsx`
Expected: FAIL — `components/RoundTimer.tsx` does not exist yet.

- [ ] **Step 3: Write `components/RoundTimer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { colors, space, type } from '../lib/theme';

const DURATIONS_MINUTES = [10, 15, 20, 30];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * A personal, per-table pacing clock -- confirmed during brainstorming to
 * be a countdown from a chosen duration, not a synced table-wide clock.
 * Purely local `useState`/`setInterval`: nothing here is persisted, and
 * nothing outside this component ever learns it exists. Resets on its own
 * whenever the component unmounts (a table's card leaving the screen), and
 * takes no props but `tableLabel`, used only to build each duration
 * option's accessibility label.
 */
export default function RoundTimer({ tableLabel }: { tableLabel: string }) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // One interval per `durationMinutes` change (start or reset), not one
  // per tick -- decrementing via the functional setState form below means
  // this effect does not need `secondsLeft` in its own dependency array.
  useEffect(() => {
    if (durationMinutes === null) return;
    const id = setInterval(() => {
      setSecondsLeft((current) => {
        if (current === null || current <= 1) {
          clearInterval(id);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [durationMinutes]);

  function start(minutes: number) {
    setDurationMinutes(minutes);
    setSecondsLeft(minutes * 60);
  }

  function reset() {
    setDurationMinutes(null);
    setSecondsLeft(null);
  }

  if (secondsLeft === null) {
    return (
      <View style={styles.row}>
        {DURATIONS_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            variant="secondary"
            big={false}
            onPress={() => start(minutes)}
            accessibilityLabel={`Start a ${minutes}-minute timer for ${tableLabel}`}
          >
            {`${minutes} min`}
          </Button>
        ))}
      </View>
    );
  }

  const expired = secondsLeft === 0;

  return (
    <View style={styles.row}>
      <Text style={[styles.clock, expired ? styles.expired : null]}>
        {expired ? "Time's up" : formatClock(secondsLeft)}
      </Text>
      <Button
        variant="ghost"
        big={false}
        onPress={reset}
        accessibilityLabel={expired ? 'Reset timer' : 'Stop timer'}
      >
        {expired ? 'Reset timer' : 'Stop timer'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  clock: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  expired: {
    color: colors.accent[700],
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/RoundTimer.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/RoundTimer.tsx components/__tests__/RoundTimer.test.tsx
git commit -m "feat(rounds): add RoundTimer"
```

---

## Task 8: Wire `RoundLog` and `RoundTimer` into `TableCard`

**Files:**
- Modify: `components/TableCard.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`

**Interfaces:**
- Consumes: `RoundLog`/`DisplayRound`/`RoundPlayer` (Task 6), `RoundTimer` (Task 7).
- Produces: `TableCard` grows four new optional props —
  ```ts
  rounds?: DisplayRound[];
  canRecordRound?: boolean;
  canDeleteRound?: boolean;
  onRecordRound?: (winnerProfileId: string, points: number) => void;
  onDeleteRound?: (roundId: string) => void;
  ```
  — consumed by Task 9's event screen. `rounds === undefined` omits the whole rounds section, matching every other optional-bundle prop this component already has (`otherTables`/`onMove`/`onRemove`).

- [ ] **Step 1: Write the failing tests**

Add to `components/__tests__/TableCard.test.tsx` (inside the existing `describe('TableCard', ...)` block, after the last existing `it`):

```tsx
  it('omits the rounds section when rounds is not supplied', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.queryByText('No rounds recorded yet.')).toBeNull();
  });

  it('shows the round log when rounds is supplied', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 8 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByText('Ravi K. · 8 pts')).toBeTruthy();
  });

  it('offers the record form only when canRecordRound is true', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[]}
        canRecordRound
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Winner: Ravi K.' })).toBeTruthy();
  });

  it('offers a round timer', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Start a 15-minute timer for Table 2',
      }),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/TableCard.test.tsx`
Expected: FAIL — `TableCard` does not accept or render `rounds` yet.

- [ ] **Step 3: Wire the two components into `TableCard.tsx`**

Add imports near the top of `components/TableCard.tsx` (alongside the existing `SeatGrid`/`SkillTierPips`/`Tag` imports):

```tsx
import RoundLog, { type DisplayRound } from './RoundLog';
import RoundTimer from './RoundTimer';
```

Extend the `Props` type (after the existing `onToggleManage` field):

```tsx
  /**
   * Round recording -- omitted entirely (not merely gated false) hides the
   * whole section, matching `otherTables`/`onMove`/`onRemove`'s own
   * all-or-nothing bundle above. Supplied by the event screen with rounds
   * already joined against the roster for display names (see RoundLog's
   * own docstring for why TableCard never resolves ids to names itself).
   */
  rounds?: DisplayRound[];
  canRecordRound?: boolean;
  canDeleteRound?: boolean;
  onRecordRound?: (winnerProfileId: string, points: number) => void;
  onDeleteRound?: (roundId: string) => void;
```

Destructure the new props in the function signature (after `onToggleManage`):

```tsx
  rounds,
  canRecordRound = false,
  canDeleteRound = false,
  onRecordRound,
  onDeleteRound,
```

Add, immediately after the `<Text style={styles.free}>{seatsFreeLabel(free)}</Text>` line and before the `bookedForYou` block:

```tsx
      {rounds ? (
        <>
          <RoundLog
            rounds={rounds}
            players={seated.map((o) => ({
              profileId: o.profile_id,
              name: o.profile_id === youId ? 'You' : o.display_name,
            }))}
            canRecord={canRecordRound}
            canDelete={canDeleteRound}
            busy={busy}
            onRecord={(winnerId, points) => onRecordRound?.(winnerId, points)}
            onDelete={(roundId) => onDeleteRound?.(roundId)}
          />
          <RoundTimer tableLabel={table.label} />
        </>
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/TableCard.test.tsx`
Expected: PASS — all original tests plus the 4 new ones green.

- [ ] **Step 5: Commit**

```bash
git add components/TableCard.tsx components/__tests__/TableCard.test.tsx
git commit -m "feat(rounds): render RoundLog and RoundTimer in TableCard"
```

---

## Task 9: Wire rounds into the event screen

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:**
- Consumes: `fetchTableRounds`, `recordRound`, `deleteRound` (Task 5); `TableCard`'s four new props (Task 8).
- Produces: nothing new for later tasks — this is the top of the call chain.

- [ ] **Step 1: Write the failing tests**

`app/__tests__/events-detail.test.tsx` mocks each `lib/*` module it touches with a plain top-level `vi.fn()` per function, wired through a `vi.mock('../../lib/x', async (importOriginal) => ({ ...actual, fn: (...args) => fn(...args) }))` factory, declared *before* the `import EventScreen from '../clubs/[id]/events/[eventId]/index';` line (line 151). Add a matching block for `lib/rounds` in that same spot, right after the existing `lib/attendance` mock (after line 131):

```tsx
const fetchTableRounds = vi.fn();
const recordRound = vi.fn();
const deleteRound = vi.fn();

vi.mock('../../lib/rounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/rounds')>();
  return {
    ...actual,
    fetchTableRounds: (...args: unknown[]) => fetchTableRounds(...args),
    recordRound: (...args: unknown[]) => recordRound(...args),
    deleteRound: (...args: unknown[]) => deleteRound(...args),
  };
});
```

Add `waitFor` to the existing `@testing-library/react` import at line 3:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

In the shared `beforeEach` (after the existing `clearAttendance.mockResolvedValue({ error: null });` line, 232):

```tsx
  fetchTableRounds.mockReset();
  fetchTableRounds.mockResolvedValue([]);
  recordRound.mockResolvedValue({ round: null, error: null });
  deleteRound.mockResolvedValue({ error: null });
```

Add fixtures near the existing `TABLE_1`/`MEMBER_ROLE`/`HOST_ROLE` constants (after line 201):

```tsx
const SEATED_ADA = {
  booking_id: 'b1',
  group_id: 'g1',
  profile_id: 'test-user',
  display_name: 'Ada',
  skill_level: null as const,
  event_table_id: 'table-1',
  status: 'confirmed' as const,
  booked_by: 'test-user',
  booked_by_name: 'Ada',
  group_status: 'confirmed' as const,
  waitlist_position: null,
  created_at: '2026-08-20T10:00:00Z',
};

const SEATED_RAVI = {
  ...SEATED_ADA,
  booking_id: 'b2',
  profile_id: 'p1',
  display_name: 'Ravi K.',
  booked_by: 'p1',
  booked_by_name: 'Ravi K.',
};

const ROSTER_WITH_RAVI = [
  ...MEMBER_ROLE,
  { profile_id: 'p1', role: 'member' as const, display_name: 'Ravi K.', skill_level: null },
];

const HOST_ROSTER_WITH_RAVI = [
  ...HOST_ROLE,
  { profile_id: 'p1', role: 'member' as const, display_name: 'Ravi K.', skill_level: null },
];

const ROUND_1 = {
  id: 'r1',
  event_table_id: 'table-1',
  winner_profile_id: 'p1',
  points: 8,
  recorded_by: 'p1',
  created_at: '2026-09-02T20:00:00Z',
};

/**
 * EVENT's own fixture starts in the future (2026-09-03), the "not yet
 * started" case `canBook` already exercises elsewhere in this file. Round
 * recording needs the opposite window -- started, not yet ended -- so this
 * computes it relative to the real clock at test-run time rather than a
 * second hardcoded date that would eventually go stale the same way a
 * fixed past date would.
 */
function liveEvent() {
  return {
    ...EVENT,
    starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}
```

Add a new `describe` block, alongside the file's other `describe('member view: ...')`/`describe('a section that fails ...')` blocks:

```tsx
describe('table rounds', () => {
  it("shows a table's recorded rounds", async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([ROUND_1]);

    render(<EventScreen />);

    expect(await screen.findByText('Ravi K. · 8 pts')).toBeTruthy();
  });

  it('lets an organizer record a round while the game is live', async () => {
    fetchRoster.mockResolvedValue(HOST_ROSTER_WITH_RAVI);
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventSeating.mockResolvedValue([SEATED_ADA, SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([]);
    recordRound.mockResolvedValue({ round: ROUND_1, error: null });

    render(<EventScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Winner: Ravi K.' }),
    );
    fireEvent.change(screen.getByLabelText('Points'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record a round' }));

    await waitFor(() =>
      expect(recordRound).toHaveBeenCalledWith({
        tableId: 'table-1',
        winnerProfileId: 'p1',
        points: 8,
      }),
    );
  });

  it('hides the record form before the game has started', async () => {
    // EVENT's default fixture starts in the future, so gameLive is false --
    // the same guard assert_round_writable enforces server-side ("this
    // game has not started yet").
    fetchRoster.mockResolvedValue(HOST_ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_ADA, SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([]);

    render(<EventScreen />);

    await screen.findByText('Thursday Mahjong');
    expect(
      screen.queryByRole('button', { name: 'Record a round' }),
    ).toBeNull();
  });

  it('lets only the organizer delete a round', async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI); // 'member', not organizer
    fetchEventSeating.mockResolvedValue([SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([ROUND_1]);

    render(<EventScreen />);

    await screen.findByText('Ravi K. · 8 pts');
    expect(
      screen.queryByRole('button', {
        name: "Delete Ravi K.'s round for 8 points",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: FAIL — the screen does not fetch or render rounds yet, and `TableCard` receives no `rounds` prop.

- [ ] **Step 3: Wire the screen**

In `app/clubs/[id]/events/[eventId]/index.tsx`:

Add the import (alongside the existing `lib/bookings` import block, around line 42):

```tsx
import {
  deleteRound,
  fetchTableRounds,
  recordRound,
  type TableRound,
} from '../../../../../lib/rounds';
```

Add state (alongside `seating`/`seatingFailed`, around line 152):

```tsx
  // Every round across every table of this event, newest first, plus
  // whether the fetch itself failed -- kept separate from `tablesFailed`
  // for the same reason `seatingFailed` is: a failed rounds fetch must not
  // read as "no rounds have been played."
  const [rounds, setRounds] = useState<TableRound[]>([]);
  const [roundsFailed, setRoundsFailed] = useState(false);
```

Extend `load()`'s `Promise.all` (around line 220):

```tsx
  async function load() {
    const [
      loadedClub,
      loadedEvent,
      loadedTables,
      rosterRows,
      seatingRows,
      openOffer,
      myCheckInState,
      loadedRounds,
    ] = await Promise.all([
      fetchClub(clubId),
      fetchEvent(eventId),
      fetchEventTables(eventId),
      fetchRoster(clubId),
      fetchEventSeating(eventId),
      fetchOpenOffer(eventId),
      fetchMyCheckIn(eventId),
      fetchTableRounds(eventId),
    ]);
```

And, after the existing `setSeating(seatingRows ?? []);` block:

```tsx
    setRoundsFailed(loadedRounds === null);
    setRounds(loadedRounds ?? []);
```

Add, after the `gameFull` computation (around line 401) — the live-game predicate rounds need, distinct from `canBook`'s "not yet started" gate:

```tsx
  // The opposite window from `canBook`: rounds can only be recorded once
  // the game has actually started and before it ends, matching the guard
  // ladder `assert_round_writable` enforces server-side
  // (20260902070000_table_rounds_mutations.sql). `canBook` alone would let
  // this render before the game starts; its own gate is "not yet started",
  // exactly the case a round must refuse.
  const gameLive =
    event.status === 'published' &&
    new Date(event.starts_at) <= now &&
    new Date(event.ends_at) > now;
```

Add a handler, alongside `hostCallForAFourth` (around line 639):

```tsx
  async function recordTableRound(
    tableId: string,
    winnerProfileId: string,
    points: number,
  ) {
    setBusy(true);
    setError(null);
    const { error: recordError } = await recordRound({
      tableId,
      winnerProfileId,
      points,
    });
    setBusy(false);
    if (recordError) {
      setError(recordError);
      return;
    }
    await load();
  }

  async function removeTableRound(roundId: string) {
    await run(() => deleteRound(roundId));
  }
```

In the `tables.map((table) => { ... })` render (around line 752), inside the same block that computes `tableOccupants`/`confirmedAtTable`, add:

```tsx
          const displayRounds = rounds
            .filter((r) => r.event_table_id === table.id)
            .map((r) => ({
              id: r.id,
              winner_profile_id: r.winner_profile_id,
              winner_name:
                roster.find((m) => m.profile_id === r.winner_profile_id)
                  ?.display_name ?? 'Unknown',
              points: r.points,
            }));
          const iAmSeatedHere = seating.some(
            (o) =>
              o.profile_id === me &&
              o.status === 'confirmed' &&
              o.event_table_id === table.id,
          );
```

Then pass to `<TableCard ...>` (after the existing `onToggleManage={toggleManageSeat}` prop):

```tsx
              rounds={roundsFailed ? undefined : displayRounds}
              canRecordRound={gameLive && (isOrganizer || iAmSeatedHere)}
              canDeleteRound={isOrganizer}
              onRecordRound={(winnerId, points) =>
                void recordTableRound(table.id, winnerId, points)
              }
              onDeleteRound={(roundId) => void removeTableRound(roundId)}
```

Finally, add a degrade-only-this-section message near the existing `seatingFailed`/`tablesFailed` block (around line 890):

```tsx
      {roundsFailed ? (
        <Text style={styles.help}>Could not load rounds for this game.</Text>
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: PASS — all original tests plus the 4 new ones green.

- [ ] **Step 5: Run the full unit/component suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else in the app.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/\[id\]/events/\[eventId\]/index.tsx app/__tests__/events-detail.test.tsx
git commit -m "feat(rounds): wire round recording into the event screen"
```

---

## Task 10: Schema-contract coverage

**Files:**
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: a real local Supabase stack (`npx supabase start`), `record_round`/`delete_round` (Task 3), `fetchTableRounds` (Task 5).
- Produces: nothing new — this proves the client and the live schema agree, the same role `event_attendance`'s contract test plays for check-in.

- [ ] **Step 1: Read the existing check-in contract test for the pattern to copy**

Read `lib/schema-contract.test.ts` around the `event_attendance`/`attendance_state` tests (search for `'serializes attendance_state as the client union'`, roughly lines 1913–2090 per the check-in plan's own notes). Copy its fixture-setup shape (create a club, a venue, a live event, a table, a confirmed booking, all through the admin/service-role client) rather than re-deriving it.

- [ ] **Step 2: Write the failing test**

Add a new `describe` block to `lib/schema-contract.test.ts`, alongside the existing event-attendance one:

```ts
describe('table_rounds contract', () => {
  it('record_round returns a row the client can read back as TableRound', async () => {
    // Reuses this file's own admin-client fixture helpers to create a
    // club, venue, a LIVE event (starts_at in the past, ends_at in the
    // future), one table, and a confirmed booking for a seeded profile --
    // copy the exact shape the neighbouring event_attendance test already
    // sets up, changing only the table this test needs.
    const { clubId, eventId, tableId, profileId, cleanup } =
      await seedLiveTableWithOneSeat();

    try {
      const { data, error } = await supabase.rpc('record_round', {
        target_table: tableId,
        winner_profile: profileId,
        target_points: 8,
      });

      expect(error, `record_round failed: ${error?.message}`).toBeNull();
      expect(data).toMatchObject({
        event_table_id: tableId,
        winner_profile_id: profileId,
        points: 8,
      });

      const rounds = await fetchTableRounds(eventId);
      expect(rounds).toEqual([
        expect.objectContaining({ id: data.id, points: 8 }),
      ]);
    } finally {
      await cleanup();
    }
  });
});
```

Replace `seedLiveTableWithOneSeat` with whatever this file's actual existing fixture-helper is named once Step 1's reading is done — do not invent a new one if an equivalent already exists for the event-attendance test; extend or call it directly.

- [ ] **Step 3: Run it to verify it fails, then passes**

Run: `npx supabase start && npm run test:contract`
Expected: first FAIL (before Task 3/5 code existed this would fail; since those are already merged by this point in the plan, this step instead just confirms the test as written is correct) then PASS once any fixture-helper naming is corrected.

- [ ] **Step 4: Commit**

```bash
git add lib/schema-contract.test.ts
git commit -m "test(rounds): add a schema-contract test for record_round"
```

---

## Task 11: Visual baseline

**Files:**
- Modify: `e2e/visual.spec.ts`

**Interfaces:**
- Consumes: a running dev server and seeded data reachable by Playwright (follow this file's existing setup for the event-detail screen exactly).
- Produces: a new baseline screenshot; nothing else depends on this task.

- [ ] **Step 1: Read the existing event-detail visual test**

Read `e2e/visual.spec.ts` for its current event-detail-screen scenario (search for the test that already screenshots `app/clubs/[id]/events/[eventId]/index.tsx`) and copy its seeding/navigation shape exactly.

- [ ] **Step 2: Add a scenario with rounds recorded**

Add a new test, modelled on the existing event-detail one, that seeds a live event with a table holding two confirmed players, records one round via a direct call to the seeded database (matching however the existing seed helpers write bookings), navigates to the event screen, and screenshots it at both the existing mobile and desktop widths this file already covers for that screen.

- [ ] **Step 3: Run it to generate the baseline**

Run: `npm run test:visual -- --update-snapshots`
Expected: a new snapshot file is created under this file's existing snapshot directory; review the generated PNG to confirm the rounds section renders as expected (running totals line, round list, timer duration pills) before committing it.

- [ ] **Step 4: Run the visual suite to verify it passes against the new baseline**

Run: `npm run test:visual`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/visual.spec.ts e2e/__screenshots__/
git commit -m "test(rounds): add a visual baseline for a table with rounds recorded"
```

---

## Final check

- [ ] Run the full suite end to end: `npm test && npm run test:db && npm run test:visual`
- [ ] Confirm no task left a `TODO`, an unmapped `raise exception`, or a `console.log` behind.
- [ ] Open a PR from `feat/table-rounds` into `main` (per the standing branch-per-plan rule) rather than merging locally.
