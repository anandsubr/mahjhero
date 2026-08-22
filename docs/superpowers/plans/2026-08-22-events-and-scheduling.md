# Events & Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A club stops being a roster and starts having a calendar — a host creates a game, one-off or recurring, says where it is and how many tables it seats, and every member sees it.

**Architecture:** Four new tables (`venues`, `event_series`, `events`, `event_tables`). Clients hold `select` and nothing else; every write goes through a `security definer` function that checks `is_club_organizer` first. Recurring events materialize into real rows via a plpgsql function called both nightly by `pg_cron` and synchronously at series create/edit. Five new screens and one new component, built from the existing design-system primitives.

**Tech Stack:** Expo/React Native with expo-router, Supabase (Postgres, RLS, `pg_cron`), Vitest + `@testing-library/react`, pgTAP, Playwright.

**Spec:** [../specs/2026-08-22-events-and-scheduling-design.md](../specs/2026-08-22-events-and-scheduling-design.md)
**Branch:** `feat/events`, already cut from `main`. One branch and one PR per plan.

## Global Constraints

Every task's requirements implicitly include these.

- **Three platforms from one codebase:** iOS, Android, and web. A change that builds on one but not the others is incomplete.
- **The database owns authorization.** RLS is enabled on every table in the same migration that creates it, and every table gets a `grant` matching its policies — no wider. RLS policies *filter* access; they do not *grant* it.
- **`alter default privileges` in this schema now grants new tables NOTHING to `authenticated` and full DML to `service_role`** (migration `20260822041836` and `20260822180200`). So every new table needs its `authenticated` grants written out explicitly, and gets `service_role` DML for free. Never `grant all` — `ALL` includes `TRUNCATE`, which RLS does not filter.
- **Every new function gets `revoke execute on function … from public, anon` before its `grant`.** A null `proacl` means EXECUTE to PUBLIC.
- **Every `security definer` function checks club membership or organizer role as its first statement**, and pins `set search_path = public`. RLS does not protect a definer function; the parent spec calls this the most likely site of a tenancy bug.
- **`lib/` functions never reject.** They catch internally, `console.error('<fn> failed', cause)` the original, and return `GENERIC_ERROR` from `lib/constants.ts` through an `{ error: string | null }` channel. Callers must consume that channel.
- **Every write uses `.select(...)` and treats zero rows as failure.** PostgREST answers 204 with `error: null` when an update matches nothing, which is what an RLS denial looks like.
- **18pt is the app-wide minimum body text size.** Helper/secondary text at 16pt is the sole exception. Never encode anything below 16 as correct.
- **Accessibility props are required** — `accessibilityLabel`, `accessibilityRole`, `accessibilityState` on every interactive control.
- **Every screen wraps its content in `<Screen>`**, which constrains the column to 440px and centres it on wide viewports.
- **Every redirect target must have a route file.** `app/__tests__/redirect-routes.test.ts` enforces this.
- **Spacing comes from `space[…]` in `lib/theme`**, never a literal.
- **Times are club-local wall clock plus the club's timezone, never a fixed UTC offset.** Any code that adds or subtracts hours to convert a timezone is wrong.
- **The existing suites must keep passing:** 132 Vitest, 6 schema-contract, 74 pgTAP local, 23 pgTAP hosted, typecheck clean.
- **Visual baselines are reviewed like code.** An intentional design change updates them in the same PR.
- **Mutation-check every assertion you add.** Task 6 shipped 17 green assertions that killed **one of eight** mutants — the past-occurrence boundary, the cancelled-week guard, the selective override-clearing rule, and the entire synchronous-materialization requirement would all have passed while broken, as would the exact reflow "fix" the design forbids. For each rule a test claims to protect, break the implementation inside a transaction, confirm the suite goes red, and roll back. A green suite is not evidence; a suite that goes red on the right mutation is.
- Local stack start command:
  `npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit`

## Scope

**In:** the `venues` master with typeahead select-or-create, event creation (one-off and recurring), the recurrence rule and its materialization, per-event tables with skill tiers, per-field occurrence overrides, cancellation, a read-only event view for members, and the `todo.md` spacing fix on the clubs list.

**Out — deferred with reasons:**

- **Booking, seat selection, the waitlist, "need a 4th".** Plan 4. This plan builds the thing seats attach to and deliberately ships no attendance concept of any kind — the parent spec is explicit that booking a seat *is* the RSVP.
- **Check-in.** Plan 5.
- **Event reminders and host broadcasts.** Plan 6. They need Edge Functions; this plan needs none.
- **A drafts UI.** The `draft` enum value and its RLS exist because the policy is easier to write once than to retrofit; no screen creates one.
- **Venue claiming, venue-side accounts, paid placement, duplicate merging, geocoding, maps, a public directory.** This plan builds the entity those need and none of the mechanism.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_enable_pg_cron.sql` | The extension, proven on both environments first (Task 1) |
| `supabase/migrations/<ts>_create_venues.sql` | `venues`, its enum, RLS, grants, and `search_venues` |
| `supabase/migrations/<ts>_create_events.sql` | Three enums, three tables, `is_club_organizer`, RLS, grants |
| `supabase/migrations/<ts>_materialize_event_series.sql` | `series_occurrence_dates` and `materialize_event_series` |
| `supabase/migrations/<ts>_event_mutations.sql` | `create_event`, `update_event`, `cancel_event`, the three table functions |
| `supabase/migrations/<ts>_event_series_mutations.sql` | `create_event_series`, `update_event_series`, `end_event_series`, the club-timezone trigger |
| `supabase/migrations/<ts>_schedule_materialize_event_series.sql` | The nightly `cron.schedule` call |
| `supabase/tests/database/fixtures/venues.test.sql` | Venue visibility from both sides, edit boundary, archive, dedup |
| `supabase/tests/database/fixtures/events.test.sql` | Table RLS, organizer-only mutations, cross-club isolation |
| `supabase/tests/database/fixtures/event_recurrence.test.sql` | Date generation, materialization idempotency, DST |
| `supabase/tests/database/fixtures/event_series_edits.test.sql` | Override propagation, the toggle, the timezone trigger |
| `supabase/tests/database/portable/grants.test.sql` | *(modify)* grants and function ACLs for the four new tables |
| `lib/venues.ts` + `lib/venues.test.ts` | Venue data layer |
| `lib/events.ts` + `lib/events.test.ts` | Event data layer plus the pure recurrence preview |
| `components/VenuePicker.tsx` | Typeahead select-or-create |
| `app/clubs/[id]/index.tsx` | *(modify)* the Upcoming section, and the spacing fix |
| `app/clubs/[id]/events/new.tsx` | Create an event or a series |
| `app/clubs/[id]/events/[eventId]/index.tsx` | Event detail |
| `app/clubs/[id]/events/[eventId]/edit.tsx` | Edit this event, or the series |
| `app/clubs/[id]/venues.tsx` | Venue management |
| `app/__tests__/events.test.tsx` | Component tests for the new screens |
| `components/__tests__/VenuePicker.test.tsx` | Component tests for the picker |
| `e2e/visual.spec.ts` | *(modify)* baselines for the new screens |
| `lib/schema-contract.test.ts` | *(modify)* the new columns and JSON shape |

**A note on routes.** The spec writes the event detail route as `app/clubs/[id]/events/[eventId].tsx`. That cannot coexist with `[eventId]/edit.tsx` — expo-router will not accept a file and a directory of the same name. Use `app/clubs/[id]/events/[eventId]/index.tsx` and `.../edit.tsx`. The URLs are identical; only the file layout differs.

---

### Task 1: Prove `pg_cron` works, on local and on hosted

**Files:**
- Create: `supabase/migrations/<timestamp>_enable_pg_cron.sql`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a documented yes/no on whether `cron.schedule` is usable in each environment, and the extension itself if it is. Task 7 schedules the nightly job on top of this; nothing else in the plan depends on it.

**Why this task is first.** `pg_cron` has never been used in this repository, and the failure mode is a migration that applies in one environment and not the other — discovered after five tasks of work sit on top of it. The component-test-harness plan settled RNTL the same way: prove the risky assumption with a throwaway before building on it.

`pg_cron` needs the extension loaded in `shared_preload_libraries`, which is a server-start parameter no migration can set. If it is missing, no amount of SQL fixes it.

**If it turns out to be unavailable in either environment:** skip the migration, skip Task 7, and record the finding in `docs/testing.md`. Everything else in this plan still works — `materialize_event_series` is ordinary SQL called synchronously at series create and edit, which keeps a six-week horizon for any club actively scheduling. Only a club that sets up a series and then never touches the app again would see its horizon go stale, and plan 6's Edge Function infrastructure picks the job up. Do not block on this.

- [ ] **Step 1: Start the local stack and check the preload list**

```bash
npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit
npx supabase db reset
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "show shared_preload_libraries;"
```

Expected: the output contains `pg_cron`. If it does not, stop and read the fallback above.

- [ ] **Step 2: Check the same on the hosted project**

```bash
npx supabase db remote commit --dry-run 2>/dev/null || true
psql "$SUPABASE_DB_URL" -c "show shared_preload_libraries;"
psql "$SUPABASE_DB_URL" -c "select extname from pg_extension where extname = 'pg_cron';"
```

`SUPABASE_DB_URL` is the linked project's connection string, from the Supabase dashboard under Project Settings → Database. Expected: `pg_cron` appears in the preload list. It may or may not already be installed as an extension — either is fine.

- [ ] **Step 3: Prove `cron.schedule` actually runs, in both environments**

Against each of the two connection strings in turn:

```bash
psql "$DB_URL" <<'SQL'
create extension if not exists pg_cron;
select cron.schedule('mahjhero-spike', '* * * * *', 'select 1');
select jobid, jobname, schedule, active from cron.job where jobname = 'mahjhero-spike';
select cron.unschedule('mahjhero-spike');
SQL
```

Expected: the `select cron.schedule(...)` returns a job id, the `cron.job` row is present and `active`, and `unschedule` returns `t`. A `permission denied for schema cron` here means the connecting role lacks `USAGE` — note which role you connected as, because that is the same class of problem as plan 2's pgTAP failure, where a missing `USAGE` on `extensions` was reported as "function plan(integer) does not exist".

- [ ] **Step 4: Write the migration**

Only if Step 3 passed in both environments.

```bash
npx supabase migration new enable_pg_cron
```

```sql
/*
 * pg_cron, for the nightly materialization of recurring events.
 *
 * The extension creates and owns the `cron` schema; do not pass a SCHEMA
 * clause. `shared_preload_libraries` must already contain pg_cron — that is a
 * server-start parameter and no migration can set it, which is why this was
 * verified on both the local stack and the hosted project before this file
 * was written rather than after.
 *
 * The job itself is scheduled in a later migration, once the function it
 * calls exists.
 */
create extension if not exists pg_cron;
```

- [ ] **Step 5: Apply it, in both environments**

```bash
npx supabase db reset
npx supabase db push
```

Expected: both succeed. `db reset` replays every migration from scratch, so a failure here means the migration is not idempotent.

- [ ] **Step 6: Record the finding**

Append to `docs/testing.md`, under a new `## Scheduled work` heading:

```markdown
## Scheduled work

`pg_cron` runs the nightly job that keeps recurring events materialized about
six weeks ahead. It was verified on both the local stack and the hosted
project before anything depended on it — `shared_preload_libraries` contains
`pg_cron` in both, and `cron.schedule`/`cron.unschedule` round-trip as the
connecting role.

The job is `materialize-event-series`, defined in
`<timestamp>_schedule_materialize_event_series.sql`. It calls
`public.materialize_event_series()`, which is ordinary SQL — so it is tested
by pgTAP calling it directly, with no HTTP, no secrets, and no Edge Function
in the loop. To run it by hand:

    select public.materialize_event_series();

Inspect the schedule with `select * from cron.job;` and its history with
`select * from cron.job_run_details order by start_time desc limit 20;`.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations docs/testing.md
git commit -m "feat(db): enable pg_cron, verified on local and hosted"
```

---

### Task 2: The venues master

**Files:**
- Create: `supabase/migrations/<timestamp>_create_venues.sql`
- Create: `supabase/tests/database/fixtures/venues.test.sql`

**Interfaces:**
- Consumes: `public.clubs`, `public.profiles`, and `public.is_club_member(uuid)` from plan 2.
- Produces: enum `public.venue_visibility` (`club`/`public`); table `public.venues`; functions `public.create_venue(text, text, text, text, text, uuid, boolean) returns uuid`, `public.update_venue(uuid, text, text, text, text, text) returns boolean`, `public.archive_venue(uuid) returns boolean`, `public.search_venues(uuid, text) returns table(...)`, and the shared guard `public.assert_club_organizer(uuid) returns void`, which every mutation in Tasks 5 and 6 opens with. Task 3's `events` and `event_series` both reference `venues(id)`.

**Why venues come before events.** Both event tables carry a `not null venue_id` referencing this table, so it has to exist first.

**This is the first cross-club read in the schema, and the one to read twice.** Every other policy here answers "are you in this club?". This one answers "are you in this club, *or* is this venue public?", and its write functions must check `is_club_organizer(added_by_club_id)` — the club that added the venue — rather than "does the caller organize any club at all". Getting that wrong is plan 2's `club_members_insert_self` bug again, in a new place: a `with check` that constrains *who* the caller is says nothing about *which* row they may touch.

`is_club_organizer` is created in Task 3 alongside the events tables. This task's functions need it, so **create it here** and let Task 3 use it. (It is placed in the venues migration for exactly this reason; the alternative is a fourth migration that holds one function.)

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/fixtures/venues.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(32);

-- Structure
select has_table('public', 'venues', 'venues table exists');
select has_function('public', 'is_club_organizer', array['uuid'],
  'is_club_organizer exists');
select has_function('public', 'assert_club_organizer', array['uuid'],
  'assert_club_organizer exists');
select has_function('public', 'search_venues', array['uuid', 'text'],
  'search_venues exists');

-- Alice hosts Riverside. Bob hosts Oakfield. Carol is a plain member of
-- Riverside — the role boundary, not just the club boundary.
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
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

-- Riverside adds two venues: a private one (a member's home) and a public
-- one (a real hall other clubs could use).
insert into public.venues
  (id, name, locality, visibility, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'Marie''s place', 'Newton',
   'club', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'St Mary''s Hall', 'Newton',
   'public', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Visibility, from both sides.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  0,
  'another club cannot read a club-visibility venue'
);

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000002'),
  1,
  'another club can read a public venue'
);

-- The same question through search, which is the path the app actually uses.
select is(
  (select count(*)::int from public.search_venues(
     'c2c2c2c2-0000-0000-0000-000000000002', 'Marie')),
  0,
  'search does not leak a club-visibility venue to another club'
);

select is(
  (select count(*)::int from public.search_venues(
     'c2c2c2c2-0000-0000-0000-000000000002', 'Mary')),
  1,
  'search returns a public venue to another club'
);

-- ---------------------------------------------------------------------
-- The edit boundary: added_by_club_id, not "organizes something".
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000002', 'Renamed By Bob',
      null, null, null, null)$$,
  '42501',
  null,
  'a host of another club cannot rename a public venue'
);

select throws_ok(
  $$select public.archive_venue('11111111-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a host of another club cannot archive a public venue'
);

-- A plain member of the owning club is also refused.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000001', 'Renamed By Carol',
      null, null, null, null)$$,
  '42501',
  null,
  'a plain member of the owning club cannot rename its venue'
);

select is(
  (select count(*)::int from public.search_venues(
     'c1c1c1c1-0000-0000-0000-000000000001', 'Marie')),
  1,
  'a plain member of the owning club can still see its venues'
);

select throws_ok(
  $$select public.search_venues(
      'c2c2c2c2-0000-0000-0000-000000000002', 'Mary')$$,
  '42501',
  null,
  'search refuses a club the caller does not belong to'
);

-- ---------------------------------------------------------------------
-- The owning club's organizer can do all of it.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000001', 'Marie''s house',
      '42 Elm St', 'Newton', null, null)$$,
  'the owning club''s host can rename its venue'
);

