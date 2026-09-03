# Organizer Visibility for Unbooked Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organizer who creates a game but never books themselves a seat currently loses all access to it — check-in, table management, round recording — the instant it starts, because the dashboard's game list has no source that covers "a game I organize but haven't booked." Add one: an in-progress, unbooked, organized game gets a plain "Hosting" row on `/clubs`, no seat action.

**Architecture:** No schema change — this is entirely a read-path and client-rendering fix. `fetchUpcomingEvents`'s filter widens from `starts_at >= now()` to `ends_at >= now()` (matching the same rule `my_upcoming_bookings` and `record_round` already use), a new `fetchMyRoles` read tells the dashboard which clubs the viewer organizes, and `buildDashboardRows` grows a third row category alongside "booked" and "joinable."

**Tech Stack:** Postgres/Supabase (read-only, no migration), TypeScript, Vitest + @testing-library/react.

**Spec:** [../specs/2026-09-03-organizer-unbooked-games-design.md](../specs/2026-09-03-organizer-unbooked-games-design.md)

## Global Constraints

- **Branch:** `fix/organizer-unbooked-games`, already created off `main`. Never commit to `main`; this plan merges via a PR.
- **No new grant, no new RLS policy, no migration file.** `fetchMyRoles` is a plain select against `club_members`, already permitted by the existing `club_members_select_member` policy (`is_club_member(club_id)`, `20260822033527_create_clubs.sql`).
- **In-progress means `starts_at <= now < ends_at`.** Not "started" alone (`starts_at <= now`) — an already-ended game must never produce an organizing row.
- **"Organizer" means `canInvite(role)`** (host or co-organizer) — reuse it verbatim, do not write a new predicate.
- **A degraded `fetchMyRoles` read must never show an error banner or block the rest of the screen.** It silently produces zero organizing rows — no `xFailed` boolean needed for this one, since "no data" and "fetch failed" are the same safe fallback (empty set → no organizing rows either way).
- **The organizing row offers no seat action.** No Join button, no `onJoin` wiring — booking is frozen once a game starts (`assert_event_bookable`), so a control that could only ever fail must not be drawn.
- **A booking always wins over the organizing branch** for the same event — this already falls out of the existing `seen` dedup in `buildDashboardRows`; do not add a second dedup check.

---

## File Structure

**Modified app files:**

| File | Responsibility |
|---|---|
| `lib/events.ts` | `fetchUpcomingEvents`'s filter widens to `ends_at` |
| `app/clubs/[id]/events/new.tsx` | One comment updated to match the widened filter |
| `lib/clubs.ts` | New `fetchMyRoles(userId)` |
| `lib/clubs.test.ts` | Its tests |
| `lib/dashboard.ts` | `DashboardRow` gains `organizing`; `buildDashboardRows` gains the third row branch |
| `lib/dashboard.test.ts` | Its tests |
| `app/clubs/index.tsx` | Fetches roles, computes `organizerClubIds`, passes it through, renders the "Hosting" tag |
| `app/__tests__/clubs.test.tsx` | Its tests |

---

## Task 1: Widen `fetchUpcomingEvents`'s filter

**Files:**
- Modify: `lib/events.ts:592-611` (the function itself, plus a new doc comment above it)
- Modify: `app/clubs/[id]/events/new.tsx:173-174` (one comment, to match)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchUpcomingEvents(clubId)` now returns events through `ends_at`, not just `starts_at`. Task 3 (`buildDashboardRows`) is the only consumer whose behavior actually depends on this — `needAFourthAlerts` is unaffected (see below).

- [ ] **Step 1: Make the change**

In `lib/events.ts`, add a doc comment and change the filter (replace the whole function, lines 592-611):

```ts
/**
 * Every event still relevant to this club: not yet ended, not `starts_at >=
 * now()`. Matches the same "relevant until it ends" rule
 * `my_upcoming_bookings` (20260827070000_my_upcoming_bookings_check_in.sql)
 * and `record_round`'s own guard (20260902070000_table_rounds_mutations.sql)
 * already use — dropping an event the instant it started used to hide it
 * from `buildDashboardRows`' organizing-row branch (lib/dashboard.ts) for
 * exactly the games that most need to stay reachable: an organizer's own
 * in-progress game they never booked a seat at.
 *
 * `needAFourthAlerts` (lib/dashboard.ts) is the OTHER consumer of this
 * function's output and is unaffected by the widened window: `needsAFourth`
 * (lib/bookings.ts) already refuses to fire once `startsAt <= now` (its own
 * `until > 0` guard), so an in-progress event newly included here can never
 * produce a spurious "needs a 4th" alert.
 */
