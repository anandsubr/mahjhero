# Game Screen Cleanup & Scoring UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the game screen (drop redundant text, move table setup to Edit, show club context) and redesign round recording around the seat tiles themselves — tap a seat's existing panel to record that person's win from one of seven fixed point values, with running totals shown on the tile (a star for the current leader) instead of a separate row and form.

**Architecture:** No new tables or RPCs — `record_round`'s guard changes from "any positive integer" to a fixed seven-value set, matched by `table_rounds`' own check constraint. The client side moves capability, not data: `SeatGrid` gains the ability to show a per-seat point badge and a "Record a win" control (reusing the seat-tap panel that already exists); `RoundLog` shrinks to a read-only list once that capability lands elsewhere; `TableCard` computes the badge/leader data once (from the same `rounds` prop it already receives) and threads it to `SeatGrid` instead of duplicating it.

**Tech Stack:** Postgres/Supabase (one migration), TypeScript, React Native + react-native-web, Vitest + @testing-library/react, pgTAP.

**Spec:** [../specs/2026-09-03-game-screen-cleanup-and-scoring-ux-design.md](../specs/2026-09-03-game-screen-cleanup-and-scoring-ux-design.md)

## Global Constraints

- **Branch:** `feat/game-screen-cleanup-and-scoring-ux`, already created off `main`. Never commit to `main`; this plan merges via a PR.
- **Points are exactly 25/30/35/40/45/50/75 — nowhere else, client or server.** No free-text fallback, no "other" chip.
- **A member can only record their own win.** Reuses today's exact seat-panel access rule (a plain member can only open their own seat's panel) — do not extend panel access to other members' seats for any reason in this plan.
- **Sequencing matters for type-safety, not just data.** `SeatGrid`'s `Seat` type gains a required `profileId` field partway through this plan — every existing test fixture that constructs a `Seat` object must gain one in the SAME task that changes the type, or the suite will not compile. Tasks are ordered "expand, then contract": new capability lands and is proven working alongside the old UI first; only once that is green does a later task delete the old UI. This means for a few tasks in the middle of this plan, the screen briefly offers scoring two ways (the seat tile AND the old picker) — that is expected, not a bug, and resolves by the end of the plan.
- **`table_rounds_points_check`** is the real, live constraint name on the hosted database (confirmed via `pg_constraint` during planning) — use it exactly.
- **Migration timestamp continues the existing sequence.** The last migration on `main` is `20260903060000`. This plan uses `20260903070000`.
- **No `Modal`/full-screen-overlay pattern exists yet in this codebase** — Task 9 is the first. Use React Native's built-in `Modal` (not a hand-rolled absolutely-positioned `View`, which does not reliably cover the whole screen across RN's non-web targets). Verify it actually renders and is queryable in this repo's Vitest/jsdom setup before treating the task as done; if it does not behave as expected in tests, escalate rather than force it.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260903070000_record_round_fixed_points.sql` | `record_round`'s points guard + `table_rounds`' check constraint, both fixed-set |
| `supabase/tests/database/fixtures/table_rounds_mutations.test.sql` | Extended for the fixed-set validation |
| `lib/bookings.ts` | New refusal mapping; dedupes an existing accidental duplicate entry |
| `components/icons.tsx` | New `StarIcon` |
| `components/SeatGrid.tsx` | `profileId` on `Seat`; the point/star badge; the "Record a win" control; panel contrast fix |
| `components/TableCard.tsx` | Badge/leader computation from `rounds`; forwards recording props to `SeatGrid`; drops the interactive-picker-adjacent read-only tier row into one line; drops "N seats free" |
| `components/RoundLog.tsx` | Shrinks to a read-only list + delete, in a tinted `Card` |
| `components/RoundTimer.tsx` | The full-screen overlay |
| `app/clubs/[id]/events/[eventId]/index.tsx` | Club name; drops the interactive `TierPicker`; closes the seat panel on a successful recording |
| `app/clubs/[id]/events/[eventId]/edit.tsx` | New "Tables" section with one `TierPicker` per table |

---

## Task 1: `record_round`'s points become a fixed set

**Files:**
- Create: `supabase/migrations/20260903070000_record_round_fixed_points.sql`
- Modify: `supabase/tests/database/fixtures/table_rounds_mutations.test.sql`

**Interfaces:**
- Consumes: the current, real `record_round` body (`supabase/migrations/20260902070000_table_rounds_mutations.sql:56-114`) and `table_rounds`' check constraint (`supabase/migrations/20260902060000_create_table_rounds.sql:22`, live name confirmed as `table_rounds_points_check`).
- Produces: `record_round` raises `'points must be 25, 30, 35, 40, 45, 50, or 75'` for anything outside that set. Task 2 consumes this exact message.

- [ ] **Step 1: Write the failing test changes**

Read the CURRENT `supabase/tests/database/fixtures/table_rounds_mutations.test.sql` in full first — it is a single, sequentially-stateful pgTAP file where later assertions depend on rows earlier ones create.

Change line 4 from `select plan(16);` to `select plan(18);`.

Change line 159 (inside the `lives_ok` where the organizer records a round for bob) from:
```sql
      '70000000-0000-0000-0000-000000000003', 8)$$,
```
to:
```sql
      '70000000-0000-0000-0000-000000000003', 30)$$,
```
(This is the call at "the organizer records a round for bob" — the ONLY change on this line is `8` → `30`.)

Change line 169 (the `lives_ok` where ann, seated at the table, records a round for bob) from:
```sql
      '70000000-0000-0000-0000-000000000003', 5)$$,
```
to:
```sql
      '70000000-0000-0000-0000-000000000003', 25)$$,
```
(Again, only `5` → `25`.)

**Do NOT change any other `record_round(..., 8)` or `record_round(..., 5)` call in this file** — every other one is a `throws_ok` that fails BEFORE reaching the points check (tenancy, game-state, authorization, or winner-not-seated), so its points argument is irrelevant to what it tests and must stay as-is.

Change line 214 from:
```sql
  'points must be greater than zero',
```
to:
```sql
  'points must be 25, 30, 35, 40, 45, 50, or 75',
```

Change line 223 (the negative-points test) the same way.

