import { beforeEach, describe, expect, it, vi } from 'vitest';

// The write path is `from(...).update(...).eq(...).select('id')`, and the
// `.select('id')` link is load-bearing — it is what turns PostgREST's 204
// "matched no rows" into an observable failure. The mock therefore models the
// real chain rather than rejecting early, so a test asserting the no-rows
// behaviour is really exercising it and not a TypeError on a missing method.
const selectAfterUpdate = vi.fn();

// The read path is `from(...).select(...).eq(...).single()`.
const singleAfterSelect = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ select: selectAfterUpdate })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: singleAfterSelect })),
      })),
    })),
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  fetchPreferences,
  isCompleteProfile,
  isValidQuietWindow,
  normalizeTime,
  TIME_PATTERN,
  updatePreferences,
  updateProfile,
} from './profile';

beforeEach(() => {
  selectAfterUpdate.mockReset();
  selectAfterUpdate.mockRejectedValue(new Error('network down'));
  singleAfterSelect.mockReset();
  singleAfterSelect.mockRejectedValue(new Error('network down'));
});

describe('isCompleteProfile', () => {
  it('is complete with a display name and a skill level', () => {
    expect(
      isCompleteProfile({ display_name: 'Alice', skill_level: 'beginner' }),
    ).toBe(true);
  });

  it('is incomplete without a skill level', () => {
    expect(
      isCompleteProfile({ display_name: 'Alice', skill_level: null }),
    ).toBe(false);
  });

  it('is incomplete when the display name is only whitespace', () => {
    expect(
      isCompleteProfile({ display_name: '   ', skill_level: 'advanced' }),
    ).toBe(false);
  });
});

describe('updateProfile', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(
      updateProfile('user-1', { display_name: 'Alice' }),
    ).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });

  it('reports a failure when the update matched no rows', async () => {
    // PostgREST answers 204 with `error: null` when an update matches nothing
    // — an RLS denial or a missing profile row look exactly like this. Without
    // this check the screen would say "Saved" for a write that never happened.
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });

    await expect(
      updateProfile('user-1', { display_name: 'Alice' }),
    ).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it('succeeds when the update returns the affected row', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [{ id: 'user-1' }], error: null });

    await expect(
      updateProfile('user-1', { display_name: 'Alice' }),
    ).resolves.toEqual({ error: null });
  });
});

describe('normalizeTime', () => {
  it('drops the seconds Postgres `time` columns come back with', () => {
    expect(normalizeTime('21:00:00')).toBe('21:00');
  });

  it('leaves an already-normalized value alone, so it is safe to apply twice', () => {
    expect(normalizeTime('08:00')).toBe('08:00');
  });

  it('produces a value TIME_PATTERN accepts', () => {
    expect(TIME_PATTERN.test(normalizeTime('21:00:00'))).toBe(true);
  });
});

describe('isValidQuietWindow', () => {
  it('accepts a window crossing midnight', () => {
    expect(isValidQuietWindow('21:00', '08:00')).toBe(true);
  });

  it('accepts a window inside one day', () => {
    expect(isValidQuietWindow('13:00', '15:00')).toBe(true);
  });

  it('rejects a zero-length window', () => {
    expect(isValidQuietWindow('21:00', '21:00')).toBe(false);
  });

  it('rejects a malformed time', () => {
    expect(isValidQuietWindow('9pm', '08:00')).toBe(false);
  });

  it('rejects the raw HH:MM:SS shape PostgREST returns', () => {
    // Deliberate: this is the contract that makes normalizing on read
    // necessary rather than optional. If someone widens TIME_PATTERN to accept
    // seconds, this test fails and forces the conversation about which single
    // shape the client circulates.
    expect(isValidQuietWindow('21:00:00', '08:00:00')).toBe(false);
  });
});

describe('fetchPreferences', () => {
  it('normalizes the time columns so the whole client sees one HH:MM shape', async () => {
    // Exactly what PostgREST sends for a Postgres `time` column. Before this
    // normalization, a member's first save submitted these back and
    // updatePreferences rejected them as nonsense the member never typed.
    singleAfterSelect.mockResolvedValue({
      data: {
        notify_channel: 'both',
        mute_need_a_fourth: false,
        quiet_hours_enabled: true,
        quiet_hours_start: '21:00:00',
        quiet_hours_end: '08:00:00',
      },
      error: null,
    });

    const prefs = await fetchPreferences('user-1');

    expect(prefs?.quiet_hours_start).toBe('21:00');
    expect(prefs?.quiet_hours_end).toBe('08:00');
    // The round trip that used to fail: whatever comes out of fetch must be
    // something update accepts back unchanged.
    expect(
      isValidQuietWindow(prefs!.quiet_hours_start, prefs!.quiet_hours_end),
    ).toBe(true);
  });

  it('resolves null instead of rejecting when the underlying call throws', async () => {
    await expect(fetchPreferences('user-1')).resolves.toBeNull();
  });
});

describe('updatePreferences', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(
      updatePreferences('user-1', { notify_channel: 'push' }),
    ).resolves.toEqual({
      error: GENERIC_ERROR,
    });
  });

  it('accepts a payload with neither quiet-hours bound', async () => {
    // Mirrors what the notifications screen submits when quiet hours are
    // disabled: the start/end fields are omitted entirely rather than sent
    // stale. Neither bound present means touchesStart === touchesEnd, so
    // this must clear pair validation and reach the network call — which
    // the shared mock makes reject, surfacing as GENERIC_ERROR rather than
    // the pair-mismatch message. That distinguishes "validation passed,
    // network failed" from "validation itself rejected the payload".
    await expect(
      updatePreferences('user-1', {
        notify_channel: 'email',
        mute_need_a_fourth: true,
        quiet_hours_enabled: false,
      }),
    ).resolves.toEqual({
      error: GENERIC_ERROR,
    });
  });

  it('rejects a payload carrying only one quiet-hours bound', async () => {
    await expect(
      updatePreferences('user-1', { quiet_hours_start: '21:00' }),
    ).resolves.toEqual({
      error: 'Quiet hours must be changed as a pair.',
    });
  });

  it('accepts the normalized quiet hours a fetch hands back', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [{ id: 'user-1' }], error: null });

    await expect(
      updatePreferences('user-1', {
        quiet_hours_start: normalizeTime('21:00:00'),
        quiet_hours_end: normalizeTime('08:00:00'),
      }),
    ).resolves.toEqual({ error: null });
  });

  it('reports a failure when the update matched no rows', async () => {
    selectAfterUpdate.mockResolvedValue({ data: [], error: null });

    await expect(
      updatePreferences('user-1', { notify_channel: 'push' }),
    ).resolves.toEqual({ error: GENERIC_ERROR });
  });
});
