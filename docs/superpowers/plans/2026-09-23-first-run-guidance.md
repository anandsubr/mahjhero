# First-Run Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give first-time players and organizers in-app guidance — a host setup checklist, a player "how it works" card, four one-time screen tips, and a replayable "How it works" page — without interrupting first sign-in.

**Architecture:** One new `profiles.dismissed_guides text[]` column records what each person has dismissed, server-side so it follows them across devices. A `GuidesProvider` in the root layout reads it once per user and exposes `useGuides()`; with no provider (every existing screen test), nothing is visible. All cards render through one presentational `TipCard`. Checklist progress is derived from head-count queries, never stored.

**Tech Stack:** Expo Router / React Native (+ react-native-web), Supabase (Postgres, RLS, column grants, pgTAP), Vitest + Testing Library, Playwright visual baselines.

**Spec:** `docs/superpowers/specs/2026-09-23-first-run-guidance-design.md`

## Global Constraints

- Nothing interrupts first sign-in: no modal, no carousel, no redirect.
- Unknown dismissal state ⇒ **hidden**. Never show a guide when `dismissed_guides` could not be read.
- A failed dismiss write keeps the card hidden for the session; no error banner.
- A failed checklist count ⇒ that club's checklist is hidden.
- Host checklist: shown to a club's `host` only. Player card: shown only when roles loaded successfully and the viewer is neither `host` nor `co_organizer` anywhere.
- Guide keys (exact strings): `player-intro`, `tip:event`, `tip:new-game`, `tip:check-in`, `tip:club`, `host-checklist:<clubId>`.
- Tip copy uses only labels verified in source on 2026-09-23: **Join**, **Empty** (seat), **Invite**, **Join the waitlist**, **Assigned tables**, **Open seating**, **Cost to play**, **Minimum spend**, **Here**, **Not coming**, **Paid**, **Search by name**, **Invite by email**, **Send invite**, **Import a roster**, **Open the club thread**. If a label has changed by implementation time, update the copy to match source; never ship a label that isn't on screen.
- Body text ≥ 16pt (`type.size.helper`); on the `accent2[100]` card ground use `colors.accent2[800]` for body text (the welcome screen's contrast rule).
- Branch `feat/first-run-guidance` (already created off `origin/main`, spec committed). Merge via PR, never straight to `main`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands: unit `npm test -- <path>`; DB `npm run test:db` (needs `npx supabase start`); visual `npm run test:visual`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260923100000_profiles_dismissed_guides.sql` (create) | Column + column-level UPDATE grant |
| `supabase/tests/database/portable/dismissed_guides_schema.test.sql` (create) | Column shape + grant exists |
| `supabase/tests/database/fixtures/dismissed_guides_rls.test.sql` (create) | Own-row write allowed, other-row write inert |
| `lib/guides.ts` (create) | Keys, fetch/save dismissed list, checklist counts query, pure `hostChecklist` |
| `lib/guides.test.ts` (create) | Unit tests for the above |
| `lib/use-guides.tsx` (create) | `GuidesProvider`, `useGuides()` |
| `lib/use-guides.test.tsx` (create) | Provider/hook tests |
| `app/_layout.tsx` (modify) | Mount `GuidesProvider` inside `SessionProvider` |
| `components/TipCard.tsx` (create) | Shared card shell |
| `components/__tests__/TipCard.test.tsx` (create) | Render/dismiss/action tests |
| `app/clubs/index.tsx` (modify) | Host checklist + player card on dashboard |
| `app/__tests__/guides-dashboard.test.tsx` (create) | Dashboard guide tests |
| `app/clubs/[id]/events/[eventId]/index.tsx`, `app/clubs/[id]/events/new.tsx`, `app/clubs/[id]/events/[eventId]/check-in.tsx`, `app/clubs/[id]/index.tsx` (modify) | One tip each |
| `app/__tests__/guides-tips.test.tsx` (create) | Tip visibility per screen/role |
| `app/how-it-works.tsx` (create), `app/profile.tsx` (modify) | Replay page + Profile row |
| `app/__tests__/how-it-works.test.tsx` (create) | Page + reset tests |
| `e2e/session.ts`, `e2e/visual.spec.ts` (modify) | Keep existing baselines guide-free; add guide baselines |

---

### Task 1: Database column and grant

**Files:**
- Create: `supabase/migrations/20260923100000_profiles_dismissed_guides.sql`
- Create: `supabase/tests/database/portable/dismissed_guides_schema.test.sql`
- Create: `supabase/tests/database/fixtures/dismissed_guides_rls.test.sql`

**Interfaces:**
- Produces: `public.profiles.dismissed_guides text[] not null default '{}'`, updatable by `authenticated` on their own row (existing `profiles_update_own` policy).

- [ ] **Step 1: Write the failing schema test**

`supabase/tests/database/portable/dismissed_guides_schema.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(4);

select has_column('public', 'profiles', 'dismissed_guides', 'profiles has dismissed_guides');
select col_type_is('public', 'profiles', 'dismissed_guides', 'text[]', 'dismissed_guides is text[]');
select col_not_null('public', 'profiles', 'dismissed_guides', 'dismissed_guides is not null');

-- profiles UPDATE is column-granted (20260903160000); a column missing from
-- that grant is unwritable from the client no matter what RLS says.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'dismissed_guides', 'UPDATE'),
  'authenticated may update dismissed_guides');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing RLS test**

`supabase/tests/database/fixtures/dismissed_guides_rls.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'guide-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'guide-bob@example.com');

select is(
  (select dismissed_guides from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  '{}'::text[],
  'a new profile starts with nothing dismissed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-0000000000d1", "role": "authenticated"}';

update public.profiles set dismissed_guides = array['player-intro']
 where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';

select is(
  (select dismissed_guides from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  array['player-intro'],
  'a member can write their own dismissed_guides');

-- RLS makes another member's row invisible to the update: zero rows, no error.
update public.profiles set dismissed_guides = array['tip:event']
 where id = 'bbbbbbbb-0000-0000-0000-0000000000d2';

reset role;

select is(
  (select dismissed_guides from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-0000000000d2'),
  '{}'::text[],
  'a member cannot write someone else''s dismissed_guides');

-- The grant must stay column-scoped: adding dismissed_guides must not have
-- reopened is_admin.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE'),
  'is_admin is still not client-writable');

select * from finish();
rollback;
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx supabase start` (if not running), then `npm run test:db`
Expected: FAIL — `dismissed_guides` column does not exist.

- [ ] **Step 4: Write the migration**

`supabase/migrations/20260923100000_profiles_dismissed_guides.sql`:

```sql
/*
 * First-run guidance (docs/superpowers/specs/2026-09-23-first-run-guidance-design.md).
 *
 * The keys of every tip/card a member has dismissed. Stored on the profile,
 * not the device, so a card dismissed on the web stays dismissed on the phone.
 *
 * profiles UPDATE is column-granted (20260903160000_profiles_update_column_grant.sql),
 * so the new column must be named in a grant of its own or the client cannot
 * write it. Row scope is unchanged: profiles_update_own still limits writes
 * to the member's own row.
 */
alter table public.profiles
  add column dismissed_guides text[] not null default '{}'
  constraint profiles_dismissed_guides_bounded check (cardinality(dismissed_guides) <= 200);

grant update (dismissed_guides) on public.profiles to authenticated;
```

