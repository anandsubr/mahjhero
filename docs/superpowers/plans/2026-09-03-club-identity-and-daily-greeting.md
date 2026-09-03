# Club-Identity Consistency, Live-Only Rounds/Timer, and Daily Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one genuinely inconsistent club tile/name treatment (the game screen), consolidate Club Edit's duplicated back control, fix the Home grid's name truncation, restructure the Club Dashboard's game row to three aligned lines, gate a live game's rounds/timer to its actual start/end window, add an admin-managed, per-day personalized greeting to the Dashboard, give the Messages list's club rows the same mahjong tile, and let a game carry an optional cost-to-play and/or minimum-spend fee end to end (schema, RPCs, add/edit forms, Dashboard tile).

**Architecture:** No new shared UI component — every club-identity context already has the right building block (`ThreadAvatar`'s `asTile` branch, `MahjongTile`, `DashboardHeader`'s "Your club" shape). This is a series of small, targeted fixes to existing files, plus one net-new small feature (the greeting) built the same way `lib/friends.ts`/`lib/profile.ts` and `app/friends.tsx` already are in this codebase: a `lib/*.ts` module with pure functions plus thin Supabase CRUD, a screen that renders it, RLS-backed Postgres tables.

**Tech Stack:** Expo Router (file-based routing), React Native + react-native-web, Supabase (Postgres + PostgREST + RLS), Vitest + `@testing-library/react` for tests.

## Global Constraints

- Every RLS-backed table follows this codebase's existing convention: `grant <verbs> on public.<table> to authenticated;` is a separate, explicit statement (grants define coarse access; RLS policies filter within it) — see `supabase/migrations/20260801221252_create_profiles.sql`'s own comment.
- Test commands run with `TZ=America/New_York` (see `package.json`'s `"test"` script) — do not add a different `TZ` override in any new test.
- 18pt (`type.size.body`) is this app's minimum body text size; 16pt (`type.size.helper`) is the sole sanctioned exception for helper/secondary text. Do not introduce a new font size outside `lib/theme.ts`'s `type.size` scale without a documented reason (this plan introduces none).
- Every new Supabase table needs RLS enabled and an explicit `grant` — an app role with no grant gets a permission error even where a policy would allow it.
- Follow this codebase's existing "never rejects" convention for any function a screen `await`s directly for a write (see `lib/profile.ts`'s `updateProfile` docstring) — catch, log via `console.error`, and return `{ error: string | null }` instead of throwing.

---

### Task 1: Fix Home dashboard's club-name truncation

**Files:**
- Modify: `components/ClubChips.tsx:80-82`
- Test: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is a one-line prop change with no signature impact on any caller.

- [ ] **Step 1: Write the failing test**

Add this test to `app/__tests__/clubs.test.tsx`, in the same `describe` block/area that already renders `ClubChips` (search the file for `'New club'` — the first `ClubChips`-rendering test — and add this alongside it):

```tsx
it('lets a long club name wrap to a second line instead of truncating', async () => {
  fetchMyClubs.mockResolvedValue([
    { ...CLUB, id: 'c2', name: 'West Chapter Mahjong Society' },
    CLUB,
  ]);
  render(<ClubsScreen />);
  const label = await screen.findByText('West Chapter Mahjong Society');
  // react-native-web renders `numberOfLines` as `-webkit-line-clamp` — 1
  // clips to a single line (what today's bug does); this asserts the fix
  // allows a second line instead.
  expect(label).toHaveStyle({ WebkitLineClamp: '2' });
});
```

Check the top of `app/__tests__/clubs.test.tsx` for the existing `CLUB` fixture and `fetchMyClubs` mock name — reuse them exactly as every neighboring test does (do not invent new fixture names).

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "lets a long club name wrap"`
Expected: FAIL — the rendered style has `WebkitLineClamp: '1'`, not `'2'`.

- [ ] **Step 3: Write minimal implementation**

In `components/ClubChips.tsx`, change:

```tsx
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
              {chip.label}
            </Text>
```

to:

```tsx
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={2}>
              {chip.label}
            </Text>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "lets a long club name wrap"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ClubChips.tsx app/__tests__/clubs.test.tsx
git commit -m "fix(clubs): let a long club name wrap to two lines on the dashboard grid"
```

---

### Task 2: Consolidate Club Edit's back control into its existing header

**Files:**
- Modify: `components/DashboardHeader.tsx`
- Modify: `app/clubs/[id]/index.tsx:172-188`
- Test: `app/__tests__/clubs.test.tsx` (the `ClubDetailScreen` describe block, around line 1401)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DashboardHeader` gains a new optional prop `backLabel?: string`, defaulting to `'Clear club filter'` (today's hardcoded value — every existing caller that doesn't pass it is byte-identical to before).

- [ ] **Step 1: Write the failing test**

`app/__tests__/clubs.test.tsx` already has this test (around line 1401) asserting *today's* two-back-controls state. Replace it:

```tsx
  // The separate "← Clubs" ghost button is gone — DashboardHeader's own
  // chevron slot (previously always empty on this screen, since it never
  // passed onPressBack) now carries the back action, so there is exactly
  // one way back, not two.
  it('shows the club as a tile, with one consolidated back button', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByTestId('thread-avatar-club-tile')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Back to your clubs' }),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "one consolidated back button"`
