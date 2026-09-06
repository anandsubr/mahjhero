# Open-Seating Events & Payment Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer run a 60–70 player event without pre-assigning tables — signup, check-in and paid/unpaid tracking, with tables and capacity both optional.

**Architecture:** Additive throughout. A `seating_mode` enum on `event_series`/`events` follows the exact template→materialization→override path `game_mode` and `fee_cents` already use. Capacity stops being derived-only: `event_capacity` branches on the mode, and a new `event_is_capped` predicate lets `plan_seating` skip its capacity gate entirely for uncapped events. Payment is a new `event_payments` table shaped like `check_ins`, organizer-only by RLS, written by a definer RPC — no money ever moves through the app.

**Tech Stack:** Postgres/Supabase migrations + pgTAP, TypeScript data layer (`lib/`), Expo Router + React Native screens, Playwright visual regression.

## Global Constraints

From `docs/superpowers/specs/2026-09-06-open-seating-and-payment-tracking-design.md`. Every task's requirements implicitly include these.

- **Nothing existing changes behavior.** Every new column is `not null default 'assigned_tables'` (or nullable for `capacity`), so every existing club, series and event keeps today's behavior exactly.
- **No money moves through the app.** `event_payments` stores a marker and a timestamp. No amounts, no processing, no refunds.
- **Paid status is organizer-only.** A player must never be able to read `event_payments`, by RLS or by RPC. This is the single most important security property in the plan.
- **Mode switching is non-destructive.** Switching to `open_seating` must never delete `event_tables` rows nor null any booking's `event_table_id`.
- **Migration conventions** (from the existing codebase, follow exactly): `language plpgsql` + `security definer` + `set search_path = public` for mutations; `language sql` + `stable` + `set search_path = public` for read helpers. ACLs are **always restated** after `create or replace` — `revoke ... from public, anon;` then `grant ... to authenticated;` with the full argument type list repeated. Internal helpers are additionally revoked from `authenticated`. A **signature change requires `drop function` then `create function`**, never `create or replace`. Errors: `raise exception 'lowercase message' using errcode = '23514'` (check), `'P0002'` (not found), `'42501'` (permission).
- **New migration filenames** start at `20260906100000` — the latest existing migration is `20260905180000_accept_invite_revoke_public.sql`.
- **Existing migrations are immutable. Never edit one.** Several tasks redefine functions that were first defined in older migrations (`plan_seating`, `event_capacity`, `remove_event_table`, `materialize_one_series`, `reset_event_to_series`). In every case: read the old file as your source, then put a `create or replace` (unchanged signature) or `drop function` + `create function` (changed signature) in your **new** migration file. A change made to an already-applied migration file will not re-run on any database that has it, so it would work locally after a `db reset` and silently do nothing in dev or prod.
- **Every new client-callable RPC requires three coordinated edits to `supabase/tests/database/portable/grants.test.sql`**: bump `select plan(N)`, append the signature to **both** allowlist arrays (Direction 1 at 7-space indent, Direction 2 at 9-space indent), and add named positive/negative `has_function_privilege` assertions. Missing any one fails the suite.
- **There is deliberately NO club-level default for `seating_mode`.** `game_mode` has `clubs.default_game_mode`; this does not. Do not add one — it was not asked for and is not in the spec.
- **`capacity` is deliberately NOT constrained to open-seating events.** It is simply ignored in `assigned_tables` mode, so that toggling modes back and forth preserves the number the organizer typed. Do not add a cross-column check forbidding it.

---

### Task 1: Schema — seating mode, capacity, override key

**Files:**
- Create: `supabase/migrations/20260906100000_seating_mode_and_capacity.sql`
- Create: `supabase/tests/database/portable/seating_mode_schema.test.sql`

**Interfaces:**
- Produces: the `public.seating_mode` enum (`'assigned_tables' | 'open_seating'`); `event_series.seating_mode`, `event_series.capacity`, `events.seating_mode`, `events.capacity`; the `'seating_mode'` and `'capacity'` keys added to `events_overrides_known_keys`; and a relaxed `event_series_table_count_check` permitting 0 under `open_seating`. Every later task depends on these names.

- [ ] **Step 1: Write the failing schema test**

Create `supabase/tests/database/portable/seating_mode_schema.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(10);

select has_column('public', 'events', 'seating_mode', 'events has seating_mode');
select has_column('public', 'events', 'capacity', 'events has capacity');
select has_column('public', 'event_series', 'seating_mode',
  'event_series has seating_mode');
select has_column('public', 'event_series', 'capacity',
  'event_series has capacity');

select col_type_is('public', 'events', 'seating_mode', 'seating_mode',
  'events.seating_mode is the seating_mode enum');

-- Exactly two values. A third would mean somebody added a mode the design
-- did not ask for.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'seating_mode'),
  array['assigned_tables', 'open_seating'],
  'seating_mode has exactly assigned_tables and open_seating');

-- Existing rows must be untouched: the default backfills them.
select col_default_is('public', 'events', 'seating_mode', 'assigned_tables',
  'events.seating_mode defaults to assigned_tables');
select col_is_null('public', 'events', 'capacity',
  'events.capacity is nullable — null means uncapped');

-- Both new override keys are registered, or update_event cannot write them.
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'events_overrides_known_keys')
  like '%seating_mode%',
  'seating_mode is an allowed override key');
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'events_overrides_known_keys')
  like '%capacity%',
  'capacity is an allowed override key');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: the new file fails — `has_column` reports `events.seating_mode` missing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260906100000_seating_mode_and_capacity.sql`:

```sql
/*
 * Optional tables, for the 60-70 player event.
 *
 * An organizer running that many people cannot pre-assign tables — who
 * turns up is not known until the door — but still needs signup, check-in
 * and payment. So seating becomes a per-event mode carried the same way
 * check_in_required, fee_cents and game_mode already are: template
 * (event_series) -> materialization (events) -> per-occurrence override
 * tracked in events.overrides.
 *
 * Deliberately NO clubs.default_seating_mode. game_mode has a club default
 * because a club is either an open-play club or an invite-only one; how a
 * given night seats people is a property of that night, and the design
 * research found it genuinely varies event to event within one club.
 *
 * `capacity` is nullable and means "the headcount limit", used ONLY when
 * seating_mode = 'open_seating' (assigned_tables keeps deriving capacity by
 * summing event_tables, exactly as today). Null means uncapped. It is
 * deliberately NOT constrained to open-seating rows: an organizer who
 * toggles to assigned_tables and back should find their number still there
 * rather than having it destroyed by a mode switch.
 */
create type public.seating_mode as enum ('assigned_tables', 'open_seating');

alter table public.event_series
  add column seating_mode public.seating_mode not null
    default 'assigned_tables',
  add column capacity int check (capacity is null or capacity > 0);

alter table public.events
  add column seating_mode public.seating_mode not null
    default 'assigned_tables',
  add column capacity int check (capacity is null or capacity > 0);

/*
 * Two more override keys. Dropped and re-added rather than altered: a check
 * constraint's expression cannot be modified in place (same reasoning
 * 20260827000000 already documents for this exact constraint).
 */
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required', 'fee_cents', 'min_spend_cents',
                       'game_mode', 'seating_mode', 'capacity']
    and array_ndims(overrides) = 1
  );

/*
 * An open-seating series may materialize zero tables. The original check was
 * written inline and unnamed, so Postgres auto-named it
 * event_series_table_count_check; it is dropped by that name and replaced
 * with a mode-aware table-level constraint. assigned_tables keeps its
 * "at least one" floor untouched.
 */
alter table public.event_series
  drop constraint event_series_table_count_check;

alter table public.event_series
  add constraint event_series_table_count_check check (
    case when seating_mode = 'open_seating'
         then table_count between 0 and 20
         else table_count between 1 and 20
    end
  );
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: `seating_mode_schema.test.sql` passes 10/10, and no previously-passing test regresses.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906100000_seating_mode_and_capacity.sql supabase/tests/database/portable/seating_mode_schema.test.sql
git commit -m "feat(db): add seating_mode and capacity to events and series"
```