- [ ] **Step 5: Apply and run tests**

Run: `npx supabase db reset && npm run test:db`
Expected: all DB tests PASS, including the two new files.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260923100000_profiles_dismissed_guides.sql supabase/tests/database/portable/dismissed_guides_schema.test.sql supabase/tests/database/fixtures/dismissed_guides_rls.test.sql
git commit -m "feat(db): profiles.dismissed_guides for first-run guidance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/guides.ts` — data access and checklist logic

**Files:**
- Create: `lib/guides.ts`
- Test: `lib/guides.test.ts`

**Interfaces:**
- Produces:
  - `type GuideKey = 'player-intro' | 'tip:event' | 'tip:new-game' | 'tip:check-in' | 'tip:club' | \`host-checklist:${string}\``
  - `hostChecklistKey(clubId: string): GuideKey`
  - `fetchDismissedGuides(userId: string): Promise<string[] | null>` (null = unknown)
  - `saveDismissedGuides(userId: string, keys: string[]): Promise<boolean>`
  - `type HostChecklistCounts = { events: number; members: number; pendingInvites: number; announcements: number }`
  - `fetchHostChecklistCounts(clubId: string): Promise<HostChecklistCounts | null>`
  - `type ChecklistStepKey = 'club' | 'game' | 'invite' | 'hello'`
  - `type ChecklistStep = { key: ChecklistStepKey; label: string; done: boolean; optional: boolean }`
  - `hostChecklist(counts: HostChecklistCounts): { steps: ChecklistStep[]; complete: boolean }`

- [ ] **Step 1: Write the failing tests**

`lib/guides.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read: from().select().eq().single(). Write: from().update().eq().select('id').
// Count: from().select(col, {count, head}).eq(...)[.eq/.is] awaited directly.
const single = vi.fn();
const selectAfterUpdate = vi.fn();
const countResults: Record<string, { count: number | null; error: unknown }> = {};

function countChain(table: string) {
  const result = () => Promise.resolve(countResults[table]);
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    result().then(resolve, reject);
  return chain;
}

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn((_cols: string, opts?: { head?: boolean }) =>
        opts?.head ? countChain(table) : { eq: vi.fn(() => ({ single })) },
      ),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ select: selectAfterUpdate })) })),
    })),
  },
}));

import {
  fetchDismissedGuides,
  fetchHostChecklistCounts,
  hostChecklist,
  hostChecklistKey,
  saveDismissedGuides,
} from './guides';

beforeEach(() => {
  single.mockReset();
  selectAfterUpdate.mockReset();
  for (const k of Object.keys(countResults)) delete countResults[k];
});

describe('hostChecklistKey', () => {
  it('scopes the checklist key to one club', () => {
    expect(hostChecklistKey('club-1')).toBe('host-checklist:club-1');
  });
});

describe('fetchDismissedGuides', () => {
  it('returns the stored keys', async () => {
    single.mockResolvedValue({ data: { dismissed_guides: ['player-intro'] }, error: null });
    await expect(fetchDismissedGuides('u1')).resolves.toEqual(['player-intro']);
  });

  it('returns null (unknown) on an error, never []', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchDismissedGuides('u1')).resolves.toBeNull();
  });

  it('returns null when the call throws', async () => {
    single.mockRejectedValue(new Error('network down'));
    await expect(fetchDismissedGuides('u1')).resolves.toBeNull();
  });
});

describe('saveDismissedGuides', () => {
  it('reports success when a row was written', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [{ id: 'u1' }], error: null });
    await expect(saveDismissedGuides('u1', ['tip:event'])).resolves.toBe(true);
  });

  it('reports failure when the update matched no rows', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });
    await expect(saveDismissedGuides('u1', ['tip:event'])).resolves.toBe(false);
  });

  it('reports failure instead of rejecting when the call throws', async () => {
    selectAfterUpdate.mockRejectedValue(new Error('network down'));
    await expect(saveDismissedGuides('u1', ['tip:event'])).resolves.toBe(false);
  });
});

describe('fetchHostChecklistCounts', () => {
  it('returns all four counts', async () => {
    countResults.events = { count: 1, error: null };
    countResults.club_members = { count: 3, error: null };
    countResults.club_invites = { count: 0, error: null };
    countResults.broadcasts = { count: 2, error: null };
    await expect(fetchHostChecklistCounts('c1')).resolves.toEqual({
      events: 1, members: 3, pendingInvites: 0, announcements: 2,
    });
  });

  it('returns null if any count fails', async () => {
    countResults.events = { count: 1, error: null };
    countResults.club_members = { count: null, error: { message: 'boom' } };
    countResults.club_invites = { count: 0, error: null };
    countResults.broadcasts = { count: 0, error: null };
    await expect(fetchHostChecklistCounts('c1')).resolves.toBeNull();
  });
});

describe('hostChecklist', () => {
  const none = { events: 0, members: 1, pendingInvites: 0, announcements: 0 };

  it('starts with only "Create your club" done', () => {
    const { steps, complete } = hostChecklist(none);
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ['club', true], ['game', false], ['invite', false], ['hello', false],
    ]);
    expect(complete).toBe(false);
  });

  it('counts a game as done at one event', () => {
    expect(hostChecklist({ ...none, events: 1 }).steps[1].done).toBe(true);
  });

  it('counts inviting as done at a second member', () => {
    expect(hostChecklist({ ...none, members: 2 }).steps[2].done).toBe(true);
  });

  it('counts inviting as done at one pending invite', () => {
    expect(hostChecklist({ ...none, pendingInvites: 1 }).steps[2].done).toBe(true);
  });

  it('is complete without the optional hello step', () => {
    expect(hostChecklist({ ...none, events: 1, members: 2 }).complete).toBe(true);
  });

  it('marks only the hello step optional', () => {
    expect(hostChecklist(none).steps.filter((s) => s.optional).map((s) => s.key)).toEqual(['hello']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/guides.test.ts`
Expected: FAIL — cannot resolve `./guides`.

- [ ] **Step 3: Implement**

`lib/guides.ts`:

```ts
import { supabase } from './supabase';

/**
 * First-run guidance (docs/superpowers/specs/2026-09-23-first-run-guidance-design.md).
 * Every tip and card is identified by one of these keys; a key present in
 * `profiles.dismissed_guides` means that person has dismissed it.
 */
export type GuideKey =
  | 'player-intro'
  | 'tip:event'
  | 'tip:new-game'
  | 'tip:check-in'
  | 'tip:club'
  | `host-checklist:${string}`;

/** Per club: a host of two clubs dismisses each club's checklist separately. */
export function hostChecklistKey(clubId: string): GuideKey {
  return `host-checklist:${clubId}`;
}

/**
 * `null` means "unknown", not "nothing dismissed". Callers must treat unknown
 * as hidden: re-showing a card someone already dismissed is worse than
 * missing a tip.
 */
export async function fetchDismissedGuides(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('dismissed_guides')
      .eq('id', userId)
      .single();
    if (error) {
      console.error('fetchDismissedGuides failed', error);
      return null;
    }
    return ((data as { dismissed_guides: string[] | null }).dismissed_guides ?? []);
  } catch (cause) {
    console.error('fetchDismissedGuides failed', cause);
    return null;
  }
}

/**
 * Writes the whole list rather than appending server-side: two devices
 * dismissing different tips in the same second is the only race, and its
 * worst case is one tip showing once more.
 *
 * `.select('id')` for the same reason as lib/profile.ts's updateProfile —
 * without it a write that matched no rows answers 204 with no error.
 */
export async function saveDismissedGuides(userId: string, keys: string[]): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ dismissed_guides: keys, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id');
    if (error || !data || data.length === 0) {
      console.error('saveDismissedGuides failed', error ?? 'update matched no rows');
      return false;
    }
    return true;
  } catch (cause) {
    console.error('saveDismissedGuides failed', cause);
    return false;
  }
}

export type HostChecklistCounts = {
  events: number;
  members: number;
  pendingInvites: number;
  announcements: number;
};

async function headCount(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count, error } = await build();
  if (error || count === null) {
    console.error('fetchHostChecklistCounts failed', error);
    return null;
  }
  return count;
}

/**
 * Four head-only counts, readable by a host under existing policies:
 * events_select_member (organizers see drafts and invite-only games too),
 * club_members_select_member, club_invites_select_organizer and
 * broadcasts_select_organizer. A broadcasts row exists exactly when an
 * organizer posted with "Also email everyone" on — i.e. an announcement.
 *
 * Any failure resolves null, which hides the checklist: wrong progress is
 * worse than no checklist.
 */
export async function fetchHostChecklistCounts(
  clubId: string,
): Promise<HostChecklistCounts | null> {
  try {
    const opts = { count: 'exact' as const, head: true };
    const [events, members, pendingInvites, announcements] = await Promise.all([
      headCount(() => supabase.from('events').select('id', opts).eq('club_id', clubId)),
      headCount(() =>
        supabase.from('club_members').select('profile_id', opts)
          .eq('club_id', clubId).eq('status', 'active'),
      ),
      headCount(() =>
        supabase.from('club_invites').select('id', opts)
          .eq('club_id', clubId).is('accepted_at', null),
      ),
      headCount(() => supabase.from('broadcasts').select('id', opts).eq('club_id', clubId)),
    ]);
    if (events === null || members === null || pendingInvites === null || announcements === null) {
      return null;
    }
    return { events, members, pendingInvites, announcements };
  } catch (cause) {
    console.error('fetchHostChecklistCounts failed', cause);
    return null;
  }
}

export type ChecklistStepKey = 'club' | 'game' | 'invite' | 'hello';

export type ChecklistStep = {
  key: ChecklistStepKey;
  label: string;
  done: boolean;
  optional: boolean;
};

/**
 * "Create your club" is always done: the card only exists for a club's host.
 * "Say hello" is optional and never holds the card open.
 */
export function hostChecklist(counts: HostChecklistCounts): {
  steps: ChecklistStep[];
  complete: boolean;
} {
  const steps: ChecklistStep[] = [
    { key: 'club', label: 'Create your club', done: true, optional: false },
    { key: 'game', label: 'Schedule your first game', done: counts.events > 0, optional: false },
    {
      key: 'invite',
      label: 'Invite your players',
      done: counts.members > 1 || counts.pendingInvites > 0,
      optional: false,
    },
    { key: 'hello', label: 'Say hello (optional)', done: counts.announcements > 0, optional: true },
  ];
  return { steps, complete: steps.every((s) => s.optional || s.done) };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- lib/guides.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guides.ts lib/guides.test.ts
git commit -m "feat(guides): dismissed-guide storage and host checklist logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GuidesProvider` and `useGuides()`

**Files:**
- Create: `lib/use-guides.tsx`
- Test: `lib/use-guides.test.tsx`
- Modify: `app/_layout.tsx` (wrap the Stack)

**Interfaces:**
- Consumes: `fetchDismissedGuides`, `saveDismissedGuides`, `GuideKey` (Task 2); `useSession` (`lib/session.tsx`).
- Produces:
  - `GuidesProvider({ children })`
  - `useGuides(): { isVisible(key: GuideKey): boolean; dismiss(key: GuideKey): void; reset(): Promise<boolean> }`
  - Without a provider: `isVisible` always false, `dismiss` no-op, `reset` resolves false. This is what keeps every existing screen test unchanged.

- [ ] **Step 1: Write the failing tests**

`lib/use-guides.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchDismissedGuides = vi.fn();
const saveDismissedGuides = vi.fn();
vi.mock('./guides', () => ({
  fetchDismissedGuides: (id: string) => fetchDismissedGuides(id),
  saveDismissedGuides: (id: string, keys: string[]) => saveDismissedGuides(id, keys),
}));

// Module-scoped: a fresh object per render would look like an account switch.
const SIGNED_IN = { session: { user: { id: 'u1' } }, loading: false };
let current: { session: { user: { id: string } } | null; loading: boolean } = SIGNED_IN;
vi.mock('./session', () => ({ useSession: () => current }));

import { GuidesProvider, useGuides } from './use-guides';

function Probe() {
  const guides = useGuides();
  return (
    <div>
      <span data-testid="event">{String(guides.isVisible('tip:event'))}</span>
      <button onClick={() => guides.dismiss('tip:event')}>dismiss</button>
      <button onClick={() => void guides.reset()}>reset</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  current = SIGNED_IN;
  saveDismissedGuides.mockResolvedValue(true);
});

describe('useGuides', () => {
  it('shows nothing without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows nothing until the dismissed list has loaded', () => {
    fetchDismissedGuides.mockReturnValue(new Promise(() => {}));
    render(<GuidesProvider><Probe /></GuidesProvider>);
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows nothing when the dismissed list could not be read', async () => {
    fetchDismissedGuides.mockResolvedValue(null);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(fetchDismissedGuides).toHaveBeenCalled());
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows a guide that is not dismissed', async () => {
    fetchDismissedGuides.mockResolvedValue([]);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
  });

  it('hides a dismissed guide at once and saves the new list', async () => {
    fetchDismissedGuides.mockResolvedValue(['player-intro']);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('event').textContent).toBe('false');
    expect(saveDismissedGuides).toHaveBeenCalledWith('u1', ['player-intro', 'tip:event']);
  });

  it('keeps a dismissed guide hidden even if the save fails', async () => {
    fetchDismissedGuides.mockResolvedValue([]);
    saveDismissedGuides.mockResolvedValue(false);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
    await act(async () => fireEvent.click(screen.getByText('dismiss')));
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('reset clears the list and shows guides again', async () => {
    fetchDismissedGuides.mockResolvedValue(['tip:event']);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(fetchDismissedGuides).toHaveBeenCalled());
    await act(async () => fireEvent.click(screen.getByText('reset')));
    expect(saveDismissedGuides).toHaveBeenCalledWith('u1', []);
    expect(screen.getByTestId('event').textContent).toBe('true');
  });

  it('shows nothing when signed out', () => {
    current = { session: null, loading: false };
    render(<GuidesProvider><Probe /></GuidesProvider>);
    expect(fetchDismissedGuides).not.toHaveBeenCalled();
    expect(screen.getByTestId('event').textContent).toBe('false');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/use-guides.test.tsx`
Expected: FAIL — cannot resolve `./use-guides`.

- [ ] **Step 3: Implement**

