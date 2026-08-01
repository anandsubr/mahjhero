import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn().mockRejectedValue(new Error('network down')),
    },
  },
}));

import { isValidEmail, sendMagicLink } from './auth';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
  });

  it('accepts an address with a plus tag', () => {
    expect(isValidEmail('jane+mahjong@example.co.uk')).toBe(true);
  });

  it('trims surrounding whitespace before judging', () => {
    expect(isValidEmail('  jane@example.com  ')).toBe(true);
  });

  it('rejects an address with no domain', () => {
    expect(isValidEmail('jane@')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('sendMagicLink', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(sendMagicLink('jane@example.com')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });
});
