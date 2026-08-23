# Seating & Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member takes a seat — alone or with friends — joins a waitlist when the game is full, is promoted off it automatically when a seat opens, and a table sitting at three of four calls for a fourth.

**Architecture:** Four new tables (`booking_groups`, `bookings`, `promotion_offers`, `notification_outbox`). Clients hold `select` on the first three, nothing on the fourth, and no DML anywhere; every write goes through a `security definer` function that takes `for update` on the event row first, so all seat arithmetic for one game is serialized. Waitlist promotion runs inline inside whichever transaction frees a seat; `pg_cron` only expires promotion offers and announces tables needing a fourth. Every notifiable moment writes a `notification_outbox` row that plan 6 will drain to push and email.

**Tech Stack:** Expo/React Native with expo-router, Supabase (Postgres, RLS, `pg_cron`), Vitest + `@testing-library/react`, pgTAP, Playwright.

**Spec:** [../specs/2026-08-23-seating-and-booking-design.md](../specs/2026-08-23-seating-and-booking-design.md)
**Branch:** `feat/seating`, already cut from `main` (`7d8fa88`, plan 3 merged). One branch and one PR per plan — nothing is committed to `main` directly.

## Global Constraints

Every task's requirements implicitly include these.

- **Three platforms from one codebase:** iOS, Android, and web. A change that builds on one but not the others is incomplete.
- **The database owns authorization.** RLS is enabled on every table in the same migration that creates it, and every table gets a `grant` matching its policies — no wider. RLS policies *filter* access; they do not *grant* it.
- **`alter default privileges` in this schema grants new tables NOTHING to `authenticated` and full DML to `service_role`** (migrations `20260822041836`, `20260822180200`). Every new table needs its `authenticated` grants written out verb-for-verb, and gets `service_role` DML for free. Never `grant all` — `ALL` includes `TRUNCATE`, which RLS does not filter.
- **Every new function gets `revoke execute on function … from public, anon, authenticated` before its `grant`** — `authenticated` included, and especially for a function you are NOT granting. A null `proacl` means EXECUTE to PUBLIC, and separately, **Supabase's hosted bootstrap grants EXECUTE to `authenticated` directly at function-creation time**, which `revoke … from public` never touches. The local stack adds no such grant, so a function reachable by every signed-in user on hosted looks perfectly clean locally. Plan 3 was bitten by this three times; this plan shipped **sixteen** internal functions that way — including `security definer` ones with no membership check, which were written to trust their callers precisely because they were supposed to be unreachable. `portable/grants.test.sql` run against hosted is the only thing that catches it. See `20260825061000`.
- **Every `security definer` function pins `set search_path = public`** and checks membership or organizer role against the row's **own** club as its first statement, using plan 3's shared `public.assert_club_organizer(uuid)` or `public.is_club_member(uuid)`. RLS does not protect a definer function.
- **Every seat-changing function takes `perform 1 from public.events where id = <event> for update;` before it reads any count.** This is the entire concurrency design. A function that computes free seats without holding that lock is wrong even when its tests pass.
- **Bind `caller uuid := auth.uid()` and refuse a null caller explicitly, as the FIRST thing every guard does.** Do not compare against `auth.uid()` inline in any form. A null `auth.uid()` makes `x = auth.uid()` and `x <> auth.uid()` both evaluate to NULL rather than false; `NULL or NULL or false` is NULL; `not NULL` is NULL; and plpgsql treats a NULL `if` condition as not-true, so the guard silently falls through and the function proceeds. **This defeats the `not (a = auth.uid() or b = auth.uid() or is_club_organizer(...))` shape too** — an earlier version of this constraint claimed that chain was null-safe, Task 4 shipped three functions on that advice, and its review caught them. Verified in Postgres: `not (null::uuid = 'a'::uuid or null::uuid = 'b'::uuid or false)` is NULL and the `if` body does not run. `20260822044023_accept_club_invite.sql` is the codebase's existing correct shape. A `where profile_id <> auth.uid()` used as a notification *filter* is unaffected — nobody is authorized by it.
- **`lib/` functions never reject.** They catch internally, `console.error('<fn> failed', cause)` the original, and return `GENERIC_ERROR` from `lib/constants.ts` through an `{ error: string | null }` channel. Callers must consume that channel.
- **A refusal from the database is never reported as a connection failure.** Plan 3 shipped that bug and fixed it at merge: a `raise exception` with a known errcode maps to the written sentence in the "Error handling" table below; only an unreachable server yields `GENERIC_ERROR`.
- **Every write uses `.select(...)` and treats zero rows as failure.** PostgREST answers 204 with `error: null` when an update matches nothing, which is what an RLS denial looks like.
- **18pt is the app-wide minimum body text size.** Helper/secondary text at 16pt is the sole exception. Never encode anything below 16 as correct.
- **Accessibility props are required** — `accessibilityLabel` and `accessibilityRole` on every interactive control, and state through the **flat `aria-*` prop**: `aria-checked`, `aria-selected`, `aria-disabled`, `aria-busy`. **Never `accessibilityState`.** react-native-web's `createDOMProps` has no handling for `accessibilityState` at all, so it reaches the DOM on no platform this app ships to — plan 3's merge review found every `Toggle` rendering `role="switch"` with no state, including the switch that decides whether a member's home address becomes public. One prop covers both platforms rather than two that could drift: React Native's own `Pressable` resolves `checked: ariaChecked ?? accessibilityState?.checked`, so the flat prop reaches the native accessibility tree too. `components/Toggle.tsx` documents this in full and its test asserts the rendered attribute; read it before writing an interactive control.
- **Every screen wraps its content in `<Screen>`**, which constrains the column to 440px and centres it on wide viewports.
- **Spacing comes from `space[…]` in `lib/theme`**, never a literal.
- **Times are club-local wall clock plus the club's timezone, never a fixed UTC offset.** The 48-hour and 12-hour windows in this plan are plain intervals against `starts_at`, an instant — that is arithmetic on instants, not a timezone conversion, and it is correct under any server zone.
- **The existing suites must keep passing:** 322 Vitest, 46 contract, 440 pgTAP local, 58 hosted, 22 visual, `tsc` clean.
- **Visual baselines are reviewed like code**, and `--update-snapshots` **compares first and writes only on failure** — a change under `maxDiffPixels` (120) leaves the old PNG in place and reports green. Delete the PNG or use `--update-snapshots=all`. Then **look at the images**: plan 3's green run hid a card reading "0 tables", two `--` where the app uses an em dash, and a baseline that had baked in that day's date.
- **The visual layer cannot fail on a one-glyph text regression** (a 16px digit substitution is 67–94 pixels, under the 120 threshold). Text is protected by `getByText` preconditions, not by pixels. See `docs/testing.md`.
- **Mutation-check every assertion you add.** For each rule a test claims to protect, break the implementation inside a transaction, confirm the suite goes red, and roll back. Plan 3 shipped assertions that could not fail — including one titled "clearing the end date cancels nothing new" that was true *and* ratified a data-loss bug, and a pgTAP `isnt()` that read a DELETED row as passing. A green suite is not evidence; a suite that goes red on the right mutation is.
- Local stack start command:
  `npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit`

## Scope

**In:** the four booking tables, the propose/commit pair, group booking with splits, booking on behalf of club members with a one-tap decline, "any table" bookings and host placement, member and host cancellation, the waitlist with FIFO auto-promotion, timed partial-fit promotion offers, "need a 4th" detection and claiming, the amendments to plan 3's `cancel_event` and `remove_event_table`, three screen changes, and the two `todo.md` layout bugs on the clubs list.

**Out — deferred with reasons:**

- **Check-in.** Plan 5. Nothing here records attendance *on the night*; a booking is an intention, and no-shows are plan 5's concept. This is why cancellation is refused once the game has started rather than being allowed and recorded.
- **Push and email delivery, host broadcasts, reminder scheduling.** Plan 6. This plan writes `notification_outbox` rows and never reads them back.
- **An in-app inbox screen.** Rejected in the spec: every fact a member needs is surfaced where they already are, from live state.
- **Guest attendance, scoring, leaderboards, automatic seating by skill.** Roadmap-deferred, and none of them is prefigured here with placeholder state.
- **Named or numbered seats.** The schema counts seats. The grid renders occupied bookings followed by empty placeholders and must never imply a seat has an identity.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260825000000_create_bookings.sql` | Four enums, four tables, `event_tables_id_event_unique`, RLS, grants, `is_booking_group_member`, the five capacity helpers |
| `supabase/migrations/20260825010000_waitlist_promotion.sql` | `seat_assignments`, `confirm_group_seats`, `promote_waitlist`, the offer lifecycle, `sweep_promotion_offers` |
| `supabase/migrations/20260825020000_booking_mutations.sql` | `assert_event_bookable`, `assert_players_bookable`, `plan_seating`, `propose_booking`, `commit_booking` |
| `supabase/migrations/20260825030000_booking_cancellation.sql` | `cancel_booking`, `decline_booking`, `cancel_booking_group`, `place_booking`, `close_group_if_empty` |
| `supabase/migrations/20260825040000_event_disruption.sql` | *(replaces)* `cancel_event` and `remove_event_table`; `add_event_table` gains a promotion call |
| `supabase/migrations/20260825041000_scope_booking_group_preferred_fk.sql` | *(added during Task 5)* scopes the composite FK's `set null` to `preferred_table_id` so it cannot null the NOT NULL `event_id` |
| `supabase/migrations/20260825042000_series_shortening_tells_the_booked.sql` | *(added during Task 5)* an `event_cancelled` outbox row per member whose booked week a series shortening deletes |
| `supabase/migrations/20260825050000_need_a_fourth.sql` | `tier_matches`, `tables_needing_a_fourth`, `announce_need_a_fourth`, `call_for_a_fourth` |
| `supabase/migrations/20260825060000_schedule_booking_jobs.sql` | The two `cron.schedule` calls |
| `supabase/tests/database/fixtures/bookings_schema.test.sql` | Tables, constraints, RLS, tenancy, capacity helpers |
| `supabase/tests/database/fixtures/waitlist_promotion.test.sql` | The walk, offers, acceptance, expiry, the sweep |
| `supabase/tests/database/fixtures/bookings_commit.test.sql` | Propose/commit, splits, any-table, waitlist admission, concurrency |
| `supabase/tests/database/fixtures/bookings_cancellation.test.sql` | Cancel, decline, place, group rollup |
| `supabase/tests/database/fixtures/event_disruption.test.sql` | Cancelling a game and removing a table, under live bookings |
| `supabase/tests/database/fixtures/need_a_fourth.test.sql` | Qualification, staging, recipients, dedupe |
| `supabase/tests/database/portable/grants.test.sql` | *(modify)* grants and function ACLs for the four new tables |
| `supabase/migrations/20260825070000_seating_reads.sql` | `event_seating`, `my_upcoming_bookings` — the two read functions the screens need |
| `lib/bookings.ts` + `lib/bookings.test.ts` | Booking data layer and the pure display helpers |
| `components/SeatGrid.tsx` | One table's seats — presentational, no data access |
| `components/TableCard.tsx` | A table: label, tier, seat grid, per-card actions |
| `components/BringSomeoneSheet.tsx` | Group booking: who, where, split toggle, split confirmation |
| `components/WaitlistPanel.tsx` | Waitlist order, unseated members, live offer |
| `components/HostSeating.tsx` | Organizer controls: seat, move, remove, call for a 4th |
| `app/clubs/[id]/events/[eventId]/index.tsx` | *(modify)* booking on the event screen |
| `app/clubs/index.tsx` | *(modify)* "Your games", plus the two `todo.md` layout bugs |
| `app/clubs/[id]/index.tsx` | *(modify)* the per-event status line |
| `app/__tests__/bookings-detail.test.tsx` | Event-screen booking behaviour |
| `app/__tests__/your-games.test.tsx` | "Your games" behaviour |
| `components/__tests__/SeatGrid.test.tsx`, `.../TableCard.test.tsx`, `.../BringSomeoneSheet.test.tsx` | Component tests |
| `e2e/visual.spec.ts` | *(modify)* baselines for the new states |
| `lib/schema-contract.test.ts` | *(modify)* the new tables and RPC shapes |
| `docs/testing.md` | *(modify)* the two new cron jobs and the concurrency-test pattern |

**Migration timestamps are fixed, not chosen.** The last migration on `main` is `20260824001000`. Use exactly the timestamps in the table above so the seven migrations apply in the order the plan assumes.

---

## The seating rules, in one place

Every task below implements part of this. Read it once before Task 1; the tasks assume it.

```
capacity(event)        = sum(event_tables.capacity)
confirmed(event)       = count(bookings where status = 'confirmed')      -- seated OR unseated
held(event)            = sum(promotion_offers.offered_seat_count where responded_at is null)
free(event)            = greatest(0, capacity - confirmed - held)
table_free(table)      = greatest(0, capacity - count(confirmed bookings placed there))
```

- An **"any table" booking** (`event_table_id is null`) is confirmed and costs the event a seat. It occupies no table.
- **`preferred_table_id is null` means "any table"** for the whole group: nobody in it is ever auto-placed, on commit or on promotion, and `allow_split` is irrelevant to it.
- **`preferred_table_id is not null`** means placement is attempted: that table first, then the rest by `position`.
- **`allow_split = false`** requires one single table with room for everybody. If no such table exists, the group waits — even when the event as a whole has room.
- **Admission** requires `free(event) >= group size`. Otherwise the whole group waitlists; no group is ever half-admitted at commit time.
- **Promotion order** is `booking_groups.waitlisted_at` ascending. A group skipped for not fitting keeps that timestamp and therefore its place.
- **A partial fit with `allow_split = true`** produces a `promotion_offer` for exactly the free seats, holding them, expiring at `min(now() + 2h, event start)`.
- **Placement order within a group** is the booker first, then `bookings.created_at`.

---

### Task 1: The booking schema

**Files:**
- Create: `supabase/migrations/20260825000000_create_bookings.sql`
- Create: `supabase/tests/database/fixtures/bookings_schema.test.sql`

**Interfaces:**
- Consumes: plan 3's `events`, `event_tables`, `events_id_club_unique`, `is_club_member(uuid)`, `is_club_organizer(uuid)`, `assert_club_organizer(uuid)`; plan 1's `profiles.skill_level`, `profiles.mute_need_a_fourth`.
- Produces: enums `booking_status`, `booking_group_status`, `promotion_outcome`, `outbox_kind`; tables `booking_groups`, `bookings`, `promotion_offers`, `notification_outbox`; `event_tables_id_event_unique`; `is_booking_group_member(uuid)`; and the helpers `event_capacity(uuid)`, `event_confirmed_seats(uuid)`, `event_held_seats(uuid)`, `event_free_seats(uuid)`, `table_free_seats(uuid)`. Every later task depends on this one.

**Why the capacity helpers are `security invoker` and granted to nobody.** They are called only from inside `security definer` functions and from the two cron jobs, both of which already run with the definer's privileges, so RLS is not in the way. Granting them to `authenticated` would hand any signed-in user an occupancy oracle for an event id from a club they do not belong to. The client never needs them: it can already read `bookings` for its own club and count.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/bookings_schema.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(28);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'The Annexe',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002');

-- Riverside's game: two tables of 4. Oakfield's: one table, used only to
-- prove the composite foreign keys refuse a cross-event reference.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield game',
   '11111111-0000-0000-0000-000000000002',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'advanced', 4, 2),
  ('7ab1e000-0000-0000-0000-000000000009',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Table 1', 'mixed', 4, 1);

-- ---------------------------------------------------------------------
-- The tables exist, with the columns the rest of the plan assumes.
-- ---------------------------------------------------------------------
select has_table('public', 'booking_groups', 'booking_groups exists');
select has_table('public', 'bookings', 'bookings exists');
select has_table('public', 'promotion_offers', 'promotion_offers exists');
select has_table('public', 'notification_outbox', 'notification_outbox exists');

select col_is_null('public', 'bookings', 'event_table_id',
  'a booking may have no table — that is "any table"');
select col_is_null('public', 'booking_groups', 'preferred_table_id',
  'a group may have no preferred table');

-- ---------------------------------------------------------------------
-- Constraints. Each one is asserted by trying to violate it, because a
-- constraint that is merely present may still be spelled wrong.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'a well-formed confirmed booking inserts');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'one active booking per person per event');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'waitlisted')$$,
  '23514',
  null,
  'a waitlisted booking may not hold a table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000009',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a booking cannot sit at another event''s table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c2c2c2c2-0000-0000-0000-000000000002',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a booking cannot claim a club its event does not belong to');

select throws_ok(
  $$update public.bookings set status = 'cancelled'
     where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'closing a booking without recording when is refused');

select lives_ok(
  $$update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = 'aaaaaaaa-0000-0000-0000-000000000001'
     where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'closing a booking with cancelled_at recorded is allowed');

select lives_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'the same person may rebook once the first booking is closed');

-- ---------------------------------------------------------------------
-- Capacity helpers. Two tables of four; one confirmed booking.
-- ---------------------------------------------------------------------
select is(public.event_capacity('e1e1e1e1-0000-0000-0000-000000000001'), 8,
  'capacity is the sum of the tables');
select is(public.event_confirmed_seats('e1e1e1e1-0000-0000-0000-000000000001'),
  1, 'a cancelled booking does not count as confirmed');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 7,
  'free seats subtract confirmed bookings');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'a table counts only the bookings placed at it');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'the other table is untouched');

-- An UNSEATED confirmed booking costs the event a seat and no table a seat.
-- This is the rule the whole waitlist depends on; without it a club can
-- book past a full game indefinitely.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', null);
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values ('9909aaaa-0000-0000-0000-000000000002',
        'e1e1e1e1-0000-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-000000000001', null,
        'cccccccc-0000-0000-0000-000000000003',
        'cccccccc-0000-0000-0000-000000000003');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 6,
  'an "any table" booking costs the event a seat');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'an "any table" booking costs no table a seat');

-- A held offer is unavailable to everybody else.
insert into public.promotion_offers
  (group_id, event_id, offered_seat_count, expires_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001', 2, now() + interval '2 hours');

select is(public.event_held_seats('e1e1e1e1-0000-0000-0000-000000000001'), 2,
  'an outstanding offer holds its seats');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'held seats are not free seats');

update public.promotion_offers
   set responded_at = now(), outcome = 'expired'
 where event_id = 'e1e1e1e1-0000-0000-0000-000000000001';

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 6,
  'a resolved offer releases its hold');

-- ---------------------------------------------------------------------
-- RLS. Carol is a Riverside member; Bob is not.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select isnt_empty(
  $$select id from public.bookings
     where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
       and status = 'confirmed'$$,
  'a club member reads the bookings for their club''s game');

select isnt_empty(
  $$select id from public.promotion_offers
     where group_id = '9909aaaa-0000-0000-0000-000000000002'$$,
  'a member of the group reads its offer');

select is_empty(
  $$select id from public.notification_outbox$$,
  'nobody reads the outbox');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000002',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000003',
            'cccccccc-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'a member cannot write a booking directly');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is_empty(
  $$select id from public.bookings
     where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  'an outsider reads none of another club''s bookings');

select is_empty(
  $$select id from public.promotion_offers$$,
  'an outsider reads none of another group''s offers');

-- Alice booked nobody into group 2 and is not in it, so the offer is not
-- hers to read even though the club is hers. This is the assertion that
-- distinguishes is_booking_group_member from is_club_member; without it,
-- rewriting the policy to is_club_member(club_id) passes every other test
-- in this file.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is_empty(
  $$select id from public.promotion_offers
     where group_id = '9909aaaa-0000-0000-0000-000000000002'$$,
  'an offer is visible to its own group, not to the whole club');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `bookings_schema.test.sql` fails — `relation "public.booking_groups" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825000000_create_bookings.sql`:

```sql
/*
 * Booking: the four tables a seat needs.
 *
 * Clients hold `select` on three of them, nothing at all on the fourth,
 * and no DML anywhere. Every write goes through a `security definer`
 * function in a later migration. Three shapes here carry the design and are
 * worth reading before changing anything:
 *
 *   1. bookings.event_table_id is NULLABLE, and null means "any table" —
 *      confirmed for the game, not yet placed. It is not a pending state.
 *
 *   2. There is no waitlist_position integer. `waitlisted_at` orders the
 *      queue and position is computed on read. A stored position has to be
 *      renumbered on every departure, and "a group skipped for not fitting
 *      keeps its place" is free under time ordering.
 *
 *   3. There is no group `size` column. It is count(*) over the group's
 *      live bookings; a stored copy disagrees the first time one member of
 *      three declines.
 */

create type public.booking_status as enum
  ('confirmed', 'waitlisted', 'cancelled', 'declined');

/*
 * `declined` is not a flavour of `cancelled`. The booker's outbox row has
 * to say which happened: "Jane declined the seat you booked for her" and
 * "Jane cancelled" are different things to receive.
 */
create type public.booking_group_status as enum
  ('confirmed', 'waitlisted', 'cancelled');

create type public.promotion_outcome as enum
  ('accepted', 'declined', 'expired');

create type public.outbox_kind as enum (
  'booked_by_friend',
  'booking_declined',
  'booking_cancelled_by_host',
  'waitlist_promoted',
  'promotion_offer',
  'promotion_offer_expired',
  'unseated',
  'event_cancelled',
  'need_a_fourth'
);

/*
 * The composite foreign key target the booking tables need. Plan 3 gave
 * `events` its (id, club_id) unique for exactly this reason; event_tables
 * never needed one until now.
 */
alter table public.event_tables
  add constraint event_tables_id_event_unique unique (id, event_id);

create table public.booking_groups (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null,
  club_id            uuid not null,
  created_by         uuid not null references public.profiles(id),
  -- Null means "any table": nobody in this group is ever auto-placed, on
  -- commit or on promotion, and allow_split does not apply to them.
  preferred_table_id uuid,
  allow_split        boolean not null default true,
  status             public.booking_group_status not null default 'confirmed',
  waitlisted_at      timestamptz,
  created_at         timestamptz not null default now(),

  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  foreign key (preferred_table_id, event_id)
    references public.event_tables (id, event_id) on delete set null,

  constraint booking_groups_waitlisted_at_matches_status check (
    (status = 'waitlisted') = (waitlisted_at is not null)
  )
);

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.booking_groups(id)
                   on delete cascade,
  event_id       uuid not null,
  club_id        uuid not null,
  -- Null is "any table". See the note at the top of this file.
  event_table_id uuid,
  profile_id     uuid not null references public.profiles(id),
  -- Equal to profile_id for a self-booking. Different when a friend booked
  -- this seat, which is what gives the decline affordance somebody to tell.
  booked_by      uuid not null references public.profiles(id),
  status         public.booking_status not null default 'confirmed',
  cancelled_by   uuid references public.profiles(id),
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),

  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  -- Composite, so a booking cannot point at a table belonging to a
  -- different event. Plan 3's tenancy bugs were all of this shape.
  foreign key (event_table_id, event_id)
    references public.event_tables (id, event_id) on delete no action,

  constraint bookings_waitlisted_has_no_table check (
    status <> 'waitlisted' or event_table_id is null
  ),
  constraint bookings_closed_records_when check (
    (status in ('cancelled', 'declined')) = (cancelled_at is not null)
  )
);

/*
 * One active booking per person per event. This is what stops two friends
 * booking the same person into the same game, and what makes "already has
 * a seat" a constraint rather than a race.
 */
create unique index bookings_one_active_per_person_idx
  on public.bookings (event_id, profile_id)
  where status in ('confirmed', 'waitlisted');

create index bookings_event_status_idx
  on public.bookings (event_id, status);
create index bookings_table_idx
  on public.bookings (event_table_id) where event_table_id is not null;
create index bookings_profile_idx
  on public.bookings (profile_id, status);
create index booking_groups_queue_idx
  on public.booking_groups (event_id, waitlisted_at)
  where status = 'waitlisted';

create table public.promotion_offers (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.booking_groups(id)
                       on delete cascade,
  event_id           uuid not null references public.events(id)
                       on delete cascade,
  offered_seat_count int not null check (offered_seat_count > 0),
  expires_at         timestamptz not null,
  responded_at       timestamptz,
  outcome            public.promotion_outcome,
  created_at         timestamptz not null default now(),

  constraint promotion_offers_outcome_matches_response check (
    (responded_at is null) = (outcome is null)
  )
);

/*
 * One outstanding offer per group. Two would each hold seats and the group
 * could only ever take one of them.
 */
create unique index promotion_offers_one_outstanding_idx
  on public.promotion_offers (group_id) where responded_at is null;

create index promotion_offers_sweep_idx
  on public.promotion_offers (expires_at) where responded_at is null;

/*
 * Plan 6's queue, written now.
 *
 * Nobody reads this table: no RLS policy, no grant to authenticated. Every
 * fact a member needs is surfaced from live state instead — promotion_offers
 * for a held offer, bookings.booked_by for a friend-booked seat, occupancy
 * and time for a table needing a fourth. This exists so that plan 6 adds
 * delivery and nothing else, and so a moment that has already passed (an
 * offer that expired unseen) leaves a trace.
 */
create table public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  club_id      uuid not null references public.clubs(id) on delete cascade,
  event_id     uuid references public.events(id) on delete cascade,
  kind         public.outbox_kind not null,
  payload      jsonb not null default '{}'::jsonb,
  -- The idempotency guard for both cron jobs. A 15-minute job that runs
  -- twice before anybody acts must not announce the same table twice.
  dedupe_key   text not null unique,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index notification_outbox_unsent_idx
  on public.notification_outbox (created_at) where sent_at is null;