`lib/use-guides.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchDismissedGuides, saveDismissedGuides, type GuideKey } from './guides';
import { useSession } from './session';

type Guides = {
  isVisible: (key: GuideKey) => boolean;
  dismiss: (key: GuideKey) => void;
  reset: () => Promise<boolean>;
};

/**
 * The default — what a screen sees with no provider above it — shows
 * nothing. Every existing screen test renders without a provider, so the
 * guides stay out of their way; tests that want a guide visible mock this
 * module's `useGuides`.
 */
const GuidesContext = createContext<Guides>({
  isVisible: () => false,
  dismiss: () => {},
  reset: async () => false,
});

export function GuidesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  // Keyed on the user id, not the session object: lib/session.tsx hands out
  // a fresh Session on every TOKEN_REFRESHED (see lib/use-unread.ts).
  const userId = session?.user.id ?? null;
  // null = unknown (not loaded, or the read failed) → everything hidden.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  // Mirrors `dismissed` synchronously so two dismissals in one tick both land.
  const latest = useRef<string[] | null>(null);

  useEffect(() => {
    setDismissed(null);
    latest.current = null;
    if (!userId) return;
    let cancelled = false;
    fetchDismissedGuides(userId).then((keys) => {
      if (cancelled) return;
      latest.current = keys;
      setDismissed(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dismiss = useCallback(
    (key: GuideKey) => {
      if (!userId || latest.current === null || latest.current.includes(key)) return;
      const next = [...latest.current, key];
      latest.current = next;
      setDismissed(next);
      // Fire-and-forget: a failed save leaves it hidden for this session and
      // it may come back next time. No banner — this is not worth one.
      void saveDismissedGuides(userId, next);
    },
    [userId],
  );

  const reset = useCallback(async () => {
    if (!userId) return false;
    const ok = await saveDismissedGuides(userId, []);
    if (ok) {
      latest.current = [];
      setDismissed([]);
    }
    return ok;
  }, [userId]);

  const value = useMemo<Guides>(
    () => ({
      isVisible: (key) => dismissed !== null && !dismissed.includes(key),
      dismiss,
      reset,
    }),
    [dismissed, dismiss, reset],
  );

  return <GuidesContext.Provider value={value}>{children}</GuidesContext.Provider>;
}

export function useGuides(): Guides {
  return useContext(GuidesContext);
}
```

- [ ] **Step 4: Mount it in the root layout**

In `app/_layout.tsx`, add `import { GuidesProvider } from '../lib/use-guides';` and change the provider block to:

```tsx
      <SessionProvider>
        <GuidesProvider>
          <InAppBrowserBanner />
          <Stack screenOptions={{ headerShown: false }} />
        </GuidesProvider>
      </SessionProvider>
```

- [ ] **Step 5: Run tests**

Run: `npm test -- lib/use-guides.test.tsx && npm test`
Expected: new tests PASS; the full suite stays green (no existing screen renders a guide without a provider).

- [ ] **Step 6: Commit**

```bash
git add lib/use-guides.tsx lib/use-guides.test.tsx app/_layout.tsx
git commit -m "feat(guides): GuidesProvider and useGuides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `TipCard` component

**Files:**
- Create: `components/TipCard.tsx`
- Test: `components/__tests__/TipCard.test.tsx`

**Interfaces:**
- Produces: `TipCard({ tag?: string; title: string; children: ReactNode; action?: { label: string; onPress: () => void }; onDismiss: () => void; testID?: string })`. Children are the body: pass strings wrapped in `<TipText>` (also exported) or custom rows.
- Dismiss button: visible text **"Got it"**, `accessibilityLabel={\`Got it: ${title}\`}` (distinct when two cards share a screen).

- [ ] **Step 1: Write the failing test**

`components/__tests__/TipCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TipCard, { TipText } from '../TipCard';

describe('TipCard', () => {
  it('shows its tag, title and body', () => {
    render(
      <TipCard tag="Tip" title="Getting a seat" onDismiss={() => {}}>
        <TipText>Tap Join to take a spot.</TipText>
      </TipCard>,
    );
    expect(screen.getByText('Tip')).toBeTruthy();
    expect(screen.getByText('Getting a seat')).toBeTruthy();
    expect(screen.getByText('Tap Join to take a spot.')).toBeTruthy();
  });

  it('calls onDismiss from "Got it", labelled by title', () => {
    const onDismiss = vi.fn();
    render(<TipCard title="Getting a seat" onDismiss={onDismiss}><TipText>x</TipText></TipCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Got it: Getting a seat' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders an optional action', () => {
    const onPress = vi.fn();
    render(
      <TipCard title="T" onDismiss={() => {}} action={{ label: 'Add a game', onPress }}>
        <TipText>x</TipText>
      </TipCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- components/__tests__/TipCard.test.tsx`
Expected: FAIL — cannot resolve `../TipCard`.

- [ ] **Step 3: Implement**

`components/TipCard.tsx`:

```tsx
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';
import Button from './Button';
import Card from './Card';
import Tag from './Tag';

/**
 * The one card every first-run guide renders through — the dashboard's
 * host checklist and player intro, and each screen's one-time tip — so they
 * all read as the same kind of thing. Styled like app/welcome.tsx's Invites
 * card: accent2-100 ground with accent2-800 body text (textMuted is only
 * measured against bg and surface, not this ground).
 */
export function TipText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export default function TipCard({
  tag,
  title,
  children,
  action,
  onDismiss,
  testID,
}: {
  tag?: string;
  title: string;
  children: ReactNode;
  action?: { label: string; onPress: () => void };
  onDismiss: () => void;
  testID?: string;
}) {
  return (
    <View testID={testID}>
      <Card background={colors.accent2[100]} style={styles.card}>
        {tag ? <Tag variant="accent2">{tag}</Tag> : null}
        <Text style={styles.title}>{title}</Text>
        {children}
        <View style={styles.actions}>
          {action ? (
            <Button big={false} onPress={action.onPress} accessibilityLabel={action.label}>
              {action.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            big={false}
            onPress={onDismiss}
            accessibilityLabel={`Got it: ${title}`}
          >
            Got it
          </Button>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[4],
    gap: space[2],
    borderRadius: radius.card,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.accent2[800],
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
  },
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- components/__tests__/TipCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/TipCard.tsx components/__tests__/TipCard.test.tsx
git commit -m "feat(guides): TipCard component

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard — host checklist and player card

**Files:**
- Modify: `app/clubs/index.tsx` (imports; state near `roles` ~line 110; `fetchMyRoles` handler ~line 187; new effect after the load effect ~line 206; render after `<PendingInviteCards …/>` in the populated branch ~line 713)
- Test: `app/__tests__/guides-dashboard.test.tsx`

**Interfaces:**
- Consumes: `useGuides` (Task 3); `TipCard`, `TipText` (Task 4); `fetchHostChecklistCounts`, `hostChecklist`, `hostChecklistKey`, `HostChecklistCounts` (Task 2).

- [ ] **Step 1: Write the failing test**

Copy the module-mock preamble of `app/__tests__/clubs.test.tsx` (lines 1 through the end of its `vi.mock('../../lib/clubs', …)` / `lib/bookings` / `lib/events` / `lib/greetings` / `lib/profile` / `lib/leaderboard` / `lib/use-unread` mocks — every mock that file needs to render `ClubsScreen`) into `app/__tests__/guides-dashboard.test.tsx`, then add:

```tsx
const isVisible = vi.fn((_key: string) => true);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

const fetchHostChecklistCounts = vi.fn();
vi.mock('../../lib/guides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/guides')>();
  return { ...actual, fetchHostChecklistCounts: (id: string) => fetchHostChecklistCounts(id) };
});