Expected: FAIL — today there are zero buttons named "Back to your clubs" via `getAllByRole` returning the ghost button only by its OWN accessibility label, which currently IS "Back to your clubs" too (so this may actually show length 1 already) but the *next* assertion or a manual check confirms the ghost Button and an unused header chevron slot coexist. Regardless of the exact failure mode, the true state to fix is: run this and confirm the test fails because the ghost `Button` (not `DashboardHeader`'s own chevron) is what satisfies it, which the next steps replace.

Concretely: also check this before editing, so you know what you're replacing —

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "shows the club as a tile, still with its own separate back button unchanged"`
Expected: this OLD test name no longer exists once you replace it in Step 1 — this confirms you edited the right test, not added a duplicate.

- [ ] **Step 3: Write minimal implementation**

In `components/DashboardHeader.tsx`, add the new prop and use it in place of the hardcoded label:

```tsx
export default function DashboardHeader({
  kicker,
  name,
  meta,
  titleAccessory,
  clubId,
  onPressScope,
  onPressAddGame,
  onPressBack,
  backLabel = 'Clear club filter',
}: {
  kicker: string;
  name: string;
  meta: string;
  titleAccessory?: ReactNode;
  clubId?: string;
  onPressScope?: () => void;
  onPressAddGame?: () => void;
  onPressBack?: () => void;
  /** Accessibility label for the chevron `onPressBack` draws. Defaults to
   *  today's "Clear club filter" (app/clubs/index.tsx's own filter-clear
   *  chevron) — app/clubs/[id]/index.tsx passes "Back to your clubs"
   *  instead, since its own chevron is real navigation, not a filter
   *  clear, and the hardcoded label would misdescribe it. */
  backLabel?: string;
}) {
```

And in the same file, update the chevron's `accessibilityLabel`:

```tsx
            {onPressBack ? (
              <Pressable
                onPress={onPressBack}
                accessibilityRole="button"
                accessibilityLabel={backLabel}
                style={styles.clubBack}
              >
                <ChevronLeftIcon color={colors.text} size={22} />
              </Pressable>
            ) : null}
```

In `app/clubs/[id]/index.tsx`, delete the ghost Button block entirely:

```tsx
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
        style={styles.backButton}
      >
        Clubs
      </Button>

      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        clubId={club.id}
      />
```

becomes:

```tsx
      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        clubId={club.id}
        onPressBack={() => router.push('/clubs')}
        backLabel="Back to your clubs"
      />
```

`Button` and `ChevronLeftIcon` may now be unused imports in this file — check with a repo-wide grep (`grep -n "Button\|ChevronLeftIcon" app/clubs/[id]/index.tsx`) before deleting their `import` lines; `Button` may still be used elsewhere in the same file (e.g. "Create an invite link"), `ChevronLeftIcon` likely is not — remove only what is genuinely unused. Also remove the now-unused `backButton` style from that file's `StyleSheet.create` block if nothing else references it (`grep -n "styles.backButton" app/clubs/[id]/index.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "one consolidated back button"`
Expected: PASS

Also re-run the neighboring test that clicks this button, to confirm it still routes correctly with the new wiring:

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "draws a back link to the dashboard"`
Expected: PASS (this test's own assertion — clicking "Back to your clubs" calls `push('/clubs')` — is unchanged by this refactor)

Run the full file to catch any other assertion this touched:

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add components/DashboardHeader.tsx "app/clubs/[id]/index.tsx" app/__tests__/clubs.test.tsx
git commit -m "fix(clubs): consolidate Club Edit's two back controls into one"
```

---

### Task 3: Swap the game screen's club tile for the same chip form every other header uses

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx:728-749`
- Test: `app/__tests__/events-detail.test.tsx` (around line 401)

**Interfaces:**
- Consumes: `components/ThreadAvatar.tsx`'s existing `ThreadAvatar` default export (`kind`, `name`, `clubId`, `asTile` props — already defined, unchanged).
- Produces: nothing new — this is a call-site swap only.

- [ ] **Step 1: Write the failing test**

Update the existing test in `app/__tests__/events-detail.test.tsx` (around line 401) — add one assertion to the existing test rather than writing a new one, since it already covers the same tile:

```tsx
  it("shows a small mahjong tile before the club name, matching that club's own glyph elsewhere", async () => {
    render(<EventScreen />);
    await screen.findByText(CLUB.name);
    expect(
      screen.getByTestId('section-tile').querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
    // The chip form (glyph + initials), the SAME tile every other
    // club-identity header already uses — not the small, label-less
    // decorative form the four nav landing pages use.
    expect(screen.getByTestId('thread-avatar-club-tile')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-detail.test.tsx -t "shows a small mahjong tile"`
Expected: FAIL — no element with `testID="thread-avatar-club-tile"` exists yet on this screen.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/[id]/events/[eventId]/index.tsx`, add the import:

```tsx
import ThreadAvatar from '../../../../../components/ThreadAvatar';
```

(add it alphabetically among the other `components/` imports, matching this file's existing import ordering — next to `TabBar`/`TableCard`).

Replace:

```tsx
        <View testID="section-tile">
          <MahjongTile suit={glyphForClub(clubId)} size="section" />
        </View>
        <Text style={styles.clubKicker}>{club.name}</Text>
```

with:

```tsx
        <View testID="section-tile">
          <ThreadAvatar kind="club" name={club.name} clubId={clubId} asTile />
        </View>
        <Text style={styles.clubKicker}>{club.name}</Text>
```

`MahjongTile` and `glyphForClub` may now be unused in this file — check with `grep -n "MahjongTile\|glyphForClub" "app/clubs/[id]/events/[eventId]/index.tsx"` before removing their imports; only remove what has no other reference in the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-detail.test.tsx -t "shows a small mahjong tile"`
Expected: PASS

Run the full file to confirm nothing else regressed:

Run: `TZ=America/New_York npx vitest run app/__tests__/events-detail.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" app/__tests__/events-detail.test.tsx
git commit -m "fix(events): game screen's club tile matches every other header's chip form"
```

---

### Task 4: Rounds and the timer show only while the game is live

**Files:**
- Modify: `components/TableCard.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx` (the `TableCard` call site, around line 921)
- Test: `components/__tests__/TableCard.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TableCard` gains a new optional prop `gameLive?: boolean`, defaulting to `true` (every existing test/caller that doesn't pass it keeps today's behavior exactly).

- [ ] **Step 1: Write the failing test**

Add to `components/__tests__/TableCard.test.tsx`, after the existing `'offers a round timer'` test:

```tsx
  it('hides the round log and the timer once the game is not live', () => {
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
        gameLive={false}
      />,
    );
    expect(screen.queryByText('Ravi K. · 8 pts')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Start a 15-minute timer for Table 2',
      }),
    ).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/TableCard.test.tsx -t "hides the round log and the timer"`
Expected: FAIL — `TableCard` has no `gameLive` prop yet, so both the round log and the timer still render.

- [ ] **Step 3: Write minimal implementation**

In `components/TableCard.tsx`, add the prop:

```tsx
type Props = {
  table: { id: string; label: string; skill_tier: SkillTier; capacity: number };
  occupants: SeatOccupant[];
  youId: string;
  onTakeSeat?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
  children?: ReactNode;
  otherTables?: SeatableTable[];
  onMove?: (bookingId: string, tableId: string) => void;
  onRemove?: (bookingId: string) => void;
  onLeaveSeat?: (bookingId: string) => void;
  openBookingId?: string | null;
  onToggleManage?: (bookingId: string) => void;
  rounds?: DisplayRound[];
  canRecordRound?: boolean;
  canDeleteRound?: boolean;
  onRecordRound?: (winnerProfileId: string, points: number) => void;
  onDeleteRound?: (roundId: string) => void;
  /** Gates the round log and the round timer to the game's actual
   *  start/end window — both disappear entirely before kickoff and after
   *  the game ends, rather than staying visible the whole time. Defaults
   *  to `true` so every caller that doesn't pass it (in particular this
   *  component's own existing tests) keeps today's behavior unchanged. */
  gameLive?: boolean;
};
```

```tsx
export default function TableCard({
  table,
  occupants,
  youId,
  onTakeSeat,
  busy = false,
  needsFourth = false,
  children,
  otherTables,
  onMove,
  onRemove,
  onLeaveSeat,
  openBookingId,
  onToggleManage,
  rounds,
  canRecordRound = false,
  canDeleteRound = false,
  onRecordRound,
  onDeleteRound,
  gameLive = true,
}: Props) {
```

And gate the two rendering blocks:

```tsx
      {rounds && gameLive ? (
        <RoundLog
          rounds={rounds}
          canDelete={canDeleteRound}
          busy={busy}
          onDelete={(roundId) => onDeleteRound?.(roundId)}
        />
      ) : null}

      {/*
        RoundTimer is pure local UI state with no dependence on whether the
        rounds fetch succeeded -- it stays available even when `rounds` is
        undefined (a transient fetch failure), unlike RoundLog above which
        genuinely needs `rounds` data to render. It IS gated on `gameLive`
        though -- a pacing clock has no reason to exist before the game
        starts or after it ends.
      */}
      {gameLive ? <RoundTimer tableLabel={table.label} /> : null}
```

In `app/clubs/[id]/events/[eventId]/index.tsx`, add `gameLive={gameLive}` to the existing `TableCard` call (the component already computes `gameLive` at lines 445-448, in scope of the `tables.map(...)` this call site sits inside):

```tsx
              rounds={roundsFailed ? undefined : displayRounds}
              canRecordRound={gameLive && (isOrganizer || iAmSeatedHere)}
              canDeleteRound={isOrganizer}
              gameLive={gameLive}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/TableCard.test.tsx`
Expected: PASS (all tests, including the new one and every pre-existing one)

- [ ] **Step 5: Run the event screen's own test file to confirm the wiring didn't break anything there**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-detail.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add components/TableCard.tsx "app/clubs/[id]/events/[eventId]/index.tsx" components/__tests__/TableCard.test.tsx
git commit -m "feat(events): hide rounds and the timer outside the game's live window"
```

---

### Task 5: Add a time-only formatter and restructure the Club Dashboard's game row to three lines

**Files:**
- Modify: `lib/events.ts` (new function, beside `formatEventWhen`)
- Modify: `app/clubs/index.tsx` (the `GameRow` component, lines 627-732, and its styles)
- Test: `lib/events.test.ts`
- Test: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `lib/events.ts` exports a new `formatEventTime(startsAt: string, timezone: string, locale?: string): string`.

- [ ] **Step 1: Write the failing test for `formatEventTime`**

Add to `lib/events.test.ts`, right after the existing `describe('formatEventWhen', ...)` block:

```ts
describe('formatEventTime', () => {
  it('renders only the time, in the club timezone', () => {
    const label = formatEventTime('2027-09-08T23:00:00Z', 'America/New_York');
    expect(label).toBe('7:00 pm');
  });

  it('renders the same instant differently in a different timezone', () => {
    const ny = formatEventTime('2027-09-08T23:00:00Z', 'America/New_York');
    const la = formatEventTime('2027-09-08T23:00:00Z', 'America/Los_Angeles');
    expect(ny).not.toBe(la);
  });

  it('degrades to a placeholder on an invalid date rather than throwing', () => {
    expect(formatEventTime('not-a-date', 'America/New_York')).toBe(
      'Time unavailable',
    );
  });
});
```

Import `formatEventTime` in the same `import { ... } from './events'` block near the top of the file that already imports `formatEventWhen`.

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts -t "formatEventTime"`
Expected: FAIL — `formatEventTime` is not exported from `lib/events.ts` yet.

- [ ] **Step 3: Write minimal implementation**

In `lib/events.ts`, add right after `formatEventWhen`:

```ts
/**
 * The time-only half of formatEventWhen, for a context that already shows
 * the date another way (app/clubs/index.tsx's own DateTile badge) — showing
 * both was a literal repeat of the same date on the same row.
 */
export function formatEventTime(
  startsAt: string,
  timezone: string,
  locale?: string,
): string {
  const when = new Date(startsAt);
  if (Number.isNaN(when.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(locale ?? 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(when);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts -t "formatEventTime"`
Expected: PASS

- [ ] **Step 5: Write the failing test for the three-line game row**

Add to `app/__tests__/clubs.test.tsx`, near the other `GameRow`-rendering tests (search for `formatEventWhen` or `venueName` in this file to find them):

```tsx
  it('shows the game row as club name, time only, and venue — not the event title', async () => {
    render(<ClubsScreen />);
    // The club name and venue are already asserted by neighboring tests
    // using this same fixture — this test's own job is the shape: the
    // event's own title text must be gone, and the time-only label must
    // appear without a repeated date.
    await screen.findByText('Riverside Mah Jongg');
    expect(screen.queryByText('Weekly game')).toBeNull();
    expect(screen.getByText('7:00 pm')).toBeTruthy();
  });
```

Check the file's existing fixtures for the exact event title string used today (search for the `title:` field on the mocked upcoming event/booking, likely `'Weekly game'` or similar) and use that exact string in place of `'Weekly game'` above if it differs — this test's whole point is asserting that string is gone from the row.

- [ ] **Step 6: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "club name, time only, and venue"`
Expected: FAIL — today's row still renders the event title and the combined date+venue line, not a bare time.

- [ ] **Step 7: Write minimal implementation**

In `app/clubs/index.tsx`, add `formatEventTime` to the existing `lib/events` import:

```tsx
import { fetchUpcomingEvents, formatEventTime, formatEventWhen } from '../../lib/events';
```

Replace the `GameRow` body (lines 686-693):

```tsx
            <View style={styles.gameBody}>
              <Text style={styles.gameKicker}>{row.clubName}</Text>
              <Text style={styles.gameTitle}>{row.title}</Text>
              <Text style={styles.help}>
                {formatEventWhen(row.startsAt, row.timezone)}
                {' · '}
                {row.venueName}
              </Text>
            </View>
```

with:

```tsx
            <View style={styles.gameBody}>
              <Text style={styles.gameClubName}>{row.clubName}</Text>
              <Text style={styles.gameTime}>
                {formatEventTime(row.startsAt, row.timezone)}
              </Text>
              <Text style={styles.gameVenue}>{row.venueName}</Text>
            </View>
```

Replace the `gameKicker`/`gameTitle` style pair with three lines of comparable weight:

```tsx
  gameClubName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  gameTime: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: 1,
  },
  gameVenue: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
```

`formatEventWhen` may still be used elsewhere in this same file (check with `grep -n "formatEventWhen" app/clubs/index.tsx` — it is also used in `waitlistNotice`'s `description` and in `needAFourthAlerts`'s callers) — keep the import, do not remove it.

- [ ] **Step 8: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "club name, time only, and venue"`
Expected: PASS

Run the full file, since this touches shared styles/JSX several other tests in it may also assert against:

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests) — if any pre-existing test asserted the old combined "date · venue" line or the event title inside a `GameRow`, update that assertion the same way Step 5 modeled, rather than reverting this task's change.

- [ ] **Step 9: Commit**

```bash
git add lib/events.ts lib/events.test.ts app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(dashboard): restructure the game row to club name, time, and venue"
```

---

### Task 6: Add the `profiles.is_admin` flag

**Files:**
- Create: `supabase/migrations/20260903080000_profiles_is_admin.sql`
- Modify: `lib/profile.ts`
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Profile` type gains an optional `is_admin?: boolean` field; `PROFILE_COLUMNS` includes `is_admin`. Optional (not required) so every existing test fixture that builds a `Profile`-shaped literal without it still type-checks — a real fetch always populates it (the column is `not null default false`), so `is_admin ?? false` is the correct read everywhere this plan reads it later.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260903080000_profiles_is_admin.sql`:

```sql
/*
 * A global admin flag, distinct from the per-club host/co-organizer roles
 * lib/clubs.ts's ClubRole already models — this gates the greetings admin
 * screen (app/admin/greetings.tsx), which is an app-wide concern, not a
 * club-scoped one.
 */
alter table public.profiles
  add column is_admin boolean not null default false;

-- One-time seed: this app's sole admin today. Matched by email since
-- public.profiles itself carries no email column (auth.users does) — see
-- 20260801221252_create_profiles.sql's own profiles table definition.
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'anand.subramanian.0@gmail.com');
```

- [ ] **Step 2: Apply the migration locally and verify the column exists**

Run: `npx supabase migration up`
Expected: the migration applies with no error. If you have a local Supabase stack running (`npx supabase status`), also run:

Run: `npx supabase db execute "select is_admin from public.profiles limit 1;" 2>/dev/null || echo "no local stack — skip, this is verified by the schema-contract test in Step 5 instead"`
Expected: either a column listing with no error, or the skip message — both are fine; the local stack is optional for this step.

- [ ] **Step 3: Update `lib/profile.ts`'s type and column list**

```ts
export type Profile = {
  id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  avatar_url: string | null;
  timezone: string;
  /** Optional so every existing test fixture/mock that builds a
   *  Profile-shaped literal without it still type-checks — a real fetch
   *  always includes it (the column is `not null default false`), so
   *  read it everywhere as `profile.is_admin ?? false`, never bare. */
  is_admin?: boolean;
};
```

```ts
export const PROFILE_COLUMNS =
  'id, display_name, skill_level, avatar_url, timezone, is_admin';
```

- [ ] **Step 4: Write the failing schema-contract assertion**

In `lib/schema-contract.test.ts`, update the exact key-set assertion (around line 271-273):

```ts
    expect(Object.keys(row).sort()).toEqual(
      ['avatar_url', 'display_name', 'id', 'is_admin', 'skill_level', 'timezone'].sort(),
    );
```

Also find the later test (search this same file for `'fetchProfile returns the row the Profile type describes'`, around line 353) and add the new field to its expected object:

```ts
  it('fetchProfile returns the row the Profile type describes', async () => {
    const profile = await fetchProfile(userId);
    expect(profile).toEqual({
      id: userId,
      display_name: SEEDED.display_name,
      skill_level: SEEDED.skill_level,
      avatar_url: null,
      timezone: SEEDED.timezone,
      is_admin: false,
    });
  });
```

(Read the surrounding lines first — the exact object shape/assertion style may differ slightly from this sketch; match whatever pattern is actually there, adding only the `is_admin: false` field.)

- [ ] **Step 5: Run the contract suite**

Run: `npx supabase start` (if not already running), then:
Run: `TZ=America/New_York npm run test:contract`
Expected: PASS. If no local Supabase stack is available in this environment, run the plain suite instead — it self-skips this file with a warning, which is expected and not a failure:

Run: `TZ=America/New_York npx vitest run lib/schema-contract.test.ts`
Expected: the suite logs `[schema-contract] Local Supabase stack not reachable ... skipping` and reports 0 tests run, not a failure.

- [ ] **Step 6: Run the full unit suite to confirm no other fixture broke**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests) — `is_admin` being optional in the TS type means no other test fixture needs touching; if any test unexpectedly fails here, it means something else in the codebase constructs a `Profile` with a strict/exact type check (e.g. a discriminated union or `satisfies Profile` with `exactOptionalPropertyTypes`) — track that down and fix it rather than reverting the optional field.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903080000_profiles_is_admin.sql lib/profile.ts lib/schema-contract.test.ts
git commit -m "feat(profile): add a global is_admin flag, seeded for one account"
```

---

### Task 7: Create the `greetings` table and `lib/greetings.ts`

**Files:**
- Create: `supabase/migrations/20260903090000_create_greetings.sql`
- Create: `lib/greetings.ts`
- Create: `lib/greetings.test.ts`

**Interfaces:**
- Consumes: `lib/supabase.ts`'s `supabase` client (same pattern as every other `lib/*.ts` module).
- Produces:
  - `type Greeting = { id: string; text: string; created_at: string }`
  - `GREETING_COLUMNS: string`
  - `fetchGreetings(): Promise<Greeting[] | null>`
  - `addGreeting(text: string): Promise<{ error: string | null }>`
  - `updateGreeting(id: string, text: string): Promise<{ error: string | null }>`
  - `deleteGreeting(id: string): Promise<{ error: string | null }>`
  - `pickDailyGreeting(greetings: Greeting[], date: Date): Greeting | null`
  - `applyGreetingTemplate(template: string, displayName: string): string`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260903090000_create_greetings.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: applies with no error.

- [ ] **Step 3: Write the failing tests for the pure functions**

Create `lib/greetings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orderAfterSelect = vi.fn();
const insertResult = vi.fn();
const selectAfterUpdate = vi.fn();
const deleteResult = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: orderAfterSelect })),
      insert: insertResult,
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ select: selectAfterUpdate })),
      })),
      delete: vi.fn(() => ({ eq: deleteResult })),
    })),
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  addGreeting,
  applyGreetingTemplate,
  deleteGreeting,
  fetchGreetings,
  pickDailyGreeting,
  updateGreeting,
  type Greeting,
} from './greetings';

beforeEach(() => {
  orderAfterSelect.mockReset();
  orderAfterSelect.mockRejectedValue(new Error('network down'));
  insertResult.mockReset();
  insertResult.mockRejectedValue(new Error('network down'));
  selectAfterUpdate.mockReset();
  selectAfterUpdate.mockRejectedValue(new Error('network down'));
  deleteResult.mockReset();
  deleteResult.mockRejectedValue(new Error('network down'));
});

describe('fetchGreetings', () => {
  it('returns the greetings on success', async () => {
    orderAfterSelect.mockResolvedValue({
      data: [{ id: 'g1', text: 'Hi {name}!', created_at: '2026-09-01T00:00:00Z' }],
      error: null,
    });
    expect(await fetchGreetings()).toEqual([
      { id: 'g1', text: 'Hi {name}!', created_at: '2026-09-01T00:00:00Z' },
    ]);
  });

  it('returns null rather than throwing on a network failure', async () => {
    expect(await fetchGreetings()).toBeNull();
  });

  it('returns null when the read reports an error', async () => {
    orderAfterSelect.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await fetchGreetings()).toBeNull();
  });
});

describe('addGreeting', () => {
  it('reports no error on success', async () => {
    insertResult.mockResolvedValue({ error: null });
    expect(await addGreeting('Welcome, {name}!')).toEqual({ error: null });
  });

  it('reports the generic error on a network failure', async () => {
    expect(await addGreeting('Welcome, {name}!')).toEqual({ error: GENERIC_ERROR });
  });
});

describe('updateGreeting', () => {
  it('reports no error when the write matches a row', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [{ id: 'g1' }], error: null });
    expect(await updateGreeting('g1', 'Updated')).toEqual({ error: null });
  });

  it('reports the generic error when the write matches no rows', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });
    expect(await updateGreeting('g1', 'Updated')).toEqual({ error: GENERIC_ERROR });
  });
});

describe('deleteGreeting', () => {
  it('reports no error on success', async () => {
    deleteResult.mockResolvedValue({ error: null });
    expect(await deleteGreeting('g1')).toEqual({ error: null });
  });

  it('reports the generic error on a network failure', async () => {
    expect(await deleteGreeting('g1')).toEqual({ error: GENERIC_ERROR });
  });
});

describe('pickDailyGreeting', () => {
  const greetings: Greeting[] = [
    { id: 'g1', text: 'One', created_at: '' },
    { id: 'g2', text: 'Two', created_at: '' },
    { id: 'g3', text: 'Three', created_at: '' },
  ];

  it('returns null for an empty list', () => {
    expect(pickDailyGreeting([], new Date('2026-09-03T12:00:00'))).toBeNull();
  });

  it('picks the same greeting for two different times on the same day', () => {
    const morning = pickDailyGreeting(greetings, new Date('2026-09-03T06:00:00'));
    const evening = pickDailyGreeting(greetings, new Date('2026-09-03T23:00:00'));
    expect(morning).toEqual(evening);
  });

  it('can pick a different greeting on a different day', () => {
    const day1 = pickDailyGreeting(greetings, new Date('2026-09-03T12:00:00'));
    const day2 = pickDailyGreeting(greetings, new Date('2026-09-04T12:00:00'));
    // Not guaranteed to differ (only 3 buckets), but both must be valid,
    // real entries from the list either way.
    expect(greetings).toContainEqual(day1);
    expect(greetings).toContainEqual(day2);
  });
});

describe('applyGreetingTemplate', () => {
  it('substitutes the display name for {name}', () => {
    expect(applyGreetingTemplate('Ready to shuffle, {name}?', 'Anand')).toBe(
      'Ready to shuffle, Anand?',
    );
  });

  it('falls back to "Member" for a blank display name', () => {
    expect(applyGreetingTemplate('Hi {name}!', '   ')).toBe('Hi Member!');
  });

  it('substitutes every occurrence of the token', () => {
    expect(applyGreetingTemplate('{name}, welcome back {name}!', 'Sam')).toBe(
      'Sam, welcome back Sam!',
    );
  });
});
```

- [ ] **Step 2 (continued): Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/greetings.test.ts`
Expected: FAIL — `lib/greetings.ts` does not exist yet, so the whole file fails to import.

- [ ] **Step 3: Write minimal implementation**

Create `lib/greetings.ts`:

```ts
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type Greeting = {
  id: string;
  text: string;
  created_at: string;
};

export const GREETING_COLUMNS = 'id, text, created_at';

/** Never rejects — same contract as lib/profile.ts's fetchProfile. */
export async function fetchGreetings(): Promise<Greeting[] | null> {
  try {
    const { data, error } = await supabase
      .from('greetings')
      .select(GREETING_COLUMNS)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('fetchGreetings failed', error);
      return null;
    }
    return (data ?? []) as Greeting[];
  } catch (cause) {
    console.error('fetchGreetings failed', cause);
    return null;
  }
}

