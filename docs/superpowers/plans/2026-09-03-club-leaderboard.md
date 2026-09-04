# Club Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an all-time, points-based club leaderboard aggregated from `table_rounds`, reachable from the Club Dashboard (a tappable "Leader: <name>" line) and the Club Edit page (a "Leaderboard" button), both opening the same new ranked-list screen.

**Architecture:** Server-side aggregation via one new, plain (non-`security definer`) Postgres function that relies entirely on existing RLS (`table_rounds_select_member`, `profiles_select_self_or_comember`) rather than re-implementing a membership check. The new screen (`app/clubs/[id]/leaderboard.tsx`) is built directly on `app/clubs/[id]/venues.tsx`'s existing template — same guard order, same back-button treatment, same flat `DashboardHeader` shape — rather than inventing a new screen shape.
>
> **Post-implementation correction:** this "plain, RLS-only" design was never shippable — `profiles_select_self_or_comember` had already been dropped by an earlier migration before this plan was even written. The function shipped `security definer` with an explicit `is_club_member` guard instead, mirroring `public.club_roster`. See "Post-Implementation Correction" at the end of this document.

**Tech Stack:** Expo Router (file-based routing), React Native + react-native-web, Supabase (Postgres + PostgREST + RLS), Vitest + `@testing-library/react` for tests.

## Global Constraints

