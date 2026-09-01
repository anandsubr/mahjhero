import { describe, expect, it } from 'vitest';
import {
  MAX_ROSTER_ROWS,
  canAnnounce,
  canInvite,
  importRoster,
  parseRoster,
  slugify,
} from './clubs';

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

describe('canAnnounce', () => {
  it('allows a host', () => {
    expect(canAnnounce('host')).toBe(true);
  });

  it('allows a co-organizer', () => {
    expect(canAnnounce('co_organizer')).toBe(true);
  });

  it('refuses a plain member', () => {
    expect(canAnnounce('member')).toBe(false);
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

  /*
   * The parser used `line.split(',')`, which cannot read the file this screen
   * exists to accept. Google Sheets and Excel quote any field containing a
   * comma, and `"Last, First"` is the most common way a roster spreadsheet
   * stores a name — so the name split into two cells, every column after it
   * shifted left, the email column held a surname, and each affected row came
   * back as "Not a valid email address". The host was told their export was
   * broken when it was the only correct thing in the exchange.
   */
  it('reads a quoted name containing a comma as one field', () => {
    const csv = 'name,email\n"Doe, Jane",jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Doe, Jane', email: 'jane@example.com', skill_level: null },
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const csv = 'name,email\n"Jane ""JD"" Doe",jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      {
        display_name: 'Jane "JD" Doe',
        email: 'jane@example.com',
        skill_level: null,
      },
    ]);
  });

  it('reads a quoted header cell and a quoted email', () => {
    const csv = '"name","email","skill"\n"Doe, Jane","jane@example.com","beginner"';
    expect(parseRoster(csv).rows).toEqual([
      {
        display_name: 'Doe, Jane',
        email: 'jane@example.com',
        skill_level: 'beginner',
      },
    ]);
  });

  it('keeps a comma-free row parsing exactly as before', () => {
    const csv = 'name,email\nJane Doe,jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
    ]);
  });

  // A pasted export can be arbitrarily large; without a cap it becomes one
  // unbounded INSERT. Refused rather than truncated, so a host who pastes the
  // wrong file is told so instead of silently importing a prefix of it.
  it('refuses a paste larger than the row cap without building the rows', () => {
    const body = Array.from(
      { length: MAX_ROSTER_ROWS + 1 },
      (_, i) => `Person ${i},p${i}@example.com`,
    ).join('\n');
    const result = parseRoster(`name,email\n${body}`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(new RegExp(`${MAX_ROSTER_ROWS}`));
  });

  it('accepts a paste exactly at the row cap', () => {
    const body = Array.from(
      { length: MAX_ROSTER_ROWS },
      (_, i) => `Person ${i},p${i}@example.com`,
    ).join('\n');
    expect(parseRoster(`name,email\n${body}`).rows).toHaveLength(MAX_ROSTER_ROWS);
  });
});

describe('importRoster', () => {
  // The plan's own constraint is "treat zero rows as failure", but the
  // function returned `{ created: 0, error: null }` — a success — so the
  // import screen redirected to `/clubs/<id>?imported=0` and told the host
  // their import had worked when it had invited nobody.
  it('treats an empty row list as a failure, not a silent success', async () => {
    const result = await importRoster('club-1', []);
    expect(result.created).toBe(0);
    expect(result.error).not.toBeNull();
  });

  // Belt to parseRoster's braces: nothing stops a future caller assembling
  // rows some other way, and the cap protects a single unbounded INSERT.
  it('refuses more rows than the cap without reaching the network', async () => {
    const rows = Array.from({ length: MAX_ROSTER_ROWS + 1 }, (_, i) => ({
      display_name: `Person ${i}`,
      email: `p${i}@example.com`,
      skill_level: null,
    }));
    const result = await importRoster('club-1', rows);
    expect(result.created).toBe(0);
    expect(result.error).toMatch(new RegExp(`${MAX_ROSTER_ROWS}`));
  });
});
