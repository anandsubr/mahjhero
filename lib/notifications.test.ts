import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
// Matches this repo's own convention (lib/bookings.test.ts, lib/messages.test.ts):
// a top-level rpc mock closed over by the factory, not `vi.mocked(supabase.rpc)`
// -- vi.mock factories can't reference out-of-scope vars directly under vitest's
// hoisting, but a closure that calls out to a module-level fn works fine.
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { describeNotification } from './notifications';
import type { NotificationRow } from './notifications';
import { fetchMyNotifications, markNotificationsRead, fetchNotificationUnreadCount } from './notifications';

beforeEach(() => rpc.mockReset());

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n1',
    kind: 'booked_by_friend',
    payload: {},
    club_id: 'club-1',
    club_name: 'Riverside Mah Jongg',
    event_id: 'event-1',
    event_title: 'Thursday Mahjong',
    event_starts_at: '2026-09-03T23:00:00.000Z',
    club_timezone: 'America/New_York',
    table_label: null,
    actor_name: null,
    broadcast_subject: null,
    broadcast_body: null,
    created_at: '2026-09-01T12:00:00.000Z',
    ...over,
  };
}

describe('describeNotification', () => {
  it('booked_by_friend: names who booked you in, and where', () => {
    const result = describeNotification(row({ kind: 'booked_by_friend', actor_name: 'Ada' }));
    expect(result.headline).toBe('You have a seat');
    expect(result.detail).toContain('Ada booked you in for');
    expect(result.href).toBe('/clubs/club-1/events/event-1');
  });

  it('booked_by_friend: falls back to "Someone" with no actor name', () => {
    const result = describeNotification(row({ kind: 'booked_by_friend', actor_name: null }));
    expect(result.detail).toContain('Someone booked you in for');
  });

  it('booking_declined', () => {
    const result = describeNotification(row({ kind: 'booking_declined', actor_name: 'Ben' }));
    expect(result.headline).toBe('A seat came free');
    expect(result.detail).toContain('Ben declined the seat');
  });

  it('booking_cancelled_by_host', () => {
    const result = describeNotification(row({ kind: 'booking_cancelled_by_host', actor_name: 'Cara' }));
    expect(result.headline).toBe('Your seat was cancelled');
    expect(result.detail).toContain('Cara cancelled your seat');
  });

  it('waitlist_promoted: includes the table when there is one', () => {
    const result = describeNotification(
      row({ kind: 'waitlist_promoted', table_label: 'Table 2' }),
    );
    expect(result.headline).toBe('You have a seat');
    expect(result.detail).toContain('at Table 2');
  });

  it('promotion_offer', () => {
    const result = describeNotification(row({ kind: 'promotion_offer' }));
    expect(result.headline).toBe('A seat is yours if you want it');
    expect(result.detail).toContain('Held for two hours');
  });

  it('promotion_offer_expired', () => {
    const result = describeNotification(row({ kind: 'promotion_offer_expired' }));
    expect(result.headline).toBe('That seat has gone');
  });

  it('unseated', () => {
    const result = describeNotification(row({ kind: 'unseated' }));
    expect(result.headline).toBe('You lost your seat');
  });

  it('event_cancelled: links to the club, not the (gone) event', () => {
    const result = describeNotification(
      row({ kind: 'event_cancelled', event_id: null }),
    );
    expect(result.headline).toBe('The game is off');
    expect(result.href).toBe('/clubs/club-1');
  });

  it('need_a_fourth: falls back to "A table" with none named', () => {
    const result = describeNotification(
      row({ kind: 'need_a_fourth', table_label: null }),
    );
    expect(result.headline).toBe('They need a fourth');
    expect(result.detail).toContain('A table at');
  });

  it('event_reminder: says "Tomorrow" for a day-ahead offset', () => {
    const result = describeNotification(
      row({ kind: 'event_reminder', payload: { offset_minutes: 1440 } }),
    );
    expect(result.headline).toBe('Tomorrow');
  });

  it('event_reminder: says "Starting soon" for a same-day offset', () => {
    const result = describeNotification(
      row({ kind: 'event_reminder', payload: { offset_minutes: 120 } }),
    );
    expect(result.headline).toBe('Starting soon');
  });

  it('broadcast: uses the subject as the headline', () => {
    const result = describeNotification(
      row({
        kind: 'broadcast',
        broadcast_subject: 'Court closed Saturday',
        broadcast_body: 'The usual room is unavailable this weekend.\n\nSee you Sunday instead.',
      }),
    );
    expect(result.headline).toBe('Court closed Saturday');
    expect(result.detail).toBe('The usual room is unavailable this weekend.');
  });

  it('broadcast: falls back to a club-named headline with no subject', () => {
    const result = describeNotification(
      row({ kind: 'broadcast', broadcast_subject: null, broadcast_body: null }),
    );
    expect(result.headline).toBe('A message from Riverside Mah Jongg');
  });

  it('attendance_declined', () => {
    const result = describeNotification(
      row({ kind: 'attendance_declined', actor_name: 'Dev' }),
    );
    expect(result.headline).toBe('Someone is not coming');
    expect(result.detail).toContain("Dev says they can't make");
  });
});

describe('fetchMyNotifications', () => {
  it('returns the rows on success', async () => {
    rpc.mockResolvedValueOnce({ data: [row()], error: null });
    expect(await fetchMyNotifications()).toEqual([row()]);
  });

  it('resolves to null on failure rather than throwing', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await fetchMyNotifications()).toBeNull();
  });
});

describe('fetchNotificationUnreadCount', () => {
  it('returns the count on success', async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await fetchNotificationUnreadCount()).toBe(3);
  });

  it('resolves to 0 on failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await fetchNotificationUnreadCount()).toBe(0);
  });
});

describe('markNotificationsRead', () => {
  it('reports no error on success', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await markNotificationsRead()).toEqual({ error: null });
  });

  it('relays the refusal on failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const { error } = await markNotificationsRead();
    expect(error).toBeTruthy();
  });
});
