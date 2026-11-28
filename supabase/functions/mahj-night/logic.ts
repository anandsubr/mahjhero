import type { Body } from '../_shared/email-types.ts';
import { planSeating, type SeatingInput } from '../_shared/seating.ts';

/**
 * The pure half of the mahj-night function: request parsing, the RSVP
 * confirmation email, error mapping. index.ts does the I/O.
 */

export type RsvpStatus = 'going' | 'maybe' | 'no';
/** What an RSVP ends up as: a yes on a full night joins the waitlist. */
export type StoredStatus = RsvpStatus | 'waitlist';

export type RsvpRequest = {
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

const STATUSES: readonly RsvpStatus[] = ['going', 'maybe', 'no'];

/** A POST body the function will act on, or null. Lengths are rechecked in SQL. */
export function parseRsvpRequest(body: unknown): RsvpRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token !== 'string' || b.token.length < 20 || b.token.length > 100) return null;
  if (typeof b.name !== 'string' || b.name.trim().length === 0 || b.name.length > 80) return null;
  if (typeof b.email !== 'string' || b.email.length > 254) return null;
  if (typeof b.status !== 'string' || !STATUSES.includes(b.status as RsvpStatus)) return null;
  const secret = typeof b.secret === 'string' && b.secret.length >= 20 ? b.secret : null;
  return {
    token: b.token,
    name: b.name.trim(),
    email: b.email.trim(),
    status: b.status as RsvpStatus,
    isBeginner: b.isBeginner === true && b.isTeacher !== true,
    isTeacher: b.isTeacher === true,
    bringsSet: b.bringsSet === true,
    hasCard: b.hasCard === true,
    secret,
  };
}

/**
 * The caller's address for the per-IP rate limit. Behind Supabase's gateway
 * the first x-forwarded-for entry is the client.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** SQL raise text -> HTTP status and the error the app shows. */
export function rsvpError(message: string): { status: number; error: string } {
  if (message.includes('rate_limited')) return { status: 429, error: 'rate_limited' };
  if (message.includes('full')) return { status: 409, error: 'full' };
  if (message.includes('not_found')) return { status: 404, error: 'not_found' };
  if (message.includes('invalid_email')) return { status: 400, error: 'invalid_email' };
  if (message.includes('invalid_name')) return { status: 400, error: 'invalid_name' };
  return { status: 500, error: 'failed' };
}

/** "Friday, December 5 at 7:00 PM" in the night's own timezone. */
export function formatWhen(startsAt: string, timezone: string): string {
  const date = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone,
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(date);
  return `${day} at ${time}`;
}

export function eventLink(appUrl: string, token: string, secret: string): string {
  return `${appUrl.replace(/\/+$/, '')}/e/${encodeURIComponent(token)}?r=${encodeURIComponent(secret)}`;
}

export type RsvpEmailFacts = {
  kind: 'confirm' | 'resend';
  name: string;
  status: StoredStatus;
  title: string;
  hostFirstName: string;
  startsAt: string;
  timezone: string;
  area: string;
  link: string;
};

const ANSWER: Record<StoredStatus, string> = {
  going: "You're going",
  maybe: "You're a maybe",
  no: "You can't make it",
  waitlist: "You're on the waitlist",
};

/**
 * The one email a guest gets: right after they RSVP ("confirm"), or when
 * someone RSVPs again with their address and no proof it was them
 * ("resend"). Both carry the guest's own link, which is the only way back
 * to their view from another device.
 */
export function buildRsvpEmail(f: RsvpEmailFacts): Body {
  const when = formatWhen(f.startsAt, f.timezone);
  const where = f.area ? ` in ${f.area}` : '';
  const host = f.hostFirstName ? `${f.hostFirstName}'s ` : '';
  const first = f.name.split(' ')[0] || f.name;
  if (f.kind === 'resend') {
    return {
      subject: `Your RSVP for ${f.title}`,
      headline: `Your RSVP for ${f.title}`,
      paragraphs: [
        `Hi ${first},`,
        `Someone just tried to RSVP to ${host}${f.title} with this email address. Your answer hasn't changed. Use your link to see the night or change your answer.`,
        `${when}${where}.`,
      ],
      cta: { label: 'Open your invite', url: f.link },
      footerNote: "Wasn't you? You can ignore this email. Nothing changes without your link.",
    };
  }
  return {
    subject: `${ANSWER[f.status]}: ${f.title}`,
    headline: `${ANSWER[f.status]} to ${f.title}`,
    paragraphs: [
      `Hi ${first},`,
      f.status === 'going'
        ? `Thanks for saying yes to ${host}${f.title}. Your link has the address and who else is coming.`
        : f.status === 'waitlist'
          ? `Every seat is taken for now. If one opens, your link will show a Count me in button: the first to tap it gets the seat.`
          : `Thanks for letting ${f.hostFirstName || 'the host'} know. You can change your answer any time with your link.`,
      `${when}${where}.`,
    ],
    cta: { label: 'Open your invite', url: f.link },
    footerNote: 'Keep this email: the link is how you get back to your invite.',
  };
}

/**
 * The event page as it leaves the server (pivot batch 2b). event_page hands
 * over `_seating` (every yes, with experience and any table the host chose)
 * and `_my_rsvp_id`; this runs the seating plan on them, adds what this
 * viewer may see of it, and strips every `_` key so other guests' ids and
 * experience never reach a browser that isn't the host's.
 *
 *   everyone   table_counts / table_capacities ("Table 1 full · ...")
 *   a yes      my_table
 *   the host   table + table_pinned on each RSVP
 */
export function shapePage(raw: Record<string, unknown>): Record<string, unknown> {
  const seating = raw._seating as SeatingInput | undefined;
  const myId = raw._my_rsvp_id as string | null | undefined;
  const page: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith('_')) page[k] = v;
  if (!seating) return page;

  const plan = planSeating(seating);
  page.table_counts = plan.counts;
  page.table_capacities = seating.capacities;

  const mine = page.my_rsvp as { status?: string } | null | undefined;
  if (myId && mine?.status === 'going' && plan.tables[myId]) {
    page.my_table = plan.tables[myId].table;
  }

  if (page.tier === 'host' && Array.isArray(page.rsvps)) {
    page.rsvps = (page.rsvps as { id: string }[]).map((r) => ({
      ...r,
      table: plan.tables[r.id]?.table ?? null,
      table_pinned: plan.tables[r.id]?.pinned ?? false,
    }));
  }
  return page;
}