---

### Task 2: Capacity resolution and the booking gate

**Files:**
- Create: `supabase/migrations/20260906110000_capacity_resolution.sql`
- Create: `supabase/tests/database/fixtures/open_seating_capacity.test.sql`

**Interfaces:**
- Consumes: `events.seating_mode`, `events.capacity` (Task 1).
- Produces: `public.event_is_capped(uuid) returns boolean` (internal, granted to nobody); a redefined `public.event_capacity(uuid)` that branches on mode; and a `plan_seating` whose capacity gate is skipped for uncapped events. Task 9's UI depends on uncapped events never waitlisting anyone.

- [ ] **Step 1: Audit every caller of the capacity helpers before changing them**

Run: `grep -rn "event_free_seats\|event_capacity" supabase/migrations/ lib/ app/`
Read each hit. Record in your report which callers exist and confirm for each whether it needs the uncapped branch. `plan_seating` is the one this task changes; if the audit finds another caller that would misbehave when `event_capacity` returns 0 for an uncapped event (for example a display of "N seats left"), name it in your report — do **not** silently fix it here, it belongs to the UI tasks.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/database/fixtures/open_seating_capacity.test.sql`. Follow the fixture style of `supabase/tests/database/fixtures/check_in_rls.test.sql` for seeding (explicit uuids, `insert into auth.users` first, then clubs/club_members/venues/events).

```sql
begin;
set local search_path to extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000031', 'host31@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000031', 'Cap Club', 'cap-club',
          'America/New_York', 'a0000000-0000-0000-0000-000000000031');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000031',
   'a0000000-0000-0000-0000-000000000031', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000031',
          'b0000000-0000-0000-0000-000000000031', 'Hall',
          'a0000000-0000-0000-0000-000000000031');

-- Three events: today's behavior, capped open seating, uncapped open seating.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by)
values
  ('d0000000-0000-0000-0000-000000000031',
   'b0000000-0000-0000-0000-000000000031', 'Assigned',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'assigned_tables', null, 'a0000000-0000-0000-0000-000000000031'),
  ('d0000000-0000-0000-0000-000000000032',
   'b0000000-0000-0000-0000-000000000031', 'Capped open',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'open_seating', 60, 'a0000000-0000-0000-0000-000000000031'),
  ('d0000000-0000-0000-0000-000000000033',
   'b0000000-0000-0000-0000-000000000031', 'Uncapped open',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'open_seating', null, 'a0000000-0000-0000-0000-000000000031');

-- The assigned event keeps deriving from tables, exactly as before.
insert into public.event_tables (event_id, club_id, label, position)
values ('d0000000-0000-0000-0000-000000000031',
        'b0000000-0000-0000-0000-000000000031', 'Table 1', 1);

select is(public.event_capacity('d0000000-0000-0000-0000-000000000031'), 4,
  'assigned_tables still sums event_tables');
select is(public.event_capacity('d0000000-0000-0000-0000-000000000032'), 60,
  'capped open seating uses the explicit capacity');

select ok(public.event_is_capped('d0000000-0000-0000-0000-000000000031'),
  'an assigned-tables event is capped');
select ok(public.event_is_capped('d0000000-0000-0000-0000-000000000032'),
  'open seating with a number is capped');
select ok(not public.event_is_capped('d0000000-0000-0000-0000-000000000033'),
  'open seating with no number is uncapped');

-- The whole point: with zero tables and no cap, a booking is SEATED, not
-- waitlisted. Under the old derived-capacity rule this returned 'waitlisted'
-- because capacity was 0.
select is(
  public.plan_seating('d0000000-0000-0000-0000-000000000033',
                      array['a0000000-0000-0000-0000-000000000031'::uuid],
                      null, true) ->> 'outcome',
  'seated',
  'an uncapped open-seating event seats rather than waitlists');

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: fails — `function public.event_is_capped(uuid) does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260906110000_capacity_resolution.sql`:

```sql
/*
 * Capacity stops being derived-only.
 *
 * Until now capacity was always sum(event_tables.capacity), which is exactly
 * why a tableless event was unreachable: zero tables meant zero capacity, and
 * plan_seating's gate waitlisted everybody. An open-seating event carries its
 * own headcount instead, and may carry none at all.
 *
 * "Uncapped" is a SEPARATE PREDICATE, not a magic value. Returning null from
 * event_free_seats to mean unbounded would have worked only because SQL's
 * `null < n` is null and therefore not-true — correct by accident, unreadable,
 * and it would silently change the meaning of the function for every other
 * caller. A large sentinel integer can be confused with a real number in
 * arithmetic. So: event_free_seats keeps its integer contract untouched, and
 * plan_seating asks event_is_capped first.
 */
create or replace function public.event_capacity(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when e.seating_mode = 'open_seating' then coalesce(e.capacity, 0)
    else coalesce(
      (select sum(t.capacity)::int from public.event_tables t
        where t.event_id = e.id), 0)
  end
  from public.events e
  where e.id = target_event;
$$;

/*
 * coalesce(..., true): a target_event that does not exist yields no row and
 * therefore null, and the safe reading of "I cannot tell" is "capped" — that
 * routes an unknown event through the normal capacity gate rather than
 * admitting an unbounded number of people to it.
 */
create function public.event_is_capped(target_event uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select not (e.seating_mode = 'open_seating' and e.capacity is null)
       from public.events e where e.id = target_event),
    true);
$$;

-- Internal, like every other member of the capacity family
-- (20260825000000, 20260825061000): granted to nobody. Handing this to
-- authenticated would be an occupancy oracle for a club they are not in.
revoke execute on function public.event_is_capped(uuid)
  from public, anon, authenticated;

-- event_capacity's ACL is restated after create or replace, per the house
-- rule; it stays revoked from authenticated too.
revoke execute on function public.event_capacity(uuid)
  from public, anon, authenticated;
```

- [ ] **Step 5: Edit `plan_seating`'s capacity gate**

