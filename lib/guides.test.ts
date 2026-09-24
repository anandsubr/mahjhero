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
