import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn().mockRejectedValue(new Error('network down')),
      })),
    })),
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  isCompleteProfile,
  isValidQuietWindow,
  updatePreferences,
  updateProfile,
} from './profile';

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
});