`plan_seating` is defined once, at `supabase/migrations/20260825020000_booking_mutations.sql:90-169`. Its signature is unchanged, so append a `create or replace` of the whole function to the **same new migration file** (`20260906110000_capacity_resolution.sql`). Copy the body verbatim from `20260825020000_booking_mutations.sql:104-169` and change **only** the gate at lines 131–137, from:

```sql
  if public.event_free_seats(target_event) < n then
```

to:

```sql
  if public.event_is_capped(target_event)
     and public.event_free_seats(target_event) < n then
```

Keep the existing comment above the gate and add one line to it explaining the new short-circuit. Then restate the ACL at the end of the file:

```sql
revoke execute on function
  public.plan_seating(uuid, uuid[], uuid, boolean)
  from public, anon, authenticated;
```

- [ ] **Step 6: Run the tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: `open_seating_capacity.test.sql` passes 6/6. **Every existing booking test must still pass** — `bookings_commit.test.sql`, `bookings_cancellation.test.sql`, and the waitlist tests are the regression surface for this change. Report their counts explicitly.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260906110000_capacity_resolution.sql supabase/tests/database/fixtures/open_seating_capacity.test.sql
git commit -m "feat(db): resolve capacity by seating mode, skip the gate when uncapped"
```

---

### Task 3: Thread seating mode through event creation and table removal

**Files:**
- Create: `supabase/migrations/20260906120000_seating_mode_create.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Create: `supabase/tests/database/fixtures/open_seating_create.test.sql`

**Interfaces:**
- Consumes: the enum and columns from Task 1; `event_is_capped` is not needed here.
- Produces: `create_event(uuid, text, uuid, text, date, time, int, int, boolean, int, int, public.game_mode, public.seating_mode, int)` and `create_event_series(...)` with the same two new trailing arguments (`event_seating_mode`/`series_seating_mode` and `capacity_limit`). Task 10's form sends these.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/open_seating_create.test.sql` asserting: (a) `create_event` with `event_seating_mode => 'open_seating', table_count => 0` succeeds and creates **zero** `event_tables` rows; (b) the same call with `'assigned_tables'` and `table_count => 0` raises `23514`; (c) a negative `capacity_limit` raises `23514`. Seed a club/venue/host the same way Task 2's fixture does, and call the RPC as the host via `set local role authenticated` + `set local request.jwt.claims to '{"sub":"<host uuid>","role":"authenticated"}'`.

```sql
select lives_ok(
  $$select public.create_event(
      'b0000000-0000-0000-0000-000000000041'::uuid, 'Big night',
      'c0000000-0000-0000-0000-000000000041'::uuid, '',
      (current_date + 7), '19:00'::time, 180, 0, true, 0, 0, null,
      'open_seating'::public.seating_mode, 60)$$,
  'an open-seating event may be created with zero tables');

select throws_ok(
  $$select public.create_event(
      'b0000000-0000-0000-0000-000000000041'::uuid, 'Bad night',
      'c0000000-0000-0000-0000-000000000041'::uuid, '',
      (current_date + 7), '19:00'::time, 180, 0, true, 0, 0, null,
      'assigned_tables'::public.seating_mode, null)$$,
  '23514', null,
  'an assigned-tables event still requires at least one table');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: fails — no `create_event` overload accepts 14 arguments.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260906120000_seating_mode_create.sql`. Because the signature changes, both functions are **dropped and recreated** (not `create or replace`), following `20260905110000_event_game_mode_mutations.sql` exactly.

Drop the current signatures first:

```sql
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode);

drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int, public.game_mode);
```

Recreate `create_event` with the body from `20260905110000_event_game_mode_mutations.sql:20-105` **verbatim**, plus these changes only:

1. Two new trailing arguments:
   ```sql
     event_seating_mode public.seating_mode default 'assigned_tables',
     capacity_limit     int default null
   ```
   (Named `capacity_limit`, not `capacity` — a parameter named `capacity` would shadow the `event_tables.capacity` column referenced in the table-insert below.)
2. Replace the table-count validation:
   ```sql
     if event_seating_mode = 'open_seating' then
       if table_count < 0 or table_count > 20 then
         raise exception 'table count out of range' using errcode = '23514';
       end if;
     else
       if table_count < 1 or table_count > 20 then
         raise exception 'table count out of range' using errcode = '23514';
       end if;
     end if;

     if capacity_limit is not null and capacity_limit < 1 then
       raise exception 'capacity must be at least one' using errcode = '23514';
     end if;
   ```
3. Add `seating_mode, capacity` to the `insert into public.events` column list and `event_seating_mode, capacity_limit` to its values list.
4. The trailing `insert into public.event_tables ... generate_series(1, table_count)` needs **no change** — `generate_series(1, 0)` yields no rows, so zero tables falls out naturally. Add a one-line comment saying so, or a future reader will "fix" it.

Then restate the ACLs with the full new type list:

```sql
revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  to authenticated;
```

Do the same for `create_event_series` (body from `20260905110000:313-367+`), adding `series_seating_mode public.seating_mode default 'assigned_tables'` and `capacity_limit int default null`, writing both into the `event_series` insert.

- [ ] **Step 4: Relax `remove_event_table`'s last-table guard**

The spec requires the "an event must keep at least one table" floor to apply to `assigned_tables` only — an open-seating organizer must be able to remove every table.

> **Never edit `20260825040000_event_disruption.sql` or any other existing migration.** Applied migrations are immutable — a change to one will not re-run on any database that already has it. Read the current definition there (`:16-96`) as your source, then append a **`create or replace`** of the whole function to the **new** file, `20260906120000_seating_mode_create.sql`. Its signature is unchanged, so `create or replace` is correct here (not drop-and-recreate). Copy the body verbatim and change **only** the guard.

Add `ev_seating public.seating_mode;` to the `declare` block, select it alongside the existing fields:

```sql
  select t.club_id, t.event_id, e.status, e.seating_mode
  into owning_club, owning_event, event_status, ev_seating
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;
```

and gate the existing raise:

```sql
  -- An open-seating event's capacity does not come from tables, so there is
  -- no floor to protect: removing the last one is legitimate. The unseat-
  -- never-destroy rule below still applies either way.
  if ev_seating = 'assigned_tables' and remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;
```

Everything below that — the unseat, the `notification_outbox` insert, the `booking_groups` null-out, the delete, and the `promote_waitlist` call — stays exactly as it is. Restate the ACL:

```sql
revoke execute on function public.remove_event_table(uuid) from public, anon;
grant  execute on function public.remove_event_table(uuid) to authenticated;
```

Add to `open_seating_create.test.sql`: removing the only table succeeds on an open-seating event and still raises `23514` on an assigned-tables one, and in both cases any confirmed booking at that table is left with `event_table_id = null` rather than deleted.

- [ ] **Step 5: Update the grants allowlist**

In `supabase/tests/database/portable/grants.test.sql`, the two `create_event`/`create_event_series` signature strings are now stale and the test will fail in **both** directions. Replace them in **both** arrays (Direction 1 at 7-space indent ~line 682-768, Direction 2 at 9-space indent ~line 770-855) with:

