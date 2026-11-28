import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Share } from 'react-native';
import { supabase } from './supabase';

/**
 * Mahj Nights (pivot batch 2): a one-off party. Underneath it is a hidden
 * group (clubs.kind = 'event') holding one game; see
 * supabase/migrations/20261128130000_mahj_night_functions.sql.
 *
 * The public event page and RSVPs go through the `mahj-night` edge function,
 * which works with no account. Creating a night, editing it, and the link
 * settings are ordinary signed-in RPCs.
 */

export type RsvpStatus = 'going' | 'maybe' | 'no';
/** What an RSVP ends up as: a yes on a full night joins the waitlist (batch 2b). */
export type StoredRsvpStatus = RsvpStatus | 'waitlist';
export type MoneyNorm = 'none' | 'quarters' | 'host_choice';

export type EventPage = {
  tier: 'public' | 'guest' | 'host';
  title: string;
  host_first_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  area: string;
  status: 'draft' | 'published' | 'cancelled';
  theme_id: string | null;
  beginners_welcome: boolean;
  tables: number;
  seats: number;
  going_count: number;
  money_norm: MoneyNorm;
  money_note: string;
  /** People at each table (host included), from the seating plan. */
  table_counts: number[];
  table_capacities: number[];
  my_rsvp: {
    name: string;
    email: string;
    status: StoredRsvpStatus;
    is_beginner: boolean;
    can_teach: boolean;
    brings_set: boolean;
    has_card: boolean;
  } | null;
  /** This guest's suggested table, once they've said yes. */
  my_table?: number;
  // guest and host
  club_id?: string;
  event_id?: string;
  note?: string;
  address?: string;
  going_names?: string[];
  // host
  link_token?: string;
  link_enabled?: boolean;
  beginner_count?: number;
  teacher_count?: number;
  host_sets?: number;
  guest_sets?: number;
  card_count?: number;
  rsvps?: HostRsvp[];
};

export type HostRsvp = {
  id: string;
  name: string;
  email: string;
  status: StoredRsvpStatus;
  is_beginner: boolean;
  can_teach: boolean;
  brings_set: boolean;
  has_card: boolean;
  signed_in: boolean;
  created_at: string;
  /** Suggested (or host-chosen) table; null unless going. */
  table: number | null;
  table_pinned: boolean;
};

export type NewMahjNight = {
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMinutes: number;
  address: string;
  area: string;
  tables: number;
  themeId: string;
  beginnersWelcome: boolean;
  note: string;
  sets: number;
  money: MoneyNorm;
  moneyNote: string;
};

export type CreatedNight = { clubId: string; eventId: string; linkToken: string };

/** The device's IANA timezone; the night's date and time are read in it. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export async function createMahjNight(
  night: NewMahjNight,
): Promise<{ data: CreatedNight | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_mahj_night', {
    night_name: night.name,
    event_date: night.date,
    start_time: night.startTime,
    duration_minutes: night.durationMinutes,
    place_address: night.address,
    area_label: night.area,
    table_count: night.tables,
    theme: night.themeId,
    beginners: night.beginnersWelcome,
    host_note: night.note,
    night_timezone: deviceTimezone(),
    sets: night.sets,
    money: night.money,
    money_text: night.money === 'host_choice' ? night.moneyNote : '',
  });
  if (error || !data) {
    console.error('createMahjNight failed', error);
    return { data: null, error: createErrorMessage(error?.message ?? '') };
  }
  const r = data as { club_id: string; event_id: string; link_token: string };
  return { data: { clubId: r.club_id, eventId: r.event_id, linkToken: r.link_token }, error: null };
}

function createErrorMessage(message: string): string {
  if (message.includes('already passed')) return 'That start time has already passed.';
  if (message.includes('address')) return 'Add where it is.';
  if (message.includes('table count')) return 'Pick between 1 and 20 tables.';
  return 'Could not create the night. Try again.';
}

// ---------------------------------------------------------------------------
// The event page and RSVPs (edge function, no account needed)
// ---------------------------------------------------------------------------

export async function fetchEventPage(
  token: string,
  secret: string | null,
): Promise<{ page: EventPage | null; error: 'not_found' | 'failed' | null }> {
  const query = new URLSearchParams({ token });
  if (secret) query.set('r', secret);
  const { data, error } = await supabase.functions.invoke(`mahj-night?${query.toString()}`, {
    method: 'GET',
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404) return { page: null, error: 'not_found' };
    console.error('fetchEventPage failed', error);
    return { page: null, error: 'failed' };
  }
  return { page: (data as { page: EventPage }).page, error: null };
}

export type RsvpInput = {
  token: string;
  name: string;
  email: string;
  status: RsvpStatus;
  isBeginner: boolean;
  isTeacher: boolean;
  bringsSet: boolean;
  hasCard: boolean;
  secret: string | null;
};

export type RsvpResult =
  | { outcome: 'created' | 'updated'; secret: string; status: StoredRsvpStatus }
  | { outcome: 'exists' }
  | { outcome: 'error'; message: string };

export async function submitRsvp(input: RsvpInput): Promise<RsvpResult> {
  const { data, error } = await supabase.functions.invoke('mahj-night', {
    method: 'POST',
    body: input,
  });
  if (error) {
    let code = 'failed';
    try {
      const res = (error as { context?: Response }).context;
      if (res && typeof res.json === 'function') code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // keep 'failed'
    }
    return { outcome: 'error', message: rsvpErrorMessage(code) };
  }
  return data as RsvpResult;
}

export function rsvpErrorMessage(code: string): string {
  switch (code) {
    case 'full':
      return "It's full. You can still say maybe, and the host will see it.";
    case 'rate_limited':
      return 'Too many tries. Wait a few minutes and try again.';
    case 'not_found':
      return 'This invite is no longer open.';
    case 'invalid_email':
      return 'Check your email address.';
    case 'invalid_name':
    case 'invalid_request':
      return 'Add your name and email.';
    default:
      return 'Could not save your RSVP. Try again.';
  }
}

// ---------------------------------------------------------------------------
// This browser's RSVP secret
// ---------------------------------------------------------------------------

const secretKey = (token: string) => `mahj-night-rsvp:${token}`;

export async function loadRsvpSecret(token: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(secretKey(token)) ?? null;
    return await AsyncStorage.getItem(secretKey(token));
  } catch {
    return null;
  }
}

export async function saveRsvpSecret(token: string, secret: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(secretKey(token), secret);
    else await AsyncStorage.setItem(secretKey(token), secret);
  } catch {
    // Not fatal: the confirmation email carries the same link.
  }
}

// ---------------------------------------------------------------------------
// Home: the nights I host or am going to
// ---------------------------------------------------------------------------

export type MyNight = {
  clubId: string;
  eventId: string;
  title: string;
  linkToken: string;
  themeId: string | null;
  startsAt: string;
  timezone: string;
  area: string;
  cancelled: boolean;
};

/**
 * Upcoming Mahj Nights whose group I'm in (as host, or as a guest who signed
 * in). RLS on clubs and events already limits this to my memberships.
 * Null on failure.
 */
