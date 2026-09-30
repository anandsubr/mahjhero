import { describe, expect, it } from 'vitest';
import { buildCalendar, type FeedGame } from '../ics';

const APP = 'https://app.mahjhero.com';
const NOW = new Date('2026-09-30T12:00:00Z');

function game(overrides: Partial<FeedGame> = {}): FeedGame {
  return {
    eventId: 'evt-1',
    clubId: 'club-1',
    title: 'Beginner table',
    gameMode: 'open_play',
    clubName: 'Test Club',
    startsAt: '2026-10-01T15:30:00Z',
    endsAt: '2026-10-01T18:30:00Z',
    venueName: 'Town Hall',
    notes: 'Bring tiles',
    status: 'going',
    ...overrides,
  };
}

/** Undo RFC 5545 folding so assertions can look at logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

function field(ics: string, name: string): string[] {
  return unfold(ics)
    .filter((l) => l.startsWith(`${name}:`))
    .map((l) => l.slice(name.length + 1));
}

describe('buildCalendar', () => {
  it('wraps events in a VCALENDAR with the MahjHero headers and CRLF line endings', () => {
    const ics = buildCalendar([game()], NOW, APP);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const lines = unfold(ics);
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//MahjHero//Calendar//EN');
    expect(lines).toContain('X-WR-CALNAME:MahjHero');
    // No bare LF anywhere: every newline is part of a CRLF.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('emits an empty calendar for no games', () => {
    const ics = buildCalendar([], NOW, APP);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('emits one VEVENT per game with a stable UID and UTC times', () => {
    const ics = buildCalendar(
      [game(), game({ eventId: 'evt-2' })],
      NOW,
      APP,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    expect(field(ics, 'UID')).toEqual(['evt-1@mahjhero.com', 'evt-2@mahjhero.com']);
    expect(field(ics, 'DTSTART')[0]).toBe('20261001T153000Z');
    expect(field(ics, 'DTEND')[0]).toBe('20261001T183000Z');
    expect(field(ics, 'DTSTAMP')[0]).toBe('20260930T120000Z');
  });

  it('builds the summary from title and club name', () => {
    const ics = buildCalendar([game()], NOW, APP);
    expect(field(ics, 'SUMMARY')).toEqual(['Beginner table · Test Club']);
  });

  it('falls back to Open play / Private game for a blank title', () => {
    const ics = buildCalendar(
      [
        game({ title: '  ', gameMode: 'open_play' }),
        game({ title: null, gameMode: 'invite_only' }),
      ],
      NOW,
      APP,
    );
    expect(field(ics, 'SUMMARY')).toEqual([
      'Open play · Test Club',
      'Private game · Test Club',
    ]);
  });

  it('prefixes invited and waitlisted games, not hosting or going', () => {
    const ics = buildCalendar(
      [
        game({ status: 'invited' }),
        game({ status: 'waitlisted' }),
        game({ status: 'hosting' }),
      ],
      NOW,
      APP,
    );
    expect(field(ics, 'SUMMARY')).toEqual([
      'Invited: Beginner table · Test Club',
      'Waitlist: Beginner table · Test Club',
      'Beginner table · Test Club',
    ]);
  });

  it('puts the venue in LOCATION and notes plus the game link in DESCRIPTION', () => {
    const ics = buildCalendar([game()], NOW, APP);
    const link = `${APP}/clubs/club-1/events/evt-1`;
    expect(field(ics, 'LOCATION')).toEqual(['Town Hall']);
    const [description] = field(ics, 'DESCRIPTION');
    expect(description).toContain('Bring tiles');
    expect(description).toContain(link);
    expect(field(ics, 'URL')).toEqual([link]);
  });

  it('omits empty notes from the description, leaving just the link', () => {
    const ics = buildCalendar([game({ notes: '' })], NOW, APP);
    expect(field(ics, 'DESCRIPTION')).toEqual([`${APP}/clubs/club-1/events/evt-1`]);
  });

  it('escapes commas, semicolons, backslashes and newlines in text', () => {
    const ics = buildCalendar(
      [
        game({
          title: 'A, B; C\\D',
          venueName: 'Hall, Room 2',
          notes: 'line one\nline two; bring snacks',
        }),
      ],
      NOW,
      APP,
    );
    expect(field(ics, 'SUMMARY')).toEqual(['A\\, B\\; C\\\\D · Test Club']);
    expect(field(ics, 'LOCATION')).toEqual(['Hall\\, Room 2']);
    expect(field(ics, 'DESCRIPTION')[0]).toContain('line one\\nline two\\; bring snacks');
  });

  it('folds lines longer than 75 octets with CRLF + space', () => {
    const longNotes = 'x'.repeat(200);
    const ics = buildCalendar([game({ notes: longNotes })], NOW, APP);
    const encoder = new TextEncoder();
    for (const physical of ics.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('\r\n x');
    expect(field(ics, 'DESCRIPTION')[0]).toContain(longNotes);
  });

  it('never splits a multi-byte character when folding', () => {
    const ics = buildCalendar([game({ notes: '麻雀'.repeat(60) })], NOW, APP);
    const encoder = new TextEncoder();
    for (const physical of ics.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
      expect(physical).not.toContain('\uFFFD');
    }
    expect(field(ics, 'DESCRIPTION')[0]).toContain('麻雀'.repeat(60));
  });
});