- Test commands run with `TZ=America/New_York` (see `package.json`'s `"test"` script).
- This repo has no jest-dom — `toHaveStyle`/`toHaveValue` and similar matchers do not exist here; use `getComputedStyle`/`(el as HTMLInputElement).value` or plain DOM assertions instead.
- Every `lib/*.ts` fetch function follows the "never rejects" convention: catch, log via `console.error`, return `null` (or `{ error }` for writes) instead of throwing.
- No local Supabase/Postgres stack is available in this environment (no Docker) — `npx supabase migration up` is expected to fail with a connection error. Judge new SQL correctness by careful reading, not execution.

---

### Task 1: `club_leaderboard` Postgres function

**Files:**
- Create: `supabase/migrations/20260904000000_club_leaderboard.sql`

**Interfaces:**
- Consumes: `public.table_rounds` (existing), `public.profiles` (existing), the existing RLS policies `table_rounds_select_member` and `profiles_select_self_or_comember` (no changes to either).
- Produces: `public.club_leaderboard(target_club uuid) returns table (profile_id uuid, display_name text, total_points bigint, rounds_won bigint)`.

This is a brand-new function (not a re-signatured existing one), so there is no drop-and-recreate ceremony — a single `create function` + `grant execute` is enough.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260904000000_club_leaderboard.sql`:

> **Post-implementation note:** the code block below is the ORIGINAL, as-planned SQL, which relied on a `profiles_select_self_or_comember` RLS policy that — unknown to this plan at the time it was written — had already been dropped by an earlier, unrelated migration. It was never applied. See "Post-Implementation Correction" at the end of this document for what actually shipped, and `supabase/migrations/20260904000000_club_leaderboard.sql` for the real, current SQL.

```sql
/*
 * All-time, ranked by total points then rounds won (confirmed during
 * brainstorming). Deliberately NOT `security definer`: this table already
 * has the exact RLS this function needs --
 * `table_rounds_select_member` (20260902060000_create_table_rounds.sql,
 * `using (public.is_club_member(club_id))`) and
 * `profiles_select_self_or_comember` (20260822033527_create_clubs.sql) --
 * so running as the caller's own role, unprivileged, means a non-member
 * calling this for a club they're not in simply gets zero rows back (the
 * same thing querying table_rounds directly would give them), with no
 * membership check to duplicate or drift from those two policies.
 */
create function public.club_leaderboard(target_club uuid)
returns table (
  profile_id   uuid,
  display_name text,
  total_points bigint,
  rounds_won   bigint
)
language sql
stable
set search_path = public
as $$
  select
    tr.winner_profile_id,
    p.display_name,
    sum(tr.points)::bigint,
    count(*)::bigint
  from public.table_rounds tr
  join public.profiles p on p.id = tr.winner_profile_id
  where tr.club_id = target_club
  group by tr.winner_profile_id, p.display_name
  order by sum(tr.points) desc, count(*) desc;
$$;

grant execute on function public.club_leaderboard(uuid) to authenticated;
```

**As actually shipped** (see `supabase/migrations/20260904000000_club_leaderboard.sql`):

```sql
/*
 * The leaderboard: all-time member standings, ranked by total points then
 * rounds won.
 *
 * security definer because `profiles` is self-only below — the caller cannot
 * read a co-member's row directly, by design. RLS therefore does NOT protect
 * this function, so it re-asks the membership question itself: the
 * `is_club_member(target_club)` predicate is the tenant boundary, not
 * decoration. Without it any signed-in user holding a club uuid could read
 * that club's leaderboard.
 *
 * The return type is the exposure surface. Adding a column here is the
 * deliberate act of publishing it to every co-member.
 *
 * Deliberately does NOT filter on club_members.status = 'active' the way
 * club_roster does: a departed member's historical rounds still count
 * toward an all-time leaderboard. Intentional, not an oversight.
 */
create function public.club_leaderboard(target_club uuid)
returns table (
  profile_id   uuid,
  display_name text,
  total_points bigint,
  rounds_won   bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    tr.winner_profile_id,
    p.display_name,
    sum(tr.points)::bigint,
    count(*)::bigint
  from public.table_rounds tr
  join public.profiles p on p.id = tr.winner_profile_id
  where tr.club_id = target_club
    and public.is_club_member(target_club)
  group by tr.winner_profile_id, p.display_name
  order by sum(tr.points) desc, count(*) desc, tr.winner_profile_id;
$$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC, and Supabase's
-- hosted bootstrap grants it directly to anon as well; `revoke from public`
-- alone does not touch a direct grant. Both are revoked so the ACL says what
-- it means. See 20260822045809 for where that was learned.
revoke execute on function public.club_leaderboard(uuid) from public;
revoke execute on function public.club_leaderboard(uuid) from anon;
grant execute on function public.club_leaderboard(uuid) to authenticated;
```

- [ ] **Step 2: Attempt to apply**

Run: `npx supabase migration up`
Expected: fails with a connection error (no local Docker/Postgres stack in this environment) — this is expected, not a blocker. Do not attempt to install or start Docker.

- [ ] **Step 3: Proofread the SQL by hand**

Since this cannot be executed here, check by reading:
- Parentheses and dollar-quoting (`$$ ... $$`) are balanced.
- The `returns table (...)` column list matches exactly what the `select` list produces, in the same order (`winner_profile_id` → `profile_id`, `display_name` → `display_name`, `sum(...)` → `total_points`, `count(*)` → `rounds_won`).
- `group by` includes every non-aggregated column in the `select` list (`tr.winner_profile_id`, `p.display_name`) — both are there.
- The `grant execute` signature (`club_leaderboard(uuid)`) matches the function's actual single-argument signature.

- [ ] **Step 4: Run the full unit suite** (this task adds no TypeScript, so this is a smoke check that nothing else broke)

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests, unchanged count from before this task)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904000000_club_leaderboard.sql
git commit -m "feat(leaderboard): add the club_leaderboard Postgres function"
```

---

### Task 2: `lib/leaderboard.ts` client wrapper

**Files:**
- Create: `lib/leaderboard.ts`
- Create: `lib/leaderboard.test.ts`

**Interfaces:**
- Consumes: Task 1's `club_leaderboard` RPC.
- Produces: `type LeaderboardEntry = { profile_id: string; display_name: string; total_points: number; rounds_won: number }`; `fetchClubLeaderboard(clubId: string): Promise<LeaderboardEntry[] | null>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/leaderboard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import { fetchClubLeaderboard, type LeaderboardEntry } from './leaderboard';

beforeEach(() => {
  rpc.mockReset();
});

function entry(over: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    profile_id: 'p1',
    display_name: 'Ada',
    total_points: 120,
    rounds_won: 4,
    ...over,
  };
}

describe('fetchClubLeaderboard', () => {
  it('returns the ranked entries on success', async () => {
    rpc.mockResolvedValue({ data: [entry(), entry({ profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 3 })], error: null });
    const result = await fetchClubLeaderboard('club-1');
    expect(rpc).toHaveBeenCalledWith('club_leaderboard', { target_club: 'club-1' });
    expect(result).toEqual([
      entry(),
      entry({ profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 3 }),
    ]);
  });

  it('returns an empty array for a club with no recorded rounds', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchClubLeaderboard('club-1')).toEqual([]);
  });

  it('returns null rather than throwing when the read errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection failure', code: '08006' } });
    expect(await fetchClubLeaderboard('club-1')).toBeNull();
  });

  it('returns null rather than throwing on a network failure', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    expect(await fetchClubLeaderboard('club-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/leaderboard.test.ts`
Expected: FAIL — `lib/leaderboard.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `lib/leaderboard.ts`:

```ts
import { supabase } from './supabase';

export type LeaderboardEntry = {
  profile_id: string;
  display_name: string;
  total_points: number;
  rounds_won: number;
};

/**
 * All-time, ranked by total points then rounds won -- exactly the order
 * `club_leaderboard` (supabase/migrations/20260904000000) already returns,
 * so this never re-sorts client-side. Never rejects, the same "never
 * rejects" contract every other lib/*.ts fetch follows.
 */
export async function fetchClubLeaderboard(
  clubId: string,
): Promise<LeaderboardEntry[] | null> {
  try {
    const { data, error } = await supabase.rpc('club_leaderboard', {
      target_club: clubId,
    });
    if (error) {
      console.error('fetchClubLeaderboard failed', error);
      return null;
    }
    return (data ?? []) as LeaderboardEntry[];
  } catch (cause) {
    console.error('fetchClubLeaderboard failed', cause);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/leaderboard.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full unit suite and tsc**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add lib/leaderboard.ts lib/leaderboard.test.ts
git commit -m "feat(leaderboard): add lib/leaderboard.ts"
```

---

### Task 3: The leaderboard screen

**Files:**
- Create: `app/clubs/[id]/leaderboard.tsx`
- Create: `app/__tests__/leaderboard.test.tsx`

**Interfaces:**
- Consumes: `lib/clubs.ts`'s existing `fetchClub`; Task 2's `fetchClubLeaderboard`/`LeaderboardEntry`.
- Produces: a new route, `/clubs/[id]/leaderboard`.

- [ ] **Step 1: Write the failing tests**

Create `app/__tests__/leaderboard.test.tsx`, following `app/__tests__/venues.test.tsx`'s exact mock-setup template:

```tsx
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
  usePathname: () => '/clubs/club-1/leaderboard',
  useLocalSearchParams: () => searchParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchClub = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
  };
});

const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));