Immediately after line 225 (the negative-points `throws_ok`, still under the organizer's role/claims set at lines 196-198 — do not add a new `set local role`/`set local request.jwt.claims` here, reuse the existing context) and before the `reset role;` currently at line 227, insert:

```sql

select lives_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 75)$$,
  'the highest fixed value, 75, is accepted'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 20)$$,
  '23514',
  'points must be 25, 30, 35, 40, 45, 50, or 75',
  'a plausible-but-not-fixed value (20) is refused, not just non-positive ones'
);
```

- [ ] **Step 2: Verify the count**

Count every `throws_ok`/`lives_ok`/`is` assertion in the whole file after your edit and confirm it is exactly 18, matching `select plan(18);`.

- [ ] **Step 3: Write the migration**

This is a `create or replace function` of `record_round`, preserving every existing line and comment except the points-check block, plus an `alter table` for the matching constraint. Read the CURRENT `record_round` at `supabase/migrations/20260902070000_table_rounds_mutations.sql:56-114` yourself first and confirm it still matches what's shown below before writing the file — if it has drifted (a later migration redefined it since this plan was written), copy the current body and apply only the same points-block change.

Create `supabase/migrations/20260903070000_record_round_fixed_points.sql`:

```sql
/*
 * Points become a fixed set: 25, 30, 35, 40, 45, 50, 75 -- the club's real
 * scoring values, not an arbitrary positive integer. Confirmed during the
 * 2026-09-03 game-screen-cleanup brainstorm as a hard rule, enforced here
 * (not just as a UI convenience) so a direct RPC call cannot record a score
 * this club's own rules do not recognise.
 *
 * Both halves of the belt-and-suspenders pair record_round already had for
 * "points > 0" move together: the RPC's own explicit raise (the friendly,
 * mapped message) and table_rounds' check constraint (the actual backstop).
 */
create or replace function public.record_round(
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
  if target_points is null or target_points not in (25, 30, 35, 40, 45, 50, 75) then
    raise exception 'points must be 25, 30, 35, 40, 45, 50, or 75'
      using errcode = '23514';
  end if;

  insert into public.table_rounds
    (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
  values
    (target_table, tbl.event_id, tbl.club_id, winner_profile, target_points, caller)
  returning * into round;

  return round;
end;
$$;

-- The RPC's own raise above is the friendly message; this is the actual
-- backstop, matching the fixed set exactly. Name confirmed against the
-- live hosted schema (`select conname from pg_constraint where conrelid =
-- 'public.table_rounds'::regclass and contype = 'c'`).
alter table public.table_rounds
  drop constraint table_rounds_points_check,
  add constraint table_rounds_points_check check (points in (25, 30, 35, 40, 45, 50, 75));
```

Note: `record_round`'s grant (`grant execute on function public.record_round(uuid, uuid, int) to authenticated;`) was already established by the original migration and survives `create or replace` (it does not survive a drop-and-recreate, but this is not one) — no grant statement is needed in this file.

- [ ] **Step 4: Note DB verification is deferred if Docker is unavailable**

If `npx supabase start`/`npm run test:db` is not runnable in your environment, do not attempt it. Instead, hand-trace the two new assertions and the two changed-message assertions against the migration you just wrote, and the two changed `lives_ok` calls (confirm `30` and `25` both satisfy the new `in (...)` check and are otherwise identical to their prior passing calls). Include the trace in your report. If Docker IS available, run `npm run test:db` for real and report the actual output.

- [ ] **Step 5: Run the full non-DB suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260903070000_record_round_fixed_points.sql \
  supabase/tests/database/fixtures/table_rounds_mutations.test.sql
git commit -m "feat(rounds): make record_round's points a fixed set (25/30/35/40/45/50/75)"
```

---

## Task 2: Client-side refusal copy, and a dedupe

**Files:**
- Modify: `lib/bookings.ts`

**Interfaces:**
- Consumes: the exact message from Task 1's migration.
- Produces: `bookingErrorMessage` maps it. `lib/rounds.ts`'s existing `recordRound` wrapper already routes through `bookingErrorMessage` — no change needed there.

- [ ] **Step 1: Run the self-audit to see it fail**

Run: `npm test -- lib/bookings.test.ts`
Expected: FAIL — the self-audit lists `points must be 25, 30, 35, 40, 45, 50, or 75` as unmapped.

- [ ] **Step 2: Add the entry, and remove a duplicate**

In `lib/bookings.ts`'s `BOOKING_REFUSALS` array, add (placed anywhere reasonable — e.g. immediately after the existing `'this game has already ended'` entry):

```ts
  {
    contains: 'points must be 25, 30, 35, 40, 45, 50, or 75',
    message: 'Points must be 25, 30, 35, 40, 45, or 75.',
    codes: ['23514'],
  },
```

(Note the friendly message intentionally still lists all seven — do not accidentally drop 50 or 45 when writing it out.) Wait — re-read that: it must list all SEVEN values (25, 30, 35, 40, 45, 50, 75), not six. Write it as: `'Points must be 25, 30, 35, 40, 45, 50, or 75.'`

Also: this array currently has an accidental byte-identical DUPLICATE `'this game has already ended'` entry (a leftover from two different branches independently adding the same mapping before they were both merged to `main`) — find both occurrences and delete one, keeping the other. Confirm via `grep -n "this game has already ended" lib/bookings.ts` that exactly one remains after your edit.

- [ ] **Step 3: Run the self-audit and the full bookings suite to verify it passes**

Run: `npm test -- lib/bookings.test.ts`
Expected: PASS — every test in the file green, including the self-audit.

- [ ] **Step 4: Commit**

```bash
git add lib/bookings.ts
git commit -m "fix(rounds): map the fixed-points refusal, dedupe an accidental duplicate entry"
```

---

## Task 3: Seat tiles show the running total (and a star for the leader)

**Files:**
- Modify: `components/icons.tsx` (new `StarIcon`)
- Modify: `components/SeatGrid.tsx`
- Modify: `components/__tests__/SeatGrid.test.tsx`
- Modify: `components/TableCard.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`

**Interfaces:**
- Consumes: `roundTotals` (`lib/rounds.ts`, unchanged).
- Produces: `Seat` gains `profileId: string` (required — see Global Constraints), `points: number | null`, `isLeader: boolean` (both optional, default `null`/`false`). `TableCard` computes these per seated occupant from its existing `rounds` prop.

- [ ] **Step 1: Write the failing tests**

Read the CURRENT `components/__tests__/SeatGrid.test.tsx` in full first. It has exactly two places that construct `Seat` object literals: the top-level `seats` array (lines 6-10) and `selfSeats` inside the third `describe` block. Both need a `profileId` field added to every entry, matching the existing `bookingId`→id pattern:

```ts
const seats = [
  { bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false },
  { bookingId: 'b2', profileId: 'p2', name: 'Mei L.', isYou: false },
  { bookingId: 'b3', profileId: 'p3', name: 'You', isYou: true },
];
```

```ts
  const selfSeats = [
    { bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false },
    { bookingId: 'b3', profileId: 'p3', name: 'Ada', isYou: true },
  ];
```

Do not add `points`/`isLeader` to these existing fixtures — they default to no-badge, which is correct for tests that don't care about scoring.

Add a new `describe` block to the same file, anywhere after the top-level `describe('SeatGrid', ...)` block:

```tsx
describe('SeatGrid: the point badge', () => {
  it('shows no badge for a seat with no recorded points', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: null, isLeader: false }]}
      />,
    );
    // No badge means no point number is rendered at all.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows a plain round badge with the point total for a non-leading winner', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: 30, isLeader: false }]}
      />,
    );
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('shows a star badge for the current leader', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: 75, isLeader: true }]}
      />,
    );
    expect(screen.getByText('75')).toBeTruthy();
    // Whichever way you choose to distinguish the star visually in the
    // component you write, add an assertion here that actually
    // distinguishes it from the plain-round-badge test above (e.g. a
    // testID, or the presence of the star SVG's own accessible element) --
    // do not leave this test unable to fail if the star path were removed.
  });
});
```

The last test's own comment is a note to you: after you implement the component, come back and make this assertion concrete (e.g. `expect(screen.getByTestId('badge-star-b1')).toBeTruthy()` or similar) rather than leaving the vague instruction in the final test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/SeatGrid.test.tsx`
Expected: FAIL for two reasons — `profileId` is not yet a valid prop on `Seat` (TypeScript), and the badge doesn't render yet.

