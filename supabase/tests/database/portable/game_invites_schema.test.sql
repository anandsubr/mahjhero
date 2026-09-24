begin;
set local search_path to extensions, public;

select plan(9);

-- Game invites (2026-09-24): a booking can be pending the invitee's answer.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'booking_status'),
  array['confirmed', 'waitlisted', 'invited', 'cancelled', 'declined'],
  'booking_status has invited, between waitlisted and cancelled');

select has_column('public', 'bookings', 'invite_holds_seat',
  'bookings has invite_holds_seat');
select col_type_is('public', 'bookings', 'invite_holds_seat', 'boolean',
  'invite_holds_seat is a boolean');
select col_is_null('public', 'bookings', 'invite_holds_seat',
  'invite_holds_seat is nullable -- null on every non-invited row');

select is(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'bookings_invite_holds_seat_iff_invited'),
  'CHECK (((status = ''invited''::booking_status) = (invite_holds_seat IS NOT NULL)))',
  'an invited row, and only an invited row, says whether it holds a seat');

select is(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'bookings_unheld_invite_has_no_table'),
  'CHECK (((invite_holds_seat IS NOT FALSE) OR (event_table_id IS NULL)))',
  'an invite that holds no seat names no table');

select ok(
  (select pg_get_indexdef(i.indexrelid)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'bookings_one_active_per_person_idx')
  like '%''invited''%',
  'one active booking per person per game counts a pending invite');

select ok(
  (select i.indisunique
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'bookings_one_active_per_person_idx'),
  'and is still unique');

select ok(
  (select array_agg(e.enumlabel::text)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outbox_kind')
  @> array['booking_invited', 'booking_invite_accepted',
           'booking_invite_withdrawn', 'booking_cancelled_by_member'],
  'outbox_kind carries the four game-invite kinds');

select * from finish();
rollback;
