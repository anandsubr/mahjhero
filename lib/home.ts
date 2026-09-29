import type { ClubRole, GameMode } from './clubs';
import { eventDateInZone, formatEventTime } from './events';
import { colors } from './theme';

/**
 * Pure helpers for Home (club-hub redesign, phase 1). Dates travel as
 * 'YYYY-MM-DD' keys so week/month logic is plain calendar arithmetic with no
 * timezone in play; a game's key is taken in its club's timezone, "today" in
 * the device's.
 */

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function gameHeadline(title: string | null, gameMode: GameMode): string {
  const trimmed = (title ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  return gameMode === 'invite_only' ? 'Private game' : 'Open play';
}

export function homeDefault(upcomingCount: number): 'myGames' | 'clubs' {
  return upcomingCount > 0 ? 'myGames' : 'clubs';
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function gameDateKey(startsAt: string, timezone: string): string {
  return eventDateInZone(startsAt, timezone);
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}

/** 0 = Monday … 6 = Sunday. */
function mondayIndex(key: string): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

export function weekBucket(
  key: string,
  todayKey: string,
): 'This week' | 'Next week' | 'Later' | 'Past' {
  if (key < todayKey) return 'Past';
  const thisSunday = addDays(todayKey, 6 - mondayIndex(todayKey));
  if (key <= thisSunday) return 'This week';
  if (key <= addDays(thisSunday, 7)) return 'Next week';
  return 'Later';
}

export type MonthCell = { key: string; day: number; isToday: boolean; isPast: boolean } | null;

export function buildMonthGrid(year: number, monthIndex: number, todayKey: string): MonthCell[] {
  const first = `${year}-${pad(monthIndex + 1)}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: mondayIndex(first) }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    cells.push({ key, day, isToday: key === todayKey, isPast: key < todayKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTHS_LONG[monthIndex]} ${year}`;
}

export function dayHeading(key: string): string {
  const d = keyToUtc(key);
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function gameCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'game' : 'games'}`;
}

export function upcomingSummary(games: { clubId: string }[]): string {
  const clubs = new Set(games.map((g) => g.clubId)).size;
  return `${games.length} upcoming across ${clubs} ${clubs === 1 ? 'club' : 'clubs'}`;
}

// Five club colours from the design's calendar dots, assigned by the same
// string hash glyphForClub (lib/dashboard.ts) uses, so a club keeps its
// colour everywhere without a stored column.
const CLUB_COLORS = [
  colors.accent2[700],
  colors.accent[600],
  colors.accent2[500],
  colors.neutral[800],
  colors.accent[800],
];

export function clubColor(clubId: string): string {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  return CLUB_COLORS[Math.abs(hash) % CLUB_COLORS.length];
}

const ROLE_LABEL: Record<ClubRole, string> = {
  host: 'Host',
  co_organizer: 'Co-organizer',
  member: 'Member',
};

export function dateColumn(
  startsAt: string,
  timezone: string,
): { month: string; day: string; weekday: string } {
  const key = gameDateKey(startsAt, timezone);
  if (!key) return { month: '--', day: '--', weekday: '' };
  const d = keyToUtc(key);
  return {
    month: MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase(),
    day: String(d.getUTCDate()),
    weekday: WEEKDAYS_SHORT[d.getUTCDay()],
  };
}

export function clubSubline(role: ClubRole, nextStartsAt: string | null, timezone: string): string {
  if (!nextStartsAt) return `${ROLE_LABEL[role]} · No games scheduled`;
  const key = gameDateKey(nextStartsAt, timezone);
  const d = keyToUtc(key);
  const when = `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  let time = formatEventTime(nextStartsAt, timezone, 'en-US');
  // Handle narrow no-break space that might appear before AM/PM in some locales
  time = time.replace(/ /g, ' ');
  return `${ROLE_LABEL[role]} · Next game ${when}, ${time}`;
}
