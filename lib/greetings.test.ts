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
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ select: deleteResult })) })),
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
    deleteResult.mockResolvedValue({ data: [{ id: 'g1' }], error: null });
    expect(await deleteGreeting('g1')).toEqual({ error: null });
  });

  it('reports the generic error on a network failure', async () => {
    expect(await deleteGreeting('g1')).toEqual({ error: GENERIC_ERROR });
  });

  it('reports the generic error when the delete matches no rows', async () => {
    // A non-admin's DELETE is filtered by RLS to zero matched rows, which
    // PostgREST reports as success with no error — the same silent-no-op
    // shape updateGreeting's own "matches no rows" test guards against.
    deleteResult.mockResolvedValue({ data: [], error: null });
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