-- ---------------------------------------------------------------------
-- Capacity. The arithmetic every other migration in this plan relies on.
-- ---------------------------------------------------------------------

/*
 * These five are `security invoker` and granted to NOBODY. They run inside
 * `security definer` functions and inside the cron jobs, both of which
 * already carry the privileges to see the rows. Granting them to
 * authenticated would hand any signed-in user an occupancy oracle for an
 * event id belonging to a club they are not in.
 */
create function public.event_capacity(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(capacity), 0)::int
  from public.event_tables where event_id = target_event;
$$;

create function public.event_confirmed_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.bookings
  where event_id = target_event and status = 'confirmed';
$$;

create function public.event_held_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(offered_seat_count), 0)::int
  from public.promotion_offers
  where event_id = target_event and responded_at is null;
$$;

/*
 * Floors at zero on purpose. Removing a table lowers capacity without
 * ejecting anybody, so an event can legitimately hold more confirmed
 * bookings than seats until the host sorts it out. That state admits
 * nobody new; it must not read as negative free seats.
 */
create function public.event_free_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0,
    public.event_capacity(target_event)
    - public.event_confirmed_seats(target_event)
    - public.event_held_seats(target_event));
$$;

create function public.table_free_seats(target_table uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, t.capacity - (
    select count(*)::int from public.bookings b
    where b.event_table_id = t.id and b.status = 'confirmed'
  ))
  from public.event_tables t where t.id = target_table;
$$;

/*
 * Mirrors is_club_member, and exists for the same reason: a promotion_offers
 * policy that asked this question inline through `bookings` would recurse
 * through bookings' own policy.
 */