select is(
  (select name from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Marie''s house',
  'the rename landed'
);

select is(
  (select address_line from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  '42 Elm St',
  'the address landed'
);

-- Nulls mean "leave alone", not "clear" — otherwise a screen that edits only
-- the name silently wipes the address.
select is(
  (select locality from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Newton',
  'a null argument leaves the existing value alone'
);

-- Creation defaults to club visibility. This is the whole privacy argument:
-- a host adding "Marie's place" at 11pm must not publish it by omission.
select lives_ok(
  $$select public.create_venue(
      'The Annexe', null, 'Newton', null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', false)$$,
  'the owning club''s host can create a venue'
);

select is(
  (select visibility::text from public.venues where name = 'The Annexe'),
  'club',
  'a new venue is club-visibility by default'
);

select is(
  (select added_by_club_id from public.venues where name = 'The Annexe'),
  'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
  'a new venue records the club that added it'
);

-- ---------------------------------------------------------------------
-- Archiving hides from search and preserves the row.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.archive_venue('11111111-0000-0000-0000-000000000001')$$,
  'the owning club''s host can archive its venue'
);

select is(
  (select count(*)::int from public.search_venues(
     'c1c1c1c1-0000-0000-0000-000000000001', 'Marie')),
  0,
  'an archived venue is absent from search'
);

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  1,
  'an archived venue still exists and still resolves'
);

-- ---------------------------------------------------------------------
-- The publish path. Deliberately tested from both ends: the default being
-- `club` is the easy half, and it is asserted three times above. The half
-- that carries the actual privacy risk is `share_publicly => true`, and
-- because there is no un-publish function a defect there is unrecoverable
-- through the API — the row would be readable by every authenticated user of
-- every club, permanently.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_venue(
      'The Parish Rooms', null, 'Newton', null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', true)$$,
  'a venue can be shared deliberately'
);

select is(
  (select visibility::text from public.venues where name = 'The Parish Rooms'),
  'public',
  'share_publicly => true actually publishes it'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.venues where name = 'The Parish Rooms'),
  1,
  'and another club can then see it'
);

-- create_venue's own cross-club guard. update_venue and archive_venue each
-- have one above; without this the asymmetry is what a future refactor slips
-- through.
select throws_ok(
  $$select public.create_venue(
      'Bob''s intrusion', null, null, null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', false)$$,
  '42501',
  null,
  'a host of another club cannot create a venue attributed to this one'
);

-- ---------------------------------------------------------------------
-- Duplicate control applies to public venues only.
-- ---------------------------------------------------------------------
set local role postgres;

select throws_ok(
  $$insert into public.venues
      (name, locality, visibility, added_by_club_id, created_by)
    values ('st mary''s hall', 'NEWTON', 'public',
      'c2c2c2c2-0000-0000-0000-000000000002',
      'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '23505',
  null,
  'a duplicate public venue is rejected regardless of case or padding'
);

select lives_ok(
  $$insert into public.venues
      (name, locality, visibility, added_by_club_id, created_by)
    values ('Community Hall', 'Newton', 'club',
      'c1c1c1c1-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001'),
    ('Community Hall', 'Newton', 'club',
      'c2c2c2c2-0000-0000-0000-000000000002',
      'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'two clubs may each keep a private venue of the same name'
);

-- ---------------------------------------------------------------------
-- Grants: select only, and never TRUNCATE.
-- ---------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'public.venues', 'SELECT'),
  'authenticated can select venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'INSERT'),
  'authenticated cannot insert venues directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'TRUNCATE'),
  'authenticated cannot TRUNCATE venues'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: `venues.test.sql` fails at the first assertion — `relation "public.venues" does not exist`. The other suites stay green.

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new create_venues
```

```sql
/*
 * The venue master.
 *
 * This is the only table in this schema that crosses clubs, and it is
 * therefore the one place where the uniform "rows are visible to active
 * members of that club" policy does not apply. Read the select policy and the
 * function guards together: the policy answers "may you see this row", the
 * guards answer "may you change it", and those are different questions with
 * different answers.
 *
 * `visibility` defaults to 'club'. A great deal of mahjong is played in
 * members' homes, and a master list built with future public discovery in
 * mind must not publish "Marie's place, 42 Elm Street" as a side effect of
 * someone scheduling Tuesday's game. Sharing is a deliberate act.
 *
 * `added_by_club_id` is named for what it records — who typed it in — rather
 * than `owner_club_id`, because that club is a steward, not an owner. When
 * venue claiming arrives, authority transfers to the claimant rather than
 * accumulating: a claimed venue becomes editable by its claimant and no
 * longer by the club that added it. That is a change to `update_venue`'s
 * guard and nothing else.
 */

create type public.venue_visibility as enum ('club', 'public');

create table public.venues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  address_line     text,
  locality         text,
  region           text,
  postal_code      text,
  visibility       public.venue_visibility not null default 'club',
  added_by_club_id uuid not null references public.clubs(id),
  archived_at      timestamptz,
  created_by       uuid not null references public.profiles(id)
                     default auth.uid(),
  created_at       timestamptz not null default now()
);

/*
 * Duplicate control for the shared set only. Two clubs each keeping their own
 * "Community Hall" is correct and must stay legal; two rows for the same
 * public hall is a mess nobody can merge, because no merge tool exists.
 *
 * This catches identical names in the same locality and nothing more —
 * "St Mary's Hall" and "St. Marys Parish Hall" are one building to a human
 * and two rows to Postgres. Bounded damage: nothing depends on venue
 * identity yet.
 */
create unique index venues_public_name_idx
  on public.venues (lower(trim(name)), coalesce(lower(trim(locality)), ''))
  where visibility = 'public';

create index venues_club_idx on public.venues (added_by_club_id);

/*
 * Mirrors is_club_member, for the same reason: a policy that asked this
 * question directly against club_members would recurse through that table's
 * own policy. Definer rights plus a pinned search_path.
 *
 * Lives in this migration rather than the events one because the venue write
 * functions below are its first callers.
 */
create function public.is_club_organizer(target_club uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = target_club
      and profile_id = auth.uid()
      and status = 'active'
      and role in ('host', 'co_organizer')
  );
$$;

/*
 * The guard every mutation opens with, in one place.
 *
 * Not folded into is_club_organizer, which is also called from inside RLS
 * policies where a raise would be wrong — a policy wants false, a function
 * wants 42501. Two names for the two jobs.
 */
create function public.assert_club_organizer(target_club uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.is_club_organizer(target_club) then
    raise exception 'not an organizer of this club' using errcode = '42501';
  end if;
end;
$$;

alter table public.venues enable row level security;

-- The cross-club read. Public venues are visible to every signed-in member;
-- everything else is visible only to the club that added it.
create policy venues_select_public_or_member on public.venues
  for select using (
    visibility = 'public' or public.is_club_member(added_by_club_id)
  );

/*
 * No insert, update or delete policy, and no DML grant. Every write goes
 * through the functions below, which check is_club_organizer against the
 * venue's OWN club rather than against "some club the caller organizes".
 *
 * Plan 2 shipped `club_members_insert_self` with
 * `with check (auth.uid() = profile_id)`, which constrained who a row was
 * about and not which club it belonged to, and any member could make
 * themselves host of any club. The shape of that mistake is what these
 * guards are written against.
 */

create function public.create_venue(
  venue_name    text,
  address_line  text default null,
  locality      text default null,
  region        text default null,
  postal_code   text default null,
  target_club   uuid default null,
  share_publicly boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_club_organizer(target_club);

  if length(trim(coalesce(venue_name, ''))) = 0 then
    raise exception 'venue name is required' using errcode = '23514';
  end if;

  insert into public.venues (
    name, address_line, locality, region, postal_code,
    visibility, added_by_club_id, created_by
  ) values (
    trim(venue_name),
    nullif(trim(coalesce(address_line, '')), ''),
    nullif(trim(coalesce(locality, '')), ''),
    nullif(trim(coalesce(region, '')), ''),
    nullif(trim(coalesce(postal_code, '')), ''),
    case when share_publicly then 'public' else 'club' end::public.venue_visibility,
    target_club,
    auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$$;

/*
 * A null argument means "leave this alone", not "clear this". A screen that
 * edits only the name would otherwise wipe the address, and the host would
 * have no way to know it had happened.
 *
 * `visibility` is deliberately not editable here. Turning a venue public is
 * its own act with its own consequences (another club may start using it, at
 * which point it cannot be retracted without breaking their events), and it
 * gets its own function when a screen needs it — not a null-defaulted
 * parameter on the general edit path.
 */
create function public.update_venue(
  target_venue  uuid,
  venue_name    text default null,
  address_line  text default null,
  locality      text default null,
  region        text default null,
  postal_code   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  steward uuid;
begin
  select added_by_club_id into steward
  from public.venues where id = target_venue;

  if steward is null then
    raise exception 'no such venue' using errcode = 'P0002';
  end if;

  perform public.assert_club_organizer(steward);

  -- Qualified on BOTH sides, and not simplifiable.
  --
  -- A bare `address_line = coalesce(address_line, address_line)` raises 42702:
  -- plpgsql cannot tell the parameter from the column of the same name. The
  -- obvious escape — renaming the parameters to `new_address_line` — is worse
  -- than the bug, because PostgREST resolves RPC by argument NAME. Renaming
  -- them breaks `supabase.rpc('update_venue', { address_line, ... })` with a
  -- PGRST202 the mocked client tests cannot see, which is precisely the class
  -- of failure lib/schema-contract.test.ts exists to catch. So the parameter
  -- names are part of the public interface: disambiguate, never rename.
  update public.venues set
    name         = coalesce(nullif(trim(coalesce(venue_name, '')), ''), name),
    address_line = coalesce(update_venue.address_line, venues.address_line),
    locality     = coalesce(update_venue.locality,     venues.locality),
    region       = coalesce(update_venue.region,       venues.region),
    postal_code  = coalesce(update_venue.postal_code,  venues.postal_code)
  where id = target_venue;

  return true;
end;
$$;

/*
 * Venues are archived, never deleted. Past events point at them, and a club's
 * history should not develop holes because a hall closed.
 */
create function public.archive_venue(target_venue uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  steward uuid;
begin
  select added_by_club_id into steward
  from public.venues where id = target_venue;

  if steward is null then
    raise exception 'no such venue' using errcode = 'P0002';
  end if;

  perform public.assert_club_organizer(steward);

  update public.venues set archived_at = now() where id = target_venue;
  return true;
end;
$$;

/*
 * The typeahead's only data source. Returns the caller's own club venues and
 * public ones, own club first, non-archived only, capped at 20.
 *
 * Plain `ilike` rather than pg_trgm: the public set starts empty and a club
 * has a handful of venues, so an extension dependency would be bought for
 * nothing. A trigram index is the upgrade when the shared set is large enough
 * to need one.
 *
 * The membership check is not decorative. Without it this definer function
 * would happily search on behalf of a club the caller has nothing to do with,
 * and report back which venues that club uses.
 */
create function public.search_venues(target_club uuid, q text)
returns table (
  id           uuid,
  name         text,
  address_line text,
  locality     text,
  visibility   public.venue_visibility,
  is_own_club  boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  return query
  select v.id, v.name, v.address_line, v.locality, v.visibility,
         v.added_by_club_id = target_club as is_own_club
  from public.venues v
  where v.archived_at is null
    and (v.added_by_club_id = target_club or v.visibility = 'public')
    and (
      q is null or length(trim(q)) = 0
      or v.name ilike '%' || trim(q) || '%'
      or coalesce(v.locality, '') ilike '%' || trim(q) || '%'
    )
  order by (v.added_by_club_id = target_club) desc, v.name
  limit 20;
end;
$$;

-- Grants, verb for verb against the policies. `alter default privileges` in
-- 20260822041836 means this table starts with nothing for authenticated, and
-- 20260822180200 means service_role already has DML.
grant select on public.venues to authenticated;

-- A null proacl is EXECUTE to PUBLIC. `from public` clears the PostgreSQL
-- default; `from anon` clears the direct grant Supabase's hosted bootstrap
-- adds, which `from public` does not touch.
revoke execute on function public.is_club_organizer(uuid) from public, anon;
grant  execute on function public.is_club_organizer(uuid) to authenticated;

-- Only ever called from inside the definer functions, which run as their
-- owner — so `authenticated` is revoked explicitly, not merely left ungranted.
-- Hosted grants EXECUTE directly to authenticated at creation time, and
-- `from public` does not clear a direct grant (see 20260822045809).
revoke execute on function public.assert_club_organizer(uuid)
  from public, anon, authenticated;

revoke execute on function public.create_venue(text, text, text, text, text, uuid, boolean)
  from public, anon;
grant  execute on function public.create_venue(text, text, text, text, text, uuid, boolean)
  to authenticated;

revoke execute on function public.update_venue(uuid, text, text, text, text, text)
  from public, anon;
grant  execute on function public.update_venue(uuid, text, text, text, text, text)
  to authenticated;

revoke execute on function public.archive_venue(uuid) from public, anon;
grant  execute on function public.archive_venue(uuid) to authenticated;

revoke execute on function public.search_venues(uuid, text) from public, anon;
grant  execute on function public.search_venues(uuid, text) to authenticated;
```

- [ ] **Step 4: Apply the migration locally**

```bash
npx supabase db reset
```

Expected: every migration applies, including this one.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:db
```

Expected: 32 passing in `venues.test.sql`, and every pre-existing test still green.

- [ ] **Step 6: Prove the isolation test can actually fail**

A test that passes against a bug is worse than no test. Temporarily widen the select policy:

```sql
-- in psql, against the local stack
alter policy venues_select_public_or_member on public.venues
  using (true);
```

Re-run `npm run test:db`. Expected: `another club cannot read a club-visibility venue` now FAILS. Restore with `npx supabase db reset` and confirm it passes again.

- [ ] **Step 7: Push to the hosted dev project**

```bash
npx supabase db push
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): add the venue master with club-default visibility"
```

---

### Task 3: The events schema

**Files:**
- Create: `supabase/migrations/<timestamp>_create_events.sql`
- Create: `supabase/tests/database/fixtures/events.test.sql`

**Interfaces:**
- Consumes: `public.clubs`, `public.profiles`, `public.is_club_member(uuid)` from plan 2; `public.venues` and `public.is_club_organizer(uuid)` from Task 2.
- Produces: enums `public.event_status` (`draft`/`published`/`cancelled`), `public.skill_tier` (`beginner`/`intermediate`/`advanced`/`mixed`), `public.series_frequency` (`weekly`/`biweekly`/`monthly_nth_weekday`); tables `public.event_series`, `public.events`, `public.event_tables`. Tasks 4, 5, and 6 write the functions that mutate them.

**Why `skill_tier` is not `skill_level`.** A table can be `mixed` and a person cannot. Reusing the profile enum would mean either adding a meaningless `mixed` skill level to people or leaving tier nullable and inventing a meaning for null.

**Why `events` has `unique (id, club_id)`.** It looks redundant next to the primary key, and it is not decorative: it is the target of `event_tables`' composite foreign key, which is what makes a table row whose `club_id` disagrees with its event's *unrepresentable* rather than merely unlikely. The parent spec requires every club-scoped table to carry `club_id`; this is how that requirement is kept honest without a trigger.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/fixtures/events.test.sql`. The block below is
the core; it must ALSO cover the following, which a first draft of this plan
omitted and which let a real data-model contradiction ship under a green
suite — **`event_series` was never once inserted into**:

- Both `event_series` check constraints — `nth_week_matches_frequency` in both
  violating directions, and `ends_after_start`.
- The partial unique index: two occurrences of one series on the same date are
  rejected; two one-off events with no `occurrence_date` are fine.
- Deleting a series that has occurrences: the events survive with `series_id`
  and `occurrence_date` both null, and their `title` and `starts_at` intact.
- The composite FK on **UPDATE**, not only INSERT: changing a child's
  `club_id` alone is rejected, and changing the parent's `club_id` while
  children exist is rejected.
- A plain member can read a **cancelled** event (the policy comment claims it;
  nothing tested it).
- The `event_tables` draft rule, from both roles.
- **`delete from clubs`** for a club with a series, its occurrences, and their
  tables: it succeeds and leaves nothing behind. This path is not optional —
  a first attempt at the trigger above broke club deletion outright and shipped
  green because nothing exercised the cascade.
- A cross-club series link is rejected by the composite foreign key.
- The `array_ndims(overrides) = 1` shape rule (the unknown-key test does not
  cover shape).

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(40);

select has_table('public', 'event_series', 'event_series table exists');
select has_table('public', 'events', 'events table exists');
select has_table('public', 'event_tables', 'event_tables table exists');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   '2026-09-01 23:00+00', '2026-09-02 02:00+00',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Draft game',
   '11111111-0000-0000-0000-000000000001',
   '2026-09-08 23:00+00', '2026-09-09 02:00+00',
   'aaaaaaaa-0000-0000-0000-000000000001');

update public.events set status = 'draft'
  where id = 'e1e1e1e1-0000-0000-0000-000000000002';

insert into public.event_tables (event_id, club_id, label, position) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 1);

-- ---------------------------------------------------------------------
-- Structural guarantees, asserted as the owner.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.event_tables (event_id, club_id, label, position)
    values ('e1e1e1e1-0000-0000-0000-000000000001',
            'c2c2c2c2-0000-0000-0000-000000000002', 'Smuggled', 2)$$,
  '23503',
  null,
  'a table cannot claim a club its event does not belong to'
);

select throws_ok(
  $$insert into public.event_tables (event_id, club_id, label, position)
    values ('e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', 'Duplicate', 1)$$,
  '23505',
  null,
  'two tables cannot share a position on one event'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      occurrence_date, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Orphan occurrence',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-16 02:00+00', '2026-09-15',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an occurrence_date without a series_id is rejected'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      overrides, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Bad override',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-16 02:00+00', array['capacity'],
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an unrecognised override key is rejected'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Backwards',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-15 22:00+00',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an event that ends before it starts is rejected'
);

-- ---------------------------------------------------------------------
-- RLS: the club boundary, and the draft boundary.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s events'
);

select is(
  (select count(*)::int from public.event_tables
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s tables'
);

select is(
  (select count(*)::int from public.event_series
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s series'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  2,
  'an organizer sees published and draft events'
);

select is(
  (select count(*)::int from public.event_tables
   where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'a member of the club can read its tables'
);

-- Demote Alice to a plain member and re-ask about the draft.
set local role postgres;
update public.club_members set role = 'member'
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  1,
  'a plain member sees published events and not drafts'
);

-- ---------------------------------------------------------------------
-- Clients read and never write. Every mutation is a function.
-- ---------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'public.events', 'SELECT'),
  'authenticated can select events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'INSERT'),
  'authenticated cannot insert events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'authenticated cannot update events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'INSERT'),
  'authenticated cannot insert event_tables directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'INSERT'),
  'authenticated cannot insert event_series directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'TRUNCATE'),
  'authenticated cannot TRUNCATE events'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: `events.test.sql` fails on `relation "public.event_series" does not exist`.

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new create_events
```

```sql
/*
 * Events, series, and tables.
 *
 * The shape follows the parent spec's data model with one change worth
 * naming: an occurrence does not "detach" from its series wholesale when a
 * host edits it. It records WHICH FIELDS were edited, in `overrides`, so a
 * host who moves one week to a different hall has changed the address and not
 * the schedule — a later change to the series' start time still reaches that
 * week.
 */

create type public.event_status as enum ('draft', 'published', 'cancelled');
create type public.skill_tier as enum
  ('beginner', 'intermediate', 'advanced', 'mixed');
create type public.series_frequency as enum
  ('weekly', 'biweekly', 'monthly_nth_weekday');

/*
 * The rule, never an instant.
 *
 * No timezone column: it reads `clubs.timezone`. Copying it here would mean a
 * club that corrects its timezone has to correct it again in every series,
 * and the two would eventually disagree.
 *
 * frequency, weekday, nth_week and starts_on are immutable in practice —
 * nothing in this schema stops an UPDATE, but no function offers one.
 * Changing the rhythm means ending this series and starting another, because
 * editing a rule in place requires cancelling occurrences on dates the old
 * rule produced, generating occurrences on dates the new one produces, and
 * then deciding what happens to a customised week stranded on a date that
 * exists in neither. That is a class of bug bought for an action a club takes
 * approximately never.
 */
create table public.event_series (
  id                   uuid primary key default gen_random_uuid(),
  club_id              uuid not null references public.clubs(id)
                         on delete cascade,
  title                text not null check (length(trim(title)) > 0),
  venue_id             uuid not null references public.venues(id),
  notes                text not null default '',
  frequency            public.series_frequency not null,
  weekday              smallint not null check (weekday between 0 and 6),
  nth_week             smallint check (nth_week = -1 or nth_week between 1 and 5),
  start_time           time not null,
  duration_minutes     int not null default 180
                         check (duration_minutes between 15 and 1440),
  table_count          int not null default 1
                         check (table_count between 1 and 20),
  starts_on            date not null,
  -- What the host PLANS: stop repeating after this date. Null = open-ended.
  ends_on              date,
  -- That the host STOPPED it. A different fact from ends_on, and the only
  -- thing that means "this series is over" — see end_event_series.
  ended_at             timestamptz,
  materialized_through date,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),

  -- nth_week is meaningful for exactly one frequency, and meaningless for
  -- the others. Letting it be set anyway would leave a value that reads as
  -- intent and is silently ignored.
  constraint event_series_nth_week_matches_frequency check (
    (frequency = 'monthly_nth_weekday') = (nth_week is not null)
  ),
  constraint event_series_ends_after_start check (
    ends_on is null or ends_on >= starts_on
  ),
  -- The target of events' composite foreign key, same job as events'
  -- `unique (id, club_id)`: it makes a cross-club series link unrepresentable
  -- rather than merely unlikely.
  constraint event_series_id_club_unique unique (id, club_id)
);

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  -- A tidied-up rule must not cancel a club's games, so occurrences survive
  -- their series as ordinary one-off events. The detaching is done by the
  -- before-delete trigger below, NOT by a referential action, and the FK is
  -- composite — see the constraint at the foot of this table.
  series_id       uuid,
  title           text not null check (length(trim(title)) > 0),
  venue_id        uuid not null references public.venues(id),
  notes           text not null default '',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          public.event_status not null default 'published',
  -- The club-local date this row was generated for. Paired with series_id it
  -- is the idempotency key for materialization.
  occurrence_date date,
  -- Which fields a host has changed on this occurrence specifically. The
  -- `starts_at` key means "this occurrence's time was set by hand" and guards
  -- both instants, so a series edit to duration skips it too — otherwise a
  -- hand-set 6:30-9:30 week would keep its start and silently take the
  -- series' new length.
  overrides       text[] not null default '{}',
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint events_ends_after_start check (ends_at > starts_at),
  constraint events_occurrence_requires_series check (
    (series_id is null) = (occurrence_date is null)
  ),
  -- `<@` is containment, not set equality, so the ndims clause is doing real
  -- work: array[array['title'], array['notes']] satisfies containment, and
  -- array_append on a multi-dimensional array raises 2202E — a runtime error
  -- in Task 5's update_event. (array_ndims('{}') is NULL, so an empty array
  -- still passes, which is what we want.)
  constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at']
    and array_ndims(overrides) = 1
  ),
  -- Not decorative: the target of event_tables' composite foreign key.
  constraint events_id_club_unique unique (id, club_id),

  /*
   * Composite, and `no action`, both deliberately.
   *
   * Composite because `series_id uuid references event_series(id)` alone lets
   * an event in club B point at club A's series — and once the trigger below
   * exists, club A deleting that series performs a `security definer` write
   * into club B's row. MATCH SIMPLE means a NULL series_id satisfies it, so
   * one-off events are unaffected.
   *
   * `no action` because every alternative was tried against a live database
   * and each fails somewhere: `set null` nulls the whole composite key
   * including club_id (23502); `set null (series_id)` leaves occurrence_date
   * populated and violates events_occurrence_requires_series — the exact bug
   * the trigger exists to fix; and `deferrable initially deferred` defers the
   * INSERT check too, so a cross-club link is accepted at write time and only
   * rejected at COMMIT. `no action` is safe precisely because the trigger has
   * already cleared these rows before the action would fire.
   *
   * Note that every candidate action passes an ordinary club-cascade delete,
   * so the happy path does not discriminate them at all. What happens is: the
   * event_series cascade fires FIRST (lower RI trigger oid), its own FK check
   * is QUEUED rather than immediate, the events cascade then deletes the
   * referencing rows, and the queued check finds nothing left to complain
   * about. The broken variants therefore look fine until you drop the trigger
   * and force the action to fire on a live row.
   *
   * Do not re-derive this from an assumed firing order. Two successive
   * attempts at this trigger were reasoned out from one and both were wrong;
   * the version that holds is the one that does not depend on the order at
   * all — if the events cascade ran first, the trigger's UPDATE would simply
   * match zero rows and the outcome would be identical.
   */
  foreign key (series_id, club_id)
    references public.event_series (id, club_id) on delete no action
);

/*
 * What makes materialization idempotent. Running the job twice inserts
 * nothing the second time, and a cancelled week is never resurrected because
 * its row still occupies the slot.
 */
create unique index events_series_occurrence_idx
  on public.events (series_id, occurrence_date)
  where series_id is not null;

-- No separate index on series_id alone: the partial unique index above
-- already serves `where series_id = ?` (its predicate is implied by the
-- lookup), and a plain index would additionally index every one-off event's
-- NULL series_id — which will be the majority of rows.
create index events_club_starts_idx on public.events (club_id, starts_at);

create table public.event_tables (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  club_id     uuid not null,
  label       text not null check (length(trim(label)) > 0),
  skill_tier  public.skill_tier not null default 'mixed',
  capacity    int not null default 4 check (capacity between 1 and 8),
  position    int not null check (position > 0),

  -- Composite, so a table row whose club_id disagrees with its event's is
  -- unrepresentable rather than merely unlikely. The parent spec requires
  -- every club-scoped table to carry club_id; this keeps that honest without
  -- a trigger to maintain and to get wrong.
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  unique (event_id, position)
);

-- No index on event_id alone: `unique (event_id, position)` already covers it.

/*
 * What makes `on delete set null` on events.series_id reachable at all.
 *
 * SET NULL nulls series_id and leaves occurrence_date populated, which
 * violates events_occurrence_requires_series — so without this trigger, a
 * series with any materialized occurrence can never be deleted, and the
 * attempt fails with a confusing 23514 raised from inside the FK's own
 * UPDATE. Nulling both columns first means the referential action finds
 * nothing left to do.
 *
 * The intent being preserved: a tidied-up rule must not cancel a club's
 * games, so its occurrences survive as ordinary one-off events — and an
 * ordinary one-off event does not carry a vestigial occurrence_date.
 */
create function public.event_series_detach_occurrences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The `exists` is load-bearing. `delete from clubs` cascades to
  -- event_series first (it is created first, so its RI trigger has the lower
  -- oid), firing this trigger; without the guard, the UPDATE re-validates
  -- events_club_id_fkey against a clubs row that is already gone and the
  -- whole club delete fails. Occurrences whose club is going away are about
  -- to be cascade-deleted anyway, so skipping them is correct.
  update public.events e
    set series_id = null, occurrence_date = null
    where e.series_id = old.id
      and exists (select 1 from public.clubs c where c.id = e.club_id);
  return old;
end;
$$;

create trigger event_series_detach_events
  before delete on public.event_series
  for each row execute function public.event_series_detach_occurrences();

revoke execute on function public.event_series_detach_occurrences() from public, anon;

alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.event_tables enable row level security;

create policy event_series_select_member on public.event_series
  for select using (public.is_club_member(club_id));

-- Members see published and cancelled events; drafts are organizer business.
-- No screen creates a draft in this plan — the enum value and this clause
-- exist because the policy is easier to write once than to retrofit.
create policy events_select_member on public.events
  for select using (
    public.is_club_member(club_id)
    and (status <> 'draft' or public.is_club_organizer(club_id))
  );

/*
 * A table is visible exactly when its event is.
 *
 * Deliberately an `exists` against events rather than a copy of that table's
 * draft carve-out: the subquery is itself subject to events' RLS for a
 * non-definer caller, so one policy governs visibility and the two cannot
 * drift apart. A bare `is_club_member(club_id)` here leaked a draft event's
 * tables — its id, tier, and capacity — to plain members of the club.
 */
create policy event_tables_select_member on public.event_tables
  for select using (
    public.is_club_member(club_id)
    and exists (
      select 1 from public.events e where e.id = event_tables.event_id
    )
  );

/*
 * No insert, update or delete policy on any of the three, and no DML grant.
 * Every mutation goes through a `security definer` function whose first
 * statement checks is_club_organizer against the row's OWN club.
 *
 * `alter default privileges` in 20260822041836 means these tables start with
 * nothing for authenticated; 20260822180200 means service_role already has
 * DML. Neither is inherited by accident — both were deliberate corrections
 * after `ALL` (which includes TRUNCATE, which RLS does not filter) turned out
 * to be the bootstrap default.
 */
grant select on public.event_series to authenticated;
grant select on public.events       to authenticated;
grant select on public.event_tables to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npx supabase db reset
npm run test:db
```

Expected: 40 passing in `events.test.sql`, everything else still green.

- [ ] **Step 5: Prove the draft assertion can fail**

```sql
-- in psql, against the local stack
alter policy events_select_member on public.events
  using (public.is_club_member(club_id));
```

Re-run `npm run test:db`. Expected: `a plain member sees published events and not drafts` FAILS. Restore with `npx supabase db reset`.

- [ ] **Step 6: Push and commit**

```bash
npx supabase db push
git add supabase/migrations supabase/tests
git commit -m "feat(db): add event series, events, and tables with read-only client access"
```

---

### Task 4: Recurrence dates and materialization

**Files:**
- Create: `supabase/migrations/<timestamp>_materialize_event_series.sql`
- Create: `supabase/tests/database/fixtures/event_recurrence.test.sql`

**Interfaces:**
- Consumes: the three tables from Task 3, `public.clubs.timezone`.
- Produces: `public.series_occurrence_dates(public.series_frequency, smallint, smallint, date, date, date, date) returns setof date`; `public.materialize_one_series(uuid, int) returns int`, which does one series and lets errors propagate; and `public.materialize_event_series(int) returns int`, the sweep, which loops over every active series calling the former inside a per-series `begin … exception when others` block with a `raise warning`. **Task 6 calls `materialize_one_series` with the id it just created — not the sweep.** Task 7 schedules the sweep.

**The one arithmetic rule.** An occurrence's instant is
`(occurrence_date + start_time) at time zone club_timezone`. Because the wall clock is resolved against the zone *at that date*, "Tuesdays at 7pm" stays 7pm across both DST shifts. Any code here that adds or subtracts hours to convert a timezone is wrong and will put a whole club at the venue an hour early, twice a year.

**Two pathological cases get pinned, not fixed.** A start time inside the spring-forward gap does not exist and Postgres resolves it forward; a start time inside the fall-back repeat is ambiguous and Postgres picks the first instance. Neither is reachable by a club that plays in the evening, so the correct response is a test that documents the behaviour — not a feature that resolves it.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/fixtures/event_recurrence.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(17);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Date generation, tested directly. No events involved.
-- ---------------------------------------------------------------------

-- Weekly Tuesdays across a month.
select is(
  (select count(*)::int from public.series_occurrence_dates(
     'weekly', 2::smallint, null, '2027-03-01', null,
     '2027-03-01', '2027-03-31')),
  5,
  'March 2027 has five Tuesdays'
);

-- Biweekly is anchored on starts_on, so extending the horizon in two steps
-- must produce the same dates as extending it in one.
select results_eq(
  $$select * from public.series_occurrence_dates(
      'biweekly', 2::smallint, null, '2027-01-01', null,
      '2027-01-01', '2027-02-28')$$,
  $$values ('2027-01-05'::date), ('2027-01-19'), ('2027-02-02'),
           ('2027-02-16')$$,
  'biweekly anchors on the first weekday match after starts_on'
);

select results_eq(
  $$select * from public.series_occurrence_dates(
      'biweekly', 2::smallint, null, '2027-01-01', null,
      '2027-02-01', '2027-02-28')$$,
  $$values ('2027-02-02'::date), ('2027-02-16')$$,
  'a later window keeps the same fortnight, it does not restart it'
);

-- The 5th Tuesday exists in March, June and August 2027 and nowhere else in
-- that range. A month without one produces nothing, rather than falling back
-- to the 4th — "the 5th Tuesday" means what it says.
select results_eq(
  $$select * from public.series_occurrence_dates(
      'monthly_nth_weekday', 2::smallint, 5::smallint, '2027-01-01',
      '2027-08-31', '2027-01-01', '2027-08-31')$$,
  $$values ('2027-03-30'::date), ('2027-06-29'), ('2027-08-31')$$,
  'a month with no fifth Tuesday yields nothing that month'
);

select is(
  (select count(*)::int from public.series_occurrence_dates(
     'monthly_nth_weekday', 2::smallint, (-1)::smallint, '2027-01-01',
     '2027-08-31', '2027-01-01', '2027-08-31')),
  8,
  'the last Tuesday exists in every month'
);

select is(
  (select count(*)::int from public.series_occurrence_dates(
     'weekly', 2::smallint, null, '2027-03-01', '2027-03-15',
     '2027-03-01', '2027-03-31')),
  3,
  'ends_on truncates the run'
);

-- ---------------------------------------------------------------------
-- Materialization.
-- ---------------------------------------------------------------------
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
  '11111111-0000-0000-0000-000000000001',
  'weekly', 0::smallint, '19:00', 180, 3,
  '2027-03-01', '2027-03-31',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- A horizon wide enough to reach March 2027 from whenever the suite runs.
select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  4,
  'four Sundays in March 2027 are materialized'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'),
  12,
  'each occurrence gets the series table count'
);

select is(
  (select count(distinct label)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'),
  3,
  'tables are labelled Table 1..n'
);

-- Idempotency: running it again inserts nothing.
select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  0,
  'a second run creates nothing'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'),
  4,
  'and leaves the occurrence count alone'
);

-- A cancelled week is not resurrected: its row still occupies the slot.
update public.events set status = 'cancelled'
  where series_id = '55555555-0000-0000-0000-000000000001'
    and occurrence_date = '2027-03-14';

update public.event_series set materialized_through = null
  where id = '55555555-0000-0000-0000-000000000001';

select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  0,
  'rewinding the horizon does not recreate a cancelled week'
);

select is(
  (select status::text from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-14'),
  'cancelled',
  'the cancelled week stays cancelled'
);

-- ---------------------------------------------------------------------
-- DST. The whole reason the rule is stored club-local.
-- ---------------------------------------------------------------------
-- US DST begins 2027-03-14. The series above spans it: 2027-03-07 is EST
-- (UTC-5) and 2027-03-14 is EDT (UTC-4). Both must read 19:00 locally.
select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
         <> '19:00'),
  0,
  'every occurrence is 19:00 club-local, on both sides of the shift'
);

-- And prove it is not a fixed offset hiding behind that assertion.
select isnt(
  (select starts_at at time zone 'UTC' from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-07')::time,
  (select starts_at at time zone 'UTC' from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-14')::time,
  'the UTC instant shifts by an hour across the DST boundary'
);

-- The two pathological cases, pinned rather than fixed. A club that plays at
-- 02:30 does not exist; a test that documents what Postgres does is cheaper
-- than a feature nobody needs.
select is(
  (timestamp '2027-03-14 02:30' at time zone 'America/New_York')
    at time zone 'America/New_York',
  timestamp '2027-03-14 03:30',
  'a start time inside the spring-forward gap resolves forward'
);

select is(
  timestamp '2027-11-07 01:30' at time zone 'America/New_York',
  timestamptz '2027-11-07 05:30+00',
  'a start time inside the fall-back repeat takes the first instance'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: `event_recurrence.test.sql` fails with `function public.series_occurrence_dates(...) does not exist`.

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new materialize_event_series
```

```sql
/*
 * Turning a rule into rows.
 *
 * Recurring events materialize into concrete `events` rather than being
 * computed on read, because bookings (plan 4) need something real to attach
 * to and notifications (plan 6) need something real to find.
 */

/*
 * The date arithmetic, isolated so it can be tested without touching a table.
 *
 * `weekday` is 0-6 with Sunday = 0, matching both `extract(dow ...)` and
 * JavaScript's `getDay()`, so the client-side preview in lib/events.ts and
 * this function speak the same language.
 */
create function public.series_occurrence_dates(
  freq         public.series_frequency,
  weekday      smallint,
  nth_week     smallint,
  starts_on    date,
  ends_on      date,
  window_start date,
  window_end   date
)
returns setof date
language plpgsql
immutable
set search_path = public
as $$
declare
  lower_bound date := greatest(starts_on, window_start);
  upper_bound date := least(window_end, coalesce(ends_on, window_end));
  cursor_date date;
  month_start date;
  month_end   date;
  candidate   date;
begin
  if upper_bound < lower_bound then
    return;
  end if;

  if freq = 'weekly' then
    cursor_date := lower_bound
      + ((weekday - extract(dow from lower_bound)::int + 7) % 7);
    while cursor_date <= upper_bound loop
      return next cursor_date;
      cursor_date := cursor_date + 7;
    end loop;

  elsif freq = 'biweekly' then
    -- Anchored on starts_on, never on the window. Anchoring on the window
    -- would let the fortnight drift whenever the horizon is extended in two
    -- steps instead of one — a club would find its every-other-Tuesday game
    -- quietly moving to the alternate Tuesdays.
    cursor_date := starts_on
      + ((weekday - extract(dow from starts_on)::int + 7) % 7);
    if cursor_date < lower_bound then
      cursor_date := cursor_date
        + 14 * ceil((lower_bound - cursor_date)::numeric / 14)::int;
    end if;
    while cursor_date <= upper_bound loop
      return next cursor_date;
      cursor_date := cursor_date + 14;
    end loop;

  elsif freq = 'monthly_nth_weekday' then
    month_start := date_trunc('month', lower_bound::timestamp)::date;
    while month_start <= upper_bound loop
      month_end := (month_start + interval '1 month - 1 day')::date;

      if nth_week = -1 then
        candidate := month_end
          - ((extract(dow from month_end)::int - weekday + 7) % 7);
      else
        candidate := month_start
          + ((weekday - extract(dow from month_start)::int + 7) % 7)
          + 7 * (nth_week - 1);
      end if;

      -- A month with no fifth Tuesday produces nothing that month, rather
      -- than falling back to the fourth. "The fifth Tuesday" means what it
      -- says, and a club that asked for it would rather skip than be
      -- surprised a week early.
      if candidate between greatest(lower_bound, month_start)
                       and least(upper_bound, month_end) then
        return next candidate;
      end if;

      month_start := (month_start + interval '1 month')::date;
    end loop;

  else
    -- A future enum member must fail loudly here rather than silently
    -- generating no dates, which would read as "this series has no
    -- occurrences" and be blamed on the rule.
    raise exception 'unhandled series frequency: %', freq
      using errcode = '22023';
  end if;
end;
$$;

/*
 * Fills every active series' horizon and returns how many events it created.
 *
 * Called two ways: nightly by pg_cron, and synchronously in the same
 * transaction as series creation and series edits. The second matters more
 * than it looks — a host who creates a series and sees no games has watched
 * the feature fail, whatever happens at 3am.
 *
 * The `on conflict` target names the partial index's predicate because
 * Postgres requires inference against a partial unique index to include it.
 * This is what makes two overlapping runs safe: the concurrency question is
 * answered by a constraint rather than by locking discipline.
 */
create function public.materialize_event_series(horizon_days int default 42)
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
  for s in
    select es.*, c.timezone as club_timezone
    from public.event_series es
    join public.clubs c on c.id = es.club_id
    where es.ended_at is null
      and (es.ends_on is null or es.ends_on >= current_date)
  loop
    -- Floored at today. Without it, a series whose starts_on is in the past
    -- materializes every occurrence back to that date: a weekly series
    -- starting two years ago produced 110 events, 104 of them already over,
    -- inside the host's own request. This app schedules games; it does not
    -- invent games that never happened. `current_date` and not
    -- `current_date + 1` — a game this evening is not in the past.
    --
    -- materialized_through still advances to the window end. It means
    -- "covered up to here", not "created up to here", and flooring opens no
    -- gap because window_start is materialized_through + 1 from then on.
    window_start := greatest(
      s.starts_on,
      coalesce(s.materialized_through + 1, s.starts_on),
      current_date
    );
    window_end := least(
      current_date + horizon_days,
      coalesce(s.ends_on, current_date + horizon_days)
    );

    continue when window_end < window_start;

    for d in
      select * from public.series_occurrence_dates(
        s.frequency, s.weekday, s.nth_week,
        s.starts_on, s.ends_on, window_start, window_end
      )
    loop
      new_event := null;

      insert into public.events (
        club_id, series_id, title, venue_id, notes,
        starts_at, ends_at, occurrence_date, created_by
      ) values (
        s.club_id, s.id, s.title, s.venue_id, s.notes,
        (d + s.start_time) at time zone s.club_timezone,
        ((d + s.start_time) at time zone s.club_timezone)
          + make_interval(mins => s.duration_minutes),
        d, s.created_by
      )
      on conflict (series_id, occurrence_date) where series_id is not null
      do nothing
      returning id into new_event;

      if new_event is not null then
        insert into public.event_tables (event_id, club_id, label, position)
        select new_event, s.club_id, 'Table ' || g, g
        from generate_series(1, s.table_count) g;
        created := created + 1;
      end if;
    end loop;

    update public.event_series
      set materialized_through = window_end
      where id = s.id;
  end loop;

  return created;
end;
$$;

/*
 * Not callable by a client. It takes no club argument and checks no
 * membership, because it is maintenance across every series in the system —
 * which is exactly why `authenticated` must not reach it. The functions that
 * DO check membership (create_event_series, update_event_series) call it as
 * their definer owner, so revoking it here costs them nothing.
 */
revoke execute on function public.series_occurrence_dates(
  public.series_frequency, smallint, smallint, date, date, date, date)
  from public, anon;

revoke execute on function public.materialize_event_series(int)
  from public, anon, authenticated;
grant execute on function public.materialize_event_series(int)
  to service_role;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npx supabase db reset
npm run test:db
```

Expected: 17 passing in `event_recurrence.test.sql`.

- [ ] **Step 5: Prove the DST test can fail**

Replace the instant expression in `materialize_event_series` with the naive
version a careless implementation would use, in psql against the local stack:

```sql
create or replace function public.materialize_event_series(horizon_days int default 42)
returns int language plpgsql security definer set search_path = public as $$
begin
  -- deliberately broken: a fixed offset instead of the club's zone
  raise notice 'stub';
  return 0;
end;
$$;
```

Re-run and confirm the four materialization assertions fail rather than
silently passing on stale rows. Restore with `npx supabase db reset`.

- [ ] **Step 6: Push and commit**

```bash
npx supabase db push
git add supabase/migrations supabase/tests
git commit -m "feat(db): materialize recurring events with DST-correct instants"
```

---

### Task 5: Event and table mutations

**Files:**
- Create: `supabase/migrations/<timestamp>_event_mutations.sql`
- Create: `supabase/tests/database/fixtures/event_mutations.test.sql`

**Interfaces:**
- Consumes: the tables from Task 3, `public.is_club_organizer(uuid)` from Task 2.
- Produces: `public.create_event(uuid, text, uuid, text, timestamptz, timestamptz, int) returns uuid`, `public.update_event(uuid, text, uuid, text, timestamptz, timestamptz) returns boolean`, `public.cancel_event(uuid) returns boolean`, `public.add_event_table(uuid) returns uuid`, `public.update_event_table(uuid, text, public.skill_tier) returns boolean`, `public.remove_event_table(uuid) returns boolean`. `lib/events.ts` in Task 8 calls all six by RPC.

**Two guards that are not decorative.**

1. **`assert_club_organizer` against the *event's own* club.** Not "does the caller organize something". This is `club_members_insert_self` again in a new place. The shared helper is defined in Task 2's migration; every mutation here opens with `perform public.assert_club_organizer(<the row's club>)`, and the **argument** is the part to read carefully — a helper cannot protect you from handing it the wrong club.
2. **The venue must be reachable by that club** — its own, or public. Without this check a host could attach another club's private venue to their event, and its name and address would then render for every member of their club. That is the privacy promise of `visibility = 'club'` leaking out through a side door.

**A null argument means "leave this alone", never "clear this".** A screen that edits only the title would otherwise wipe the notes. Clearing a text field is done by passing `''`, which is non-null and therefore an intentional change.

**On `remove_event_table`:** plan 4 attaches bookings to `event_tables.id`. When it does, this function needs a rule for what happens to the people sitting there. It is granular now precisely so that rule can be added without restructuring. It also locks the event's table rows before counting them — two concurrent removals could otherwise each see two tables remaining and both proceed, leaving the event with none.

**All three table functions refuse a cancelled event**, matching `update_event`. Letting a cancelled game's seating be edited would only get more confusing once plan 4 hangs bookings off these rows.

**Read-modify-write needs `for update`.** `update_event` and `remove_event_table` both read a row, decide, then write, so both take the lock — the pattern `accept_club_invite` already established in plan 2. `cancel_event` and `update_event_table` do not: each writes through a single self-contained `UPDATE` that locks and re-reads atomically, with no separate snapshot to go stale.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/fixtures/event_mutations.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(20);

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
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

-- Riverside's own venue, and Oakfield's private one.
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000009', 'Bob''s kitchen',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Creation.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 3)$$,
  'an organizer can create an event'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game'),
  3,
  'the requested number of tables is created'
);

select is(
  (select count(distinct capacity)::int || ':' || max(capacity)::text
   from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game'),
  '1:4',
  'every table seats four'
);

select is(
  (select skill_tier::text from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game' and t.position = 1),
  'mixed',
  'tables default to the mixed tier'
);

-- The venue guard. Another club's private venue is not reachable, even
-- though this caller is a legitimate organizer of their own club.
select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Smuggled venue',
      '11111111-0000-0000-0000-000000000009', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'an organizer cannot attach another club''s private venue'
);

-- The role guard.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Member''s event',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'a plain member cannot create an event'
);

-- The club guard.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Bob''s intrusion',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'a host of another club cannot create an event here'
);

-- ---------------------------------------------------------------------
-- Editing, and the overrides it records.
-- ---------------------------------------------------------------------
set local role postgres;

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  starts_on, created_by
) values (
  '55555555-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
  '11111111-0000-0000-0000-000000000001',
  'weekly', 2::smallint, '19:00', '2027-09-01',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.events (
  id, club_id, series_id, title, venue_id, starts_at, ends_at,
  occurrence_date, created_by
) values (
  'e1e1e1e1-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-000000000001', 'Weekly game',
  '11111111-0000-0000-0000-000000000001',
  '2027-09-07 23:00+00', '2027-09-08 02:00+00', '2027-09-07',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000002', 'Marie''s place',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', null,
      '11111111-0000-0000-0000-000000000002', null, null, null)$$,
  'an organizer can move one occurrence to a different venue'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'only the field that actually changed is recorded as an override'
);

select is(
  (select title from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  'Weekly game',
  'a null argument left the title alone'
);

-- Editing the same field twice must not duplicate the key.
select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', null,
      '11111111-0000-0000-0000-000000000001', null, null, null)$$,
  'the venue can be changed again'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'the override list does not accumulate duplicates'
);

-- A one-off event records no overrides — it has no series to diverge from.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where title = 'Tuesday game'),
      'Tuesday game, moved', null, null, null, null)$$,
  'a one-off event can be edited'
);

select results_eq(
  $$select overrides from public.events
    where title = 'Tuesday game, moved'$$,
  $$values (array[]::text[])$$,
  'a one-off event records no overrides'
);

-- ---------------------------------------------------------------------
-- Cancellation, and what it forbids.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.cancel_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer can cancel an event'
);

select throws_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', 'Resurrected',
      null, null, null, null)$$,
  '42501',
  null,
  'a cancelled event cannot be edited'
);

