# Seat Placement During a Live Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `place_booking` currently refuses every seat placement and every table-to-table move the instant a game starts, for anyone — including a host trying to seat a confirmed member into an obviously-open seat. This leaves an "any table" booking that never got assigned before kickoff permanently stuck for the rest of the game. Narrow the freeze to what it actually protects: allow placement/moves through the whole live game, refusing only once the game has ended.

**Architecture:** One SQL guard changes (`starts_at` → `ends_at` in `place_booking`), one client-side refusal mapping is added, and one client boolean splits "move an existing confirmed booking" (now allowed live) from "create a brand-new booking" (still frozen at kickoff, unchanged). No new table, no new function, no new RPC.

**Tech Stack:** Postgres/Supabase (one migration), TypeScript, Vitest + @testing-library/react, pgTAP.

**Spec:** [../specs/2026-09-03-seat-placement-during-live-game-design.md](../specs/2026-09-03-seat-placement-during-live-game-design.md)

## Global Constraints

- **Branch:** `fix/seat-unplaced-after-kickoff`, already created off `main`. Never commit to `main`; this plan merges via a PR.
- **Only `place_booking` changes.** `cancel_booking`, `decline_booking`, and `cancel_booking_group` keep raising `'event already started'` at `starts_at` exactly as today — giving up a seat mid-game stays frozen, deliberately, and is out of scope.
- **`assert_event_bookable`'s own `starts_at` guard is unchanged** — creating a brand-new booking after kickoff stays frozen. This plan only touches placing/moving an *already-confirmed* booking.
- **No change to `promote_waitlist`.** The fix relies on its existing, independent `starts_at`-based no-op (`supabase/migrations/20260825010000_waitlist_promotion.sql:228`) — do not touch that function.
- **Window is `starts_at <= now() < ends_at`, no tail after `ends_at`.**
- **Migration timestamp continues the existing sequence.** The last migration on `main` is `20260830050000`. This plan uses `20260903060000`.
- **Errcode stays `23514`** (a rule refusal, not a tenancy one) — matching the message it replaces.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260903060000_place_booking_ends_at.sql` | The guard change |
| `supabase/tests/database/fixtures/bookings_cancellation.test.sql` | Extended: live-game placement, live-game move, organizer live-game move, no waitlist promotion, updated message on the already-ended case |
| `lib/bookings.ts` | New `BOOKING_REFUSALS` entry |
| `app/clubs/[id]/events/[eventId]/index.tsx` | New `canManageOwnSeat`; `onTakeSeat`'s gate splits on move-vs-book |
| `app/__tests__/events-detail.test.tsx` | New tests for the split gate |

---

## Task 1: `place_booking`'s guard change

**Files:**
- Create: `supabase/migrations/20260903060000_place_booking_ends_at.sql`
- Modify: `supabase/tests/database/fixtures/bookings_cancellation.test.sql`

**Interfaces:**
- Consumes: `public.place_booking(target_booking uuid, target_table uuid)` (`supabase/migrations/20260825030000_booking_cancellation.sql:258-320`), `public.promote_waitlist` (unchanged, relied upon).
- Produces: `place_booking` raises `'this game has already ended'` (23514) instead of `'event already started'` once `ev.ends_at <= now()`; no longer raises anything time-based before that. Task 2 (client refusal copy) consumes this exact message text.

- [ ] **Step 1: Write the failing test additions**

Read `supabase/tests/database/fixtures/bookings_cancellation.test.sql` in full first — it's a single, sequentially-stateful file (450 lines, `plan(29)`), and these additions build on fixture rows already inserted earlier in the file (the club, venue, and users from the top of the file). Do not reorder or duplicate those.

Change line 4 from:

```sql
select plan(29);
```

to:

```sql
select plan(36);
```

Change the existing "already started" `place_booking` test (currently lines 371-375):

```sql
select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000009', null)$$,
  '23514',
  'event already started',
  'a booking at a game that has started cannot be placed');
```

to (same booking, same event — "Last week", `e3e3e3e3-...`, whose `starts_at` AND `ends_at` are both already in the past — only the expected message changes, since that game really has ended, not merely started):

```sql
select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000009', null)$$,
  '23514',
  'this game has already ended',
  'a booking at a game that has ended cannot be placed');
