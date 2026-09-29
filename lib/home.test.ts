import { describe, expect, it } from 'vitest';
import {
  addDays, buildMonthGrid, clubColor, clubSubline, dateColumn, dayHeading,
  gameCountLabel, gameDateKey, gameHeadline, homeDefault, monthLabel,
  upcomingSummary, weekBucket,
} from './home';

describe('gameHeadline', () => {
  it('uses the title when present', () => {
    expect(gameHeadline('Beginner table', 'open_play')).toBe('Beginner table');
  });
  it('falls back to Private game for invite-only', () => {
    expect(gameHeadline('  ', 'invite_only')).toBe('Private game');
    expect(gameHeadline(null, 'invite_only')).toBe('Private game');
  });
  it('falls back to Open play otherwise', () => {
    expect(gameHeadline('', 'open_play')).toBe('Open play');
  });
});

describe('homeDefault', () => {
  it('prefers My games when anything is upcoming', () => {
    expect(homeDefault(1)).toBe('myGames');
    expect(homeDefault(0)).toBe('clubs');
  });
});

describe('dates', () => {
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('gameDateKey uses the club timezone', () => {
    // 02:00 UTC on 2 Oct is still 1 Oct in New York
    expect(gameDateKey('2026-10-02T02:00:00Z', 'America/New_York')).toBe('2026-10-01');
  });

  it('weekBucket uses Monday-start weeks', () => {
    const tue = '2026-09-29'; // a Tuesday
    expect(weekBucket('2026-09-28', tue)).toBe('Past'); // Monday before today
    expect(weekBucket('2026-09-29', tue)).toBe('This week');
    expect(weekBucket('2026-10-04', tue)).toBe('This week'); // Sunday
    expect(weekBucket('2026-10-05', tue)).toBe('Next week'); // Monday
    expect(weekBucket('2026-10-11', tue)).toBe('Next week');
    expect(weekBucket('2026-10-12', tue)).toBe('Later');
  });

  it('weekBucket when today is a Sunday', () => {
    expect(weekBucket('2026-10-04', '2026-10-04')).toBe('This week');
    expect(weekBucket('2026-10-05', '2026-10-04')).toBe('Next week');
  });
});

describe('buildMonthGrid', () => {
  it('starts on Monday with leading blanks and flags today/past', () => {
    const grid = buildMonthGrid(2026, 9, '2026-10-07'); // October 2026 starts on a Thursday
    expect(grid.length % 7).toBe(0);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toEqual({ key: '2026-10-01', day: 1, isToday: false, isPast: true });
    const today = grid.find((c) => c?.key === '2026-10-07');
    expect(today).toEqual({ key: '2026-10-07', day: 7, isToday: true, isPast: false });
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it('handles February of a non-leap year', () => {
    const grid = buildMonthGrid(2027, 1, '2026-01-01'); // Feb 2027 starts Monday
    expect(grid[0]?.key).toBe('2027-02-01');
    expect(grid.filter(Boolean)).toHaveLength(28);
    expect(grid).toHaveLength(28);
  });
});

describe('labels', () => {
  it('monthLabel and dayHeading', () => {
    expect(monthLabel(2026, 9)).toBe('October 2026');
    expect(dayHeading('2026-10-01')).toBe('Thursday 1 Oct');
    expect(dayHeading('2026-09-29')).toBe('Tuesday 29 Sept');
  });

  it('gameCountLabel', () => {
    expect(gameCountLabel(1)).toBe('1 game');
    expect(gameCountLabel(4)).toBe('4 games');
  });

  it('upcomingSummary counts distinct clubs', () => {
    expect(upcomingSummary([{ clubId: 'a' }, { clubId: 'a' }, { clubId: 'b' }])).toBe(
      '3 upcoming across 2 clubs',
    );
    expect(upcomingSummary([{ clubId: 'a' }])).toBe('1 upcoming across 1 club');
  });

  it('clubSubline', () => {
    expect(clubSubline('host', '2026-09-29T15:30:00Z', 'America/New_York')).toBe(
      'Host · Next game Tue 29 Sept, 11:30 AM',
    );
    expect(clubSubline('co_organizer', null, 'UTC')).toBe('Co-organizer · No games scheduled');
    expect(clubSubline('member', null, 'UTC')).toBe('Member · No games scheduled');
  });

  it('dateColumn', () => {
    expect(dateColumn('2026-09-29T15:30:00Z', 'America/New_York')).toEqual({
      month: 'SEP', day: '29', weekday: 'Tue',
    });
  });

  it('clubColor is stable per club and from the palette', () => {
    expect(clubColor('abc')).toBe(clubColor('abc'));
    expect(typeof clubColor('xyz')).toBe('string');
  });
});
