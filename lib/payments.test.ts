import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import { fetchEventPayments, setPaymentStatus } from './payments';
import type { PaymentRow } from './payments';
import { bookingErrorMessage } from './bookings';
import { GENERIC_ERROR } from './constants';

// Not `beforeEach(() => rpc.mockReset())` -- see lib/attendance.test.ts's
// identical comment: mockReset() returns the mock itself, which Vitest would
// then treat as an implicit teardown callback and re-invoke after every test.
beforeEach(() => {
  rpc.mockReset();
});

function row(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    profile_id: 'p1',
    paid_at: '2026-09-06T19:00:00Z',
    marked_by: 'organizer-1',
    ...over,
  };
}

describe('fetchEventPayments', () => {
  it('returns the rows on success', async () => {
    const rows = [row()];
    rpc.mockResolvedValue({ data: rows, error: null });
    expect(await fetchEventPayments('e1')).toEqual(rows);
    expect(rpc).toHaveBeenCalledWith('event_payment_status', { target_event: 'e1' });
  });

  it('returns null rather than an empty list when the read fails', async () => {
    // null and [] mean different things: "could not load" versus "nobody
    // has paid". Conflating them would render a failed fetch as if nobody
    // had paid -- see venuesFailed/entriesFailed elsewhere in this codebase
    // for the same distinction.
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await fetchEventPayments('e1')).toBeNull();
  });

  it('returns null when the RPC throws rather than returning an error', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    expect(await fetchEventPayments('e1')).toBeNull();
  });
});

describe('setPaymentStatus', () => {
  it('passes the arguments the RPC expects', async () => {
    rpc.mockResolvedValue({ error: null });
    const result = await setPaymentStatus({
      eventId: 'e1',
      profileId: 'p1',
      isPaid: true,
    });
    expect(rpc).toHaveBeenCalledWith('set_payment_status', {
      target_event: 'e1',
      target_profile: 'p1',
      is_paid: true,
    });
    expect(result).toEqual({ error: null });
  });

  it('maps a returned refusal through bookingErrorMessage, not the raw message', async () => {
    const pgError = { code: '42501', message: 'not an organizer of this club' };
    rpc.mockResolvedValue({ error: pgError });
    const { error } = await setPaymentStatus({
      eventId: 'e1',
      profileId: 'p1',
      isPaid: true,
    });
    expect(error).toBe(bookingErrorMessage(pgError));
    expect(error).toBe('Only a club organizer can do that.');
    expect(error).not.toBe(pgError.message);
  });

  it('returns GENERIC_ERROR when the RPC throws rather than propagating', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { error } = await setPaymentStatus({
      eventId: 'e1',
      profileId: 'p1',
      isPaid: false,
    });
    expect(error).toBe(GENERIC_ERROR);
  });
});