```
'public.create_event(uuid, text, uuid, text, date, time, int, int, boolean, int, int, public.game_mode, public.seating_mode, int)',
'public.create_event_series(uuid, text, uuid, text, public.series_frequency, smallint, smallint, time, int, int, date, date, boolean, int, int, public.game_mode, public.seating_mode, int)',
```

The plan count does not change in this task (signatures replaced, none added).

- [ ] **Step 6: Run the tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: the new fixture passes, and `grants.test.sql` passes 114/114. If grants fails, the signature string does not match what `to_regprocedure` resolves — read the failure, which names the one offending signature. `event_disruption.test.sql` covers `remove_event_table` today and must still pass — report its count.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260906120000_seating_mode_create.sql supabase/tests/database/portable/grants.test.sql supabase/tests/database/fixtures/open_seating_create.test.sql
git commit -m "feat(db): accept seating mode and capacity when creating events

Also relaxes remove_event_table's last-table floor for open-seating
events, whose capacity does not come from tables."
```

---

### Task 4: Thread seating mode through edit, materialization and reset

**Files:**
- Create: `supabase/migrations/20260906130000_seating_mode_propagation.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Create: `supabase/tests/database/fixtures/open_seating_propagation.test.sql`

**Interfaces:**
- Consumes: Task 1's columns and override keys; Task 3's created events.
- Produces: `update_event` and `update_event_series` with two new trailing arguments each, a `materialize_one_series` that carries both new fields onto each occurrence, and a `reset_event_to_series` that restores them.

**This task also fixes a pre-existing bug.** `reset_event_to_series` (last defined `20260903180000_reset_event_to_series_all_fields.sql:52-63`) was never updated when `game_mode` was added by `20260905060000`. So resetting an occurrence whose `game_mode` was overridden clears `overrides` to `'{}'` while leaving the stale overridden `game_mode` in place — exactly the bug `20260903180000`'s own header describes for `fee_cents`. Adding `seating_mode`/`capacity` to that function without also adding `game_mode` would ship a third instance of it, so all three are fixed in the same `update` list.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/open_seating_propagation.test.sql` asserting:

1. **Non-destructive mode switch** — the Global Constraint. Create an assigned-tables event with 2 tables and a confirmed booking holding an `event_table_id`; `update_event(... 'open_seating' ...)`; assert the `event_tables` row count is still 2 and the booking's `event_table_id` is unchanged; switch back and assert the same again.
   ```sql
   select is(
     (select count(*)::int from public.event_tables
       where event_id = 'd0000000-0000-0000-0000-000000000051'),
     2,
     'switching to open seating does not delete tables');
   select is(
     (select event_table_id from public.bookings
       where id = 'e0000000-0000-0000-0000-000000000051'),
     'f0000000-0000-0000-0000-000000000051'::uuid,
     'switching to open seating does not unseat anybody');
   ```
2. **Override is recorded** — after `update_event` changes only `seating_mode` on a series occurrence, `'seating_mode' = any(overrides)` is true.
3. **Series edit respects the override** — `update_event_series(..., include_overridden => false)` changing `seating_mode` leaves the overridden occurrence alone and updates the untouched one.
4. **Reset restores all three fields** — override an occurrence's `seating_mode`, `capacity` and `game_mode`, call `reset_event_to_series`, and assert all three now equal the series' values and `overrides` is `'{}'`. This assertion is what pins the pre-existing `game_mode` bug closed.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: fails — `update_event` has no overload accepting the new arguments.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260906130000_seating_mode_propagation.sql` containing four function definitions, each copied verbatim from its current definition and extended:

**a. `materialize_one_series`** — signature unchanged, so `create or replace`. Body from `20260905060000_game_mode.sql:44-127`, adding `seating_mode, capacity` to the `insert into public.events` column list and `s.seating_mode, s.capacity` to its values. The `generate_series(1, s.table_count)` table insert needs no change (0 yields no rows).

**b. `update_event`** — signature changes, so `drop function` + `create function`. Body from `20260905110000_event_game_mode_mutations.sql`, adding `new_seating_mode public.seating_mode default null` and `new_capacity int default null` as trailing arguments, an `eff_seating`/`eff_capacity` resolution alongside the existing `eff_*` variables, two more `array_append` blocks in the overrides section:

```sql
    if new_seating_mode is not null
       and new_seating_mode is distinct from ev.seating_mode then
      next_overrides := array_append(next_overrides, 'seating_mode');
    end if;
    if new_capacity is distinct from ev.capacity then
      next_overrides := array_append(next_overrides, 'capacity');
    end if;
```

and `seating_mode = eff_seating, capacity = eff_capacity` in the final `update public.events set`.

> **Note on `capacity`'s null semantics.** Every other `new_*` argument uses `null` to mean "not supplied". `capacity`'s own null means "uncapped", so those two readings collide. Resolve it by giving `update_event` a separate `clear_capacity boolean default false` argument: when true, capacity is set to null; otherwise a null `new_capacity` means "leave alone". Do not overload null to mean both.

**c. `update_event_series`** — signature changes, so `drop function` + `create function`. Add the same two arguments plus `clear_capacity`, a `touched_seating_mode`/`touched_capacity` pair computed against the `se` snapshot, two more propagation `update public.events` blocks following the `touched_game_mode` block verbatim in shape, and two more clauses in the `include_overridden` override-clearing `unnest`.

**d. `reset_event_to_series`** — signature unchanged, so `create or replace`. Body from `20260903180000_reset_event_to_series_all_fields.sql:26-71`, adding **three** assignments to the `update public.events set` list:

```sql
    game_mode          = se.game_mode,
    seating_mode       = se.seating_mode,
    capacity           = se.capacity,
```

with a comment recording that `game_mode` was missing before this migration and why.

Restate every ACL at the end of the file, full type lists repeated.

- [ ] **Step 4: Update the grants allowlist**

Replace the `update_event` and `update_event_series` signature strings in **both** arrays of `supabase/tests/database/portable/grants.test.sql` with their new type lists. Plan count unchanged.

- [ ] **Step 5: Run the tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: the new fixture passes; `grants.test.sql` passes; the existing series tests (`event_series*.test.sql`, `check_in_flag.test.sql` — which pins per-occurrence override scoping) still pass. Report their counts.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906130000_seating_mode_propagation.sql supabase/tests/database/portable/grants.test.sql supabase/tests/database/fixtures/open_seating_propagation.test.sql
git commit -m "feat(db): propagate seating mode through edit, materialize and reset

Also fixes a pre-existing bug: reset_event_to_series never restored
game_mode, so resetting an occurrence cleared its overrides while leaving
the stale overridden value in place."
```

---

### Task 4A: Make waitlist promotion uncapped-aware

**Added during execution.** Task 2's mandated audit of `event_free_seats` callers found this, and Task 4 is what makes it reachable.

