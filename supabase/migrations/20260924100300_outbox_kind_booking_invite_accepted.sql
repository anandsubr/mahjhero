/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by accept_booking_invite (20260924103000) to the sender. */
alter type public.outbox_kind
  add value if not exists 'booking_invite_accepted';