const CLUB = {
  id: 'club-1', name: 'Riverside', slug: 'riverside', rhythm: '',
  visibility: 'private', timezone: 'America/New_York', default_game_mode: 'open_play',
};

beforeEach(() => {
  vi.clearAllMocks();
  isVisible.mockImplementation(() => true);
  fetchMyClubs.mockResolvedValue([CLUB]);
  fetchUpcomingEvents.mockResolvedValue([]);
  fetchMyUpcomingBookings.mockResolvedValue([]);
  fetchProfile.mockResolvedValue(null);
  fetchGreetings.mockResolvedValue([]);
  fetchMyPendingInvites.mockResolvedValue([]);
  fetchHostChecklistCounts.mockResolvedValue({
    events: 0, members: 1, pendingInvites: 0, announcements: 0,
  });
});

describe('dashboard guides', () => {
  it('shows a new host the setup checklist with the next step as its action', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Get Riverside going')).toBeTruthy();
    expect(screen.getByText('Schedule your first game')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1/events/new');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('hides the checklist once the required steps are done', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    fetchHostChecklistCounts.mockResolvedValue({
      events: 1, members: 2, pendingInvites: 0, announcements: 0,
    });
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchHostChecklistCounts).toHaveBeenCalledWith('club-1'));
    expect(screen.queryByText('Get Riverside going')).toBeNull();
  });

  it('hides the checklist when its counts could not be read', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    fetchHostChecklistCounts.mockResolvedValue(null);
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchHostChecklistCounts).toHaveBeenCalled());
    expect(screen.queryByText('Get Riverside going')).toBeNull();
  });

  it('dismisses the checklist per club', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Get Riverside going' }));
    expect(dismiss).toHaveBeenCalledWith('host-checklist:club-1');
  });

  it('shows a player the how-it-works card, mentioning Invite', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'member' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('How MahjHero works')).toBeTruthy();
    expect(screen.getByText(/Invite to bring someone along/)).toBeTruthy();
    expect(fetchHostChecklistCounts).not.toHaveBeenCalled();
  });

  it('shows no player card to a co-organizer', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'co_organizer' }]);
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchMyRoles).toHaveBeenCalled());
    await screen.findByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('shows no player card when roles could not be read', async () => {
    fetchMyRoles.mockResolvedValue(null);
    render(<ClubsScreen />);
    await screen.findByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('shows nothing a guide has been dismissed for', async () => {
    isVisible.mockImplementation(() => false);
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'member' }]);
    render(<ClubsScreen />);
    await screen.findByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });
});
```

If `findByText('Riverside')` matches more than one node, use `findAllByText('Riverside')` — the club name appears in the chip row.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/__tests__/guides-dashboard.test.tsx`
Expected: FAIL — no "Get Riverside going" / "How MahjHero works" text.

- [ ] **Step 3: Implement state and loading**

In `app/clubs/index.tsx`:

Imports:

```tsx
import TipCard, { TipText } from '../../components/TipCard';
import {
  fetchHostChecklistCounts,
  hostChecklist,
  hostChecklistKey,
  type HostChecklistCounts,
} from '../../lib/guides';
import { useGuides } from '../../lib/use-guides';
```

Next to the `roles` state:

```tsx
  // Distinguishes "roles say you organize nothing" from "roles never
  // loaded" — the player card must not appear to a host whose roles read
  // failed (first-run guidance: unknown ⇒ hidden).
  const [rolesReady, setRolesReady] = useState(false);
  // Per host club; a missing or null entry hides that club's checklist.
  const [checklistCounts, setChecklistCounts] = useState<
    Record<string, HostChecklistCounts | null>
  >({});
  const guides = useGuides();
```

In the load effect, replace the `fetchMyRoles` handler:

```tsx
    fetchMyRoles(userId).then((result) => {
      if (cancelled) return;
      setRoles(result ?? []);
      setRolesReady(result !== null);
    });
```

After the load effect:

```tsx
  // First-run checklist progress for every club this member hosts. Derived
  // from head counts each time roles load; nothing about progress is stored.
  useEffect(() => {
    const hosted = roles.filter((r) => r.role === 'host').map((r) => r.club_id);
    if (hosted.length === 0) return;
    let cancelled = false;
    Promise.all(hosted.map(async (id) => [id, await fetchHostChecklistCounts(id)] as const)).then(
      (entries) => {
        if (!cancelled) setChecklistCounts(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [roles]);
```

- [ ] **Step 4: Implement the render**

In the populated branch, directly after the `<PendingInviteCards … />` element:

```tsx
      {list
        .filter((club) => hostClubIds.has(club.id) && inScope(club.id, selected))
        .map((club) => {
          const counts = checklistCounts[club.id];
          const key = hostChecklistKey(club.id);
          if (!counts || !guides.isVisible(key)) return null;
          const { steps, complete } = hostChecklist(counts);
          if (complete) return null;
          const next = steps.find((s) => !s.done);
          const action =
            next?.key === 'game'
              ? { label: 'Add a game', onPress: () => router.push(`/clubs/${club.id}/events/new`) }
              : next?.key === 'invite'
                ? { label: 'Invite players', onPress: () => router.push(`/clubs/${club.id}`) }
                : next?.key === 'hello'
                  ? { label: 'Open the club thread', onPress: () => router.push(`/clubs/${club.id}/broadcast`) }
                  : undefined;
          const title = `Get ${club.name} going`;
          return (
            <TipCard
              key={key}
              testID={`host-checklist-${club.id}`}
              tag="Getting started"
              title={title}
              action={action}
              onDismiss={() => guides.dismiss(key)}
            >
              {steps.map((s) => (
                <TipText key={s.key}>
                  {s.done ? '✓ ' : '○ '}
                  {s.label}
                </TipText>
              ))}
            </TipCard>
          );
        })}

      {rolesReady &&
      !roles.some((r) => canInvite(r.role)) &&
      guides.isVisible('player-intro') ? (
        <TipCard
          testID="player-intro"
          tag="New here?"
          title="How MahjHero works"
          onDismiss={() => guides.dismiss('player-intro')}
        >
          <TipText>1. Find a game below.</TipText>
          <TipText>2. Tap Join to take a spot, or Invite to bring someone along.</TipText>
          <TipText>3. On the day, check the game page for your table and messages.</TipText>
        </TipCard>
      ) : null}
```

`hostClubIds` is declared further down the component today (before `canAddGames`); move its declaration up so it precedes this JSX (it is a plain `const` computed from `roles` — moving it changes nothing else). `canInvite` is already imported. `/clubs/[id]/broadcast` already redirects to the club board (app/clubs/[id]/broadcast.tsx), which is where an organizer turns on "Also email everyone".

- [ ] **Step 5: Run tests**