create function public.is_booking_group_member(target_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where group_id = target_group and profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------
alter table public.booking_groups      enable row level security;
alter table public.bookings            enable row level security;
alter table public.promotion_offers    enable row level security;
alter table public.notification_outbox enable row level security;

-- Who is coming is the club's business. That is the product.
create policy booking_groups_select_member on public.booking_groups
  for select using (public.is_club_member(club_id));

create policy bookings_select_member on public.bookings
  for select using (public.is_club_member(club_id));

-- An offer is the group's own business, not the whole club's.
create policy promotion_offers_select_group on public.promotion_offers
  for select using (public.is_booking_group_member(group_id));

-- notification_outbox deliberately has NO policy. RLS is on and nothing
-- passes it, so authenticated sees nothing even if a grant is added by
-- mistake later.

grant select on public.booking_groups   to authenticated;
grant select on public.bookings         to authenticated;
grant select on public.promotion_offers to authenticated;
-- No grant on notification_outbox to anyone but service_role, which holds
-- DML by default privilege (20260822180200).

revoke execute on function public.event_capacity(uuid)         from public, anon;
revoke execute on function public.event_confirmed_seats(uuid)  from public, anon;
revoke execute on function public.event_held_seats(uuid)       from public, anon;
revoke execute on function public.event_free_seats(uuid)       from public, anon;
revoke execute on function public.table_free_seats(uuid)       from public, anon;
revoke execute on function public.is_booking_group_member(uuid) from public, anon;
grant  execute on function public.is_booking_group_member(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `bookings_schema.test.sql .. ok`, 28 of 28, and every pre-existing fixture still green.

- [ ] **Step 5: Mutation-check the assertions**

Each mutation below is applied to the migration, `npx supabase db reset && npm run test:db` is run, the named test must go **red**, then the mutation is reverted. A mutation that leaves the suite green means the assertion is decorative — fix the test, not the mutation.

| Mutation | Must break |
|---|---|
| Drop `where status in ('confirmed','waitlisted')` from `bookings_one_active_per_person_idx` | "the same person may rebook once the first booking is closed" |
| Remove the `bookings_waitlisted_has_no_table` check | "a waitlisted booking may not hold a table" |
| Change the `event_table_id` FK to reference `event_tables(id)` alone | "a booking cannot sit at another event's table" |
| Drop `- public.event_held_seats(...)` from `event_free_seats` | "held seats are not free seats" |
| Change `event_confirmed_seats` to count all statuses | "a cancelled booking does not count as confirmed" |
| Change the `promotion_offers` policy to `is_club_member(club_id)` — note this requires adding a `club_id`; instead rewrite it to `true` | "an outsider reads none of another group's offers" **and** "an offer is visible to its own group, not to the whole club" |
| Add `grant select on public.notification_outbox to authenticated` | "nobody reads the outbox" |

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825000000_create_bookings.sql \
        supabase/tests/database/fixtures/bookings_schema.test.sql
git commit -m "feat(db): add the booking, waitlist and outbox tables

Four tables and the capacity arithmetic every later migration uses. Three
shapes carry the design: event_table_id is nullable and null means \"any
table\"; the waitlist is ordered by waitlisted_at rather than a stored
position that would need renumbering; and a group has no size column
because count(*) over its live bookings cannot disagree with itself.

notification_outbox has RLS on and no policy at all. Nobody reads it —
every member-facing fact comes from live state instead. It exists so plan
6 adds delivery and nothing else."
```

---

### Task 2: The waitlist walk and the offer lifecycle

**Files:**
- Create: `supabase/migrations/20260825010000_waitlist_promotion.sql`
- Create: `supabase/tests/database/fixtures/waitlist_promotion.test.sql`

**Interfaces:**
- Consumes: Task 1's tables and the five capacity helpers.
- Produces: `seat_assignments(uuid, int, uuid, boolean)` returning `table(event_table_id uuid, seats int)`; `confirm_group_seats(uuid, int) returns int`; `promote_waitlist(uuid) returns void`; `accept_promotion_offer(uuid) returns int`; `decline_promotion_offer(uuid) returns void`; `sweep_promotion_offers() returns int`. Tasks 3, 4, 5 and 6 all call `promote_waitlist`.

**Why this comes before booking.** `commit_booking` calls `promote_waitlist` (a waitlisted group can be owed an offer the moment it is created, when seats are free but fewer than the group needs). Building promotion first means the booking task never has to stub anything, and this task's fixture inserts its groups by hand — pgTAP runs as superuser before it drops to `authenticated`, so no booking function is needed to set up a waitlist.

**`seat_assignments` is the single placement rule** and both this task and Task 3 use it. It answers one question — "if I want N seats here, which tables do they come from?" — and returns **no rows** rather than a partial answer when it cannot satisfy the request. That is what makes "the whole group or nobody" a property of one function instead of a rule repeated in four.

**Refusal vocabulary.** Every refusal in this plan raises a fixed message string with a SQLSTATE, and `lib/bookings.ts` maps the message to a sentence. `detail` carries a profile id where the sentence needs a name. The full table is in "Error handling" at the end of this plan; the ones this task raises are `offer expired` (`23514`) and `not your offer` (`42501`).

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/waitlist_promotion.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(24);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- One game, one table of four, starting in a week.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

-- Alice, Bob, Carol and Dan hold all four seats.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
select '9909aaaa-0000-0000-0000-000000000001',
       'e1e1e1e1-0000-0000-0000-000000000001',
       'c1c1c1c1-0000-0000-0000-000000000001',
       '7ab1e000-0000-0000-0000-000000000001', u.id, u.id
from auth.users u
where u.id in ('aaaaaaaa-0000-0000-0000-000000000001',
               'bbbbbbbb-0000-0000-0000-000000000002',
               'cccccccc-0000-0000-0000-000000000003',
               'dddddddd-0000-0000-0000-000000000004');

-- Erin waits alone; Fred waits alone, later.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted',
   now() - interval '2 hours'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted',
   now() - interval '1 hour');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted');

-- ---------------------------------------------------------------------
-- seat_assignments: the single placement rule.
-- ---------------------------------------------------------------------
select is_empty(
  $$select * from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 1,
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a full table yields no assignment');

select results_eq(
  $$select event_table_id, seats from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 2, null, true)$$,
  $$values (null::uuid, 2)$$,
  'a null preferred table means "any table" — unplaced, whatever the split flag');

-- ---------------------------------------------------------------------
-- Nothing free: the walk does nothing at all.
-- ---------------------------------------------------------------------
select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'waitlisted',
  'a full game promotes nobody');
select is(
  (select count(*)::int from public.promotion_offers), 0,
  'and offers nothing');

-- ---------------------------------------------------------------------
-- One seat frees. Erin waited first, so Erin gets it.
-- ---------------------------------------------------------------------
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'dddddddd-0000-0000-0000-000000000004'
 where profile_id = 'dddddddd-0000-0000-0000-000000000004';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'confirmed',
  'the group that waited longest is promoted first');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'and is placed at the table it asked for');
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'confirmed',
  'a group with no waitlisted bookings left is confirmed');
select is(
  (select waitlisted_at from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  null,
  'and its waitlisted_at is cleared');
select is(
  (select status::text from public.bookings
    where profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'waitlisted',
  'the second group waits its turn');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'waitlist_promoted'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'promotion writes one outbox row for the promoted member');

-- ---------------------------------------------------------------------
-- A group too big for the seats available, splitting allowed: an offer,
-- and the seats it names are held against everybody else.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000001', false, 'waitlisted',
   now() - interval '30 minutes');

-- Fred's solo group is withdrawn so the "too big" group is next in line.
update public.booking_groups set status = 'cancelled', waitlisted_at = null
 where id = '9909aaaa-0000-0000-0000-000000000003';
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'ffffffff-0000-0000-0000-000000000006'
 where group_id = '9909aaaa-0000-0000-0000-000000000003';

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted');

-- Two seats free, a group of two that refuses to split, one table with two
-- free seats: this DOES fit, so it is promoted rather than offered.
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'cccccccc-0000-0000-0000-000000000003'
 where profile_id = 'cccccccc-0000-0000-0000-000000000003';

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 1,
  'one seat free before the walk');

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.bookings
    where group_id = '9909aaaa-0000-0000-0000-000000000004'
      and status = 'confirmed'),
  0,
  'a group that will not split is not seated one at a time');
select is(
  (select offered_seat_count from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'),
  null,
  'and a group that will not split is not offered a partial fit either');
select is(
  (select waitlisted_at is not null from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000004'),
  true,
  'it keeps its place instead');

-- Now let it split.
update public.booking_groups set allow_split = true
 where id = '9909aaaa-0000-0000-0000-000000000004';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select offered_seat_count from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'
      and responded_at is null),
  1,
  'a splittable group is offered exactly the seats that exist');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the offered seat is held against everybody else');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'promotion_offer'
      and recipient_id = 'ffffffff-0000-0000-0000-000000000006'),
  1,
  'the booker is told once');

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'),
  1,
  'running the walk again does not stack a second offer on the same group');

-- ---------------------------------------------------------------------
-- Accepting takes the seats offered and keeps the rest of the group in
-- the queue, at its ORIGINAL place.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "ffffffff-0000-0000-0000-000000000006", "role": "authenticated"}';

select is(
  public.accept_promotion_offer(
    (select id from public.promotion_offers
      where group_id = '9909aaaa-0000-0000-0000-000000000004')),
  1,
  'accepting confirms exactly the offered number of seats');

reset role;

select is(
  (select status::text from public.bookings
    where profile_id = 'ffffffff-0000-0000-0000-000000000006'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'confirmed',
  'the booker is seated first');
select is(
  (select status::text from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'waitlisted',
  'the rest of the group stays waitlisted');
select is(
  (select waitlisted_at < now() - interval '20 minutes'
     from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000004'),
  true,
  'and keeps its original place in the queue');

-- ---------------------------------------------------------------------
-- Expiry: the sweep releases the hold and moves on.
-- ---------------------------------------------------------------------
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'aaaaaaaa-0000-0000-0000-000000000001'
 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

update public.promotion_offers
   set expires_at = now() - interval '1 minute'
 where responded_at is null;

select is(public.sweep_promotion_offers(), 1,
  'the sweep expires exactly the offers past their time');
select is(
  (select outcome::text from public.promotion_offers
    where expires_at < now() and outcome is not null
    order by created_at desc limit 1),
  'expired',
  'an unanswered offer is recorded as expired, not deleted');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'promotion_offer_expired'),
  1,
  'and the booker is told it lapsed');

-- The seat the lapsed offer held went to the next member of the same
-- group, because nobody else was waiting.
select is(
  (select status::text from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'confirmed',
  'a released seat is promoted in the same sweep');

-- ---------------------------------------------------------------------
-- Only the booker may answer an offer.
-- ---------------------------------------------------------------------
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '1 hour');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_promotion_offer(
      '0ffe0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member of the group who did not book it cannot answer the offer');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `waitlist_promotion.test.sql` fails — `function public.seat_assignments(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825010000_waitlist_promotion.sql`:

```sql
/*
 * The waitlist.
 *
 * Promotion runs INLINE, inside whichever transaction freed the seat —
 * cancel, decline, host removal, adding a table. `pg_cron` only expires
 * offers. A member watching the screen after a friend drops out is seated
 * immediately rather than up to five minutes later in front of a visibly
 * empty seat.
 *
 * Two rules are worth naming before reading the code:
 *
 *   1. A group skipped for not fitting keeps its waitlisted_at, and
 *      therefore its place. Nothing renumbers.
 *
 *   2. An outstanding offer HOLDS its seats (event_held_seats subtracts
 *      them), so the two hours a group has to answer are two hours nobody
 *      can take the seats out from under them.
 */

/*
 * The single placement rule, used by promotion here and by the booking
 * planner in the next migration.
 *
 * Returns NO ROWS rather than a partial answer when the request cannot be
 * satisfied. "The whole group or nobody" is a property of this function,
 * not a rule repeated by each caller.
 *
 * ONE EXCEPTION, and callers must know it: the `preferred is null` ("any
 * table") branch answers "unplaced, all of them" without consulting
 * capacity at all. Nobody is being placed, so there is no table to run out
 * of — but EVENT-level capacity is then the caller's responsibility.
 * Both callers already check it: promote_waitlist only calls in when
 * free >= wanted, and plan_seating checks event_free_seats first.
 */
create function public.seat_assignments(
  target_event uuid,
  want         int,
  preferred    uuid,
  allow_split  boolean
)
returns table (event_table_id uuid, seats int)
language plpgsql
stable
set search_path = public
as $$
declare
  remaining int := want;
  single    uuid;
  ids       uuid[] := '{}';
  counts    int[]  := '{}';
  t         record;
  i         int;
begin
  if want is null or want <= 0 then
    return;
  end if;

  -- "Any table". Nobody is placed, by request, so allow_split has nothing
  -- to act on: a group nobody seats is trivially sitting together.
  if preferred is null then
    event_table_id := null;
    seats := want;
    return next;
    return;
  end if;

  -- Keep us together: one table has to hold all of us. Preferred first,
  -- then the rest in position order. Note this is NOT "the preferred table
  -- or nothing" — the request is togetherness, not that specific table.
  if not allow_split then
    select s.id into single from (
      select tt.id, (tt.id = preferred) as is_preferred, tt.position
      from public.event_tables tt
      where tt.event_id = target_event
        and public.table_free_seats(tt.id) >= want
      order by is_preferred desc, tt.position
    ) s limit 1;

    if single is null then
      return;
    end if;

    event_table_id := single;
    seats := want;
    return next;
    return;
  end if;

  for t in
    select tt.id, public.table_free_seats(tt.id) as room
    from public.event_tables tt
    where tt.event_id = target_event
    order by (tt.id = preferred) desc, tt.position
  loop
    exit when remaining <= 0;
    if t.room > 0 then
      ids    := ids || t.id;
      counts := counts || least(t.room, remaining);
      remaining := remaining - least(t.room, remaining);
    end if;
  end loop;

  -- Could not seat everybody. Emit nothing: a partial plan is not an
  -- answer to the question that was asked.
  if remaining > 0 then
    return;
  end if;

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    event_table_id := ids[i];
    seats := counts[i];
    return next;
  end loop;
end;
$$;

/*
 * Confirm up to `want` of a group's waitlisted bookings and place them.
 *
 * Returns how many were actually confirmed — 0 means the group could not
 * be satisfied and must keep waiting. The caller does not decide placement;
 * seat_assignments does.
 *
 * Order within the group is the booker first, then the order they were
 * added. Nobody has asked for the booker to choose who gets a partial fit;
 * if they do, that is an argument to accept_promotion_offer, not a
 * different rule here.
 */
create function public.confirm_group_seats(target_group uuid, want int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  a       record;
  b       record;
  taken   int := 0;
  filled  int;
begin
  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    return 0;
  end if;

  -- Before reading any count. A no-op when the caller already holds it.
  perform 1 from public.events where id = g.event_id for update;

  for a in
    select * from public.seat_assignments(
      g.event_id, want, g.preferred_table_id, g.allow_split)
  loop
    filled := 0;
    for b in
      select bk.id from public.bookings bk
      where bk.group_id = target_group and bk.status = 'waitlisted'
      order by (bk.profile_id = g.created_by) desc, bk.created_at, bk.id
      limit a.seats
    loop
      update public.bookings
         set status = 'confirmed', event_table_id = a.event_table_id
       where id = b.id;
      filled := filled + 1;
      taken  := taken + 1;
    end loop;
    exit when filled = 0;
  end loop;

  if taken = 0 then
    return 0;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select bk.profile_id, g.club_id, g.event_id, 'waitlist_promoted',
         jsonb_build_object('booking_id', bk.id,
                            'event_table_id', bk.event_table_id),
         'waitlist_promoted:' || bk.id::text
  from public.bookings bk
  where bk.group_id = target_group and bk.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  -- A group with nobody left in the queue is no longer a waiting group.
  if not exists (
    select 1 from public.bookings
    where group_id = target_group and status = 'waitlisted')
  then
    update public.booking_groups
       set status = 'confirmed', waitlisted_at = null
     where id = target_group;
  end if;

  return taken;
end;
$$;

/*
 * The walk. Called by every path that frees a seat, and by the sweep.
 *
 * Takes the event lock itself rather than trusting its callers to hold
 * it. Re-acquiring a row lock already held in the same transaction is a
 * no-op, so this is free at every call site that already locked — and it
 * means the guarantee does not rest on each of Tasks 3-6 remembering.
 */
create function public.promote_waitlist(target_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        record;
  g         record;
  free      int;
  wanted    int;
  seated    int;
  new_offer uuid;
begin
  perform 1 from public.events where id = target_event for update;

  select id, status, starts_at, club_id into ev
  from public.events where id = target_event;

  -- A cancelled or already-started game promotes nobody. Without the
  -- second test an offer could be created with expires_at in the past.
  if ev.id is null or ev.status <> 'published' or ev.starts_at <= now() then
    return;
  end if;

  for g in
    select * from public.booking_groups
    where event_id = target_event and status = 'waitlisted'
    order by waitlisted_at, created_at, id
  loop
    free := public.event_free_seats(target_event);
    exit when free <= 0;

    -- A group already holding an offer is waiting on its own answer, not
    -- on us.
    continue when exists (
      select 1 from public.promotion_offers
      where group_id = g.id and responded_at is null);

    select count(*) into wanted from public.bookings
    where group_id = g.id and status = 'waitlisted';
    continue when wanted = 0;

    if free >= wanted then
      seated := public.confirm_group_seats(g.id, wanted);
      -- 0 means allow_split is off and no single table holds them all.
      -- The group keeps its waitlisted_at, and therefore its place.
      continue when seated = 0;
    elsif g.preferred_table_id is null or g.allow_split then
      insert into public.promotion_offers
        (group_id, event_id, offered_seat_count, expires_at)
      values (g.id, target_event, free,
              least(now() + interval '2 hours', ev.starts_at))
      returning id into new_offer;

      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (g.created_by, ev.club_id, target_event, 'promotion_offer',
              jsonb_build_object('offer_id', new_offer, 'seats', free),
              'promotion_offer:' || new_offer::text);
    end if;
    -- else: a group that asked to stay together at a table cannot be
    -- offered part of itself. Skipped, place retained.
  end loop;
end;
$$;

create function public.accept_promotion_offer(target_offer uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o      record;
  g      record;
  caller uuid;
  seated int;
begin
  select * into o from public.promotion_offers where id = target_offer;
  if o.id is null then
    raise exception 'no such offer' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = o.group_id;
  -- `<>` against a null auth.uid() is NULL, not true, so the guard would
  -- not fire and a caller with no `sub` claim would answer somebody else's
  -- offer. Bind and refuse null explicitly, as accept_club_invite does.
  caller := auth.uid();
  if caller is null or g.created_by <> caller then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  perform 1 from public.events where id = o.event_id for update;

  -- Re-read under the lock: the sweep may have expired it in between.
  select * into o from public.promotion_offers where id = target_offer;
  if o.responded_at is not null or o.expires_at <= now() then
    raise exception 'offer expired' using errcode = '23514';
  end if;

  -- Release the hold FIRST, so the seats this group was holding are
  -- available to itself.
  update public.promotion_offers
     set responded_at = now(), outcome = 'accepted'
   where id = o.id;

  seated := public.confirm_group_seats(o.group_id, o.offered_seat_count);
  perform public.promote_waitlist(o.event_id);
  return seated;
end;
$$;

create function public.decline_promotion_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o      record;
  g      record;
  caller uuid;
begin
  select * into o from public.promotion_offers where id = target_offer;
  if o.id is null then
    raise exception 'no such offer' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = o.group_id;
  caller := auth.uid();
  if caller is null or g.created_by <> caller then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  perform 1 from public.events where id = o.event_id for update;

  update public.promotion_offers
     set responded_at = now(), outcome = 'declined'
   where id = o.id and responded_at is null;

  perform public.promote_waitlist(o.event_id);
end;
$$;

/*
 * Every five minutes. The ONLY thing the schedule is responsible for:
 * everything else promotes inline.
 */
create function public.sweep_promotion_offers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o     record;
  swept int := 0;
begin
  for o in
    select po.id, po.group_id, po.event_id, bg.created_by, bg.club_id
    from public.promotion_offers po
    join public.booking_groups bg on bg.id = po.group_id
    where po.responded_at is null and po.expires_at <= now()
    order by po.expires_at
  loop
    perform 1 from public.events where id = o.event_id for update;

    update public.promotion_offers
       set responded_at = now(), outcome = 'expired'
     where id = o.id and responded_at is null;

    if found then
      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (o.created_by, o.club_id, o.event_id, 'promotion_offer_expired',
              jsonb_build_object('offer_id', o.id),
              'promotion_offer_expired:' || o.id::text)
      on conflict (dedupe_key) do nothing;

      swept := swept + 1;
      perform public.promote_waitlist(o.event_id);
    end if;
  end loop;

  return swept;
end;
$$;

revoke execute on function public.seat_assignments(uuid, int, uuid, boolean)
  from public, anon;
revoke execute on function public.confirm_group_seats(uuid, int)
  from public, anon;
revoke execute on function public.promote_waitlist(uuid)      from public, anon;
revoke execute on function public.sweep_promotion_offers()    from public, anon;
revoke execute on function public.accept_promotion_offer(uuid)  from public, anon;
revoke execute on function public.decline_promotion_offer(uuid) from public, anon;

-- Only the two the client calls.
grant execute on function public.accept_promotion_offer(uuid)  to authenticated;
grant execute on function public.decline_promotion_offer(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `waitlist_promotion.test.sql .. ok`, 24 of 24.

- [ ] **Step 5: Mutation-check the assertions**

| Mutation | Must break |
|---|---|
| `order by waitlisted_at` → `order by created_at desc` in `promote_waitlist` | "the group that waited longest is promoted first" |
| Delete the `continue when exists (… responded_at is null)` guard | "running the walk again does not stack a second offer on the same group" |
| Change `elsif g.preferred_table_id is null or g.allow_split` to `elsif true` | "a group that will not split is not offered a partial fit either" |
| In `seat_assignments`, emit the partial plan instead of `return` when `remaining > 0` | "a group that will not split is not seated one at a time" |
| Drop `and waitlisted_at = null` from the confirm branch of `confirm_group_seats` (leave the status update) | "and its waitlisted_at is cleared" — and note the check constraint should also refuse it |
| In `confirm_group_seats`, drop `(bk.profile_id = g.created_by) desc` from the order | "the booker is seated first" |
| In `accept_promotion_offer`, set `waitlisted_at = now()` on the group | "and keeps its original place in the queue" |
| In `sweep_promotion_offers`, `delete from public.promotion_offers` instead of updating | "an unanswered offer is recorded as expired, not deleted" |
| Remove `perform public.promote_waitlist(o.event_id)` from the sweep | "a released seat is promoted in the same sweep" |
| Remove the `caller is null or g.created_by <> caller` check in `accept_promotion_offer` | "a member of the group who did not book it cannot answer the offer" |
| Change that check back to a bare `g.created_by <> auth.uid()` | the null-caller assertion — if none goes red, the null-safety fix has no test and one must be added |

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825010000_waitlist_promotion.sql \
        supabase/tests/database/fixtures/waitlist_promotion.test.sql
git commit -m "feat(db): promote the waitlist inline, and hold offered seats

promote_waitlist walks a game's waiting groups oldest-first and either
seats a group whole, offers it the seats that exist, or skips it — and a
skipped group keeps its waitlisted_at, so keeping your place needs no
renumbering.

seat_assignments is the single placement rule and returns NO ROWS rather
than a partial answer, which is what makes \"the whole group or nobody\" a
property of one function instead of a rule repeated by every caller.

An outstanding offer holds its seats through event_held_seats. Without
that, the two hours a group has to answer are two hours during which a
faster member takes the seat that was promised."
```

---

### Task 3: Propose and commit a booking

**Files:**
- Create: `supabase/migrations/20260825020000_booking_mutations.sql`
- Create: `supabase/tests/database/fixtures/bookings_commit.test.sql`
- Create: `lib/booking-concurrency.test.ts`
- Modify: `package.json` (one script)

**Interfaces:**
- Consumes: Task 1's tables and helpers; Task 2's `seat_assignments` and `promote_waitlist`.
- Produces: `assert_event_bookable(uuid) returns uuid` (the club id); `assert_players_bookable(uuid, uuid, uuid[]) returns void`; `plan_seating(uuid, uuid[], uuid, boolean) returns jsonb`; `booking_result(uuid) returns jsonb`; `propose_booking(uuid, uuid[], uuid, boolean) returns jsonb`; `commit_booking(uuid, uuid[], uuid, boolean) returns jsonb`. Task 8's data layer calls the last two by name.

**The returned shape**, relied on by `lib/bookings.ts` and by every later screen task:

```json
{
  "outcome": "seated" | "waitlisted",
  "split": true,
  "group_id": "uuid",
  "waitlist_position": 2,
  "offer": { "id": "uuid", "seats": 1, "expires_at": "2026-08-25T18:15:00Z" },
  "placements": [
    { "profile_id": "uuid", "event_table_id": "uuid", "table_label": "Table 2" }
  ]
}
```

`propose_booking` returns the same object with `group_id`, `waitlist_position` and `offer` null, and writes nothing. `event_table_id` and `table_label` are null for an "any table" placement.

**Why `commit_booking` takes the same arguments as `propose_booking` rather than a plan.** There is no proposal token to go stale, to replay, or to forge. The commit re-derives the plan under the event lock and returns what it actually did; the client compares that against what it showed the member and says what changed. The parent spec's `commit_booking(plan)` would have required either trusting client-supplied placements or storing and expiring proposals — a whole extra lifecycle for no gain.

**A solo tap-to-book calls `commit_booking` directly with a one-element array.** For one player there is nothing to confirm, so the proposal round trip would buy a dialog nobody needs.

**`seat_assignments` (Task 2) is the placement authority, with one caveat you must respect.** Its `preferred is null` branch answers "unplaced, all of them" **without consulting capacity** — nobody is being placed, so there is no table to run out of. Event-level capacity is therefore the caller's job, which is why `plan_seating` below checks `event_free_seats(target_event) < n` *before* it calls `seat_assignments` and not after. Do not reorder those two.

**The database does not check skill tiers.** The client warns; the member decides. These functions stay a pure capacity-and-atomicity concern, and the fixture asserts a beginner *can* take a seat at an advanced table so that nobody "fixes" this later.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/bookings_commit.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(27);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),
  ('99999999-0000-0000-0000-000000000007', 'gina@example.com'),
  ('88888888-0000-0000-0000-000000000008', 'hank@example.com'),
  ('77777777-0000-0000-0000-000000000009', 'ivy@example.com'),
  ('66666666-0000-0000-0000-000000000010', 'jack@example.com'),
  ('55555555-0000-0000-0000-000000000011', 'kim@example.com'),
  ('44444444-0000-0000-0000-000000000012', 'lee@example.com');

update public.profiles set skill_level = 'beginner'
 where id = 'cccccccc-0000-0000-0000-000000000003';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

-- Everyone but Bob is in Riverside. Bob is the outsider.
insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users where id <> 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.club_members (club_id, profile_id, role) values
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 is the game under test: Table 1 (mixed, 4) and Table 2 (advanced, 2),
-- capacity 6. E2 is cancelled and E3 has already started; both exist only
-- to be refused.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, status, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '8 days', now() + interval '8 days 3 hours',
   'cancelled', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last week',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 day', now() - interval '21 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'advanced', 2, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- One member, one seat, one tap.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a member books themselves a seat');

select is(
  (select status::text from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'confirmed',
  'the booking is confirmed, not pending anything');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'at the table they tapped');

reset role;
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 5,
  'a seat is gone from the game');

-- ---------------------------------------------------------------------
-- Tiers are advisory. Carol is a beginner; Table 2 is advanced. The
-- WARNING is the client's job, and this assertion exists so nobody
-- "fixes" that by adding a check here.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'the database does not enforce skill tiers');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  '7ab1e000-0000-0000-0000-000000000002'::uuid,
  'a beginner may sit at the advanced table if they choose to');

-- ---------------------------------------------------------------------
-- "Any table": confirmed, unplaced, and it still costs the game a seat.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['dddddddd-0000-0000-0000-000000000004']::uuid[],
      null, true)$$,
  'a member books without caring where they sit');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  null,
  'an "any table" booking is placed nowhere');

reset role;
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'and still costs the game a seat');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'while costing no table one');

-- ---------------------------------------------------------------------
-- Refusals.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  '23514',
  'already booked',
  'a second seat for the same person in the same game is refused');

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  '23514',
  'not a member',
  'somebody outside the club cannot be booked into its game');

select throws_ok(
  $$select public.commit_booking(
      'e2e2e2e2-0000-0000-0000-000000000002',
      array['eeeeeeee-0000-0000-0000-000000000005']::uuid[],
      null, true)$$,
  '23514',
  'event not bookable',
  'a cancelled game takes no bookings');

select throws_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['eeeeeeee-0000-0000-0000-000000000005']::uuid[],
      '7ab1e000-0000-0000-0000-000000000003', true)$$,
  '23514',
  'event already started',
  'a game that has started takes no bookings');

-- ---------------------------------------------------------------------
-- Three friends, three free seats, two tables. Propose first.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select is(
  (select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)->>'outcome'),
  'seated',
  'three into three fits');
select is(
  (select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)->>'split'),
  'true',
  'and it says plainly that they will be split up');

reset role;
select is((select count(*)::int from public.bookings), 3,
  'proposing wrote nothing');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'committing the split books all three');

reset role;
select is(
  (select count(distinct event_table_id)::int from public.bookings
    where booked_by = 'eeeeeeee-0000-0000-0000-000000000005'),
  2,
  'across the two tables the proposal named');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'),
  2,
  'the two friends are told their seats were booked for them');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  0,
  'and the booker is not told about her own seat');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the game is now full');

-- ---------------------------------------------------------------------
-- Full: the next member waits.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "88888888-0000-0000-0000-000000000008", "role": "authenticated"}';

select is(
  (select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['88888888-0000-0000-0000-000000000008']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)->>'outcome'),
  'waitlisted',
  'a full game puts the next member on the waitlist');
select is(
  (select public.booking_result(id)->>'waitlist_position'
     from public.booking_groups
    where created_by = '88888888-0000-0000-0000-000000000008'),
  '1',
  'and tells them where they stand');

-- ---------------------------------------------------------------------
-- Two seats free but no single table holds two, and this group will not
-- split. It waits — even though the game has room.
-- ---------------------------------------------------------------------
reset role;
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = profile_id
 where profile_id in ('cccccccc-0000-0000-0000-000000000003',
                      '99999999-0000-0000-0000-000000000007');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "77777777-0000-0000-0000-000000000009", "role": "authenticated"}';

select is(
  (select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['77777777-0000-0000-0000-000000000009',
            '66666666-0000-0000-0000-000000000010']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', false)->>'outcome'),
  'waitlisted',
  'a group that will not split waits until one table can hold it');

reset role;
select is(
  (select status::text from public.bookings
    where profile_id = '88888888-0000-0000-0000-000000000008'),
  'confirmed',
  'and committing it promoted the member who was already waiting');

-- ---------------------------------------------------------------------
-- One seat free, a splittable pair: an offer, immediately.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "55555555-0000-0000-0000-000000000011", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['55555555-0000-0000-0000-000000000011',
            '44444444-0000-0000-0000-000000000012']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a splittable pair with one seat free is accepted onto the waitlist');

reset role;
select is(
  (select offered_seat_count from public.promotion_offers po
     join public.booking_groups bg on bg.id = po.group_id
    where bg.created_by = '55555555-0000-0000-0000-000000000011'),
  1,
  'and is offered the one seat that exists, without waiting for the sweep');

-- ---------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[],
      null, true)$$,
  '42501',
  null,
  'a member of another club cannot book into this one''s game');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `bookings_commit.test.sql` fails — `function public.commit_booking(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825020000_booking_mutations.sql`:

```sql
/*
 * Booking a seat.
 *
 * propose_booking reads and returns a plan. commit_booking takes THE SAME
 * ARGUMENTS — not the plan — re-derives it under the event lock, and
 * writes it atomically. There is no proposal token to go stale, to replay,
 * or to forge, and the client compares what came back against what it
 * showed the member.
 *
 * Skill tiers are NOT checked here and must not be. The client warns and
 * the member decides; these functions are a capacity-and-atomicity
 * concern. The fixture asserts a beginner can take an advanced table's
 * seat precisely so that this stays true.
 */

create function public.assert_event_bookable(target_event uuid)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  ev record;
begin
  select id, club_id, status, starts_at into ev
  from public.events where id = target_event;

  if ev.id is null then
    raise exception 'no such event' using errcode = '42501';
  end if;
  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  return ev.club_id;
end;
$$;

/*
 * `detail` carries the profile id the refusal is about, so the client can
 * name the person from the roster it already holds. PostgREST surfaces it
 * as `details` alongside `message`.
 */
create function public.assert_players_bookable(
  target_club  uuid,
  target_event uuid,
  players      uuid[]
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  p uuid;
begin
  if coalesce(array_length(players, 1), 0) = 0 then
    raise exception 'no players' using errcode = '23514';
  end if;

  if array_length(players, 1) <>
     (select count(distinct x)::int from unnest(players) x) then
    raise exception 'duplicate player' using errcode = '23514';
  end if;

  foreach p in array players loop
    if not exists (
      select 1 from public.club_members
      where club_id = target_club and profile_id = p and status = 'active')
    then
      raise exception 'not a member'
        using errcode = '23514', detail = p::text;
    end if;

    if exists (
      select 1 from public.bookings
      where event_id = target_event and profile_id = p
        and status in ('confirmed', 'waitlisted'))
    then
      raise exception 'already booked'
        using errcode = '23514', detail = p::text;
    end if;
  end loop;
end;
$$;

/*
 * The plan. Read-only, and the only place that turns "these people, this
 * table, this split preference" into placements.
 */
create function public.plan_seating(
  target_event uuid,
  players      uuid[],
  preferred    uuid,
  allow_split  boolean
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  n          int := coalesce(array_length(players, 1), 0);
  a          record;
  i          int;
  idx        int := 1;
  placements jsonb := '[]'::jsonb;
begin
  if n = 0 then
    raise exception 'no players' using errcode = '23514';
  end if;

  -- A preferred table that does not belong to this event is not a
  -- tiebreak, it is a mistake. seat_assignments only uses `preferred` to
  -- order the event's OWN tables, so without this check a foreign or
  -- just-deleted id degrades silently to position order and
  -- propose_booking answers "seated" — then commit_booking dies on
  -- booking_groups' composite foreign key with a bare 23503 and no
  -- sentence anybody can act on. Reachable without tampering:
  -- remove_event_table hard-deletes the row, so a member holding the
  -- event screen open taps a table that no longer exists.
  if preferred is not null and not exists (
    select 1 from public.event_tables
    where id = preferred and event_id = target_event)
  then
    raise exception 'no such table' using errcode = '23514';
  end if;

  -- Admission is an EVENT-level question. No group is ever half-admitted
  -- at commit time; a group too big for the room waits as one.
  if public.event_free_seats(target_event) < n then
    return jsonb_build_object(
      'outcome', 'waitlisted', 'split', false,
      'placements', '[]'::jsonb);
  end if;

  if not exists (
    select 1 from public.seat_assignments(
      target_event, n, preferred, allow_split))
  then
    -- Room in the game, but not in the shape this group asked for.
    return jsonb_build_object(
      'outcome', 'waitlisted', 'split', false,
      'placements', '[]'::jsonb);
  end if;

  for a in
    select * from public.seat_assignments(
      target_event, n, preferred, allow_split)
  loop
    for i in 1 .. a.seats loop
      placements := placements || jsonb_build_array(jsonb_build_object(
        'profile_id', players[idx],
        'event_table_id', a.event_table_id,
        'table_label', (select label from public.event_tables
                         where id = a.event_table_id)));
      idx := idx + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'outcome', 'seated',
    'split', (select count(distinct (p->>'event_table_id')) > 1
              from jsonb_array_elements(placements) p),
    'placements', placements);
end;
$$;

/*
 * What actually happened, read back from the rows rather than echoed from
 * the plan. The client compares this against what it displayed.
 *
 * waitlist_position uses the same ordering promote_waitlist walks, so a
 * member is never told "2nd" by one function and promoted third by
 * another.
 */
create function public.booking_result(target_group uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id,
    -- Three group statuses, not two. Lumping `cancelled` in with
    -- `seated` would be wrong for the exact consumer the grant below
    -- names: the data layer reading this back AFTER a cancellation.
    'outcome', case g.status
                 when 'waitlisted' then 'waitlisted'
                 when 'cancelled'  then 'cancelled'
                 else 'seated' end,
    'split', (
      select count(distinct b.event_table_id) > 1
      from public.bookings b
      where b.group_id = g.id and b.status = 'confirmed'
        and b.event_table_id is not null),
    'waitlist_position', case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    'offer', (
      select jsonb_build_object('id', po.id, 'seats', po.offered_seat_count,
                                'expires_at', po.expires_at)
      from public.promotion_offers po
      where po.group_id = g.id and po.responded_at is null),
    'placements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', b.profile_id,
        'event_table_id', b.event_table_id,
        'table_label', t.label) order by b.created_at, b.id)
      from public.bookings b
      left join public.event_tables t on t.id = b.event_table_id
      where b.group_id = g.id and b.status in ('confirmed', 'waitlisted')
    ), '[]'::jsonb))
  from public.booking_groups g where g.id = target_group;
$$;

/*
 * Read-only, and deliberately takes no lock: it is advice, not a
 * reservation. commit_booking re-derives everything under the lock.
 */
create function public.propose_booking(
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
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  return public.plan_seating(target_event, players, preferred, allow_split)
       || jsonb_build_object('group_id', null,
                             'waitlist_position', null,
                             'offer', null);
end;
$$;

create function public.commit_booking(
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

  -- Securing the seats is the whole point of booking for a friend; the
  -- message is what gives the person actually attending a way out that
  -- does not involve texting the booker.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booked_by_friend',
         jsonb_build_object('booking_id', b.id, 'booked_by', auth.uid()),
         'booked_by_friend:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.profile_id <> auth.uid();

  -- A group can be waitlisted with seats still free — it was simply too
  -- big for them, or asked to stay together. Walking the queue now is
  -- what turns that into an offer immediately instead of in five minutes.
  if seating->>'outcome' <> 'seated' then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.assert_event_bookable(uuid) from public, anon;
revoke execute on function public.assert_players_bookable(uuid, uuid, uuid[])
  from public, anon;
revoke execute on function public.plan_seating(uuid, uuid[], uuid, boolean)
  from public, anon;
revoke execute on function public.booking_result(uuid) from public, anon;
revoke execute on function public.propose_booking(uuid, uuid[], uuid, boolean)
  from public, anon;
revoke execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  from public, anon;

grant execute on function public.propose_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
grant execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
-- booking_result is read back by the two functions above and by the data
-- layer after a cancellation, so the client needs it.
grant execute on function public.booking_result(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `bookings_commit.test.sql .. ok`, 27 of 27, and the three earlier fixtures still green.

- [ ] **Step 5: Write the concurrency test**

pgTAP runs in one session and cannot prove a race is impossible. This test opens two real authenticated clients against the local stack and fires `commit_booking` for the same last seat simultaneously.

Create `lib/booking-concurrency.test.ts`:

```ts
/**
 * The race the event lock exists to lose.
 *
 * pgTAP runs in a single session, so it can assert the RULES of seat
 * allocation but never that two people cannot take the same seat. This
 * test signs in two real users against the local stack and fires
 * commit_booking for the last remaining seat at the same moment.
 *
 * Verified by mutation: removing `perform 1 from public.events where
 * id = target_event for update` from commit_booking turns this suite red
 * and leaves the table with five bookings in four seats.
 *
 * Requires the local Supabase stack. Skips with a warning without it, so
 * `npm test` stays runnable; `npm run test:concurrency` makes an
 * unreachable stack a hard failure.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_LOCAL_API_URL ?? 'http://127.0.0.1:54321';
const anonKey =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const serviceKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const required = process.env.REQUIRE_LOCAL_SUPABASE === '1';

let admin: SupabaseClient;
let reachable = false;
let clubId = '';
let eventId = '';
let tableId = '';
const players: { email: string; id: string; client: SupabaseClient }[] = [];

const PASSWORD = 'seat-race-password-1';

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signIn.error) throw signIn.error;
  return { email, id: data.user!.id, client };
}

beforeAll(async () => {
  admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const probe = await admin.from('clubs').select('id').limit(1);
    reachable = !probe.error;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    if (required) throw new Error('local Supabase stack is not reachable');
    console.warn('skipping: local Supabase stack not reachable');
    return;
  }

  const stamp = Date.now();
  for (const name of ['racer-a', 'racer-b', 'racer-host']) {
    players.push(await makeUser(`${name}-${stamp}@example.com`));
  }
  const host = players[2];

  const club = await admin
    .from('clubs')
    .insert({
      name: `Race ${stamp}`,
      slug: `race-${stamp}`,
      timezone: 'America/New_York',
      created_by: host.id,
    })
    .select('id')
    .single();
  if (club.error) throw club.error;
  clubId = club.data.id;

  await admin.from('club_members').insert(
    players.map((p) => ({
      club_id: clubId,
      profile_id: p.id,
      role: p.id === host.id ? 'host' : 'member',
    })),
  );

  const venue = await admin
    .from('venues')
    .insert({ name: `Hall ${stamp}`, added_by_club_id: clubId, created_by: host.id })
    .select('id')
    .single();
  if (venue.error) throw venue.error;

  const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const ends = new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3 * 3600 * 1000).toISOString();
  const event = await admin
    .from('events')
    .insert({
      club_id: clubId,
      title: 'Race game',
      venue_id: venue.data.id,
      starts_at: starts,
      ends_at: ends,
      created_by: host.id,
    })
    .select('id')
    .single();
  if (event.error) throw event.error;
  eventId = event.data.id;

  // One table, ONE seat. Both racers want it.
  const table = await admin
    .from('event_tables')
    .insert({
      event_id: eventId,
      club_id: clubId,
      label: 'Table 1',
      capacity: 1,
      position: 1,
    })
    .select('id')
    .single();
  if (table.error) throw table.error;
  tableId = table.data.id;
});

afterAll(async () => {
  if (!reachable) return;
  await admin.from('clubs').delete().eq('id', clubId);
  for (const p of players) await admin.auth.admin.deleteUser(p.id);
});

describe('two members racing for the last seat', () => {
  it('gives it to exactly one of them', async () => {
    if (!reachable) return;

    const [a, b] = await Promise.all([
      players[0].client.rpc('commit_booking', {
        target_event: eventId,
        players: [players[0].id],
        preferred: tableId,
        allow_split: true,
      }),
      players[1].client.rpc('commit_booking', {
        target_event: eventId,
        players: [players[1].id],
        preferred: tableId,
        allow_split: true,
      }),
    ]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const outcomes = [a.data?.outcome, b.data?.outcome].sort();
    expect(outcomes).toEqual(['seated', 'waitlisted']);

    const seated = await admin
      .from('bookings')
      .select('id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');
    expect(seated.data?.length).toBe(1);
  });
});
```

Add the script to `package.json`:

```json
"test:concurrency": "TZ=America/New_York REQUIRE_LOCAL_SUPABASE=1 vitest run lib/booking-concurrency.test.ts"
```

**The race must be run repeatedly, and the clients warmed first.** Measured on this branch: with the lock removed, the very first RPC after a cold start still produced a correct result about one run in seven — connection, auth and pool warm-up serialize the two calls by accident. CI only ever runs the cold case, so a single race is a detector with a ~14% false-green rate on the only run that happens. Issue one throwaway authenticated call per racer client in `beforeAll` after sign-in, and run the race over five fresh one-seat events, asserting exactly one seated and one waitlisted each time.

**Reachability must skip, not pass.** `if (!reachable) return;` inside an `it` body is a passing test that asserted nothing, and `npm test` counts it. Probe at module scope and use `describe.runIf(reachable || required)`, exactly as `lib/schema-contract.test.ts` already does.

- [ ] **Step 6: Run the concurrency test, then break the lock to prove it works**

```bash
npm run test:concurrency
```

Expected: PASS, one seated and one waitlisted.

Then, inside a transaction against the local database, replace `commit_booking` with a copy that omits the `for update` line, re-run, and confirm the suite goes **red** with two confirmed bookings in a one-seat table. Roll back.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "\i /tmp/commit_booking_without_lock.sql"
npm run test:concurrency   # must FAIL
npx supabase db reset      # restore
```

- [ ] **Step 7: Mutation-check the pgTAP assertions**

| Mutation | Must break |
|---|---|
| Delete the `already booked` branch of `assert_players_bookable` | "a second seat for the same person in the same game is refused" (the unique index still refuses, but with 23505 and no `detail` — so the test's message match is what catches it) |
| Delete the `status = 'active'` clause from the member check | "somebody outside the club cannot be booked into its game" |
| Change `ev.starts_at <= now()` to `ev.starts_at < ev.starts_at` | "a game that has started takes no bookings" |
| In `plan_seating`, drop the `event_free_seats < n` test | "a full game puts the next member on the waitlist" |
| In `commit_booking`, insert the outbox row for every player rather than `profile_id <> auth.uid()` | "and the booker is not told about her own seat" |
| Remove `perform public.promote_waitlist(target_event)` from `commit_booking` | "and committing it promoted the member who was already waiting" **and** "is offered the one seat that exists, without waiting for the sweep" |
| Make `propose_booking` write by calling `commit_booking` | "proposing wrote nothing" |
| Remove the `is_club_member` check from `commit_booking` | "a member of another club cannot book into this one's game" |

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260825020000_booking_mutations.sql \
        supabase/tests/database/fixtures/bookings_commit.test.sql \
        lib/booking-concurrency.test.ts package.json
git commit -m "feat(db): book a seat, alone or with friends

propose_booking returns a plan and writes nothing; commit_booking takes
the same arguments rather than the plan, re-derives it under the event's
row lock, and writes it atomically. No proposal token means nothing to
replay, forge, or expire.

Admission is an event-level question: a group too big for the room waits
as one rather than being half-admitted. A group that asks to stay together
waits even when the game has room, because the request was togetherness.

Skill tiers are deliberately not checked here — the fixture asserts a
beginner CAN take an advanced table's seat, so that the client's warning
stays a warning.

Adds lib/booking-concurrency.test.ts, which pgTAP cannot substitute for:
two signed-in clients firing at the same last seat, one seated and one
waitlisted. Removing the for-update makes it red."
```

---

### Task 4: Leaving a seat, and being placed in one

**Files:**
- Create: `supabase/migrations/20260825030000_booking_cancellation.sql`
- Create: `supabase/tests/database/fixtures/bookings_cancellation.test.sql`

**Interfaces:**
- Consumes: Task 1's tables, Task 2's `promote_waitlist`, Task 3's `booking_result`.
- Produces: `close_group_if_empty(uuid) returns void`; `cancel_booking(uuid) returns jsonb`; `decline_booking(uuid) returns jsonb`; `cancel_booking_group(uuid) returns jsonb`; `place_booking(uuid, uuid) returns jsonb`. Task 5 calls `close_group_if_empty`; Task 8 calls the four granted functions.

**One `cancel_booking`, three callers.** The member themselves, the booker who created the row, and any organizer of the club. The difference between them lives entirely in the guard and in `cancelled_by`, so three functions would be three copies of one body.

**Declining is not cancelling.** `decline_booking` belongs to the person whose seat it is, and only when somebody else booked it. It exists so the booker's outbox row can say "Jane declined the seat you booked" rather than "Jane cancelled" — different things to receive, and the parent spec's one-tap decline is the exit that does not require texting the booker.

**Everything is refused once the game has started.** A seat freed mid-game frees nothing, and a no-show is plan 5's concept. This is a rule, not an oversight.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/bookings_cancellation.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(20);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Alice hosts. Everyone else is an ordinary member.
insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last week',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 day', now() - interval '21 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

-- Carol books herself and Dan. Two seats, table full.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003'),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'cccccccc-0000-0000-0000-000000000003');

-- Erin is waiting.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted', now());

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

-- Bob has a seat at last week's game, which is over.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000009',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000003');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values ('b00c0000-0000-0000-0000-000000000009',
        '9909aaaa-0000-0000-0000-000000000009',
        'e3e3e3e3-0000-0000-0000-000000000003',
        'c1c1c1c1-0000-0000-0000-000000000001',
        '7ab1e000-0000-0000-0000-000000000003',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------
-- Who may end a booking.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'an unrelated member cannot cancel somebody else''s seat');

select throws_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000009')$$,
  '23514',
  'event already started',
  'a seat at a game that has started cannot be given up');

-- Dan gives up his own seat. Erin is waiting, so she takes it in the same
-- transaction — this is the whole point of promoting inline.
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000002')$$,
  'a member gives up their own seat');

reset role;
select is(
  (select cancelled_by from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  'dddddddd-0000-0000-0000-000000000004'::uuid,
  'and the row records who ended it');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000005'),
  'confirmed',
  'the member who was waiting is seated in the same transaction');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000005'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'at the table the seat came free at');

-- ---------------------------------------------------------------------
-- Declining a seat somebody else booked for you.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000010',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000010')$$,
  'the person a seat was booked for may decline it');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  'declined',
  'a declined seat is declined, not cancelled — the booker is owed the difference');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_declined'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  1,
  'and the booker is told');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a seat you booked yourself is cancelled, never declined');

-- ---------------------------------------------------------------------
-- The host may end anybody's booking, and the member hears about it.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000005')$$,
  'an organizer may end any booking in their club''s game');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_host'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the member whose seat it was is told');

