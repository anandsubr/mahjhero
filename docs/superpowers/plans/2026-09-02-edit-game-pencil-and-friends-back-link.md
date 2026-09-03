# Edit-game pencil, friends back link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two fixes in [docs/superpowers/specs/2026-09-02-edit-game-pencil-and-friends-back-link-design.md](../specs/2026-09-02-edit-game-pencil-and-friends-back-link-design.md) on branch `UI-tweaks`.

**Architecture:** Two independent tasks, one per screen — no shared code between them.

**Tech Stack:** React Native (Expo Router) + TypeScript, Vitest + Testing Library.

## Global Constraints

- Run scoped tests with `npm test -- <path>` (`TZ=America/New_York vitest run`).
- Every pressable needs `accessibilityRole="button"` and an `accessibilityLabel`.
- Never use `router.back()` on a top-of-screen back link — always an explicit `router.push(...)` destination.
- The established back-link shape:
  ```tsx
  <Button
    variant="ghost"
    big={false}
    icon={<ChevronLeftIcon color={colors.accentColor} />}
    onPress={() => router.push('<destination>')}
    accessibilityLabel="<Back to X>"
    style={styles.backButton}
  >
    <Label>
  </Button>
  ```
  with `backButton: { alignSelf: 'flex-start' }`, first child of the populated `Screen`.

---

### Task 1: Move "Edit this game" to a pencil beside the title

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:** None.

- [ ] **Step 1: Update the failing tests first**

In `app/__tests__/events-detail.test.tsx`, change:

```tsx
  it('shows the edit link and offers cancellation', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByText('Edit this game')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel this game'));
    await vi.waitFor(() => expect(cancelEvent).toHaveBeenCalledWith('event-1'));
  });
```

to:

```tsx
  it('shows the edit pencil and offers cancellation', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByRole('button', { name: 'Edit Thursday Mahjong' })).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel this game'));
    await vi.waitFor(() => expect(cancelEvent).toHaveBeenCalledWith('event-1'));
  });

  // Nothing asserted this before -- the old plain `Link`'s `href` was never
  // checked, only its visible text.
  it('opens the edit screen when the pencil is pressed', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Thursday Mahjong' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1/events/event-1/edit');
  });
```

Change:

```tsx
  it('removes organizer controls once the event reloads as cancelled', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    fetchEvent.mockResolvedValue({ ...EVENT, status: 'cancelled' as const });
    fireEvent.click(screen.getByText('Cancel this game'));

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Cancel this game')).toBeNull();
    expect(screen.queryByText('Add a table')).toBeNull();
    expect(screen.queryByText('Edit this game')).toBeNull();
  });
```

to:

```tsx
  it('removes organizer controls once the event reloads as cancelled', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    fetchEvent.mockResolvedValue({ ...EVENT, status: 'cancelled' as const });
    fireEvent.click(screen.getByText('Cancel this game'));

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Cancel this game')).toBeNull();
    expect(screen.queryByText('Add a table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Thursday Mahjong' })).toBeNull();
  });
```

Leave `'offers no organizer controls at all'`'s `expect(screen.queryByText('Edit this game')).toBeNull();` untouched — it's already correct for both the old and new control (a plain member never sees it either way).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/events-detail.test.tsx -t "edit"`
Expected: FAIL — the screen still renders a plain text `Link` "Edit this game" with no accessible role/name of "Edit Thursday Mahjong", and never calls `push` on click (it's a `Link`, not a `Pressable` with `onPress`)

- [ ] **Step 3: Move the control**

In `app/clubs/[id]/events/[eventId]/index.tsx`, change the imports:

```tsx
import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
```

to:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
```

```tsx
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
```

to:

```tsx
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
```

```tsx
import { ChevronLeftIcon } from '../../../../../components/icons';
```

to:

```tsx
import { ChevronLeftIcon, PencilIcon } from '../../../../../components/icons';
```

Change the title row:

```tsx
      <View style={styles.row}>
        <Text style={styles.heading}>{event.title}</Text>
        {event.status === 'cancelled' ? <Tag>Cancelled</Tag> : null}
      </View>
```

to:

```tsx
      <View style={styles.row}>
        <View style={styles.titleRow}>
          <Text style={styles.heading}>{event.title}</Text>
          {isOrganizer && event.status !== 'cancelled' ? (
            <Pressable
              onPress={() => router.push(`/clubs/${clubId}/events/${eventId}/edit`)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${event.title}`}
            >
              <PencilIcon size={16} color={colors.accentColor} />
            </Pressable>
          ) : null}
        </View>
        {event.status === 'cancelled' ? <Tag>Cancelled</Tag> : null}
      </View>
```

Delete the old bottom link:

```tsx
          <Link
            href={`/clubs/${clubId}/events/${eventId}/edit`}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Edit this game</Text>
          </Link>
```

(leave the `Button`s immediately around it — "Door list" above, and the closing `</>` — untouched; only this `Link` block is removed.)

Add the new style and delete the two dead ones. Change:

```tsx
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
```

to:

```tsx
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexShrink: 1,
  },
```

and delete:

```tsx
  linkRow: { marginTop: space[4] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
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
git commit -m "fix(events): move Edit this game to a pencil beside the title

It was a plain text link stranded at the bottom of the organizer controls,
disconnected from the title it edits. Matches DashboardHeader's own
Manage-a-club pencil."
```

---

### Task 2: Give the friends page a back link to Profile

**Files:**
- Modify: `app/friends.tsx`
- Modify: `app/__tests__/friends.test.tsx`

**Interfaces:** None.

- [ ] **Step 1: Fix the test file's router mock, then add the failing test**

In `app/__tests__/friends.test.tsx`, change:

```tsx
vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/friends',
```

to:

```tsx
const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/friends',
```

(`vi.clearAllMocks()` already runs in the existing `beforeEach`, which resets this hoisted `push` between tests same as every other mock in the file — no extra reset needed.)

Add, as the first test inside `describe('friends screen', ...)`, right after the `beforeEach` block:

```tsx
  it('draws a back link to profile', async () => {
    render(<FriendsScreen />);
    await screen.findByText('Friends');
    fireEvent.click(screen.getByRole('button', { name: 'Back to profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/friends.test.tsx -t "back link"`
Expected: FAIL — no button named "Back to profile" exists on this screen yet

- [ ] **Step 3: Add the back button**

In `app/friends.tsx`, change the imports:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
```

to:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { ChevronLeftIcon } from '../components/icons';
```

Update the docstring. Change:

```tsx
 * Not one of the four tabs itself, but `appScreens` in the design still
 * renders the bar as a sibling of every signed-in screen, this one included
 * — the design source has no per-screen gate. It carries `active="profile"`:
 * this screen hangs off Profile. The artboard's own back link, pointing at
 * that same Profile screen, is gone now that the Profile tab reaches the
 * identical route — the same call already made once for the club detail
 * screen (`app/clubs/[id]/index.tsx`'s own docstring).
```

to:

```tsx
 * Not one of the four tabs itself, but `appScreens` in the design still
 * renders the bar as a sibling of every signed-in screen, this one included
 * — the design source has no per-screen gate. It carries `active="profile"`:
 * this screen hangs off Profile.
 *
 * Also carries an explicit back link to Profile
 * (2026-09-01-back-links-design.md), reinstating the artboard's own one —
 * an earlier version of this screen dropped it on the premise that the
 * Profile tab reaches the identical route, but that tab renders as already-
 * active here, which reads as "you are here" rather than "go back", the
 * same correction already made for the club detail, new-club, new-message
 * and check-in screens.
```

Add `const router = useRouter();` inside `FriendsScreen`, alongside `const { session, loading } = useSession();`:

```tsx
export default function FriendsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
```

Add the back button as the first child of the populated `Screen`:

```tsx
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

      <Text style={styles.heading}>Friends</Text>
```

Add the style, alongside `container`/`centered`:

```tsx
  backButton: { alignSelf: 'flex-start' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/friends.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/friends.tsx app/__tests__/friends.test.tsx
git commit -m "fix(friends): give the friends page a back link to profile

The Profile tab renders as already-active here, which reads as \"you are
here\" not \"go back\" -- the same correction already made for four other
screens, just never applied to this one."
```

---

### Final verification (not a separate task)

- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] Visual baselines still cannot regenerate in this environment (no Docker) — same accepted gap as the rest of this branch's work.
