import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
// fetchTableRounds' read path is
// `.from('table_rounds').select(...).eq('event_id', id).order('created_at', ...)`
// -- the same eq-then-terminal shape lib/events.test.ts's singleAfterSelect
// models, with `order` as the terminal call instead of `single`.
const orderAfterEq = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: orderAfterEq })),
      })),
    })),
  },
}));

import {
  deleteRound,
  fetchTableRounds,
  recordRound,
  roundTotals,
  type TableRound,
} from './rounds';
import { GENERIC_ERROR } from './constants';

beforeEach(() => {
  rpc.mockReset();
  orderAfterEq.mockReset();
});

function round(over: Partial<TableRound> = {}): TableRound {
  return {
    id: 'r1',
    event_table_id: 't1',
    winner_profile_id: 'p1',
    points: 8,
    recorded_by: 'p1',
    created_at: '2026-09-02T20:00:00Z',
    ...over,
  };
}

describe('fetchTableRounds', () => {
  it('returns the rows on success', async () => {
    orderAfterEq.mockResolvedValue({ data: [round()], error: null });
    const result = await fetchTableRounds('event-1');
    expect(result).toEqual([round()]);
  });

  it('returns null on a failed read', async () => {
    orderAfterEq.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    const result = await fetchTableRounds('event-1');
    expect(result).toBeNull();
  });

  it('returns an empty array, not null, when there are no rounds yet', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    const result = await fetchTableRounds('event-1');
    expect(result).toEqual([]);
  });
});

describe('recordRound', () => {
  it('returns the inserted round on success', async () => {
    rpc.mockResolvedValue({ data: round(), error: null });
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 8,
    });
    expect(rpc).toHaveBeenCalledWith('record_round', {
      target_table: 't1',
      winner_profile: 'p1',
      target_points: 8,
    });
    expect(result).toEqual(round());
    expect(error).toBeNull();
  });

  it('maps a refused write to friendly copy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'points must be greater than zero', code: '23514' },
    });
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 0,
    });
    expect(result).toBeNull();
    expect(error).toBe('Points must be a positive number.');
  });

  it('reports the generic error on an unexpected throw', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { round: result, error } = await recordRound({
      tableId: 't1',
      winnerProfileId: 'p1',
      points: 8,
    });
    expect(result).toBeNull();
    expect(error).toBe(GENERIC_ERROR);
  });
});

describe('deleteRound', () => {
  it('resolves with no error on success', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { error } = await deleteRound('r1');
    expect(rpc).toHaveBeenCalledWith('delete_round', { target_round: 'r1' });
    expect(error).toBeNull();
  });

  it('maps a refusal to friendly copy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'not an organizer of this club', code: '42501' },
    });
    const { error } = await deleteRound('r1');
    expect(error).toBe('Only a club organizer can do that.');
  });
});

describe('roundTotals', () => {
  it('sums points per winner', () => {
    const rounds = [
      round({ id: 'r1', winner_profile_id: 'p1', points: 8 }),
      round({ id: 'r2', winner_profile_id: 'p2', points: 5 }),
      round({ id: 'r3', winner_profile_id: 'p1', points: 3 }),
    ];
    expect(roundTotals(rounds)).toEqual([
      { profileId: 'p1', points: 11 },
      { profileId: 'p2', points: 5 },
    ]);
  });

  it('returns an empty array for an empty log', () => {
    expect(roundTotals([])).toEqual([]);
  });

  it('orders by first appearance, not by point total', () => {
    const rounds = [
      round({ id: 'r1', winner_profile_id: 'p2', points: 1 }),
      round({ id: 'r2', winner_profile_id: 'p1', points: 100 }),
    ];
    expect(roundTotals(rounds).map((t) => t.profileId)).toEqual(['p2', 'p1']);
  });
});