-- ---------------------------------------------------------------------
-- Group rollup, and leaving the waitlist as a group.
-- ---------------------------------------------------------------------
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'cancelled',
  'a group whose last live booking ends is itself cancelled');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted', now());
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '2 hours');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking_group(
      '9909aaaa-0000-0000-0000-000000000003')$$,
  'the booker may withdraw the whole group from the waitlist');

reset role;
select is(
  (select count(*)::int from public.bookings
    where group_id = '9909aaaa-0000-0000-0000-000000000003'
      and status in ('confirmed', 'waitlisted')),
  0,
  'every booking in the group is closed');
select is(
  (select outcome::text from public.promotion_offers
    where id = '0ffe0000-0000-0000-0000-000000000001'),
  'declined',
  'and the offer it was holding seats with is resolved, not left outstanding');

-- ---------------------------------------------------------------------
-- Placement.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000020',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'an ordinary member cannot move somebody else');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  'a member may seat their own "any table" booking');

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  '23514',
  'table full',
  'and cannot squeeze into a table that is already full');

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020', null)$$,
  'passing no table returns the booking to "any table"');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `bookings_cancellation.test.sql` fails — `function public.cancel_booking(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825030000_booking_cancellation.sql`:

```sql
/*
 * Ending a booking, and moving one.
 *
 * Every function here refuses once the game has started. A seat freed
 * mid-game frees nothing, and a no-show is plan 5's concept — not a
 * cancellation with a late timestamp.
 *
 * Every function here also calls promote_waitlist before it returns.
 * That is the design: promotion happens in whichever transaction freed
 * the seat, so a member watching the screen is seated the moment their
 * friend drops out rather than up to five minutes later.
 */

create function public.close_group_if_empty(target_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where group_id = target_group and status in ('confirmed', 'waitlisted'))
  then
    -- A group with no live bookings must not stay 'confirmed' or
    -- 'waitlisted': promote_waitlist would keep considering a group that
    -- no longer exists.
    update public.booking_groups
       set status = 'cancelled', waitlisted_at = null
     where id = target_group and status <> 'cancelled';

    update public.promotion_offers
       set responded_at = now(), outcome = 'declined'
     where group_id = target_group and responded_at is null;
  end if;
end;
$$;

/*
 * Three callers, one body: the member, the booker who created the row, and
 * any organizer of the club. The only differences are the guard and who
 * gets told.
 */
create function public.cancel_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  -- Bound and null-checked before anything else. `not (a = auth.uid() or
  -- b = auth.uid() or is_club_organizer(...))` is NOT null-safe: with a
  -- null uid the two comparisons are NULL, is_club_organizer is false,
  -- `NULL or NULL or false` is NULL, `not NULL` is NULL, and plpgsql does
  -- not run an `if` whose condition is NULL — so the guard falls through
  -- and the caller cancels anybody's seat.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = caller
          or bk.booked_by = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = caller
   where id = target_booking;

  -- Somebody else ended this person's booking; they are owed the news.
  if bk.profile_id <> auth.uid() then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_cancelled_by_host',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', auth.uid()),
            'booking_cancelled_by_host:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

/*
 * The one-tap exit for a seat somebody else secured for you. Distinct from
 * cancellation so the booker's message can say which happened.
 */
create function public.decline_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  -- Bound and null-checked rather than compared with `<>`: a null
  -- auth.uid() makes `bk.profile_id <> auth.uid()` evaluate to NULL, so
  -- the guard would not fire and a caller with no `sub` claim could
  -- decline anybody's seat. Task 2's review caught exactly this shape in
  -- accept_promotion_offer. Every other guard in this migration is an
  -- `=`/or chain, which refuses a null caller by falling through to its
  -- `not (...)`.
  caller := auth.uid();
  if caller is null or bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  -- A seat you booked yourself is cancelled, never declined. Allowing both
  -- would make the booker's outbox row a coin flip.
  if bk.booked_by = caller then
    raise exception 'nothing to decline' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  update public.bookings
     set status = 'declined', cancelled_at = now(), cancelled_by = caller
   where id = target_booking;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  values (bk.booked_by, bk.club_id, bk.event_id, 'booking_declined',
          jsonb_build_object('booking_id', bk.id,
                             'declined_by', bk.profile_id),
          'booking_declined:' || bk.id::text)
  on conflict (dedupe_key) do nothing;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

/*
 * "Leave the waitlist" — and equally "we are not coming after all" for a
 * seated group. The booker made the group; the booker may unmake it. An
 * organizer may too.
 */
create function public.cancel_booking_group(target_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g      record;
  ev     record;
  bk     record;
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    raise exception 'no such group' using errcode = '42501';
  end if;

  if not (g.created_by = caller or public.is_club_organizer(g.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select id, starts_at into ev from public.events where id = g.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = g.event_id for update;

  for bk in
    select * from public.bookings
    where group_id = target_group and status in ('confirmed', 'waitlisted')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = caller
     where id = bk.id;

    if bk.profile_id <> auth.uid() then
      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (bk.profile_id, bk.club_id, bk.event_id,
              'booking_cancelled_by_host',
              jsonb_build_object('booking_id', bk.id,
                                 'cancelled_by', auth.uid()),
              'booking_cancelled_by_host:' || bk.id::text)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;

  -- Resolves the group AND any offer holding seats for it. A held seat
  -- must never outlive the group it was held for.
  perform public.close_group_if_empty(target_group);
  perform public.promote_waitlist(g.event_id);

  return public.booking_result(target_group);
end;
$$;

/*
 * Seat an unplaced booking, move a placed one, or return one to "any
 * table" by passing null.
 *
 * A member may move their own; an organizer may move anybody's. Nobody is
 * moved silently by an algorithm — the roadmap parks automatic seating
 * under "hosts have opinions about who sits where".
 */
create function public.place_booking(target_booking uuid, target_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  tbl    record;
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status <> 'confirmed' then
    raise exception 'booking not confirmed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  if target_table is not null then
    select * into tbl from public.event_tables where id = target_table;
    if tbl.id is null or tbl.event_id <> bk.event_id then
      raise exception 'no such table' using errcode = '42501';
    end if;
    -- Re-checked under the lock: the room may have gone while the screen
    -- was open.
    if public.table_free_seats(target_table) < 1
       and bk.event_table_id is distinct from target_table then
      raise exception 'table full' using errcode = '23514';
    end if;
  end if;

  update public.bookings
     set event_table_id = target_table
   where id = target_booking;

  -- Moving somebody frees no seat at the event level, but returning a
  -- booking to "any table" frees a TABLE seat, and a waiting group may fit
  -- there now.
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.close_group_if_empty(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid)       from public, anon;
revoke execute on function public.decline_booking(uuid)      from public, anon;
revoke execute on function public.cancel_booking_group(uuid) from public, anon;
revoke execute on function public.place_booking(uuid, uuid)  from public, anon;

grant execute on function public.cancel_booking(uuid)        to authenticated;
grant execute on function public.decline_booking(uuid)       to authenticated;
grant execute on function public.cancel_booking_group(uuid)  to authenticated;
grant execute on function public.place_booking(uuid, uuid)   to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `bookings_cancellation.test.sql .. ok`, 20 of 20.

- [ ] **Step 5: Mutation-check the assertions**

| Mutation | Must break |
|---|---|
| Add `or true` to `cancel_booking`'s caller guard | "an unrelated member cannot cancel somebody else's seat" |
| Delete the `ev.starts_at <= now()` guard from `cancel_booking` | "a seat at a game that has started cannot be given up" |
| Remove `perform public.promote_waitlist(...)` from `cancel_booking` | "the member who was waiting is seated in the same transaction" |
| Make `decline_booking` set `status = 'cancelled'` | "a declined seat is declined, not cancelled" |
| Delete the `bk.booked_by = auth.uid()` guard in `decline_booking` | "a seat you booked yourself is cancelled, never declined" |
| Change `cancel_booking`'s outbox condition to `if false` | "and the member whose seat it was is told" |
| Remove the offer-resolving update from `close_group_if_empty` | "and the offer it was holding seats with is resolved" |
| Remove the group-status update from `close_group_if_empty` | "a group whose last live booking ends is itself cancelled" |
| Drop the `table_free_seats < 1` check in `place_booking` | "and cannot squeeze into a table that is already full" |
| Drop `or public.is_club_organizer(bk.club_id)` from `place_booking` | nothing here — **add** an assertion that an organizer may place another member's booking if the mutation survives |

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825030000_booking_cancellation.sql \
        supabase/tests/database/fixtures/bookings_cancellation.test.sql
git commit -m "feat(db): give up a seat, decline one, or be moved into one

One cancel_booking with three callers — the member, the booker, and an
organizer — because the difference between them is the guard and the
cancelled_by, not the body.

Declining is a separate status from cancelling so the booker's outbox row
can say which happened; \"Jane declined the seat you booked\" and \"Jane
cancelled\" are different things to receive.

Every path refuses once the game has started, and every path promotes the
waitlist before it returns. Cancelling the last live booking in a group
cancels the group and resolves any offer holding seats for it — a held
seat must not outlive the group it was held for."
```

---

### Task 5: What a host's edits do to people already sitting down

**Files:**
- Create: `supabase/migrations/20260825040000_event_disruption.sql`
- Create: `supabase/tests/database/fixtures/event_disruption.test.sql`
- Modify: `supabase/tests/database/fixtures/event_mutations.test.sql` (one comment)

**Interfaces:**
- Consumes: Task 1's tables, Task 2's `promote_waitlist`, Task 4's `close_group_if_empty`.
- Produces: replacements for plan 3's `cancel_event(uuid) returns boolean`, `remove_event_table(uuid) returns boolean` and `add_event_table(uuid) returns uuid`. Signatures and return types are unchanged, so no caller in `lib/events.ts` changes.

**This task is why plan 3 could not finish these functions.** `remove_event_table` currently `delete`s the row; with Task 1's composite foreign key from `bookings`, that now raises a foreign-key violation the moment anybody is sitting there. The rule the spec settled: **unseat, never destroy** — the bookings become `event_table_id = null`, which is the "any table" state the schema already has, and each affected member gets an `unseated` outbox row.

**`cancel_event` currently sets a status and stops.** It now voids every confirmed and waitlisted booking, expires every outstanding offer, cancels the groups, and writes one `event_cancelled` row per affected member. Nothing un-cancels — matching plan 3, where a cancelled occurrence stays cancelled.

**`add_event_table` gains one line.** More capacity means a waiting group may now fit, and the whole design says promotion happens in the transaction that creates the room.

**The `add_event_table` body quoted below is STALE — do not write it verbatim.** It reproduces plan 3's original from `20260823010000`, but `20260823020000` later replaced that function with a version carrying a cancelled-event guard and a count-based table cap. `create or replace` with the body below would silently revert both and regress two existing assertions. Read the shipped function first and add only the `promote_waitlist` call. Task 5's implementer caught this; the same caution applies anywhere this plan quotes a plan-3 function.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/event_disruption.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Two tables of one seat each. Carol sits at Table 2, Dan at Table 1,
-- Erin waits.
insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 1, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 1, 2);

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000002'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003'),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005', null, 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Adding a table makes room, and the room is used immediately.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.add_event_table('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer adds a third table');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000003'),
  'confirmed',
  'and the member who was waiting is seated in that same transaction');

-- ---------------------------------------------------------------------
-- Removing a table unseats rather than ejects.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000002')$$,
  'a table with somebody sitting at it can still be removed');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000001'),
  'confirmed',
  'the member keeps their place in the game');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000001'),
  null,
  'and becomes an "any table" booking for the host to place');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  1,
  'and is told they need seating');

-- Two tables of one seat left, three confirmed bookings on the books.
-- Capacity is BELOW the confirmed count and free seats must floor at zero
-- rather than going negative.
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'an over-subscribed game reports no free seats, not negative ones');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000001');
    select public.remove_event_table(
      (select id from public.event_tables
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
        limit 1))$$,
  '23514',
  null,
  'the last table still cannot be removed');

-- ---------------------------------------------------------------------
-- Cancelling the game voids everything.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.cancel_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer cancels the game');

reset role;
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status in ('confirmed', 'waitlisted')),
  0,
  'no booking survives a cancelled game');
select is(
  (select count(distinct recipient_id)::int from public.notification_outbox
    where kind = 'event_cancelled'),
  3,
  'and everybody who held or awaited a seat is told once');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `event_disruption.test.sql` fails — `remove_event_table` raises a foreign-key violation rather than unseating, and `event_cancelled` rows are never written.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825040000_event_disruption.sql`:

```sql
/*
 * Plan 3 wrote these three functions and left a hole in each, marked in
 * its own comments as "a plan 4 problem that cannot be designed correctly
 * while bookings do not exist". Bookings exist now.
 *
 * remove_event_table DELETES the table row, which — now that bookings
 * carry a composite foreign key to (id, event_id) — raises 23503 the
 * moment anybody is sitting there. The rule is UNSEAT, NEVER DESTROY: the
 * bookings become event_table_id = null, which is the "any table" state
 * the schema already has, so nobody is silently ejected from a game they
 * were coming to.
 *
 * cancel_event set a status and stopped. It now voids the bookings too.
 * Nothing un-cancels, exactly as in plan 3.
 */

create or replace function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  owning_event uuid;
  event_status public.event_status;
  remaining    int;
begin
  select t.club_id, t.event_id, e.status
  into owning_club, owning_event, event_status
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  perform 1 from public.events where id = owning_event for update;

  with locked as (
    select id from public.event_tables
    where event_id = owning_event
    for update
  )
  select count(*) into remaining from locked;

  if remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  -- Unseat before deleting. These people are still coming; they just have
  -- nowhere to sit until the host places them.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, b.club_id, b.event_id, 'unseated',
         jsonb_build_object('booking_id', b.id,
                            'event_table_id', target_table),
         'unseated:' || b.id::text || ':' || target_table::text
  from public.bookings b
  where b.event_table_id = target_table and b.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  update public.bookings
     set event_table_id = null
   where event_table_id = target_table;

  delete from public.event_tables where id = target_table;

  -- Capacity just dropped; nobody new can be promoted into it. The call
  -- is here anyway because a group that wanted THIS table may now fit
  -- somewhere else, and because leaving it out would make "every path
  -- that changes capacity promotes" a rule with an exception.
  perform public.promote_waitlist(owning_event);

  return true;
end;
$$;

create or replace function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  bk          record;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  perform 1 from public.events where id = target_event for update;

  update public.events set status = 'cancelled' where id = target_event;

  for bk in
    select * from public.bookings
    where event_id = target_event and status in ('confirmed', 'waitlisted')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = auth.uid()
     where id = bk.id;

    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, target_event, 'event_cancelled',
            jsonb_build_object('booking_id', bk.id),
            'event_cancelled:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end loop;

  update public.promotion_offers
     set responded_at = now(), outcome = 'expired'
   where event_id = target_event and responded_at is null;

  update public.booking_groups
     set status = 'cancelled', waitlisted_at = null
   where event_id = target_event and status <> 'cancelled';

  -- No promote_waitlist call: a cancelled game has nobody to promote, and
  -- promote_waitlist returns immediately on a non-published event anyway.
  return true;
end;
$$;

