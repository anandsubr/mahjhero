import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read: from().select().eq().single(). Write: from().update().eq().select('id').
// Count: from().select(col, {count, head}).eq(...)[.eq/.is] awaited directly.
const single = vi.fn();
const selectAfterUpdate = vi.fn();
const countResults: Record<string, { count: number | null; error: unknown }> = {};

// Track all mocked method calls to verify query structure
let fromCalls: Array<{ table: string }> = [];
let selectCalls: Array<{ table: string; cols: string; opts?: { head?: boolean } }> = [];
let eqCalls: Array<{ table: string; col: string; value: unknown }> = [];
let isCalls: Array<{ table: string; col: string; value: unknown }> = [];
let updateCalls: Array<{ table: string; payload: unknown }> = [];
let selectAfterUpdateCalls: Array<{ table: string; cols: string }> = [];

function countChain(table: string) {
  const result = () => Promise.resolve(countResults[table]);
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn((col: string, value: unknown) => {
    eqCalls.push({ table, col, value });
    return chain;
  });
  chain.is = vi.fn((col: string, value: unknown) => {
    isCalls.push({ table, col, value });
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    result().then(resolve, reject);
  return chain;
}

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      fromCalls.push({ table });
      return {
        select: vi.fn((cols: string, opts?: { head?: boolean }) => {
          selectCalls.push({ table, cols, opts });
          if (opts?.head) {
            return countChain(table);
          }
          return {
            eq: vi.fn((col: string, value: unknown) => {
              eqCalls.push({ table, col, value });
              return { single };
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          updateCalls.push({ table, payload });
          return {
            eq: vi.fn((col: string, value: unknown) => {
              eqCalls.push({ table, col, value });
              return {
                select: vi.fn((cols: string) => {
                  selectAfterUpdateCalls.push({ table, cols });
                  // Return a thenable that delegates to selectAfterUpdate
                  return {
                    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                      selectAfterUpdate().then(resolve, reject),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
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
  fromCalls = [];
  selectCalls = [];
  eqCalls = [];
  isCalls = [];
  updateCalls = [];
  selectAfterUpdateCalls = [];
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
    expect(fromCalls).toEqual([{ table: 'profiles' }]);
    expect(selectCalls).toEqual([{ table: 'profiles', cols: 'dismissed_guides', opts: undefined }]);
    expect(eqCalls).toEqual([{ table: 'profiles', col: 'id', value: 'u1' }]);
  });

  it('returns null (unknown) on an error, never []', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchDismissedGuides('u1')).resolves.toBeNull();
  });

  it('returns null when the call throws', async () => {
    single.mockRejectedValue(new Error('network down'));
    await expect(fetchDismissedGuides('u1')).resolves.toBeNull();
  });

  it('returns [] when the row dismissed_guides is null', async () => {
    single.mockResolvedValue({ data: { dismissed_guides: null }, error: null });
    await expect(fetchDismissedGuides('u1')).resolves.toEqual([]);
  });
});

describe('saveDismissedGuides', () => {
  it('reports success when a row was written', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [{ id: 'u1' }], error: null });
    await expect(saveDismissedGuides('u1', ['tip:event'])).resolves.toBe(true);
    expect(fromCalls).toEqual([{ table: 'profiles' }]);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].table).toBe('profiles');
    expect(updateCalls[0].payload).toEqual({
      dismissed_guides: ['tip:event'],
      updated_at: expect.any(String),
    });
    expect(eqCalls).toEqual([{ table: 'profiles', col: 'id', value: 'u1' }]);
    expect(selectAfterUpdateCalls).toEqual([{ table: 'profiles', cols: 'id' }]);
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
    // Verify all four tables are queried
    expect(fromCalls).toEqual([
      { table: 'events' },
      { table: 'club_members' },
      { table: 'club_invites' },
      { table: 'broadcasts' },
    ]);
    // Verify select calls use count: 'exact' and head: true
    expect(selectCalls).toEqual([
      { table: 'events', cols: 'id', opts: { count: 'exact', head: true } },
      { table: 'club_members', cols: 'profile_id', opts: { count: 'exact', head: true } },
      { table: 'club_invites', cols: 'id', opts: { count: 'exact', head: true } },
      { table: 'broadcasts', cols: 'id', opts: { count: 'exact', head: true } },
    ]);
    // Verify exact filters on each table
    expect(eqCalls).toEqual([
      { table: 'events', col: 'club_id', value: 'c1' },
      { table: 'club_members', col: 'club_id', value: 'c1' },
      { table: 'club_members', col: 'status', value: 'active' },
      { table: 'club_invites', col: 'club_id', value: 'c1' },
      { table: 'broadcasts', col: 'club_id', value: 'c1' },
    ]);
    // Verify is() for null check
    expect(isCalls).toEqual([
      { table: 'club_invites', col: 'accepted_at', value: null },
    ]);
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