/** Never rejects — same contract as lib/profile.ts's updateProfile. */
export async function addGreeting(text: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('greetings').insert({ text });
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('addGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Never rejects. `.select('id')` is what turns a zero-row RLS denial into
 *  an observable failure, the same reason lib/profile.ts's updateProfile
 *  carries it. */
export async function updateGreeting(
  id: string,
  text: string,
): Promise<{ error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('greetings')
      .update({ text })
      .eq('id', id)
      .select('id');
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: GENERIC_ERROR };
    return { error: null };
  } catch (cause) {
    console.error('updateGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Never rejects. */
export async function deleteGreeting(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('greetings').delete().eq('id', id);
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('deleteGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** No fairness/collision-resistance requirement, same reasoning as
 *  lib/dashboard.ts's glyphForClub — this is decoration, not a security
 *  boundary, just "stable across a day, spreads reasonably". */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic, not re-rolled per render: every member sees the same
 * greeting all day (device-local calendar date), and it changes at local
 * midnight. `null` for an empty list — the dashboard simply shows no
 * greeting line in that case, not an error state.
 */
export function pickDailyGreeting(greetings: Greeting[], date: Date): Greeting | null {
  if (greetings.length === 0) return null;
  const index = hashString(localDateKey(date)) % greetings.length;
  return greetings[index];
}

/**
 * Substitutes the signed-in member's own display name for every `{name}`
 * token in a greeting template. Falls back to "Member" for a blank display
 * name — a real, reachable state (a magic-link signup starts with
 * `display_name = ''`), matching the same fallback word
 * app/clubs/[id]/index.tsx's own roster rendering already uses.
 */
export function applyGreetingTemplate(template: string, displayName: string): string {
  const name = displayName.trim().length > 0 ? displayName.trim() : 'Member';
  return template.replaceAll('{name}', name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/greetings.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Add the greetings table to the schema contract suite**

In `lib/schema-contract.test.ts`, add a new `describe` block near the end of the file (after the last existing `describe.runIf(...)` block), following the exact same `signInFreshUser` helper the file already exports/uses for an authenticated, non-service-role probe:

```ts
describe.runIf(reachable || required)('greetings schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    const signedIn = await signInFreshUser();
    admin = signedIn.admin;
    userId = signedIn.userId;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('refuses a write from a non-admin member', async () => {
    const { error } = await supabase.from('greetings').insert({ text: 'Hi {name}' });
    expect(error).not.toBeNull();
  });

  it('lets any signed-in member read the list', async () => {
    const { error } = await supabase.from('greetings').select(GREETING_COLUMNS);
    expect(error).toBeNull();
  });

  it('lets an admin write, and the write round-trips with the right columns', async () => {
    await admin.from('profiles').update({ is_admin: true }).eq('id', userId);
    const { data, error } = await supabase
      .from('greetings')
      .insert({ text: 'Contract test greeting {name}' })
      .select(GREETING_COLUMNS)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'text'].sort());
    expect(row.text).toBe('Contract test greeting {name}');
    await admin.from('greetings').delete().eq('id', row.id as string);
  });
});
```

Add `GREETING_COLUMNS` to this file's own `import { ... } from './greetings'` (a new import line near the other `lib/*.ts` imports at the top of the file).

- [ ] **Step 6: Run the contract suite**

Run: `TZ=America/New_York npm run test:contract` (requires `npx supabase start` first)
Expected: PASS. Without a local stack, confirm the graceful skip instead:

Run: `TZ=America/New_York npx vitest run lib/schema-contract.test.ts`
Expected: skips with the `[schema-contract] Local Supabase stack not reachable` warning, 0 tests run — not a failure.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903090000_create_greetings.sql lib/greetings.ts lib/greetings.test.ts lib/schema-contract.test.ts
git commit -m "feat(greetings): add the greetings table and lib/greetings.ts"
```

---

### Task 8: Show the daily greeting on the Dashboard

**Files:**
- Modify: `app/clubs/index.tsx`
- Test: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `lib/profile.ts`'s `fetchProfile(userId): Promise<Profile | null>`; `lib/greetings.ts`'s `fetchGreetings()`, `pickDailyGreeting(greetings, date)`, `applyGreetingTemplate(template, displayName)`.
- Produces: nothing new for other files — this is the greeting's only consumer.

- [ ] **Step 1: Write the failing test**

Add to `app/__tests__/clubs.test.tsx`, near the top-level mocks (find the existing `vi.mock('../../lib/clubs', ...)`-style block and add a sibling for `lib/profile` and `lib/greetings` if this file does not already mock them — check first with `grep -n "vi.mock('\.\./\.\./lib/profile'\|vi.mock('\.\./\.\./lib/greetings'" app/__tests__/clubs.test.tsx`):

```tsx
vi.mock('../../lib/profile', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
}));
// Only fetchGreetings is a network call worth stubbing -- pickDailyGreeting
// and applyGreetingTemplate are pure, already covered directly by
// lib/greetings.test.ts (Task 7), and this test wants them to run for
// real so it is exercising the actual substitution logic, not a second
// hand-rolled copy of it. `vi.importActual` (not a plain object spread
// referencing an outer `import`) is required here: `vi.mock` factories are
// hoisted above every `import` in the file, so a factory that closed over
// a normally-imported binding would run before that import's assignment
// exists. Declaring `fetchGreetings` as a bare `vi.fn()` below works
// because — same as this file's existing `fetchPendingInvites` mock — the
// factory only reads it through a closure at call time, not at hoist time.
vi.mock('../../lib/greetings', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/greetings')>('../../lib/greetings');
  return {
    ...actual,
    fetchGreetings: (...args: unknown[]) => fetchGreetings(...args),
  };
});
```

Declare the backing mock near this file's other top-level `vi.fn()` declarations (e.g. beside its existing `fetchPendingInvites = vi.fn();`):

```tsx
const fetchProfile = vi.fn();
const fetchGreetings = vi.fn();
```

In `beforeEach`, add defaults alongside this file's other mock resets:

```tsx
  fetchProfile.mockResolvedValue({
    id: 'you',
    display_name: 'Anand',
    skill_level: null,
    avatar_url: null,
    timezone: 'America/New_York',
    is_admin: false,
  });
  fetchGreetings.mockResolvedValue([
    { id: 'g1', text: 'Ready to shuffle, {name}?', created_at: '2026-09-01T00:00:00Z' },
  ]);
```

Then add the test itself, near the other Dashboard-rendering tests:

```tsx
  it('greets the member by name at the top of the dashboard', async () => {
    render(<ClubsScreen />);
    expect(await screen.findByText('Ready to shuffle, Anand?')).toBeTruthy();
  });

  it('shows no greeting line when there are none to show', async () => {
    fetchGreetings.mockResolvedValue([]);
    render(<ClubsScreen />);
    await screen.findByText('Riverside Mah Jongg');
    expect(screen.queryByText(/Ready to shuffle/)).toBeNull();
  });
```

(Use whatever club-name fixture string this file's existing tests already use in place of `'Riverside Mah Jongg'` in the second test, if it differs — that line only exists to wait for the screen's normal content to finish loading before asserting the negative.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "greets the member by name"`
Expected: FAIL — the dashboard renders no greeting text yet.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/index.tsx`, add the imports:

```tsx
import { applyGreetingTemplate, fetchGreetings, pickDailyGreeting } from '../../lib/greetings';
import type { Greeting } from '../../lib/greetings';
import { fetchProfile } from '../../lib/profile';
```

Add state, near the other `useState` declarations (after `const { byClub: unreadByClub } = useUnreadCounts();`):

```tsx
  const [displayName, setDisplayName] = useState('');
  const [greetings, setGreetings] = useState<Greeting[]>([]);
```

Extend the existing mount `useEffect` (lines 150-181) to also fetch these — add these two calls alongside the existing `fetchMyClubs`/`fetchMyUpcomingBookings`/`fetchMyRoles` calls in that same effect:

```tsx
    fetchProfile(userId).then((result) => {
      if (cancelled) return;
      if (result) setDisplayName(result.display_name);
    });
    fetchGreetings().then((result) => {
      if (cancelled) return;
      setGreetings(result ?? []);
    });
```

Add a derived value right before the final `return` (after `const scopeClubId = ...`):

```tsx
  const todaysGreeting = pickDailyGreeting(greetings, new Date());
  const greetingText = todaysGreeting
    ? applyGreetingTemplate(todaysGreeting.text, displayName)
    : null;
```

Render it as the first child of the main return's `<Screen>` (immediately before the `{scope.kicker === 'Your club' ? (...) : null}` block, around line 500-501):

```tsx
      {greetingText ? <Text style={styles.greeting}>{greetingText}</Text> : null}
```

Add the style, in the same `StyleSheet.create` block as this file's other top-level text styles:

```tsx
  greeting: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "greets the member by name"`
Expected: PASS

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "shows no greeting line"`
Expected: PASS

Run the full file:

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(dashboard): show a daily, admin-managed, personalized greeting"
```

---

### Task 9: Admin screen to manage greetings, linked from Profile

**Files:**
- Create: `app/admin/greetings.tsx`
- Create: `app/__tests__/admin-greetings.test.tsx`
- Modify: `app/profile.tsx`
- Test: `app/__tests__/profile.test.tsx`

**Interfaces:**
- Consumes: `lib/greetings.ts`'s `fetchGreetings`, `addGreeting`, `updateGreeting`, `deleteGreeting`, `type Greeting`; `lib/profile.ts`'s `fetchProfile`.
- Produces: a new route `/admin/greetings`; nothing else consumes it.

- [ ] **Step 1: Write the failing test for the Profile screen's admin-only link**

Add to `app/__tests__/profile.test.tsx`, near its other `fetchProfile.mockResolvedValue(...)`-driven tests:

```tsx
  it('does not show a Greetings admin card for an ordinary member', async () => {
    fetchProfile.mockResolvedValue({
      id: 'you',
      display_name: 'Anand',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
      is_admin: false,
    });
    render(<ProfileScreen />);
    await screen.findByText('Friends');
    expect(screen.queryByText('Greetings')).toBeNull();
  });

  it('shows a Greetings admin card for an admin', async () => {
    fetchProfile.mockResolvedValue({
      id: 'you',
      display_name: 'Anand',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
      is_admin: true,
    });
    render(<ProfileScreen />);
    expect(await screen.findByText('Greetings')).toBeTruthy();
  });
```

(Check this file's existing `fetchProfile` mock fixtures first — every one of them will now need an `is_admin: false` field added if the `Profile` mock objects are asserted by strict equality anywhere in this file's other tests; add it to keep those tests unchanged in behavior. `is_admin` being optional in the TS type means this is only needed where a test's own assertions inspect the object, not for every mock call.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/profile.test.tsx -t "Greetings admin card"`
Expected: FAIL — Profile screen has no Greetings card yet, so neither test finds/fails to find it correctly (the "does not show" test passes vacuously today; the "shows" test fails).

- [ ] **Step 3: Update `app/profile.tsx`**

Add state and read `is_admin` from the existing `fetchProfile` call:

```tsx
  const [isAdmin, setIsAdmin] = useState(false);
```

In the existing `fetchProfile(userId).then((profile) => { ... })` callback, add:

```tsx
      if (profile) {
        setDisplayName(profile.display_name);
        setSkillLevel(profile.skill_level);
        setIsAdmin(profile.is_admin ?? false);
      } else {
```

Add a new settings card, right after the existing "Friends" card (`app/profile.tsx:218-226`), rendered only for an admin:

```tsx
      {isAdmin ? (
        <Card style={styles.settingsCard}>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Greetings</Text>
            <Link href="/admin/greetings" style={styles.editLink}>
              <Text style={styles.editLinkText}>Manage</Text>
            </Link>
          </View>
          <Text style={styles.help}>The dashboard's daily greeting</Text>
        </Card>
      ) : null}
```

`Link` is already imported from `expo-router` at the top of this file (alongside `Redirect`) — no new import needed for it.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/profile.test.tsx`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Write the failing test for the admin screen itself**

Create `app/__tests__/admin-greetings.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGreetings = vi.fn();
const addGreeting = vi.fn();
const updateGreeting = vi.fn();
const deleteGreeting = vi.fn();

vi.mock('../../lib/greetings', () => ({
  fetchGreetings: (...args: unknown[]) => fetchGreetings(...args),
  addGreeting: (...args: unknown[]) => addGreeting(...args),
  updateGreeting: (...args: unknown[]) => updateGreeting(...args),
  deleteGreeting: (...args: unknown[]) => deleteGreeting(...args),
}));

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push }),
  Redirect: ({ href }: { href: string }) => <div data-testid={`redirect-${href}`} />,
}));