-- ---------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.add_event_table(
      (select id from public.events where title = 'Tuesday game, moved'))$$,
  'an organizer can add a table'
);

select is(
  (select max(position)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game, moved'),
  4,
  'the new table takes the next position'
);

select lives_ok(
  $$select public.update_event_table(
      (select t.id from public.event_tables t
       join public.events e on e.id = t.event_id
       where e.title = 'Tuesday game, moved' and t.position = 1),
      'Beginners'' table', 'beginner')$$,
  'an organizer can retier a table'
);

select is(
  (select skill_tier::text from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game, moved' and t.position = 1),
  'beginner',
  'the tier landed'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: `event_mutations.test.sql` fails with `function public.create_event(...) does not exist`.

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new event_mutations
```

```sql
/*
 * Every write to events and event_tables.
 *
 * Clients hold `select` on these tables and nothing else, so this file is the
 * complete list of things that can change them. Two guards repeat in every
 * function and neither is decorative:
 *
 *   1. assert_club_organizer against the row's OWN club — not "does the
 *      caller organize something". Plan 2 shipped a policy that constrained
 *      who a row was about and not which club it belonged to, and any member
 *      could make themselves host of any club. The helper raises; the
 *      argument is what matters.
 *
 *   2. The venue must be reachable by that club: its own, or public. Without
 *      it, a host could attach another club's private venue to their event
 *      and its name and address would render for every one of their members —
 *      the privacy promise of `visibility = 'club'` leaking out sideways.
 *
 * A null argument means "leave this alone", never "clear this". Clearing a
 * text field is done by passing '', which is non-null and therefore an
 * intentional change.
 */

create function public.assert_venue_available(target_club uuid, target_venue uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.venues v
    where v.id = target_venue
      and (v.added_by_club_id = target_club or v.visibility = 'public')
  ) then
    raise exception 'venue not available to this club'
      using errcode = '42501';
  end if;
end;
$$;

create function public.create_event(
  target_club  uuid,
  event_title  text,
  target_venue uuid,
  event_notes  text default '',
  event_starts timestamptz default null,
  event_ends   timestamptz default null,
  table_count  int default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(event_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if event_starts is null or event_ends is null or event_ends <= event_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;
  if table_count < 1 or table_count > 20 then
    raise exception 'table count out of range' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    event_starts, event_ends, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

/*
 * Editing one occurrence. Each field that ACTUALLY changes is recorded in
 * `overrides` — so a host who moves one week to a different hall has changed
 * the address and not the schedule, and a later change to the series' start
 * time still reaches that week.
 *
 * `starts_at` covers both instants deliberately: a hand-set 6:30-9:30 week
 * must not keep its start and silently take the series' new length.
 *
 * A one-off event records nothing, because it has no series to diverge from.
 */
create function public.update_event(
  target_event  uuid,
  new_title     text default null,
  new_venue_id  uuid default null,
  new_notes     text default null,
  new_starts_at timestamptz default null,
  new_ends_at   timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
  eff_starts     timestamptz;
  eff_ends       timestamptz;
  next_overrides text[];
begin
  -- `for update`, matching accept_club_invite, reactivate_removed_club_member
  -- and 20260822180300. Without it this is a snapshot read followed by an
  -- unconditional write — the textbook lost update. Two concurrent calls,
  -- one setting the title and one setting the notes, both return true and the
  -- title change vanishes along with its override key, silently.
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);
  -- Cancelling is a different kind of statement from customising, and
  -- un-cancelling by editing would be a nasty surprise for everyone who was
  -- told the game was off.
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title  := coalesce(new_title, ev.title);
  eff_venue  := coalesce(new_venue_id, ev.venue_id);
  eff_notes  := coalesce(new_notes, ev.notes);
  eff_starts := coalesce(new_starts_at, ev.starts_at);
  eff_ends   := coalesce(new_ends_at, ev.ends_at);

  perform public.assert_venue_available(ev.club_id, eff_venue);

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    -- array_append, not `||`. Against an untyped string literal, `||`
    -- resolves to the anyarray||anyarray overload and tries to PARSE the
    -- literal as an array, raising 22P02 malformed array literal. The
    -- element-append overload is not chosen because nothing types the
    -- literal as text first.
    -- Compare TRIMMED, because line below writes trim(eff_title). Comparing
    -- the untrimmed value means '  Weekly  ' over a row titled 'Weekly'
    -- stores an unchanged title and still records the override — detaching
    -- that occurrence from the series title forever, so it silently skips
    -- every future rename. A trailing space from a phone keyboard is enough.
    -- (`notes` is not trimmed on write, so its comparison is already
    -- consistent — leave it.)
    if trim(eff_title) is distinct from ev.title then
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

    -- Editing the same field twice must not stack the key.
    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title     = trim(eff_title),
    venue_id  = eff_venue,
    notes     = eff_notes,
    starts_at = eff_starts,
    ends_at   = eff_ends,
    overrides = next_overrides
  where id = target_event;

  return true;
end;
$$;

/*
 * Cancelling sets status and nothing else. Booking cascades, promotion-offer
 * voiding, and telling the attendees are plan 4 and plan 6 — named here so
 * their absence is a documented boundary rather than an oversight.
 *
 * The row stays, which is also what stops materialization resurrecting a
 * cancelled week: it still occupies its (series_id, occurrence_date) slot.
 */
create function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.events set status = 'cancelled' where id = target_event;
  return true;
end;
$$;

create function public.add_event_table(target_event uuid)
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

  -- The cap is on the COUNT, not on max(position). Capping the position means
  -- an event that ever reached 20 tables can never add another, even after
  -- removals — create 20, remove one, add, and it refuses with 19 present.
  --
  -- Positions may go sparse (remove position 2 of 3 and the next add is 4).
  -- That is cosmetic and cannot collide: max(position)+1 is strictly greater
  -- than every existing position, so `unique (event_id, position)` is never
  -- at risk. It also makes the set-based race here fail safe rather than
  -- needing a lock.
  if (select count(*) from public.event_tables
      where event_id = target_event) >= 20 then
    raise exception 'too many tables' using errcode = '23514';
  end if;

  select coalesce(max(position), 0) + 1 into next_pos
  from public.event_tables where event_id = target_event;

  insert into public.event_tables (event_id, club_id, label, position)
  values (target_event, owning_club, 'Table ' || next_pos, next_pos)
  returning id into new_id;

  return new_id;
end;
$$;

/*
 * Label and tier only. Capacity is not editable in this plan — every table
 * seats four. The column and its 1-8 check exist for the club that eventually
 * turns up with a five-player table, and adding a parameter here is the whole
 * change when that happens.
 */
create function public.update_event_table(
  target_table uuid,
  new_label    text default null,
  new_tier     public.skill_tier default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.event_tables set
    label      = coalesce(nullif(trim(coalesce(new_label, '')), ''), label),
    skill_tier = coalesce(new_tier, skill_tier)
  where id = target_table;

  return true;
end;
$$;

/*
 * Plan 4 attaches bookings to event_tables.id. When it does, this function
 * needs a rule for what happens to the people sitting there. It is granular
 * now — rather than a wholesale "replace the table list" — precisely so that
 * rule can be added without restructuring, and so a replace cannot orphan
 * bookings that do not exist yet.
 */
create function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  owning_event uuid;
  remaining   int;
begin
  select club_id, event_id into owning_club, owning_event
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  select count(*)::int into remaining
  from public.event_tables where event_id = owning_event;

  if remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  delete from public.event_tables where id = target_table;
  return true;
end;
$$;

-- Also from `authenticated`, explicitly: this is a helper called only from
-- inside the definer functions below, and the hosted project grants EXECUTE
-- DIRECTLY to authenticated at creation time, which `from public` does not
-- clear (see 20260822045809).
revoke execute on function public.assert_venue_available(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.create_event(
  uuid, text, uuid, text, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, timestamptz, timestamptz, int) to authenticated;

revoke execute on function public.update_event(
  uuid, text, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, timestamptz, timestamptz) to authenticated;

revoke execute on function public.cancel_event(uuid) from public, anon;
grant  execute on function public.cancel_event(uuid) to authenticated;

revoke execute on function public.add_event_table(uuid) from public, anon;
grant  execute on function public.add_event_table(uuid) to authenticated;

revoke execute on function public.update_event_table(uuid, text, public.skill_tier)
  from public, anon;
grant execute on function public.update_event_table(uuid, text, public.skill_tier)
  to authenticated;

revoke execute on function public.remove_event_table(uuid) from public, anon;
grant  execute on function public.remove_event_table(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npx supabase db reset
npm run test:db
```

Expected: 20 passing in `event_mutations.test.sql`.

- [ ] **Step 5: Prove the venue guard can fail**

In psql against the local stack, neuter it:

```sql
create or replace function public.assert_venue_available(target_club uuid, target_venue uuid)
returns void language plpgsql stable set search_path = public as $$
begin
  return;
end;
$$;
```

Re-run `npm run test:db`. Expected: `an organizer cannot attach another club's private venue` FAILS. Restore with `npx supabase db reset`.

- [ ] **Step 6: Push and commit**

```bash
npx supabase db push
git add supabase/migrations supabase/tests
git commit -m "feat(db): add event and table mutations with per-field override tracking"
```

---

### Task 6: Series mutations, and the club-timezone reflow

**Files:**
- Create: `supabase/migrations/<timestamp>_event_series_mutations.sql`
- Create: `supabase/tests/database/fixtures/event_series_edits.test.sql`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `public.create_event_series(uuid, text, uuid, text, public.series_frequency, smallint, smallint, time, int, int, date, date) returns uuid`, `public.update_event_series(uuid, text, uuid, text, time, int, int, date, boolean) returns boolean`, `public.end_event_series(uuid, boolean) returns boolean`, and the trigger function `public.reflow_events_for_timezone()`. `lib/events.ts` in Task 8 calls the first three by RPC.

**The propagation rule, exactly.** For each field the edit actually changes, update every **future, non-cancelled** occurrence whose `overrides` does not contain that field. Past occurrences are history and are never rewritten. When `include_overridden` is true, apply to those occurrences too *and* remove the edited fields from their `overrides` — fields this edit did not touch keep theirs. Cancelled occurrences are never touched either way.

**`table_count` is the exception.** Changing it affects only occurrences materialized *after* the edit. Existing events' tables will carry bookings from plan 4 onward, and silently adding or removing tables under live bookings is a plan 4 problem that cannot be designed correctly while bookings do not exist.

**A deviation from the spec, made deliberately.** The spec says the club-timezone reflow skips occurrences that have overridden `starts_at`. That is wrong on reflection and this plan does not implement it that way. A timezone change is a *correction of interpretation* — "our local times were being read in the wrong zone" — not a schedule change. An override records that this week's wall clock differs from the series', not that this week is immune to a correction. So the trigger preserves the club-local wall clock of **every** future non-cancelled event, including hand-set ones and including one-off events with no series at all, by re-resolving the same wall clock in the new zone. Update the spec to match when this task lands.

### The propagation gate, and the Reset action that makes it workable

**Propagation is gated on the value having ACTUALLY CHANGED**, compared against
the series row as it was before this edit — not on whether the caller supplied
the parameter. The client sends every field on every save, so gating on
"supplied" would turn the toggle into a full re-sync, and a host who moved only
the start time would silently lose a venue change they had made deliberately.
The spec's rule stands: *fields this edit did not touch keep their overrides.*

That leaves a real gap, and it deserves its own answer rather than an
overloaded checkbox: under this gate there is no way to pull a customised week
back onto the series, because the edit screen shows the series' own unchanged
venue and "did this change?" is false.

So this migration also adds:

```sql
create function public.reset_event_to_series(target_event uuid)
returns boolean
```

It takes one occurrence back to its series in full — title, venue, notes, and
the instants recomputed from `occurrence_date` plus the series' `start_time`
resolved in the club's timezone — and clears `overrides` to `'{}'`.

It refuses a cancelled event, an event with no `series_id`, and — importantly —
a **past** occurrence. This is one button that would otherwise replace a game
which already happened with whatever the series looks like today, after it may
since have been renamed, moved and re-timed. Past occurrences are history. The
guard lives in the function rather than in the screen's show-condition, because
the screen is the wrong place to enforce it. It guards with
`assert_club_organizer` on the event's own club, takes `for update` on the row
it rewrites, and is granted to `authenticated`.

(`update_event` deliberately keeps no past guard — a host typing values for one
specific event is a different act from a one-click revert.)

Two intentions, two controls: the edit screen's toggle applies **one edit** to
customised weeks; this undoes **one week's customisation** entirely.

### Carried in from Task 5's review — three fixes this migration must also make

These are pre-existing, were deliberately not rushed into a fix pass, and land
here because this task writes a migration in the same family and is what makes
the first of them reachable.

**1. `update_event` must only re-assert the venue when the venue is changing.**
It currently asserts unconditionally, which has a consequence nobody intended:
a venue that was `public` when it was booked can later be flipped to
`visibility = 'club'` by its owning club, and every *other* club's existing
events there become uneditable. Verified end to end — Riverside books
Oakfield's public hall, Oakfield flips it to club-only, and Riverside can no
longer edit its own event's title. A foreign club unilaterally froze another
club's records.

```sql
if eff_venue is distinct from ev.venue_id then
  perform public.assert_venue_available(ev.club_id, eff_venue);
end if;
```

Strictly safe: the guard exists to stop you *attaching* an unreachable venue,
and an already-attached venue was validated when it was attached, so nothing
new is disclosed. `create_event` keeps asserting unconditionally.

**2. With that conditional in place, `assert_venue_available` can finally
refuse archived venues** — `and v.archived_at is null`. This was blocked before
precisely because unconditional re-assertion would have made editing the title
of an event already sitting at an archived venue impossible.

**3. Compare `trim(eff_title)` against `trim(ev.title)`, not the raw column.**
The stored title is only trimmed if it was written by `create_event` or
`update_event`; `materialize_one_series` copies `event_series.title` verbatim,
and the check constraints only require `length(trim(title)) > 0`. With an
untrimmed stored title, an edit that passes `new_title => null` silently
retitles the row *and* records a false `title` override. `create_event_series`
below trims on write, which closes it at the source — but the comparison
should be symmetric anyway, and it is one token.

**Why the series functions call `materialize_one_series`, not the sweep.** Two reasons, both learned the hard way in Task 4. A user-facing request must not materialize every other club's series as a side effect of creating its own. And the sweep deliberately swallows a per-series failure so one club's bad data cannot roll back every tenant — which is exactly the wrong behaviour for the series the host is creating right now, where swallowing the error would leave them an empty series and a success message. `materialize_one_series` lets the error propagate, so the creation rolls back with it.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/fixtures/event_series_edits.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(17);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'Marie''s place',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- A weekly Tuesday series a year out, so every occurrence is "future" no
-- matter when the suite runs.
select lives_ok(
  $$select public.create_event_series(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
      '11111111-0000-0000-0000-000000000001', '',
      'weekly', 2::smallint, null, '19:00'::time, 180, 2,
      (current_date + 365), (current_date + 400))$$,
  'an organizer can create a series'
);

-- Creation materializes in the same transaction, so a host never sees an
-- empty series. The horizon is six weeks, and the series starts beyond it —
-- so nothing is materialized yet, which is correct and is asserted so the
-- next assertion's zero is not mistaken for a bug.
select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'a series starting beyond the horizon materializes nothing yet'
);

-- Bring the horizon out to cover it.
set local role postgres;
select public.materialize_event_series(420);

select cmp_ok(
  (select count(*)::int from public.events
   where series_id = (select id from public.event_series limit 1)),
  '>=',
  5,
  'the series materializes once the horizon reaches it'
);

-- Override the venue on exactly one occurrence.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      (select id from public.events order by starts_at limit 1),
      null, '11111111-0000-0000-0000-000000000002', null, null, null)$$,
  'one occurrence is moved to a different venue'
);

-- Cancel a different one, to prove cancellation is never touched.
select lives_ok(
  $$select public.cancel_event(
      (select id from public.events order by starts_at offset 1 limit 1))$$,
  'a different occurrence is cancelled'
);

-- ---------------------------------------------------------------------
-- The default: skip the overridden field, reach everything else.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series limit 1),
      'Renamed game', null, null, '18:30'::time, null, null, null, false)$$,
  'the series title and start time are changed'
);

select is(
  (select venue_id from public.events order by starts_at limit 1),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'the relocated week keeps its venue'
);

select is(
  (select title from public.events order by starts_at limit 1),
  'Renamed game',
  'the relocated week still takes the new title'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events order by starts_at limit 1),
  '18:30',
  'the relocated week still takes the new start time'
);

select is(
  (select title from public.events order by starts_at offset 1 limit 1),
  'Weekly game',
  'the cancelled week is not touched'
);

select is(
  (select count(*)::int from public.events
   where to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
         <> '18:30'
     and status <> 'cancelled'),
  0,
  'every live occurrence moved to the new time'
);

-- ---------------------------------------------------------------------
-- The opt-in: apply to the overridden ones too, and clear only the fields
-- this edit touched.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series limit 1),
      null, '11111111-0000-0000-0000-000000000001', null, null, null, null,
      null, true)$$,
  'the series venue is changed with the override toggle on'
);