Run: `npm test -- app/__tests__/guides-dashboard.test.tsx app/__tests__/clubs.test.tsx app/__tests__/your-games.test.tsx`
Expected: PASS (existing dashboard tests unaffected: no provider ⇒ no guides).

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/guides-dashboard.test.tsx
git commit -m "feat(guides): host setup checklist and player intro on the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Screen tips — event page (player) and new game (organizer)

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx` (after `{error ? <ErrorBanner message={error} /> : null}` in the main return, ~line 952)
- Modify: `app/clubs/[id]/events/new.tsx` (after `{error ? <ErrorBanner message={error} /> : null}` following the "Add a game" heading, ~line 424)
- Test: `app/__tests__/guides-tips.test.tsx`

**Interfaces:**
- Consumes: `useGuides` (Task 3), `TipCard`, `TipText` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `app/__tests__/guides-tips.test.tsx`. Its preamble copies the module mocks that `app/__tests__/events-detail.test.tsx` and `app/__tests__/events-new.test.tsx` use to render their screens (the two files' mocks are for different lib functions; combine them — each `vi.mock` specifier once, with all of both files' mocked functions in that one factory — and reuse their fixture builders). Then add:

```tsx
const isVisible = vi.fn((_key: string) => true);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

describe('event page tip', () => {
  it('explains Join, Invite and the waitlist to a player', async () => {
    // Arrange exactly as events-detail.test.tsx's plain-member render does.
    renderEventAsMember();
    expect(await screen.findByText('Getting a seat')).toBeTruthy();
    expect(screen.getByText(/Tap Join, or an Empty seat/)).toBeTruthy();
    expect(screen.getByText(/Invite to bring someone along/)).toBeTruthy();
    expect(screen.getByText(/Join the waitlist/)).toBeTruthy();
  });

  it('is not shown to an organizer', async () => {
    renderEventAsOrganizer();
    await screen.findByText(/Invite a guest by email/);
    expect(screen.queryByText('Getting a seat')).toBeNull();
  });

  it('dismisses with its key', async () => {
    renderEventAsMember();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Getting a seat' }));
    expect(dismiss).toHaveBeenCalledWith('tip:event');
  });

  it('is hidden once dismissed', async () => {
    isVisible.mockImplementation(() => false);
    renderEventAsMember();
    await screen.findByText(/to play|Join|Empty/);
    expect(screen.queryByText('Getting a seat')).toBeNull();
  });
});

describe('new game tip', () => {
  it('explains seating and cost to a host', async () => {
    renderNewGameAsHost();
    expect(await screen.findByText('Setting up a game')).toBeTruthy();
    expect(screen.getByText(/Assigned tables: players pick an Empty seat/)).toBeTruthy();
    expect(screen.getByText(/Open seating: players tap Join/)).toBeTruthy();
    expect(screen.getByText(/Cost to play/)).toBeTruthy();
    expect(screen.getByText(/No money goes through the app/)).toBeTruthy();
  });

  it('dismisses with its key', async () => {
    renderNewGameAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Setting up a game' }));
    expect(dismiss).toHaveBeenCalledWith('tip:new-game');
  });
});
```

Define `renderEventAsMember`, `renderEventAsOrganizer` and `renderNewGameAsHost` in the file as small helpers that set the relevant mocks (role `member` / `host`, a scheduled open-play event) the same way the source test files do, then `render(<EventScreen />)` / `render(<NewEventScreen />)`. `beforeEach` resets `isVisible` to `() => true`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/__tests__/guides-tips.test.tsx`
Expected: FAIL — no "Getting a seat" / "Setting up a game".

- [ ] **Step 3: Implement the event page tip**

In `app/clubs/[id]/events/[eventId]/index.tsx` add imports:

```tsx
import TipCard, { TipText } from '../../../../../components/TipCard';
import { useGuides } from '../../../../../lib/use-guides';
```

Call `const guides = useGuides();` at the top of the component with the other hooks (before any early return). After the main return's `{error ? <ErrorBanner message={error} /> : null}`:

```tsx
      {!isOrganizer && event.status !== 'cancelled' && guides.isVisible('tip:event') ? (
        <TipCard tag="Tip" title="Getting a seat" onDismiss={() => guides.dismiss('tip:event')}>
          <TipText>Tap Join, or an Empty seat at a table, to take a spot.</TipText>
          <TipText>Tap Invite to bring someone along.</TipText>
          <TipText>Game full? Tap Join the waitlist and you'll move up if a seat opens.</TipText>
        </TipCard>
      ) : null}
```

- [ ] **Step 4: Implement the new game tip**

In `app/clubs/[id]/events/new.tsx` add imports (paths one level shallower: `'../../../../components/TipCard'`, `'../../../../lib/use-guides'`), call `const guides = useGuides();` with the other hooks before any early return, and after the error banner under "Add a game":

```tsx
      {guides.isVisible('tip:new-game') ? (
        <TipCard tag="Tip" title="Setting up a game" onDismiss={() => guides.dismiss('tip:new-game')}>
          <TipText>Assigned tables: players pick an Empty seat at a table.</TipText>
          <TipText>Open seating: players tap Join, and no tables are set in advance.</TipText>
          <TipText>
            Set Cost to play, and Minimum spend if the venue asks for one. Players see the
            cost up front, and you mark who's Paid at check-in. No money goes through the app.
          </TipText>
        </TipCard>
      ) : null}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- app/__tests__/guides-tips.test.tsx app/__tests__/events-detail.test.tsx app/__tests__/events-new.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" "app/clubs/[id]/events/new.tsx" app/__tests__/guides-tips.test.tsx
git commit -m "feat(guides): tips on the event page and the new game form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Screen tips — check-in and club page (organizer)

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/check-in.tsx` (inside `const before = (…)`, after `<Text style={styles.heading}>Check-in</Text>`, ~line 1130)
- Modify: `app/clubs/[id]/index.tsx` (inside `{mayInvite ? (<>…` just before the "Invite by email" `TextField`, ~line 428)
- Test: `app/__tests__/guides-tips.test.tsx` (extend)

**Interfaces:**
- Consumes: `useGuides` (Task 3), `TipCard`, `TipText` (Task 4).

- [ ] **Step 1: Write the failing tests**

Extend `app/__tests__/guides-tips.test.tsx` with the render mocks from `app/__tests__/check-in.test.tsx` and the club-detail describe block of `app/__tests__/clubs.test.tsx` (merged into the existing `vi.mock` factories), and helpers `renderCheckInAsHost()` and `renderClubAsHost()` / `renderClubAsMember()`:

```tsx
describe('check-in tip', () => {
  it('explains Here, Not coming and Paid', async () => {
    renderCheckInAsHost();
    expect(await screen.findByText('Running the door')).toBeTruthy();
    expect(screen.getByText(/Tap Here when someone arrives, or Not coming/)).toBeTruthy();
    expect(screen.getByText(/Only organizers see who's Paid/)).toBeTruthy();
  });

  it('dismisses with its key', async () => {
    renderCheckInAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Running the door' }));
    expect(dismiss).toHaveBeenCalledWith('tip:check-in');
  });
});

describe('club page tip', () => {
  it('explains inviting to an organizer', async () => {
    renderClubAsHost();
    expect(await screen.findByText('Bringing people in')).toBeTruthy();
    expect(screen.getByText(/Invite by email/)).toBeTruthy();
    expect(screen.getByText(/Import a roster/)).toBeTruthy();
  });

  it('is not shown to a member', async () => {
    renderClubAsMember();
    await screen.findByText('Leaderboard');
    expect(screen.queryByText('Bringing people in')).toBeNull();
  });

  it('dismisses with its key', async () => {
    renderClubAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Bringing people in' }));
    expect(dismiss).toHaveBeenCalledWith('tip:club');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- app/__tests__/guides-tips.test.tsx`