const session = { user: { id: 'you' } };
let sessionState: { session: typeof session | null; loading: boolean } = {
  session,
  loading: false,
};
vi.mock('../../lib/session', () => ({
  useSession: () => sessionState,
}));

import AdminGreetingsScreen from '../admin/greetings';

beforeEach(() => {
  sessionState = { session, loading: false };
  fetchGreetings.mockReset();
  fetchGreetings.mockResolvedValue([
    { id: 'g1', text: 'Ready to shuffle, {name}?', created_at: '2026-09-01T00:00:00Z' },
  ]);
  addGreeting.mockReset();
  addGreeting.mockResolvedValue({ error: null });
  updateGreeting.mockReset();
  updateGreeting.mockResolvedValue({ error: null });
  deleteGreeting.mockReset();
  deleteGreeting.mockResolvedValue({ error: null });
  push.mockReset();
});

describe('AdminGreetingsScreen', () => {
  it('lists the existing greetings', async () => {
    render(<AdminGreetingsScreen />);
    expect(await screen.findByText('Ready to shuffle, {name}?')).toBeTruthy();
  });

  it('adds a new greeting', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.change(screen.getByLabelText('New greeting'), {
      target: { value: 'Welcome back, {name}!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addGreeting).toHaveBeenCalledWith('Welcome back, {name}!'));
  });

  it('deletes a greeting', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.click(screen.getByLabelText('Delete Ready to shuffle, {name}?'));
    await waitFor(() => expect(deleteGreeting).toHaveBeenCalledWith('g1'));
  });

  it('edits an existing greeting in place', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.click(screen.getByLabelText('Edit Ready to shuffle, {name}?'));
    const field = screen.getByLabelText('Edit greeting text');
    fireEvent.change(field, { target: { value: 'Updated greeting, {name}!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateGreeting).toHaveBeenCalledWith('g1', 'Updated greeting, {name}!'),
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/admin-greetings.test.tsx`
Expected: FAIL — `app/admin/greetings.tsx` does not exist yet (and once it exists after Step 7 below, the "edits an existing greeting" test specifically will still fail until Step 7's code includes the inline-edit affordance, which it does).

- [ ] **Step 7: Write minimal implementation**

Create `app/admin/greetings.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import TextField from '../../components/TextField';
import { ChevronLeftIcon } from '../../components/icons';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  addGreeting,
  deleteGreeting,
  fetchGreetings,
  updateGreeting,
  type Greeting,
} from '../../lib/greetings';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

/**
 * The admin-only screen behind Profile's "Greetings" card
 * (app/profile.tsx), gated there on `profile.is_admin` — this screen
 * itself does not re-check that flag, since RLS (greetings_admin_write,
 * 20260903090000_create_greetings.sql) is the real backstop: a non-admin
 * who navigates here directly gets a clean, worded refusal from `addGreeting`
 * etc. rather than a silently-broken form.
 */
export default function AdminGreetingsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [greetings, setGreetings] = useState<Greeting[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The one greeting currently open for editing, if any -- only one at a
  // time, matching this screen's own single add-field affordance below.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    const result = await fetchGreetings();
    setGreetings(result);
    if (result === null) setError(GENERIC_ERROR);
    setReady(true);
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  async function onAdd() {
    if (busyRef.current || newText.trim().length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await addGreeting(newText.trim());
    if (refusal) {
      setError(refusal);
    } else {
      setNewText('');
      await load();
    }
    busyRef.current = false;
    setBusy(false);
  }

  async function onDelete(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await deleteGreeting(id);
    if (refusal) setError(refusal);
    else await load();
    busyRef.current = false;
    setBusy(false);
  }

  function onStartEdit(g: Greeting) {
    setEditingId(g.id);
    setEditText(g.text);
  }

  function onCancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function onSaveEdit() {
    if (busyRef.current || !editingId || editText.trim().length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await updateGreeting(editingId, editText.trim());
    if (refusal) {
      setError(refusal);
    } else {
      setEditingId(null);
      setEditText('');
      await load();
    }
    busyRef.current = false;
    setBusy(false);
  }

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/profile')}
        accessibilityLabel="Back to profile"
        style={styles.backButton}
      >
        Profile
      </Button>

      <Text style={styles.heading}>Greetings</Text>
      <Text style={styles.intro}>
        Shown once per day at the top of the Dashboard. Use {'{name}'} anywhere
        you want the signed-in member's own name.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        (greetings ?? []).map((g) =>
          editingId === g.id ? (
            <Card key={g.id} style={styles.row}>
              <TextField
                label="Edit greeting text"
                value={editText}
                onChangeText={setEditText}
              />
              <View style={styles.editActions}>
                <Button variant="secondary" big={false} disabled={busy} onPress={() => void onSaveEdit()}>
                  Save
                </Button>
                <Button variant="ghost" big={false} disabled={busy} onPress={onCancelEdit}>
                  Cancel
                </Button>
              </View>
            </Card>
          ) : (
            <Card key={g.id} row style={styles.row}>
              <Text style={styles.greetingText}>{g.text}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${g.text}`}
                disabled={busy}
                onPress={() => onStartEdit(g)}
              >
                <Text style={styles.edit}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${g.text}`}
                disabled={busy}
                onPress={() => void onDelete(g.id)}
              >
                <Text style={styles.remove}>Delete</Text>
              </Pressable>
            </Card>
          ),
        )
      )}

      <TextField
        label="New greeting"
        value={newText}
        onChangeText={setNewText}
        placeholder="Ready to shuffle, {name}?"
      />
      <Button variant="secondary" disabled={busy} onPress={() => void onAdd()}>
        Add
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h1,
    color: colors.text,
  },
  intro: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  row: { alignItems: 'center', gap: space[3] },
  greetingText: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  edit: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
  remove: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
  editActions: {
    flexDirection: 'row',
    gap: space[2],
  },
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/admin-greetings.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 9: Run the full suite**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests across the whole repo)

- [ ] **Step 10: Commit**

```bash
git add app/admin/greetings.tsx app/__tests__/admin-greetings.test.tsx app/profile.tsx app/__tests__/profile.test.tsx
git commit -m "feat(admin): add the greetings management screen, linked from Profile"
```

---

### Task 10: Messages list shows the club mahjong tile instead of a plain circle

**Files:**
- Modify: `components/ThreadRow.tsx:69`
- Test: `components/__tests__/ThreadRow.test.tsx`

**Interfaces:**
- Consumes: `components/ThreadAvatar.tsx`'s existing `asTile`/`clubId` props (unchanged).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `components/__tests__/ThreadRow.test.tsx`, replace the existing test:

```tsx
  it('shows the club’s initials in the avatar for a club thread', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    const avatar = screen.getByTestId('thread-avatar-club');
    expect(avatar.textContent).toBe('R');
  });
```

with:

```tsx
  it('shows the club as a mahjong tile, carrying its initials, in the avatar', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    // Not asserting the exact textContent string: the tile also renders a
    // suit/honor glyph (some are characters, e.g. 北, sharing the DOM text
    // node with the initials) alongside the initials, and the exact glyph
    // is a stable hash of the club id, not something this test should pin.
    const avatar = screen.getByTestId('thread-avatar-club-tile');
    expect(avatar.textContent).toContain('R');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/ThreadRow.test.tsx -t "mahjong tile"`
Expected: FAIL — no element with `testID="thread-avatar-club-tile"` exists yet; `ThreadRow` still renders the plain circle.

- [ ] **Step 3: Write minimal implementation**

In `components/ThreadRow.tsx`, change:

```tsx
<ThreadAvatar kind={row.kind} name={row.kind === 'club' ? row.club_name ?? '' : title} />
```

to:

```tsx
<ThreadAvatar
  kind={row.kind}
  name={row.kind === 'club' ? row.club_name ?? '' : title}
  asTile={row.kind === 'club'}
  clubId={row.kind === 'club' ? row.club_id ?? undefined : undefined}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/ThreadRow.test.tsx`
Expected: PASS (all tests) — every non-club-row test (direct/group/game) is unaffected, since `asTile` is `false` and `clubId` is `undefined` for those.

- [ ] **Step 5: Run the Messages screen's own test file to confirm no regression**

Run: `TZ=America/New_York npx vitest run app/__tests__/messages.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add components/ThreadRow.tsx components/__tests__/ThreadRow.test.tsx
git commit -m "fix(messages): show the club's mahjong tile instead of a plain circle"
```

---

### Task 11: Schema and RPC support for a per-game fee (cost to play / minimum spend)

**Files:**
- Create: `supabase/migrations/20260903130000_event_fees.sql`
- Create: `supabase/migrations/20260903140000_event_fee_mutations.sql`
- Create: `supabase/migrations/20260903150000_my_upcoming_bookings_fees.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: `events.fee_cents`, `events.min_spend_cents`, `event_series.fee_cents`, `event_series.min_spend_cents` columns; `create_event`/`create_event_series` gain trailing `fee_cents`/`min_spend_cents` params (default `0`); `update_event`/`update_event_series` gain trailing `new_fee_cents`/`new_min_spend_cents` params (default `null`, meaning "leave alone"); `my_upcoming_bookings` gains `fee_cents`/`min_spend_cents` OUT columns.

This task is SQL-only — there is no JS/TS to unit-test here (that is Task 12). Verification is a real Postgres apply plus the (optional, local-stack-gated) schema-contract suite.

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/20260903130000_event_fees.sql`:

```sql
/*
 * Two optional per-game money fields, following check_in_required's own
 * shape exactly (supabase/migrations/20260827000000_check_in_required.sql):
 * both live on `event_series` (the template) and `events` (each
 * materialization), so a weekly host sets a price once and every future
 * occurrence inherits it via materialize_one_series.
 *
 * Stored as integer cents, not `numeric` dollars, so nothing above this
 * layer ever does float arithmetic on money. `0` means "not set" — there is
 * no reading of "explicitly free" that differs from "never priced" for
 * display purposes, so this follows the same "always a real value, never
 * NULL" convention `notes`/`check_in_required` already established.
 */
alter table public.event_series
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);

alter table public.events
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);

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
                       'check_in_required', 'fee_cents', 'min_spend_cents']
    and array_ndims(overrides) = 1
  );

/*
 * Replaced only to carry fee_cents/min_spend_cents onto each occurrence.
 * Signature is unchanged (same two arguments, same `returns int`), so this
 * is a plain `create or replace`, not a drop-and-recreate — unlike the RPCs
 * in the next migration, whose PARAMETER lists actually change.
 *
 * Everything else is 20260827000000_check_in_required.sql's own body,
 * unchanged — including its own already-corrected deviation from an
 * earlier brief (the current_date floor, the ended_at guard, and the
 * (series_id, occurrence_date) conflict target).
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
      fee_cents, min_spend_cents, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.fee_cents, s.min_spend_cents, s.created_by
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

  return created;
end;
$$;
```

- [ ] **Step 2: Apply and sanity-check**

Run: `npx supabase migration up`
Expected: applies with no error.

- [ ] **Step 3: Write the RPC-mutations migration**

Create `supabase/migrations/20260903140000_event_fee_mutations.sql`. Each function is dropped and recreated with `fee_cents`/`min_spend_cents` (or `new_fee_cents`/`new_min_spend_cents`) added, bodies copied from `20260827010000_event_mutations_check_in.sql` (each function's own last redefinition) with the fee fields threaded through exactly the way `check_in`/`check_in_required` already are there:

```sql
/*
 * Same drop-and-recreate dance as 20260827010000_event_mutations_check_in.sql
 * (whose own header comment explains why `create or replace` cannot add a
 * parameter): two new trailing, defaulted arguments on each of these four,
 * bodies copied byte-for-byte from that migration (each function's own most
 * recent redefinition), with fee_cents/min_spend_cents threaded through
 * exactly where check_in/check_in_required already are.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean);

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
  min_spend_cents  int default 0
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

  select c.timezone into club_tz from public.clubs c where c.id = target_club;

  starts := (event_date + start_time) at time zone club_tz;

  if starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
drop function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean);

create function public.update_event(
  target_event         uuid,
  new_title            text default null,
  new_venue_id         uuid default null,
  new_notes            text default null,
  new_date             date default null,
  new_start_time       time default null,
  new_duration_minutes int default null,
  new_check_in_required boolean default null,
  new_fee_cents        int default null,
  new_min_spend_cents  int default null
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
    overrides          = next_overrides
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean);

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
  ends_on       date default null,
  check_in      boolean default false,
  fee_cents     int default 0,
  min_spend_cents int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
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

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, auth.uid()
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
  int, int, date, date, boolean, int, int)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------------
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean);

create function public.update_event_series(
  target_series      uuid,
  new_title          text default null,
  new_venue_id       uuid default null,
  new_notes          text default null,
  new_start_time     time default null,
  new_duration       int default null,
  new_table_count    int default null,
  new_ends_on        date default null,
  include_overridden boolean default false,
  clear_ends_on      boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents      int default null,
  new_min_spend_cents int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se            public.event_series;
  club_tz       text;
  eff_title     text;
  eff_venue     uuid;
  eff_notes     text;
  eff_start     time;
  eff_dur       int;
  eff_count     int;
  eff_ends      date;
  eff_check_in  boolean;
  eff_fee       int;
  eff_min_spend int;
  touched_title boolean;
  touched_venue boolean;
  touched_notes boolean;
  touched_time  boolean;
  touched_check_in boolean;
  touched_fee   boolean;
  touched_min_spend boolean;
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
    min_spend_cents  = eff_min_spend
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
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  to authenticated;
```

- [ ] **Step 4: Apply and sanity-check**

Run: `npx supabase migration up`
Expected: applies with no error. If unsure any function signature above is
stale by the time this is implemented, re-run the same grep this plan used
to find it (`grep -rl "create or replace function public.<name>(\|create
function public.<name>(" supabase/migrations/*.sql`, sorted by filename) and
diff against what's here before writing the drop statement — dropping the
wrong signature fails loudly (`function ... does not exist`), which is safe,
but confirm first rather than guessing.

- [ ] **Step 5: Write the `my_upcoming_bookings` migration**

Create `supabase/migrations/20260903150000_my_upcoming_bookings_fees.sql`, body copied from `20260827070000_my_upcoming_bookings_check_in.sql` (its own last redefinition) with two new OUT columns:

```sql
/*
 * Two more columns, same drop-and-recreate dance
 * 20260827070000_my_upcoming_bookings_check_in.sql already documents for
 * this exact function (a `returns table` function's columns are OUT
 * parameters; `create or replace` refuses to change them, 42P13).
 */
drop function if exists public.my_upcoming_bookings();

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
  offer_expires_at timestamptz,
  waitlist_position  int,
  check_in_required  boolean,
  check_in_state     public.attendance_state,
  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,
  fee_cents          int,
  min_spend_cents    int
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
    po.id, po.offered_seat_count, po.expires_at,
    case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    e.check_in_required,
    ci.state,
    case when e.check_in_required
         then e.starts_at - interval '1 hour' end,
    case when e.check_in_required then e.ends_at end,
    e.fee_cents,
    e.min_spend_cents
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
  left join public.check_ins ci
    on ci.event_id = b.event_id and ci.profile_id = b.profile_id
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted')
    and e.status = 'published'
    and e.ends_at > now()
  order by e.starts_at, c.name;
$$;

revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant execute on function public.my_upcoming_bookings() to authenticated;
```

- [ ] **Step 6: Apply**

Run: `npx supabase migration up`
Expected: applies with no error.

- [ ] **Step 7: Run the full unit suite** (nothing in JS references these columns/params yet, so this is just a smoke check that nothing else broke)

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260903130000_event_fees.sql supabase/migrations/20260903140000_event_fee_mutations.sql supabase/migrations/20260903150000_my_upcoming_bookings_fees.sql
git commit -m "feat(events): add fee_cents/min_spend_cents to events, event_series, and their RPCs"
```

---

### Task 12: Thread the fee fields through `lib/events.ts`, `lib/bookings.ts`, and `lib/dashboard.ts`

**Files:**
- Modify: `lib/events.ts`
- Modify: `lib/events.test.ts`
- Modify: `lib/bookings.ts`
- Modify: `lib/dashboard.ts`
- Modify: `lib/dashboard.test.ts`
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: Task 11's new columns/RPC params.
- Produces: `ClubEvent.fee_cents: number`, `ClubEvent.min_spend_cents: number`, `EventSeries.fee_cents: number`, `EventSeries.min_spend_cents: number`, `MyBooking.fee_cents: number`, `MyBooking.min_spend_cents: number`, `DashboardRow.feeCents: number`, `DashboardRow.minSpendCents: number`; `createEvent`/`createEventSeries` require `feeCents`/`minSpendCents: number`; `updateEvent`/`updateEventSeries` accept optional `feeCents`/`minSpendCents?: number | null`; `formatFeeCents(cents: number): string`; `parseDollarsToCents(value: string): number`.

- [ ] **Step 1: Write the failing tests for the new pure helpers**

Add to `lib/events.test.ts`, after the `formatEventTime` describe block:

```ts
describe('formatFeeCents', () => {
  it('formats a whole-dollar amount with no cents', () => {
    expect(formatFeeCents(1500)).toBe('$15');
  });

  it('formats an amount with cents', () => {
    expect(formatFeeCents(1550)).toBe('$15.50');
  });

  it('formats zero', () => {
    expect(formatFeeCents(0)).toBe('$0');
  });
});

describe('parseDollarsToCents', () => {
  it('parses a plain dollar amount', () => {
    expect(parseDollarsToCents('15')).toBe(1500);
  });

  it('parses a dollar amount with cents', () => {
    expect(parseDollarsToCents('15.5')).toBe(1550);
  });

  it('treats a blank string as zero', () => {
    expect(parseDollarsToCents('')).toBe(0);
    expect(parseDollarsToCents('   ')).toBe(0);
  });

  it('treats unparseable text as zero', () => {
    expect(parseDollarsToCents('free')).toBe(0);
  });

  it('clamps a negative amount to zero', () => {
    expect(parseDollarsToCents('-5')).toBe(0);
  });
});
```

Add `formatFeeCents` and `parseDollarsToCents` to this file's existing `import { ... } from './events'` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts -t "formatFeeCents|parseDollarsToCents"`
Expected: FAIL — neither function is exported yet.

- [ ] **Step 3: Write minimal implementation for the helpers**

In `lib/events.ts`, add right after `formatEventTime`:

```ts
/**
 * Cents to a display string — `$15` for a whole dollar amount, `$15.50`
 * once cents are involved. Stored/compared as integer cents everywhere
 * above this function specifically so nothing does float arithmetic on
 * money; this is the one place that turns cents back into a dollar string.
 */
export function formatFeeCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * A host's typed dollar string to integer cents. Blank or unparseable text
 * is `0` ("not set"), and a negative amount is clamped to `0` — the
 * database's own `check (... >= 0)` is the real backstop; this only avoids
 * a round-trip error for an obviously-bad client value.
 */
export function parseDollarsToCents(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts -t "formatFeeCents|parseDollarsToCents"`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the type/RPC-argument plumbing**

In `lib/events.test.ts`'s `describe('createEvent', ...)` block, add `feeCents: 0, minSpendCents: 0` to the shared `validInput` object, and update the exact-match assertion:

```ts
  const validInput = {
    clubId: 'club-1',
    title: 'Tuesday Mahjong',
    venueId: 'venue-1',
    notes: '',
    date: '2027-09-07',
    startTime: '19:00',
    durationMinutes: 180,
    tableCount: 2,
    checkInRequired: false,
    feeCents: 0,
    minSpendCents: 0,
  };
```

```ts
    expect(rpcMock).toHaveBeenCalledWith('create_event', {
      target_club: 'club-1',
      event_title: 'Tuesday Mahjong',
      target_venue: 'venue-1',
      event_notes: '',
      event_date: '2027-09-07',
      start_time: '19:00',
      duration_minutes: 180,
      table_count: 2,
      check_in: false,
      fee_cents: 0,
      min_spend_cents: 0,
    });
```

Add a new test in the same block:

```ts
  it('sends fee_cents and min_spend_cents on create', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'event-1', error: null });
    await createEvent({ ...validInput, feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ fee_cents: 1500, min_spend_cents: 2000 }),
    );
  });
```

In `describe('updateEvent', ...)`, update its two full exact-match assertions:

```ts
    expect(rpcMock).toHaveBeenCalledWith('update_event', {
      target_event: 'event-1',
      new_title: null,
      new_venue_id: null,
      new_notes: null,
      new_date: '2027-11-07',
      new_start_time: '19:00',
      new_duration_minutes: 240,
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
```

```ts
    expect(rpcMock).toHaveBeenCalledWith('update_event', {
      target_event: 'event-1',
      new_title: 'Renamed',
      new_venue_id: null,
      new_notes: null,
      new_date: null,
      new_start_time: null,
      new_duration_minutes: null,
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
```

and add a new test in the same block:

```ts
  it('sends new_fee_cents and new_min_spend_cents on update', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEvent('event-1', { feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event',
      expect.objectContaining({ new_fee_cents: 1500, new_min_spend_cents: 2000 }),
    );
  });
```

In `describe('updateEventSeries', ...)`, update its two full exact-match assertions:

```ts
    expect(rpcMock).toHaveBeenCalledWith('update_event_series', {
      target_series: 'series-1',
      new_title: 'Renamed',
      new_venue_id: null,
      new_notes: null,
      new_start_time: null,
      new_duration: null,
      new_table_count: null,
      new_ends_on: null,
      include_overridden: false,
      clear_ends_on: false,
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
```

```ts
    expect(rpcMock).toHaveBeenCalledWith('update_event_series', {
      target_series: 'series-1',
      new_title: null,
      new_venue_id: null,
      new_notes: null,
      new_start_time: null,
      new_duration: null,
      new_table_count: null,
      new_ends_on: null,
      include_overridden: false,
      clear_ends_on: true,
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
```

and add a new test in the same block:

```ts
  it('sends new_fee_cents and new_min_spend_cents on update series', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEventSeries('series-1', { feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event_series',
      expect.objectContaining({ new_fee_cents: 1500, new_min_spend_cents: 2000 }),
    );
  });
```

In `describe('createEventSeries', ...)`, add `feeCents: 0, minSpendCents: 0` to its shared `validInput` fixture:

```ts
  const validInput = {
    clubId: 'club-1',
    title: 'Weekly Mahjong',
    venueId: 'venue-1',
    notes: '',
    frequency: 'weekly' as const,
    weekday: 2,
    nthWeek: null,
    startTime: '19:00:00',
    durationMinutes: 180,
    tableCount: 1,
    startsOn: '2027-01-01',
    endsOn: null,
    checkInRequired: false,
    feeCents: 0,
    minSpendCents: 0,
  };
```

and add a new test in the same block:

```ts
  it('sends fee_cents and min_spend_cents on create series', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'series-1', error: null });
    await createEventSeries({ ...validInput, feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event_series',
      expect.objectContaining({ fee_cents: 1500, min_spend_cents: 2000 }),
    );
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts`
Expected: FAIL — `createEvent`/`updateEvent`/`createEventSeries`/`updateEventSeries` don't accept or send these fields yet, so both the updated exact-match assertions and the new tests fail.

- [ ] **Step 7: Write minimal implementation for the types and RPC wrappers**

In `lib/events.ts`:

```ts
export type OverrideKey =
  | 'title'
  | 'venue_id'
  | 'notes'
  | 'starts_at'
  | 'check_in_required'
  | 'fee_cents'
  | 'min_spend_cents';
```

Add to `ClubEvent` (after `check_in_required: boolean;`):

```ts
  /** Integer cents. `0` means "no fee set" — see lib/events.ts's
   *  formatFeeCents/parseDollarsToCents for the display/parse boundary. */
  fee_cents: number;
  /** Integer cents. `0` means "no minimum spend set". */
  min_spend_cents: number;
```

Add the identical two fields (with the identical doc comment) to `EventSeries`, after its own `check_in_required: boolean;`.

```ts
export const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, check_in_required, fee_cents, ' +
  'min_spend_cents, venues(name), ' +
  'event_tables(id, capacity, label), bookings(profile_id, status, event_table_id)';

export const SERIES_COLUMNS =
  'id, club_id, title, venue_id, notes, frequency, weekday, nth_week, start_time, duration_minutes, table_count, starts_on, ends_on, ended_at, check_in_required, fee_cents, min_spend_cents, venues(name)';
```

In `createEvent`'s input type and RPC call:

```ts
export async function createEvent(input: {
  clubId: string;
  title: string;
  venueId: string;
  notes: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  tableCount: number;
  checkInRequired: boolean;
  /** Integer cents. `0` for "no fee". */
  feeCents: number;
  /** Integer cents. `0` for "no minimum spend". */
  minSpendCents: number;
}): Promise<{ eventId: string | null; error: string | null }> {
  try {
    if (input.title.trim().length === 0) {
      return { eventId: null, error: 'Give the game a name.' };
    }
    const { data, error } = await supabase.rpc('create_event', {
      target_club: input.clubId,
      event_title: input.title.trim(),
      target_venue: input.venueId,
      event_notes: input.notes.trim(),
      event_date: input.date,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      table_count: input.tableCount,
      check_in: input.checkInRequired,
      fee_cents: input.feeCents,
      min_spend_cents: input.minSpendCents,
    });

    if (error || !data) {
      console.error('createEvent failed', error);
      return { eventId: null, error: rpcErrorMessage(error) };
    }
    return { eventId: data as string, error: null };
  } catch (cause) {
    console.error('createEvent failed', cause);
    return { eventId: null, error: GENERIC_ERROR };
  }
}
```

In `updateEvent`'s input type and RPC call, add alongside `checkInRequired`:

```ts
    checkInRequired?: boolean | null;
    /** Null/omitted means "leave this alone". Integer cents. */
    feeCents?: number | null;
    /** Null/omitted means "leave this alone". Integer cents. */
    minSpendCents?: number | null;
```

```ts
    const { error } = await supabase.rpc('update_event', {
      target_event: eventId,
      new_title: input.title ?? null,
      new_venue_id: input.venueId ?? null,
      new_notes: input.notes ?? null,
      new_date: input.date ?? null,
      new_start_time: input.startTime ?? null,
      new_duration_minutes: input.durationMinutes ?? null,
      new_check_in_required: input.checkInRequired ?? null,
      new_fee_cents: input.feeCents ?? null,
      new_min_spend_cents: input.minSpendCents ?? null,
    });
```

In `createEventSeries`'s input type and RPC call, mirroring `createEvent`:

```ts
  checkInRequired: boolean;
  feeCents: number;
  minSpendCents: number;
}): Promise<{ seriesId: string | null; error: string | null }> {
  try {
    if (input.title.trim().length === 0) {
      return { seriesId: null, error: 'Give the game a name.' };
    }
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
      check_in: input.checkInRequired,
      fee_cents: input.feeCents,
      min_spend_cents: input.minSpendCents,
    });
```

In `updateEventSeries`'s input type and RPC call, mirroring `updateEvent`:

```ts
    checkInRequired?: boolean | null;
    feeCents?: number | null;
    minSpendCents?: number | null;
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
      clear_ends_on: input.clearEndsOn ?? false,
      new_check_in_required: input.checkInRequired ?? null,
      new_fee_cents: input.feeCents ?? null,
      new_min_spend_cents: input.minSpendCents ?? null,
    });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/events.test.ts`
Expected: PASS (all tests)

- [ ] **Step 9: Update `lib/bookings.ts`'s `MyBooking` type**

```ts
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
  /** Integer cents. `0` means "no fee set". */
  fee_cents: number;
  /** Integer cents. `0` means "no minimum spend set". */
  min_spend_cents: number;
};
```

- [ ] **Step 10: Write the failing test for `DashboardRow`/`buildDashboardRows`**

In `lib/dashboard.test.ts`, add `fee_cents: 0, min_spend_cents: 0` to both the `event()` and `booking()` fixture factories' default objects (right after each one's `check_in_required: false,` line), then add a new test near the existing `buildDashboardRows` tests:

```ts
  it('carries fee_cents and min_spend_cents from a booking-sourced row', () => {
    const rows = buildDashboardRows({
      bookings: [booking({ fee_cents: 1500, min_spend_cents: 2000 })],
      events: [],
      clubs: CLUBS,
      userId: 'me',
    });
    expect(rows[0].feeCents).toBe(1500);
    expect(rows[0].minSpendCents).toBe(2000);
  });

  it('carries fee_cents and min_spend_cents from an event-sourced (joinable) row', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          starts_at: '2026-09-05T23:00:00Z',
          ends_at: '2026-09-06T02:00:00Z',
          fee_cents: 1000,
          min_spend_cents: 0,
        }),
      ],
      clubs: CLUBS,
      userId: 'someone-else',
      now: NOW,
    });
    expect(rows[0].feeCents).toBe(1000);
    expect(rows[0].minSpendCents).toBe(0);
  });
```

(Check the file's existing joinable-row test just above this one for the exact `now`/`starts_at` values that satisfy `hasFreeSeat`/the joinable window — reuse those exact values rather than the illustrative ones above if they differ, so this test actually exercises the joinable branch rather than being filtered out.)

- [ ] **Step 11: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/dashboard.test.ts -t "fee_cents and min_spend_cents"`
Expected: FAIL — `DashboardRow` has no `feeCents`/`minSpendCents` yet.

- [ ] **Step 12: Write minimal implementation**

In `lib/dashboard.ts`, add to `DashboardRow`:

```ts
  organizing: boolean;
  /** Integer cents, copied from whichever source (MyBooking or ClubEvent)
   *  built this row. `0` means "no fee set". */
  feeCents: number;
  /** Integer cents. `0` means "no minimum spend set". */
  minSpendCents: number;
};
```

In `buildDashboardRows`, add to the booking-sourced row construction:

```ts
  const rows: DashboardRow[] = input.bookings.map((booking) => ({
    eventId: booking.event_id,
    clubId: booking.club_id,
    clubName: booking.club_name,
    title: booking.event_title,
    startsAt: booking.starts_at,
    timezone: booking.club_timezone,
    venueName: booking.venue_name,
    booking,
    joinable: false,
    organizing: false,
    feeCents: booking.fee_cents,
    minSpendCents: booking.min_spend_cents,
  }));
```

And to the event-sourced row construction:

```ts
    rows.push({
      eventId: event.id,
      clubId: event.club_id,
      clubName: club.name,
      title: event.title,
      startsAt: event.starts_at,
      venueName: event.venue_name,
      booking: null,
      joinable: !started,
      organizing: started && !ended,
      feeCents: event.fee_cents,
      minSpendCents: event.min_spend_cents,
    });
```

(Keep every other existing field on both object literals exactly as-is — only the two new lines are additions.)

- [ ] **Step 13: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/dashboard.test.ts`
Expected: PASS (all tests)

- [ ] **Step 14: Update the schema contract test**

In `lib/schema-contract.test.ts`, find the existing exact-key-set assertions for `EVENT_COLUMNS` and `SERIES_COLUMNS` (search for `Object.keys(row).sort()).toEqual(` near wherever `EVENT_COLUMNS`/`SERIES_COLUMNS` are exercised) and add `'fee_cents'` and `'min_spend_cents'` to each expected array, matching this file's existing style for the `PROFILE_COLUMNS` assertion Task 6 already updates.

- [ ] **Step 15: Run the contract suite**

Run: `TZ=America/New_York npm run test:contract` (requires `npx supabase start`)
Expected: PASS. Without a local stack:

Run: `TZ=America/New_York npx vitest run lib/schema-contract.test.ts`
Expected: skips gracefully with the usual warning, 0 tests run.

- [ ] **Step 16: Run the full unit suite**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

- [ ] **Step 17: Commit**

```bash
git add lib/events.ts lib/events.test.ts lib/bookings.ts lib/dashboard.ts lib/dashboard.test.ts lib/schema-contract.test.ts
git commit -m "feat(events): thread fee_cents/min_spend_cents through the client data layer"
```

---

### Task 13: Add-game screen — cost to play / minimum spend fields

**Files:**
- Modify: `app/clubs/[id]/events/new.tsx`
- Modify: `app/__tests__/events-new.test.tsx`

**Interfaces:**
- Consumes: Task 12's `createEvent`/`createEventSeries` (`feeCents`/`minSpendCents` now required params); `parseDollarsToCents` from `lib/events.ts`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `app/__tests__/events-new.test.tsx`, in a new `describe` block:

```tsx
describe('cost to play and minimum spend', () => {
  it('sends the typed dollar amounts as integer cents', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-09-07' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '19:00' },
    });
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Tuesday night' },
    });
    fireEvent.change(screen.getByLabelText('Cost to play'), {
      target: { value: '15' },
    });
    fireEvent.change(screen.getByLabelText('Minimum spend'), {
      target: { value: '20.50' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    const call = createEvent.mock.calls[0][0];
    expect(call.feeCents).toBe(1500);
    expect(call.minSpendCents).toBe(2050);
  });

  it('defaults to zero when left blank', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-09-07' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '19:00' },
    });
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Tuesday night' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    const call = createEvent.mock.calls[0][0];
    expect(call.feeCents).toBe(0);
    expect(call.minSpendCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-new.test.tsx -t "cost to play and minimum spend"`
Expected: FAIL — no "Cost to play"/"Minimum spend" fields exist yet, and `createEvent`'s call carries no `feeCents`/`minSpendCents`.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/[id]/events/new.tsx`, add the import:

```tsx
import { parseDollarsToCents } from '../../../../lib/events';
```

Add state near `checkInRequired`:

```tsx
  const [feeText, setFeeText] = useState('');
  const [minSpendText, setMinSpendText] = useState('');
```

Add the two fields to the JSX, right after the existing "Require check-in" block:

```tsx
      <TextField
        label="Cost to play"
        value={feeText}
        onChangeText={setFeeText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <TextField
        label="Minimum spend"
        value={minSpendText}
        onChangeText={setMinSpendText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
```

In `onSave`, add `feeCents`/`minSpendCents` to both the `createEvent` and `createEventSeries` calls:

```tsx
      const result = await createEvent({
        clubId,
        title,
        venueId,
        notes,
        date,
        startTime,
        durationMinutes: duration,
        tableCount,
        checkInRequired,
        feeCents: parseDollarsToCents(feeText),
        minSpendCents: parseDollarsToCents(minSpendText),
      });
```

```tsx
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
      checkInRequired,
      feeCents: parseDollarsToCents(feeText),
      minSpendCents: parseDollarsToCents(minSpendText),
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-new.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/events/new.tsx" app/__tests__/events-new.test.tsx
git commit -m "feat(events): add cost-to-play and minimum-spend fields to the add-game screen"
```

---

### Task 14: Edit-game screen — cost to play / minimum spend fields (dual scope)

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/edit.tsx`
- Modify: `app/__tests__/events-edit.test.tsx`

**Interfaces:**
- Consumes: Task 12's `updateEvent`/`updateEventSeries` (`feeCents`/`minSpendCents` now optional params); `parseDollarsToCents` from `lib/events.ts`.
- Produces: nothing new.

- [ ] **Step 1: Update the test fixtures and existing exact-match assertions**

In `app/__tests__/events-edit.test.tsx`, add `fee_cents: 0, min_spend_cents: 0` to `ONE_OFF_EVENT` and to `SERIES` (both are full-object fixtures the screen reads `check_in_required` from today — the fee fields need to sit right beside it so the screen has real values to seed from).

Update every existing exact-match `toHaveBeenCalledWith` assertion in this file (there are four in the `'a one-off event'` describe block and two in the `'a series occurrence'` describe block — search for `checkInRequired:` inside a `toHaveBeenCalledWith` to find all six) to include the new fields:

- The four `updateEvent` assertions (in `'a one-off event'`) each get `feeCents: null, minSpendCents: null` added right after their existing `checkInRequired: <value>,` line — none of these tests change the fee fields, so "unchanged" (`null`, meaning "leave alone") is correct for all four.
- The two `updateEventSeries` assertions (in `'a series occurrence'`) each get `feeCents: 0, minSpendCents: 0` added right after their existing `checkInRequired: false,` line — the series-scope path always sends every field, seeded from `SERIES.fee_cents`/`SERIES.min_spend_cents` (both `0` in the fixture).

- [ ] **Step 2: Write the new failing tests**

Add to the `'a one-off event'` describe block:

```tsx
  it('sends the changed fee and minimum spend, gated the same way as every other field', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.change(screen.getByLabelText('Cost to play'), {
      target: { value: '15' },
    });
    fireEvent.change(screen.getByLabelText('Minimum spend'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith('event-1', {
      title: null,
      venueId: null,
      notes: null,
      startTime: null,
      checkInRequired: null,
      feeCents: 1500,
      minSpendCents: 2000,
    });
  });
```

Add to the `'a series occurrence'` describe block:

```tsx
  it('seeds the series scope’s fee fields from the series row, not the occurrence', async () => {
    fetchEvent.mockResolvedValue({ ...SERIES_EVENT, fee_cents: 999 });
    render(<EditEventScreen />);
    await screen.findByText('The whole series');

    // "This game" shows the occurrence's own (overridden) fee.
    expect(screen.getByLabelText('Cost to play')).toHaveValue('9.99');

    fireEvent.click(screen.getByText('The whole series'));

    // The series' own fee (0 in the SERIES fixture), not the occurrence's.
    expect(screen.getByLabelText('Cost to play')).toHaveValue('0');
  });
```

(If `TextField`'s rendered `<input>` does not naturally hold `"9.99"`/`"0"` as its value in this test environment, adjust the assertion to whatever the actual seeded-text convention turns out to be when this step is run — the point being tested is "the value visibly changes when switching scope, and it comes from the right source object," not the exact string formatting, which Step 3 below defines.)

- [ ] **Step 3: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-edit.test.tsx`
Expected: FAIL — no "Cost to play"/"Minimum spend" fields exist on this screen yet, and none of the six updated exact-match assertions match today's actual call (which carries no fee fields at all).

- [ ] **Step 4: Write minimal implementation**

In `app/clubs/[id]/events/[eventId]/edit.tsx`, add the import:

```tsx
import { parseDollarsToCents } from '../../../../../lib/events';
```

Extend `OriginalOccurrence`:

```tsx
type OriginalOccurrence = {
  title: string;
  venueId: string;
  notes: string;
  startTime: string;
  checkInRequired: boolean;
  feeCents: number;
  minSpendCents: number;
};
```

Add state, beside `eventCheckInRequired`/`seriesCheckInRequired`:

```tsx
  const [eventFeeText, setEventFeeText] = useState('');
  const [eventMinSpendText, setEventMinSpendText] = useState('');
```

and beside the series-scope declarations:

```tsx
  const [seriesFeeText, setSeriesFeeText] = useState('');
  const [seriesMinSpendText, setSeriesMinSpendText] = useState('');
```

In the load effect, seed both from the loaded occurrence:

```tsx
        setEventCheckInRequired(loadedEvent.check_in_required);
        setEventFeeText(centsToDollarsText(loadedEvent.fee_cents));
        setEventMinSpendText(centsToDollarsText(loadedEvent.min_spend_cents));
        setOriginal({
          title: loadedEvent.title,
          venueId: loadedEvent.venue_id,
          notes: loadedEvent.notes,
          startTime: initialStartTime,
          checkInRequired: loadedEvent.check_in_required,
          feeCents: loadedEvent.fee_cents,
          minSpendCents: loadedEvent.min_spend_cents,
        });
```

and from the loaded series:

```tsx
          setSeriesCheckInRequired(loadedSeries.check_in_required);
          setSeriesFeeText(centsToDollarsText(loadedSeries.fee_cents));
          setSeriesMinSpendText(centsToDollarsText(loadedSeries.min_spend_cents));
```

Add a tiny local helper near the top of the file (outside the component, beside `type Scope = 'event' | 'series';`), since this screen needs to seed a text field from stored cents — the inverse direction from `parseDollarsToCents`:

```tsx
/** The inverse of lib/events.ts's parseDollarsToCents, for seeding a text
 *  field from a stored cents value. `0` renders as `"0"`, not `""` — an
 *  explicit zero the host can see and overwrite, not a blank field that
 *  looks unset. */
function centsToDollarsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
```

Add the scope-resolved accessors beside `checkInRequired`/`setCheckInRequired`:

```tsx
  const feeText = isSeriesScope ? seriesFeeText : eventFeeText;
  const setFeeText = isSeriesScope ? setSeriesFeeText : setEventFeeText;
  const minSpendText = isSeriesScope ? seriesMinSpendText : eventMinSpendText;
  const setMinSpendText = isSeriesScope ? setSeriesMinSpendText : setEventMinSpendText;
```

In `onSave`'s series branch, add to the `updateEventSeries` call:

```tsx
      const result = await updateEventSeries(series.id, {
        title,
        venueId,
        notes,
        startTime,
        checkInRequired,
        feeCents: parseDollarsToCents(feeText),
        minSpendCents: parseDollarsToCents(minSpendText),
        endsOn: endsOnInput,
        clearEndsOn,
        includeOverridden,
      });
```

In `onSave`'s "this game" branch, add the changed-only gate and pass it to `updateEvent`:

```tsx
      const checkInChanged = original
        ? checkInRequired !== original.checkInRequired
        : false;
      const feeCentsValue = parseDollarsToCents(feeText);
      const minSpendCentsValue = parseDollarsToCents(minSpendText);
      const feeChanged = original ? feeCentsValue !== original.feeCents : false;
      const minSpendChanged = original
        ? minSpendCentsValue !== original.minSpendCents
        : false;

      const result = await updateEvent(event.id, {
        title: titleChanged ? title.trim() : null,
        venueId: venueChanged ? venueId : null,
        notes: notesChanged ? notes : null,
        startTime: startTimeChanged ? startTime : null,
        checkInRequired: checkInChanged ? checkInRequired : null,
        feeCents: feeChanged ? feeCentsValue : null,
        minSpendCents: minSpendChanged ? minSpendCentsValue : null,
      });
```

Add the two fields to the JSX, right after the existing "Require check-in" block:

```tsx
      <TextField
        label="Cost to play"
        value={feeText}
        onChangeText={setFeeText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <TextField
        label="Minimum spend"
        value={minSpendText}
        onChangeText={setMinSpendText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/events-edit.test.tsx`
Expected: PASS (all tests). If Step 2's scope-seeding test fails on the exact string assertion (`toHaveValue('9.99')`), inspect the actual rendered value (`screen.debug()` or reading the element's `value` attribute directly) and correct the assertion to match `centsToDollarsText`'s real output — the behavior, not the test's first guess at its string form, is the source of truth.

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/edit.tsx" app/__tests__/events-edit.test.tsx
git commit -m "feat(events): add cost-to-play and minimum-spend fields to the edit-game screen"
```

---

### Task 15: Dashboard game tile shows the fee, when set

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: Task 12's `DashboardRow.feeCents`/`minSpendCents`; `formatFeeCents` from `lib/events.ts`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `app/__tests__/clubs.test.tsx`, near Task 5's three-line game-row test:

```tsx
  it('shows a fee line only when a fee or minimum spend is set', async () => {
    render(<ClubsScreen />);
    await screen.findByText('Riverside Mah Jongg');
    // The default fixture carries no fee — confirmed absent first, so the
    // next case (a fee actually set) is a real contrast, not a tautology.
    expect(screen.queryByText(/to play/)).toBeNull();
    expect(screen.queryByText(/min spend/)).toBeNull();
  });

  it('joins cost-to-play and minimum-spend when both are set on the same game', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, fee_cents: 1500, min_spend_cents: 2000 },
    ]);
    render(<ClubsScreen />);
    expect(
      await screen.findByText('$15 to play · $20 min spend'),
    ).toBeTruthy();
  });