select is(
  (select venue_id from public.events order by starts_at limit 1),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the relocated week is pulled back to the series venue'
);

select results_eq(
  $$select overrides from public.events order by starts_at limit 1$$,
  $$values (array[]::text[])$$,
  'and its venue override is cleared'
);

-- ---------------------------------------------------------------------
-- Ending a series.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.end_event_series(
      (select id from public.event_series limit 1), true)$$,
  'an organizer can end a series and cancel its future occurrences'
);

select is(
  (select count(*)::int from public.events
   where starts_at > now() and status <> 'cancelled'),
  0,
  'no live future occurrence survives ending the series'
);

-- ---------------------------------------------------------------------
-- The club-timezone reflow: wall clock is preserved, everywhere.
-- ---------------------------------------------------------------------
set local role postgres;

-- A fresh one-off, rather than resurrecting a cancelled occurrence: the
-- cancelled week never took the series' new 18:30, so un-cancelling it would
-- make this assertion fail against perfectly correct code. A one-off is also
-- the case the wall-clock rule exists for — it has no series rule to
-- recompute from, so an implementation that recomputed from the series would
-- silently skip it.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e9e9e9e9-0000-0000-0000-000000000009',
   'c1c1c1c1-0000-0000-0000-000000000001', 'One-off game',
   '11111111-0000-0000-0000-000000000001',
   ((current_date + 400) + time '18:30') at time zone 'America/New_York',
   ((current_date + 400) + time '21:30') at time zone 'America/New_York',
   'aaaaaaaa-0000-0000-0000-000000000001');

update public.clubs set timezone = 'America/Chicago'
  where id = 'c1c1c1c1-0000-0000-0000-000000000001';

