/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by cancel_booking (20260924103000) to the sender when an accepted
 * invitee leaves the seat the sender secured for them. */
alter type public.outbox_kind
  add value if not exists 'booking_cancelled_by_member';