```

Append the following block immediately before the file's closing `select * from finish();` / `rollback;` (currently the last two lines):

```sql
-- ---------------------------------------------------------------------
-- Placement during a live game (started, not yet ended). This is the
-- exact case that was broken: an "any table" confirmed booking, or an
-- already-seated one wanting to move, had no way to ever be placed once
-- starts_at passed -- forever, for the rest of the game.
-- ---------------------------------------------------------------------
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Right now',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000005',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 4, 1);

-- Carol is already seated at Table 1 (to exercise a table-to-table move).
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000010',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000004');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000030',
   '9909aaaa-0000-0000-0000-000000000010',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000004',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003');

-- Dan is confirmed but unplaced ("any table") -- the exact bug scenario.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000011',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000031',
   '9909aaaa-0000-0000-0000-000000000011',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

-- Erin is waiting -- to prove a live-game move does NOT promote her.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000012',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   null, 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000032',
   '9909aaaa-0000-0000-0000-000000000012',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000031',
      '7ab1e000-0000-0000-0000-000000000004')$$,
  'an unplaced confirmed booking can be seated on a game that has already started');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000031'),
  '7ab1e000-0000-0000-0000-000000000004'::uuid,
  'and the table is actually recorded');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000030',
      '7ab1e000-0000-0000-0000-000000000005')$$,
  'an already-seated member can move to a different table on a live game');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000030'),
  '7ab1e000-0000-0000-0000-000000000005'::uuid,
  'and their booking now shows the new table');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000032'),
  'waitlisted',
  'the seat Carol''s move freed at Table 1 does not promote the waitlisted group -- promote_waitlist''s own starts_at guard holds');

-- An organizer may also move somebody else's booking on a live game --
-- the same permission split place_booking already has, now unblocked by
-- time.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000031',
      '7ab1e000-0000-0000-0000-000000000005')$$,
  'an organizer may move another member''s booking on a live game');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000031'),
  '7ab1e000-0000-0000-0000-000000000005'::uuid,
  'and that move is recorded too');
```

- [ ] **Step 2: Verify the count**

Count the `throws_ok`/`lives_ok`/`is` assertions actually present in the whole file after your edit (not just the new block) and confirm it is exactly 36, matching `select plan(36);`. If it doesn't match, you miscounted somewhere — find the discrepancy before moving on, don't adjust the plan count to fit what you wrote.

- [ ] **Step 3: Write the migration**

This is a `create or replace function` of the existing `place_booking` (its signature and `returns jsonb` are unchanged, so `create or replace` — not drop-and-recreate — is correct here). The body below is copied verbatim from the CURRENT, real function at `supabase/migrations/20260825030000_booking_cancellation.sql:258-322`, with exactly two changes: the `select id, starts_at into ev` line gains `ends_at`, and the guard block right after it changes from `starts_at`/`'event already started'` to `ends_at`/`'this game has already ended'`. Every comment, the `booking_result` return, and everything else is preserved as-is.

**Before writing the file:** re-read `supabase/migrations/20260825030000_booking_cancellation.sql:258-322` yourself and confirm it still matches what's shown below. If it has drifted (a later migration redefined `place_booking` again since this plan was written), copy the CURRENT body instead and apply only the same two changes — note in your report if you hit this case.

Create `supabase/migrations/20260903060000_place_booking_ends_at.sql`:

```sql
/*
 * place_booking's freeze was stricter than the risk it protects against.
 *
 * Every successful placement calls promote_waitlist(bk.event_id) afterward
 * -- moving someone frees a table seat a waitlisted group might now fit.
 * promote_waitlist mid-game, seating someone who "left home an hour ago",
 * is the actual risk plan 4's freeze existed to prevent. But
 * promote_waitlist ALREADY refuses to run once starts_at <= now(), on its
 * own (20260825010000_waitlist_promotion.sql: "if ev.id is null or
 * ev.status <> 'published' or ev.starts_at <= now() then return; end if;").
 * That protection does not live in place_booking at all -- it is
 * independent of what triggers the call.
 *
 * place_booking's own starts_at guard was therefore blocking a strictly
 * safer case than the one that motivated it: filling an already-confirmed,
 * already-committed member into an open seat, with nobody waiting who
 * could be wrongly bumped in. Found live: a confirmed "any table" booking
 * on a started game, with an open seat at its only table, permanently
 * unplaceable -- by the member themselves OR by the host standing at the
 * door.
 *
 * The fix: refuse only once the game has actually ENDED, matching the same
 * window record_round's own guard uses. cancel_booking, decline_booking,
 * and cancel_booking_group are UNTOUCHED -- giving up a seat mid-game is
 * the genuinely risky case (a seat freed with nobody present to claim it),
 * and none of this reasoning applies to it.
 */