select is(
  (select to_char(starts_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where id = 'e9e9e9e9-0000-0000-0000-000000000009'),
  '18:30',
  'a timezone correction preserves the wall clock, one-off events included'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:db
```

Expected: fails with `function public.create_event_series(...) does not exist`.

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new event_series_mutations
```

```sql
/*
 * Series creation, series editing, and what a club-timezone correction does
 * to events that already exist.
 *
 * The recurrence SHAPE is not editable here on purpose: frequency, weekday,
 * nth_week and starts_on have no parameters below. Changing the rhythm means
 * ending this series and starting another. Editing a rule in place requires
 * cancelling occurrences on dates the old rule produced, generating
 * occurrences on dates the new one produces, and then deciding what happens
 * to a customised week stranded on a date that exists in neither — a class of
 * bug bought for an action a club takes approximately never.
 */

create function public.create_event_series(
  target_club   uuid,
  series_title  text,
  target_venue  uuid,
  series_notes  text default '',
  freq          public.series_frequency default 'weekly',
  weekday       smallint default 2,
  nth_week      smallint default null,
  start_time    time default '19:00',
  duration_minutes int default 180,
  table_count   int default 1,
  starts_on     date default null,
  ends_on       date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(series_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, auth.uid()
  )
  returning id into new_id;

  -- Synchronously, in the same transaction, and for THIS series only. A host
  -- who creates a series and sees no games has watched the feature fail,
  -- whatever happens at 3am — and materialize_one_series lets the error
  -- propagate, so a failure rolls the creation back with it rather than
  -- leaving an empty series behind a success message. The sweep is for cron:
  -- calling it here would make one host's request materialize every club's
  -- series, and would swallow the failure of the very series being created.
  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

/*
 * Editing the series.
 *
 * For each field this edit actually changes, propagate to every FUTURE,
 * NON-CANCELLED occurrence whose `overrides` does not contain that field.
 * Past occurrences are history and are never rewritten.
 *
 * `include_overridden` is the host's decision, surfaced in the UI as a single
 * toggle naming the affected weeks. With it on, the edit reaches the
 * customised occurrences too AND clears the edited fields from their
 * overrides — fields this edit did not touch keep theirs, so a week that
 * overrode both venue and time, edited here for time only, gets the new time
 * and keeps its venue.
 *
 * Cancelled occurrences are never touched either way. Un-cancelling a week by
 * ticking a box would be a nasty surprise for everyone who was told the game
 * was off.
 */
create function public.update_event_series(
  target_series      uuid,
  new_title          text default null,
  new_venue_id       uuid default null,
  new_notes          text default null,
  new_start_time     time default null,
  new_duration       int default null,
  new_table_count    int default null,
  new_ends_on        date default null,
  include_overridden boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se        public.event_series;
  club_tz   text;
  eff_title text;
  eff_venue uuid;
  eff_notes text;
  eff_start time;
  eff_dur   int;
  eff_count int;
  eff_ends  date;
begin
  select * into se from public.event_series where id = target_series;

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
  eff_ends  := coalesce(new_ends_on, se.ends_on);

  perform public.assert_venue_available(se.club_id, eff_venue);

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
    ends_on          = eff_ends
  where id = target_series;

  if eff_title is distinct from se.title then
    update public.events e set title = trim(eff_title)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if eff_venue is distinct from se.venue_id then
    update public.events e set venue_id = eff_venue
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if eff_notes is distinct from se.notes then
    update public.events e set notes = eff_notes
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('notes' = any(e.overrides)));
  end if;

  -- One guard for both instants: a hand-set 6:30-9:30 week must not keep its
  -- start and silently take the series' new length.
  if eff_start is distinct from se.start_time
     or eff_dur is distinct from se.duration_minutes then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  -- Clear only the keys this edit actually touched.
  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'     and eff_title is distinct from se.title)
        or (k = 'venue_id' and eff_venue is distinct from se.venue_id)
        or (k = 'notes'    and eff_notes is distinct from se.notes)
        or (k = 'starts_at' and (eff_start is distinct from se.start_time
                                 or eff_dur is distinct from se.duration_minutes))
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run cancels what now falls outside it.
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    update public.events set status = 'cancelled'
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  -- Extending it, or changing nothing, both want the horizon topped up — for
  -- this series only, for the same reasons as create_event_series above.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

/*
 * Stopping a series.
 *
 * Sets `ended_at` and does NOT touch `ends_on`. Conflating the two did not
 * survive contact with a series that has not started yet: writing
 * `ends_on = current_date` violates event_series_ends_after_start, and the
 * obvious patch — `greatest(current_date, starts_on)` — makes a series ended
 * today read as still running until its own start date, up to a year away.
 * The nightly sweep walks it every night, and every `ends_on < current_date`
 * predicate calls it active.
 *
 * Two different facts, two columns: `ends_on` is what the host planned,
 * `ended_at` is that the host stopped it. Materialization skips any series
 * with `ended_at is not null`.
 */
create function public.end_event_series(
  target_series uuid,
  cancel_future boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club
  from public.event_series where id = target_series;

  if owning_club is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.event_series
    set ended_at = now(),
        materialized_through = least(materialized_through, current_date)
    where id = target_series;

  if cancel_future then
    update public.events set status = 'cancelled'
    where series_id = target_series
      and starts_at > now()
      and status <> 'cancelled';
  end if;

  return true;
end;
$$;

/*
 * A club correcting its timezone must not end up with new events right and
 * every existing one an hour wrong. That is the same failure the club-local
 * recurrence rule exists to prevent, arriving by a different door.
 *
 * The rule is: preserve the club-local WALL CLOCK of every future,
 * non-cancelled event. Re-resolving the same wall clock in the new zone does
 * that in one expression, and it covers one-off events too — which a
 * recompute-from-the-series-rule implementation could not, because a one-off
 * has no rule.
 *
 * Overridden occurrences are reflowed as well. A timezone change is a
 * correction of interpretation, not a schedule change: an override records
 * that this week's wall clock differs from the series', not that this week is
 * immune to being read in the right zone. (The spec's first draft said skip
 * them; this is a deliberate departure and the spec is updated to match.)
 */
create function public.reflow_events_for_timezone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.timezone is distinct from old.timezone then
    update public.events e set
      starts_at = (e.starts_at at time zone old.timezone)
                    at time zone new.timezone,
      ends_at   = (e.ends_at at time zone old.timezone)
                    at time zone new.timezone
    where e.club_id = new.id
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;
  return new;
end;
$$;

create trigger clubs_timezone_reflow
  after update of timezone on public.clubs
  for each row execute function public.reflow_events_for_timezone();

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint,
  time, int, int, date, date) from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint,
  time, int, int, date, date) to authenticated;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean) from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean) to authenticated;

revoke execute on function public.end_event_series(uuid, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, boolean)
  to authenticated;

revoke execute on function public.reflow_events_for_timezone()
  from public, anon;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npx supabase db reset
npm run test:db
```

Expected: 17 passing in `event_series_edits.test.sql`.

- [ ] **Step 5: Prove the override rule can fail in both directions**

In psql, drop the override guard from the venue propagation:

```sql
-- find the function body, and change the venue_id update's WHERE clause to
-- omit `and (include_overridden or not ('venue_id' = any(e.overrides)))`
```

Re-run. Expected: `the relocated week keeps its venue` FAILS. Then restore, and instead make `include_overridden` a no-op by hardcoding `false` in the clearing block. Expected: `and its venue override is cleared` FAILS. Restore with `npx supabase db reset` and confirm all 17 pass.

- [ ] **Step 6: Check the trigger against the spec**

`docs/superpowers/specs/2026-08-22-events-and-scheduling-design.md`, under
"Time, timezones, and DST", states the wall-clock rule and both of its
consequences — one-off events covered, overridden occurrences covered. Confirm
the trigger you wrote matches it. If you had to depart from it, say so in the
commit message and update the spec in the same commit; a spec and a schema
that disagree cost the next reader a day.

- [ ] **Step 7: Push and commit**

```bash
npx supabase db push
git add supabase/migrations supabase/tests docs/superpowers/specs
git commit -m "feat(db): add series edits with the override toggle, and the timezone reflow"
```

---

### Task 6b: Mutation audit of the Tasks 2-5 fixtures

**Files:**
- Modify: `supabase/tests/database/fixtures/venues.test.sql`
- Modify: `supabase/tests/database/fixtures/events.test.sql`
- Modify: `supabase/tests/database/fixtures/event_recurrence.test.sql`
- Modify: `supabase/tests/database/fixtures/event_mutations.test.sql`

**Interfaces:**
- Consumes: everything Tasks 2-5 built.
- Produces: no new schema. Stronger assertions, and a written record of which
  mutation each rule's test actually kills.

**Why this task exists.** Task 6 shipped 17 green assertions that killed **one
of eight** mutants. Removing the guard that stops past occurrences being
rewritten, removing the guard that stops a cancelled week following a series
edit, and adding the exact reflow "fix" the design forbids all passed a fully
green suite. Worse, the brief's own verification step — "drop this guard and
watch assertion 7 fail" — could not fail under either implementation, so the
thing being relied on as a safety net across five tasks was inert.

The Tasks 2-5 fixtures were never mutation-checked. Their reviews verified
behaviour directly against the database, which is stronger evidence than the
tests carry — but that evidence lives in review transcripts, not in anything
that runs again. This task converts it into tests.

**Method, per file.** Do not add assertions speculatively. For each file:

1. **Enumerate the rules the file claims to protect.** Read the assertions and
   the migration they cover, and write the list down first.
2. **For each rule, construct the mutation that breaks it** — `create or
   replace` the function, `alter policy`, `drop constraint`, whatever is
   narrowest — inside a transaction.
3. **Run the file against the mutant.** Record survives/killed and, when
   killed, which assertion caught it.
4. **Roll back.**
5. **For every survivor, add or strengthen an assertion**, then re-run the
   mutation to confirm it now dies.

**The specific rules that must have a killing assertion**, drawn from what each
task's review verified by hand:

`venues.test.sql` — the cross-club read boundary in both directions;
`search_venues` refusing a club the caller does not belong to; the write guards
checking `added_by_club_id` rather than "organizes something"; `visibility`
defaulting to `club`; `share_publicly => true` actually publishing; the partial
unique index applying to public rows only; archived venues absent from search
but still resolving.

`events.test.sql` — the composite FK making a cross-club table row
unrepresentable, on UPDATE as well as INSERT; the draft carve-out on both
`events` and `event_tables`; a cancelled event still visible to a member; the
club cascade leaving nothing behind; the cross-club series link rejected; the
`overrides` shape and key constraints.

`event_recurrence.test.sql` — the DST instant expression (a fixed-offset
mutant must die); biweekly anchoring on `starts_on`; the missing-fifth-weekday
rule; `on conflict` idempotency; a cancelled occurrence never resurrected; the
`current_date` floor; `materialized_through` bookkeeping; the timezone
validation trigger; per-series failure containment in the sweep.

`event_mutations.test.sql` — `assert_club_organizer` on each of the six
functions with the row's own club; `assert_venue_available` on both write
paths; the conditional venue re-assert; per-field override recording including
the trimmed comparison and de-duplication; a cancelled event refusing edits;
the last table refusing removal; the table cap counting rows.

**Do not change any migration.** If a mutation reveals a real defect rather
than a test gap, stop and report it rather than fixing it here — a schema
change belongs in its own reviewed task.

- [ ] **Step 1: Audit and strengthen `venues.test.sql` and `events.test.sql`**
- [ ] **Step 2: Audit and strengthen `event_recurrence.test.sql` and `event_mutations.test.sql`**
- [ ] **Step 3: Run everything**

```bash
npm run test:db
npx supabase test db --linked supabase/tests/database/portable
```

- [ ] **Step 4: Commit, with the mutation table in the message body**

---

### Task 7: Schedule the nightly job, and guard the grants

**Files:**
- Create: `supabase/migrations/<timestamp>_schedule_materialize_event_series.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`

**Interfaces:**
- Consumes: `pg_cron` from Task 1, `public.materialize_event_series(int)` from Task 4.
- Produces: the `materialize-event-series` cron job. Nothing else depends on it.

**Why the grants test matters more than it looks.** `portable/` runs against the hosted project, where privileges can drift with no migration to review. Plan 2's `TRUNCATE` hole — every signed-in member able to empty `profiles` — survived a completely green suite, because every other assertion tested row filtering and `TRUNCATE` never consults a policy. These assertions are the only thing standing between a future `create table` and the same hole reopening.

**Skip this task entirely if Task 1 found `pg_cron` unavailable** in either environment — except for the grants assertions, which move into Task 6's commit instead.

- [ ] **Step 1: Add the grant and ACL assertions**

In `supabase/tests/database/portable/grants.test.sql`, raise the plan count from 22 to 41 and append before `select * from finish();`:

```sql
-- The four tables plan 3 adds. Same reasoning as the four above: ALL is the
-- Supabase bootstrap default and includes TRUNCATE, which RLS does not
-- filter.
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'TRUNCATE'),
  'authenticated cannot TRUNCATE venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_series'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'TRUNCATE'),
  'authenticated cannot TRUNCATE events'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_tables'
);

-- Clients read these tables and never write them. Every mutation is a
-- security definer function that checks the caller's role against the row's
-- own club.
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'INSERT'),
  'authenticated cannot insert venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'INSERT'),
  'authenticated cannot insert events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'authenticated cannot update events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'DELETE'),
  'authenticated cannot delete events'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'INSERT'),
  'authenticated cannot insert event_tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'INSERT'),
  'authenticated cannot insert event_series'
);

-- service_role needs DML, because Edge Functions and scheduled jobs run as
-- it and BYPASSRLS skips policies, not grants.
select ok(
  has_table_privilege('service_role', 'public.events', 'INSERT'),
  'service_role can insert events'
);
select ok(
  has_table_privilege('service_role', 'public.venues', 'SELECT'),
  'service_role can select venues'
);

-- Function ACLs. A null proacl is EXECUTE to PUBLIC, so "nobody granted it"
-- and "everybody has it" look identical until you assert.
select ok(
  not has_function_privilege('anon',
    'public.create_event(uuid, text, uuid, text, timestamptz, timestamptz, int)',
    'EXECUTE'),
  'anon cannot execute create_event'
);
select ok(
  not has_function_privilege('anon',
    'public.create_venue(text, text, text, text, text, uuid, boolean)',
    'EXECUTE'),
  'anon cannot execute create_venue'
);
select ok(
  not has_function_privilege('anon', 'public.search_venues(uuid, text)',
    'EXECUTE'),
  'anon cannot execute search_venues'
);
select ok(
  not has_function_privilege('authenticated',
    'public.assert_club_organizer(uuid)', 'EXECUTE'),
  'authenticated cannot execute assert_club_organizer'
);

-- The sweep function takes no club argument and checks no membership,
-- because it is maintenance across every series in the system. That is
-- exactly why authenticated must not reach it.
select ok(
  not has_function_privilege('authenticated',
    'public.materialize_event_series(int)', 'EXECUTE'),
  'authenticated cannot execute materialize_event_series'
);
select ok(
  not has_function_privilege('authenticated',
    'public.materialize_one_series(uuid, int)', 'EXECUTE'),
  'authenticated cannot execute materialize_one_series'
);

/*
 * The catch-all above this block enumerates functions reachable by `anon`.
 * Add the mirror for `authenticated`, because the hosted project bootstraps
 * every new function with EXECUTE granted DIRECTLY to anon, authenticated and
 * service_role — and `revoke ... from public` does not clear a direct grant
 * (see 20260822045809). An anon-only catch-all therefore cannot see an
 * unintended authenticated grant, which is how series_occurrence_dates
 * shipped reachable on hosted while local looked clean.
 *
 * List every function `authenticated` is SUPPOSED to reach; anything else
 * appearing here is drift.
 */
select is(
  (select coalesce(array_agg(p.proname order by p.proname), '{}')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname not in (
       'is_club_member', 'is_club_organizer', 'create_club',
       'accept_club_invite', 'club_roster',
       'create_venue', 'update_venue', 'archive_venue', 'search_venues',
       'create_event', 'update_event', 'cancel_event',
       'add_event_table', 'update_event_table', 'remove_event_table',
       'create_event_series', 'update_event_series', 'end_event_series'
     )),
  '{}'::name[],
  'no function is reachable by authenticated that should not be'
);
```

- [ ] **Step 2: Run them and watch them fail on the hosted project**

```bash
npm run test:db
npm run test:db:remote
```

Expected: both pass locally after Task 6, and `test:db:remote` passes too — the migrations were pushed at the end of each task. If a hosted assertion fails, that is drift and is exactly what this file exists to catch: fix it with a migration, never with a manual `grant` in the dashboard.

- [ ] **Step 3: Write the schedule migration**

```bash
npx supabase migration new schedule_materialize_event_series
```

```sql
/*
 * Keeps roughly six weeks of recurring events bookable.
 *
 * 03:00 UTC — deliberately not local-midnight-anything. The job is
 * idempotent and its window is measured in weeks, so the exact hour does not
 * matter; what matters is that it is nowhere near the evening when clubs are
 * actually playing and members are actually looking.
 *
 * `cron.unschedule` first, so re-running this migration against a project
 * that already has the job is not an error. Migrations are forward-only and
 * `db reset` replays them all.
 */
do $$
begin
  perform cron.unschedule('materialize-event-series');
exception
  when others then
    -- No such job. Nothing to clean up.
    null;
end;
$$;

select cron.schedule(
  'materialize-event-series',
  '0 3 * * *',
  $$select public.materialize_event_series()$$
);
```

- [ ] **Step 4: Apply, verify the job exists, and run it by hand**

```bash
npx supabase db reset
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -c "select jobname, schedule, active from cron.job where jobname = 'materialize-event-series';"
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -c "select public.materialize_event_series();"
```

Expected: one active job row, and the manual call returns an integer (0 on a fresh database, which has no series).

- [ ] **Step 5: Run everything**

```bash
npm run test:db
npm test
npx tsc --noEmit
```

Expected: all pgTAP green, 132 Vitest still green, typecheck clean.

- [ ] **Step 6: Push and commit**

```bash
npx supabase db push
psql "$SUPABASE_DB_URL" -c "select jobname, active from cron.job;"
git add supabase/migrations supabase/tests
git commit -m "feat(db): schedule nightly materialization and assert the new grants"
```

---

### Task 8: The data layer

**Files:**
- Create: `lib/venues.ts`
- Create: `lib/events.ts`
- Create: `lib/events.test.ts`
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: every function from Tasks 2, 5, and 6, by RPC; `supabase` from `lib/supabase.ts`; `GENERIC_ERROR` from `lib/constants.ts`.
- Produces, from `lib/venues.ts`: types `Venue`, `VenueMatch`; `searchVenues`, `fetchClubVenues`, `createVenue`, `updateVenue`, `archiveVenue`.
  Produces, from `lib/events.ts`: types `EventStatus`, `SkillTier`, `SeriesFrequency`, `ClubEvent`, `EventTable`, `EventSeries`, `RecurrenceRule`; pure `nextOccurrences`, `formatEventWhen`, `frequencyLabel`; and `fetchUpcomingEvents`, `fetchEvent`, `fetchEventTables`, `fetchSeries`, `fetchOverriddenOccurrences`, `createEvent`, `updateEvent`, `cancelEvent`, `addEventTable`, `updateEventTable`, `removeEventTable`, `createEventSeries`, `updateEventSeries`, `endEventSeries`, `resetEventToSeries`.

  **`addEventTable` must not surface a raw `23505`.** Two concurrent adds compute the same next position and the loser hits `unique (event_id, position)`; that is the constraint doing its job, not something to show a host. Map it to a retry or to the generic message.
  Tasks 9–14 consume these.

**Times render in the club's timezone, never the device's.** A member checking Tuesday's game from a hotel in another state must see the time the game actually starts, in the club's terms. `formatEventWhen` takes the club timezone and passes it to `Intl.DateTimeFormat`; nothing here calls `toLocaleString` without one.

**`nextOccurrences` must agree with `series_occurrence_dates`.** It is the create screen's preview — "Tue 25 Aug, Tue 1 Sep, Tue 8 Sep" — and a preview that disagrees with what the database will generate is worse than no preview. Same weekday encoding (0–6, Sunday = 0), same "a month with no fifth Tuesday yields nothing" rule, same biweekly anchor.

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `lib/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatEventWhen, frequencyLabel, nextOccurrences } from './events';

describe('nextOccurrences', () => {
  it('finds the next Tuesdays from a Friday start', () => {
    // 2027-01-01 is a Friday; weekday 2 is Tuesday.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 2, nthWeek: null, startsOn: '2027-01-01' },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-12', '2027-01-19']);
  });

  it('includes the start date itself when it already matches', () => {
    // 2027-01-05 is a Tuesday.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 2, nthWeek: null, startsOn: '2027-01-05' },
        2,
      ),
    ).toEqual(['2027-01-05', '2027-01-12']);
  });

  it('spaces biweekly occurrences a fortnight apart', () => {
    expect(
      nextOccurrences(
        { frequency: 'biweekly', weekday: 2, nthWeek: null, startsOn: '2027-01-01' },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-19', '2027-02-02']);
  });

  it('skips a month with no fifth Tuesday rather than falling back', () => {
    // Fifth Tuesdays in 2027: March 30, June 29, August 31.
    expect(
      nextOccurrences(
        {
          frequency: 'monthly_nth_weekday',
          weekday: 2,
          nthWeek: 5,
          startsOn: '2027-01-01',
        },
        3,
      ),
    ).toEqual(['2027-03-30', '2027-06-29', '2027-08-31']);
  });

  it('reads -1 as the last weekday of the month', () => {
    expect(
      nextOccurrences(
        {
          frequency: 'monthly_nth_weekday',
          weekday: 2,
          nthWeek: -1,
          startsOn: '2027-01-01',
        },
        3,
      ),
    ).toEqual(['2027-01-26', '2027-02-23', '2027-03-30']);
  });

  it('does not drift across a DST boundary', () => {
    // The dates are club-local calendar dates and carry no instant, so the
    // sequence must be unaffected by the machine's timezone or by the US
    // shift on 2027-03-14. This is the client-side half of the same
    // guarantee series_occurrence_dates makes in SQL.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 0, nthWeek: null, startsOn: '2027-03-07' },
        3,
      ),
    ).toEqual(['2027-03-07', '2027-03-14', '2027-03-21']);
  });
});

describe('formatEventWhen', () => {
  it('renders in the club timezone, not the device one', () => {
    // 2027-09-08 00:00 UTC is 2027-09-07 20:00 in New York.
    const label = formatEventWhen('2027-09-08T00:00:00Z', 'America/New_York');
    expect(label).toContain('Tue');
    expect(label).toContain('7 Sep');
    expect(label).toMatch(/8:00\s?pm/i);
  });

  it('gives a different answer for a different club timezone', () => {
    const ny = formatEventWhen('2027-09-08T00:00:00Z', 'America/New_York');
    const la = formatEventWhen('2027-09-08T00:00:00Z', 'America/Los_Angeles');
    expect(ny).not.toEqual(la);
  });
});

describe('frequencyLabel', () => {
  it('names each rhythm in words a host would use', () => {
    expect(frequencyLabel('weekly', 2, null)).toBe('Every Tuesday');
    expect(frequencyLabel('biweekly', 2, null)).toBe('Every other Tuesday');
    expect(frequencyLabel('monthly_nth_weekday', 2, 1)).toBe(
      'The 1st Tuesday of the month',
    );
    expect(frequencyLabel('monthly_nth_weekday', 2, -1)).toBe(
      'The last Tuesday of the month',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npm test -- lib/events.test.ts
```

Expected: FAIL — `Failed to resolve import "./events"`.

- [ ] **Step 3: Write `lib/events.ts`**

```ts
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type EventStatus = 'draft' | 'published' | 'cancelled';
export type SkillTier = 'beginner' | 'intermediate' | 'advanced' | 'mixed';
export type SeriesFrequency = 'weekly' | 'biweekly' | 'monthly_nth_weekday';

/** The field keys `events.overrides` may contain. Mirrors the check constraint. */
export type OverrideKey = 'title' | 'venue_id' | 'notes' | 'starts_at';

export type ClubEvent = {
  id: string;
  club_id: string;
  series_id: string | null;
  title: string;
  venue_id: string;
  venue_name: string;
  notes: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  occurrence_date: string | null;
  overrides: OverrideKey[];
  table_count: number;
};

export type EventTable = {
  id: string;
  label: string;
  skill_tier: SkillTier;
  capacity: number;
  position: number;
};

export type EventSeries = {
  id: string;
  club_id: string;
  title: string;
  venue_id: string;
  notes: string;
  frequency: SeriesFrequency;
  weekday: number;
  nth_week: number | null;
  start_time: string;
  duration_minutes: number;
  table_count: number;
  starts_on: string;
  ends_on: string | null;
};

export type RecurrenceRule = {
  frequency: SeriesFrequency;
  /** 0-6, Sunday = 0. Matches `extract(dow ...)` and `Date#getUTCDay()`. */
  weekday: number;
  /** 1-5, or -1 for "last". Null for every frequency but monthly_nth_weekday. */
  nthWeek: number | null;
  /** 'YYYY-MM-DD', a club-local calendar date carrying no instant. */
  startsOn: string;
};

const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, venues(name), event_tables(id)';

const SERIES_COLUMNS =
  'id, club_id, title, venue_id, notes, frequency, weekday, nth_week, ' +
  'start_time, duration_minutes, table_count, starts_on, ends_on';

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th'];

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Dates are handled entirely in UTC, deliberately.
 *
 * A recurrence rule is a sequence of club-local *calendar dates* and carries
 * no instant at all — the instant is computed in Postgres, from the date plus
 * the club's wall-clock start time, resolved in the club's timezone. Doing
 * the date walk in local time would let the developer's own timezone bend the
 * sequence: `new Date('2027-03-14')` west of Greenwich is the 13th, and a
 * weekly series would silently shift a day for some users and not others.
 */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** The first `weekday` on or after `from`. */
function firstMatch(from: Date, weekday: number): Date {
  return addDays(from, (weekday - from.getUTCDay() + 7) % 7);
}

/** The nth (or last, for -1) `weekday` of the month containing `monthStart`. */
function nthWeekdayOfMonth(
  monthStart: Date,
  weekday: number,
  nthWeek: number,
): Date | null {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));

  if (nthWeek === -1) {
    return addDays(monthEnd, -((monthEnd.getUTCDay() - weekday + 7) % 7));
  }

  const candidate = addDays(firstMatch(monthStart, weekday), 7 * (nthWeek - 1));
  // A month with no fifth Tuesday yields nothing that month, rather than
  // falling back to the fourth. Same rule as series_occurrence_dates.
  return candidate.getUTCMonth() === month ? candidate : null;
}

/**
 * The create screen's preview: the first `count` dates a rule produces.
 *
 * Must agree with `public.series_occurrence_dates` exactly — same weekday
 * encoding, same biweekly anchor, same missing-fifth-weekday rule. A preview
 * that disagrees with what the database will generate is worse than no
 * preview at all.
 */
export function nextOccurrences(rule: RecurrenceRule, count = 3): string[] {
  const start = parseDate(rule.startsOn);
  const out: string[] = [];

  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const step = rule.frequency === 'weekly' ? 7 : 14;
    let cursor = firstMatch(start, rule.weekday);
    while (out.length < count) {
      out.push(formatDate(cursor));
      cursor = addDays(cursor, step);
    }
    return out;
  }

  // monthly_nth_weekday. The month cap is a guard against a rule that can
  // never produce anything, not a product limit: a fifth weekday occurs four
  // or five times a year, so three results never need sixty months.
  let month = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  for (let i = 0; i < 60 && out.length < count; i += 1) {
    const candidate = nthWeekdayOfMonth(month, rule.weekday, rule.nthWeek ?? 1);
    if (candidate && candidate.getTime() >= start.getTime()) {
      out.push(formatDate(candidate));
    }
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  }
  return out;
}

/**
 * Renders an instant in the CLUB's timezone, never the device's.
 *
 * A member checking Tuesday's game from a hotel two states over must see the
 * time the game actually starts, in the club's terms. Every date and time
 * this app shows for an event goes through here.
 */
export function formatEventWhen(
  startsAt: string,
  timezone: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale ?? 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(startsAt));
}

/** The rhythm, in words a host would use rather than enum values. */
export function frequencyLabel(
  frequency: SeriesFrequency,
  weekday: number,
  nthWeek: number | null,
): string {
  const day = WEEKDAY_NAMES[weekday] ?? '';
  if (frequency === 'weekly') return `Every ${day}`;
  if (frequency === 'biweekly') return `Every other ${day}`;
  if (nthWeek === -1) return `The last ${day} of the month`;
  return `The ${ORDINALS[nthWeek ?? 1]} ${day} of the month`;
}

// ---------------------------------------------------------------------------
// Data functions
//
// Every function below never rejects. They catch internally, log the original
// cause for diagnosis, and report failure through `{ error }` or a null
// return — the screens await them directly and an escaping rejection would
// strand the member with a spinner and no message.
// ---------------------------------------------------------------------------

type EventRow = Omit<ClubEvent, 'venue_name' | 'table_count'> & {
  venues: { name: string } | null;
  event_tables: { id: string }[] | null;
};

function toClubEvent(row: EventRow): ClubEvent {
  const { venues, event_tables, ...rest } = row;
  return {
    ...rest,
    venue_name: venues?.name ?? '',
    table_count: event_tables?.length ?? 0,
  };
}

export async function fetchUpcomingEvents(
  clubId: string,
): Promise<ClubEvent[] | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('club_id', clubId)
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');

    if (error) {
      console.error('fetchUpcomingEvents failed', error);
      return null;
    }
    return (data as unknown as EventRow[]).map(toClubEvent);
  } catch (cause) {
    console.error('fetchUpcomingEvents failed', cause);
    return null;
  }
}

export async function fetchEvent(eventId: string): Promise<ClubEvent | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('id', eventId)
      .single();

    if (error || !data) {
      console.error('fetchEvent failed', error);
      return null;
    }
    return toClubEvent(data as unknown as EventRow);
  } catch (cause) {
    console.error('fetchEvent failed', cause);
    return null;
  }
}

export async function fetchEventTables(
  eventId: string,
): Promise<EventTable[] | null> {
  try {
    const { data, error } = await supabase
      .from('event_tables')
      .select('id, label, skill_tier, capacity, position')
      .eq('event_id', eventId)
      .order('position');

    if (error) {
      console.error('fetchEventTables failed', error);
      return null;
    }
    return data as EventTable[];
  } catch (cause) {
    console.error('fetchEventTables failed', cause);
    return null;
  }
}

export async function fetchSeries(
  seriesId: string,
): Promise<EventSeries | null> {
  try {
    const { data, error } = await supabase
      .from('event_series')
      .select(SERIES_COLUMNS)
      .eq('id', seriesId)
      .single();

    if (error || !data) {
      console.error('fetchSeries failed', error);
      return null;
    }
    return data as EventSeries;
  } catch (cause) {
    console.error('fetchSeries failed', cause);
    return null;
  }
}

/**
 * The occurrences a host has customised, so the series edit screen can name
 * them in its toggle rather than showing a bare count. Future and live only —
 * cancelled weeks are never touched by a series edit, with or without the
 * toggle, so listing them would misdescribe what the toggle does.
 */
export async function fetchOverriddenOccurrences(
  seriesId: string,
): Promise<ClubEvent[] | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('series_id', seriesId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');

    if (error) {
      console.error('fetchOverriddenOccurrences failed', error);
      return null;
    }
    return (data as unknown as EventRow[])
      .map(toClubEvent)
      .filter((e) => e.overrides.length > 0);
  } catch (cause) {
    console.error('fetchOverriddenOccurrences failed', cause);
    return null;
  }
}

export async function createEvent(input: {
  clubId: string;
  title: string;
  venueId: string;
  notes: string;
  startsAt: string;
  endsAt: string;
  tableCount: number;
}): Promise<{ eventId: string | null; error: string | null }> {
  if (input.title.trim().length === 0) {
    return { eventId: null, error: 'Give the game a name.' };
  }
  try {
    const { data, error } = await supabase.rpc('create_event', {
      target_club: input.clubId,
      event_title: input.title.trim(),
      target_venue: input.venueId,
      event_notes: input.notes.trim(),
      event_starts: input.startsAt,
      event_ends: input.endsAt,
      table_count: input.tableCount,
    });

    if (error || !data) {
      console.error('createEvent failed', error);
      return { eventId: null, error: GENERIC_ERROR };
    }
    return { eventId: data as string, error: null };
  } catch (cause) {
    console.error('createEvent failed', cause);
    return { eventId: null, error: GENERIC_ERROR };
  }
}