const fetchProfile = vi.fn();

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

import LeaderboardScreen from '../clubs/[id]/leaderboard';

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchClubLeaderboard.mockResolvedValue([
    { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    { profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 5 },
  ]);
  fetchProfile.mockResolvedValue(null);
});

describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<LeaderboardScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchClub).not.toHaveBeenCalled();
    expect(fetchClubLeaderboard).not.toHaveBeenCalled();
  });
});

describe('LeaderboardScreen', () => {
  it('heads the screen with the club as kicker and Leaderboard as the name', async () => {
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Leaderboard')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
  });

  it('ranks entries by the order the RPC already returns, numbering from 1', async () => {
    render(<LeaderboardScreen />);
    await screen.findByText('Ada');
    expect(screen.getByText('120 pts')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByText('80 pts')).toBeTruthy();
    expect(screen.getByText('4 rounds won')).toBeTruthy();
    expect(screen.getByText('5 rounds won')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('falls back to "Member" for an entry with no display name', async () => {
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: '', total_points: 25, rounds_won: 1 },
    ]);
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('shows an empty state when the club has no recorded rounds', async () => {
    fetchClubLeaderboard.mockResolvedValue([]);
    render(<LeaderboardScreen />);
    await screen.findByText('Leaderboard');
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('degrades gracefully when the leaderboard fails to load, without blanking the club name', async () => {
    fetchClubLeaderboard.mockResolvedValue(null);
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(
      screen.getByText('The leaderboard could not be loaded. Pull to refresh or try again shortly.'),
    ).toBeTruthy();
  });

  it('draws a back link to the club', async () => {
    render(<LeaderboardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the club' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/leaderboard.test.tsx`
Expected: FAIL — `app/clubs/[id]/leaderboard.tsx` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/clubs/[id]/leaderboard.tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import DashboardHeader from '../../../components/DashboardHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import { ChevronLeftIcon } from '../../../components/icons';
import { fetchClub } from '../../../lib/clubs';
import type { Club } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  fetchClubLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/leaderboard';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

/**
 * All-time, points-first ranking, built on app/clubs/[id]/venues.tsx's own
 * template (same guard order, same back button, same flat DashboardHeader
 * shape) rather than a new screen shape. `entriesFailed` is kept separate
 * from `loadFailed` the same way venues.tsx keeps `venuesFailed` apart from
 * its own club/roster load -- a failed leaderboard read is not "no rounds
 * recorded" (the empty-state copy would be a false statement), and must not
 * blank a screen whose club name loaded just fine.
 */
export default function LeaderboardScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [entriesFailed, setEntriesFailed] = useState(false);

  useEffect(() => {
    if (!session || !clubId) return;
    let cancelled = false;
    fetchClub(clubId).then((c) => {
      if (cancelled) return;
      if (c === null) setLoadFailed(true);
      else setClub(c);
      setReady(true);
    });
    fetchClubLeaderboard(clubId).then((result) => {
      if (cancelled) return;
      if (result === null) setEntriesFailed(true);
      else setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session, clubId]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  // Checked before `!ready`, deliberately: `ready` only ever becomes true
  // inside the effect above, which returns immediately with no session, so
  // a signed-out visitor could never reach it -- the same guard-ordering
  // fix already applied on every other screen in this app.
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (loadFailed || !club) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      {/* Generic label, not club.name: the kicker right below already names
          the club, so repeating it here would read as a mistake rather than
          confirmation. Matches venues.tsx. */}
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        Club
      </Button>

      <DashboardHeader kicker={club.name} name="Leaderboard" meta="" />

      {entriesFailed ? (
        <ErrorBanner message="The leaderboard could not be loaded. Pull to refresh or try again shortly." />
      ) : entries.length === 0 ? (
        <Text style={styles.help}>No rounds recorded yet.</Text>
      ) : (
        entries.map((entry, index) => (
          <Card key={entry.profile_id}>
            <View style={styles.row}>
              <Text style={styles.rank}>{index + 1}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {entry.display_name.trim().length > 0
                  ? entry.display_name
                  : 'Member'}
              </Text>
              <Text style={styles.points}>{entry.total_points} pts</Text>
            </View>
            <Text style={styles.help}>
              {entry.rounds_won} {entry.rounds_won === 1 ? 'round' : 'rounds'} won
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  rank: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.textMuted,
    minWidth: 24,
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  points: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/leaderboard.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full unit suite and tsc**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/leaderboard.tsx" app/__tests__/leaderboard.test.tsx
git commit -m "feat(leaderboard): add the club leaderboard screen"
```

---

### Task 4: Club Dashboard entry point — "Leader: <name>"

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: Task 2's `fetchClubLeaderboard`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `app/__tests__/clubs.test.tsx`, add a mock for the new module near the file's other `vi.mock` blocks (search for `vi.mock('../../lib/greetings'` to find the neighboring pattern to copy):

```tsx
const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));
```

In this file's shared `beforeEach`, add a default:

```tsx
  fetchClubLeaderboard.mockResolvedValue([]);
```

Then add the tests, near the other "Your club" scope tests (search for `'narrows the games list to the picked club'` to find that area):

```tsx
  it('shows a tappable "Leader" line for the club in view, and navigates to its leaderboard', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    ]);
    render(<ClubsScreen />);

    expect(await screen.findByText('Leader: Ada')).toBeTruthy();
    fireEvent.click(screen.getByText('Leader: Ada'));
    expect(push).toHaveBeenCalledWith(`/clubs/${CLUB.id}/leaderboard`);
  });

  it('shows no Leader line when the club has no recorded rounds', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchClubLeaderboard.mockResolvedValue([]);
    render(<ClubsScreen />);

    await screen.findAllByText('Riverside Mah Jongg');
    expect(screen.queryByText(/^Leader:/)).toBeNull();
  });
```

(Check this file's existing `push` mock name and the exact fixture text used elsewhere for a single-club render — e.g. the greeting tests already established `fetchMyClubs.mockResolvedValue([CLUB])` resolves to the "Your club" scope for a one-club member; reuse that exact pattern rather than inventing a new one. Use `findAllByText`, not `findByText`, for `'Riverside Mah Jongg'` in the second test — a one-club member's name also appears in the still-visible chip row, the same ambiguity the roster/greeting tests in this file already handle the same way.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "Leader"`
Expected: FAIL — no "Leader:" text exists on the dashboard yet.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/index.tsx`, add the import:

```tsx
import { fetchClubLeaderboard, type LeaderboardEntry } from '../../lib/leaderboard';
```

Add state near the file's other per-scope state (search for `const [displayName, setDisplayName]` to find that area):

```tsx
  const [leader, setLeader] = useState<LeaderboardEntry | null>(null);
```

Add a new effect, keyed on `scopeClubId`, right after the `scopeClubId` derivation (search for `const scopeClubId =` to find it — this is computed further down the component than the mount effect, so this new effect goes near where `scopeClubId` itself is computed, not up with the mount effect):

```tsx
  useEffect(() => {
    if (!scopeClubId) {
      setLeader(null);
      return;
    }
    let cancelled = false;
    fetchClubLeaderboard(scopeClubId).then((result) => {
      if (cancelled) return;
      setLeader(result && result.length > 0 ? result[0] : null);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeClubId]);
```

In the JSX, inside the existing `{scope.kicker === 'Your club' ? (...) : null}` block, add the Leader line right after the `<DashboardHeader ... />` call closes (search for the `onPressBack={...}\n        />` that closes that `DashboardHeader`):

```tsx
        />
      ) : null}

      {scopeClubId && leader ? (
        <Pressable
          onPress={() => router.push(`/clubs/${scopeClubId}/leaderboard`)}
          accessibilityRole="button"
          style={styles.leaderRow}
        >
          <Text style={styles.leaderText}>
            Leader:{' '}
            {leader.display_name.trim().length > 0
              ? leader.display_name
              : 'Member'}
          </Text>
        </Pressable>
      ) : null}
```

(Note: place this new block as a sibling immediately after the closing `) : null}` of the `scope.kicker === 'Your club'` conditional, not inside it — both conditions independently gate on the same "a real club is in view" fact, but keeping them as separate top-level conditionals avoids nesting the whole Leader block inside the DashboardHeader's own JSX return.)

Add the styles, near the file's other top-level text styles (e.g. beside `greeting`):

```tsx
  leaderRow: {
    alignSelf: 'center',
    marginTop: space[1],
  },
  leaderText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
```

`Pressable` should already be imported in this file (it's used elsewhere for game rows) — check with `grep -n "^import.*Pressable" app/clubs/index.tsx` before adding a duplicate import.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full unit suite and tsc**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(leaderboard): show a tappable Leader line on the club dashboard"
```

---

### Task 5: Club Edit entry point — "Leaderboard" button

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: nothing new (just navigation).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `app/__tests__/clubs.test.tsx`, in the `ClubDetailScreen` describe block (search for `describe('ClubDetailScreen'` or similar — the block containing tests like `'names the club in the dashboard header'`), add:

```tsx
  it('shows a Leaderboard button to every member, not just organizers', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    const button = await screen.findByRole('button', { name: 'Leaderboard' });
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith('/clubs/club-1/leaderboard');
  });
```

(Check this describe block's existing tests for the exact club id used in fixtures — e.g. `'club-1'` vs `id` from `searchParams` — and match it exactly; also confirm the exact `push`/`router` mock name this describe block already uses, since it may differ from the `ClubsScreen` describe block's own `push` mock instance if the file scopes them separately.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "Leaderboard button"`
Expected: FAIL — no "Leaderboard" button exists on this screen yet.

- [ ] **Step 3: Write minimal implementation**

In `app/clubs/[id]/index.tsx`, add a `Button` right after the `<DashboardHeader ... />` call, OUTSIDE the `{mayInvite ? (...) : null}` block (this button is for every member, unlike its organizer-only neighbors):

```tsx
      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        clubId={club.id}
        onPressBack={() => router.push('/clubs')}
        backLabel="Back to your clubs"
      />

      <Button
        variant="secondary"
        onPress={() => router.push(`/clubs/${id}/leaderboard`)}
        accessibilityLabel="Leaderboard"
      >
        Leaderboard
      </Button>

      {mayInvite ? (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full unit suite and tsc**

Run: `TZ=America/New_York npm test`
Expected: PASS (all tests)

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/index.tsx" app/__tests__/clubs.test.tsx
git commit -m "feat(leaderboard): add a Leaderboard button to the club edit page, open to every member"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 (`club_leaderboard` RPC) → Task 1. Part 2 (`lib/leaderboard.ts`) → Task 2. Part 3 (the screen) → Task 3. Part 4 (Dashboard entry point) → Task 4. Part 5 (Club Edit entry point) → Task 5. All five spec sections covered.
- **Type consistency:** `LeaderboardEntry` is defined once in `lib/leaderboard.ts` (Task 2) and imported by both later consumers (Tasks 3, 4) rather than redeclared. Field names (`profile_id`, `display_name`, `total_points`, `rounds_won`) match the RPC's own `returns table` column names exactly (snake_case throughout, since this data never crosses into camelCase — unlike the fee feature, there's no client-side "leaderboardEntry.totalPoints" form anywhere in this plan).
- **Placeholder scan:** no TBD/TODO markers; every step shows complete code.
- **The one thing worth double-checking at implementation time:** Task 1's function is genuinely new (not a re-signature), so unlike several tasks in the prior fee-feature plan, there is no "read the latest prior migration" step needed here — confirmed by grepping the migrations directory for `club_leaderboard` before writing this plan (no matches), so there is no existing version to accidentally regress.

## Post-Implementation Correction

This plan's Task 1 (and the accompanying spec) assumed a plain, non-`security definer` `club_leaderboard` function could rely entirely on existing RLS — specifically a `profiles_select_self_or_comember` policy on `public.profiles` that this plan cites as already in place (`20260822033527_create_clubs.sql`).

That assumption was wrong by the time this plan was written: `profiles_select_self_or_comember` had already been dropped by an earlier, unrelated migration, `20260822180000_club_roster_narrow_profiles.sql`, which narrowed `profiles` SELECT access to self-only. This plan's author did not catch that before drafting Task 1's SQL.

Task 1's own review caught the gap during implementation, before anything resting on the old assumption shipped. The function that actually shipped in `supabase/migrations/20260904000000_club_leaderboard.sql` is `security definer`, carrying an explicit `is_club_member(target_club)` check in its body as the tenant boundary (RLS does not protect a `security definer` function), matching the same pattern `public.club_roster` already uses for the same reason. The code blocks above in Task 1 have been updated to show both the original (never-applied) SQL and the actual shipped SQL side by side, rather than being silently rewritten, so this mistake and its correction both stay visible.

No other part of this plan (Tasks 2 through 5 — `lib/leaderboard.ts`, the screen, the two entry points) depended on the RLS-only assumption; those shipped as planned.