create or replace function public.add_event_table(target_event uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  next_pos    int;
  new_id      uuid;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  perform 1 from public.events where id = target_event for update;

  select coalesce(max(position), 0) + 1 into next_pos
  from public.event_tables where event_id = target_event;

  if next_pos > 20 then
    raise exception 'too many tables' using errcode = '23514';
  end if;

  insert into public.event_tables (event_id, club_id, label, position)
  values (target_event, owning_club, 'Table ' || next_pos, next_pos)
  returning id into new_id;

  -- New room, used immediately rather than in up to five minutes.
  perform public.promote_waitlist(target_event);

  return new_id;
end;
$$;
```

- [ ] **Step 4: Note the change where plan 3's fixture asserts the old behaviour**

`supabase/tests/database/fixtures/event_mutations.test.sql` asserts that `remove_event_table` deletes a table. That assertion is still true and still passes — the table row is still deleted. Add one comment above it so the next reader knows the bookings case is covered elsewhere:

```sql
-- The bookings side of this function — unseat, never destroy — is asserted
-- in event_disruption.test.sql. This block covers the table row only.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `event_disruption.test.sql .. ok`, 10 of 10, and every plan 3 event fixture still green.

- [ ] **Step 6: Mutation-check the assertions**

| Mutation | Must break |
|---|---|
| Delete the `update … set event_table_id = null` from `remove_event_table` | the removal raises 23503 — "a table with somebody sitting at it can still be removed" |
| Replace that update with `delete from public.bookings where event_table_id = target_table` | "the member keeps their place in the game" |
| Delete the `unseated` outbox insert | "and is told they need seating" |
| Delete the booking loop from `cancel_event` | "no booking survives a cancelled game" |
| Change `cancel_event`'s outbox insert to fire only for confirmed bookings | "everybody who held or awaited a seat is told once" (Erin is waitlisted) |
| Remove `perform public.promote_waitlist(target_event)` from `add_event_table` | "the member who was waiting is seated in that same transaction" |
| Remove `greatest(0, …)` from `event_free_seats` | "an over-subscribed game reports no free seats, not negative ones" |

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260825040000_event_disruption.sql \
        supabase/tests/database/fixtures/event_disruption.test.sql \
        supabase/tests/database/fixtures/event_mutations.test.sql
git commit -m "feat(db): decide what a host's edits do to people already seated

Plan 3 left three holes and said so in its own comments. Filling them:

remove_event_table unseats rather than ejects — its bookings become
event_table_id = null, the \"any table\" state the schema already has, with
an outbox row each. Deleting them was never an option and, since Task 1's
composite foreign key, is not even possible.

cancel_event now voids every confirmed and waitlisted booking, expires
outstanding offers, cancels the groups, and tells everybody. Nothing
un-cancels, as in plan 3.

add_event_table promotes the waitlist, because new capacity should be
used in the transaction that created it."
```

---

### Task 6: "Need a 4th"

**Files:**
- Create: `supabase/migrations/20260825050000_need_a_fourth.sql`
- Create: `supabase/tests/database/fixtures/need_a_fourth.test.sql`

**Interfaces:**
- Consumes: Task 1's tables and helpers; plan 1's `profiles.skill_level` and `profiles.mute_need_a_fourth`.
- Produces: `tier_matches(public.skill_tier, public.skill_level, boolean) returns boolean`; `need_a_fourth_stage(uuid) returns text`; `tables_needing_a_fourth()` returning `table(event_table_id uuid, event_id uuid, club_id uuid, stage text)`; `announce_table_fourth(uuid, text) returns int`; `announce_need_a_fourth() returns int`; `call_for_a_fourth(uuid) returns int`. Task 7 schedules `announce_need_a_fourth`; Task 12 calls `call_for_a_fourth`.

**Nothing about a call for a fourth is stored.** A table needs one when it holds `capacity - 1` confirmed bookings and the game starts within 48 hours; the call widens to adjacent tiers inside 12 hours. Both are pure functions of occupancy and time-to-start, so the screen derives them and nothing can go stale, and claiming the seat is an ordinary `commit_booking` — first commit wins on the event lock and the call disappears from everybody else's next read.

**The only durable artifact is the outbox row**, and its `dedupe_key` is what stops the 15-minute job announcing the same table over and over. Because the stage is part of the key, widening announces exactly once more.

**The key must carry the recipient: `need_a_fourth:<table_id>:<stage>:<recipient_id>`.** An earlier version of this plan omitted the recipient, which is a silent, feature-breaking bug rather than a cosmetic one — the announcement is a single multi-row `insert … select … on conflict (dedupe_key) do nothing`, so one key shared by every recipient means **all but one row is dropped and exactly one club member is ever told**. Verified in Postgres: three recipients inserted that way leave one surviving row. Task 6's implementer caught it. Per-recipient keys keep the job idempotent for each person while still announcing to everyone.

**Adjacency, precisely.** `mixed` matches everybody at either stage. At the narrow stage a member matches only their own tier, and a member with no `skill_level` matches nothing but `mixed`. At the wide stage `beginner ↔ intermediate ↔ advanced` (beginner and advanced are not adjacent to each other), and a member with no `skill_level` matches everything — they are unclassified, and by then the club needs a body more than it needs a grade.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/need_a_fourth.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(14);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),   -- host
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),     -- intermediate
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),   -- beginner
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),     -- advanced
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),    -- beginner, muted
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com');    -- no level

update public.profiles set skill_level = 'intermediate'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set skill_level = 'beginner'
 where id in ('cccccccc-0000-0000-0000-000000000003',
              'eeeeeeee-0000-0000-0000-000000000005');
update public.profiles set skill_level = 'advanced'
 where id = 'dddddddd-0000-0000-0000-000000000004';
update public.profiles set mute_need_a_fourth = true
 where id = 'eeeeeeee-0000-0000-0000-000000000005';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 starts in 5 days — outside the 48-hour window.
-- E2 starts in 30 hours — inside the window, narrow stage.
-- E3 starts in 6 hours — inside the window, wide stage.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next week',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '5 days', now() + interval '5 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tomorrow night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '30 hours', now() + interval '33 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tonight',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '6 hours', now() + interval '9 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Every table is beginner, capacity 4, so tier matching is the only thing
-- that varies between the stages.
insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  -- A second table at E2 that is only half full: it must never be called.
  ('7ab1e000-0000-0000-0000-000000000004',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'mixed', 4, 2);

-- Three seats taken at each of the three "Table 1"s: alice, dan, erin.
insert into public.booking_groups (id, event_id, club_id, created_by,
                                   preferred_table_id)
select ('9909aaaa-0000-0000-0000-00000000000' || t.position || t.seq)::uuid,
       t.event_id, 'c1c1c1c1-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-000000000001', t.id
from (values
  ('7ab1e000-0000-0000-0000-000000000001'::uuid,
   'e1e1e1e1-0000-0000-0000-000000000001'::uuid, 1, 1),
  ('7ab1e000-0000-0000-0000-000000000002'::uuid,
   'e2e2e2e2-0000-0000-0000-000000000002'::uuid, 1, 2),
  ('7ab1e000-0000-0000-0000-000000000003'::uuid,
   'e3e3e3e3-0000-0000-0000-000000000003'::uuid, 1, 3)
) as t(id, event_id, position, seq);

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
select g.id, g.event_id, g.club_id, g.preferred_table_id, u.id,
       'aaaaaaaa-0000-0000-0000-000000000001'
from public.booking_groups g
cross join (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  ('dddddddd-0000-0000-0000-000000000004'::uuid),
  ('eeeeeeee-0000-0000-0000-000000000005'::uuid)
) as u(id);

-- ---------------------------------------------------------------------
-- Qualification.
-- ---------------------------------------------------------------------
select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000004'),
  null,
  'a table at two of four is not calling for anybody');

select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000002'),
  'tier',
  'a table at three of four, more than 12 hours out, calls its own tier');

select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  'wide',
  'inside 12 hours the call widens');

select is(
  (select count(*)::int from public.tables_needing_a_fourth()
    where event_table_id = '7ab1e000-0000-0000-0000-000000000001'),
  0,
  'a game five days out is outside the announcement window');

-- ---------------------------------------------------------------------
-- Who hears about it.
-- ---------------------------------------------------------------------
select is(public.announce_need_a_fourth(), 2,
  'the two games inside the window are announced');

-- E2 is the narrow stage on a BEGINNER table. Carol is a beginner and free:
-- she hears. Bob is intermediate: he does not. Fred has no level: he does
-- not. Erin is a beginner but muted, and Alice and Dan are already sitting
-- there.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1,
  'the narrow stage reaches exactly the matching tier');
select is(
  (select recipient_id from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  'cccccccc-0000-0000-0000-000000000003'::uuid,
  'and that is the free beginner, not the muted one and not a player');

-- E3 is the wide stage. Carol (beginner), Bob (intermediate, adjacent) and
-- Fred (no level) all hear. Erin is still muted.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'),
  3,
  'the wide stage reaches adjacent tiers and the unclassified');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  0,
  'a member who muted these alerts is never told, at either stage');

-- ---------------------------------------------------------------------
-- Idempotency: the job runs every 15 minutes.
-- ---------------------------------------------------------------------
select is(public.announce_need_a_fourth(), 2,
  'running again still reports the two tables');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'),
  4,
  'but writes nobody a second copy');

-- ---------------------------------------------------------------------
-- The host may call early, outside the window. A member may not.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'an ordinary member cannot summon the club');

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000001'),
  1,
  'the host may call for a fourth before the window opens');

select throws_ok(
  $$select public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000004')$$,
  '23514',
  null,
  'and cannot call for a fourth at a table that needs two');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:db
```

Expected: `need_a_fourth.test.sql` fails — `function public.need_a_fourth_stage(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260825050000_need_a_fourth.sql`:

```sql
/*
 * "Need a 4th".
 *
 * Nothing here is stored. A table needs a fourth when it holds
 * capacity - 1 confirmed bookings and the game starts within 48 hours;
 * the call widens to adjacent tiers inside 12 hours. Both are pure
 * functions of occupancy and time-to-start, so the screen derives them and
 * nothing can go stale, and claiming the seat is an ordinary
 * commit_booking — first commit wins on the event lock, and the call
 * disappears from everybody else's next read because it was never a row.
 *
 * The only durable artifact is the outbox row. Its dedupe_key carries the
 * stage, so the 15-minute job announces a table once per stage and the
 * widening announces exactly once more.
 *
 * The two windows are plain intervals against starts_at, an instant. That
 * is arithmetic on instants and not a timezone conversion; it is correct
 * under any server zone, which is why no club timezone appears here.
 */

create function public.tier_matches(
  tier  public.skill_tier,
  lvl   public.skill_level,
  wide  boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    -- A mixed table wants anybody, at either stage.
    when tier = 'mixed' then true
    when not wide then lvl::text = tier::text
    -- Wide: adjacent tiers, and the unclassified. Beginner and advanced
    -- are NOT adjacent to each other; an advanced player at a beginner
    -- table is a different evening from the one anybody signed up for.
    when lvl is null then true
    when tier = 'beginner'     then lvl in ('beginner', 'intermediate')
    when tier = 'intermediate' then true
    when tier = 'advanced'     then lvl in ('advanced', 'intermediate')
    else false
  end;
$$;

/*
 * null when the table is not calling for anybody. 'tier' or 'wide'
 * otherwise. Deliberately says nothing about the 48-hour announcement
 * window: that is the cron job's business, and a host calling early is
 * asking to skip exactly that window.
 */
create function public.need_a_fourth_stage(target_table uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.id is null then null
    when e.status <> 'published' then null
    when e.starts_at <= now() then null
    when t.capacity < 2 then null
    when (select count(*) from public.bookings b
          where b.event_table_id = t.id and b.status = 'confirmed')
         <> t.capacity - 1 then null
    when e.starts_at <= now() + interval '12 hours' then 'wide'
    else 'tier'
  end
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;
$$;

create function public.tables_needing_a_fourth()
returns table (event_table_id uuid, event_id uuid, club_id uuid, stage text)
language sql
stable
set search_path = public
as $$
  select t.id, t.event_id, t.club_id, public.need_a_fourth_stage(t.id)
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where e.starts_at <= now() + interval '48 hours'
    and public.need_a_fourth_stage(t.id) is not null;
$$;

/*
 * Writes the outbox rows for one table at one stage. Returns how many
 * people were told, which is 0 on a second run — the dedupe key already
 * holds them.
 */
create function public.announce_table_fourth(target_table uuid, at_stage text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t     record;
  told  int;
begin
  select tt.id, tt.event_id, tt.club_id, tt.label, tt.skill_tier
  into t
  from public.event_tables tt where tt.id = target_table;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select cm.profile_id, t.club_id, t.event_id, 'need_a_fourth',
         jsonb_build_object('event_table_id', t.id,
                            'table_label', t.label,
                            'stage', at_stage),
         'need_a_fourth:' || t.id::text || ':' || at_stage
  from public.club_members cm
  join public.profiles p on p.id = cm.profile_id
  where cm.club_id = t.club_id
    and cm.status = 'active'
    and not p.mute_need_a_fourth
    and public.tier_matches(t.skill_tier, p.skill_level, at_stage = 'wide')
    -- Somebody already coming to this game is not a fourth.
    and not exists (
      select 1 from public.bookings b
      where b.event_id = t.event_id and b.profile_id = cm.profile_id
        and b.status in ('confirmed', 'waitlisted'))
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  return told;
end;
$$;

/*
 * Every 15 minutes. Returns the number of TABLES considered, not the
 * number of people told — a table already announced at this stage is
 * still a table that needs a fourth, and reporting it is how the job's
 * own test distinguishes "nothing qualifies" from "nothing new to say".
 */
create function public.announce_need_a_fourth()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t      record;
  tables int := 0;
begin
  for t in select * from public.tables_needing_a_fourth() loop
    perform public.announce_table_fourth(t.event_table_id, t.stage);
    tables := tables + 1;
  end loop;
  return tables;
end;
$$;

/*
 * The host's "call for a fourth now", available before the 48-hour window
 * opens. Same dedupe key, so a manual call inside the window does not
 * double up with the job.
 */
create function public.call_for_a_fourth(target_table uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  at_stage    text;
begin
  select club_id into owning_club
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  at_stage := public.need_a_fourth_stage(target_table);
  if at_stage is null then
    raise exception 'table does not need a fourth' using errcode = '23514';
  end if;

  return public.announce_table_fourth(target_table, at_stage);
end;
$$;

revoke execute on function
  public.tier_matches(public.skill_tier, public.skill_level, boolean)
  from public, anon;
revoke execute on function public.need_a_fourth_stage(uuid)   from public, anon;
revoke execute on function public.tables_needing_a_fourth()   from public, anon;
revoke execute on function public.announce_table_fourth(uuid, text)
  from public, anon;
revoke execute on function public.announce_need_a_fourth()    from public, anon;
revoke execute on function public.call_for_a_fourth(uuid)     from public, anon;

-- Only the host's button. The client derives the call for display from
-- bookings it can already read; it does not need the helpers.
grant execute on function public.call_for_a_fourth(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: `need_a_fourth.test.sql .. ok`, 14 of 14.

- [ ] **Step 5: Mutation-check the assertions**

| Mutation | Must break |
|---|---|
| Change `<> t.capacity - 1` to `< t.capacity` | "a table at two of four is not calling for anybody" |
| Change the 12-hour test to 48 hours | "a table at three of four, more than 12 hours out, calls its own tier" |
| Drop `where e.starts_at <= now() + interval '48 hours'` from `tables_needing_a_fourth` | "a game five days out is outside the announcement window" |
| Remove `and not p.mute_need_a_fourth` | "a member who muted these alerts is never told, at either stage" |
| Remove the `not exists (… bookings …)` clause | "the narrow stage reaches exactly the matching tier" (Alice and Dan would be told) |
| In `tier_matches`, return `true` when `not wide` | "the narrow stage reaches exactly the matching tier" |
| In `tier_matches`, make `tier = 'beginner'` wide include `advanced` | "the wide stage reaches adjacent tiers and the unclassified" (count becomes 4) |
| Drop `at_stage` from the dedupe key | "but writes nobody a second copy" stays green, but the widening case would silently stop announcing — **add** an assertion that a table moving from `tier` to `wide` announces again if this mutation survives |
| Remove `on conflict (dedupe_key) do nothing` | "running again still reports the two tables" — it raises instead |
| Remove `perform public.assert_club_organizer(owning_club)` | "an ordinary member cannot summon the club" |

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825050000_need_a_fourth.sql \
        supabase/tests/database/fixtures/need_a_fourth.test.sql
git commit -m "feat(db): call for a fourth without storing a call

A table needs a fourth when it holds capacity - 1 confirmed bookings and
the game is within 48 hours; the call widens to adjacent tiers inside 12.
Both are pure functions of occupancy and time, so nothing is stored,
nothing goes stale, and claiming the seat is an ordinary booking — first
commit wins on the event lock and the call vanishes from everybody else's
next read.

The outbox row is the only durable artifact and its dedupe key carries the
stage, so the 15-minute job announces each table once per stage and the
widening announces exactly once more.

Beginner and advanced are deliberately not adjacent, even at the wide
stage. A member with no skill level hears nothing at the narrow stage and
everything at the wide one."
```

---

### Task 7: Schedule the two jobs, and close the grants

**Files:**
- Create: `supabase/migrations/20260825060000_schedule_booking_jobs.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: Task 2's `sweep_promotion_offers`, Task 6's `announce_need_a_fourth`, and plan 3's proven `pg_cron` availability.
- Produces: two scheduled jobs and an updated privilege allowlist. Nothing calls this task.

**`pg_cron` is already proven in both environments** — plan 3's Task 1 established that and `20260823060000` schedules the nightly materialization on top of it. This task follows exactly that pattern, including the `cron.unschedule` guard so re-running is not an error.

**The allowlist in `portable/grants.test.sql` is bidirectional** and both directions have to be edited: direction 1 fails if an expected function loses EXECUTE, direction 2 fails if anything unexpected gains it. Eleven new functions belong on both lists. Get this wrong in one direction only and the suite still passes, which is why they are enumerated below rather than described.

- [ ] **Step 1: Write the failing test**

Modify `supabase/tests/database/portable/grants.test.sql`. Change `select plan(57)` to `select plan(63)`, and add these six assertions next to the existing TRUNCATE block:

```sql
select ok(
  not has_table_privilege('authenticated', 'public.booking_groups', 'TRUNCATE'),
  'authenticated cannot TRUNCATE booking_groups'
);
select ok(
  not has_table_privilege('authenticated', 'public.bookings', 'TRUNCATE'),
  'authenticated cannot TRUNCATE bookings'
);
select ok(
  not has_table_privilege('authenticated', 'public.promotion_offers', 'TRUNCATE'),
  'authenticated cannot TRUNCATE promotion_offers'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_outbox', 'TRUNCATE'),
  'authenticated cannot TRUNCATE notification_outbox'
);

-- The outbox is plan 6's queue and nobody else's. RLS is on with no policy,
-- so even a mistaken grant would return nothing — but a grant that exists
-- is a grant somebody will eventually write a policy for.
select ok(
  not has_table_privilege('authenticated', 'public.notification_outbox',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated holds no privilege of any kind on notification_outbox'
);

select ok(
  has_function_privilege('authenticated',
    'public.commit_booking(uuid, uuid[], uuid, boolean)', 'EXECUTE'),
  'authenticated can still execute commit_booking'
);
```

Then add these eleven entries to **both** `unnest(array[…])` lists — the one under "Direction 1" and the one under "Direction 2":

```sql
         'public.is_booking_group_member(uuid)',
         'public.booking_result(uuid)',
         'public.propose_booking(uuid, uuid[], uuid, boolean)',
         'public.commit_booking(uuid, uuid[], uuid, boolean)',
         'public.cancel_booking(uuid)',
         'public.decline_booking(uuid)',
         'public.cancel_booking_group(uuid)',
         'public.place_booking(uuid, uuid)',
         'public.accept_promotion_offer(uuid)',
         'public.decline_promotion_offer(uuid)',
         'public.call_for_a_fourth(uuid)',
```

- [ ] **Step 2: Run it and watch the right thing fail**

```bash
npm run test:db
```

Expected: `grants.test.sql` passes all 63 — the migrations from Tasks 1–6 already grant exactly these. If **direction 2** fails naming a function you did not expect, a `revoke` was missed in an earlier task; fix the migration, not the list.

Then run it against hosted, because this is the file that catches the difference:

```bash
npm run test:db:remote
```

Expected: green. Supabase's hosted bootstrap grants EXECUTE to `authenticated` directly at function-creation time, and `revoke … from public` never touches a direct grant — plan 3 hit this three separate times. If a function shows up here that was clean locally, add `revoke execute … from authenticated` to its own migration.

- [ ] **Step 3: Write the scheduling migration**

Create `supabase/migrations/20260825060000_schedule_booking_jobs.sql`:

```sql
/*
 * The only two things in this plan that are not driven by a member's tap.
 *
 * Everything else promotes inline, inside whichever transaction freed the
 * seat. These two exist because no transaction can trigger them: an offer
 * expiring is the absence of an action, and a table that needs a fourth
 * needs telling whether or not anybody opens the app.
 *
 * `cron.unschedule` first, so re-running against a project that already
 * has the job is not an error. Migrations are forward-only and `db reset`
 * replays them all — the same guard as 20260823060000.
 *
 * Runs as `postgres`, the role `db reset` / `db push` connect as and the
 * owner of the `cron` schema, so no grant on `cron` is needed in either
 * environment. `cli_login_postgres` — the restricted role the hosted pgTAP
 * suite connects as — has no USAGE on `cron` at all, which is why job
 * existence is verified with local psql below rather than from
 * portable/grants.test.sql. See docs/testing.md, "Scheduled work".
 */
do $$
begin
  perform cron.unschedule('sweep-promotion-offers');
exception
  when others then
    null;
end;
$$;

do $$
begin
  perform cron.unschedule('announce-need-a-fourth');
exception
  when others then
    null;
end;
$$;

/*
 * Five minutes. An offer runs for two hours, so the worst case is a seat
 * held five minutes past its expiry — invisible next to the two hours, and
 * a tighter schedule buys nothing.
 */
select cron.schedule(
  'sweep-promotion-offers',
  '*/5 * * * *',
  $$select public.sweep_promotion_offers()$$
);

/*
 * Fifteen minutes, matching the parent spec's table. The stage change at
 * 12 hours is therefore announced within 15 minutes of crossing it, which
 * is well inside the resolution anybody experiences.
 */
select cron.schedule(
  'announce-need-a-fourth',
  '*/15 * * * *',
  $$select public.announce_need_a_fourth()$$
);
```

- [ ] **Step 4: Verify both jobs exist, locally and on hosted**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "select jobname, schedule, active from cron.job order by jobname;"
```

Expected three rows: `announce-need-a-fourth` (`*/15 * * * *`), `materialize-event-series` (`0 3 * * *`), `sweep-promotion-offers` (`*/5 * * * *`), all active.

```bash
npx supabase db push
```

Then check the same query against the hosted project through the Supabase dashboard's SQL editor. Expected: the same three rows.

- [ ] **Step 5: Document the two jobs**

Add to the "Scheduled work" section of `docs/testing.md`:

```markdown
Three jobs now run on `pg_cron`:

| Job | Schedule | What it does |
|---|---|---|
| `materialize-event-series` | `0 3 * * *` | Keeps ~6 weeks of recurring events materialized |
| `sweep-promotion-offers` | `*/5 * * * *` | Expires promotion offers past `expires_at`, releases their held seats, and promotes the next eligible group |
| `announce-need-a-fourth` | `*/15 * * * *` | Writes `notification_outbox` rows for tables at `capacity - 1` inside the 48-hour window |

All three are ordinary plpgsql and are tested by **calling them**, not by
waiting for a schedule. `sweep_promotion_offers()` and
`announce_need_a_fourth()` both return a count, so a fixture can assert what
a run did rather than inspecting `cron.job_run_details` — which the hosted
suite could not read anyway.

**Waitlist promotion is not on this list, and that is deliberate.** It runs
inline inside whichever transaction frees a seat. The sweep calls it too,
but only after expiring an offer; if you find yourself adding a "promote the
waitlist" job, something inline has stopped calling `promote_waitlist`.
```

- [ ] **Step 6: Audit the fixtures from Tasks 1–6 for assertions that cannot fail**

Plan 3 shipped a whole task's worth of green assertions that killed one mutant in eight, and a `isnt()` that read a deleted row as passing. Before this plan's SQL is called done, re-run every mutation listed in Tasks 1–6 in one sitting and record the result.

For each mutation: apply it to the migration, `npx supabase db reset && npm run test:db`, confirm the named test goes **red**, revert.

```bash
npx supabase db reset && npm run test:db   # baseline: everything green
```

Write the results into `.superpowers/sdd/progress.md` as a table of mutation → test → red/green. **Any mutation that leaves the suite green is a finding**, and the fix is a new assertion, never a weaker mutation.

Two shapes to look for specifically, both of which bit plan 3:

- **`isnt(x, null)` on a row that a mutation DELETES** passes for the wrong reason. Prefer asserting the count, or the row's actual value.
- **An assertion whose title states a rule the body does not test.** "a group skipped for not fitting keeps its place" must compare `waitlisted_at` before and after, not merely that the group is still waitlisted.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260825060000_schedule_booking_jobs.sql \
        supabase/tests/database/portable/grants.test.sql \
        docs/testing.md
git commit -m "feat(db): schedule the sweep and the call, and close the grants

Two jobs, both following 20260823060000's pattern: sweep-promotion-offers
every five minutes and announce-need-a-fourth every fifteen. Nothing else
is scheduled — every other promotion happens inline in the transaction
that freed the seat, and a future \"promote the waitlist\" job would mean
something inline had stopped calling promote_waitlist.

portable/grants.test.sql gains the four new tables' TRUNCATE assertions, an
assertion that authenticated holds NO privilege of any kind on
notification_outbox, and the eleven new functions on both directions of the
allowlist. One direction alone still passes, which is why they are
enumerated rather than described."
```

---

### Task 8: The data layer

**Files:**
- Create: `supabase/migrations/20260825070000_seating_reads.sql`
- Create: `lib/bookings.ts`
- Create: `lib/bookings.test.ts`
- Modify: `supabase/tests/database/portable/grants.test.sql` (two more allowlist entries, `plan(63)` → `plan(64)`)

**Interfaces:**
- Consumes: every function granted in Tasks 1–6; plan 2's `club_roster(uuid)`.
- Produces: `event_seating(uuid)` and `my_upcoming_bookings()` in SQL; and from `lib/bookings.ts` the types `SeatOccupant`, `MyBooking`, `PromotionOffer`, `BookingOutcome`, plus `fetchEventSeating`, `fetchMyUpcomingBookings`, `proposeBooking`, `commitBooking`, `cancelBooking`, `declineBooking`, `cancelBookingGroup`, `placeBooking`, `acceptPromotionOffer`, `declinePromotionOffer`, `callForAFourth`, and the pure helpers `tierWarning`, `needsAFourth`, `seatsRemaining`, `waitlistLabel`, `offerCountdown`. Tasks 9–14 consume these.

**Read this before writing a single query: `profiles` is self-only.** Plan 2's `20260822180000` narrowed the policy back to own-row after discovering a co-member could read another member's quiet hours. A `.select('*, profiles(display_name)')` from `bookings` therefore returns **null names for everybody but you**, with no error — the exact shape of bug that looks like a rendering problem for a day. Names come from a `security definer` function that re-asks the membership question, which is why this task starts with a migration rather than with TypeScript.

**Two reads, not five.** `event_seating(event)` returns the whole picture for one game — every live booking, who it is for, who booked it, which table, and where its group stands in the queue. `my_upcoming_bookings()` returns the same person's seats across every club for "Your games". A promotion offer is read straight from `promotion_offers`, whose RLS already limits it to the group's own members.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `lib/bookings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  needsAFourth,
  offerCountdown,
  seatsRemaining,
  tierWarning,
  waitlistLabel,
} from './bookings';

describe('tierWarning', () => {
  it('says nothing when the tier and the level agree', () => {
    expect(tierWarning('advanced', 'advanced', 'Table 2')).toBeNull();
  });

  it('says nothing about a mixed table, whoever is booking', () => {
    expect(tierWarning('mixed', 'beginner', 'Table 1')).toBeNull();
  });

  // A null skill level is the common case for a member who has never
  // opened their profile. Warning them about a mismatch they have not
  // declared would be an interruption with nothing behind it.
  it('says nothing when the member has no skill level set', () => {
    expect(tierWarning('advanced', null, 'Table 2')).toBeNull();
  });

  it('names the table and the tier when they disagree', () => {
    expect(tierWarning('advanced', 'beginner', 'Table 2')).toBe(
      'Table 2 is set up for advanced players. Book anyway?',
    );
  });
});

describe('needsAFourth', () => {
  const start = new Date('2026-08-25T23:00:00Z');

  it('is true at one seat short, inside 48 hours', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false two seats short', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 2, start, now)).toBe(false);
  });

  it('is false when the table is full', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 4, start, now)).toBe(false);
  });

  it('is false more than 48 hours out', () => {
    const now = new Date('2026-08-22T22:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });

  // The boundary itself, because "within 48 hours" and "48 hours or more"
  // differ by exactly the case a host looks at two days ahead.
  it('is true exactly 48 hours out', () => {
    const now = new Date('2026-08-23T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false once the game has started', () => {
    const now = new Date('2026-08-25T23:00:01Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });
});

describe('seatsRemaining', () => {
  it('counts the seats a table has left', () => {
    expect(seatsRemaining(4, 3)).toBe(1);
  });

  // Removing a table lowers capacity without ejecting anybody, so a table
  // can hold more than it seats. Never render a negative.
  it('never goes below zero', () => {
    expect(seatsRemaining(2, 3)).toBe(0);
  });
});

describe('waitlistLabel', () => {
  it('reads as an ordinal', () => {
    expect(waitlistLabel(1)).toBe('1st on the waitlist');
    expect(waitlistLabel(2)).toBe('2nd on the waitlist');
    expect(waitlistLabel(3)).toBe('3rd on the waitlist');
    expect(waitlistLabel(4)).toBe('4th on the waitlist');
  });

  // 11th, 12th and 13th are the ones every naive ordinal function gets
  // wrong. A club big enough to reach them is a club we want.
  it('handles the teens', () => {
    expect(waitlistLabel(11)).toBe('11th on the waitlist');
    expect(waitlistLabel(12)).toBe('12th on the waitlist');
    expect(waitlistLabel(13)).toBe('13th on the waitlist');
    expect(waitlistLabel(21)).toBe('21st on the waitlist');
  });
});

describe('offerCountdown', () => {
  const expires = new Date('2026-08-24T16:15:00Z');

  it('reads in whole minutes under an hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T15:45:00Z'))).toBe(
      '30 minutes left',
    );
  });

  it('reads in hours and minutes above one hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T14:30:00Z'))).toBe(
      '1 hour 45 minutes left',
    );
  });

  it('singularises one minute', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:14:10Z'))).toBe(
      '1 minute left',
    );
  });

  it('is explicit once it has run out rather than counting backwards', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:16:00Z'))).toBe(
      'Expired',
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- lib/bookings.test.ts
```

Expected: FAIL — `Failed to resolve import "./bookings"`.

- [ ] **Step 3: Write the read migration**

Create `supabase/migrations/20260825070000_seating_reads.sql`:

```sql
/*
 * The two reads the screens need.
 *
 * Both are `security definer` for the same reason club_roster is: since
 * 20260822180000 the `profiles` policy is SELF-ONLY, so a client joining
 * bookings to profiles gets its own name and NULL for everybody else —
 * silently, with no error. Names are published deliberately, by a function
 * whose return type is the exposure surface, and which re-asks the
 * membership question because RLS does not protect a definer function.
 *
 * event_seating returns live bookings only (confirmed and waitlisted). A
 * cancelled seat is not seating; the screens never show one.
 */

create function public.event_seating(target_event uuid)
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
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted')
    -- The tenant boundary. Not decoration: without it any signed-in user
    -- holding an event uuid reads that club's whole guest list.
    and public.is_club_member(b.club_id)
  order by t.position nulls last, b.created_at, b.id;
$$;

/*
 * "Your games" — across every club, which is the point. A member belongs
 * to few clubs and has few upcoming games, so there is no paging.
 */
create function public.my_upcoming_bookings()
returns table (
  booking_id       uuid,
  group_id         uuid,
  event_id         uuid,
  club_id          uuid,
  club_name        text,
  event_title      text,
  starts_at        timestamptz,
  club_timezone    text,
  venue_name       text,
  event_table_id   uuid,
  table_label      text,
  status           public.booking_status,
  booked_by        uuid,
  booked_by_name   text,
  offer_id         uuid,
  offer_seats      int,
  offer_expires_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id, b.group_id, b.event_id, b.club_id, c.name, e.title, e.starts_at,
    c.timezone, v.name, b.event_table_id, t.label, b.status,
    b.booked_by, bp.display_name,
    po.id, po.offered_seat_count, po.expires_at
  from public.bookings b
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted')
    and e.status = 'published'
    and e.starts_at > now()
  order by e.starts_at, c.name;
$$;

-- `authenticated` too, and not optionally: Supabase's hosted bootstrap
-- grants EXECUTE to it directly at creation time, which a revoke from
-- `public` never touches. Sixteen functions on this branch shipped
-- reachable by every signed-in user that way. See 20260825061000.
revoke execute on function public.event_seating(uuid)
  from public, anon, authenticated;
revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant  execute on function public.event_seating(uuid)      to authenticated;
grant  execute on function public.my_upcoming_bookings()   to authenticated;
```

Add both to **each** allowlist array in `supabase/tests/database/portable/grants.test.sql`. **Check the file's current `plan(N)` rather than trusting a number written here** — every task since Task 1 has extended this file, so any count this plan quotes is stale by the time it is read. Add one more positive case:

```sql
         'public.event_seating(uuid)',
         'public.my_upcoming_bookings()',
```

```sql
select ok(
  has_function_privilege('authenticated', 'public.event_seating(uuid)',
    'EXECUTE'),
  'authenticated can still execute event_seating'
);
```

- [ ] **Step 4: Write the data layer**

Create `lib/bookings.ts`:

```ts
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import type { SkillTier } from './events';
import type { SkillLevel } from './profile';

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
export type BookingGroupStatus = 'confirmed' | 'waitlisted' | 'cancelled';

// SkillTier and SkillLevel already exist — in lib/events.ts and
// lib/profile.ts respectively. Re-exported here so consumers of the seating
// components have one import, and NOT redefined: two structurally identical
// unions type-check against each other right up until one of them gains a
// value.
export type { SkillTier } from './events';

/** One live booking, as `event_seating` returns it. */
export type SeatOccupant = {
  booking_id: string;
  group_id: string;
  profile_id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  event_table_id: string | null;
  status: BookingStatus;
  booked_by: string;
  booked_by_name: string;
  group_status: BookingGroupStatus;
  waitlist_position: number | null;
  created_at: string;
};

export type PromotionOffer = {
  id: string;
  group_id: string;
  offered_seat_count: number;
  expires_at: string;
};

/** A row of "Your games". */
export type MyBooking = {
  booking_id: string;
  group_id: string;
  event_id: string;
  club_id: string;
  club_name: string;
  event_title: string;
  starts_at: string;
  club_timezone: string;
  venue_name: string;
  event_table_id: string | null;
  table_label: string | null;
  status: BookingStatus;
  booked_by: string;
  booked_by_name: string;
  offer_id: string | null;
  offer_seats: number | null;
  offer_expires_at: string | null;
};

export type BookingOutcome = {
  // Three, not two: booking_result reports a cancelled group as
  // 'cancelled', and the data layer reads it back after a cancellation.
  outcome: 'seated' | 'waitlisted' | 'cancelled';
  split: boolean;
  group_id: string | null;
  waitlist_position: number | null;
  offer: { id: string; seats: number; expires_at: string } | null;
  placements: {
    profile_id: string;
    event_table_id: string | null;
    table_label: string | null;
  }[];
};

type RpcError = { code?: string; message?: string; details?: string } | null;

/**
 * The refusal vocabulary, in the same shape as lib/events.ts's
 * RPC_ERROR_MESSAGES and for the same reason: plan 3 shipped a build that
 * reported every validation refusal as "Check your connection", which is
 * both wrong and unactionable. A refusal the database wrote is a sentence
 * the member can do something about.
 *
 * `details` carries a profile id for the two refusals that are about a
 * person; the caller substitutes the name it already holds from the roster.
 */
const BOOKING_REFUSALS: { code: string; contains: string; message: string }[] = [
  {
    code: '23514',
    contains: 'event not bookable',
    message: 'This game was cancelled.',
  },
  {
    code: '23514',
    contains: 'event already started',
    message: 'This game has already started.',
  },
  {
    code: '23514',
    contains: 'already booked',
    message: 'Someone in your group already has a seat at this game.',
  },
  {
    code: '23514',
    contains: 'not a member',
    message: 'Someone in your group is no longer in this club.',
  },
  {
    code: '23514',
    contains: 'table full',
    message: 'Someone just took the last seat at that table.',
  },
  {
    code: '23514',
    contains: 'no such table',
    message: 'That table is no longer part of this game.',
  },
  {
    code: '42501',
    contains: 'no such event',
    message: 'This game is no longer listed.',
  },
  {
    code: '23514',
    contains: 'offer expired',
    message: "That offer has expired — you're still on the waitlist.",
  },
  {
    code: '23514',
    contains: 'table does not need a fourth',
    message: 'That table needs more than one more player.',
  },
  {
    code: '23514',
    contains: 'booking already closed',
    message: 'That seat has already been given up.',
  },
  {
    code: '42501',
    contains: 'not your booking',
    message: 'That is not your seat to change.',
  },
  {
    code: '42501',
    contains: 'not your offer',
    message: 'Only the person who booked can answer that offer.',
  },
];

export function bookingErrorMessage(error: RpcError): string {
  if (!error) return GENERIC_ERROR;
  const text = error.message ?? '';
  const match = BOOKING_REFUSALS.find(
    (candidate) =>
      candidate.code === error.code && text.includes(candidate.contains),
  );
  return match ? match.message : GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// Pure helpers. No network, no mocks in their tests — the reason they are
// separated out at all.
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<SkillTier, string> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
  mixed: 'any',
};

/**
 * The soft warning, and the whole of tier enforcement in this product. The
 * database does not check tiers; the member decides and the host can move
 * people afterwards. A member with no skill level set is never warned —
 * they have declared nothing to be mismatched against.
 */
export function tierWarning(
  tier: SkillTier,
  level: SkillLevel | null,
  tableLabel: string,
): string | null {
  if (tier === 'mixed') return null;
  if (level === null) return null;
  if (level === tier) return null;
  return `${tableLabel} is set up for ${TIER_LABELS[tier]} players. Book anyway?`;
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Derived, never stored — the same rule need_a_fourth_stage applies in SQL.
 * Keeping the two in step matters: the screen shows the call and the cron
 * job announces it, and a member told about a table that shows nothing is
 * worse than not being told.
 */
export function needsAFourth(
  capacity: number,
  confirmed: number,
  startsAt: Date,
  now: Date,
): boolean {
  if (capacity < 2) return false;
  if (confirmed !== capacity - 1) return false;
  const until = startsAt.getTime() - now.getTime();
  return until > 0 && until <= FORTY_EIGHT_HOURS_MS;
}

/** Floors at zero: a table can hold more than it seats after a removal. */
export function seatsRemaining(capacity: number, confirmed: number): number {
  return Math.max(0, capacity - confirmed);
}

export function waitlistLabel(position: number): string {
  const rest = position % 100;
  const last = position % 10;
  const suffix =
    rest >= 11 && rest <= 13
      ? 'th'
      : last === 1
        ? 'st'
        : last === 2
          ? 'nd'
          : last === 3
            ? 'rd'
            : 'th';
  return `${position}${suffix} on the waitlist`;
}

export function offerCountdown(expiresAt: Date, now: Date): string {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 'Expired';
  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const minuteText = `${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
  if (hours === 0) return `${minuteText} left`;
  const hourText = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (rest === 0) return `${hourText} left`;
  return `${hourText} ${minuteText} left`;
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/**
 * Every live booking for one game, with names.
 *
 * Goes through the RPC rather than a select on `bookings` because
 * `profiles` is self-only (20260822180000) — a client-side join returns the
 * caller's own name and null for everybody else, with no error at all.
 */
export async function fetchEventSeating(
  eventId: string,
): Promise<SeatOccupant[] | null> {
  try {
    const { data, error } = await supabase.rpc('event_seating', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventSeating failed', error);
      return null;
    }
    return (data ?? []) as SeatOccupant[];
  } catch (cause) {
    console.error('fetchEventSeating failed', cause);
    return null;
  }
}

export async function fetchMyUpcomingBookings(): Promise<MyBooking[] | null> {
  try {
    const { data, error } = await supabase.rpc('my_upcoming_bookings');
    if (error) {
      console.error('fetchMyUpcomingBookings failed', error);
      return null;
    }
    return (data ?? []) as MyBooking[];
  } catch (cause) {
    console.error('fetchMyUpcomingBookings failed', cause);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes. Every one returns the { error } channel; none of them rejects.
// ---------------------------------------------------------------------------

export async function proposeBooking(input: {
  eventId: string;
  players: string[];
  preferredTableId: string | null;
  allowSplit: boolean;
}): Promise<{ plan: BookingOutcome | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('propose_booking', {
      target_event: input.eventId,
      players: input.players,
      preferred: input.preferredTableId,
      allow_split: input.allowSplit,
    });
    if (error || !data) {
      console.error('proposeBooking failed', error);
      return { plan: null, error: bookingErrorMessage(error) };
    }
    return { plan: data as BookingOutcome, error: null };
  } catch (cause) {
    console.error('proposeBooking failed', cause);
    return { plan: null, error: GENERIC_ERROR };
  }
}

export async function commitBooking(input: {
  eventId: string;
  players: string[];
  preferredTableId: string | null;
  allowSplit: boolean;
}): Promise<{ result: BookingOutcome | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('commit_booking', {
      target_event: input.eventId,
      players: input.players,
      preferred: input.preferredTableId,
      allow_split: input.allowSplit,
    });
    if (error || !data) {
      console.error('commitBooking failed', error);
      return { result: null, error: bookingErrorMessage(error) };
    }
    return { result: data as BookingOutcome, error: null };
  } catch (cause) {
    console.error('commitBooking failed', cause);
    return { result: null, error: GENERIC_ERROR };
  }
}

export async function cancelBooking(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_booking', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('cancelBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function declineBooking(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('decline_booking', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('declineBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('declineBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function cancelBookingGroup(
  groupId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_booking_group', {
      target_group: groupId,
    });
    if (error) {
      console.error('cancelBookingGroup failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelBookingGroup failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function placeBooking(
  bookingId: string,
  tableId: string | null,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('place_booking', {
      target_booking: bookingId,
      target_table: tableId,
    });
    if (error) {
      console.error('placeBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('placeBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function acceptPromotionOffer(
  offerId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('accept_promotion_offer', {
      target_offer: offerId,
    });
    if (error) {
      console.error('acceptPromotionOffer failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('acceptPromotionOffer failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function declinePromotionOffer(
  offerId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('decline_promotion_offer', {
      target_offer: offerId,
    });
    if (error) {
      console.error('declinePromotionOffer failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('declinePromotionOffer failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function callForAFourth(
  tableId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('call_for_a_fourth', {
      target_table: tableId,
    });
    if (error) {
      console.error('callForAFourth failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('callForAFourth failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 5: Run the helper tests**

```bash
npm test -- lib/bookings.test.ts
```

Expected: PASS, 18 of 18.

- [ ] **Step 6: Add the mocked tests for the read and write wrappers**

Append to `lib/bookings.test.ts`, following the mocking style already used in `lib/events.test.ts`:

```ts
import { beforeEach, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  bookingErrorMessage,
  cancelBooking,
  commitBooking,
  fetchEventSeating,
} from './bookings';
import { GENERIC_ERROR } from './constants';

beforeEach(() => rpc.mockReset());

describe('fetchEventSeating', () => {
  it('returns null rather than an empty list when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    // null and [] mean different things to the screen: "could not load"
    // versus "nobody has booked". Plan 3 shipped a screen that read a
    // failed fetch as "none" and said so out loud.
    expect(await fetchEventSeating('e1')).toBeNull();
  });

  it('returns an empty list when nobody has booked', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchEventSeating('e1')).toEqual([]);
  });
});

describe('commitBooking', () => {
  it('passes the arguments the RPC expects', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'seated' }, error: null });
    await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(rpc).toHaveBeenCalledWith('commit_booking', {
      target_event: 'e1',
      players: ['p1'],
      preferred: 't1',
      allow_split: true,
    });
  });

  it('reports a full game as a full game, not as a connection problem', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'already booked' },
    });
    const { error } = await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(error).toBe('Someone in your group already has a seat at this game.');
    expect(error).not.toBe(GENERIC_ERROR);
  });
});