```

(Use this file's actual existing fixture names for the mocked upcoming-bookings function and its default booking object in place of `fetchMyUpcomingBookings`/`BOOKING` above if they differ — check the top of the file for how the other `GameRow`-rendering tests already set up their data.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "fee line|cost-to-play and minimum-spend"`
Expected: FAIL — `GameRow` renders no fee line at all yet.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/index.tsx`, add `formatFeeCents` to the existing `lib/events` import:

```tsx
import { fetchUpcomingEvents, formatEventTime, formatFeeCents, formatEventWhen } from '../../lib/events';
```

In `GameRow`'s body (from Task 5's three-line restructure), add a fourth conditional line:

```tsx
            <View style={styles.gameBody}>
              <Text style={styles.gameClubName}>{row.clubName}</Text>
              <Text style={styles.gameTime}>
                {formatEventTime(row.startsAt, row.timezone)}
              </Text>
              <Text style={styles.gameVenue}>{row.venueName}</Text>
              {row.feeCents > 0 || row.minSpendCents > 0 ? (
                <Text style={styles.gameFee}>
                  {[
                    row.feeCents > 0 ? `${formatFeeCents(row.feeCents)} to play` : null,
                    row.minSpendCents > 0
                      ? `${formatFeeCents(row.minSpendCents)} min spend`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
```

Add the style, beside `gameVenue`:

```tsx
  gameFee: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full unit suite**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests across the whole repo)

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(dashboard): show cost-to-play and minimum-spend on the game tile"
```

---

## Self-Review Notes

- **Spec coverage:** Part A (Home truncation → Task 1; Club Edit consolidation → Task 2; message board already consistent, no task; game screen tile → Task 3) — covered. Part B (live-only rounds/timer) → Task 4 — covered. Part C (three-line game row) → Task 5 — covered. Part D (admin flag, greetings table, daily pick, personalization, display, admin UI) → Tasks 6-9 — covered.
- **Type consistency:** `Greeting` (id/text/created_at) is defined once in `lib/greetings.ts` (Task 7) and imported everywhere else that needs it (Tasks 8, 9) rather than redeclared. `gameLive` (Task 4) and `backLabel` (Task 2) are each introduced once and consumed at their one call site. `formatEventTime` (Task 5) matches `formatEventWhen`'s existing signature shape (`startsAt, timezone, locale?`) for consistency.
- **Placeholder scan:** no TBD/TODO markers; every step shows real, complete code, not a description of code. An earlier draft of Task 9 described the inline-edit affordance instead of writing it out — replaced with the complete `editingId`/`editText`/`onStartEdit`/`onSaveEdit`/`onCancelEdit` implementation, its own test, and the matching styles, so `updateGreeting` (imported in Task 7) has a real caller.
- **Correctness catch during self-review:** Task 8's first draft mocked `lib/greetings` in `clubs.test.tsx` by closing over separately-`import`ed real `pickDailyGreeting`/`applyGreetingTemplate` bindings inside the `vi.mock` factory — `vi.mock` factories are hoisted above every `import` in the file, so that factory could run before those bindings existed. Fixed by using `vi.importActual` to spread in the real module and override only `fetchGreetings`, the one function actually worth stubbing there.
- **Spec coverage (Addendum 4):** Part A (Messages list tile) → Task 10 — covered. Part B (fee schema, RPCs, `materialize_one_series`, client types, both forms, Dashboard display) → Tasks 11-15 — covered, in the same dependency order the spec itself lays out (schema/RPC → client data layer → forms → display).
- **Type consistency (Tasks 11-15):** `fee_cents`/`min_spend_cents` (DB/RPC, snake_case) and `feeCents`/`minSpendCents` (TS, camelCase) follow the exact same naming split `check_in_required`/`checkInRequired` already established — no third naming convention introduced. `formatFeeCents`/`parseDollarsToCents` (Task 12) are defined once in `lib/events.ts` and imported by every later task that needs them (13, 14, 15), never redeclared. `centsToDollarsText` (Task 14) is intentionally a different, single-consumer, screen-local helper — not a naming collision with `formatFeeCents`, since one produces a currency-symbol display string (`"$15"`) and the other a bare editable-field seed (`"15"`).
- **Correctness catch during self-review (Task 12):** an early draft of Step 5 told the implementer to "do the same" for `updateEvent`/`createEventSeries`/`updateEventSeries` without showing their actual current test code — exactly the "Similar to Task N" pattern this process forbids. Fixed by reading each block's real, current content and writing out the full updated assertions and new tests for all three, matching the complete treatment `createEvent` already got.
- **The one function it would be easy to forget:** Task 11 calls out `materialize_one_series` by name as the step most likely to be skipped (its signature doesn't change, so it's not part of the same drop/recreate ceremony as the other four), and shows its complete updated body rather than just noting that it needs updating.
