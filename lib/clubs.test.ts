import { describe, expect, it } from 'vitest';
import { canInvite, parseRoster, slugify } from './clubs';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Riverside Mah Jongg')).toBe('riverside-mah-jongg');
  });

  it('strips punctuation rather than encoding it', () => {
    expect(slugify("Nana's Tiles!")).toBe('nanas-tiles');
  });

  it('collapses runs of separators', () => {
    expect(slugify('Oakfield   --  Tiles')).toBe('oakfield-tiles');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('canInvite', () => {
  it('allows a host', () => {
    expect(canInvite('host')).toBe(true);
  });

  it('allows a co-organizer', () => {
    expect(canInvite('co_organizer')).toBe(true);
  });

  it('refuses a plain member', () => {
    expect(canInvite('member')).toBe(false);
  });
});

describe('parseRoster', () => {
  it('reads name, email, and skill level from a header row', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,beginner';
    expect(parseRoster(csv)).toEqual({
      rows: [
        { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: 'beginner' },
      ],
      errors: [],
    });
  });

  it('tolerates columns in any order and ignores unknown ones', () => {
    const csv = 'Email,Nickname,Name\njane@example.com,jd,Jane Doe';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
    ]);
  });

  it('reports the row number for a bad email rather than dropping it', () => {
    const csv = 'name,email\nJane Doe,not-an-email';
    const result = parseRoster(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: 'Not a valid email address' }]);
  });

  it('rejects a file with no email column', () => {
    const result = parseRoster('name\nJane Doe');
    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(/email column/i);
  });

  it('ignores an unrecognised skill level rather than guessing', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,expert';
    expect(parseRoster(csv).rows[0].skill_level).toBeNull();
  });
});
