# Drop the club page's duplicate games, fix two back links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three fixes in [docs/superpowers/specs/2026-09-02-club-page-games-and-back-links-design.md](../specs/2026-09-02-club-page-games-and-back-links-design.md) on branch `UI-tweaks`.

**Architecture:** Three independent tasks, one per source file — none depends on code from the others, only on the shared design rationale.

**Tech Stack:** React Native (Expo Router) + TypeScript, Vitest + Testing Library.

## Global Constraints

- Run scoped tests with `npm test -- <path>` (`TZ=America/New_York vitest run`).
- Every pressable needs `accessibilityRole="button"` and an `accessibilityLabel`.
- Never use `router.back()` on a top-of-screen back link — always an explicit `router.push(...)` destination (the bottom "Cancel" button on the new-game form is the one established exception in this codebase, and this plan doesn't touch it).
- The established back-link shape, reused verbatim in this plan:
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
  ```
  with `backButton: { alignSelf: 'flex-start' }` and placement as the first child of the populated `Screen`.

---

### Task 1: Drop the club management page's "Upcoming" section

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:** None — this task only removes UI and its supporting state; nothing else in the app reads `app/clubs/[id]/index.tsx`'s internals.

- [ ] **Step 1: Delete the events-related tests in `clubs.test.tsx` first**

Delete the entire `describe('club detail screen upcoming events', ...)` block (starts right after the `function escapeForRegExp(value: string) { ... }` helper, ends right before the `describe('eventStatusLine', ...)` block that follows it — that block tests `eventStatusLine` as a pure function and is unrelated, keep it). This removes 8 tests: `'renders the event start time in the club timezone, not the device/process one'`, `'gives the event card an accessible name including the club-timezone time'`, `'hides the add-game control and the venues link from a plain member'`, `'shows the host the add-game control and the venues link'`, `'names how many tables each game has, singular and plural'`, `'marks a cancelled event without implying it can still be booked'`, `'offers no booking affordance and no coming-soon badge'`, `'degrades only the Upcoming section when the events fetch fails, leaving the roster on screen'`, `'says where you stand on each game, right on the card'`.

Also delete the now-unused `escapeForRegExp` helper function that sat directly above that describe block — it has no other caller (confirmed: `grep -n "escapeForRegExp" app/__tests__/clubs.test.tsx` shows only its own definition and three uses, all inside the block just deleted).

Change the import:

```tsx
import { eventStatusLine, formatEventWhen } from '../../lib/events';
```

to:

```tsx
import { eventStatusLine } from '../../lib/events';
```

(`formatEventWhen` has no other caller in this file after the deleted block — confirmed via `grep -n "formatEventWhen" app/__tests__/clubs.test.tsx`; `eventStatusLine` stays, it's tested directly as a pure function in the `describe('eventStatusLine', ...)` block further down.)

Do **not** touch `fetchUpcomingEvents` — it's mocked and used extensively elsewhere in this same file for `ClubsScreen` (the dashboard)'s own tests, which are unaffected by this task.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: FAIL — `app/clubs/[id]/index.tsx` still renders the "Upcoming" section, `Text`/role queries for it still resolve, so nothing in the deleted block would have failed... but the file must still parse and run: verify instead that the full file runs clean at this point (nothing to assert failed yet, since deleting tests can't "fail" — this step is really "confirm the file still compiles and every remaining test still passes"). Run `npm test -- app/__tests__/clubs.test.tsx` and confirm all remaining tests pass with the *old* `app/clubs/[id]/index.tsx` still in place.

- [ ] **Step 3: Delete the Upcoming section from the screen**

In `app/clubs/[id]/index.tsx`, delete:

```tsx
      <Text style={styles.sectionTitle}>Upcoming</Text>

      {mayInvite ? (
        <PlusButton
          onPress={() => router.push(`/clubs/${id}/events/new`)}
          accessibilityLabel="Add a game"
        />
      ) : null}

      {eventsFailed ? (
        <Text style={styles.help}>Could not load upcoming games.</Text>
      ) : events.length === 0 ? (
        <Text style={styles.help}>
          {mayInvite
            ? 'No games scheduled yet. Add one and everyone in the club will see it.'
            : 'No games scheduled yet.'}
        </Text>
      ) : (
        events.map((event) => (
          <Link
            key={event.id}
            href={`/clubs/${id}/events/${event.id}`}
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
                {/*
                  Task 14: where the viewer stands on THIS game — their own
                  seat/waitlist place first, then a call for a fourth aimed
                  at everybody who is not already in, then the plain seat
                  count. Your own state always wins (see eventStatusLine's
                  doc comment in lib/events.ts) — a member already seated is
                  never told the table needs a fourth.
                */}
                <Text style={styles.help}>
                  {eventStatusLine(
                    {
                      starts_at: event.starts_at,
                      event_tables: event.event_tables,
                      bookings: event.bookings,
                      tables_labels: Object.fromEntries(
                        event.event_tables.map((t) => [t.id, t.label]),
                      ),
                    },
                    userId ?? '',
                  )}
                </Text>
              </Card>
            </Pressable>
          </Link>
        ))
      )}

```

so that the `<DashboardHeader ... />` is immediately followed by the `{mayInvite ? (` block for "Open the club thread".

Delete the `events`/`eventsFailed` state and their explanatory comment:

```tsx
  const [events, setEvents] = useState<ClubEvent[]>([]);
```

and

```tsx
  // Kept separate from `loadFailed`: that flag blanks the whole screen, which
  // is right when the club/roster/invites fetch fails (there is nothing to
  // show). A failed events fetch is different — the club name, roster and
  // invites all still loaded fine, so only the Upcoming section should
  // degrade, not the entire page.
  const [eventsFailed, setEventsFailed] = useState(false);
```

Delete the `fetchUpcomingEvents` call inside the mount effect:

```tsx
    fetchUpcomingEvents(id).then((result) => {
      if (cancelled) return;
      if (result === null) setEventsFailed(true);
      else setEvents(result);
    });
```

(leaving the `Promise.all([fetchClub(id), fetchRoster(id), fetchPendingInvites(id)]).then(...)` call and its `return () => { cancelled = true; };` cleanup exactly as they are.)

Delete the now-dead imports:

```tsx
import PlusButton from '../../../components/PlusButton';
```

```tsx
import {
  eventStatusLine,
  fetchUpcomingEvents,
  formatEventWhen,
} from '../../../lib/events';
import type { ClubEvent } from '../../../lib/events';
```

Remove `Pressable` from the `react-native` import list (it has no other caller in this file — the deleted events list was its only use; the roster/invite `Card`s never wrap a `Pressable`):

```tsx
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
```

becomes:

```tsx
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
```

Keep `Link` (still used for the "Venues" link near the bottom of the page), `Card` and `Tag` (still used by the roster/invite rows).

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS (whole file — every remaining `club detail screen` test still passes unchanged, since none of them ever asserted on the Upcoming section)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/clubs/\[id\]/index.tsx app/__tests__/clubs.test.tsx
git commit -m "fix(clubs): drop the club management page's duplicate games list

The dashboard already shows a club's games once it's in view, with its own
Add a game +. This page's own copy — heading, list, and a second Add a
game control — did nothing the dashboard doesn't already do."
```

---

### Task 2: Point the event detail page's back link at the dashboard

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:** None.

- [ ] **Step 1: Rewrite the failing test first**

In `app/__tests__/events-detail.test.tsx`, change:

```tsx
  // This screen's own back link goes to /clubs/club-1 -- a specific club,
  // not the Club tab's own /clubs -- so it is a genuinely different
  // destination and stays, the same reasoning venues.test.tsx documents for
  // its own "Back to the club" button.
  it('keeps its back link to the club, a different destination from the Club tab', async () => {
    render(<EventScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the club' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });
```

to:

```tsx
  // This screen's back link now goes to /clubs -- the dashboard, not the
  // specific club -- because the club management page no longer lists
  // games (2026-09-02-club-page-games-and-back-links-design.md): the
  // dashboard is the only real way into this screen left, so that is where
  // back goes. The Club tab reaches the same /clubs route but renders as
  // already-active here, which reads as "you are here" rather than "go
  // back" -- the same reasoning every other back link on this branch
  // documents -- so the explicit link still earns its place.
  it('draws a back link to the dashboard', async () => {
    render(<EventScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/events-detail.test.tsx -t "back link"`
Expected: FAIL — the screen still has an accessible button named "Back to the club" pushing `/clubs/club-1`, not one named "Back to your clubs" pushing `/clubs`

- [ ] **Step 3: Change the back button's destination**

In `app/clubs/[id]/events/[eventId]/index.tsx`, change:

```tsx
      {/*
        Kept, not dropped: this goes to /clubs/${clubId}, a specific club,
        which is a different destination from the Club tab's own /clubs (see
        app/clubs/[id]/venues.tsx's identical "Back to the club" button, and
        app/clubs/[id]/index.tsx for the contrasting case where a back link
        WAS dropped because its destination and the tab's were the same
        place).
      */}
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
```

to:

```tsx
      {/*
        Goes to /clubs, not /clubs/${clubId}: the club management page no
        longer lists games (2026-09-02-club-page-games-and-back-links-
        design.md deleted its own "Upcoming" section), so the dashboard is
        the only real way into this screen left. The Club tab reaches the
        same /clubs route but renders as already-active here, which reads
        as "you are here" rather than "go back", so this explicit link
        still earns its place — same reasoning every other back link on
        this branch documents.
      */}
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/clubs/\[id\]/events/\[eventId\]/index.tsx app/__tests__/events-detail.test.tsx
git commit -m "fix(events): point the game screen's back link at the dashboard

Now that the club management page no longer lists games, the dashboard is
the only real way into this screen — the back link should say so instead
of always returning to the club page regardless of where you came from."
```

---

### Task 3: Add a back link to the "Add a game" form

**Files:**
- Modify: `app/clubs/[id]/events/new.tsx`
- Modify: `app/__tests__/events-new.test.tsx`

**Interfaces:** None.

- [ ] **Step 1: Add the failing test first**

In `app/__tests__/events-new.test.tsx`, add a new describe block right after `describe('guard ordering', ...)` and before `describe('Cancel', ...)`:

```tsx
// The club management page's own "Add a game" + is gone
// (2026-09-02-club-page-games-and-back-links-design.md) — every real way
// into this form is the dashboard now (its header's own +, or the
// empty-state "Host a table" button), so this screen's back link goes
// there. The Club tab reaches the same /clubs route but renders as
// already-active here, which reads as "you are here" rather than "go
// back" -- the same reasoning every other back link on this branch
// documents.
describe('back link', () => {
  it('draws a back link to the dashboard', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.click(screen.getByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/events-new.test.tsx -t "back link"`
Expected: FAIL — no button named "Back to your clubs" exists on this screen yet

- [ ] **Step 3: Add the back button**

In `app/clubs/[id]/events/new.tsx`, add the import:

```tsx
import { ChevronLeftIcon } from '../../../../components/icons';
```

(alongside the other component imports; `../../../../` is the same relative depth this file's other imports already use, e.g. `Button`, `Screen`.)

Update the file's own docstring — it currently explains only why the bottom "Cancel" button isn't redundant with the Club tab. Change:

```tsx
 * Carries the tab bar with `active="club"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `host` included — it is not gated to the four tabs
 * themselves. The Cancel button below is NOT redundant with the Club tab and
 * stays: it returns to THIS specific club (`/clubs/${clubId}`), while the
 * Club tab goes to the clubs dashboard (`/clubs`) — different destinations,
 * unlike the `newclub` screen's dropped `← Clubs` link, which pointed at the
 * same place its tab does.
 */
```

to:

```tsx
 * Carries the tab bar with `active="club"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `host` included — it is not gated to the four tabs
 * themselves. The Cancel button below is NOT redundant with the Club tab and
 * stays: it returns to THIS specific club (`/clubs/${clubId}`), while the
 * Club tab goes to the clubs dashboard (`/clubs`) — different destinations,
 * unlike the `newclub` screen's dropped `← Clubs` link, which pointed at the
 * same place its tab does.
 *
 * Also carries an explicit top-of-screen back link to `/clubs`
 * (2026-09-02-club-page-games-and-back-links-design.md) — the Club tab
 * reaches that same route but renders as already-active here, which reads
 * as "you are here" rather than "go back", the same reasoning every other
 * back link on this branch documents. This is a different control from the
 * Cancel button above: "I didn't mean to be here" versus "abandon this
 * draft".
 */
```

Insert the back button as the first child of the populated `Screen`, immediately before the "Add a game" heading:

```tsx
  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
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

      <Text style={styles.heading}>Add a game</Text>
```

Add the style:

```tsx
  backButton: { alignSelf: 'flex-start' },
```

(in the `StyleSheet.create` block at the bottom of the file, alongside `container`/`centered`/`heading`).

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/events-new.test.tsx`
Expected: PASS (whole file — confirm the existing `'Cancel'` describe block's two tests still pass unchanged, since the bottom Cancel button and its `back()`/`replace()` fallback logic are untouched)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/clubs/\[id\]/events/new.tsx app/__tests__/events-new.test.tsx
git commit -m "fix(events): give the Add a game form a back link to the dashboard

It had no top-of-screen way back at all, only a bottom Cancel. Now that
every real way into this form is the dashboard, this matches the back-link
pattern already used on the other screens reached that way."
```

---

### Final verification (not a separate task)

- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] Visual baselines still cannot regenerate in this environment (no Docker) — same accepted gap as the rest of this branch's work; `club-detail`, `event-detail`, and `new-event` baselines will need regeneration whenever Docker is available.
