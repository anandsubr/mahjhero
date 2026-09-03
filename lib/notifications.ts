import { formatEventWhen } from './events';
import { supabase } from './supabase';

/** Mirrors supabase/functions/deliver-notifications/types.ts's OutboxKind
 *  exactly -- can't be imported across the Deno/Node boundary, so this is
 *  a deliberate, parallel redeclaration, not a drift risk in practice: the
 *  enum is stable schema, not something either side edits casually. */
export type OutboxKind =
  | 'booked_by_friend'
  | 'booking_declined'
  | 'booking_cancelled_by_host'
  | 'waitlist_promoted'
  | 'promotion_offer'
  | 'promotion_offer_expired'
  | 'unseated'
  | 'event_cancelled'
  | 'need_a_fourth'
  | 'event_reminder'
  | 'broadcast'
  | 'attendance_declined';

/** One row of fetch_my_notifications() -- the RPC's own returns table (...)
 *  shape, column for column. */
export type NotificationRow = {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  club_id: string;
  club_name: string;
  event_id: string | null;
  event_title: string | null;
  event_starts_at: string | null;
  club_timezone: string;
  table_label: string | null;
  actor_name: string | null;
  broadcast_subject: string | null;
  broadcast_body: string | null;
  created_at: string;
};

export async function fetchMyNotifications(): Promise<NotificationRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_my_notifications');
    if (error) {
      console.error('fetchMyNotifications failed', error);
      return null;
    }
    return (data ?? []) as NotificationRow[];
  } catch (cause) {
    console.error('fetchMyNotifications failed', cause);
    return null;
  }
}

export async function markNotificationsRead(): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('mark_notifications_read');
    if (error) {
      console.error('markNotificationsRead failed', error);
      return { error: error.message };
    }
    return { error: null };
  } catch (cause) {
    console.error('markNotificationsRead failed', cause);
    return { error: 'Something went wrong. Try again.' };
  }
}

export async function fetchNotificationUnreadCount(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('my_notification_unread_count');
    if (error) {
      console.error('fetchNotificationUnreadCount failed', error);
      return 0;
    }
    return typeof data === 'number' ? data : 0;
  } catch (cause) {
    console.error('fetchNotificationUnreadCount failed', cause);
    return 0;
  }
}

/**
 * A ported, condensed twin of supabase/functions/deliver-notifications/
 * templates/bodies.ts's bodyFor -- same 12 cases, same voice, collapsed
 * from email's headline+multi-paragraph+cta+footer shape into a single
 * headline + one detail line + a destination route, since a list row has
 * one line of space, not an email's. Every headline below is bodyFor's own
 * headline string verbatim, so a member sees the same words here they may
 * already have seen in a push/email.
 */
function game(row: NotificationRow): string {
  const title = row.event_title ?? 'the game';
  if (!row.event_starts_at) return title;
  return `${title} · ${formatEventWhen(row.event_starts_at, row.club_timezone)}`;
}

function at(row: NotificationRow): string {
  return row.table_label ? ` at ${row.table_label}` : '';
}

function actor(row: NotificationRow, fallback: string): string {
  return row.actor_name ?? fallback;
}

function href(row: NotificationRow): string {
  return row.event_id
    ? `/clubs/${row.club_id}/events/${row.event_id}`
    : `/clubs/${row.club_id}`;
}

function unhandledKind(kind: never): never {
  throw new Error(`describeNotification: unhandled kind: ${String(kind)}`);
}

export function describeNotification(
  row: NotificationRow,
): { headline: string; detail: string; href: string } {
  switch (row.kind) {
    case 'booked_by_friend':
      return {
        headline: 'You have a seat',
        detail: `${actor(row, 'Someone')} booked you in for ${game(row)}${at(row)}.`,
        href: href(row),
      };

    case 'booking_declined':
      return {
        headline: 'A seat came free',
        detail: `${actor(row, 'The person you booked for')} declined the seat you booked for them at ${game(row)}.`,
        href: href(row),
      };

    case 'booking_cancelled_by_host':
      return {
        headline: 'Your seat was cancelled',
        detail: `${actor(row, 'A host')} cancelled your seat at ${game(row)}.`,
        href: href(row),
      };

    case 'waitlist_promoted':
      return {
        headline: 'You have a seat',
        detail: `A seat opened up at ${game(row)} and you were next on the waitlist${at(row)}.`,
        href: href(row),
      };

    case 'promotion_offer':
      return {
        headline: 'A seat is yours if you want it',
        detail: `Room came free at ${game(row)}, and you were next. Held for two hours.`,
        href: href(row),
      };

    case 'promotion_offer_expired':
      return {
        headline: 'That seat has gone',
        detail: `The seat held for you at ${game(row)} wasn't taken in time. You're still on the waitlist.`,
        href: href(row),
      };

    case 'unseated':
      return {
        headline: 'You lost your seat',
        detail: `Your seat at ${game(row)} is no longer yours.`,
        href: href(row),
      };

    case 'event_cancelled':
      // Always the club, never the event -- matches bodyFor's own cta for
      // this kind (the occurrence is usually gone by the time this renders).
      return {
        headline: 'The game is off',
        detail: `${game(row)} has been cancelled. Your seat went with it.`,
        href: `/clubs/${row.club_id}`,
      };

    case 'need_a_fourth':
      return {
        headline: 'They need a fourth',
        detail: `${row.table_label ?? 'A table'} at ${game(row)} is three of four. Take the seat and they have a game.`,
        href: href(row),
      };

    case 'event_reminder': {
      const minutes = Number(row.payload.offset_minutes ?? 0);
      const dayAhead = minutes >= 1440;
      return {
        headline: dayAhead ? 'Tomorrow' : 'Starting soon',
        detail: `You have a seat at ${game(row)}${at(row)}.`,
        href: href(row),
      };
    }

    case 'broadcast': {
      const firstParagraph = (row.broadcast_body ?? '')
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .find((part) => part.length > 0);
      return {
        headline: row.broadcast_subject ?? `A message from ${row.club_name}`,
        detail: firstParagraph ?? 'Open it to read more.',
        href: href(row),
      };
    }

    case 'attendance_declined':
      return {
        headline: 'Someone is not coming',
        detail: `${actor(row, 'A member')} says they can't make ${game(row)}. Their seat is still theirs.`,
        href: href(row),
      };

    default:
      return unhandledKind(row.kind);
  }
}