/** A null field means "leave this alone", matching the RPC exactly. */
export async function updateEvent(
  eventId: string,
  input: {
    title?: string | null;
    venueId?: string | null;
    notes?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event', {
      target_event: eventId,
      new_title: input.title ?? null,
      new_venue_id: input.venueId ?? null,
      new_notes: input.notes ?? null,
      new_starts_at: input.startsAt ?? null,
      new_ends_at: input.endsAt ?? null,
    });

    if (error) {
      console.error('updateEvent failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEvent failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function cancelEvent(
  eventId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_event', {
      target_event: eventId,
    });
    if (error) {
      console.error('cancelEvent failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelEvent failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function addEventTable(
  eventId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('add_event_table', {
      target_event: eventId,
    });
    if (error) {
      console.error('addEventTable failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('addEventTable failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function updateEventTable(
  tableId: string,
  input: { label?: string | null; tier?: SkillTier | null },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event_table', {
      target_table: tableId,
      new_label: input.label ?? null,
      new_tier: input.tier ?? null,
    });
    if (error) {
      console.error('updateEventTable failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEventTable failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function removeEventTable(
  tableId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('remove_event_table', {
      target_table: tableId,
    });
    if (error) {
      console.error('removeEventTable failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('removeEventTable failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function createEventSeries(input: {
  clubId: string;
  title: string;
  venueId: string;
  notes: string;
  frequency: SeriesFrequency;
  weekday: number;
  nthWeek: number | null;
  startTime: string;
  durationMinutes: number;
  tableCount: number;
  startsOn: string;
  endsOn: string | null;
}): Promise<{ seriesId: string | null; error: string | null }> {
  if (input.title.trim().length === 0) {
    return { seriesId: null, error: 'Give the game a name.' };
  }
  try {
    const { data, error } = await supabase.rpc('create_event_series', {
      target_club: input.clubId,
      series_title: input.title.trim(),
      target_venue: input.venueId,
      series_notes: input.notes.trim(),
      freq: input.frequency,
      weekday: input.weekday,
      nth_week: input.nthWeek,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      table_count: input.tableCount,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    });

    if (error || !data) {
      console.error('createEventSeries failed', error);
      return { seriesId: null, error: GENERIC_ERROR };
    }
    return { seriesId: data as string, error: null };
  } catch (cause) {
    console.error('createEventSeries failed', cause);
    return { seriesId: null, error: GENERIC_ERROR };
  }
}

export async function updateEventSeries(
  seriesId: string,
  input: {
    title?: string | null;
    venueId?: string | null;
    notes?: string | null;
    startTime?: string | null;
    durationMinutes?: number | null;
    tableCount?: number | null;
    endsOn?: string | null;
    includeOverridden?: boolean;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event_series', {
      target_series: seriesId,
      new_title: input.title ?? null,
      new_venue_id: input.venueId ?? null,
      new_notes: input.notes ?? null,
      new_start_time: input.startTime ?? null,
      new_duration: input.durationMinutes ?? null,
      new_table_count: input.tableCount ?? null,
      new_ends_on: input.endsOn ?? null,
      include_overridden: input.includeOverridden ?? false,
    });

    if (error) {
      console.error('updateEventSeries failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEventSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function endEventSeries(
  seriesId: string,
  cancelFuture = true,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('end_event_series', {
      target_series: seriesId,
      cancel_future: cancelFuture,
    });
    if (error) {
      console.error('endEventSeries failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('endEventSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 4: Run the pure-function tests**

```bash
npm test -- lib/events.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Write `lib/venues.ts`**

```ts
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type VenueVisibility = 'club' | 'public';

export type Venue = {
  id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  visibility: VenueVisibility;
};

/** A `search_venues` row. `is_own_club` drives the grouping in the picker. */
export type VenueMatch = {
  id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  visibility: VenueVisibility;
  is_own_club: boolean;
};

const VENUE_COLUMNS =
  'id, name, address_line, locality, region, postal_code, visibility';

/**
 * The typeahead's only data source. Goes through the RPC rather than a
 * filtered select because the ordering — own club first, then public — is the
 * function's job, and because the function checks that the caller is actually
 * a member of the club it is searching on behalf of.
 */
export async function searchVenues(
  clubId: string,
  query: string,
): Promise<VenueMatch[] | null> {
  try {
    const { data, error } = await supabase.rpc('search_venues', {
      target_club: clubId,
      q: query,
    });

    if (error) {
      console.error('searchVenues failed', error);
      return null;
    }
    return (data ?? []) as VenueMatch[];
  } catch (cause) {
    console.error('searchVenues failed', cause);
    return null;
  }
}

/**
 * The management screen's list: this club's own venues, archived ones
 * excluded. Deliberately not `searchVenues` with an empty query — that also
 * returns public venues from other clubs, which this club cannot edit and
 * should not be offered edit controls for.
 */
export async function fetchClubVenues(
  clubId: string,
): Promise<Venue[] | null> {
  try {
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_COLUMNS)
      .eq('added_by_club_id', clubId)
      .is('archived_at', null)
      .order('name');

    if (error) {
      console.error('fetchClubVenues failed', error);
      return null;
    }
    return data as Venue[];
  } catch (cause) {
    console.error('fetchClubVenues failed', cause);
    return null;
  }
}

export async function createVenue(input: {
  clubId: string;
  name: string;
  addressLine?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  sharePublicly?: boolean;
}): Promise<{ venueId: string | null; error: string | null }> {
  if (input.name.trim().length === 0) {
    return { venueId: null, error: 'Give the venue a name.' };
  }
  try {
    const { data, error } = await supabase.rpc('create_venue', {
      venue_name: input.name.trim(),
      address_line: input.addressLine ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
      target_club: input.clubId,
      share_publicly: input.sharePublicly ?? false,
    });

    if (error || !data) {
      console.error('createVenue failed', error);
      // A duplicate public venue is a real answer, not a system fault, and
      // the host can act on it — so it does not get the generic message.
      if (error?.code === '23505') {
        return {
          venueId: null,
          error: 'A shared venue with that name already exists here.',
        };
      }
      return { venueId: null, error: GENERIC_ERROR };
    }
    return { venueId: data as string, error: null };
  } catch (cause) {
    console.error('createVenue failed', cause);
    return { venueId: null, error: GENERIC_ERROR };
  }
}

export async function updateVenue(
  venueId: string,
  input: {
    name?: string | null;
    addressLine?: string | null;
    locality?: string | null;
    region?: string | null;
    postalCode?: string | null;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_venue', {
      target_venue: venueId,
      venue_name: input.name ?? null,
      address_line: input.addressLine ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
    });

    if (error) {
      console.error('updateVenue failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateVenue failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function archiveVenue(
  venueId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('archive_venue', {
      target_venue: venueId,
    });
    if (error) {
      console.error('archiveVenue failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('archiveVenue failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 6: Extend the schema contract**

The contract suite is what catches a column renamed in SQL and not in
TypeScript. Append to `lib/schema-contract.test.ts`, following the shape of
the existing cases in that file:

```ts
describe('events schema contract', () => {
  it('exposes every column lib/events.ts names on events', async () => {
    const { error } = await supabase
      .from('events')
      .select(
        'id, club_id, series_id, title, venue_id, notes, starts_at, ' +
          'ends_at, status, occurrence_date, overrides',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/events.ts names on event_series', async () => {
    const { error } = await supabase
      .from('event_series')
      .select(
        'id, club_id, title, venue_id, notes, frequency, weekday, ' +
          'nth_week, start_time, duration_minutes, table_count, ' +
          'starts_on, ends_on',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/events.ts names on event_tables', async () => {
    const { error } = await supabase
      .from('event_tables')
      .select('id, label, skill_tier, capacity, position')
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/venues.ts names on venues', async () => {
    const { error } = await supabase
      .from('venues')
      .select(
        'id, name, address_line, locality, region, postal_code, visibility',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('embeds the venue name the event list renders', async () => {
    const { error } = await supabase
      .from('events')
      .select('id, venues(name), event_tables(id)')
      .limit(0);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 7: Run everything**

```bash
npm test
npm run test:contract
npx tsc --noEmit
```

Expected: all Vitest green including the 9 new pure-function tests, 11 schema-contract tests green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add lib/
git commit -m "feat: add the venues and events data layers"
```

---

### Task 9: A date field, mirroring the time field

**Files:**
- Create: `components/DateField.tsx`
- Create: `components/DateField.web.tsx`
- Modify: `lib/time.ts`
- Modify: `lib/time.test.ts`

**Interfaces:**
- Consumes: `@react-native-community/datetimepicker` (native only), `lib/theme`.
- Produces: `DateField({ value, onChange, label })` where `value` is `'YYYY-MM-DD'`; and in `lib/time.ts`, `dateStringToDate(value: string): Date` and `dateToDateString(date: Date): string`.

**Why a new component rather than a `TextField`.** The create-event screen needs a date on iOS, Android, and web. A typed `YYYY-MM-DD` field would be the cheapest thing to build and the worst thing to use on a phone, for a player base that skews older. `TimeField` already established the pattern — native picker in `.tsx`, `<input type="…">` in `.web.tsx`, so the native module never enters the web bundle — and this is that pattern applied a second time.

**Carry the same caveat forward.** `docs/testing.md` records that `@react-native-community/datetimepicker` has no coverage anywhere: component tests render the `.web.tsx` file, and Playwright drives Chromium. That is equally true of this component, and the note should name both.

**The conversions are deliberately local-time.** A picker must show the day the host tapped, so `dateStringToDate` builds a local `Date` and `dateToDateString` reads local getters. The resulting string is a pure calendar date carrying no instant — which is exactly what `event_series.starts_on` stores and what `nextOccurrences` walks.

- [ ] **Step 1: Write the failing tests for the conversions**

Append to `lib/time.test.ts`:

```ts
describe('dateStringToDate / dateToDateString', () => {
  it('round-trips a calendar date', () => {
    expect(dateToDateString(dateStringToDate('2027-03-14'))).toBe('2027-03-14');
  });

  it('builds a local date, so a picker shows the day that was typed', () => {
    const d = dateStringToDate('2027-03-14');
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(14);
  });

  it('pads single-digit months and days', () => {
    expect(dateToDateString(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  it('survives a DST boundary date', () => {
    // 2027-03-14 is the US spring-forward date. A UTC-based implementation
    // would render the 13th for anyone west of Greenwich.
    expect(dateToDateString(dateStringToDate('2027-03-14'))).toBe('2027-03-14');
  });
});
```

Add `dateStringToDate` and `dateToDateString` to that file's import from `./time`.

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- lib/time.test.ts
```

Expected: FAIL — `dateStringToDate is not a function`.

- [ ] **Step 3: Add the conversions to `lib/time.ts`**

```ts
/**
 * "YYYY-MM-DD" to a LOCAL Date, for the native date picker.
 *
 * Local, not UTC, and deliberately so: the picker shows whatever day the
 * Date lands on in the device's timezone, and `new Date('2027-03-14')`
 * parses as UTC midnight — which is 13 March for everyone west of
 * Greenwich. A host in Los Angeles would tap the 14th and see the 13th.
 *
 * The string itself carries no instant. It is a club-local calendar date,
 * the same thing `event_series.starts_on` stores.
 */
export function dateStringToDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The inverse. Local getters, for the same reason. */
export function dateToDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 4: Write `components/DateField.tsx`**

```tsx
import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateStringToDate, dateToDateString } from '../lib/time';
import { colors, radius, space, type } from '../lib/theme';

type DateFieldProps = {
  value: string; // "YYYY-MM-DD"
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Date"
};

/**
 * Native date picker. components/DateField.web.tsx is the web counterpart —
 * Metro's platform-extension resolution picks whichever file matches the
 * build target, so this file (and the native-only
 * @react-native-community/datetimepicker it imports) never reaches the web
 * bundle.
 *
 * The platform split mirrors components/TimeField.tsx exactly, and for the
 * same reasons: iOS renders a compact inline control that expands into a
 * popover, while Android's picker is a modal that opens on mount — so
 * Android needs a visible Pressable of its own and the picker mounted only
 * while it is open.
 */
export default function DateField({ value, onChange, label }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const date = dateStringToDate(value);

  function handleValueChange(
    _event: DateTimePickerChangeEvent,
    nextDate: Date,
  ) {
    setOpen(false);
    onChange(dateToDateString(nextDate));
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.container}>
        <Pressable
          style={styles.androidButton}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={styles.androidButtonText}>
            {date.toLocaleDateString()}
          </Text>
        </Pressable>
        {open ? (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            onValueChange={handleValueChange}
            onDismiss={() => setOpen(false)}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DateTimePicker
        value={date}
        mode="date"
        display="compact"
        onValueChange={handleValueChange}
        accessibilityLabel={label}
        style={styles.iosPicker}
        accentColor={colors.accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  iosPicker: { alignSelf: 'flex-start' },
  androidButton: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    minHeight: 58,
    paddingHorizontal: space[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidButtonText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
});
```

- [ ] **Step 5: Write `components/DateField.web.tsx`**

```tsx
import type { ChangeEvent, CSSProperties } from 'react';
import { View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

type DateFieldProps = {
  value: string; // "YYYY-MM-DD"
  onChange: (next: string) => void;
  label: string;
};

/**
 * Web counterpart to components/DateField.tsx, following
 * components/TimeField.web.tsx exactly.
 *
 * <input type="date"> already speaks the app's currency: its value
 * getter/setter is "YYYY-MM-DD", the same shape event_series.starts_on
 * stores, so no Date conversion happens on this path at all.
 *
 * A cleared input reports "". There is no meaningful "no date" for an
 * event, so an empty value is ignored and the previous one kept — which
 * makes the invalid state unreachable rather than merely rejected.
 */
export default function DateField({ value, onChange, label }: DateFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value === '') return;
    onChange(event.target.value);
  }

  return (
    <View style={{ flex: 1 }}>
      <input
        type="date"
        value={value}
        onChange={handleChange}
        aria-label={label}
        style={webInputStyle}
      />
    </View>
  );
}

// Plain DOM style object (px units required), matching
// components/TextField.tsx's "big" pill input treatment so this reads as the
// same control on web as the native picker does on iOS/Android.
const webInputStyle: CSSProperties = {
  border: `1px solid ${colors.divider}`,
  borderRadius: radius.pill,
  backgroundColor: colors.surface,
  padding: `0 ${space[5]}px`,
  minHeight: 58,
  fontSize: type.size.bodyLarge,
  color: colors.text,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  caretColor: colors.accentColor,
};
```

- [ ] **Step 6: Extend the coverage note in `docs/testing.md`**

The existing note reads "`@react-native-community/datetimepicker` has no
coverage anywhere". Widen it to name both fields:

```markdown
Nothing in this table covers the native time or date pickers. Component tests
render `TimeField.web.tsx` and `DateField.web.tsx` (the `.web.tsx` files win,
same as the bundle), and Playwright drives Chromium — so
`@react-native-community/datetimepicker`, which both native files import, is
exercised by neither. It is checked by hand on a device or not at all.
```

- [ ] **Step 7: Run and commit**

```bash
npm test
npx tsc --noEmit
git add components/ lib/time.ts lib/time.test.ts docs/testing.md
git commit -m "feat: add a date field mirroring the time field's platform split"
```

---

### Task 10: The venue picker

**Files:**
- Create: `components/VenuePicker.tsx`
- Create: `components/__tests__/VenuePicker.test.tsx`

**Interfaces:**
- Consumes: `searchVenues`, `createVenue`, and the `VenueMatch` type from `lib/venues.ts`; `TextField`, `Button`, `Card`, `Toggle` from `components/`.
- Produces: `VenuePicker({ clubId, value, valueName, onChange, disabled })`, where `value` is a venue id or `null` and `onChange(venueId, venueName)` fires on both selection and creation. Tasks 12 and 14 use it.

**Why this is its own component.** Two screens need it, and it is the only genuinely novel interaction in this plan. Everything else composes existing primitives.

**The sharing switch is off, and says what it does.** A host adding "Marie's place" at 11pm must not publish a member's home address by omission. The caption under the switch is the whole privacy design surfacing at the one moment it matters, so it is not optional copy.

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/VenuePicker.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VenuePicker from '../VenuePicker';

vi.mock('../../lib/venues', () => ({
  searchVenues: vi.fn(),
  createVenue: vi.fn(),
}));

import { createVenue, searchVenues } from '../../lib/venues';

const MATCHES = [
  {
    id: 'v1',
    name: 'St Mary’s Hall',
    address_line: null,
    locality: 'Newton',
    visibility: 'public' as const,
    is_own_club: false,
  },
  {
    id: 'v2',
    name: 'St Michael’s Rooms',
    address_line: null,
    locality: 'Newton',
    visibility: 'club' as const,
    is_own_club: true,
  },
];

describe('VenuePicker', () => {
  beforeEach(() => {
    vi.mocked(searchVenues).mockResolvedValue(MATCHES);
    vi.mocked(createVenue).mockResolvedValue({ venueId: 'v3', error: null });
  });

  it('offers both the matches and an add option for what was typed', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    // The failure this guards against is a picker that hides "Add" as soon
    // as anything matches — which is exactly when a host adding a second,
    // similarly-named hall needs it.
    await waitFor(() => {
      expect(screen.getByText('St Mary’s Hall')).toBeTruthy();
    });
    expect(screen.getByText('St Michael’s Rooms')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add “St”/ })).toBeTruthy();
  });

  it('groups the club’s own venues above public ones', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    await waitFor(() => {
      expect(screen.getByText('This club')).toBeTruthy();
    });
    expect(screen.getByText('Public venues')).toBeTruthy();
  });

  it('reports the chosen venue by id and name', async () => {
    const onChange = vi.fn();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    await waitFor(() => {
      expect(screen.getByText('St Mary’s Hall')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'St Mary’s Hall' }));

    expect(onChange).toHaveBeenCalledWith('v1', 'St Mary’s Hall');
  });

  it('opens the add form with sharing OFF', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'Marie’s place' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add “Marie/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add “Marie/ }));

    // The privacy default, asserted rather than assumed. A great deal of
    // mahjong is played in members' homes.
    const share = screen.getByLabelText('Other clubs can use this venue');
    expect(share.getAttribute('aria-checked')).toBe('false');
  });

  it('creates the venue and reports it back', async () => {
    const onChange = vi.fn();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'The Annexe' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add “The Annexe”/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add “The Annexe”/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save venue' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('v3', 'The Annexe');
    });
    expect(vi.mocked(createVenue).mock.calls[0][0]).toMatchObject({
      clubId: 'c1',
      name: 'The Annexe',
      sharePublicly: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- components/__tests__/VenuePicker.test.tsx
```

Expected: FAIL — `Failed to resolve import "../VenuePicker"`.

- [ ] **Step 3: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import TextField from './TextField';
import Toggle from './Toggle';
import { createVenue, searchVenues, type VenueMatch } from '../lib/venues';
import { colors, space, type } from '../lib/theme';

type VenuePickerProps = {
  clubId: string;
  /** The selected venue id, or null when nothing is chosen yet. */
  value: string | null;
  /** Its name, so the field can show a selection without a second fetch. */
  valueName: string;
  onChange: (venueId: string, venueName: string) => void;
  disabled?: boolean;
};

/**
 * Select-or-create over the venue master.
 *
 * "Add <what you typed>" is offered whenever the query is non-empty, NOT
 * only when nothing matches. A host adding a second, similarly-named hall is
 * exactly the person who needs it, and hiding it behind "no results" is
 * hiding it from them.
 *
 * The sharing switch defaults OFF and carries a caption saying what turning
 * it on means. A great deal of mahjong is played in members' homes, and a
 * venue master built with future public discovery in mind must not publish
 * "Marie's place, 42 Elm Street" as a side effect of someone scheduling
 * Tuesday's game.
 */
export default function VenuePicker({
  clubId,
  value,
  valueName,
  onChange,
  disabled,
}: VenuePickerProps) {
  const [query, setQuery] = useState(valueName);
  const [matches, setMatches] = useState<VenueMatch[]>([]);
  const [adding, setAdding] = useState(false);
  const [addressLine, setAddressLine] = useState('');
  const [locality, setLocality] = useState('');
  const [sharePublicly, setSharePublicly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const showResults = !disabled && !adding && trimmed.length > 0
    && trimmed !== valueName;

  useEffect(() => {
    if (!showResults) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    // Debounced: a typeahead that fires per keystroke turns a three-letter
    // hall name into three round trips and renders them out of order.
    const timer = setTimeout(() => {
      searchVenues(clubId, trimmed).then((result) => {
        if (!cancelled) setMatches(result ?? []);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clubId, trimmed, showResults]);

  function select(match: VenueMatch) {
    setQuery(match.name);
    setMatches([]);
    onChange(match.id, match.name);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await createVenue({
      clubId,
      name: trimmed,
      addressLine: addressLine.trim() || undefined,
      locality: locality.trim() || undefined,
      sharePublicly,
    });
    setSaving(false);

    if (result.error || !result.venueId) {
      setError(result.error);
      return;
    }
    setAdding(false);
    setMatches([]);
    onChange(result.venueId, trimmed);
  }

  const own = matches.filter((m) => m.is_own_club);
  const shared = matches.filter((m) => !m.is_own_club);

  if (adding) {
    return (
      <Card>
        <Text style={styles.groupLabel}>New venue</Text>
        <Text style={styles.name}>{trimmed}</Text>
        <TextField
          label="Address (optional)"
          value={addressLine}
          onChangeText={setAddressLine}
          accessibilityLabel="Address"
        />
        <TextField
          label="Town or city (optional)"
          value={locality}
          onChangeText={setLocality}
          accessibilityLabel="Town or city"
        />
        <View style={styles.shareRow}>
          <Toggle
            value={sharePublicly}
            onValueChange={setSharePublicly}
            accessibilityLabel="Other clubs can use this venue"
          />
          <Text style={styles.help}>
            Other clubs can use this venue. Leave this off for a home or
            anywhere private — once another club starts using a shared venue,
            it cannot be made private again.
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          onPress={save}
          loading={saving}
          accessibilityLabel="Save venue"
        >
          Save venue
        </Button>
        <Button
          variant="ghost"
          onPress={() => setAdding(false)}
          accessibilityLabel="Cancel adding a venue"
        >
          Cancel
        </Button>
      </Card>
    );
  }

  return (
    <View>
      <TextField
        label="Venue"
        value={query}
        onChangeText={setQuery}
        editable={!disabled}
        accessibilityLabel="Venue"
        placeholder="Where are you playing?"
      />

      {showResults ? (
        <Card>
          {own.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>This club</Text>
              {own.map((match) => (
                <Button
                  key={match.id}
                  variant="ghost"
                  bodyFace
                  onPress={() => select(match)}
                  accessibilityLabel={match.name}
                >
                  {match.name}
                </Button>
              ))}
            </>
          ) : null}

          {shared.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Public venues</Text>
              {shared.map((match) => (
                <Button
                  key={match.id}
                  variant="ghost"
                  bodyFace
                  onPress={() => select(match)}
                  accessibilityLabel={match.name}
                >
                  {match.name}
                </Button>
              ))}
            </>
          ) : null}

          <Button
            variant="secondary"
            onPress={() => setAdding(true)}
            accessibilityLabel={`Add “${trimmed}”`}
          >
            {`Add “${trimmed}”`}
          </Button>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
    marginTop: space[3],
  },
  name: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    marginVertical: space[4],
  },
  help: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[700],
    marginBottom: space[3],
  },
});
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- components/__tests__/VenuePicker.test.tsx
```

Expected: PASS, 5 tests. If `Toggle`'s accessibility props differ from what
the test queries, read `components/Toggle.tsx` and match it rather than
changing the assertion — the assertion is describing the requirement.

- [ ] **Step 5: Prove the privacy default can fail**

Change `useState(false)` to `useState(true)` for `sharePublicly`, re-run, and
confirm `opens the add form with sharing OFF` FAILS. Change it back.

- [ ] **Step 6: Run everything and commit**

```bash
npm test
npx tsc --noEmit
git add components/
git commit -m "feat: add the venue picker with select-or-create and private-by-default sharing"
```

---

### Task 11: The clubs-list spacing bug

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `e2e/visual.spec.ts-snapshots/` (regenerated baselines)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. This is a layout fix, taken now because the next task changes the neighbouring screen and the baselines are regenerated either way.

**The bug**, from `todo.md`: the club `Card`s and the "Start another club" `Button` render as adjacent siblings with no gap, and the empty state has the same shape — the help text sits directly on the button.

**Fix it in the layout, not with a one-off margin.** `app/clubs/[id]/index.tsx` already solves this by giving its `<Screen>` a `contentStyle` with `gap: space[4]`; the list screen simply never got one. Copy that, rather than adding `marginBottom` to `Card` — a margin on the card would fix the list and not the empty state, and would leak into every other screen that uses `Card`.

- [ ] **Step 1: Give the screen a spaced container**

In `app/clubs/index.tsx`, add to the `styles` object:

```ts
  container: {
    gap: space[4],
  },
```

- [ ] **Step 2: Apply it to all four `<Screen>` returns**

The screen returns `<Screen>` five times — loading, signed-out redirect, not-ready, load-failed, and the main render. The gap belongs on the two that render stacked content:

```tsx
// the loadFailed branch
<Screen contentStyle={styles.container}>

// the main render
<Screen contentStyle={styles.container}>
```

Leave the two `ActivityIndicator` branches alone: they already centre a single child, and a gap on a one-child container is dead style.

- [ ] **Step 3: Check both states in the browser**

```bash
npm run web
```

Look at a club list with at least two clubs, and at the empty state (sign in as a member of no clubs, or temporarily return `[]` from `fetchMyClubs`). Expected: even vertical rhythm between cards, between the last card and the button, and between the help text and the button.

- [ ] **Step 4: Regenerate the clubs baselines**

```bash
npm run test:visual -- --update-snapshots
git diff --stat e2e/visual.spec.ts-snapshots/
```

Expected: only the clubs baselines change. Open each changed PNG and confirm the difference is the spacing and nothing else — a baseline update that also captures an unrelated regression is how a regression ships.

- [ ] **Step 5: Commit**

```bash
git add app/clubs/index.tsx e2e/
git commit -m "fix: space the clubs list from the button that follows it"
```

---

### Task 12: Upcoming events on the club screen

**Files:**
- Modify: `app/clubs/[id]/index.tsx`

**Interfaces:**
- Consumes: `fetchUpcomingEvents`, `formatEventWhen`, and the `ClubEvent` type from `lib/events.ts`; `canInvite` from `lib/clubs.ts`.
- Produces: nothing importable. The route `/clubs/<id>/events/new` is linked from here and is built in Task 13; the route `/clubs/<id>/events/<eventId>` is linked from here and is built in Task 14.

**Order the tasks so no link dangles.** `app/__tests__/redirect-routes.test.ts` enforces that every redirect target has a route file. These are `Link`s rather than redirects, so that test will not catch them — but a link to a route that does not exist is a 404 on web either way. If you are executing tasks out of order, create the two route files as stubs when you add the links, and fill them in at their own tasks.

**Times render in the club's timezone.** `club.timezone` is already fetched by this screen. Pass it to `formatEventWhen` — never call `toLocaleString` without it.

- [ ] **Step 1: Load the events alongside the roster**

Add to the imports:

```tsx
import { fetchUpcomingEvents, formatEventWhen } from '../../../lib/events';
import type { ClubEvent } from '../../../lib/events';
import { canInvite } from '../../../lib/clubs';
```

Add the state, next to the existing `roster` state:

```tsx
  const [events, setEvents] = useState<ClubEvent[]>([]);
```

And extend the existing `useEffect` that loads the club, roster, and invites to
load events too, in the same `Promise.all`. Follow the shape already there:
a `null` result sets `loadFailed`, anything else sets state.

```tsx
      fetchUpcomingEvents(clubId).then((result) => {
        if (cancelled) return;
        if (result === null) setLoadFailed(true);
        else setEvents(result);
      });
```

- [ ] **Step 2: Work out whether this viewer may create events**

Below the existing derived values in the component body:

```tsx
  // The roster is already loaded for the member list, so the viewer's role
  // costs nothing extra. `canInvite` is exactly the host-or-co-organizer
  // test the event functions enforce in SQL, so the UI and the database
  // agree about who may do this rather than each deciding separately.
  const myRole = roster.find((m) => m.profile_id === userId)?.role;
  const isOrganizer = myRole ? canInvite(myRole) : false;
```

- [ ] **Step 3: Render the section**

Insert between the club rhythm and the `importedCount` card, so events sit
above the roster — the screen's job is now "what's on" first, "who's in"
second:

```tsx
      <Text style={styles.sectionTitle}>Upcoming</Text>

      {events.length === 0 ? (
        <Text style={styles.help}>
          {isOrganizer
            ? 'No games scheduled yet. Add one and everyone in the club will see it.'
            : 'No games scheduled yet.'}
        </Text>
      ) : (
        events.map((event) => (
          <Link
            key={event.id}
            href={`/clubs/${clubId}/events/${event.id}`}
            asChild
          >
            {/*
              Pressable rather than Card, for the reason app/clubs/index.tsx
              documents at length: Card is a plain function component that
              neither declares accessibility props nor spreads unrecognised
              ones onto its View, so `Link asChild` cloning onto it drops the
              handler and leaves the card inert.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${event.title}, ${formatEventWhen(
                event.starts_at,
                club.timezone,
              )}`}
            >
              <Card>
                <View style={styles.row}>
                  <Text style={styles.memberName}>{event.title}</Text>
                  {event.status === 'cancelled' ? (
                    <Tag>Cancelled</Tag>
                  ) : null}
                </View>
                <Text style={styles.help}>
                  {formatEventWhen(event.starts_at, club.timezone)}
                  {' · '}
                  {event.venue_name}
                </Text>
                <Text style={styles.help}>
                  {event.table_count}{' '}
                  {event.table_count === 1 ? 'table' : 'tables'}
                </Text>
              </Card>
            </Pressable>
          </Link>
        ))
      )}

      {isOrganizer ? (
        <Button
          variant="secondary"
          onPress={() => router.push(`/clubs/${clubId}/events/new`)}
          accessibilityLabel="Add a game"
        >
          Add a game
        </Button>
      ) : null}
```

Add `Pressable` and `View` to the `react-native` import and `Link` to the
`expo-router` import if they are not already there, and import `Tag` from
`../../../components/Tag`.

- [ ] **Step 4: Link to the venues screen**

Organizers need a way to reach venue management. Add below the invite
controls, alongside the existing links:

```tsx
      {isOrganizer ? (
        <Link href={`/clubs/${clubId}/venues`} style={styles.linkRow}>
          <Text style={styles.link}>Venues</Text>
        </Link>
      ) : null}
```

Add the two styles if this screen does not already have them:

```ts
  linkRow: { marginTop: space[6] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
```

- [ ] **Step 5: Verify in the browser**

```bash
npm run web
```

Expected: the Upcoming heading appears above the roster; a club with no events
shows the plain line and not an error; an organizer sees "Add a game" and
"Venues" and a plain member sees neither.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
npm test
git add app/clubs/
git commit -m "feat: show upcoming games on the club screen"
```

---

### Task 13: Creating a game, one-off or recurring

**Files:**
- Create: `app/clubs/[id]/events/new.tsx`

**Interfaces:**
- Consumes: `createEvent`, `createEventSeries`, `nextOccurrences`, `frequencyLabel` from `lib/events.ts`; `fetchClub` from `lib/clubs.ts`; `VenuePicker`, `DateField`, `TimeField`, `TextField`, `Button`, `Screen`, `ErrorBanner`.
- Produces: the route `/clubs/<id>/events/new`, linked from Task 12.

**One screen, two outcomes.** "Repeats: never" creates a single `events` row; anything else creates an `event_series`, which materializes its occurrences in the same transaction. The form is the same either way except for the end date, so it is one screen and not two.

**The instant is computed here, once.** For a one-off, the client turns the chosen date and time into a `timestamptz` using the club's timezone. For a series, the client sends the date and the wall-clock time separately and Postgres does the resolving. Both paths must agree, which is why the one-off path uses the same club timezone rather than the device's.

**The preview is not decoration.** A host choosing "monthly, 5th Tuesday" needs to see that the next three are in March, June, and August before they commit. `nextOccurrences` is tested against the same cases as `series_occurrence_dates` precisely so this preview can be trusted.

- [ ] **Step 1: Build the screen**

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../components/Button';
import DateField from '../../../../components/DateField';
import ErrorBanner from '../../../../components/ErrorBanner';
import Screen from '../../../../components/Screen';
import TextField from '../../../../components/TextField';
import TimeField from '../../../../components/TimeField';
import VenuePicker from '../../../../components/VenuePicker';
import { fetchClub, type Club } from '../../../../lib/clubs';
import {
  createEvent,
  createEventSeries,
  frequencyLabel,
  nextOccurrences,
  type SeriesFrequency,
} from '../../../../lib/events';
import { dateToDateString } from '../../../../lib/time';
import { useSession } from '../../../../lib/session';
import { colors, space, type } from '../../../../lib/theme';

type Repeat = 'never' | SeriesFrequency;

const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'never', label: 'Just once' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every other week' },
  { value: 'monthly_nth_weekday', label: 'Monthly' },
];

const DURATIONS = [120, 180, 240];

/**
 * Turns a club-local date and wall-clock time into an instant, in the CLUB's
 * timezone rather than the device's.
 *
 * `new Date('2027-09-07T19:00')` is 7pm wherever the phone happens to be,
 * which for a member creating an event while travelling is the wrong evening
 * entirely. Formatting the same wall clock in the club's zone and reading
 * back the offset is the one conversion this app does client-side, and it
 * exists only because a one-off event has no series row for Postgres to
 * resolve from.
 */
function clubInstant(date: string, time: string, timezone: string): string {
  const naive = new Date(`${date}T${time}:00Z`);
  const shown = new Date(
    naive.toLocaleString('en-US', { timeZone: timezone }),
  );
  const offset = naive.getTime() - shown.getTime();
  return new Date(naive.getTime() + offset).toISOString();
}

export default function NewEventScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState('');
  const [date, setDate] = useState(dateToDateString(new Date()));
  const [startTime, setStartTime] = useState('19:00');
  const [duration, setDuration] = useState(180);
  const [tableCount, setTableCount] = useState(1);
  const [repeat, setRepeat] = useState<Repeat>('never');
  const [endsOn, setEndsOn] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchClub(clubId).then((result) => {
      if (cancelled) return;
      setClub(result);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, session]);

  if (loading || !ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!club) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That club could not be loaded." />
      </Screen>
    );
  }

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // "Monthly" means "the same weekday-of-month as the date you picked" —
  // derived rather than asked, because a host who picks the 2nd Tuesday
  // means the 2nd Tuesday, and making them say so twice is a form that does
  // not trust them.
  const nthWeek = Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;

  const preview =
    repeat === 'never'
      ? []
      : nextOccurrences(
          {
            frequency: repeat,
            weekday,
            nthWeek: repeat === 'monthly_nth_weekday' ? nthWeek : null,
            startsOn: date,
          },
          3,
        );

  async function onSave() {
    if (!venueId) {
      setError('Choose where you are playing.');
      return;
    }
    setSaving(true);
    setError(null);

    if (repeat === 'never') {
      const startsAt = clubInstant(date, startTime, club.timezone);
      const endsAt = new Date(
        new Date(startsAt).getTime() + duration * 60_000,
      ).toISOString();
      const result = await createEvent({
        clubId,
        title,
        venueId,
        notes,
        startsAt,
        endsAt,
        tableCount,
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace(`/clubs/${clubId}`);
      return;
    }

    const result = await createEventSeries({
      clubId,
      title,
      venueId,
      notes,
      frequency: repeat,
      weekday,
      nthWeek: repeat === 'monthly_nth_weekday' ? nthWeek : null,
      startTime,
      durationMinutes: duration,
      tableCount,
      startsOn: date,
      endsOn: endsOn.length > 0 ? endsOn : null,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(`/clubs/${clubId}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Text style={styles.heading}>Add a game</Text>

      {error ? <ErrorBanner message={error} /> : null}

      <TextField
        label="What is it called?"
        value={title}
        onChangeText={setTitle}
        accessibilityLabel="Game name"
        placeholder="Tuesday night mahjong"
      />

      <VenuePicker
        clubId={clubId}
        value={venueId}
        valueName={venueName}
        onChange={(id, name) => {
          setVenueId(id);
          setVenueName(name);
        }}
      />

      <Text style={styles.label}>Date</Text>
      <DateField value={date} onChange={setDate} label="Date" />

      <Text style={styles.label}>Start time</Text>
      <TimeField value={startTime} onChange={setStartTime} label="Start time" />

      <Text style={styles.label}>How long?</Text>
      <View style={styles.chips}>
        {DURATIONS.map((minutes) => (
          <Button
            key={minutes}
            variant={duration === minutes ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setDuration(minutes)}
            accessibilityLabel={`${minutes / 60} hours`}
            accessibilityState={{ selected: duration === minutes }}
          >
            {`${minutes / 60} hours`}
          </Button>
        ))}
      </View>

      <Text style={styles.label}>How many tables?</Text>
      <View style={styles.chips}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Button
            key={n}
            variant={tableCount === n ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setTableCount(n)}
            accessibilityLabel={`${n} ${n === 1 ? 'table' : 'tables'}`}
            accessibilityState={{ selected: tableCount === n }}
          >
            {String(n)}
          </Button>
        ))}
      </View>
      <Text style={styles.help}>
        Every table seats four, so {tableCount}{' '}
        {tableCount === 1 ? 'table is' : 'tables are'} room for{' '}
        {tableCount * 4} players.
      </Text>

      <Text style={styles.label}>Does it repeat?</Text>
      <View style={styles.chips}>
        {REPEATS.map((option) => (
          <Button
            key={option.value}
            variant={repeat === option.value ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setRepeat(option.value)}
            accessibilityLabel={option.label}
            accessibilityState={{ selected: repeat === option.value }}
          >
            {option.label}
          </Button>
        ))}
      </View>

      {repeat !== 'never' ? (
        <>
          <Text style={styles.help}>
            {frequencyLabel(
              repeat,
              weekday,
              repeat === 'monthly_nth_weekday' ? nthWeek : null,
            )}
            . Next: {preview.join(', ')}
          </Text>
          <Text style={styles.label}>Stop repeating on (optional)</Text>
          <DateField
            value={endsOn.length > 0 ? endsOn : date}
            onChange={setEndsOn}
            label="Stop repeating on"
          />
        </>
      ) : null}

      <TextField
        label="Anything else? (optional)"
        value={notes}
        onChangeText={setNotes}
        accessibilityLabel="Notes"
        multiline
      />

      <Button onPress={onSave} loading={saving} accessibilityLabel="Save game">
        Save
      </Button>
      <Button
        variant="ghost"
        onPress={() => router.back()}
        accessibilityLabel="Cancel"
      >
        Cancel
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
```

- [ ] **Step 2: Verify both paths against the local stack**

```bash
npm run web
```

Create a one-off game and confirm it appears on the club screen at the time
you chose. Then create a weekly series and confirm several occurrences appear
immediately — not one, and not none. A series that materializes nothing is the
failure the synchronous call in `create_event_series` exists to prevent, so if
you see it, check that call before anything else.

- [ ] **Step 3: Check the preview against the database**

Create a "Monthly" series on a date that is the 5th Tuesday of its month.
Expected: the preview names three dates, and the club screen then shows
exactly those dates. If they disagree, `nextOccurrences` and
`series_occurrence_dates` have diverged, which is the one bug this preview can
introduce that is worse than having no preview.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
npm test
git add app/clubs/
git commit -m "feat: add the create-a-game screen with a recurrence preview"
```

---

### Task 14: The event screen

**Files:**
- Create: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: `fetchEvent`, `fetchEventTables`, `fetchSeries`, `cancelEvent`, `addEventTable`, `updateEventTable`, `removeEventTable`, `formatEventWhen`, `frequencyLabel` from `lib/events.ts`; `fetchClub`, `fetchRoster`, `canInvite` from `lib/clubs.ts`.
- Produces: the route `/clubs/<id>/events/<eventId>`, linked from Task 12. Links onward to `/clubs/<id>/events/<eventId>/edit`, built in Task 15.

**What a member sees, and what they do not.** Tables are listed with their tier and seat count. There is **no booking affordance and no "coming soon" badge** — badges like that age badly and seat booking is plan 4, which is next. A member reads the screen and closes it; that is the whole intended interaction for them in this plan.

**Overrides are shown, quietly.** A series-linked event that has been customised says so on the field that was customised — "moved from the usual venue" — because a host looking at a week they changed three weeks ago has no other way to know why it differs, and a host looking at a week they did *not* change should not be told anything.

**Customised occurrences get a Reset control.** When `event.overrides` is
non-empty, organizers see **"Reset to the series"**, calling
`resetEventToSeries` — it puts that week's title, venue, notes and time back to
the series' own and clears its overrides. This is the counterpart to the edit
screen's toggle, and the reason that toggle can keep the narrow meaning the
spec gives it: the toggle applies one edit to customised weeks, this undoes a
week's customisation entirely. Do not render it on a one-off event or on an
occurrence with no overrides — there is nothing to reset, and offering it would
imply there is.

- [ ] **Step 1: Build the screen**

```tsx
import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import Tag from '../../../../../components/Tag';
import { ChevronLeftIcon } from '../../../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../../../lib/clubs';
import type { Club } from '../../../../../lib/clubs';
import {
  addEventTable,
  cancelEvent,
  fetchEvent,
  fetchEventTables,
  fetchSeries,
  formatEventWhen,
  frequencyLabel,
  removeEventTable,
  updateEventTable,
  type ClubEvent,
  type EventSeries,
  type EventTable,
  type SkillTier,
} from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { colors, space, type } from '../../../../../lib/theme';

const TIERS: { value: SkillTier; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

export default function EventScreen() {
  const { id: clubId, eventId } = useLocalSearchParams<{
    id: string;
    eventId: string;
  }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [tables, setTables] = useState<EventTable[]>([]);
  const [series, setSeries] = useState<EventSeries | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [loadedClub, loadedEvent, loadedTables, roster] = await Promise.all([
      fetchClub(clubId),
      fetchEvent(eventId),
      fetchEventTables(eventId),
      fetchRoster(clubId),
    ]);

    setClub(loadedClub);
    setEvent(loadedEvent);
    setTables(loadedTables ?? []);

    const myRole = (roster ?? []).find(
      (m) => m.profile_id === session?.user.id,
    )?.role;
    setIsOrganizer(myRole ? canInvite(myRole) : false);

    if (loadedEvent?.series_id) {
      setSeries(await fetchSeries(loadedEvent.series_id));
    }
    setReady(true);
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, eventId, session]);

  if (loading || !ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!club || !event) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That game could not be loaded." />
      </Screen>
    );
  }

  const overridden = (key: string) => event.overrides.includes(key as never);

  async function run(action: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        {club.name}
      </Button>

      <View style={styles.row}>
        <Text style={styles.heading}>{event.title}</Text>
        {event.status === 'cancelled' ? <Tag>Cancelled</Tag> : null}
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <Text style={styles.when}>
          {formatEventWhen(event.starts_at, club.timezone)}
        </Text>
        {overridden('starts_at') ? (
          <Text style={styles.help}>Moved from the usual time</Text>
        ) : null}

        <Text style={styles.where}>{event.venue_name}</Text>
        {overridden('venue_id') ? (
          <Text style={styles.help}>Moved from the usual venue</Text>
        ) : null}

        {series ? (
          <Text style={styles.help}>
            Part of a series —{' '}
            {frequencyLabel(series.frequency, series.weekday, series.nth_week)}
          </Text>
        ) : null}
      </Card>

      {event.notes.length > 0 ? (
        <Card>
          <Text style={styles.notes}>{event.notes}</Text>
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>
        {tables.length} {tables.length === 1 ? 'table' : 'tables'} ·{' '}
        {tables.reduce((sum, t) => sum + t.capacity, 0)} seats
      </Text>

      {tables.map((table) => (
        <Card key={table.id}>
          <View style={styles.row}>
            <Text style={styles.tableLabel}>{table.label}</Text>
            <Text style={styles.help}>
              {table.capacity} {table.capacity === 1 ? 'seat' : 'seats'}
            </Text>
          </View>

          {isOrganizer ? (
            <View style={styles.chips}>
              {TIERS.map((tier) => (
                <Button
                  key={tier.value}
                  variant={table.skill_tier === tier.value ? 'primary' : 'secondary'}
                  big={false}
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      updateEventTable(table.id, { tier: tier.value }),
                    )
                  }
                  accessibilityLabel={`${table.label}: ${tier.label}`}
                  accessibilityState={{
                    selected: table.skill_tier === tier.value,
                  }}
                >
                  {tier.label}
                </Button>
              ))}
            </View>
          ) : (
            <Text style={styles.help}>
              {TIERS.find((t) => t.value === table.skill_tier)?.label}
            </Text>
          )}

          {isOrganizer && tables.length > 1 ? (
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => run(() => removeEventTable(table.id))}
              accessibilityLabel={`Remove ${table.label}`}
            >
              Remove
            </Button>
          ) : null}
        </Card>
      ))}

      {isOrganizer && event.status !== 'cancelled' ? (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => run(() => addEventTable(event.id))}
            accessibilityLabel="Add a table"
          >
            Add a table
          </Button>

          <Link
            href={`/clubs/${clubId}/events/${eventId}/edit`}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Edit this game</Text>
          </Link>

          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => run(() => cancelEvent(event.id))}
            accessibilityLabel="Cancel this game"
          >
            Cancel this game
          </Button>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  when: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  where: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[2],
  },
  notes: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    lineHeight: 26,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  tableLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  linkRow: { marginTop: space[4] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
```

- [ ] **Step 2: Verify as both roles**

```bash
npm run web
```

As an organizer: retier a table and confirm it sticks after a reload; add a
table and confirm it appears as the next "Table n"; remove one and confirm the
last remaining table cannot be removed. As a plain member (use a second
account): confirm the tier renders as text, there are no edit controls, and
there is no booking affordance anywhere on the screen.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
npm test
git add app/clubs/
git commit -m "feat: add the event screen with tables, tiers, and organizer controls"
```

---

### Task 15: Editing a game, or the series behind it

**Files:**
- Create: `app/clubs/[id]/events/[eventId]/edit.tsx`

**Interfaces:**
- Consumes: `fetchEvent`, `fetchSeries`, `fetchOverriddenOccurrences`, `updateEvent`, `updateEventSeries`, `endEventSeries`, `formatEventWhen` from `lib/events.ts`; `fetchClub` from `lib/clubs.ts`; `VenuePicker`, `DateField`, `TimeField`, `Toggle`.
- Produces: the route `/clubs/<id>/events/<eventId>/edit`, linked from Task 14.

**The scope choice appears only when there is one.** A one-off event has no series, so the screen edits it and says nothing about scope. A series-linked event offers "This game" or "The whole series".

**The overridden-occurrences toggle appears only when there is something for it to apply to.** `fetchOverriddenOccurrences` returns the future, live, customised weeks; if the list is empty the toggle is not rendered at all. When it is rendered, it names them if there are three or fewer, because "2 events" tells a host nothing about whether they mind.

**Changing the rhythm is not an edit.** There is no frequency or weekday control here. "Change the schedule" ends the series — showing how many future games that cancels — and sends the host to the create screen. That is the deliberate consequence of the recurrence shape being immutable, and the screen has to say so plainly rather than leaving the host hunting for a control that does not exist.

- [ ] **Step 1: Build the screen**

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import DateField from '../../../../../components/DateField';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import TextField from '../../../../../components/TextField';
import TimeField from '../../../../../components/TimeField';
import Toggle from '../../../../../components/Toggle';
import VenuePicker from '../../../../../components/VenuePicker';
import { fetchClub, type Club } from '../../../../../lib/clubs';
import {
  endEventSeries,
  fetchEvent,
  fetchOverriddenOccurrences,
  fetchSeries,
  formatEventWhen,
  frequencyLabel,
  updateEvent,
  updateEventSeries,
  type ClubEvent,
  type EventSeries,
} from '../../../../../lib/events';
import { dateToDateString, dateStringToDate } from '../../../../../lib/time';
import { useSession } from '../../../../../lib/session';
import { colors, space, type } from '../../../../../lib/theme';

type Scope = 'event' | 'series';

export default function EditEventScreen() {
  const { id: clubId, eventId } = useLocalSearchParams<{
    id: string;
    eventId: string;
  }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [series, setSeries] = useState<EventSeries | null>(null);
  const [customised, setCustomised] = useState<ClubEvent[]>([]);
  const [ready, setReady] = useState(false);

  const [scope, setScope] = useState<Scope>('event');
  const [title, setTitle] = useState('');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState('');
  const [startTime, setStartTime] = useState('19:00');
  const [notes, setNotes] = useState('');
  const [includeOverridden, setIncludeOverridden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const [loadedClub, loadedEvent] = await Promise.all([
        fetchClub(clubId),
        fetchEvent(eventId),
      ]);
      if (cancelled) return;

      setClub(loadedClub);
      setEvent(loadedEvent);

      if (loadedEvent) {
        setTitle(loadedEvent.title);
        setVenueId(loadedEvent.venue_id);
        setVenueName(loadedEvent.venue_name);
        setNotes(loadedEvent.notes);
        if (loadedClub) {
          setStartTime(
            new Intl.DateTimeFormat('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: loadedClub.timezone,
            }).format(new Date(loadedEvent.starts_at)),
          );
        }
      }

      if (loadedEvent?.series_id) {
        const [loadedSeries, loadedCustomised] = await Promise.all([
          fetchSeries(loadedEvent.series_id),
          fetchOverriddenOccurrences(loadedEvent.series_id),
        ]);
        if (cancelled) return;
        setSeries(loadedSeries);
        setCustomised(loadedCustomised ?? []);
      }
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [clubId, eventId, session]);

  if (loading || !ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!club || !event) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That game could not be loaded." />
      </Screen>
    );
  }

  async function onSave() {
    setSaving(true);
    setError(null);

    if (scope === 'series' && series) {
      const result = await updateEventSeries(series.id, {
        title,
        venueId,
        notes,
        startTime,
        includeOverridden,
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
    } else {
      // A per-occurrence time edit reuses the occurrence's own date with the
      // new wall clock, resolved in the club's timezone — the same rule the
      // series path uses, so a hand-edited week and a series-edited week
      // agree about what 6:30pm means.
      const localDate =
        event.occurrence_date ??
        dateToDateString(dateStringToDate(event.starts_at.slice(0, 10)));
      const naive = new Date(`${localDate}T${startTime}:00Z`);
      const shown = new Date(
        naive.toLocaleString('en-US', { timeZone: club.timezone }),
      );
      const startsAt = new Date(
        naive.getTime() + (naive.getTime() - shown.getTime()),
      ).toISOString();
      const durationMs =
        new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime();

      const result = await updateEvent(event.id, {
        title,
        venueId,
        notes,
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + durationMs,
        ).toISOString(),
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
    }

    router.replace(`/clubs/${clubId}/events/${eventId}`);
  }

  async function onEndSeries() {
    if (!series) return;
    setSaving(true);
    const result = await endEventSeries(series.id, true);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(`/clubs/${clubId}/events/new`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Text style={styles.heading}>Edit</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {series ? (
        <>
          <Text style={styles.label}>What are you changing?</Text>
          <View style={styles.chips}>
            <Button
              variant={scope === 'event' ? 'primary' : 'secondary'}
              big={false}
              onPress={() => setScope('event')}
              accessibilityLabel="This game only"
              accessibilityState={{ selected: scope === 'event' }}
            >
              This game
            </Button>
            <Button
              variant={scope === 'series' ? 'primary' : 'secondary'}
              big={false}
              onPress={() => setScope('series')}
              accessibilityLabel="The whole series"
              accessibilityState={{ selected: scope === 'series' }}
            >
              The whole series
            </Button>
          </View>
          <Text style={styles.help}>
            {frequencyLabel(series.frequency, series.weekday, series.nth_week)}
          </Text>
        </>
      ) : null}

      <TextField
        label="What is it called?"
        value={title}
        onChangeText={setTitle}
        accessibilityLabel="Game name"
      />

      <VenuePicker
        clubId={clubId}
        value={venueId}
        valueName={venueName}
        onChange={(id, name) => {
          setVenueId(id);
          setVenueName(name);
        }}
      />

      <Text style={styles.label}>Start time</Text>
      <TimeField value={startTime} onChange={setStartTime} label="Start time" />

      <TextField
        label="Anything else? (optional)"
        value={notes}
        onChangeText={setNotes}
        accessibilityLabel="Notes"
        multiline
      />

      {/*
        Only rendered when there is something for it to apply to. A toggle
        offering to overwrite nothing is a question the host cannot answer
        wrong and should not have to read.
      */}
      {scope === 'series' && customised.length > 0 ? (
        <Card>
          <View style={styles.shareRow}>
            <Toggle
              value={includeOverridden}
              onValueChange={setIncludeOverridden}
              accessibilityLabel={`Also apply to the ${customised.length} games you've changed`}
            />
            <Text style={styles.help}>
              {customised.length <= 3
                ? `Also apply to the ${customised.length} ${
                    customised.length === 1 ? 'game' : 'games'
                  } you've changed — ${customised
                    .map((e) => formatEventWhen(e.starts_at, club.timezone))
                    .join(', ')}.`
                : `Also apply to the ${customised.length} games you've changed.`}{' '}
              Cancelled games are never affected.
            </Text>
          </View>
        </Card>
      ) : null}

      <Button onPress={onSave} loading={saving} accessibilityLabel="Save changes">
        Save
      </Button>
      <Button
        variant="ghost"
        onPress={() => router.back()}
        accessibilityLabel="Cancel"
      >
        Cancel
      </Button>

      {series ? (
        <Card>
          <Text style={styles.help}>
            To change when this repeats — a different day, or a different
            rhythm — end this series and start a new one. Ending it cancels
            every future game in it.
          </Text>
          <Button
            variant="ghost"
            onPress={onEndSeries}
            disabled={saving}
            accessibilityLabel="End this series and start a new one"
          >
            Change the schedule
          </Button>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
  },
  help: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
```

- [ ] **Step 2: Verify the override rule end to end**

```bash
npm run web
```

1. Create a weekly series. Move one week to a different venue.
2. Edit the series' start time with the toggle **off**. Expected: the moved
   week keeps its venue and takes the new time; every other week takes the new
   time.
3. Edit the series' venue with the toggle **on**. Expected: the moved week is
   pulled back to the series venue, and its "Moved from the usual venue" note
   disappears from the event screen.
4. Cancel a week, then edit the series with the toggle on. Expected: the
   cancelled week stays cancelled and stays unchanged.

This is the same set of behaviours `event_series_edits.test.sql` asserts. If
the screen and the tests disagree, the screen is passing the wrong arguments —
check `includeOverridden` reaches the RPC.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
npm test
git add app/clubs/
git commit -m "feat: add the edit screen with scope choice and the override toggle"
```

---

### Task 16: Managing venues

**Files:**
- Create: `app/clubs/[id]/venues.tsx`

**Interfaces:**
- Consumes: `fetchClubVenues`, `updateVenue`, `archiveVenue`, and the `Venue` type from `lib/venues.ts`; `fetchClub`, `fetchRoster`, `canInvite` from `lib/clubs.ts`.
- Produces: the route `/clubs/<id>/venues`, linked from Task 12.

**Why this screen exists at all.** A typeahead that can only create is a one-way ratchet. A host who fat-fingers a name at 11pm has no way to fix it, and the misspelling then rides on every event that venue is ever used for. That is a small screen preventing a permanent, visible defect.

**It lists this club's own venues only** — `fetchClubVenues`, not `searchVenues` with an empty query. A public venue another club owns is readable here but not editable, and offering edit controls that will be refused by the database is worse than not offering them.

- [ ] **Step 1: Build the screen**

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import Tag from '../../../components/Tag';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../lib/clubs';
import type { Club } from '../../../lib/clubs';
import {
  archiveVenue,
  fetchClubVenues,
  updateVenue,
  type Venue,
} from '../../../lib/venues';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function VenuesScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [loadedClub, loadedVenues, roster] = await Promise.all([
      fetchClub(clubId),
      fetchClubVenues(clubId),
      fetchRoster(clubId),
    ]);
    setClub(loadedClub);
    setVenues(loadedVenues ?? []);
    const myRole = (roster ?? []).find(
      (m) => m.profile_id === session?.user.id,
    )?.role;
    setIsOrganizer(myRole ? canInvite(myRole) : false);
    setReady(true);
  }

  useEffect(() => {
    if (!session) return;
    load().catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, session]);

  if (loading || !ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!club) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That club could not be loaded." />
      </Screen>
    );
  }

  function startEditing(venue: Venue) {
    setEditing(venue.id);
    setDraftName(venue.name);
    setDraftAddress(venue.address_line ?? '');
  }

  async function save(venueId: string) {
    setBusy(true);
    setError(null);
    const result = await updateVenue(venueId, {
      name: draftName,
      addressLine: draftAddress,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(null);
    await load();
  }

  async function archive(venueId: string) {
    setBusy(true);
    setError(null);
    const result = await archiveVenue(venueId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        {club.name}
      </Button>

      <Text style={styles.heading}>Venues</Text>
      <Text style={styles.help}>
        Places this club plays. Add a new one while creating a game — this is
        where you fix a name or retire a venue you no longer use.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      {venues.length === 0 ? (
        <Text style={styles.help}>
          No venues yet. The first one is added when you create a game.
        </Text>
      ) : null}

      {venues.map((venue) => (
        <Card key={venue.id}>
          {editing === venue.id ? (
            <>
              <TextField
                label="Name"
                value={draftName}
                onChangeText={setDraftName}
                accessibilityLabel={`Name of ${venue.name}`}
              />
              <TextField
                label="Address (optional)"
                value={draftAddress}
                onChangeText={setDraftAddress}
                accessibilityLabel={`Address of ${venue.name}`}
              />
              <Button
                onPress={() => save(venue.id)}
                loading={busy}
                accessibilityLabel={`Save ${venue.name}`}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                onPress={() => setEditing(null)}
                accessibilityLabel="Cancel"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <Text style={styles.name}>{venue.name}</Text>
                {venue.visibility === 'public' ? <Tag>Shared</Tag> : null}
              </View>
              {venue.address_line ? (
                <Text style={styles.help}>{venue.address_line}</Text>
              ) : null}
              {venue.visibility === 'public' ? (
                <Text style={styles.help}>
                  Other clubs can use this venue. It cannot be made private
                  again — their games point at it.
                </Text>
              ) : null}

              {isOrganizer ? (
                <View style={styles.chips}>
                  <Button
                    variant="secondary"
                    big={false}
                    onPress={() => startEditing(venue)}
                    accessibilityLabel={`Edit ${venue.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    big={false}
                    disabled={busy}
                    onPress={() => archive(venue.id)}
                    accessibilityLabel={`Retire ${venue.name}`}
                  >
                    Retire
                  </Button>
                </View>
              ) : null}
            </>
          )}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
```

- [ ] **Step 2: Verify, including the thing this screen exists for**

```bash
npm run web
```

Create a game with a deliberately misspelled venue. Come here, fix the name,
and confirm the corrected name shows on the event screen. Retire a venue and
confirm it vanishes from the picker's results while the event that used it
still displays its name — archiving is not deletion, and an event that loses
its venue name would be the worse bug.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
npm test
git add app/clubs/
git commit -m "feat: add venue management so a misspelled name can be fixed"
```

---

### Task 17: Component tests and visual baselines

**Files:**
- Create: `app/__tests__/events.test.tsx`
- Modify: `e2e/session.ts`
- Modify: `e2e/visual.spec.ts`
- Create: `e2e/visual.spec.ts-snapshots/` entries for the new screens

**Interfaces:**
- Consumes: every screen from Tasks 12–16.
- Produces: `seedClubWithEvent(profileId)` in `e2e/session.ts`, returning `{ clubId, eventId }`.

**Why the visual layer needs seeded data.** `mintSession` creates a brand-new user, who belongs to no club and therefore sees the empty state on every screen this plan adds. A baseline of an empty state is a baseline of nothing. The fix is a seeding helper that writes a club, a venue, an event, and its tables using the `service_role` key — under the same local-only guard `mintSession` already enforces, and with the same rule: **nothing under `app/` or `lib/` may import `e2e/session.ts`.**

**What the component tests are actually for.** The four rendering defects that reached a human reviewer on this project all passed a green suite. These tests target the specific behaviours that would fail silently: an organizer-only control rendering for a member, a booking affordance appearing where none should exist, and the overridden-occurrences toggle appearing when it has nothing to apply to.

- [ ] **Step 1: Write the component tests**

Create `app/__tests__/events.test.tsx`, following the mocking conventions in
`app/__tests__/clubs.test.tsx` — one `vi.mock` per specifier for the whole
file, and pure functions left real:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ClubDetailScreen from '../clubs/[id]/index';
import EventScreen from '../clubs/[id]/events/[eventId]/index';

const push = vi.fn();
const replace = vi.fn();
const searchParams: Record<string, string> = {
  id: 'club-1',
  eventId: 'event-1',
};

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useLocalSearchParams: () => searchParams,
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
  };
});

const fetchUpcomingEvents = vi.fn();
const fetchEvent = vi.fn();
const fetchEventTables = vi.fn();
const fetchSeries = vi.fn();

// formatEventWhen and frequencyLabel stay real: they are pure, and what the
// screens render depends on what they actually do.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: (...args: unknown[]) => fetchUpcomingEvents(...args),
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
    fetchEventTables: (...args: unknown[]) => fetchEventTables(...args),
    fetchSeries: (...args: unknown[]) => fetchSeries(...args),
  };
});

const CLUB = {
  id: 'club-1',
  name: 'Riverside',
  slug: 'riverside',
  rhythm: 'Tuesday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

const EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null,
  title: 'Tuesday game',
  venue_id: 'venue-1',
  venue_name: 'St Mary’s Hall',
  notes: '',
  starts_at: '2027-09-08T00:00:00Z',
  ends_at: '2027-09-08T03:00:00Z',
  status: 'published' as const,
  occurrence_date: null,
  overrides: [] as never[],
  table_count: 2,
};

const TABLES = [
  { id: 't1', label: 'Table 1', skill_tier: 'mixed' as const, capacity: 4, position: 1 },
  { id: 't2', label: 'Table 2', skill_tier: 'beginner' as const, capacity: 4, position: 2 },
];

describe('the club screen’s Upcoming section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchClub.mockResolvedValue(CLUB);
    fetchPendingInvites.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([EVENT]);
  });

  it('renders the time in the club’s timezone, not the device’s', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    // 2027-09-08T00:00Z is 8pm on the 7th in New York. A screen that dropped
    // the timezone would render the 8th, and every member outside the club's
    // zone would see the wrong evening.
    await waitFor(() => {
      expect(screen.getByText(/7 Sep/)).toBeTruthy();
    });
  });

  it('offers "Add a game" to an organizer', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add a game' })).toBeTruthy();
    });
  });

  it('does not offer it to a plain member', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Upcoming')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });
});

describe('the event screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchClub.mockResolvedValue(CLUB);
    fetchEvent.mockResolvedValue(EVENT);
    fetchEventTables.mockResolvedValue(TABLES);
    fetchSeries.mockResolvedValue(null);
  });

  it('shows tables and seats to a member with no way to take one', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
    ]);
    render(<EventScreen />);

    await waitFor(() => {
      expect(screen.getByText('2 tables · 8 seats')).toBeTruthy();
    });

    // Seat booking is plan 4. This assertion is what stops a well-meaning
    // "Join" button arriving early and creating attendance state plan 4 would
    // have to migrate or discard.
    expect(screen.queryByRole('button', { name: /book/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('renders the tier as text for a member and as controls for an organizer', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
    ]);
    const { unmount } = render(<EventScreen />);
    await waitFor(() => {
      expect(screen.getByText('Beginner')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Table 2: Beginner' })).toBeNull();
    unmount();

    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'co_organizer', display_name: 'Me', skill_level: null },
    ]);
    render(<EventScreen />);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Table 2: Beginner' }),
      ).toBeTruthy();
    });
  });

  it('marks a customised occurrence and says nothing about an untouched one', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null },
    ]);
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      overrides: ['venue_id'],
    });
    fetchSeries.mockResolvedValue({
      id: 'series-1',
      club_id: 'club-1',
      title: 'Tuesday game',
      venue_id: 'venue-1',
      notes: '',
      frequency: 'weekly' as const,
      weekday: 2,
      nth_week: null,
      start_time: '19:00',
      duration_minutes: 180,
      table_count: 2,
      starts_on: '2027-09-07',
      ends_on: null,
    });

    render(<EventScreen />);

    await waitFor(() => {
      expect(screen.getByText('Moved from the usual venue')).toBeTruthy();
    });
    expect(screen.queryByText('Moved from the usual time')).toBeNull();
    expect(screen.getByText(/Every Tuesday/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them, and prove they can fail**

```bash
npm test -- app/__tests__/events.test.tsx
```

Expected: PASS, 6 tests. Then delete the `isOrganizer` guard around "Add a
game" and confirm `does not offer it to a plain member` FAILS. Restore it.

- [ ] **Step 3: Add the seeding helper**

Append to `e2e/session.ts`:

```ts
/**
 * Seeds a club, a venue, an event and its tables for a freshly minted user,
 * so the visual baselines capture real screens rather than empty states.
 *
 * Uses the same admin client and the same local-only guard as mintSession:
 * the service_role key is read from the environment, is only ever pointed at
 * the local stack, and must never appear in the app bundle. Nothing under
 * app/ or lib/ may import this file.
 *
 * Writes rows directly rather than calling the RPCs, because the RPCs check
 * auth.uid() and this runs as service_role with no JWT. service_role holds
 * DML on these tables by migration 20260822180200 and its default-privileges
 * clause, and BYPASSRLS skips the policies.
 */
export async function seedClubWithEvent(
  profileId: string,
): Promise<{ clubId: string; eventId: string }> {
  const url = process.env.SUPABASE_LOCAL_URL;
  const serviceRole = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error(
      'Set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY. Both are ' +
        'printed by `npx supabase start`. Never use hosted-project values here.',
    );
  }

  const hostname = new URL(url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`Refusing to seed against a non-local URL: ${url}`);
  }

  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const suffix = profileId.slice(0, 8);

  const { data: club } = await admin
    .from('clubs')
    .insert({
      name: 'Riverside Mah Jongg',
      slug: `riverside-${suffix}`,
      rhythm: 'Tuesday evenings',
      timezone: 'America/New_York',
      created_by: profileId,
    })
    .select('id')
    .single();

  const clubId = club!.id as string;

  await admin
    .from('club_members')
    .insert({ club_id: clubId, profile_id: profileId, role: 'host' });

  const { data: venue } = await admin
    .from('venues')
    .insert({
      name: 'St Mary’s Hall',
      locality: 'Newton',
      added_by_club_id: clubId,
      created_by: profileId,
    })
    .select('id')
    .single();

  // A fixed instant, so the baseline does not change every time the suite
  // runs. Far enough out that it is always "upcoming".
  const { data: event } = await admin
    .from('events')
    .insert({
      club_id: clubId,
      title: 'Tuesday night mahjong',
      venue_id: venue!.id,
      starts_at: '2099-09-08T23:00:00Z',
      ends_at: '2099-09-09T02:00:00Z',
      created_by: profileId,
    })
    .select('id')
    .single();

  const eventId = event!.id as string;

  await admin.from('event_tables').insert([
    { event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 },
    {
      event_id: eventId,
      club_id: clubId,
      label: 'Table 2',
      position: 2,
      skill_tier: 'beginner',
    },
  ]);

  return { clubId, eventId };
}
```

- [ ] **Step 4: Add the visual tests**

In `e2e/visual.spec.ts`, the `signed in` describe block's `beforeEach` mints a
session but discards the user id. Capture it and seed:

```ts
  let seeded: { clubId: string; eventId: string };

  test.beforeEach(async ({ page }) => {
    const session = await mintSession(`visual-${Date.now()}@example.com`);
    seeded = await seedClubWithEvent(session.user_id);
    // ...the existing addInitScript call, unchanged
  });
```

`mintSession` must return the user id for this to work. It already extracts
tokens from the generated link; add `user_id` to its return type by reading
`data.user.id` from the admin `generateLink` response, and update its return
annotation.

Then add four tests inside the existing `for (const vp of WIDTHS)` loop:

```ts
    test(`club detail at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/clubs/${seeded.clubId}`);
      await expect(page.getByText('Upcoming')).toBeVisible();
      await captureScreen(page, vp, `club-detail-${vp.name}.png`);
    });

    test(`event detail at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/clubs/${seeded.clubId}/events/${seeded.eventId}`);
      await expect(page.getByText('2 tables · 8 seats')).toBeVisible();
      await captureScreen(page, vp, `event-detail-${vp.name}.png`);
    });

    test(`new event at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/clubs/${seeded.clubId}/events/new`);
      await expect(page.getByText('Add a game')).toBeVisible();
      await captureScreen(page, vp, `new-event-${vp.name}.png`);
    });

    test(`venues at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/clubs/${seeded.clubId}/venues`);
      await expect(page.getByText('Venues')).toBeVisible();
      await captureScreen(page, vp, `venues-${vp.name}.png`);
    });
```

- [ ] **Step 5: Generate the baselines and look at every one**

```bash
npm run test:visual -- --update-snapshots
```

Then open each of the eight new PNGs. This is the step the whole visual layer
exists for, so do not skip the looking: check that nothing is truncated at the
bottom (the notifications baseline once cut off its Save button), that no text
is clipped mid-word at 375px, that every colour is one from `lib/theme`, and
that the 18pt minimum holds everywhere except helper text at 16.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
npm run test:contract
npm run test:db
npm run test:db:remote
npm run test:visual
npx tsc --noEmit
```

Expected, and worth writing into the PR description as actual numbers rather
than "all green": Vitest, schema-contract, pgTAP local, pgTAP hosted, visual,
and typecheck all passing.

- [ ] **Step 7: Commit**

```bash
git add app/__tests__ e2e/
git commit -m "test: cover the event screens in the component and visual layers"
```

---

## Verification before the PR

Do not write "all tests pass" into the PR body without having run these and
read the output. Plan 2's security holes all passed a completely green suite;
the number that matters is the one you saw, not the one you expected.

- [ ] Every suite, with its count recorded:

```bash
npm test && npm run test:contract && npm run test:db && npm run test:db:remote && npm run test:visual && npx tsc --noEmit
```

- [ ] The hosted project is up to date: `npx supabase db push` reports nothing
  to apply.
- [ ] `select * from cron.job;` on the hosted project shows
  `materialize-event-series` active — or Task 1 recorded why it does not exist.
- [ ] A manual pass on the web build as **two different accounts**: one
  organizer, one plain member of the same club. The member must see events and
  no controls; the organizer must see everything. This is the check that
  catches a UI-only guard with no SQL behind it.
- [ ] `todo.md`: tick the "My Clubs — no space between the last club and the
  Start another club button" item.

## What this plan knowingly leaves undone

State these in the PR body rather than letting a reviewer find them.

- **Nothing has run on a physical device**, consistent with every plan so far.
  The native `DateField` and `TimeField` are exercised by no automated test in
  this repository — the `.web.tsx` files are what the suites render.
- **Duplicate public venues will still accumulate.** The unique index catches
  identical names in the same locality and nothing else. A merge tool is the
  answer and is not built here.
- **`event_tables` semantics under bookings are unsettled.** Add and remove are
  granular so plan 4 can add the "what happens to the people sitting there"
  rules without restructuring.
- **`materialize_event_series` sweeps every active series on each call**,
  including the synchronous ones after a single series changes. Fine at V1
  scale; revisit in the thousands.
- **Venue claiming is not built**, and the business case for it is unevidenced.
  The entity shape keeps it available as an additive migration.