- [ ] **Step 3: Add `StarIcon`**

In `components/icons.tsx`, add (matching this file's existing icon pattern — filled, not stroked, since a badge needs a solid shape to sit text on top of):

```tsx
/** Filled star, for the leading player's point badge on a seat tile
 *  (components/SeatGrid.tsx). Filled, not stroked, unlike every other icon
 *  in this file -- a badge needs a solid shape to sit text on top of. */
export function StarIcon({
  size = 24,
  color = colors.accentColor,
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M12 2l2.9 6.9L22 9.6l-5.5 4.9L18 22l-6-3.9L6 22l1.5-7.5L2 9.6l7.1-.7z" />
    </Svg>
  );
}
```

Add `import type { StyleProp, ViewStyle } from 'react-native';` to this file's imports if not already present.

- [ ] **Step 4: Extend `SeatGrid`'s `Seat` type and add the badge**

In `components/SeatGrid.tsx`, change the `Seat` type:

```ts
export type Seat = {
  bookingId: string;
  /** Needed for `onRecordRound` (Task 4) -- record_round takes a winner's
   *  profile id, not a booking id. */
  profileId: string;
  name: string;
  isYou: boolean;
  /** This seat's running point total at this table, or null/omitted if
   *  they have never won a round here -- no badge renders in that case.
   *  Optional (not just nullable) so every existing test fixture that
   *  predates scoring keeps compiling unchanged -- TableCard's own
   *  mapping (Step 6 below) always sets this explicitly. */
  points?: number | null;
  /** True if tied for (or alone in) the current lead among this table's
   *  occupants who have won at least one round. Ties: everyone tied for
   *  the lead gets the star, not just whoever reached it first. Optional,
   *  same reasoning as `points` -- defaults to false when omitted. */
  isLeader?: boolean;
};
```

Add a small render helper near the top of the file (after the imports, before the component):

```tsx
function SeatBadge({ seat }: { seat: Seat }) {
  const points = seat.points ?? null;
  if (points === null) return null;
  if (seat.isLeader) {
    return (
      <View style={styles.badge} testID={`badge-star-${seat.bookingId}`}>
        <StarIcon size={40} color={colors.accent[400]} style={styles.badgeStarIcon} />
        <Text style={[styles.badgeText, styles.badgeTextStar]}>{points}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeRound]} testID={`badge-round-${seat.bookingId}`}>
      <Text style={styles.badgeText}>{points}</Text>
    </View>
  );
}
```

Import `StarIcon` from `./icons` and add the `import { StyleSheet, ... }` set already there (no new RN imports needed beyond what's already imported).

Render `<SeatBadge seat={seat} />` as a sibling of the name in BOTH places an occupied seat currently renders its name — the read-only `!manageable` branch and the closed-but-manageable `Pressable` branch (the OPEN panel's own header row too, for consistency, though it matters less there). Specifically:

In the `!manageable` branch (currently just a `<Text>` with the name), wrap in a row:
```tsx
return (
  <View
    key={seat.bookingId}
    style={[styles.seat, seat.isYou && styles.seatYou, styles.seatRow]}
  >
    <Text style={[styles.name, seat.isYou && styles.nameYou]}>
      {displayName}
    </Text>
    <SeatBadge seat={seat} />
  </View>
);
```

In the closed-but-manageable `Pressable` branch, the existing `nameRow` View already lays out name + chevron as a row — add the badge as a third sibling there too (name, chevron, badge, in that order, so the chevron stays immediately next to the name and the badge trails):
```tsx
<View style={styles.nameRow}>
  <Text style={[styles.name, seat.isYou && styles.nameYou]}>
    {displayName}
  </Text>
  <Text aria-hidden style={[styles.chevron, seat.isYou && styles.chevronYou]}>▾</Text>
  <SeatBadge seat={seat} />
</View>
```
(Do the same for the OPEN panel's own header `nameRow`, which uses `▴` instead of `▾` — same three-sibling addition.)

Add these styles to the `StyleSheet.create` at the bottom of the file:

```ts
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRound: {
    backgroundColor: colors.accentColor,
  },
  badgeStarIcon: {
    position: 'absolute',
  },
  badgeText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.bg,
  },
  badgeTextStar: {
    color: colors.accent[900],
  },
```

`nameRow`'s existing style already uses `flexDirection: 'row', alignItems: 'center', gap: space[1]` — the badge added as a third child there inherits that gap automatically; if it reads too cramped once you see it rendered, widen `nameRow`'s `gap` or give the badge its own `marginLeft`, whichever looks right — this is a judgment call to make against the actual render, not something to guess blindly here.

- [ ] **Step 5: Confirm the third SeatGrid test is concrete**

Go back to the "shows a star badge for the current leader" test from Step 1 and replace its trailing comment with a real assertion, e.g.:
```ts
expect(screen.getByTestId('badge-star-b1')).toBeTruthy();
expect(screen.queryByTestId('badge-round-b1')).toBeNull();
```

- [ ] **Step 6: Wire `TableCard` to compute and forward the badge data**

Read the CURRENT `components/TableCard.tsx` in full first. In its seat-mapping (currently `seats={seated.map((o) => ({ bookingId: o.booking_id, name: o.display_name, isYou: o.profile_id === youId }))}`), compute totals once above the `return`:

```ts
  const totals = rounds ? roundTotals(rounds) : [];
  const totalsByProfile = new Map(totals.map((t) => [t.profileId, t.points]));
  const maxPoints = totals.length > 0 ? Math.max(...totals.map((t) => t.points)) : null;
```

Import `roundTotals` from `../lib/rounds` (alongside the existing `RoundLog, { type DisplayRound }` import — `roundTotals` is a named export from `lib/rounds.ts`, not from `RoundLog`).

Change the `seats` mapping passed to `SeatGrid` to:

```ts
seats={seated.map((o) => {
  const points = totalsByProfile.get(o.profile_id) ?? null;
  return {
    bookingId: o.booking_id,
    profileId: o.profile_id,
    name: o.display_name,
    isYou: o.profile_id === youId,
    points,
    isLeader: points !== null && points === maxPoints,
  };
})}
```

- [ ] **Step 7: Write the failing `TableCard` test, then make it pass**

Add to `components/__tests__/TableCard.test.tsx`, after the existing rounds-related tests:

```tsx
  it('shows a round badge for a seated player with recorded points, and a star for the leader', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 30 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByTestId('badge-star-b1')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
  });
```

(`occupants[0]` in this file's existing fixture has `booking_id: 'b1'`, `profile_id: 'p1'` — matches the `winner_profile_id: 'p1'` above, so this one round makes p1 both the only scorer and therefore the leader by definition.)

Run: `npm test -- components/__tests__/SeatGrid.test.tsx components/__tests__/TableCard.test.tsx`
Expected: FAIL first (module/type errors and missing badge), then PASS after Steps 3-6 above.

- [ ] **Step 8: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add components/icons.tsx components/SeatGrid.tsx components/__tests__/SeatGrid.test.tsx \
  components/TableCard.tsx components/__tests__/TableCard.test.tsx
git commit -m "feat(rounds): show each seat's running total on its own tile, star for the leader"
```

---

## Task 4: Record a win from the seat panel

**Files:**
- Modify: `components/SeatGrid.tsx`
- Modify: `components/__tests__/SeatGrid.test.tsx`
- Modify: `components/TableCard.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`

**Interfaces:**
- Consumes: `Seat.profileId` (Task 3).
- Produces: `SeatGrid` gains `canRecordRound?: boolean` and `onRecordRound?: (profileId: string, points: number) => void`. `TableCard` forwards its own already-existing `canRecordRound`/`onRecordRound` props here (previously only reaching `RoundLog`, which still also receives them until Task 5 removes that path).

- [ ] **Step 1: Write the failing tests**

Add to `components/__tests__/SeatGrid.test.tsx`, inside the existing `describe('SeatGrid: organizer seat management', ...)` block's `Harness` usage (extend the `Harness` component to accept and forward the two new props, or add a second small harness — your call, whichever keeps the file's existing style), a new test:

```tsx
  it('reveals the seven fixed point chips after tapping "Record a win", and records the tapped value', () => {
    const onRecordRound = vi.fn();
    function RecordingHarness() {
      const [openBookingId, setOpenBookingId] = useState<string | null>(null);
      return (
        <SeatGrid
          tableLabel="Table 1"
          capacity={4}
          seats={seats}
          otherTables={otherTables}
          openBookingId={openBookingId}
          onToggleManage={(id) =>
            setOpenBookingId((current) => (current === id ? null : id))
          }
          onMove={vi.fn()}
          onRemove={vi.fn()}
          canRecordRound
          onRecordRound={onRecordRound}
        />
      );
    }
    render(<RecordingHarness />);

    fireEvent.click(screen.getByLabelText("Manage Jane P.'s seat"));
    fireEvent.click(screen.getByLabelText('Record a win for Jane P.'));

    for (const value of [25, 30, 35, 40, 45, 50, 75]) {
      expect(screen.getByLabelText(`Record Jane P.'s win for ${value} points`)).toBeTruthy();
    }

    fireEvent.click(screen.getByLabelText("Record Jane P.'s win for 40 points"));
    expect(onRecordRound).toHaveBeenCalledWith('p1', 40);
  });

  it('offers no "Record a win" control when canRecordRound is false', () => {
    function Harness2() {
      const [openBookingId, setOpenBookingId] = useState<string | null>(null);
      return (
        <SeatGrid
          tableLabel="Table 1"
          capacity={4}
          seats={seats}
          otherTables={otherTables}
          openBookingId={openBookingId}
          onToggleManage={(id) =>
            setOpenBookingId((current) => (current === id ? null : id))
          }
          onMove={vi.fn()}
          onRemove={vi.fn()}
        />
      );
    }
    render(<Harness2 />);
    fireEvent.click(screen.getByLabelText("Manage Jane P.'s seat"));
    expect(screen.queryByLabelText('Record a win for Jane P.')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/SeatGrid.test.tsx`
Expected: FAIL — no such control exists yet.

- [ ] **Step 3: Add the control to `SeatGrid`**

Add near the top of `components/SeatGrid.tsx` (module scope, alongside any other constants):

```ts
const POINT_VALUES = [25, 30, 35, 40, 45, 50, 75] as const;
```

Add two new props to `Props`:

```ts
  /** Eligibility to record a round -- computed once per table by the
   *  caller (the same `canRecordRound` the event screen already computes:
   *  `gameLive && (isOrganizer || iAmSeatedHere)`), not per-seat: whichever
   *  panel a caller can already open (their own, or -- for an organizer --
   *  anyone's) is exactly who they may record a win for. */
  canRecordRound?: boolean;
  onRecordRound?: (profileId: string, points: number) => void;
```

Add local state inside the component function, alongside the existing destructured props:

```ts
  const [recordingBookingId, setRecordingBookingId] = useState<string | null>(null);
```

(Add `import { useState } from 'react';` if not already imported — check first, this file may not currently import any hooks.)

Change the `toggle` function (currently `const toggle = () => onToggleManage!(seat.bookingId);`, defined inside the `.map()` callback) to also clear the recording view whenever a panel is opened or closed, so re-opening any panel always starts on the plain action buttons, never mid-recording:

```ts
        const toggle = () => {
          onToggleManage!(seat.bookingId);
          setRecordingBookingId(null);
        };
```

Inside `manageActions` (the `<View style={styles.manageActions}>` block), after the existing organizer-or-self action buttons, add:

```tsx
            {canRecordRound && onRecordRound ? (
              recordingBookingId === seat.bookingId ? (
                <View style={styles.pointsRow}>
                  {POINT_VALUES.map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => {
                        onRecordRound(seat.profileId, value);
                        setRecordingBookingId(null);
                      }}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Record ${seat.name}'s win for ${value} points`}
                      style={styles.pointChip}
                    >
                      <Text style={styles.pointChipText}>{value}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Button
                  variant="secondary"
                  big={false}
                  disabled={busy}
                  onPress={() => setRecordingBookingId(seat.bookingId)}
                  accessibilityLabel={`Record a win for ${seat.name}`}
                >
                  Record a win
                </Button>
              )
            ) : null}
```

- [ ] **Step 4: Fix the panel's contrast**

Also in `components/SeatGrid.tsx`: the `manageActions` style currently has no background of its own, so it sits directly on the seat's own colour (`seatYou`'s olive `accent2Color`, or plain `neutral[300]` for anyone else's seat) — and a `ghost`-variant `Button` (used for "Remove from game"/"Leave this game") renders transparent with `colors.accentColor` (orange) text, which is hard to read against the olive `seatYou` background specifically. Give the actions area its own opaque, light background — the same one `ghost` buttons already read correctly against everywhere else in this app:

```ts
  manageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space[2],
  },
```

Add the two new styles for the point chips:

```ts
  pointsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pointChip: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  pointChipText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.bg,
  },
```

Take a screenshot of the open panel on a `seatYou` seat once this is running (via this project's own preview tooling) and confirm the fix actually reads correctly before treating this step as done — the exact contrast problem was reported from a real screenshot, not derived from first principles, so verify against a real render rather than by inspection alone.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/SeatGrid.test.tsx`
Expected: PASS — every existing test in the file plus the 2 new ones.

- [ ] **Step 6: Wire `TableCard` to forward the new props to `SeatGrid`**

In `components/TableCard.tsx`, add `canRecordRound={canRecordRound}` and `onRecordRound={(profileId, points) => onRecordRound?.(profileId, points)}` to the `<SeatGrid ...>` call (alongside the other props already forwarded there). `TableCard`'s own `canRecordRound`/`onRecordRound` props already exist (consumed by `RoundLog` today) — this task makes them ALSO reach `SeatGrid`; do not remove the `RoundLog` usage yet, that is Task 5.

Add a test to `components/__tests__/TableCard.test.tsx`:

```tsx
  it('offers "Record a win" on an occupied seat once canRecordRound is true', () => {
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
    fireEvent.click(screen.getByLabelText("Manage Ravi K.'s seat"));
    expect(screen.getByLabelText('Record a win for Ravi K.')).toBeTruthy();
  });
```

You will need `fireEvent` imported in this test file — check whether it already is (Task 3 did not need it) and add it to the existing `@testing-library/react` import if not.

- [ ] **Step 7: Close the panel on a successful recording**

In `app/clubs/[id]/events/[eventId]/index.tsx`, find the `onRecordRound` prop currently passed to `TableCard` (`onRecordRound={(winnerId, points) => void recordTableRound(table.id, winnerId, points)}`) and change it to close the open seat panel first, matching `hostPlace`/`hostRemove`'s own existing shape:

```tsx
              onRecordRound={(winnerId, points) => {
                setOpenBookingId(null);
                void recordTableRound(table.id, winnerId, points);
              }}
```

- [ ] **Step 8: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add components/SeatGrid.tsx components/__tests__/SeatGrid.test.tsx \
  components/TableCard.tsx components/__tests__/TableCard.test.tsx \
  "app/clubs/[id]/events/[eventId]/index.tsx"
git commit -m "feat(rounds): record a win from the seat's own panel, fix panel contrast"
```

---

## Task 5: `RoundLog` becomes read-only

**Files:**
- Modify: `components/RoundLog.tsx`
- Modify: `components/__tests__/RoundLog.test.tsx`
- Modify: `components/TableCard.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RoundLog`'s `Props` drops `players`, `canRecord`, `onRecord` entirely — `canRecord`/`onRecord`'s job moved to `SeatGrid` in Tasks 3-4. Any other consumer of `RoundLog` (there is only `TableCard`) must stop passing them.

- [ ] **Step 1: Rewrite the failing tests**

Read the CURRENT `components/RoundLog.tsx` and `components/__tests__/RoundLog.test.tsx` in full first.

Replace `components/__tests__/RoundLog.test.tsx` in full:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoundLog from '../RoundLog';

const rounds = [
  { id: 'r2', winner_profile_id: 'p2', winner_name: 'You', points: 25 },
  { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ann', points: 30 },
];

describe('RoundLog', () => {
  it('says nothing has been recorded yet when the log is empty', () => {
    render(<RoundLog rounds={[]} canDelete={false} onDelete={vi.fn()} />);
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('lists rounds newest first with the winner and points', () => {
    render(<RoundLog rounds={rounds} canDelete={false} onDelete={vi.fn()} />);
    expect(screen.getByText('You · 25 pts')).toBeTruthy();
    expect(screen.getByText('Ann · 30 pts')).toBeTruthy();
  });

  it('shows delete affordances only when canDelete is true', () => {
    render(<RoundLog rounds={rounds} canDelete onDelete={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: "Delete You's round for 25 points" }),
    ).toBeTruthy();
  });

  it('hides delete affordances when canDelete is false', () => {
    render(<RoundLog rounds={rounds} canDelete={false} onDelete={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: "Delete You's round for 25 points" }),
    ).toBeNull();
  });

  it('calls onDelete with the round id', () => {
    const onDelete = vi.fn();
    render(<RoundLog rounds={rounds} canDelete onDelete={onDelete} />);
    fireEvent.click(
      screen.getByRole('button', { name: "Delete You's round for 25 points" }),
    );
    expect(onDelete).toHaveBeenCalledWith('r2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/RoundLog.test.tsx`
Expected: FAIL — the component still requires `players`/`canRecord`/`onRecord`.

- [ ] **Step 3: Rewrite `RoundLog.tsx`**

Replace `components/RoundLog.tsx` in full:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { colors, space, type } from '../lib/theme';

export type DisplayRound = {
  id: string;
  winner_profile_id: string;
  winner_name: string;
  points: number;
};

type Props = {
  /** Newest first. */
  rounds: DisplayRound[];
  canDelete: boolean;
  busy?: boolean;
  onDelete: (roundId: string) => void;
};

/**
 * A table's round-by-round log: who won each hand, and -- organizer only --
 * a way to delete a mis-recorded one. Read-only otherwise: recording itself
 * happens through the seat's own tap panel (SeatGrid), not here -- see the
 * 2026-09-03 game-screen-cleanup spec for why. That panel is already scoped
 * to exactly one person, which is exactly what a round winner needs to be,
 * so a second winner-picker here was redundant. Running totals moved to
 * the seat tiles themselves for the same reason this no longer needs
 * `players` at all.
 *
 * Wrapped in its own tinted Card so the section reads as a distinct block
 * against the rest of the table card, not more body text.
 */
export default function RoundLog({ rounds, canDelete, busy = false, onDelete }: Props) {
  return (
    <Card background={colors.accent[100]} style={styles.card}>
      <Text style={styles.heading}>Rounds</Text>
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
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    marginTop: space[3],
  },
  heading: {
    fontFamily: type.bodyBold,
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
});
```

- [ ] **Step 4: Run the `RoundLog` tests to verify they pass**

Run: `npm test -- components/__tests__/RoundLog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update `TableCard`'s `RoundLog` call, and its own tests**

In `components/TableCard.tsx`, change the `<RoundLog ...>` call from passing `players`/`canRecord`/`onRecord` to just:

```tsx
      {rounds ? (
        <RoundLog
          rounds={rounds}
          canDelete={canDeleteRound}
          busy={busy}
          onDelete={(roundId) => onDeleteRound?.(roundId)}
        />
      ) : null}
```

In `components/__tests__/TableCard.test.tsx`, find and remove (or rewrite, if the test's intent is now better expressed against `SeatGrid`'s own "Record a win" control — your judgment) any test asserting the OLD `RoundLog` picker/points-field behaviour on `TableCard` (search for `'Winner: Ravi K.'` — the "offers the record form only when canRecordRound is true" test from before Task 3/4 landed no longer makes sense as written, since that control no longer exists in `RoundLog`; Task 4's own new "offers 'Record a win' on an occupied seat" test already covers the equivalent behaviour through `SeatGrid`, so this one can simply be deleted rather than rewritten).

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add components/RoundLog.tsx components/__tests__/RoundLog.test.tsx \
  components/TableCard.tsx components/__tests__/TableCard.test.tsx
git commit -m "feat(rounds): RoundLog becomes a read-only list, tinted card"
```

---

## Task 6: Table card cleanup — combine the tier line, drop "seats free"

**Files:**
- Modify: `components/TableCard.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

In `components/__tests__/TableCard.test.tsx`, find the existing `'says how many seats are left'`, `'singularises one seat'`, and `'says Full rather than "0 seats free"'` tests — these assert text (`'3 seats free'`, `'1 seat free'`, `'Full'`) that this task removes entirely. Delete all three tests (there is nothing to replace them with — the requirement is that this text no longer renders at all, which the remaining tests' `queryByText` calls would need to newly assert if you want positive coverage of the absence; add one if you think it's worth it, e.g. `expect(screen.queryByText(/seats? free/)).toBeNull();` inside the existing `'names the table and its tier'` test).

Update the `'names the table and its tier'` test (which currently only checks `'Table 2'` and `'Advanced'` render, without checking their relative position) — no change needed to the assertions themselves, since `getByText` doesn't care about layout, but re-read it once the component changes to confirm it still passes.

- [ ] **Step 2: Run the tests to verify the removed ones are gone and nothing else broke**

Run: `npm test -- components/__tests__/TableCard.test.tsx`
Expected: the three deleted tests are gone from the run (not failing — deleted); everything else still passes against the CURRENT (unchanged) component, since you haven't edited `TableCard.tsx` yet.

- [ ] **Step 3: Combine the tier row onto the table's heading line, drop the seats-free text**

In `components/TableCard.tsx`, the current render has:

```tsx
      <View style={styles.row}>
        <Text style={styles.label}>{table.label}</Text>
        {needsFourth ? <Tag>Needs a 4th</Tag> : null}
      </View>
      <View style={styles.tierRow}>
        <SkillTierPips tier={table.skill_tier} />
        <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>
      </View>
```

Change to one combined row:

```tsx
      <View style={styles.row}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{table.label}</Text>
          <SkillTierPips tier={table.skill_tier} />
          <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>
        </View>
        {needsFourth ? <Tag>Needs a 4th</Tag> : null}
      </View>
```

Add `labelRow` to the stylesheet (matching the existing `tierRow`'s own `flexDirection`/`alignItems`/`gap`, since it's absorbing that row's job):

```ts
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexShrink: 1,
  },
```

Remove the now-unused `tierRow` style if nothing else in the file references it (check first).

Remove the `<Text style={styles.free}>{seatsFreeLabel(free)}</Text>` line entirely, and the `free`/`seatsRemaining`/`seatsFreeLabel`-derived `const free = seatsRemaining(...)` line if `free` is no longer used anywhere else in the file (check — it may still be needed elsewhere; if it genuinely becomes dead, remove it and its now-unused `seatsFreeLabel` import, but keep `seatsRemaining` imported if `SeatGrid` or anything else in this file still needs it indirectly — check before deleting any import).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/TableCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add components/TableCard.tsx components/__tests__/TableCard.test.tsx
git commit -m "fix(events): combine the table's tier onto its heading line, drop seats-free text"
```

---

## Task 7: Event screen — club name, drop the interactive tier picker

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

Read the CURRENT `app/clubs/[id]/events/[eventId]/index.tsx` and `app/__tests__/events-detail.test.tsx` in full first.

Add to `app/__tests__/events-detail.test.tsx`:

```tsx
  it('shows the club name for context', async () => {
    render(<EventScreen />);
    expect(await screen.findByText(CLUB.name)).toBeTruthy();
  });
```

(Place this inside whichever existing `describe` block makes sense for a basic render-content assertion — likely `describe('member view: what is shown, and what is not', ...)`.)

Find and delete any existing test in this file asserting the organizer's `TierPicker` renders on this screen (search for `TierPicker`, `'Any level'` used as an organizer-editable-control assertion, or similar) — that control moves to the edit screen in Task 8; if this file doesn't already have such a test, none needs deleting.

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: FAIL on the new club-name test; everything else still passes (TierPicker hasn't been removed from this screen yet).

- [ ] **Step 3: Add the club name**

In `app/clubs/[id]/events/[eventId]/index.tsx`, immediately above the existing `<Text style={styles.heading}>{event.title}</Text>` line, add a kicker line showing the club name, matching the styling convention `components/DashboardHeader.tsx`'s own `kicker` style already establishes (bold, small, uppercase, letter-spaced, accent-coloured):

```tsx
        <Text style={styles.clubKicker}>{club.name}</Text>
```

Add to the stylesheet:

```ts
  clubKicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accentColor,
  },
```

- [ ] **Step 4: Remove the interactive `TierPicker`**

Find the `<TierPicker ... />` block inside the organizer's `children` passed to each `<TableCard>` (rendered only `{isOrganizer ? (<>...)` — search for `import TierPicker` and the JSX block itself) and delete it entirely, along with the now-unused `import TierPicker from '../../../../../components/TierPicker';` line and the `updateEventTable` import/usage IF `updateEventTable` is no longer called anywhere else in this file (check — it might not be used for anything else on this screen once this is gone; if it becomes genuinely unused here, remove the import, but leave `lib/events.ts`'s own export alone, since Task 8 needs it from the edit screen).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" app/__tests__/events-detail.test.tsx
git commit -m "feat(events): show the club name, move tier editing off the game screen"
```

---

## Task 8: Edit screen — a Tables section for tier editing

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/edit.tsx`
- Modify: `app/__tests__/events-edit.test.tsx` (confirmed to already exist and cover this screen)

**Interfaces:**
- Consumes: `fetchEventTables`, `updateEventTable` (`lib/events.ts`, both already exist and are already used by the game screen for the same purpose), `TierPicker` (`components/TierPicker.tsx`, unchanged).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Read the current files**

Read `app/clubs/[id]/events/[eventId]/edit.tsx` and `app/__tests__/events-edit.test.tsx` in full, matching the test file's existing mocking conventions (this app mocks `lib/events`' fetch/update functions per-file, following the same partial-mock-with-`importOriginal`-spread pattern used throughout this codebase's test suite).

- [ ] **Step 2: Write the failing tests**

Add tests to `app/__tests__/events-edit.test.tsx` covering: the Tables section renders one `TierPicker` per table once tables load; changing a table's tier calls `updateEventTable(table.id, { tier: newTier })`; a failed tables fetch degrades only this section (matching the established `xFailed` pattern this screen already uses elsewhere — e.g. `seriesFailed`/`overriddenFailed` in this same file).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- app/__tests__/events-edit.test.tsx`
Expected: FAIL — the screen doesn't fetch tables or render a Tables section yet.

- [ ] **Step 4: Add table fetching**

In `app/clubs/[id]/events/[eventId]/edit.tsx`, add state:

```ts
  const [tables, setTables] = useState<EventTable[]>([]);
  const [tablesFailed, setTablesFailed] = useState(false);
```

(Import `EventTable` as a type from `../../../../../lib/events`, alongside whatever is already imported from there — check the existing import line and extend it rather than adding a second one.)

In the mount effect's `Promise.all` (currently `Promise.all([fetchClub(clubId), fetchEvent(eventId)])`), add `fetchEventTables(eventId)` as a third parallel fetch, and after the existing `setClub`/`setEvent` calls:

```ts
      setTablesFailed(loadedTables === null);
      setTables(loadedTables ?? []);
```

(Import `fetchEventTables` from `../../../../../lib/events` alongside whatever else is already imported from there.)

- [ ] **Step 5: Add the Tables section**

Add a `Card` with one `TierPicker` per table, placed after the scope-conditional blocks and before the `<Button onPress={onSave} ...>Save</Button>` line (search for that exact line — it's the anchor point), rendered regardless of `scope` (tables are per-occurrence, not part of either the "This game" or "The whole series" field sets this screen already tracks):

```tsx
      {tablesFailed ? (
        <Text style={styles.help}>Could not load this game's tables.</Text>
      ) : tables.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>Tables</Text>
          {tables.map((t) => (
            <TierPicker
              key={t.id}
              tableLabel={t.label}
              tier={t.skill_tier}
              onChange={(nextTier) =>
                void updateEventTable(t.id, { tier: nextTier }).then(() =>
                  setTables((current) =>
                    current.map((row) =>
                      row.id === t.id ? { ...row, skill_tier: nextTier } : row,
                    ),
                  ),
                )
              }
            />
          ))}
        </Card>
      ) : null}
```

(Import `TierPicker` from `../../../../../components/TierPicker` and `updateEventTable` from `../../../../../lib/events`. Check whether `styles.sectionTitle` and `styles.help` already exist in this file's stylesheet — this screen almost certainly already has a `help` style given its established `xFailed` pattern elsewhere; add `sectionTitle` if it doesn't already exist, matching the game screen's own `sectionTitle` style for consistency.)

This optimistic local-state update (rather than a full reload) matches the game screen's own established `run()`-then-reload pattern in spirit but is simpler here since there is no other state on this screen that a tier change could affect — if you find a reason a full reload would be more consistent with this file's existing conventions once you're looking at the real code, prefer that instead and note the deviation.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/events-edit.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/edit.tsx" app/__tests__/events-edit.test.tsx
git commit -m "feat(events): add per-table tier editing to the edit-game screen"
```

---

## Task 9: Round timer — full-screen overlay

**Files:**
- Modify: `components/RoundTimer.tsx`
- Modify: `components/__tests__/RoundTimer.test.tsx`

**Interfaces:** none new — this is a pure display addition to an existing, fully self-contained component.

- [ ] **Step 1: Write the failing tests**

Read the CURRENT `components/RoundTimer.tsx` and `components/__tests__/RoundTimer.test.tsx` in full first.

Add to `components/__tests__/RoundTimer.test.tsx`:

```tsx
  it('opens a full-screen overlay when the running countdown is tapped', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );
    fireEvent.click(screen.getByText('15:00'));
    // The overlay shows the same value, in whatever larger-scale element
    // you build -- assert something that only exists once the overlay is
    // open (a testID, an accessibility role/label specific to the overlay
    // itself) rather than re-querying '15:00' alone, since that text may
    // legitimately appear in both the inline and overlay views at once.
    expect(screen.getByTestId('timer-overlay')).toBeTruthy();
  });

  it('closes the overlay without affecting the underlying countdown', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );
    fireEvent.click(screen.getByText('15:00'));
    expect(screen.getByTestId('timer-overlay')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('timer-overlay')).toBeNull();
    expect(screen.getByText('15:00')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('14:00')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/RoundTimer.test.tsx`
Expected: FAIL — no overlay exists yet.

- [ ] **Step 3: Add the overlay**

In `components/RoundTimer.tsx`, add local state:

```ts
  const [overlayOpen, setOverlayOpen] = useState(false);
```

In the running (not-null-`secondsLeft`) branch, wrap the countdown `Text` in a `Pressable` that opens the overlay (only when not expired — tapping "Time's up" shouldn't open anything new, "Reset timer" already covers that state):

```tsx
      <Pressable
        onPress={expired ? undefined : () => setOverlayOpen(true)}
        accessibilityRole={expired ? undefined : 'button'}
        accessibilityLabel={expired ? undefined : 'Show the timer full-screen'}
      >
        <Text style={[styles.clock, expired ? styles.expired : null]}>
          {expired ? "Time's up" : formatClock(secondsLeft)}
        </Text>
      </Pressable>
```

Add the overlay itself, rendered as a sibling of the existing `<View style={styles.row}>` (i.e. returned alongside it, not nested inside):

```tsx
      {overlayOpen ? (
        <Modal
          visible
          animationType="fade"
          onRequestClose={() => setOverlayOpen(false)}
        >
          <View style={styles.overlay} testID="timer-overlay">
            <Text style={styles.overlayClock}>{formatClock(secondsLeft)}</Text>
            <Button
              variant="secondary"
              onPress={() => setOverlayOpen(false)}
              accessibilityLabel="Close"
            >
              Close
            </Button>
          </View>
        </Modal>
      ) : null}
```

Import `Modal` and `Pressable` from `react-native` alongside the existing imports there. Add styles:

```ts
  overlay: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[6],
  },
  overlayClock: {
    fontFamily: type.heading,
    fontSize: 96,
    color: colors.text,
  },
```

(`96` has no existing token in `lib/theme.ts`'s `type.size` scale — check whether one close to this exists before hardcoding a new magic number; if the theme file has a documented convention for one-off large display text elsewhere in this app, prefer matching it.)

**Verify `Modal` actually works in this repo's test environment before treating this step as done** — react-native-web's `Modal` renders via a portal-like mechanism that may or may not be directly queryable by `@testing-library/react`'s default `screen` queries depending on where it mounts. Run the tests from Step 1 against this implementation; if `screen.getByTestId('timer-overlay')` cannot find the modal's content, investigate why (a common fix is that RNW's `Modal` needs no special handling and this just works, but confirm rather than assume) before falling back to a plain conditionally-rendered `View` with `StyleSheet.absoluteFillObject` positioning as a simpler alternative — note in your report which one you ended up using and why.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/RoundTimer.test.tsx`
Expected: PASS — every existing test plus the 2 new ones.

- [ ] **Step 5: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add components/RoundTimer.tsx components/__tests__/RoundTimer.test.tsx
git commit -m "feat(rounds): full-screen overlay for the running round timer"
```

---

## Final check

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm the "expand, then contract" sequencing left no dead code: `RoundLog` no longer has any trace of `players`/`canRecord`/`onRecord`; nothing still imports `TierPicker` into the game screen.
- [ ] Confirm the real-world case that motivated this: a table with players seated shows their running totals directly on the tiles, the current leader has a star, tapping a seat lets you (or, for an organizer, anyone) record a win from exactly the seven fixed point values, and the panel is legible against both seat colours.
- [ ] If Docker was unavailable during implementation, note in the PR description that `npm run test:db` still needs to run for real before merge.
- [ ] Open a PR from `feat/game-screen-cleanup-and-scoring-ux` into `main` (per the standing branch-per-plan rule) rather than merging locally.