export async function fetchUpcomingEvents(
  clubId: string,
): Promise<ClubEvent[] | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('club_id', clubId)
      .gte('ends_at', new Date().toISOString())
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
```

In `app/clubs/[id]/events/new.tsx`, change line 174 from:

```ts
   * `fetchUpcomingEvents` filters `starts_at >= now()` and is the only events
```

to:

```ts
   * `fetchUpcomingEvents` filters `ends_at >= now()` and is the only events
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions. Note: no test in this repo directly exercises `fetchUpcomingEvents`'s real SQL today (every call site mocks the function itself) — this step confirms nothing else broke; Task 3's tests are what actually prove the widened window's *consequences* are correct, through `buildDashboardRows`.

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts "app/clubs/[id]/events/new.tsx"
git commit -m "fix(dashboard): widen fetchUpcomingEvents to ends_at, matching my_upcoming_bookings"
```

---

## Task 2: `fetchMyRoles`

**Files:**
- Modify: `lib/clubs.ts` (new function, after `fetchClub`, around line 258)
- Modify: `lib/clubs.test.ts`

**Interfaces:**
- Consumes: `supabase` (`lib/supabase.ts`), the existing `club_members_select_member` RLS policy.
- Produces: `fetchMyRoles(userId: string): Promise<{ club_id: string; role: ClubRole }[] | null>`. Task 4 (`app/clubs/index.tsx`) is the only consumer.

- [ ] **Step 1: Write the failing tests**

Add to the top of `lib/clubs.test.ts`, before the existing `import { ... } from './clubs';` line:

```ts
// fetchMyRoles' read path is `.from('club_members').select(...).eq(...).eq(...).order(...)`
// — the same eq-then-eq-then-terminal shape other lib/*.test.ts files already
// model for a plain filtered select with no .single()/.maybeSingle().
const orderAfterEq = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ order: orderAfterEq })),
        })),
      })),
    })),
  },
}));
```

Change the top import line (`import { describe, expect, it } from 'vitest';`) to:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

Add `fetchMyRoles` to the existing import from `'./clubs'`:

```ts
import {
  MAX_ROSTER_ROWS,
  canAnnounce,
  canInvite,
  fetchMyRoles,
  importRoster,
  parseRoster,
  slugify,
} from './clubs';
```

Add, anywhere in the file (e.g. right after the existing `describe('canInvite', ...)` block):

```ts
describe('fetchMyRoles', () => {
  beforeEach(() => {
    orderAfterEq.mockReset();
  });

  it('returns the rows on success', async () => {
    orderAfterEq.mockResolvedValue({
      data: [{ club_id: 'club-1', role: 'host' }],
      error: null,
    });
    const result = await fetchMyRoles('user-1');
    expect(result).toEqual([{ club_id: 'club-1', role: 'host' }]);
  });

  it('returns an empty array, not null, when the member is in no clubs', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyRoles('user-1');
    expect(result).toEqual([]);
  });

  it('returns null on a failed read', async () => {
    orderAfterEq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await fetchMyRoles('user-1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/clubs.test.ts`
Expected: FAIL — `fetchMyRoles` does not exist yet (module has no such export).

- [ ] **Step 3: Write `fetchMyRoles`**

In `lib/clubs.ts`, insert immediately after `fetchClub`'s closing brace (after line 258, before the `fetchRoster` doc comment):

```ts
/**
 * The viewer's own role in every club they belong to — cheap and narrow on
 * purpose. `fetchRoster` returns the whole membership list and exists for
 * screens that need everyone; the dashboard (`app/clubs/index.tsx`) is the
 * first screen that needs only "am I an organizer here", for every club at
 * once, without the roster at all.
 *
 * `club_members_select_member`'s existing policy (`is_club_member(club_id)`,
 * 20260822033527_create_clubs.sql) already permits a member reading their
 * own row — this is a plain select, no new grant and no new policy.
 */
export async function fetchMyRoles(
  userId: string,
): Promise<{ club_id: string; role: ClubRole }[] | null> {
  try {
    const { data, error } = await supabase
      .from('club_members')
      .select('club_id, role')
      .eq('profile_id', userId)
      .eq('status', 'active')
      .order('club_id');

    if (error) {
      console.error('fetchMyRoles failed', error);
      return null;
    }
    return (data ?? []) as { club_id: string; role: ClubRole }[];
  } catch (cause) {
    console.error('fetchMyRoles failed', cause);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/clubs.test.ts`
Expected: PASS — all tests in the file green, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/clubs.ts lib/clubs.test.ts
git commit -m "feat(dashboard): add fetchMyRoles"
```

---

## Task 3: `buildDashboardRows` — the organizing-row branch

**Files:**
- Modify: `lib/dashboard.ts` (`DashboardRow` type and `buildDashboardRows`)
- Modify: `lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `Set<string>` of organizer club ids (Task 4 builds this from `fetchMyRoles` + `canInvite`).
- Produces: `DashboardRow` gains `organizing: boolean`. `buildDashboardRows` gains an optional `organizerClubIds?: Set<string>` input parameter (defaults to empty — every existing call site that doesn't pass it keeps its current behavior exactly). Task 4 passes it; the row-rendering component (also Task 4) reads `row.organizing`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/dashboard.test.ts`, inside the existing `describe('buildDashboardRows', ...)` block, immediately after the existing `'drops an event that has already started'` test (currently ends around line 259):

```ts
  it('adds an in-progress event the viewer organizes but has not booked, as an organizing row', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'in-progress',
          starts_at: '2026-09-01T10:00:00Z',
          ends_at: '2026-09-01T14:00:00Z',
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      organizerClubIds: new Set(['club-1']),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].organizing).toBe(true);
    expect(rows[0].joinable).toBe(false);
    expect(rows[0].booking).toBeNull();
  });

  it('does not add an in-progress event for a plain member, even with a free seat', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'in-progress',
          starts_at: '2026-09-01T10:00:00Z',
          ends_at: '2026-09-01T14:00:00Z',
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      // No organizerClubIds -- a plain member of the club.
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops an in-progress event the viewer organizes once it has ended', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'ended',
          starts_at: '2026-09-01T08:00:00Z',
          ends_at: '2026-09-01T11:00:00Z',
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      organizerClubIds: new Set(['club-1']),
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('lets a booking win over the organizing branch when the organizer is also seated', () => {
    const rows = buildDashboardRows({
      bookings: [
        booking({ event_id: 'in-progress', club_id: 'club-1' }),
      ],
      events: [
        event({
          id: 'in-progress',
          starts_at: '2026-09-01T10:00:00Z',
          ends_at: '2026-09-01T14:00:00Z',
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      organizerClubIds: new Set(['club-1']),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].booking).not.toBeNull();
    expect(rows[0].organizing).toBe(false);
  });

  it('still adds an organizing row even when the table is full', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'in-progress-full',
          starts_at: '2026-09-01T10:00:00Z',
          ends_at: '2026-09-01T14:00:00Z',
          bookings: [
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-1' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      organizerClubIds: new Set(['club-1']),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].organizing).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/dashboard.test.ts`
Expected: FAIL — `buildDashboardRows` does not accept `organizerClubIds` yet and never produces `organizing: true`; the existing `'drops an event that has already started'` test should still PASS unchanged (it passes no `organizerClubIds`, so with the current code an in-progress event is already dropped — this is the one existing test whose behavior your new code must preserve exactly, for the *same* reason, not by accident).

- [ ] **Step 3: Implement**

In `lib/dashboard.ts`, change the `DashboardRow` type (currently ending `joinable: boolean;`):

```ts
export type DashboardRow = {
  eventId: string;
  clubId: string;
  clubName: string;
  title: string;
  startsAt: string;
  timezone: string;
  venueName: string;
  /** The viewer's own booking, when they have one. Null on a joinable or organizing row. */
  booking: MyBooking | null;
  joinable: boolean;
  /**
   * True only for an in-progress event the viewer organizes but holds no
   * booking at — mutually exclusive with `joinable` (that one is always a
   * future event) and always paired with `booking: null`. See
   * `buildDashboardRows`' own doc comment for why this exists.
   */
  organizing: boolean;
};
```

Replace `buildDashboardRows` in full:

```ts
/**
 * The viewer's bookings first, then any open event they are not in, merged
 * and sorted by start.
 *
 * Bookings win the de-duplication: both sources can carry the same event, and
 * the booking is the richer row — it is what the offer, waitlist and check-in
 * controls hang off.
 *
 * A THIRD source, folded into the same loop as the joinable branch: an
 * in-progress event the viewer organizes (host or co-organizer) but holds no
 * booking at. Before this existed, an organizer who never booked their own
 * seat lost all access to their own game the instant it started — neither
 * `my_upcoming_bookings` (no booking to find) nor the joinable branch (which
 * requires `!started`) ever covered it. See the design doc for how this was
 * found: two organizer-created, self-unbooked games vanished from a real
 * dashboard at kickoff.
 *
 * `organizerClubIds` defaults to an empty set — every existing caller that
 * does not pass it gets exactly today's behavior, since an empty set can
 * never match `event.club_id`.
 */
export function buildDashboardRows(input: {
  bookings: MyBooking[];
  events: ClubEvent[];
  clubs: Club[];
  userId: string;
  organizerClubIds?: Set<string>;
  now?: Date;
}): DashboardRow[] {
  const now = input.now ?? new Date();
  const clubsById = new Map(input.clubs.map((club) => [club.id, club]));
  const organizerClubIds = input.organizerClubIds ?? new Set<string>();

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
  }));

  const seen = new Set(rows.map((row) => row.eventId));

  for (const event of input.events) {
    if (seen.has(event.id)) continue;
    if (event.status !== 'published') continue;
    if (viewerIsIn(event, input.userId)) continue;
    const club = clubsById.get(event.club_id);
    if (!club) continue;

    const started = new Date(event.starts_at).getTime() <= now.getTime();
    const ended = new Date(event.ends_at).getTime() <= now.getTime();

    if (started) {
      // The organizing branch. `ended` is checked unconditionally (not
      // just for a non-organizer) so a stale already-ended event is
      // refused outright; only once that passes does organizer status
      // decide it. Deliberately does NOT check hasFreeSeat -- an organizer
      // needs this row whether the table is full or not.
      if (ended || !organizerClubIds.has(event.club_id)) continue;
    } else {
      // The existing joinable branch, unchanged.
      if (!hasFreeSeat(event)) continue;
    }

    seen.add(event.id);
    rows.push({
      eventId: event.id,
      clubId: event.club_id,
      clubName: club.name,
      title: event.title,
      startsAt: event.starts_at,
      timezone: club.timezone,
      venueName: event.venue_name,
      booking: null,
      joinable: !started,
      organizing: started && !ended,
    });
  }

  return rows.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/dashboard.test.ts`
Expected: PASS — every existing test plus the 5 new ones green, including the pre-existing `'drops an event that has already started'` test passing for the reason its own name says (still no `organizerClubIds` supplied there).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts
git commit -m "feat(dashboard): add the organizing-row branch to buildDashboardRows"
```

---

## Task 4: Wire it into the dashboard screen

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `fetchMyRoles` (Task 2), `canInvite` (`lib/clubs.ts`, already exists), `organizerClubIds` param + `organizing` field (Task 3).
- Produces: nothing new for later tasks — this is the top of the call chain.

- [ ] **Step 1: Write the failing tests**

In `app/__tests__/clubs.test.tsx`:

Add `const fetchMyRoles = vi.fn();` alongside the other `const fetchX = vi.fn();` declarations near the top of the file (next to `const fetchPendingInvites = vi.fn();`).

Add `fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),` to the returned object inside the existing `vi.mock('../../lib/clubs', ...)` factory (alongside `fetchMyClubs`, `fetchClub`, etc.).

Add `fetchMyRoles.mockResolvedValue([]);` to the `beforeEach` block, alongside the other default mock values (e.g. right after `fetchUpcomingEvents.mockResolvedValue([]);`).

Add a new describe block, anywhere after the existing `describe('dashboard artboard', ...)` block:

```tsx
describe('organizing an unbooked, in-progress game', () => {
  // Relative to the real clock, matching EVENT's own convention in this
  // file (fake timers are deliberately not installed here) -- a fixed
  // calendar timestamp would silently stop being "in progress" the moment
  // it passed.
  const inProgressStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const inProgressEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  function liveUnbookedGame() {
    return {
      ...EVENT,
      id: 'live-game',
      club_id: CLUB.id,
      title: 'In progress now',
      starts_at: inProgressStart,
      ends_at: inProgressEnd,
    };
  }

  it("shows a Hosting tag and no Join button for the organizer's own unbooked, in-progress game", async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([{ club_id: CLUB.id, role: 'host' }]);
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    expect(await screen.findByText('In progress now')).toBeTruthy();
    expect(screen.getByText('Hosting')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('does not show an in-progress unbooked game to a plain member', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([]); // organizer nowhere
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.queryByText('In progress now')).toBeNull();
  });

  it('opens the event screen when the organizing row is tapped', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([{ club_id: CLUB.id, role: 'host' }]);
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    const link = (await screen.findByText('In progress now')).closest('a');
    expect(link?.getAttribute('data-href')).toBe(
      `/clubs/${CLUB.id}/events/live-game`,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: FAIL — the screen never fetches roles, never computes `organizerClubIds`, and `GameRow` has no "Hosting" branch, so the in-progress unbooked event never appears at all (the first and third new tests fail on `findByText('In progress now')` timing out; the second passes for the wrong reason until you also confirm the other two are genuinely red).

- [ ] **Step 3: Wire the screen**

In `app/clubs/index.tsx`:

Change the import from `lib/clubs` (currently `import { fetchMyClubs } from '../../lib/clubs';` plus `import type { Club } from '../../lib/clubs';`) to:

```ts
import { canInvite, fetchMyClubs, fetchMyRoles } from '../../lib/clubs';
import type { Club, ClubRole } from '../../lib/clubs';
```

Add state, alongside the existing `bookings`/`bookingsFailed` declarations:

```ts
  // The viewer's own role in every club they belong to, used only to
  // compute which clubs they organize (see `organizerClubIds` below).
  // Deliberately NOT paired with a `rolesFailed` boolean the way
  // `bookings`/`bookingsFailed` are: a failed or empty read both resolve to
  // "no organizing rows" with no error banner, so there is nothing a
  // separate failed-state would let this screen say differently.
  const [roles, setRoles] = useState<{ club_id: string; role: ClubRole }[]>([]);
```

In the mount `useEffect`, add a third independent `.then()` chain alongside the existing `fetchMyClubs()`/`fetchMyUpcomingBookings()` ones (after the `fetchMyUpcomingBookings().then(...)` block, still inside the same effect, before its `return () => { cancelled = true; };`):

```ts
    fetchMyRoles(userId).then((result) => {
      if (cancelled) return;
      setRoles(result ?? []);
    });
```

Immediately before the existing `const rows = buildDashboardRows({...})` line, add:

```ts
  const organizerClubIds = new Set(
    roles.filter((r) => canInvite(r.role)).map((r) => r.club_id),
  );
```

Then change the `buildDashboardRows` call to pass it through:

```ts
  const rows = buildDashboardRows({
    bookings: bookings ?? [],
    events,
    clubs: list,
    userId: userId ?? '',
    organizerClubIds,
  }).filter((row) => inScope(row.clubId, selected));
```

In `GameRow`'s docstring (currently: "a single right-hand affordance — Join for an open game the member is not in yet, 'Seated' for one they hold"), extend it:

```
 * a single right-hand affordance — Join for an open game the member is not
 * in yet, "Seated" for one they hold, "Hosting" for an in-progress game they
 * organize but have not booked (`row.organizing` — see buildDashboardRows'
 * own doc comment in lib/dashboard.ts).
```

In `GameRow`'s trailing-action JSX (currently):

```tsx
        {booking === null ? (
          <Button
            variant="secondary"
            big={false}
            disabled={busy}
            onPress={() => onJoin(row)}
            accessibilityLabel={`Join ${row.title}`}
            style={styles.gameAction}
          >
            Join
          </Button>
        ) : booking.status === 'confirmed' ? (
          <Tag variant="accent2">Seated</Tag>
        ) : null}
```

change to:

```tsx
        {booking === null ? (
          row.organizing ? (
            <Tag variant="accent">Hosting</Tag>
          ) : (
            <Button
              variant="secondary"
              big={false}
              disabled={busy}
              onPress={() => onJoin(row)}
              accessibilityLabel={`Join ${row.title}`}
              style={styles.gameAction}
            >
              Join
            </Button>
          )
        ) : booking.status === 'confirmed' ? (
          <Tag variant="accent2">Seated</Tag>
        ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS — every existing test plus the 3 new ones green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions anywhere else in the app.

- [ ] **Step 6: Run the type checker**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(dashboard): show an organizer's own in-progress, unbooked games"
```

---

## Final check

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm the exact real-world case that surfaced this bug is fixed: an event with no booking, `starts_at` in the past, `ends_at` in the future, in a club where the viewer is `host`, now produces a "Hosting" row.
- [ ] Open a PR from `fix/organizer-unbooked-games` into `main` (per the standing branch-per-plan rule) rather than merging locally.