describe('bookingErrorMessage', () => {
  it('falls back to the generic message for a refusal it does not know', async () => {
    expect(bookingErrorMessage({ code: '23514', message: 'mystery' })).toBe(
      GENERIC_ERROR,
    );
  });
});

describe('cancelBooking', () => {
  it('reports a started game plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'event already started' },
    });
    expect((await cancelBooking('b1')).error).toBe(
      'This game has already started.',
    );
  });
});
```

- [ ] **Step 7: Run everything**

```bash
npm test
npm run test:db
npx tsc --noEmit
```

Expected: all green, with 18 + 7 new Vitest tests and 64 grants assertions.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260825070000_seating_reads.sql lib/bookings.ts \
        lib/bookings.test.ts supabase/tests/database/portable/grants.test.sql
git commit -m "feat: add the booking data layer and its two reads

event_seating and my_upcoming_bookings are security definer functions
rather than client-side joins because profiles has been SELF-ONLY since
20260822180000 — joining bookings to profiles from the client returns your
own name and null for everybody else, with no error to notice.

Refusals map to written sentences through BOOKING_REFUSALS, in the shape
lib/events.ts already uses. Plan 3 shipped a build that told a host \"Check
your connection\" when the database had refused their input; a refusal is
something the member can act on and should read like it.

The pure helpers — tierWarning, needsAFourth, seatsRemaining,
waitlistLabel, offerCountdown — are separated out so their tests need no
mocking at all. needsAFourth restates need_a_fourth_stage's rule in
TypeScript; the two must stay in step."
```

---

### Task 9: The seat grid and the table card

**Files:**
- Create: `components/SeatGrid.tsx`
- Create: `components/TableCard.tsx`
- Create: `components/__tests__/SeatGrid.test.tsx`
- Create: `components/__tests__/TableCard.test.tsx`

**Interfaces:**
- Consumes: `lib/bookings.ts`'s `SeatOccupant`, `SkillTier`, `seatsRemaining`; `lib/theme`'s `colors`, `space`, `type`.
- Produces: `<SeatGrid>` and `<TableCard>`, both presentational — no `supabase` import, no fetching, no navigation. Tasks 10 and 12 compose them.

**Both components are pure.** They take data and callbacks and render. That is what lets Task 15's visual baselines and these tests cover every state — full, one short, empty, someone else's seat, your seat — without a database, and it is why the event screen can shrink instead of growing.

**Seats are drawn, not numbered.** The grid renders the occupants it was given, in the order it was given them, then fills the remainder with empty cells.

**The last empty seat reads "Last seat", not "Needs a 4th".** `TableCard`'s `Tag` already says "Needs a 4th", and having both render the same literal makes `getByText` ambiguous in this task's own tests — Task 9 hit exactly that. The accessibility label still distinguishes the cell ("Take the last seat at Table 3"), and the card is the right place for the call.

**"Bring someone" appears only when more than one seat is free** (`free > 1`). With a single seat left there is nobody to bring — the member should take it. A group of two would be waitlisted and then offered that one seat, which is a worse path than simply sitting down. Nothing in the props or the markup may suggest that a particular chair belongs to a particular position — the schema counts seats and the moment the UI implies otherwise, members start expecting "my usual seat".

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/SeatGrid.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SeatGrid from '../SeatGrid';

const seats = [
  { bookingId: 'b1', name: 'Jane P.', isYou: false },
  { bookingId: 'b2', name: 'Mei L.', isYou: false },
  { bookingId: 'b3', name: 'You', isYou: true },
];

describe('SeatGrid', () => {
  it('draws every seat the table has, filled and empty', () => {
    render(<SeatGrid tableLabel="Table 1" capacity={4} seats={seats} />);
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.getByText('Mei L.')).toBeTruthy();
    expect(screen.getAllByLabelText('Take a seat at Table 1')).toHaveLength(1);
  });

  it('offers no empty seat when the table is full', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={3}
        seats={seats}
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });

  // Removing a table lowers capacity without ejecting anybody, so a table
  // can legitimately hold more people than it seats. Rendering -1 empty
  // seats, or crashing, are both worse than rendering none.
  it('survives a table holding more people than it seats', () => {
    render(<SeatGrid tableLabel="Table 1" capacity={2} seats={seats} />);
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
    expect(screen.getByText('Jane P.')).toBeTruthy();
  });

  it('calls back when an empty seat is taken', () => {
    const onTakeSeat = vi.fn();
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={onTakeSeat}
      />,
    );
    fireEvent.click(screen.getByLabelText('Take a seat at Table 1'));
    expect(onTakeSeat).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to press while a booking is in flight', () => {
    const onTakeSeat = vi.fn();
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={onTakeSeat}
        busy
      />,
    );
    fireEvent.click(screen.getByLabelText('Take a seat at Table 1'));
    expect(onTakeSeat).not.toHaveBeenCalled();
  });

  it('marks the last empty seat as the one being called for', () => {
    render(
      <SeatGrid
        tableLabel="Table 3"
        capacity={4}
        seats={seats}
        needsFourth
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Take the last seat at Table 3')).toBeTruthy();
  });
});
```

Create `components/__tests__/TableCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TableCard from '../TableCard';

const table = {
  id: 't1',
  label: 'Table 2',
  skill_tier: 'advanced' as const,
  capacity: 4,
};

const occupants = [
  {
    booking_id: 'b1',
    group_id: 'g1',
    profile_id: 'p1',
    display_name: 'Ravi K.',
    skill_level: 'advanced' as const,
    event_table_id: 't1',
    status: 'confirmed' as const,
    booked_by: 'p1',
    booked_by_name: 'Ravi K.',
    group_status: 'confirmed' as const,
    waitlist_position: null,
    created_at: '2026-08-20T10:00:00Z',
  },
];

describe('TableCard', () => {
  it('names the table and its tier', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('Table 2')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
  });

  it('says how many seats are left', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('3 seats free')).toBeTruthy();
  });

  it('singularises one seat', () => {
    render(
      <TableCard
        table={{ ...table, capacity: 2 }}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('1 seat free')).toBeTruthy();
  });

  it('shows your own seat as yours', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p1"
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('Ravi K.')).toBeNull();
  });

  it('says who booked a seat for somebody else', () => {
    render(
      <TableCard
        table={table}
        occupants={[
          { ...occupants[0], profile_id: 'p9', display_name: 'You',
            booked_by: 'p1', booked_by_name: 'Ravi K.' },
        ]}
        youId="p9"
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('Ravi K. booked this for you')).toBeTruthy();
  });

  it('calls for a fourth when it is one short and close', () => {
    render(
      <TableCard
        table={table}
        occupants={[occupants[0], { ...occupants[0], booking_id: 'b2', profile_id: 'p2', display_name: 'Dot M.' }, { ...occupants[0], booking_id: 'b3', profile_id: 'p3', display_name: 'Sue T.' }]}
        youId="p9"
        needsFourth
        onTakeSeat={vi.fn()}
        onBringSomeone={vi.fn()}
      />,
    );
    expect(screen.getByText('Needs a 4th')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm test -- components/__tests__/SeatGrid.test.tsx components/__tests__/TableCard.test.tsx
```

Expected: FAIL — `Failed to resolve import "../SeatGrid"`.

- [ ] **Step 3: Write `components/SeatGrid.tsx`**

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

export type Seat = {
  bookingId: string;
  name: string;
  isYou: boolean;
};

type Props = {
  tableLabel: string;
  capacity: number;
  seats: Seat[];
  /** Omitted for a read-only render — a cancelled game, or somebody else's. */
  onTakeSeat?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
};

/**
 * One table's seats.
 *
 * Occupied seats are drawn in the order they are given, then the remainder
 * are drawn empty. Nothing here numbers a seat, and nothing may: the schema
 * COUNTS seats, and a UI that implies Table 2 seat 3 is a durable place
 * teaches members to expect something the data cannot promise.
 *
 * Empty count floors at zero. A table can hold more people than it seats
 * after a host removes another table, and rendering a negative number of
 * empty chairs is not a state anybody needs to see.
 */
export default function SeatGrid({
  tableLabel,
  capacity,
  seats,
  onTakeSeat,
  busy = false,
  needsFourth = false,
}: Props) {
  const empties = Math.max(0, capacity - seats.length);
  const lastSeatCall = needsFourth && empties === 1;

  return (
    <View style={styles.grid}>
      {seats.map((seat) => (
        <View
          key={seat.bookingId}
          style={[styles.seat, seat.isYou && styles.seatYou]}
        >
          <Text style={[styles.name, seat.isYou && styles.nameYou]}>
            {seat.isYou ? 'You' : seat.name}
          </Text>
        </View>
      ))}

      {Array.from({ length: empties }, (_, index) => (
        <Pressable
          key={`empty-${index}`}
          style={[styles.seat, styles.empty, lastSeatCall && styles.calling]}
          onPress={busy ? undefined : onTakeSeat}
          disabled={busy || !onTakeSeat}
          accessibilityRole="button"
          accessibilityLabel={
            lastSeatCall
              ? `Take the last seat at ${tableLabel}`
              : `Take a seat at ${tableLabel}`
          }
          aria-disabled={busy || !onTakeSeat}
        >
          <Text style={[styles.emptyText, lastSeatCall && styles.callingText]}>
            {lastSeatCall ? 'Last seat' : 'Empty'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  seat: {
    flexGrow: 1,
    flexBasis: '44%',
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    backgroundColor: colors.neutral[300],
    justifyContent: 'center',
  },
  seatYou: { backgroundColor: colors.accent2Color },
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    alignItems: 'center',
  },
  calling: { borderColor: colors.accentColor },
  // lib/theme's `type` is a token bag — font FAMILIES plus a `size` map —
  // not a set of ready-made style objects. There is no `type.body` to
  // spread; every text style is written out from the tokens.
  name: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  nameYou: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.neutral[100],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
  },
  callingText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accent[700],
  },
});
```

`radius.sm` (8) and `space[…]` are real exports of `lib/theme`; `type` is not — it holds font families and a `size` map, so text styles are written from `type.bodyRegular` / `type.size.body` rather than spread from a ready-made object. `Card.tsx` is the reference for anything else.

- [ ] **Step 4: Write `components/TableCard.tsx`**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import SeatGrid from './SeatGrid';
import Tag from './Tag';
import type { SeatOccupant, SkillTier } from '../lib/bookings';
import { seatsRemaining } from '../lib/bookings';
import { colors, space, type } from '../lib/theme';

const TIER_LABELS: Record<SkillTier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Any level',
};

type Props = {
  table: { id: string; label: string; skill_tier: SkillTier; capacity: number };
  occupants: SeatOccupant[];
  youId: string;
  onTakeSeat?: () => void;
  onBringSomeone?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
  /** Organizer controls, injected by the event screen. */
  children?: React.ReactNode;
};

/**
 * One table: who is at it, how many seats are left, and the two ways in.
 *
 * Tapping an empty seat books YOU, immediately — the common case is one
 * tap. "Bring someone" is the quieter control that opens the group sheet.
 * Everything else on this card is read-only.
 */
export default function TableCard({
  table,
  occupants,
  youId,
  onTakeSeat,
  onBringSomeone,
  busy = false,
  needsFourth = false,
  children,
}: Props) {
  const seated = occupants.filter((o) => o.status === 'confirmed');
  const free = seatsRemaining(table.capacity, seated.length);
  const bookedForYou = seated.find(
    (o) => o.profile_id === youId && o.booked_by !== youId,
  );

  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.label}>{table.label}</Text>
        {needsFourth ? <Tag>Needs a 4th</Tag> : null}
      </View>
      <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>

      <SeatGrid
        tableLabel={table.label}
        capacity={table.capacity}
        seats={seated.map((o) => ({
          bookingId: o.booking_id,
          name: o.display_name,
          isYou: o.profile_id === youId,
        }))}
        onTakeSeat={onTakeSeat}
        busy={busy}
        needsFourth={needsFourth}
      />

      <Text style={styles.free}>
        {free} {free === 1 ? 'seat' : 'seats'} free
      </Text>

      {bookedForYou ? (
        <Text style={styles.help}>
          {bookedForYou.booked_by_name} booked this for you
        </Text>
      ) : null}

      {onBringSomeone && free > 1 ? (
        <Button
          variant="secondary"
          big={false}
          disabled={busy}
          onPress={onBringSomeone}
          accessibilityLabel={`Bring someone to ${table.label}`}
        >
          Bring someone
        </Button>
      ) : null}

      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  // 16 is the ONLY sanctioned size below 18, and only for helper text.
  tier: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  free: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accent2Color,
    marginTop: space[2],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[1],
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- components/__tests__/SeatGrid.test.tsx components/__tests__/TableCard.test.tsx
npx tsc --noEmit
```

Expected: PASS, 12 of 12, and a clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add components/SeatGrid.tsx components/TableCard.tsx \
        components/__tests__/SeatGrid.test.tsx \
        components/__tests__/TableCard.test.tsx
git commit -m "feat: draw a table's seats, empty ones included

SeatGrid renders the occupants it is given and fills the rest with empty,
tappable seats. It never numbers one: the schema counts seats, and a UI
that implies otherwise teaches members to expect a chair the data cannot
promise them.

Empty count floors at zero, because a host removing a table leaves a game
holding more people than it seats and a negative number of chairs is not a
state anyone needs to see.

Both components are presentational — no supabase import, no fetching — so
every state is testable and the event screen can shrink instead of grow."
```

---

### Task 10: Booking on the event screen

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Create: `components/WaitlistPanel.tsx`
- Create: `app/__tests__/bookings-detail.test.tsx`

**Interfaces:**
- Consumes: Task 8's `fetchEventSeating`, `commitBooking`, `cancelBooking`, `declineBooking`, `acceptPromotionOffer`, `declinePromotionOffer`, `tierWarning`, `needsAFourth`, `waitlistLabel`, `offerCountdown`; Task 9's `TableCard`.
- Produces: the member-facing booking screen. Task 12 adds the organizer controls into the `children` slot `TableCard` already has.

**The screen's job shrinks.** It fetches (event, tables, seating, offer), holds the busy/error state, and composes `TableCard` and `WaitlistPanel`. The existing organizer table controls stay where they are for now; Task 12 moves them into `HostSeating`.

**A failed seating fetch is not an empty game.** Follow the `venuesFailed` pattern plan 3 arrived at, and which `todo.md` records the venues screen still getting wrong: `seatingFailed` distinguishes "could not load" from "nobody has booked", and the empty state renders only for the second.

**Tap-to-book is one call.** `commitBooking({ eventId, players: [me], preferredTableId: table.id, allowSplit: true })`. A tier mismatch shows `tierWarning`'s sentence as a confirm first; nothing else interrupts.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/bookings-detail.test.tsx`. Follow the mocking already used by `app/__tests__/events-detail.test.tsx` — same router mock, same session mock, same `lib/*` mocks.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const commitBooking = vi.fn();
const cancelBooking = vi.fn();
const fetchEventSeating = vi.fn();

vi.mock('../../lib/bookings', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookings')>(
    '../../lib/bookings',
  );
  return {
    ...actual,
    fetchEventSeating: (...a: unknown[]) => fetchEventSeating(...a),
    commitBooking: (...a: unknown[]) => commitBooking(...a),
    cancelBooking: (...a: unknown[]) => cancelBooking(...a),
  };
});

// … the event/club/session mocks copied from events-detail.test.tsx …

