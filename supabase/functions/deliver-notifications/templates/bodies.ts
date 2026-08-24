import type { Body, RenderRow } from '../types.ts';

/**
 * In the CLUB's timezone, not the recipient's. A game happens where the
 * club is; telling a member who travelled that Tuesday night starts at
 * 20:00 their time would be true and useless.
 */
function formatWhen(row: RenderRow): string {
  if (!row.event_starts_at) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: row.club_timezone,
  }).format(new Date(row.event_starts_at));
}

/** "Tuesday night on Tuesday, September 8 at 7:00 PM" — the whole phrase. */
function game(row: RenderRow): string {
  const title = row.event_title ?? 'the game';
  const when = formatWhen(row);
  return when ? `${title} on ${when}` : title;
}

function at(row: RenderRow): string {
  return row.table_label ? ` at ${row.table_label}` : '';
}

/**
 * `actor_name` is null whenever nobody did it — a waitlist promotion is
 * the system's doing, and a host who deleted their account leaves a
 * cancellation with no name on it. Every use goes through this so no email
 * ever reads "undefined cancelled your seat".
 */
function actor(row: RenderRow, fallback: string): string {
  return row.actor_name ?? fallback;
}

function eventUrl(row: RenderRow, appUrl: string): string {
  return row.event_id
    ? `${appUrl}/clubs/${row.club_id}/events/${row.event_id}`
    : `${appUrl}/clubs/${row.club_id}`;
}

const SEAT_FOOTER = (club: string) =>
  `You're getting this because of a seat you hold at ${club}.`;

/**
 * `need_a_fourth` is the one member-facing kind with a real, dedicated
 * off switch — app/notifications.tsx's "Mute need a 4th alerts" toggle —
 * so this is the one footer allowed to say settings change what reaches
 * you.
 */
const NEED_A_FOURTH_FOOTER = (club: string) =>
  `You're getting this because you're a member of ${club}. You can change what reaches you in your notification settings.`;

/**
 * `broadcast` used to share `NEED_A_FOURTH_FOOTER` (as `MEMBER_FOOTER`),
 * which promises the same settings-page control over broadcasts that
 * `need_a_fourth` actually has. It doesn't exist: app/notifications.tsx
 * offers exactly three controls — channel, quiet hours, and mute
 * need-a-4th — and none of them can silence a broadcast. A broadcast mute
 * is explicitly out of scope for this plan, so the fix here is a footer
 * that says something true instead of building the setting: quiet hours
 * (`outbox_quiet_class('broadcast') = 'suppressible'`, in
 * 20260826040000_notification_predicates.sql) genuinely holds a broadcast
 * until the window closes, which is the one lever that's real.
 */
const BROADCAST_FOOTER = (club: string) =>
  `You're getting this because you're a member of ${club}. Messages like this from your organizers can't be turned off, but quiet hours in your notification settings can hold them until morning.`;

const REMINDER_FOOTER =
  "You're getting this because you have a seat at this game. Reminders for games you've booked can't be switched off.";

/**
 * Reached only when `row.kind` isn't one of the eleven cases below. For a
 * genuine `RenderRow` that's impossible by type, which is the point: the
 * parameter type is `never`, so TypeScript narrows `row.kind` to `never`
 * in the `default:` branch below only when every member of `OutboxKind`
 * has its own `case`. Delete a case, or add a twelfth kind without one,
 * and the call site fails to compile instead of silently falling through
 * — the same guarantee `tsc` gave for free before this function had a
 * `default:` at all, just recovered explicitly.
 *
 * It's reachable at runtime all the same, whenever the value crossing the
 * boundary from the database (or a test double) isn't actually restricted
 * to `OutboxKind` — a producer queued something no template handles. That
 * is a genuine bug, and it should fail with a message a human can act on
 * rather than a `TypeError` from `render.ts` reading `.subject` off
 * `undefined`.
 */
function unhandledKind(kind: never): never {
  throw new Error(`bodyFor: unhandled notification kind: ${String(kind)}`);
}

