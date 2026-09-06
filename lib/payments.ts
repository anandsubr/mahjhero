import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import { bookingErrorMessage } from './bookings';

/**
 * One payment mark, as `event_payment_status` returns it. Organizer-only —
 * see supabase/migrations/20260906150000_payment_mutations.sql.
 */
export type PaymentRow = {
  profile_id: string;
  paid_at: string;
  marked_by: string;
};

/**
 * `null` on failure, never `[]` -- the same "failed is not empty" distinction
 * `fetchEventAttendance` (lib/attendance.ts) and `venuesFailed`/`entriesFailed`
 * elsewhere in this codebase already make. Collapsing the two would render a
 * failed fetch as "nobody has paid", which is not true.
 */
export async function fetchEventPayments(
  eventId: string,
): Promise<PaymentRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('event_payment_status', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventPayments failed', error);
      return null;
    }
    return (data ?? []) as PaymentRow[];
  } catch (cause) {
    console.error('fetchEventPayments failed', cause);
    return null;
  }
}

export async function setPaymentStatus(input: {
  eventId: string;
  profileId: string;
  isPaid: boolean;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_payment_status', {
      target_event: input.eventId,
      target_profile: input.profileId,
      is_paid: input.isPaid,
    });
    if (error) {
      console.error('setPaymentStatus failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('setPaymentStatus failed', cause);
    return { error: GENERIC_ERROR };
  }
}