Expected: the new describes FAIL.

- [ ] **Step 3: Implement the check-in tip**

In `check-in.tsx` add the two imports (`'../../../../../components/TipCard'`, `'../../../../../lib/use-guides'`), call `const guides = useGuides();` before any early return, and in `before` directly after the "Check-in" heading:

```tsx
      {guides.isVisible('tip:check-in') ? (
        <TipCard tag="Tip" title="Running the door" onDismiss={() => guides.dismiss('tip:check-in')}>
          <TipText>Tap Here when someone arrives, or Not coming if they've told you.</TipText>
          <TipText>Tap Paid once they've paid. Only organizers see who's Paid.</TipText>
        </TipCard>
      ) : null}
```

`before` renders in both the assigned-tables and open-seating layouts (the latter wraps it in `styles.scrollGroup`), so this covers both. The screen already refuses non-organizers before this point.

Before shipping, confirm "Only organizers see who's Paid" against the payment-privacy tests (`supabase/tests/database/fixtures/event_payments_rls.test.sql`) — it is the property those tests prove.

- [ ] **Step 4: Implement the club page tip**

In `app/clubs/[id]/index.tsx` add the two imports (`'../../../components/TipCard'`, `'../../../lib/use-guides'`), call `const guides = useGuides();` before any early return, and as the first child inside `{mayInvite ? (<>`:

```tsx
          {guides.isVisible('tip:club') ? (
            <TipCard tag="Tip" title="Bringing people in" onDismiss={() => guides.dismiss('tip:club')}>
              <TipText>
                Use Invite by email for one person, or Import a roster for a whole list.
              </TipText>
              <TipText>
                They'll see the invite on their dashboard once they sign in with that email.
              </TipText>
            </TipCard>
          ) : null}
```

Verify "see the invite on their dashboard once they sign in" against `docs/superpowers/specs/2026-09-23-email-targeted-club-invites-design.md` and `PendingInviteCards` in `app/clubs/index.tsx`; adjust the sentence if invites land elsewhere.

- [ ] **Step 5: Run tests**

Run: `npm test -- app/__tests__/guides-tips.test.tsx app/__tests__/check-in.test.tsx app/__tests__/clubs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/check-in.tsx" "app/clubs/[id]/index.tsx" app/__tests__/guides-tips.test.tsx
git commit -m "feat(guides): tips on the check-in door list and the club page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: "How it works" page and Profile row

**Files:**
- Create: `app/how-it-works.tsx`
- Modify: `app/profile.tsx` (new settings card after the "Friends" card, ~line 237)
- Test: `app/__tests__/how-it-works.test.tsx`; extend `app/__tests__/profile.test.tsx`

**Interfaces:**
- Consumes: `useGuides().reset` (Task 3), `useSession`.

- [ ] **Step 1: Write the failing tests**

`app/__tests__/how-it-works.test.tsx`:

```tsx
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push }),
  usePathname: () => '/how-it-works',
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'u1' } }, loading: false };
let current: { session: { user: { id: string } } | null; loading: boolean } = SESSION;
vi.mock('../../lib/session', () => ({ useSession: () => current }));
vi.mock('../../lib/use-unread', () => ({ useUnreadCounts: () => ({ total: 0, byClub: {} }) }));
vi.mock('../../lib/use-notifications-unread', () => ({ useNotificationsUnread: () => 0 }));

const reset = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible: () => false, dismiss: vi.fn(), reset }),
}));

import HowItWorks from '../how-it-works';

beforeEach(() => {
  vi.clearAllMocks();
  current = SESSION;
});

