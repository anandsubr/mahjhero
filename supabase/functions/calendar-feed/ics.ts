/**
 * Pure iCalendar (RFC 5545) rendering for the calendar-feed function. No
 * Deno APIs and no imports, so vitest can exercise it directly; index.ts
 * does the fetching and hands this a list of games.
 */
export type FeedGame = {
  eventId: string;
  clubId: string;
  title: string | null;
  gameMode: 'open_play' | 'invite_only';
  clubName: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  notes: string;
  status: 'going' | 'waitlisted' | 'invited' | 'hosting';
};

function stamp(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function headline(g: FeedGame): string {
  const title = (g.title ?? '').trim();
  if (title) return title;
  return g.gameMode === 'invite_only' ? 'Private game' : 'Open play';
}

const PREFIX: Record<FeedGame['status'], string> = {
  going: '',
  hosting: '',
  invited: 'Invited: ',
  waitlisted: 'Waitlist: ',
};

export function buildCalendar(games: FeedGame[], now: Date, appUrl: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MahjHero//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MahjHero',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const g of games) {
    const link = `${appUrl}/clubs/${g.clubId}/events/${g.eventId}`;
    const description = [g.notes.trim(), link].filter(Boolean).join('\n\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${g.eventId}@mahjhero.com`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(g.startsAt)}`,
      `DTEND:${stamp(g.endsAt)}`,
      `SUMMARY:${escapeText(`${PREFIX[g.status]}${headline(g)} · ${g.clubName}`)}`,
      `LOCATION:${escapeText(g.venueName)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${link}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