**Files:**
- Create: `supabase/migrations/20260906135000_waitlist_uncapped.sql`
- Create: `supabase/tests/database/fixtures/uncapped_waitlist.test.sql`

**Interfaces:**
- Consumes: `event_is_capped` (Task 2), capacity editing (Task 4).
- Produces: a `promote_waitlist` and `accept_promotion_offer` that treat an uncapped event as having unlimited room.

**The bug this closes.** `event_free_seats` is `greatest(0, capacity − confirmed − held)`, and `event_capacity` now returns 0 for an uncapped open-seating event. So `event_free_seats` reports **0 free seats forever** on an event that actually has unlimited room. Two callers trust that number:

- `promote_waitlist` (current definition: `supabase/migrations/20260825090000_promote_waitlist_stops_regenerating_lapsed_offers.sql:89`) exits its loop on `free <= 0`, so it would promote nobody.
- `accept_promotion_offer` (`supabase/migrations/20260825100000_accept_promotion_offer_capacity_guard.sql:89`) computes `least(o.offered_seat_count, event_free_seats(o.event_id))`, which clamps every offer to zero seats.

This was unreachable when Task 2 shipped, because an uncapped event can never *newly* waitlist anyone. Task 4 makes it reachable: an organizer caps an event at 20, five people waitlist, the organizer then clears the cap — and those five are stranded permanently. Switching a full `assigned_tables` event with a waitlist over to uncapped open seating does the same.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/uncapped_waitlist.test.sql`. Seed an `open_seating` event with `capacity = 2`, confirm two bookings, and waitlist a third person. Then clear the cap (`update public.events set capacity = null where id = ...` — direct SQL is fine here; this test is about the promotion functions, not the RPC) and assert:

1. `public.promote_waitlist(<event>)` promotes the waitlisted person — after the call their booking `status` is `'confirmed'` (or an offer exists for them, matching whatever this codebase's promotion contract actually is; read `promote_waitlist` first and assert its real observable outcome, not an assumed one).
2. The same event with `capacity = 2` restored and both seats taken still does **not** promote — the capped path is unchanged.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: the uncapped promotion assertion fails — nobody is promoted, because `event_free_seats` reports 0.

- [ ] **Step 3: Read both functions before changing either**

Read `20260825090000_promote_waitlist_stops_regenerating_lapsed_offers.sql:89` onward and `20260825100000_accept_promotion_offer_capacity_guard.sql:89` onward in full. Both are subtle and both have accumulated deliberate fixes (the filenames say so). **Copy each body verbatim into your new migration and change only what the semantics below require** — do not re-derive or tidy either function.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260906135000_waitlist_uncapped.sql` with a `create or replace` of both functions (signatures unchanged, so `create or replace`, not drop-and-recreate). Required semantics:

- **`promote_waitlist`**: ask `public.event_is_capped(target_event)` once, up front. When the event is **capped**, behavior is byte-for-byte what it is today. When **uncapped**, the loop must not terminate on `free <= 0` — there is unlimited room, so every waitlisted group is promotable, and any place the current body uses `free` to size a promotion must use the group's own requested size instead.
- **`accept_promotion_offer`**: the `least(o.offered_seat_count, event_free_seats(o.event_id))` clamp must yield `o.offered_seat_count` when the event is uncapped, and be exactly as it is today when capped.

Both functions are internal; restate their ACLs exactly as their current definitions do (check whether each is granted to `authenticated` or to nobody, and preserve that — do not widen either).

- [ ] **Step 5: Run the tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: the new fixture passes, and **`waitlist_promotion.test.sql` (41 assertions) and `bookings_commit.test.sql` (44) still pass** — they are the regression surface for this edit. Report their counts.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906135000_waitlist_uncapped.sql supabase/tests/database/fixtures/uncapped_waitlist.test.sql
git commit -m "fix(db): promote waitlisted players on uncapped events

event_free_seats reports 0 forever for an uncapped event, so
promote_waitlist would strand anyone already waitlisted when an
organizer clears a cap, and accept_promotion_offer would clamp their
offer to zero seats. Both now ask event_is_capped first."
```

---

### Task 5: The `event_payments` table

**Files:**
- Create: `supabase/migrations/20260906140000_create_event_payments.sql`
- Create: `supabase/tests/database/portable/event_payments_schema.test.sql`
- Create: `supabase/tests/database/fixtures/event_payments_rls.test.sql`

**Interfaces:**
- Produces: `public.event_payments (id, event_id, club_id, profile_id, paid_at, marked_by)` with `unique (event_id, profile_id)`, RLS enabled, one organizer-only select policy, and no write grant at all. Task 6's RPCs are the only writers.

- [ ] **Step 1: Write the failing schema test**

Create `supabase/tests/database/portable/event_payments_schema.test.sql`, modelled exactly on `supabase/tests/database/portable/check_in_schema.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(9);

select has_table('public', 'event_payments', 'event_payments exists');
select has_column('public', 'event_payments', 'event_id',   'has event_id');
select has_column('public', 'event_payments', 'club_id',    'has club_id');
select has_column('public', 'event_payments', 'profile_id', 'has profile_id');
select has_column('public', 'event_payments', 'paid_at',    'has paid_at');
select has_column('public', 'event_payments', 'marked_by',  'has marked_by');

-- One row per person per event: what makes the write idempotent.
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'event_payments'
       and indexdef like '%UNIQUE%(event_id, profile_id)%'),
  'one payment row per person per event');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.event_payments'::regclass),
  'row level security is enabled on event_payments');