describe('How it works', () => {
  it('explains playing and organizing', () => {
    render(<HowItWorks />);
    expect(screen.getByText('How it works')).toBeTruthy();
    expect(screen.getByText(/Tap Join to take a spot, or Invite to bring someone along/)).toBeTruthy();
    expect(screen.getByText(/Schedule your first game/)).toBeTruthy();
  });

  it('shows tips again on request', async () => {
    reset.mockResolvedValue(true);
    render(<HowItWorks />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show tips again' })));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByText('Tips will show again.')).toBeTruthy();
  });

  it('says so when tips could not be reset', async () => {
    reset.mockResolvedValue(false);
    render(<HowItWorks />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show tips again' })));
    expect(screen.getByText(/Could not reach MahjHero/)).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in', () => {
    current = { session: null, loading: false };
    render(<HowItWorks />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/sign-in');
  });
});
```

Check `TabBar`'s real hook imports before running; if it uses anything beyond `useUnreadCounts`/`useNotificationsUnread`, copy the matching mock lines from `app/__tests__/profile.test.tsx`.

In `app/__tests__/profile.test.tsx`, add:

```tsx
  it('links to How it works', async () => {
    // Arrange as the file's existing "renders the settings cards" test does.
    renderProfile();
    expect((await screen.findByText('How it works')).closest('a')?.getAttribute('data-href') ??
      screen.getByText('Open').closest('a')?.getAttribute('data-href')).toBe('/how-it-works');
  });
```

(Adapt `renderProfile()` to however that file renders the screen; its `Link` mock exposes `data-href`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- app/__tests__/how-it-works.test.tsx app/__tests__/profile.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

`app/how-it-works.tsx`:

```tsx
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { ChevronLeftIcon } from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';
import { useGuides } from '../lib/use-guides';

/**
 * The replayable half of first-run guidance: everything the dashboard cards
 * and screen tips say, in one place, plus a way to bring dismissed tips back.
 */
export default function HowItWorks() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { reset } = useGuides();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !session) return <Redirect href="/sign-in" />;

  async function onReset() {
    setBusy(true);
    setError(null);
    const ok = await reset();
    setBusy(false);
    setDone(ok);
    if (!ok) setError(GENERIC_ERROR);
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/profile')}
        accessibilityLabel="Back to your profile"
        style={styles.back}
      >
        Profile
      </Button>

      <Text style={styles.heading}>How it works</Text>

      <Card style={styles.card}>
        <Text style={styles.section}>Playing</Text>
        <Text style={styles.body}>1. Find a game on your dashboard.</Text>
        <Text style={styles.body}>2. Tap Join to take a spot, or Invite to bring someone along.</Text>
        <Text style={styles.body}>3. Game full? Tap Join the waitlist and you'll move up if a seat opens.</Text>
        <Text style={styles.body}>4. On the day, check the game page for your table and messages.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Organizing</Text>
        <Text style={styles.body}>1. Create your club.</Text>
        <Text style={styles.body}>2. Schedule your first game. Choose Assigned tables or Open seating, and set Cost to play.</Text>
        <Text style={styles.body}>3. Invite your players by email, or import a roster.</Text>
        <Text style={styles.body}>4. Say hello with an announcement in the club thread.</Text>
        <Text style={styles.body}>On the night, use Check-in to mark who's Here and who's Paid.</Text>
      </Card>

      <View style={styles.resetGroup}>
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          variant="secondary"
          block
          onPress={onReset}
          disabled={busy}
          loading={busy}
          accessibilityLabel="Show tips again"
        >
          Show tips again
        </Button>
        {done ? <Text style={styles.body}>Tips will show again.</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  back: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  card: { gap: space[2] },
  section: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.text,
  },
  resetGroup: { gap: space[2] },
});
```

Check `GENERIC_ERROR`'s text in `lib/constants.ts` matches the test's `/Could not reach MahjHero/`.

- [ ] **Step 4: Add the Profile row**

In `app/profile.tsx`, after the "Friends" card:

```tsx
      <Card style={styles.settingsCard}>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>How it works</Text>
          <Link href="/how-it-works" style={styles.editLink}>
            <Text style={styles.editLinkText}>Open</Text>
          </Link>
        </View>
        <Text style={styles.help}>Getting started, and tips you've hidden</Text>
      </Card>
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add app/how-it-works.tsx app/profile.tsx app/__tests__/how-it-works.test.tsx app/__tests__/profile.test.tsx
git commit -m "feat(guides): How it works page with Show tips again, linked from Profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Visual baselines

**Files:**
- Modify: `e2e/session.ts` (add `setDismissedGuides`)
- Modify: `e2e/visual.spec.ts`
- Update: `e2e/visual.spec.ts-snapshots/` (profile baselines change; new guide baselines added)

**Interfaces:**
- Produces: `setDismissedGuides(userId: string, keys: string[] | 'all'): Promise<void>` in `e2e/session.ts`. `'all'` writes every static key plus `host-checklist:<id>` for every club the user hosts.

- [ ] **Step 1: Add the helper**

In `e2e/session.ts`:

```ts
const STATIC_GUIDE_KEYS = ['player-intro', 'tip:event', 'tip:new-game', 'tip:check-in', 'tip:club'];

/**
 * Existing baselines predate first-run guidance; every one of them would
 * otherwise grow a tip. 'all' dismisses everything this user could see so
 * those baselines stay what they were; guide baselines pass [] instead.
 */
export async function setDismissedGuides(userId: string, keys: string[] | 'all'): Promise<void> {
  const admin = adminClient('set dismissed guides');
  let value = keys;
  if (keys === 'all') {
    const { data, error } = await admin
      .from('club_members')
      .select('club_id')
      .eq('profile_id', userId)
      .eq('role', 'host');
    if (error) throw new Error(`setDismissedGuides: host clubs read failed: ${error.message}`);
    value = [...STATIC_GUIDE_KEYS, ...(data ?? []).map((r) => `host-checklist:${r.club_id}`)];
  }
  const { error } = await admin.from('profiles').update({ dismissed_guides: value }).eq('id', userId);
  if (error) throw new Error(`setDismissedGuides: update failed: ${error.message}`);
}
```

- [ ] **Step 2: Keep existing baselines guide-free**

In `e2e/visual.spec.ts`: right after the outer `mintSession(...)` (line ~330), `await setDismissedGuides(session.user_id, 'all');` (use whatever variable holds the id there). In the `with a seeded club` `beforeEach`, after `seeded = await seedClubWithEvent(userId);`, add `await setDismissedGuides(userId, 'all');`. Do the same after any other seeding hook that creates a club the user hosts.

- [ ] **Step 3: Run the existing suite**

Run: `npm run test:visual`
Expected: every existing baseline passes **except** `profile-*` (new "How it works" card). Inspect the profile diff: the only change must be that card. Then run `npx playwright test -g "profile at" --update-snapshots`.

- [ ] **Step 4: Add guide baselines**

Inside `with a seeded club`, per viewport:

```ts
      test(`dashboard with guides at ${vp.name}`, async ({ page }) => {
        await setDismissedGuides(userId, []);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/clubs');
        await expect(page.getByText('Riverside Mah Jongg').first()).toBeVisible();
        await captureScreen(page, vp, `clubs-guides-${vp.name}.png`);
      });

      test(`new event with tip at ${vp.name}`, async ({ page }) => {
        await setDismissedGuides(userId, []);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/events/new`);
        await expect(page.getByText('Setting up a game')).toBeVisible();
        await captureScreen(page, vp, `new-event-tip-${vp.name}.png`);
      });

      test(`how it works at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/how-it-works');
        await expect(page.getByText('Show tips again')).toBeVisible();
        await captureScreen(page, vp, `how-it-works-${vp.name}.png`);
      });
```

Use the real field names `seedClubWithEvent` returns (read its return type; `clubId` is assumed here). Whether the dashboard shows a checklist depends on the seeded user's role and the seeded club's counts; look at the captured image, and assert whichever card actually renders (`Get Riverside Mah Jongg going` or `How MahjHero works`) instead of the club-name line if either is present, so the baseline pins a real guide.

- [ ] **Step 5: Generate and review**

Run: `npx playwright test -g "guides|with tip|how it works" --update-snapshots`, then `npm run test:visual`.
Expected: all pass. Open each new PNG and check: tip fits at mobile width with no horizontal scroll, "Got it" is on-screen, and the text is legible on the green ground. This is a mandated real-browser check — don't substitute jsdom.

- [ ] **Step 6: Commit**

```bash
git add e2e/session.ts e2e/visual.spec.ts e2e/visual.spec.ts-snapshots
git commit -m "test(visual): first-run guidance baselines; keep existing ones guide-free

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: QA Pass artifact, push, PR

**Files:** none in the repo (artifact update per `CLAUDE.md`).

- [ ] **Step 1: Read the live QA Pass**

`Artifact` tool, `action: "read"`, url `https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB`.

- [ ] **Step 2: Edit only the affected scenario(s)**

Find the scenario covering first sign-in / dashboard and the one covering event creation/check-in. Add steps with **new** `data-id`s (don't renumber existing ones):
- New player (no organizer role): dashboard shows "How MahjHero works"; **Got it** hides it; reload — still hidden; sign in on a second device — still hidden.
- New host: dashboard shows "Get <club> going" with ✓ Create your club; **Add a game** opens the new-game form, which shows the "Setting up a game" tip; after saving a game and inviting one person, the checklist is gone.
- Check-in shows "Running the door" once; club page shows "Bringing people in" to organizers only.
- Profile → How it works → **Open** → **Show tips again** → "Tips will show again."; the dashboard card returns.

Update each changed scenario's `data-progress-for` fraction and the footer's total step count.

- [ ] **Step 3: Republish in place**

`Artifact` publish with `url: "https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB"`.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run test:db && npm run test:visual && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/first-run-guidance
gh pr create --base main --title "First-run guidance: host checklist, player intro, screen tips" --body "Implements docs/superpowers/specs/2026-09-23-first-run-guidance-design.md.

- profiles.dismissed_guides (+ column grant) — dismissals follow the user across devices
- Dashboard: host setup checklist (auto-ticking) and player How it works card
- One-time tips: event page, new game, check-in, club page
- Profile → How it works, with Show tips again
- Migration 20260923100000 must be applied to mahjhero-dev before merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 6: Remind the user**

The migration must be applied to hosted **mahjhero-dev** (`npx supabase db push --linked`); that is the user's call — ask, don't run it.