create or replace function public.place_booking(target_booking uuid, target_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk       record;
  ev       record;
  tbl      record;
  caller   uuid;
begin
  -- Same null-caller hole as cancel_booking's OR-chain guard, and the same
  -- fix: bind and refuse a null caller before the OR-chain ever runs.
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

  select id, starts_at, ends_at into ev from public.events where id = bk.event_id;
  if ev.ends_at <= now() then
    raise exception 'this game has already ended' using errcode = '23514';
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

revoke execute on function public.place_booking(uuid, uuid) from public, anon;
grant execute on function public.place_booking(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Confirm the guard ladder order is unchanged**

Re-read the function you just wrote: tenancy (`caller is null`) → booking exists → permission (`profile_id = caller or is_club_organizer`) → `status = 'confirmed'` → **the changed line** (`ends_at`) → table-free-seats check → update → `promote_waitlist`. This order must match the original exactly except for the one changed rung — confirm this before moving on.

- [ ] **Step 5: Note DB verification is deferred**

Docker (local Supabase) may not be available in this environment. If `npx supabase start` / `npm run test:db` is not runnable here, do not attempt it — instead, hand-trace every new assertion in Step 1 against the migration you just wrote (the same way earlier work on this codebase has done when Docker was unavailable): for each `lives_ok`/`throws_ok`/`is`, state the caller, the booking/table involved, and why the function's guard ladder produces that exact outcome. Include this trace in your report. If Docker IS available in your environment, run `npm run test:db` for real instead and report the actual output.

- [ ] **Step 6: Run the full non-DB suite**

Run: `npm test`
Expected: PASS, no regressions (this task touches no TypeScript yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903060000_place_booking_ends_at.sql \
  supabase/tests/database/fixtures/bookings_cancellation.test.sql
git commit -m "fix(bookings): let place_booking work through the whole live game"
```

---

## Task 2: Client-side refusal copy

**Files:**
- Modify: `lib/bookings.ts`

**Interfaces:**
- Consumes: the exact message `'this game has already ended'` from Task 1's migration.
- Produces: `bookingErrorMessage` maps it to friendly copy. Task 3's `placeBooking` wrapper (already existing, unchanged) already routes through `bookingErrorMessage` — no change needed there.

- [ ] **Step 1: Run the self-audit to see it fail**

Run: `npm test -- lib/bookings.test.ts`
Expected: FAIL — the `'maps, or explicitly allowlists, every message the migrations raise'` test now lists `this game has already ended` as unmapped (Task 1's migration raises it, nothing maps it yet).

- [ ] **Step 2: Add the entry**

In `lib/bookings.ts`, inside the `BOOKING_REFUSALS` array, immediately after the existing `'event already started'` entry (around line 146):

```ts
  {
    contains: 'this game has already ended',
    message: 'This game has already ended.',
    codes: ['23514'],
  },
```

- [ ] **Step 3: Run the self-audit and the full bookings suite to verify it passes**

Run: `npm test -- lib/bookings.test.ts`
Expected: PASS — all `BOOKING_REFUSALS (self-audit against the migrations)` tests green, along with everything else in the file.

- [ ] **Step 4: Commit**

```bash
git add lib/bookings.ts
git commit -m "fix(bookings): map place_booking's new refusal to friendly copy"
```

---

## Task 3: Split the client's seat-tap gate

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:**
- Consumes: `event.status`/`event.starts_at`/`event.ends_at` (already loaded), `myBooking` (already computed at line ~407).
- Produces: nothing new for later tasks — this is the top of the call chain.

- [ ] **Step 1: Write the failing tests**

Read `app/__tests__/events-detail.test.tsx`'s existing `EVENT`/`TABLE_1` fixtures and the `"lets a member give up their own confirmed seat"` test (around line 428) for the exact `SeatOccupant` shape this file uses — reuse that shape, don't invent a new one.

Add a new `describe` block, alongside the file's other top-level `describe` blocks (e.g. after `describe('member view: what is shown, and what is not', ...)`):

```tsx
describe('seat management during a live game', () => {
  // Relative to the real clock, matching this file's own convention for
  // any timestamp that needs to stay "in the past"/"in the future" as time
  // moves on (this file installs no fake timers).
  function liveEvent() {
    return {
      ...EVENT,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  it('lets a member move their own confirmed, unplaced booking once the game has started', async () => {
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'booking-9',
        group_id: 'group-9',
        profile_id: 'test-user',
        display_name: 'Ada',
        skill_level: null,
        event_table_id: null,
        status: 'confirmed' as const,
        booked_by: 'test-user',
        booked_by_name: 'Ada',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-08-20T10:00:00Z',
      },
    ]);
    render(<EventScreen />);

    fireEvent.click(await screen.findByLabelText('Take a seat at Table 1'));
    await vi.waitFor(() =>
      expect(placeBooking).toHaveBeenCalledWith('booking-9', 'table-1'),
    );
  });

  it('still offers no seat at all, for a member with no booking, once the game has started', async () => {
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([]);
    render(<EventScreen />);

    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: FAIL — the first new test times out waiting for `'Take a seat at Table 1'` (the screen doesn't offer it once `canBook` is false, which it now is since the event has started); the second passes already (for the right reason, coincidentally — confirm this, don't just assume).

- [ ] **Step 3: Add `canManageOwnSeat`**

In `app/clubs/[id]/events/[eventId]/index.tsx`, immediately after the existing `canBook` line (currently line 387, `const canBook = event.status === 'published' && new Date(event.starts_at) > now;`):

```ts
  // A member's own already-confirmed booking can be placed or moved
  // through the whole live game, not just before kickoff --
  // place_booking's own guard now only refuses once the game has ended
  // (20260903060000_place_booking_ends_at.sql). Deliberately separate
  // from `canBook`, which still gates a BRAND NEW booking: creating a
  // fresh seat is untouched by this fix and stays frozen at kickoff.
  const canManageOwnSeat =
    event.status === 'published' && new Date(event.ends_at) > now;
```

- [ ] **Step 4: Split `onTakeSeat`'s gate**

Change the `onTakeSeat` prop (currently, around line 777-784):

```tsx
              onTakeSeat={
                canBook &&
                (!myBooking ||
                  (myBooking.status === 'confirmed' &&
                    myBooking.event_table_id !== table.id))
                  ? () => takeSeat(table)
                  : undefined
              }
```

to:

```tsx
              onTakeSeat={
                (myBooking && myBooking.status === 'confirmed'
                  ? canManageOwnSeat
                  : canBook) &&
                (!myBooking ||
                  (myBooking.status === 'confirmed' &&
                    myBooking.event_table_id !== table.id))
                  ? () => takeSeat(table)
                  : undefined
              }
```

Do not change anything else on this line's surrounding block — `busy`, `needsFourth`, and every other `TableCard` prop stay exactly as they are.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: PASS — every existing test in the file (this file covers far more than seat-tap: check-in, organizer controls, overrides, guard ordering — all of it must still pass) plus the 2 new ones.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test`
Expected: PASS, no regressions.

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" app/__tests__/events-detail.test.tsx
git commit -m "fix(bookings): let a member move their own booking during a live game"
```

---

## Final check

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm the exact real-world case that surfaced this bug is fixed: a confirmed, unplaced ("any table") booking on a game that has started (but not ended) can now be placed onto an open seat, by the member themselves or by an organizer.
- [ ] Confirm what's still correctly frozen: giving up a seat (`cancel_booking`/`decline_booking`/`cancel_booking_group`) and creating a brand-new booking both still refuse once the game has started, unchanged.
- [ ] If Docker was unavailable during implementation, note in the PR description that `npm run test:db` still needs to run for real before merge, alongside any other open PRs with the same note.
- [ ] Open a PR from `fix/seat-unplaced-after-kickoff` into `main` (per the standing branch-per-plan rule) rather than merging locally.