export function bodyFor(row: RenderRow, appUrl: string): Body {
  const url = eventUrl(row, appUrl);
  const seatFooter = SEAT_FOOTER(row.club_name);
  const needAFourthFooter = NEED_A_FOURTH_FOOTER(row.club_name);
  const broadcastFooter = BROADCAST_FOOTER(row.club_name);

  switch (row.kind) {
    case 'booked_by_friend':
      return {
        subject: `${actor(row, 'Someone')} saved you a seat at ${row.club_name}`,
        headline: 'You have a seat',
        paragraphs: [
          `${actor(row, 'Someone')} booked you in for ${game(row)}${at(row)}.`,
          "If you can't make it, decline the seat and it goes back into the pool for somebody else.",
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'booking_declined':
      return {
        subject: `${actor(row, 'Someone')} can't make ${row.event_title ?? 'the game'}`,
        headline: 'A seat came free',
        paragraphs: [
          `${actor(row, 'The person you booked for')} declined the seat you booked for them at ${game(row)}.`,
          'The seat is back in the pool.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'booking_cancelled_by_host':
      return {
        subject: `Your seat at ${row.event_title ?? 'the game'} was cancelled`,
        headline: 'Your seat was cancelled',
        paragraphs: [
          `${actor(row, 'A host')} cancelled your seat at ${game(row)}.`,
          'If that looks wrong, the club is the place to sort it out.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'waitlist_promoted':
      return {
        subject: `You're in for ${row.event_title ?? 'the game'}`,
        headline: 'You have a seat',
        paragraphs: [
          `A seat opened up at ${game(row)} and you were next on the waitlist${at(row)}.`,
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'promotion_offer':
      return {
        subject: `A seat is being held for you at ${row.event_title ?? 'the game'}`,
        headline: 'A seat is yours if you want it',
        paragraphs: [
          `Room came free at ${game(row)}, and you were next.`,
          "It's held for you for the next two hours. After that it goes to whoever is behind you.",
        ],
        cta: { label: 'Take the seat', url },
        footerNote: seatFooter,
      };

    case 'promotion_offer_expired':
      return {
        subject: `The seat at ${row.event_title ?? 'the game'} has gone`,
        headline: 'That seat has gone',
        paragraphs: [
          `The seat held for you at ${game(row)} wasn't taken in time, so it went to the next group.`,
          "You're still on the waitlist.",
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'unseated':
      return {
        subject: `You no longer have a seat at ${row.event_title ?? 'the game'}`,
        headline: 'You lost your seat',
        paragraphs: [
          `Your seat at ${game(row)} is no longer yours.`,
          'If there is room left, you can take another.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'event_cancelled':
      return {
        subject: `${row.event_title ?? 'A game'} is cancelled`,
        headline: 'The game is off',
        paragraphs: [
          `${game(row)} has been cancelled. Your seat went with it.`,
        ],
        cta: { label: `See what else ${row.club_name} has on`, url: `${appUrl}/clubs/${row.club_id}` },
        footerNote: seatFooter,
      };

    case 'need_a_fourth':
      return {
        subject: `${row.club_name} needs a fourth`,
        headline: 'They need a fourth',
        paragraphs: [
          `${row.table_label ?? 'A table'} at ${game(row)} is three of four.`,
          'Take the seat and they have a game.',
        ],
        cta: { label: 'Take the seat', url },
        footerNote: needAFourthFooter,
      };

    case 'event_reminder': {
      // The two default offsets want different words. A day-ahead reminder
      // exists so you can cancel and free the seat; a two-hour one exists
      // so you leave the house.
      const minutes = Number(row.payload.offset_minutes ?? 0);
      const dayAhead = minutes >= 1440;
      return {
        subject: dayAhead
          ? `${row.event_title ?? 'Your game'} is tomorrow`
          : `${row.event_title ?? 'Your game'} starts soon`,
        headline: dayAhead ? 'Tomorrow' : 'Starting soon',
        paragraphs: [
          `You have a seat at ${game(row)}${at(row)}.`,
          dayAhead
            ? "If you can't make it, cancelling now gives the seat to somebody who can."
            : 'See you there.',
        ],
        cta: { label: 'See the game', url },
        footerNote: REMINDER_FOOTER,
      };
    }

    case 'broadcast':
      return {
        subject: row.broadcast_subject ?? `A message from ${row.club_name}`,
        headline: row.broadcast_subject ?? `A message from ${row.club_name}`,
        paragraphs: (row.broadcast_body ?? '')
          .split(/\n{2,}/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
        cta: { label: row.event_id ? 'See the game' : `See ${row.club_name}`, url },
        footerNote: broadcastFooter,
      };

    default:
      return unhandledKind(row.kind);
  }
}