import EventScreen from '../clubs/[id]/events/[eventId]/index';

beforeEach(() => {
  commitBooking.mockReset();
  cancelBooking.mockReset();
  fetchEventSeating.mockReset();
  fetchEventSeating.mockResolvedValue([]);
});

describe('the event screen, for a member', () => {
  it('books a seat in one tap', async () => {
    commitBooking.mockResolvedValue({
      result: { outcome: 'seated', placements: [] },
      error: null,
    });
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Take a seat at Table 1'));
    await waitFor(() =>
      expect(commitBooking).toHaveBeenCalledWith(
        expect.objectContaining({ preferredTableId: 't1', players: ['me'] }),
      ),
    );
  });

  it('asks first when the table is set up for another tier', async () => {
    render(<EventScreen />);   // Table 2 is 'advanced'; the member is a beginner
    fireEvent.click(await screen.findByLabelText('Take a seat at Table 2'));
    expect(
      await screen.findByText(
        'Table 2 is set up for advanced players. Book anyway?',
      ),
    ).toBeTruthy();
    expect(commitBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Yes, book me'));
    await waitFor(() => expect(commitBooking).toHaveBeenCalled());
  });

  it('tells the member where they stand when the game is full', async () => {
    commitBooking.mockResolvedValue({
      result: { outcome: 'waitlisted', waitlist_position: 2, placements: [] },
      error: null,
    });
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Join the waitlist'));
    expect(await screen.findByText('2nd on the waitlist')).toBeTruthy();
  });

  // The refusal the database wrote, not "check your connection". Plan 3
  // shipped the other thing and had to fix it at merge.
  it('shows the database''s refusal in the words it wrote', async () => {
    commitBooking.mockResolvedValue({
      result: null,
      error: 'Someone just took the last seat at that table.',
    });
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Take a seat at Table 1'));
    expect(
      await screen.findByText('Someone just took the last seat at that table.'),
    ).toBeTruthy();
  });

  it('does not read a failed seating fetch as an empty game', async () => {
    fetchEventSeating.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('Could not load who is coming to this game.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nobody has booked yet.')).toBeNull();
  });

  it('offers a cancelled game no way in', async () => {
    // event.status = 'cancelled' in this render's mock
    render(<EventScreen />);
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- app/__tests__/bookings-detail.test.tsx
```

Expected: FAIL — no `Take a seat at Table 1` label exists yet.

- [ ] **Step 3: Write `components/WaitlistPanel.tsx`**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import type { SeatOccupant } from '../lib/bookings';
import { offerCountdown, waitlistLabel } from '../lib/bookings';
import { colors, space, type } from '../lib/theme';

type Props = {
  unseated: SeatOccupant[];
  waiting: SeatOccupant[];
  youId: string;
  offer: { id: string; seats: number; expires_at: string } | null;
  now: Date;
  busy?: boolean;
  onAcceptOffer?: () => void;
  onDeclineOffer?: () => void;
  onLeaveWaitlist?: () => void;
};

/**
 * Everything about this game that is not a seat: people confirmed but not
 * yet placed, the queue in order, and any offer being held for you.
 *
 * The offer is read from `promotion_offers`, which is live state — not from
 * the outbox. The outbox is plan 6's queue and nobody reads it.
 */
export default function WaitlistPanel({
  unseated,
  waiting,
  youId,
  offer,
  now,
  busy = false,
  onAcceptOffer,
  onDeclineOffer,
  onLeaveWaitlist,
}: Props) {
  const yourPlace = waiting.find((w) => w.profile_id === youId);

  if (!unseated.length && !waiting.length && !offer) return null;

  return (
    <>
      {offer ? (
        <Card>
          <Text style={styles.heading}>
            {offer.seats} {offer.seats === 1 ? 'seat is' : 'seats are'} free for
            your group
          </Text>
          <Text style={styles.help}>
            {offerCountdown(new Date(offer.expires_at), now)}
          </Text>
          <Button
            block
            disabled={busy}
            onPress={onAcceptOffer}
            accessibilityLabel={`Take the ${offer.seats} ${offer.seats === 1 ? 'seat' : 'seats'}`}
          >
            Take {offer.seats === 1 ? 'the seat' : `the ${offer.seats} seats`}
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={onDeclineOffer}
            accessibilityLabel="Decline the offer"
          >
            No thanks
          </Button>
        </Card>
      ) : null}

      {unseated.length ? (
        <Card>
          <Text style={styles.heading}>Coming, not yet seated</Text>
          {unseated.map((person) => (
            <Text key={person.booking_id} style={styles.person}>
              {person.profile_id === youId ? 'You' : person.display_name}
            </Text>
          ))}
          <Text style={styles.help}>
            The host will place {unseated.length === 1 ? 'them' : 'these players'} at a table.
          </Text>
        </Card>
      ) : null}

      {waiting.length ? (
        <Card>
          <Text style={styles.heading}>Waiting for a seat</Text>
          {waiting.map((person) => (
            <Text key={person.booking_id} style={styles.person}>
              {person.waitlist_position}. {person.profile_id === youId ? 'You' : person.display_name}
            </Text>
          ))}
          {yourPlace?.waitlist_position ? (
            <Text style={styles.help}>
              {waitlistLabel(yourPlace.waitlist_position)}
            </Text>
          ) : null}
          {yourPlace && onLeaveWaitlist ? (
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={onLeaveWaitlist}
              accessibilityLabel="Leave the waitlist"
            >
              Leave the waitlist
            </Button>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  person: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[1],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[2],
  },
});
```

- [ ] **Step 4: Wire the event screen**

In `app/clubs/[id]/events/[eventId]/index.tsx`:

1. Add state next to the existing `tables` / `tablesFailed` pair:

```tsx
const [seating, setSeating] = useState<SeatOccupant[]>([]);
const [seatingFailed, setSeatingFailed] = useState(false);
const [offer, setOffer] = useState<PromotionOffer | null>(null);
const [pendingTier, setPendingTier] = useState<
  { tableId: string; message: string } | null
>(null);
```

2. In the existing `load()`, add the seating fetch alongside the tables fetch — and set `seatingFailed` from a null result, never render null as empty:

```tsx
const rows = await fetchEventSeating(eventId);
setSeatingFailed(rows === null);
setSeating(rows ?? []);
```

3. Replace the read-only table list with `TableCard`. `bookSeat` is the whole of tap-to-book:

```tsx
const me = session?.user.id ?? '';

async function bookSeat(tableId: string) {
  await run(async () => {
    const { error } = await commitBooking({
      eventId,
      players: [me],
      preferredTableId: tableId,
      allowSplit: true,
    });
    return { error };
  });
}

function takeSeat(table: EventTable) {
  const warning = tierWarning(table.skill_tier, mySkillLevel, table.label);
  // The soft warning, and the entire enforcement of skill tiers in this
  // product. The database does not check; the host can move people.
  if (warning) {
    setPendingTier({ tableId: table.id, message: warning });
    return;
  }
  void bookSeat(table.id);
}
```

4. Render the confirm when `pendingTier` is set, with "Yes, book me" and "Never mind".

5. Render `WaitlistPanel` below the tables, passing `now={new Date()}`.

6. `canBook` gates everything: `event.status === 'published' && new Date(event.starts_at) > new Date()`. When it is false, pass no `onTakeSeat` to `TableCard` at all — a disabled control that explains itself is better than a control that errors, and this matches how plan 3 hides `reset_event_to_series` rather than showing it and failing.

7. When the game is full and the member holds no seat, render a single **Join the waitlist** button that calls `commitBooking` with the same arguments and `preferredTableId: null`.

- [ ] **Step 5: Run the tests**

```bash
npm test -- app/__tests__/bookings-detail.test.tsx
npx tsc --noEmit
```

Expected: PASS, 6 of 6.

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" components/WaitlistPanel.tsx \
        app/__tests__/bookings-detail.test.tsx
git commit -m "feat: take a seat from the event screen

Tapping an empty seat books you, in one call, with no confirm — except a
skill-tier mismatch, which asks once and proceeds. That warning is the
whole of tier enforcement in this product: the database does not check,
and the host can move people afterwards.

seatingFailed distinguishes a failed fetch from an empty game, following
the venuesFailed pattern plan 3 arrived at and that todo.md records the
venues screen still getting wrong. A game whose guest list could not load
says so; it does not say nobody is coming.

A cancelled or started game is given no booking control at all rather than
a control that errors when pressed."
```

---

### Task 11: Bringing someone

**Files:**
- Create: `components/BringSomeoneSheet.tsx`
- Create: `components/__tests__/BringSomeoneSheet.test.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: plan 2's `fetchRoster` (`lib/clubs.ts`); Task 8's `proposeBooking`, `commitBooking`; the existing `Toggle` component.
- Produces: `<BringSomeoneSheet>`. Nothing else consumes it.

**This is the only place `proposeBooking` is used.** A group booking can be split, and the parent spec is explicit that the app shows exactly who sits where and asks for confirmation. Solo booking skips it because there is nothing to show.

**`allow_split` defaults to on**, worded as the spec words it: *"Split us up if we can't sit together"*. The common case is one tap on Confirm.

**Choosing "Any table" hides the split toggle.** Nobody in an any-table group is placed, so there is nothing to split — leaving the toggle visible would be offering a choice that changes nothing.

**Only club members can be added.** The picker lists the roster minus anybody already holding a live booking for this game; the database refuses both cases anyway, and the picker not offering them is what stops the member meeting a refusal they could not have predicted.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/BringSomeoneSheet.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BringSomeoneSheet from '../BringSomeoneSheet';

const roster = [
  { profile_id: 'me', role: 'member' as const, display_name: 'You', skill_level: null },
  { profile_id: 'p2', role: 'member' as const, display_name: 'Jane P.', skill_level: null },
  { profile_id: 'p3', role: 'member' as const, display_name: 'Mei L.', skill_level: null },
];

const propose = vi.fn();
const commit = vi.fn();

beforeEach(() => {
  propose.mockReset();
  commit.mockReset();
});

function renderSheet(extra = {}) {
  return render(
    <BringSomeoneSheet
      roster={roster}
      booked={['p3']}
      youId="me"
      tables={[
        { id: 't1', label: 'Table 1', skill_tier: 'mixed', capacity: 4 },
        { id: 't2', label: 'Table 2', skill_tier: 'advanced', capacity: 4 },
      ]}
      initialTableId="t2"
      onPropose={propose}
      onCommit={commit}
      onClose={vi.fn()}
      {...extra}
    />,
  );
}

describe('BringSomeoneSheet', () => {
  it('offers the roster, minus anybody already coming', () => {
    renderSheet();
    expect(screen.getByLabelText('Add Jane P.')).toBeTruthy();
    expect(screen.queryByLabelText('Add Mei L.')).toBeNull();
  });

  it('defaults to splitting the group up rather than making them wait', () => {
    renderSheet();
    expect(
      screen.getByLabelText("Split us up if we can't sit together"),
    ).toHaveProperty('checked', true);
  });

  it('shows exactly who sits where before committing a split', async () => {
    propose.mockResolvedValue({
      plan: {
        outcome: 'seated',
        split: true,
        placements: [
          { profile_id: 'me', event_table_id: 't2', table_label: 'Table 2' },
          { profile_id: 'p2', event_table_id: 't1', table_label: 'Table 1' },
        ],
      },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));

    expect(await screen.findByText('You → Table 2')).toBeTruthy();
    expect(screen.getByText('Jane P. → Table 1')).toBeTruthy();
    // Nothing is written until the member says yes to the split they saw.
    expect(commit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Book it this way'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it('commits without a second step when nobody is split up', async () => {
    propose.mockResolvedValue({
      plan: { outcome: 'seated', split: false, placements: [] },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it('offers the waitlist when the group does not fit', async () => {
    propose.mockResolvedValue({
      plan: { outcome: 'waitlisted', split: false, placements: [] },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(
      await screen.findByText('There is no room for all of you right now.'),
    ).toBeTruthy();
    expect(screen.getByText('Wait together')).toBeTruthy();
  });

  it('hides the split toggle once "any table" is chosen', () => {
    renderSheet({ initialTableId: null });
    expect(
      screen.queryByLabelText("Split us up if we can't sit together"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- components/__tests__/BringSomeoneSheet.test.tsx
```

Expected: FAIL — `Failed to resolve import "../BringSomeoneSheet"`.

- [ ] **Step 3: Write the component**

Create `components/BringSomeoneSheet.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import Toggle from './Toggle';
import type { BookingOutcome } from '../lib/bookings';
import type { EventTable } from '../lib/events';
import type { RosterMember } from '../lib/clubs';
import { colors, radius, space, type } from '../lib/theme';

type Props = {
  roster: RosterMember[];
  /** profile ids already holding a live booking for this game. */
  booked: string[];
  youId: string;
  tables: EventTable[];
  initialTableId: string | null;
  onPropose: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ plan: BookingOutcome | null; error: string | null }>;
  onCommit: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ result: BookingOutcome | null; error: string | null }>;
  onClose: () => void;
};

/**
 * The only place propose_booking is used.
 *
 * A group can be split across tables, and the parent spec is explicit that
 * the app shows exactly who sits where and asks. A solo booking skips this
 * entirely — there is nothing to show, so the round trip would buy a dialog
 * nobody needs.
 */
export default function BringSomeoneSheet({
  roster,
  booked,
  youId,
  tables,
  initialTableId,
  onPropose,
  onCommit,
  onClose,
}: Props) {
  const [players, setPlayers] = useState<string[]>([youId]);
  const [tableId, setTableId] = useState<string | null>(initialTableId);
  const [allowSplit, setAllowSplit] = useState(true);
  const [plan, setPlan] = useState<BookingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Anybody already coming is not offered. The database refuses them
  // anyway; not offering them is what stops a member meeting a refusal
  // they had no way to predict.
  const available = roster.filter(
    (m) => m.profile_id !== youId && !booked.includes(m.profile_id),
  );

  const nameOf = (id: string) =>
    id === youId
      ? 'You'
      : (roster.find((m) => m.profile_id === id)?.display_name ?? 'Someone');

  function toggle(id: string) {
    setPlan(null);
    setPlayers((current) =>
      current.includes(id)
        ? current.filter((p) => p !== id)
        : [...current, id],
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const { plan: proposed, error: failed } = await onPropose({
      players,
      preferredTableId: tableId,
      allowSplit,
    });
    setBusy(false);
    if (failed || !proposed) {
      setError(failed);
      return;
    }
    // Nothing to show: seat them without a second tap.
    if (proposed.outcome === 'seated' && !proposed.split) {
      await commit(allowSplit);
      return;
    }
    setPlan(proposed);
  }

  async function commit(split: boolean) {
    setBusy(true);
    setError(null);
    const { error: failed } = await onCommit({
      players,
      preferredTableId: tableId,
      allowSplit: split,
    });
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
  }

  return (
    <Card>
      <Text style={styles.heading}>Who's coming?</Text>

      <View style={styles.people}>
        <View style={[styles.person, styles.personOn]}>
          <Text style={styles.personTextOn}>You</Text>
        </View>
        {available.map((member) => {
          const on = players.includes(member.profile_id);
          return (
            <Pressable
              key={member.profile_id}
              style={[styles.person, on && styles.personOn]}
              onPress={() => toggle(member.profile_id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${on ? 'Remove' : 'Add'} ${member.display_name}`}
              aria-selected={on}
              aria-disabled={busy}
            >
              <Text style={on ? styles.personTextOn : styles.personText}>
                {member.display_name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.heading}>Where?</Text>
      <View style={styles.people}>
        {tables.map((table) => {
          const on = tableId === table.id;
          return (
            <Pressable
              key={table.id}
              style={[styles.person, on && styles.personOn]}
              onPress={() => {
                setPlan(null);
                setTableId(table.id);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Sit at ${table.label}`}
              aria-selected={on}
              aria-disabled={busy}
            >
              <Text style={on ? styles.personTextOn : styles.personText}>
                {table.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.person, tableId === null && styles.personOn]}
          onPress={() => {
            setPlan(null);
            setTableId(null);
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Any table"
          aria-selected={tableId === null}
          aria-disabled={busy}
        >
          <Text
            style={tableId === null ? styles.personTextOn : styles.personText}
          >
            Any table
          </Text>
        </Pressable>
      </View>

      {/*
        Hidden for "any table": nobody in an any-table group is placed, so
        there is nothing to split, and offering the choice would be
        offering one that changes nothing.
      */}
      {tableId !== null ? (
        <Toggle
          label="Split us up if we can't sit together"
          value={allowSplit}
          onValueChange={(next) => {
            setPlan(null);
            setAllowSplit(next);
          }}
          disabled={busy}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {plan === null ? (
        <Button block loading={busy} onPress={confirm}
          accessibilityLabel="Confirm this booking">
          Confirm
        </Button>
      ) : plan.outcome === 'seated' ? (
        <>
          <Text style={styles.heading}>They can't all sit together</Text>
          {plan.placements.map((placement) => (
            <Text key={placement.profile_id} style={styles.placement}>
              {nameOf(placement.profile_id)} → {placement.table_label}
            </Text>
          ))}
          <Button block loading={busy} onPress={() => commit(true)}
            accessibilityLabel="Book it this way">
            Book it this way
          </Button>
          <Button variant="ghost" big={false} disabled={busy}
            onPress={() => commit(false)}
            accessibilityLabel="Wait together instead">
            Wait together instead
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.placement}>
            There is no room for all of you right now.
          </Text>
          <Button block loading={busy} onPress={() => commit(allowSplit)}
            accessibilityLabel="Wait together">
            Wait together
          </Button>
        </>
      )}

      <Button variant="ghost" big={false} disabled={busy} onPress={onClose}
        accessibilityLabel="Close">
        Never mind
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
    marginTop: space[3],
  },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  person: {
    borderRadius: radius.pill,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    backgroundColor: colors.neutral[300],
  },
  personOn: { backgroundColor: colors.accent2Color },
  personText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  personTextOn: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.neutral[100],
  },
  placement: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[1],
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[700],
    marginTop: space[2],
  },
});
```

`RosterMember` is `lib/clubs.ts`'s existing roster row type — use whatever it is actually called there rather than declaring a second one.

**`Toggle` takes `value`, `onValueChange` and `accessibilityLabel`, and nothing else.** It sets `accessibilityRole="switch"` and `aria-checked` internally — do not pass it `accessibilityState`, which it no longer accepts and which react-native-web drops on the floor anyway. Every interactive control in this sheet states its state through a flat `aria-*` prop for the same reason; see `components/Toggle.tsx`'s docstring.

- [ ] **Step 4: Wire it into the event screen**

`TableCard`'s `onBringSomeone` opens the sheet with `initialTableId` set to that table. A screen-level "Bring someone" button opens it with `initialTableId: null`. Roster comes from the existing `fetchRoster(clubId)` call the screen may already make; if not, add it to `load()` with its own failure flag.

- [ ] **Step 5: Run the tests**

```bash
npm test -- components/__tests__/BringSomeoneSheet.test.tsx
npx tsc --noEmit
```

Expected: PASS, 6 of 6.

- [ ] **Step 6: Commit**

```bash
git add components/BringSomeoneSheet.tsx \
        components/__tests__/BringSomeoneSheet.test.tsx \
        "app/clubs/[id]/events/[eventId]/index.tsx"
git commit -m "feat: book with friends, and see the split before it happens

The only place propose_booking is used. A group can be split across tables,
so the app shows exactly who sits where and asks; a solo booking skips the
round trip because there is nothing to show.

allow_split defaults to on and is worded as the spec words it, so the
common case is one tap on Confirm. Choosing \"Any table\" hides the toggle
entirely — nobody in an any-table group is placed, so there is nothing to
split and offering the choice would be offering nothing.

The picker omits members already holding a seat at this game. The database
refuses them anyway; not offering them is what keeps a member from meeting
a refusal they had no way to predict."
```

---

### Task 12: The host's seating controls

**Files:**
- Create: `components/HostSeating.tsx`
- Create: `components/__tests__/HostSeating.test.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: Task 8's `placeBooking`, `cancelBooking`, `callForAFourth`; Task 9's `TableCard` `children` slot.
- Produces: `<HostSeating>`. Only the event screen consumes it.

**What a host can do here:** seat somebody who booked "any table", move a player between tables, remove a booking, and call for a fourth before the 48-hour window opens. Nothing here reseats anybody automatically — the roadmap parks that under "hosts have opinions about who sits where", and the whole design defers to the host rather than an algorithm.

**"Call for a 4th now" appears only when the table qualifies.** `call_for_a_fourth` refuses a table that needs two, so showing the button unconditionally would be showing a button whose only job is to produce an error. Gate it on the same occupancy rule `needsAFourth` implements, minus the 48-hour window — that is exactly what the early call is for.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/HostSeating.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HostSeating from '../HostSeating';

const place = vi.fn();
const remove = vi.fn();
const call = vi.fn();

const tables = [
  { id: 't1', label: 'Table 1', skill_tier: 'mixed' as const, capacity: 4 },
  { id: 't2', label: 'Table 2', skill_tier: 'advanced' as const, capacity: 4 },
];

const seated = {
  booking_id: 'b1',
  group_id: 'g1',
  profile_id: 'p1',
  display_name: 'Ravi K.',
  skill_level: null,
  event_table_id: 't1',
  status: 'confirmed' as const,
  booked_by: 'p1',
  booked_by_name: 'Ravi K.',
  group_status: 'confirmed' as const,
  waitlist_position: null,
  created_at: '2026-08-20T10:00:00Z',
};

beforeEach(() => {
  place.mockReset();
  remove.mockReset();
  call.mockReset();
});

describe('HostSeating', () => {
  it('moves a player to another table', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move Ravi K. to Table 2'));
    await waitFor(() => expect(place).toHaveBeenCalledWith('b1', 't2'));
  });

  it('unseats a player without removing them from the game', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Unseat Ravi K.'));
    await waitFor(() => expect(place).toHaveBeenCalledWith('b1', null));
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a player from the game entirely', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Remove Ravi K. from this game'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('b1'));
  });

  // The RPC refuses a table that needs two players, so a button shown
  // unconditionally would exist only to produce an error.
  it('offers no early call at a table that needs more than one player', () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    expect(screen.queryByText('Call for a 4th now')).toBeNull();
  });

  it('offers the early call when the table is one short', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth
      />,
    );
    fireEvent.click(screen.getByText('Call for a 4th now'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('t1'));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- components/__tests__/HostSeating.test.tsx
```

Expected: FAIL — `Failed to resolve import "../HostSeating"`.

- [ ] **Step 3: Write the component**

Create `components/HostSeating.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import type { SeatOccupant } from '../lib/bookings';
import type { EventTable } from '../lib/events';
import { colors, space, type } from '../lib/theme';

type Props = {
  /** Everybody seated at THIS table. */
  occupants: SeatOccupant[];
  /** Confirmed but unplaced, anywhere in this game. */
  unseated?: SeatOccupant[];
  tables: EventTable[];
  table: EventTable;
  busy?: boolean;
  canCallForAFourth: boolean;
  onPlace: (bookingId: string, tableId: string | null) => void;
  onRemove: (bookingId: string) => void;
  onCallForAFourth: (tableId: string) => void;
};

/**
 * The organizer's controls for one table.
 *
 * Nothing here reseats anybody automatically. The roadmap parks automatic
 * seating under "hosts have opinions about who sits where", so every
 * rearrangement in this plan is somebody's deliberate act.
 */
export default function HostSeating({
  occupants,
  unseated = [],
  tables,
  table,
  busy = false,
  canCallForAFourth,
  onPlace,
  onRemove,
  onCallForAFourth,
}: Props) {
  const elsewhere = tables.filter((t) => t.id !== table.id);

  return (
    <View style={styles.wrap}>
      {occupants.map((person) => (
        <View key={person.booking_id} style={styles.person}>
          <Text style={styles.name}>{person.display_name}</Text>
          <View style={styles.controls}>
            {elsewhere.map((other) => (
              <Button
                key={other.id}
                variant="secondary"
                big={false}
                disabled={busy}
                onPress={() => onPlace(person.booking_id, other.id)}
                accessibilityLabel={`Move ${person.display_name} to ${other.label}`}
              >
                {`Move to ${other.label}`}
              </Button>
            ))}
            {/*
              Unseating is NOT removal: the member is still coming, they
              just have no chair yet. Two separate controls because the
              two acts are not the same and one of them is not undoable.
            */}
            <Button
              variant="secondary"
              big={false}
              disabled={busy}
              onPress={() => onPlace(person.booking_id, null)}
              accessibilityLabel={`Unseat ${person.display_name}`}
            >
              Unseat
            </Button>
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onRemove(person.booking_id)}
              accessibilityLabel={`Remove ${person.display_name} from this game`}
            >
              Remove
            </Button>
          </View>
        </View>
      ))}

      {unseated.map((person) => (
        <View key={person.booking_id} style={styles.person}>
          <Text style={styles.name}>{person.display_name}</Text>
          <Button
            variant="secondary"
            big={false}
            disabled={busy}
            onPress={() => onPlace(person.booking_id, table.id)}
            accessibilityLabel={`Seat ${person.display_name} at ${table.label}`}
          >
            {`Seat at ${table.label}`}
          </Button>
        </View>
      ))}

      {/*
        call_for_a_fourth REFUSES a table that needs more than one player,
        so an unconditional button would exist only to produce an error.
      */}
      {canCallForAFourth ? (
        <Button
          variant="secondary"
          big={false}
          disabled={busy}
          onPress={() => onCallForAFourth(table.id)}
          accessibilityLabel={`Call for a fourth at ${table.label}`}
        >
          Call for a 4th now
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[3], gap: space[3] },
  person: { gap: space[2] },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
```

- [ ] **Step 3b: Wire it in**

In the event screen, pass it as `TableCard`'s `children` when `isOrganizer`, computing:

```tsx
canCallForAFourth={
  seatedAt(table.id).length === table.capacity - 1 &&
  event.status === 'published' &&
  new Date(event.starts_at) > new Date()
}
```

- [ ] **Step 4: Run everything**

```bash
npm test
npx tsc --noEmit
```

Expected: PASS, 5 new tests, nothing else moved.

- [ ] **Step 5: Commit**

```bash
git add components/HostSeating.tsx components/__tests__/HostSeating.test.tsx \
        "app/clubs/[id]/events/[eventId]/index.tsx"
git commit -m "feat: let the host seat, move, and remove people

Seat an \"any table\" booking, move somebody between tables, remove a
booking, and call for a fourth before the 48-hour window opens. Nothing
here reseats anybody automatically: the roadmap parks that under \"hosts
have opinions about who sits where\", and every rearrangement in this plan
is somebody's deliberate act.

\"Call for a 4th now\" is shown only when the table is exactly one short,
because call_for_a_fourth refuses anything else — an unconditional button
would exist to produce an error."
```

---

### Task 13: "Your games", and the two layout bugs on that screen

**Files:**
- Modify: `app/clubs/index.tsx`
- Create: `app/__tests__/your-games.test.tsx`
- Modify: `todo.md`

**Interfaces:**
- Consumes: Task 8's `fetchMyUpcomingBookings`, `declineBooking`, `cancelBooking`, `acceptPromotionOffer`, `declinePromotionOffer`, `offerCountdown`; plan 3's `formatEventWhen` from `lib/events.ts`.
- Produces: nothing other tasks consume.

**Why here and not a new route.** `/clubs` is the only screen every signed-in member lands on — `app/index.tsx` redirects there. A seat a friend booked for you has to be findable without a push notification until plan 6 exists, and one level deep behind a tap is one level too many for the only thing on the screen that needs an answer.

**Each row carries its own action.** A seat somebody else booked shows "Jane booked this for you" and a **Decline**. A live offer shows its held seats and countdown with **Take the seats** and **No thanks**. A waitlisted row shows the position. An ordinary confirmed seat shows when, where, and which table, and nothing to press.

**This screen also carries the two bugs `todo.md` records**, and this is the task that fixes them, because it is rewriting this file anyway:

1. **No page padding** — "Your clubs" sits at x=0 and the cards run to the viewport edge at 375px. Every other screen gets its side margins from `Screen`'s default content padding; this one opts out somewhere. Find where and stop.
2. **No gap between the last club card and "Start another club"** — the cards and the button are adjacent siblings with no spacing, and the empty state has the same shape. Fix it in the layout with a `gap` on the list container using `space[…]`, not with a one-off margin on the button.

Both baselines get regenerated in Task 15. Tick both boxes in `todo.md` in this commit.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/your-games.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMyUpcomingBookings = vi.fn();
const declineBooking = vi.fn();
const acceptPromotionOffer = vi.fn();

vi.mock('../../lib/bookings', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookings')>(
    '../../lib/bookings',
  );
  return {
    ...actual,
    fetchMyUpcomingBookings: () => fetchMyUpcomingBookings(),
    declineBooking: (...a: unknown[]) => declineBooking(...a),
    acceptPromotionOffer: (...a: unknown[]) => acceptPromotionOffer(...a),
  };
});

// … the clubs/session/router mocks copied from app/__tests__/clubs.test.tsx …

import ClubsScreen from '../clubs/index';

const base = {
  booking_id: 'b1',
  group_id: 'g1',
  event_id: 'e1',
  club_id: 'c1',
  club_name: 'Riverside',
  event_title: 'Tuesday game',
  starts_at: '2026-08-25T22:30:00Z',
  club_timezone: 'America/New_York',
  venue_name: "St Mary's Hall",
  event_table_id: 't1',
  table_label: 'Table 2',
  status: 'confirmed' as const,
  booked_by: 'me',
  booked_by_name: 'You',
  offer_id: null,
  offer_seats: null,
  offer_expires_at: null,
};

beforeEach(() => {
  fetchMyUpcomingBookings.mockReset();
  declineBooking.mockReset();
  acceptPromotionOffer.mockReset();
  fetchMyUpcomingBookings.mockResolvedValue([]);
});

describe('Your games', () => {
  it('is absent when the member holds no seats', async () => {
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalled());
    expect(screen.queryByText('Your games')).toBeNull();
  });

  it('lists a seat with when, where and which table', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([base]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
    expect(screen.getByText('Table 2')).toBeTruthy();
    expect(screen.getByText("St Mary's Hall")).toBeTruthy();
  });

  it('says who booked a seat for you, and offers a way out', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...base, booked_by: 'p2', booked_by_name: 'Jane P.' },
    ]);
    declineBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    expect(await screen.findByText('Jane P. booked this for you')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Decline the seat Jane P. booked'));
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b1'));
  });

  it('offers no decline on a seat you booked yourself', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([base]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByText(/booked this for you/)).toBeNull();
  });

  it('shows a live offer with its countdown', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...base,
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-24T16:15:00Z',
      },
    ]);
    acceptPromotionOffer.mockResolvedValue({ error: null });
    vi.setSystemTime(new Date('2026-08-24T15:45:00Z'));
    render(<ClubsScreen />);
    expect(await screen.findByText('30 minutes left')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Take the 2 seats'));
    await waitFor(() => expect(acceptPromotionOffer).toHaveBeenCalledWith('o1'));
  });

  it('says where a waitlisted member stands', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...base, status: 'waitlisted' as const, event_table_id: null,
        table_label: null },
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Waiting for a seat')).toBeTruthy();
  });

  it('does not hide the club list when the bookings fetch fails', async () => {
    fetchMyUpcomingBookings.mockResolvedValue(null);
    render(<ClubsScreen />);
    // The clubs are the point of this screen. A failed secondary fetch
    // says so quietly and gets out of the way.
    expect(await screen.findByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('Could not load your games.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- app/__tests__/your-games.test.tsx
```

Expected: FAIL — no "Your games" section exists.

- [ ] **Step 3: Build the section, and fix the two layout bugs**

In `app/clubs/index.tsx`:

1. Fetch bookings alongside the clubs, with its own failure flag. A failed bookings fetch must not empty the club list — the clubs are what this screen is for.
2. Render **Your games** above the club list when there is at least one row, each row a `Card` with title, `formatEventWhen(starts_at, club_timezone)`, venue, club name, and either the table label, "Waiting for a seat", or "Not seated yet".
3. Row actions as described above. Every one needs an `accessibilityLabel` naming the person or the seat — `Decline the seat Jane P. booked`, `Take the 2 seats`.
4. **Page padding:** remove whatever opts this screen out of `Screen`'s content padding.
5. **List spacing:** put a `gap: space[3]` on the container holding the club cards and the "Start another club" button, and delete any one-off margin that was compensating.

- [ ] **Step 4: Run the tests**

```bash
npm test -- app/__tests__/your-games.test.tsx app/__tests__/clubs.test.tsx
npx tsc --noEmit
```

Expected: PASS. The existing clubs tests must still pass unchanged — if one breaks on the padding fix, that test was asserting the bug.

- [ ] **Step 5: Tick the boxes in `todo.md`**

Mark "**`app/clubs/index.tsx` has no page padding**" and the "My Clubs — no space…" item done, and note the commit.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/your-games.test.tsx todo.md
git commit -m "feat: show a member their own games on the clubs screen

/clubs is the only screen every signed-in member lands on, so it is where
a seat a friend booked for you has to be findable — with no push
notification until plan 6, one level deeper is one level too many.

Each row carries its own action: decline a seat somebody booked for you,
take or refuse a live offer with its countdown, or see where you stand on
a waitlist. A failed bookings fetch says so quietly and leaves the club
list alone, because the clubs are what this screen is for.

Fixes the two layout bugs todo.md logs against this file — the missing
page padding and the missing gap before \"Start another club\" — in the
layout rather than with one-off margins, since this commit is rewriting
the file anyway."
```

---

### Task 14: Where you stand, from the club's event list

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Modify: `lib/events.ts`
- Modify: `app/__tests__/clubs.test.tsx` (or wherever the club-detail tests live)

**Interfaces:**
- Consumes: Task 8's types; plan 3's `fetchUpcomingEvents`.
- Produces: a `seats_free`, `my_status` and `needs_a_fourth` triple on each upcoming-event row.

**This is where a call for a fourth reaches somebody not in the game.** "Your games" is about games you are in. A table calling for a player is aimed at everybody who is *not*, so it belongs on the club's list of upcoming games, one line per card:

| State | Line |
|---|---|
| You hold a placed seat | `You're in · Table 2` |
| You hold an "any table" seat | `You're in` |
| You are waiting | `Waiting` |
| A table is one short and close | `Needs a 4th` |
| Otherwise | `3 seats free` / `Full` |

**Precedence matters and is not alphabetical.** Your own state wins over the club's — a member already in the game does not need to be told it needs a fourth. So: your seat, then your waitlist place, then the call, then the count.

**Extend the existing query rather than adding a second round trip.** `fetchUpcomingEvents` already selects `event_tables(id)` to count tables. It needs the capacity and the confirmed bookings too:

```ts
export const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, venues(name), ' +
  'event_tables(id, capacity), bookings(profile_id, status, event_table_id)';
```

`bookings` is readable by any club member (Task 1's policy), so this is one PostgREST embed and no new function. Filter to live bookings in the mapper, not in the select — an embedded filter on a nested resource is easy to get subtly wrong and this count is what every line above depends on.

- [ ] **Step 1: Write the failing test**

Add to the club-detail test file:

```tsx
it('says nothing about a fourth to somebody already playing', () => {
  // Three of four seats taken AND one of them is yours: your own state
  // wins. A member in the game does not need recruiting to it.
  expect(eventStatusLine(eventOneShort, 'me')).toBe("You're in · Table 1");
});

it('calls for a fourth when you are not in the game', () => {
  expect(eventStatusLine(eventOneShort, 'stranger')).toBe('Needs a 4th');
});

it('says you are waiting, without a position this row cannot know', () => {
  // The embed carries bookings, not groups, so there is no waitlist
  // position here. The event screen has event_seating and shows it there.
  expect(eventStatusLine(eventFullWithMeWaiting, 'me')).toBe('Waiting');
});

it('counts free seats when nothing else applies', () => {
  expect(eventStatusLine(eventHalfEmpty, 'stranger')).toBe('3 seats free');
});

it('says Full rather than "0 seats free"', () => {
  expect(eventStatusLine(eventFull, 'stranger')).toBe('Full');
});

it('says "You''re in" without a table for an any-table seat', () => {
  expect(eventStatusLine(eventWithMyUnseatedBooking, 'me')).toBe("You're in");
});
```

`eventStatusLine` is a **pure function** exported from `lib/events.ts` and tested without rendering, for the same reason `resolveIndexRedirect` is: the branching is the whole of the behaviour and a rendering test would hide which branch it took.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: FAIL — `eventStatusLine` is not exported.

- [ ] **Step 3: Implement and render it**

Add to `lib/events.ts`:

```ts
export type EventBookingRow = {
  profile_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
  event_table_id: string | null;
};

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * One line per game on the club's list.
 *
 * Precedence is deliberate and is not alphabetical: YOUR state wins over
 * the club's, because a member already in the game does not need
 * recruiting to it. Pure and exported so the branching is testable without
 * rendering — the same reason resolveIndexRedirect is (app/index.tsx).
 */
export function eventStatusLine(
  event: {
    starts_at: string;
    event_tables: { id: string; capacity: number }[];
    bookings: EventBookingRow[];
    tables_labels?: Record<string, string>;
  },
  youId: string,
  now: Date = new Date(),
): string {
  const live = event.bookings.filter(
    (b) => b.status === 'confirmed' || b.status === 'waitlisted',
  );
  const mine = live.find((b) => b.profile_id === youId);

  if (mine?.status === 'confirmed') {
    const label = mine.event_table_id
      ? event.tables_labels?.[mine.event_table_id]
      : null;
    return label ? `You're in · ${label}` : "You're in";
  }
  if (mine?.status === 'waitlisted') return 'Waiting';

  const confirmed = live.filter((b) => b.status === 'confirmed');
  const capacity = event.event_tables.reduce((sum, t) => sum + t.capacity, 0);
  const until = new Date(event.starts_at).getTime() - now.getTime();

  const oneShort = event.event_tables.some(
    (t) =>
      t.capacity >= 2 &&
      confirmed.filter((b) => b.event_table_id === t.id).length ===
        t.capacity - 1,
  );
  if (oneShort && until > 0 && until <= FORTY_EIGHT_HOURS_MS) {
    return 'Needs a 4th';
  }

  const free = Math.max(0, capacity - confirmed.length);
  // "0 seats free" is a sentence nobody writes. Plan 3's visual review
  // caught a card reading "0 tables" for the same reason.
  if (free === 0) return 'Full';
  return `${free} ${free === 1 ? 'seat' : 'seats'} free`;
}
```

A waitlisted member's *position* is not in this row's data — `bookings` carries no group. Render `Waiting` here and the position on the event screen, which has `event_seating`. If the position is wanted on the card, it is a column on the embed, not a second round trip; the test above expecting `Waiting · 2nd` should then be written against a row that carries it.

Then render its result as one line on each event card in `app/clubs/[id]/index.tsx`.

- [ ] **Step 4: Run everything**

```bash
npm test
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/index.tsx" lib/events.ts app/__tests__/clubs.test.tsx
git commit -m "feat: say where you stand on each game in the club's list

One line per card: your seat, your waitlist place, a call for a fourth, or
the free-seat count — in that precedence, because your own state wins over
the club's and a member already in the game does not need recruiting to it.

This is where a call for a fourth reaches somebody NOT in the game; \"Your
games\" is deliberately only about games you are in.

eventStatusLine is a pure exported function tested without rendering, for
the same reason resolveIndexRedirect is: the branching IS the behaviour,
and a render test hides which branch ran."
```

---

### Task 15: The contract, the pictures, and the docs

**Files:**
- Modify: `lib/schema-contract.test.ts`
- Modify: `e2e/session.ts`
- Modify: `e2e/visual.spec.ts`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the last three layers of coverage. Nothing consumes this.

**The contract test is the only suite that crosses the client/DB boundary.** It caught plan 1's `"21:00:00"` versus `"21:00"` bug, which both other suites were green through. `commit_booking` returns a **jsonb object** and `event_seating` returns a **set of rows with enum-typed columns** — exactly the shape where PostgREST's serialization and the TypeScript types drift silently.

**Five new visual states, at both widths — ten baselines**, taking the suite from 22 to 32.

- [ ] **Step 1: Extend the contract test**

Add a describe block to `lib/schema-contract.test.ts` that, against the local stack, seeds a club with a two-table game, signs a member in, and asserts:

```ts
it('returns the booking outcome in the shape BookingOutcome claims', async () => {
  const { data } = await client.rpc('commit_booking', {
    target_event: eventId,
    players: [memberId],
    preferred: tableId,
    allow_split: true,
  });
  // The whole point of this suite: the JSON PostgREST actually produces,
  // not the plpgsql that produced it.
  expect(Object.keys(data).sort()).toEqual([
    'group_id', 'offer', 'outcome', 'placements', 'split', 'waitlist_position',
  ]);
  expect(data.outcome).toBe('seated');
  expect(Array.isArray(data.placements)).toBe(true);
  expect(data.placements[0]).toMatchObject({
    profile_id: memberId,
    event_table_id: tableId,
  });
});

it('returns event_seating rows with the column names SeatOccupant claims', async () => {
  const { data } = await client.rpc('event_seating', { target_event: eventId });
  expect(Object.keys(data[0]).sort()).toEqual([
    'booked_by', 'booked_by_name', 'booking_id', 'created_at', 'display_name',
    'event_table_id', 'group_id', 'group_status', 'profile_id', 'skill_level',
    'status', 'waitlist_position',
  ]);
  // Enums arrive as strings. A typo in the TS union would type-check fine
  // and compare false at runtime forever.
  expect(['confirmed', 'waitlisted']).toContain(data[0].status);
});

it('returns a waitlist_position that is a number, not a string', async () => {
  // Postgres bigint arrives as a string through PostgREST. This one is
  // cast to int in SQL precisely so it does not, and this assertion is
  // what stops that cast being removed as redundant.
  const full = await seedFullGame();
  const { data } = await client.rpc('commit_booking', {
    target_event: full.eventId,
    players: [memberId],
    preferred: null,
    allow_split: true,
  });
  expect(typeof data.waitlist_position).toBe('number');
});
```

- [ ] **Step 2: Seed the visual fixtures**

Extend `seedClubWithEvent` in `e2e/session.ts` with a `seedBookings` step producing, on the seeded event, exactly the four states the baselines need:

1. **A mixed table** with two of four seats taken, one of them the signed-in member's.
2. **A second table, full.**
3. **A third table one short**, with nobody from the member's own bookings in it, and the event's `starts_at` inside 48 hours — so the call for a fourth renders.
4. **A waitlisted group** for the signed-in member on a separate, completely full game, with **an outstanding promotion offer** whose `expires_at` is a fixed offset from the seeded `starts_at`.

**Every timestamp must be relative to a seeded, fixed `starts_at`, never to `Date.now()`.** Plan 3's Task 17 shipped a baseline that had baked in that day's date and would have failed the next morning; the offer countdown is the same trap with a shorter fuse, because it changes every minute. Seed `expires_at` and pin the clock in the page with the mechanism `e2e/visual.spec.ts` already uses for the timezone and locale.

- [ ] **Step 3: Add the baselines**

Add five tests to `e2e/visual.spec.ts`, inside the seeded-club describe, each at both viewports:

| Name | What it must show |
|---|---|
| `event booking` | Seat grid with named occupants, your own seat marked, empty seats, "Bring someone" |
| `event full` | Every table full, the waitlist panel, "Join the waitlist" |
| `event offer` | The held-seats card with a **fixed** countdown |
| `event needs a fourth` | A table one short, its call, and the host's early-call button |
| `your games` | The clubs screen with two rows: one you booked, one a friend booked |

Each test **anchors on text before capturing**, per the constraint that pixels cannot catch a one-glyph regression:

```ts
await expect(page.getByText('Needs a 4th')).toBeVisible();
await expect(page.getByText('3 seats free')).toBeVisible();
await captureScreen(page, vp, 'event-needs-a-fourth');
```

- [ ] **Step 4: Generate the baselines the way that actually writes them**

```bash
npm run test:visual -- --update-snapshots=all
```

`--update-snapshots` alone **compares first and writes only on failure**, so a change under the 120-pixel `maxDiffPixels` leaves the old PNG in place and reports green. Use `=all`, or delete the PNGs first.

- [ ] **Step 5: Look at the ten images**

Not "the suite is green" — open them. Plan 3's green run hid a card reading "0 tables", two `--` where the app uses an em dash, and a baked-in date. Check specifically:

- Does any seat look numbered? It must not.
- Is the countdown a fixed value, or today's clock?
- Does "1 seat free" ever read "1 seats free"?
- Does an empty seat read as tappable at 375px, at 18pt?
- Does the clubs screen now have its side padding, and a gap before "Start another club"?

```bash
npm run test:visual
```

Expected: 32 passing, no diffs.

- [ ] **Step 6: Update `docs/testing.md`**

Record: the new concurrency suite and what it proves (with the mutation that makes it red); the seeded booking fixtures and the rule that every timestamp is relative to a seeded `starts_at`; and one line stating that `needsAFourth` in `lib/bookings.ts` and `need_a_fourth_stage` in SQL implement the same rule twice and must be changed together.

- [ ] **Step 7: Commit**

```bash
git add lib/schema-contract.test.ts e2e/session.ts e2e/visual.spec.ts \
        "e2e/visual.spec.ts-snapshots" docs/testing.md
git commit -m "test: cover the booking JSON, and look at the pictures

The contract test is the only suite that crosses the client/DB boundary,
and commit_booking returns jsonb while event_seating returns enum-typed
rows — exactly where serialization drifts from the TypeScript silently.
It asserts the key set, the enum values, and that waitlist_position is a
number rather than the string a bigint would have arrived as.

Ten new baselines across five states: a seat grid, a full game, a held
offer, a table calling for a fourth, and Your games. Every seeded
timestamp is relative to a fixed starts_at — plan 3 shipped a baseline
that had baked in that day's date and would have failed by morning, and a
countdown is the same trap with a shorter fuse."
```

---

## Error handling

The complete refusal vocabulary. The left column is what the database raises; the right is what the member reads, mapped by `BOOKING_REFUSALS` in `lib/bookings.ts`. Nothing in this table may ever surface as `GENERIC_ERROR` — that string means the server could not be reached, and plan 3 shipped a build that used it for validation refusals.

| Raised | SQLSTATE | `detail` | The member reads |
|---|---|---|---|
| `event not bookable` | 23514 | — | "This game was cancelled." |
| `event already started` | 23514 | — | "This game has already started." |
| `already booked` | 23514 | profile id | "Someone in your group already has a seat at this game." |
| `not a member` | 23514 | profile id | "Someone in your group is no longer in this club." |
| `duplicate player` | 23514 | — | Unreachable from the UI — the picker cannot select twice. Falls back to the generic message deliberately. |
| `table full` | 23514 | — | "Someone just took the last seat at that table." |
| `no such table` | 23514 | — | "That table is no longer part of this game." — a host removed it while the member had the screen open |
| `no such event` | 42501 | — | "This game is no longer listed." Raised by `assert_event_bookable` for an event id that resolves to nothing. Unmapped, it would surface as `GENERIC_ERROR` — which claims the server was unreachable — and the constraint above forbids exactly that |
| `offer expired` | 23514 | — | "That offer has expired — you're still on the waitlist." |
| `booking already closed` | 23514 | — | "That seat has already been given up." |
| `table does not need a fourth` | 23514 | — | "That table needs more than one more player." |
| `not your booking` | 42501 | — | "That is not your seat to change." |
| `not your offer` | 42501 | — | "Only the person who booked can answer that offer." |
| `nothing to decline` | 42501 | — | Unreachable — the decline control is only rendered on a seat somebody else booked. |
| `not a member of this club` | 42501 | — | Unreachable — a non-member cannot open the screen. |

**A full game is not an error.** `commit_booking` returns `outcome: 'waitlisted'` and the screen says where the member stands. Refusing would make the waitlist a thing members have to ask for twice.

---

## Verification before the PR

Run all of it, in this order, and paste the counts into the PR body.

```bash
npx supabase db reset
npm run test:db                 # every fixture, local
npm run test:db:remote          # portable/, against hosted
npm run test:contract           # the client/DB boundary
npm run test:concurrency        # two clients, one seat
npm test                        # Vitest
npm run test:visual             # 32 baselines
npx tsc --noEmit
npx supabase db push            # hosted must be 0 migrations behind
```

Expected floors, given the plan's own additions on top of the branch point:

| Suite | Before | After |
|---|---|---|
| Vitest | 322 | 322 + this plan's (≥ 370) |
| Schema contract | 46 | 49 |
| pgTAP local | 440 | 440 + 95 |
| pgTAP hosted | 58 | 64 |
| Visual | 22 | 32 |

Then, by hand, because no suite covers them:

1. **Two accounts, one game.** Book the last seat from one while the other has the screen open; confirm the second sees the game full rather than an error, and that joining the waitlist then works.
2. **A friend-booked seat.** Book a seat for the second account; confirm it appears under "Your games" with the decline, and that declining frees the seat and promotes anybody waiting.
3. **An offer end to end.** Waitlist a group of two against one free seat, accept the offer, confirm one is seated and one is still waiting at the same place in the queue.
4. **On a device.** Plan 3 shipped never having been run on one. The seat grid at 375px with 18pt text is the thing most likely to be wrong.

---

## What this plan knowingly leaves undone

Write these into the PR body as known limitations rather than discovering them in review.

- **No push or email.** Every notifiable moment is in `notification_outbox` and nothing drains it. Until plan 6, a promotion offer can expire unseen. This is the single strongest argument for plan 6 following immediately.
- **No check-in.** A booking is an intention. Nothing records who actually turned up, which is why cancellation is refused once a game starts rather than allowed and marked late.
- **Capacity is still not editable.** Plan 3 left `table_count` and `duration` without edit controls and this plan does not add them. A host who wants a five-seat table cannot have one; the column and its 1–8 check are there for when that changes.
- **A host cannot overbook.** "Any table" bookings claim event capacity, so a host who knows two regulars always drop out cannot pre-empt it. The fix, if it is wanted, is an explicit per-event overbooking allowance — not a quiet exception to the capacity rule.
- **Nothing un-cancels.** A cancelled booking, a cancelled group, and a cancelled game are all terminal, matching plan 3.
- **A held offer keeps a seat empty for up to two hours** while a club may be a player short. That is the parent spec's deliberate trade and the expiry is the cap on it.
- **Group placement order is booker-first, then join order.** Nobody has asked for the booker to choose who gets the partial seats.
- **`venues.added_by_club_id` is still `ON DELETE NO ACTION`**, so no club that ever scheduled a game can be deleted. Inherited from plan 3, unchanged here, and still needs its own decision.
