import { describe, expect, it } from 'vitest';
import { isValidEmail } from './auth';

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
