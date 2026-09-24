/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by withdraw_booking_invite (20260924103000) to the invitee. */
alter type public.outbox_kind
  add value if not exists 'booking_invite_withdrawn';