-- ALL includes TRUNCATE, which ignores RLS entirely.
select ok(
  not has_table_privilege('authenticated', 'public.event_payments', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_payments');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing RLS test — the security-critical one**

Create `supabase/tests/database/fixtures/event_payments_rls.test.sql`, modelled on `check_in_rls.test.sql`. Seed a club with a **host** and a **plain member**, an event, and two payment rows inserted as the table owner (so this tests the policy, not the RPC). Then:

```sql
-- As the plain member: the table must be completely invisible.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000062","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_payments),
  0,
  'a plain member sees no payment rows at all — not even their own');

select throws_ok(
  $$insert into public.event_payments
      (event_id, club_id, profile_id, marked_by)
    values ('d0000000-0000-0000-0000-000000000061',
            'b0000000-0000-0000-0000-000000000061',
            'a0000000-0000-0000-0000-000000000062',
            'a0000000-0000-0000-0000-000000000062')$$,
  '42501', null,
  'a member cannot insert a payment row directly');

select throws_ok(
  $$delete from public.event_payments$$,
  '42501', null,
  'a member cannot delete payment rows directly');

reset role;
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000061","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_payments),
  2,
  'the host sees every payment row for their club');
```

Note the deliberate contrast with `check_ins`, which grants members a self-select. Here a member sees **zero** rows — including their own — because the design says a player is never shown payment state.

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx supabase test db --local`
Expected: both fail — relation `public.event_payments` does not exist.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260906140000_create_event_payments.sql`:

```sql
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
```

- [ ] **Step 5: Run both tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: schema test 9/9, RLS test 4/4. Quote the RLS test's output in your report — it is the security gate for this feature.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906140000_create_event_payments.sql supabase/tests/database/portable/event_payments_schema.test.sql supabase/tests/database/fixtures/event_payments_rls.test.sql
git commit -m "feat(db): add organizer-only event_payments table"
```

---

### Task 6: Payment RPCs

**Files:**
- Create: `supabase/migrations/20260906150000_payment_mutations.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Create: `supabase/tests/database/fixtures/event_payments.test.sql`

**Interfaces:**
- Consumes: `event_payments` (Task 5), `is_club_member`/`is_club_organizer`/`assert_club_organizer`.
- Produces: `public.set_payment_status(uuid, uuid, boolean)` and `public.event_payment_status(uuid)`. Task 7's `lib/payments.ts` calls exactly these two.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/event_payments.test.sql` asserting: a host can mark paid (row appears) and unmark (row disappears); marking is idempotent (calling twice leaves one row); a plain member calling `set_payment_status` raises `42501`; marking a non-member raises `23514`; `event_payment_status` returns rows for the host and raises `42501` for a plain member; and payment survives a cancel-and-rebook of the player's booking.

```sql
select is(
  (select count(*)::int from public.event_payments
    where event_id = 'd0000000-0000-0000-0000-000000000071'),
  1,
  'marking paid twice leaves exactly one row');

select throws_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000072'::uuid, true)$$,
  '42501', null,
  'a plain member cannot mark anybody paid');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx supabase test db --local`
Expected: `function public.set_payment_status(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260906150000_payment_mutations.sql`:

```sql
/*
 * The only writers of event_payments, and the only reader the client has.
 *
 * Both run the same ladder record_attendance established (20260827030000),
 * in this order, and the order is load-bearing:
 *
 *   1. The caller is an active member of the event's club. RLS does not
 *      protect a `security definer` function, and this must fail FIRST so
 *      that an outsider holding a guessed uuid learns nothing about whether
 *      the event exists.
 *   2. The caller is a host or co-organizer. Unlike attendance there is no
 *      self-service branch at all: a player may neither read nor write
 *      their own payment state.
 *
 * There is deliberately no `occurred_at` parameter and no newest-wins
 * clause. Attendance has one because an offline queue may replay a stale
 * tap; payment is only ever entered by an organizer standing at the door
 * with the app open, and a later mark should simply win.
 */
create function public.set_payment_status(
  target_event   uuid,
  target_profile uuid,
  is_paid        boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev     public.events;
  caller uuid := auth.uid();
begin
  select * into ev from public.events where id = target_event;

  -- Tenancy first. `ev.id is null` is folded in here so "no such event" and
  -- "an event you cannot see" are the same answer to an outsider.
  if ev.id is null or not public.is_club_member(ev.club_id) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  perform public.assert_club_organizer(ev.club_id);

  if not exists (
    select 1 from public.club_members m
     where m.club_id = ev.club_id
       and m.profile_id = target_profile
       and m.status = 'active')
  then
    raise exception 'that person is not a member of this club'
      using errcode = '23514', detail = target_profile::text;
  end if;

  if is_paid then
    insert into public.event_payments
      (event_id, club_id, profile_id, paid_at, marked_by)
    values
      (target_event, ev.club_id, target_profile, now(), caller)
    on conflict (event_id, profile_id) do update
      set paid_at = now(), marked_by = caller;
  else
    -- Absence of a row is the unpaid state; there is no false to store.
    delete from public.event_payments
     where event_id = target_event and profile_id = target_profile;
  end if;
end;
$$;

/*
 * The door screen's read. A separate RPC rather than widening
 * event_attendance: that function is callable by any club member, and
 * bolting payment onto it would put the organizer-only column one
 * conditional away from every member's response. A separate
 * organizer-gated function keeps the leak surface to a single testable
 * place.
 */
create function public.event_payment_status(target_event uuid)
returns table (profile_id uuid, paid_at timestamptz, marked_by uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = target_event;

  if ev.id is null or not public.is_club_member(ev.club_id) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  perform public.assert_club_organizer(ev.club_id);

  return query
    select p.profile_id, p.paid_at, p.marked_by
      from public.event_payments p
     where p.event_id = target_event;
end;
$$;

revoke execute on function public.set_payment_status(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_payment_status(uuid, uuid, boolean)
  to authenticated;

revoke execute on function public.event_payment_status(uuid)
  from public, anon;
grant execute on function public.event_payment_status(uuid)
  to authenticated;
```

- [ ] **Step 4: Update the grants allowlist — all three edits**

In `supabase/tests/database/portable/grants.test.sql`:

1. Bump the plan: `select plan(114);` becomes `select plan(119);` (five assertions added below).
2. Append to **Direction 1**'s array (7-space indent), next to the attendance entries:
   ```
       'public.set_payment_status(uuid, uuid, boolean)',
       'public.event_payment_status(uuid)',
   ```
3. Append the identical two strings to **Direction 2**'s array (9-space indent).
4. Add the named assertions, modelled on the attendance ACL block at lines 405-450:
   ```sql
   select ok(
     not has_table_privilege(
       'authenticated', 'public.event_payments', 'TRUNCATE'),
     'authenticated cannot TRUNCATE event_payments'
   );
   select ok(
     has_function_privilege(
       'authenticated',
       'public.set_payment_status(uuid, uuid, boolean)', 'EXECUTE'),
     'authenticated can execute set_payment_status'
   );
   select ok(
     has_function_privilege(
       'authenticated', 'public.event_payment_status(uuid)', 'EXECUTE'),
     'authenticated can execute event_payment_status'
   );
   select ok(
     not has_function_privilege(
       'anon', 'public.set_payment_status(uuid, uuid, boolean)', 'EXECUTE'),
     'anon cannot execute set_payment_status'
   );
   select ok(
     not has_function_privilege(
       'anon', 'public.event_payment_status(uuid)', 'EXECUTE'),
     'anon cannot execute event_payment_status'
   );
   ```

- [ ] **Step 5: Run the tests**

Run: `npx supabase db reset --local && npx supabase test db --local`
Expected: the new fixture passes; `grants.test.sql` passes 119/119.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906150000_payment_mutations.sql supabase/tests/database/portable/grants.test.sql supabase/tests/database/fixtures/event_payments.test.sql
git commit -m "feat(db): add organizer-only payment mark and read RPCs"
```

---

### Task 7: TypeScript data layer

**Files:**
- Create: `lib/payments.ts`
- Create: `lib/payments.test.ts`
- Modify: `lib/events.ts` (the `createEvent`/`updateEvent`/series wrappers, around `lib/events.ts:848-892` and `:916+`)
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: `set_payment_status`, `event_payment_status` (Task 6); `create_event`/`update_event` new arguments (Tasks 3–4).
- Produces: `setPaymentStatus({ eventId, profileId, isPaid }): Promise<{ error: string | null }>`, `fetchEventPayments(eventId): Promise<PaymentRow[] | null>`, and the `PaymentRow` type `{ profile_id: string; paid_at: string; marked_by: string }`. Tasks 8–10 import exactly these.

- [ ] **Step 1: Write the failing test**

Create `lib/payments.test.ts` following the mocking style of the existing `lib/attendance.ts` tests. Assert that `setPaymentStatus` calls `supabase.rpc('set_payment_status', { target_event, target_profile, is_paid })` with exactly those argument names, that a Postgres error is mapped through `bookingErrorMessage`, and that `fetchEventPayments` returns `null` (not `[]`) on failure — the same "failed is not empty" distinction `venuesFailed` and `entriesFailed` already make elsewhere in this codebase.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- lib/payments.test.ts`
Expected: FAIL — cannot resolve `./payments`.

- [ ] **Step 3: Write `lib/payments.ts`**

Mirror `lib/attendance.ts:108-128` exactly in shape:

```ts
import { supabase } from './supabase';
import { bookingErrorMessage, GENERIC_ERROR } from './bookings';

export type PaymentRow = {
  profile_id: string;
  paid_at: string;
  marked_by: string;
};

export async function fetchEventPayments(
  eventId: string,
): Promise<PaymentRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('event_payment_status', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventPayments failed', error);
      return null;
    }
    return (data ?? []) as PaymentRow[];
  } catch (cause) {
    console.error('fetchEventPayments failed', cause);
    return null;
  }
}

export async function setPaymentStatus(input: {
  eventId: string;
  profileId: string;
  isPaid: boolean;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_payment_status', {
      target_event: input.eventId,
      target_profile: input.profileId,
      is_paid: input.isPaid,
    });
    if (error) {
      console.error('setPaymentStatus failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('setPaymentStatus failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 4: Extend the event wrappers**

In `lib/events.ts`, add `seatingMode?: 'assigned_tables' | 'open_seating'` and `capacity?: number | null` to the `createEvent`, `createEventSeries`, `updateEvent` and `updateEventSeries` input types, and pass them through as `event_seating_mode`/`series_seating_mode` and `capacity_limit`/`new_capacity` (plus `clear_capacity` for the update path — see Task 4's note on null semantics). Update `lib/schema-contract.test.ts` so the contract test still matches the real RPC signatures.

- [ ] **Step 5: Run the tests**

Run: `npm test` then `npm run test:contract`
Expected: both green. The contract test requires a local Supabase (`REQUIRE_LOCAL_SUPABASE=1`), so ensure `npx supabase start` is up.

- [ ] **Step 6: Commit**

```bash
git add lib/payments.ts lib/payments.test.ts lib/events.ts lib/schema-contract.test.ts
git commit -m "feat(lib): add payment data layer and seating-mode event args"
```

---

### Task 8: The door list — status sections, search, and the payment marker

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/check-in.tsx`
- Create: `components/PaidControl.tsx`
- Modify: `app/__tests__/check-in.test.tsx` (or create if absent)

**Interfaces:**
- Consumes: `fetchEventPayments`, `setPaymentStatus`, `PaymentRow` (Task 7); the existing `AttendanceRow` type (`lib/attendance.ts:30-41`) and `CheckInControl` component.
- Produces: no exports other than the new `PaidControl` component.

This is the screen the feature lives or dies on. Read the whole current file before editing — it is 779 lines and its optimistic-write machinery (`busy` as a *count*, `writeSeqRef`, `loadSeqRef`, rollback on failure) must be preserved exactly, not reinvented.

- [ ] **Step 1: Build `components/PaidControl.tsx`**

Clone `components/CheckInControl.tsx`'s shape (props at its lines 5-12; note `isDisabled = disabled || busy` at :75). A two-state toggle: paid / not paid, with `busy` and `disabled` props, an `accessibilityLabel` built from the person's name, and the accent2 (sage) palette for the paid state so it reads as distinct from the terracotta "Here" action.

- [ ] **Step 2: Add status sections and search**

Replace `groupRows` (`check-in.tsx:37-63`, which groups by table) with a status grouping that returns `{ toArrive, here, notComing, walkIns }` derived from each row's `state` (`null` → toArrive, `'arrived'` → here, `'no_show'` → notComing). Keep the walk-in bucket. Render each section with a count header, following the existing section-header styles.

Add a search field above the sections that filters by `display_name`, case-insensitive. Follow the `TextField` component's usage elsewhere in the app.

Each row shows, in addition to the name: a **group badge** when the booking belongs to a booking group (the spec's reason for this is that an organizer assigning tables on the day needs to know who arrived together — so it must be visible, not merely stored), and, when the event's `fee_cents` is non-zero and the person is unpaid, the amount owed rendered from the existing `fee_cents` (no new price plumbing — reuse whatever helper already formats cents elsewhere in the app; `grep -rn "fee_cents\|formatCents\|parseDollarsToCents" lib/ app/` to find it).

> The table-based grouping this replaces is **not** dead code for assigned-table events — it is what the door list shows today. Keep it and switch on the event's `seating_mode`: assigned-table events keep their per-table grouping, open-seating events get status sections. Do not delete the table grouping.

- [ ] **Step 3: Implement the settle window**

Tapping "Here" must mark the row done **without** moving it, so the organizer can also tap paid. Add a `settlingRef: Record<string, ReturnType<typeof setTimeout>>` and a `settled: Record<string, boolean>` state. On any attendance or payment write for a profile: clear that profile's existing timer, mark the row as "recently touched", and start a new 4-second timer that, on fire, drops the row from the touched set so the next render re-buckets it into its true section.

```ts
// Constants live at module scope so the by-hand pass can tune one number.
const SETTLE_MS = 4000;
```

Any further tap on the same row resets its timer — that is what makes *Here → paid* one uninterrupted gesture on a stationary row. Clear all pending timers in the effect cleanup so an unmount mid-settle cannot set state on an unmounted screen.

- [ ] **Step 3b: Undo**

The spec requires the move to carry an undo affordance, and the by-hand checklist tests it. When a row settles into a new section, surface an undo control naming the person (e.g. "Alice Chen marked here · Undo"). Tapping it calls the existing `clearAttendance` path (`lib/attendance.ts:171-189`) — that function already exists and is what the current screen uses to reset a person to "not determined", so undo is a call to it, not a new RPC. Undo must go through the same optimistic-write machinery (`incrBusy`/`decrBusy`, sequence-guarded rollback) as every other write on this screen; do not bypass it.

- [ ] **Step 4: Wire payments into the existing load and write paths**

Extend `load()` (`check-in.tsx:244`) to also call `fetchEventPayments(eventId)` **only when `isOrganizer`** — a member must never issue that call. Merge the result into rows as a `paid: boolean`. Add a `setPaid` handler modelled exactly on `setState` (`:435-470`): optimistic update, `incrBusy`/`decrBusy`, sequence-guarded rollback on failure, `setError` + `void load()`.

- [ ] **Step 5: Write the component test**

Assert: sections render with correct counts; searching narrows the list; a grouped booking shows its group badge; tapping "Here" does **not** immediately move the row; the row moves after the settle window (use fake timers); tapping paid within the window resets the timer; undo returns the row to "Still to arrive" and corrects the counts; and a failed `setPaymentStatus` rolls the toggle back and shows the error banner.

Also assert the privacy rule at this layer: when `isOrganizer` is false, the screen issues **no** `fetchEventPayments` call and renders no payment control. The RLS test in Task 5 is the real gate, but a member's client should not even ask.

- [ ] **Step 6: Run the tests**

Run: `npm test -- app/__tests__/check-in.test.tsx`
Expected: all green, output pristine.

- [ ] **Step 7: Commit**

```bash
git add app/clubs/[id]/events/[eventId]/check-in.tsx components/PaidControl.tsx app/__tests__/check-in.test.tsx
git commit -m "feat(check-in): status sections, search and payment marking on the door list"
```

---

### Task 9: Create and edit forms

**Files:**
- Modify: `app/clubs/[id]/events/new.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/edit.tsx`
- Modify: `app/__tests__/events-new.test.tsx`, `app/__tests__/events-edit.test.tsx`

**Interfaces:**
- Consumes: `createEvent`/`updateEvent` with the new arguments (Task 7).

- [ ] **Step 1: Add the seating-mode selector**

In `new.tsx`, add a selector above the existing "How many tables?" block (`:394-411`). Use the **local `Chip` component** already defined in that file at `:56-86` (it is not in `components/` — `edit.tsx` has its own copy; do not import across files). Two chips: "Assigned tables" / "Open seating", bound to a new `seatingMode` state defaulting to `'assigned_tables'`.

- [ ] **Step 2: Make the tables picker conditional, and add capacity**

When `seatingMode === 'open_seating'`: hide the tables picker entirely and show instead an optional capacity `TextField` (follow the `feeText`/`minSpendText` pattern in the same file), with help text making "leave blank for no limit" explicit. When `'assigned_tables'`: unchanged, including the existing "Every table seats four…" help line.

Send `tableCount: seatingMode === 'open_seating' ? 0 : tableCount` in the payload at `:284-297`, plus `seatingMode` and the parsed capacity.

- [ ] **Step 3: Mirror both changes in `edit.tsx`**

Same two controls, in the equivalent positions (its toggles are at `:627-643`). The edit path must also send `clearCapacity` when the field is emptied — see Task 4's note on null semantics.

- [ ] **Step 4: Update the form tests**

Assert: selecting open seating hides the tables picker and reveals capacity; the payload carries `tableCount: 0` and the chosen mode; an emptied capacity field sends the clear flag rather than a null that means "unchanged".

- [ ] **Step 5: Run the tests**

Run: `npm test -- app/__tests__/events-new.test.tsx app/__tests__/events-edit.test.tsx`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/[id]/events/new.tsx app/clubs/[id]/events/[eventId]/edit.tsx app/__tests__/events-new.test.tsx app/__tests__/events-edit.test.tsx
git commit -m "feat(events): seating mode selector and optional capacity on the event forms"
```

---

### Task 10: The event detail screen

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: the existing event-detail test. Locate it with `ls app/__tests__/ | grep -i event` and read it before editing; do not create a second test file for this screen.

- [ ] **Step 1: Replace the header for open-seating events**

The header at `:880-887` renders `"N tables · M seats"`. For `open_seating`, render a headcount instead: `"68 signed up"`, plus `" · 60 spots"` when the event is capped, and nothing extra when uncapped. Keep the `tablesFailed` branch untouched.

- [ ] **Step 2: Replace the seat grid with a roster**

For `open_seating`, do not render the `tables.map(...)` / `TableCard` block (`:894`, `:919-1064`). Render a plain roster list of confirmed bookings instead — name plus group badge, reusing the group information already available to this screen. Assigned-table events keep the existing rendering exactly.

- [ ] **Step 3: Hide "need a 4th"**

`components/NeedAFourthCard.tsx` is meaningless without tables; do not render it when `open_seating`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: the whole Vitest suite green (currently 1372 passing) — this screen is widely referenced, so run the full suite here rather than a single file.

- [ ] **Step 5: Commit**

```bash
git add app/clubs/[id]/events/[eventId]/index.tsx app/__tests__/
git commit -m "feat(events): headcount header and roster view for open-seating events"
```

---

### Task 11: Visual baselines and the by-hand pass

**Files:**
- Modify: `e2e/visual.spec.ts`
- Modify: `e2e/session.ts` (seeding, if a large roster helper is needed)
- Create: new snapshots under `e2e/visual.spec.ts-snapshots/`

- [ ] **Step 1: Add visual coverage**

Add specs for: an open-seating event detail screen, and the door list with a roster large enough to exercise all three status sections. `e2e/visual.spec.ts` loops over `WIDTHS = [{name:'mobile',width:375},{name:'desktop',width:1440}]` and runs the same body at both — follow that existing structure exactly rather than adding width-specific code.

- [ ] **Step 2: Generate and review the baselines**

Run: `npm run test:visual -- --update-snapshots`
Then **look at each new PNG** before committing it. A baseline is a claim that this is what the screen should look like; generating one without opening it commits whatever bug was on screen.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npm run test:db && npm run test:visual`
Expected: all green. Note in your report that `npm run test:db` must be run immediately after `npx supabase db reset --local` — a known ordering issue (recorded in `todo.md`) makes three `waitlist_promotion.test.sql` assertions fail if the contract or visual suites ran against the same stack first.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(visual): baselines for open-seating detail and the status door list"
```

- [ ] **Step 5: Write the by-hand checklist into the plan's report**

The following cannot be proven by any automated test and must be done on a real phone before this branch merges. Record the result of each:

1. **A 60+ name door list on a phone.** Seed a real open-seating event with 60+ confirmed bookings. Load `/check-in` at phone width. Does scrolling feel workable? Does search find a person in under two seconds of typing?
2. **The settle window at speed.** Check in six people in a row as fast as you can tap. Does any row move under your thumb? Is 4 seconds too long (list feels stale) or too short (row escapes before you mark paid)? **Report the number you would ship.**
3. **Here → paid as one gesture.** For one person, tap Here then immediately tap paid. Confirm the row did not move between the two taps.
4. **Undo.** Mis-tap Here on the wrong person and undo it. Confirm the row returns to "Still to arrive" and the counts correct themselves.
5. **A player cannot see payment.** Sign in as a plain member on a second device/browser and open the same event. Confirm no payment state is visible anywhere, and that the network tab shows no `event_payment_status` call.

---

## Verification summary

| Layer | Command | Covers |
|---|---|---|
| Schema/RLS | `npx supabase db reset --local && npx supabase test db --local` | Tasks 1–6, incl. the organizer-only RLS gate |
| Data layer | `npm test` | Task 7–10 |
| Contract | `npm run test:contract` | RPC signatures match `lib/` |
| Visual | `npm run test:visual` | Task 11 |
| By hand | phone, real event | The settle window and the privacy check |