export async function fetchMyMahjNights(now: Date = new Date()): Promise<MyNight[] | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('id, name, link_token, theme_id, timezone, events(id, title, starts_at, ends_at, public_area, status, event_type)')
      .eq('kind', 'event');
    if (error) {
      console.error('fetchMyMahjNights failed', error);
      return null;
    }
    type Row = {
      id: string; name: string; link_token: string; theme_id: string | null; timezone: string;
      events: { id: string; title: string | null; starts_at: string; ends_at: string;
        public_area: string; status: string; event_type: string }[];
    };
    const nights: MyNight[] = [];
    for (const c of (data ?? []) as unknown as Row[]) {
      const e = (c.events ?? []).find((x) => x.event_type === 'mahj_night');
      if (!e || new Date(e.ends_at) < now) continue;
      nights.push({
        clubId: c.id,
        eventId: e.id,
        title: e.title ?? c.name,
        linkToken: c.link_token,
        themeId: c.theme_id,
        startsAt: e.starts_at,
        timezone: c.timezone,
        area: e.public_area,
        cancelled: e.status === 'cancelled',
      });
    }
    return nights.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  } catch (cause) {
    console.error('fetchMyMahjNights failed', cause);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Host actions
// ---------------------------------------------------------------------------

export async function resetNightLink(clubId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('reset_club_link', { target_club: clubId });
  if (error) {
    console.error('resetNightLink failed', error);
    return null;
  }
  return data as string;
}

export async function setNightLinkEnabled(clubId: string, enabled: boolean): Promise<boolean> {
  const { error } = await supabase.rpc('set_club_link_enabled', { target_club: clubId, enabled });
  if (error) {
    console.error('setNightLinkEnabled failed', error);
    return false;
  }
  return true;
}

export type NightDetails = {
  area: string;
  beginnersWelcome: boolean;
  sets: number;
  money: MoneyNorm;
  moneyNote: string;
};

export async function setMahjNightDetails(eventId: string, d: NightDetails): Promise<boolean> {
  const { error } = await supabase.rpc('set_mahj_night_details', {
    target_event: eventId,
    area_label: d.area,
    beginners: d.beginnersWelcome,
    sets: d.sets,
    money: d.money,
    money_text: d.money === 'host_choice' ? d.moneyNote : '',
  });
  if (error) {
    console.error('setMahjNightDetails failed', error);
    return false;
  }
  return true;
}

/** The host moves a guest to a table, or (null) back to the suggested plan. */
export async function setRsvpTable(rsvpId: string, table: number | null): Promise<boolean> {
  const { error } = await supabase.rpc('set_rsvp_table', { target_rsvp: rsvpId, table_no: table });
  if (error) {
    console.error('setRsvpTable failed', error);
    return false;
  }
  return true;
}

/**
 * After sign-in: link this account's RSVPs (by its verified email) and join
 * those nights' groups. Never throws; sign-in must not fail because of it.
 */
export async function claimMyRsvps(): Promise<void> {
  try {
    const { error } = await supabase.rpc('claim_my_rsvps');
    if (error) console.error('claimMyRsvps failed', error);
  } catch (cause) {
    console.error('claimMyRsvps failed', cause);
  }
}

// ---------------------------------------------------------------------------
// Links, sharing, calendar
// ---------------------------------------------------------------------------

const APP_ORIGIN = 'https://app.mahjhero.com';

/** Where this app is served: the current site on web (so previews link to themselves). */
export function appOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return APP_ORIGIN;
}

export function eventUrl(token: string): string {
  return `${appOrigin()}/e/${encodeURIComponent(token)}`;
}

export function shareMessage(title: string, url: string): string {
  return `You're invited to ${title}. RSVP here: ${url}`;
}

export async function copyEventLink(token: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(eventUrl(token));
      return true;
    }
    // No clipboard module in the native build (adding one needs a new
    // binary); the system share sheet has its own Copy.
    await Share.share({ message: eventUrl(token) });
    return true;
  } catch (cause) {
    console.error('copyEventLink failed', cause);
    return false;
  }
}

/** Native share sheet; on web, the Web Share API where there is one, else copy. */
export async function shareEventLink(
  title: string,
  token: string,
): Promise<'shared' | 'copied' | 'failed'> {
  const url = eventUrl(token);
  const message = shareMessage(title, url);
  try {
    if (Platform.OS === 'web') {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (typeof nav.share === 'function') {
        await nav.share({ title, text: `You're invited to ${title}.`, url });
        return 'shared';
      }
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
    await Share.share({ message, url });
    return 'shared';
  } catch (cause) {
    if ((cause as { name?: string })?.name === 'AbortError') return 'failed';
    console.error('shareEventLink failed', cause);
    return 'failed';
  }
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export type CalendarFacts = {
  title: string;
  startsAt: string;
  endsAt: string;
  address: string;
  details: string;
  url: string;
};

export function googleCalendarUrl(f: CalendarFacts): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: f.title,
    dates: `${utcStamp(f.startsAt)}/${utcStamp(f.endsAt)}`,
    details: f.details ? `${f.details}\n\n${f.url}` : f.url,
    location: f.address,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function icsFile(f: CalendarFacts, uid: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MahjHero//Mahj Night//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@mahjhero.com`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART:${utcStamp(f.startsAt)}`,
    `DTEND:${utcStamp(f.endsAt)}`,
    `SUMMARY:${icsText(f.title)}`,
    `LOCATION:${icsText(f.address)}`,
    `DESCRIPTION:${icsText(f.details ? `${f.details}\n\n${f.url}` : f.url)}`,
    `URL:${f.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Web: download the .ics. Native opens the same file through the browser. */
export function icsDataUrl(f: CalendarFacts, uid: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsFile(f, uid))}`;
}

/** "Fri, Dec 5 · 7:00 PM" in the night's own timezone. */
export function formatNightWhen(startsAt: string, timezone: string): string {
  const d = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(d);
  return `${day} · ${time}`;
}

// ---------------------------------------------------------------------------
// The planner's wording (pivot batch 2b)
// ---------------------------------------------------------------------------

/** "Table 1 full · Table 2: 3 of 4 · Table 3: open". */
export function tableLine(counts: number[], capacities: number[]): string {
  return capacities
    .map((cap, i) => {
      const n = counts[i] ?? 0;
      if (n >= cap) return `Table ${i + 1} full`;
      if (n === 0) return `Table ${i + 1}: open`;
      return `Table ${i + 1}: ${n} of ${cap}`;
    })
    .join(' · ');
}

/**
 * "1 more makes a full table" while a table is part-filled and seats
 * remain; null otherwise. Counts the first part-filled table.
 */
export function oneMoreLine(counts: number[], capacities: number[]): string | null {
  const t = capacities.findIndex((cap, i) => (counts[i] ?? 0) > 0 && (counts[i] ?? 0) < cap);
  if (t === -1) return null;
  const need = capacities[t] - (counts[t] ?? 0);
  return need === 1 ? '1 more makes a full table' : `${need} more make a full table`;
}

export function moneyLine(norm: MoneyNorm, note: string): string {
  if (norm === 'quarters') return 'Quarters';
  if (norm === 'host_choice' && note.trim()) return note.trim();
  return 'No money';
}

/**
 * The host's warning when the yeses outgrow the sets: tables that can run
 * are the smaller of the tables planned and the sets available.
 */
export function setsWarning(going: number, tables: number, sets: number): string | null {
  const runnable = Math.min(tables, sets);
  const seats = runnable * 4;
  if (going <= seats) return null;
  const setWord = sets === 1 ? 'set' : 'sets';
  if (seats === 0) return `You have ${going} going and no sets. Ask someone to bring a set.`;
  return `You have ${going} going and ${sets} ${setWord}. Ask someone to bring a set, or cap at ${seats}.`;
}
