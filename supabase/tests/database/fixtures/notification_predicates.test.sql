begin;
set local search_path to extensions, public;

select plan(21);

-- ---------------------------------------------------------------------
-- in_quiet_window. Every default user has a window that wraps midnight
-- (21:00-08:00), so the naive `start <= t <= end` comparison is wrong for
-- everybody. These assertions exist to keep it that way.
-- ---------------------------------------------------------------------

-- A wrapping window, evaluated in New York.
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T02:00:00-04:00'::timestamptz),
  '02:00 local is inside a 21:00-08:00 window'
);
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T23:30:00-04:00'::timestamptz),
  '23:30 local is inside a 21:00-08:00 window'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T12:00:00-04:00'::timestamptz),
  'midday is outside a 21:00-08:00 window'
);

-- Boundaries: inclusive at the start, exclusive at the end. A message due
-- at exactly 08:00 goes; the window is over.
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T21:00:00-04:00'::timestamptz),
  'the window includes its start'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T08:00:00-04:00'::timestamptz),
  'the window excludes its end'
);

-- A non-wrapping window still has to work.
select ok(
  public.in_quiet_window('America/New_York', '13:00', '15:00',
                         '2026-09-01T14:00:00-04:00'::timestamptz),
  'a same-day window contains its middle'
);
select ok(
  not public.in_quiet_window('America/New_York', '13:00', '15:00',
                             '2026-09-01T16:00:00-04:00'::timestamptz),
  'a same-day window excludes what follows it'
);

-- The timezone is the MEMBER's, and it is the whole point. The same
-- instant is quiet for one member and not for another.
select ok(
  public.in_quiet_window('America/Los_Angeles', '21:00', '08:00',
                         '2026-09-01T05:00:00-04:00'::timestamptz),
  '05:00 in New York is 02:00 in Los Angeles, and quiet there'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T09:00:00-04:00'::timestamptz),
  'the same instant is not quiet in New York'
);

-- Degenerate: a zero-length window is no window at all.
select ok(
  not public.in_quiet_window('America/New_York', '08:00', '08:00',
                             '2026-09-01T08:00:00-04:00'::timestamptz),
  'a zero-length window holds nothing'
);

-- ---------------------------------------------------------------------
-- outbox_quiet_class.
-- ---------------------------------------------------------------------
select is(public.outbox_quiet_class('promotion_offer'), 'never_held',
          'an offer with a two-hour fuse is never held');
select is(public.outbox_quiet_class('event_cancelled'), 'never_held',
          'a cancellation is never held');
select is(public.outbox_quiet_class('event_reminder'), 'exempt_near_event',
          'a reminder is held, with an exemption');
select is(public.outbox_quiet_class('need_a_fourth'), 'suppressible',
          'a call for a fourth waits for morning');
select is(public.outbox_quiet_class('broadcast'), 'suppressible',
          'a broadcast waits for morning');

-- ---------------------------------------------------------------------
-- outbox_expires_at.
-- ---------------------------------------------------------------------
select is(
  public.outbox_expires_at('event_reminder',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-02T23:00:00Z'::timestamptz),
  '2026-09-02T23:00:00Z'::timestamptz,
  'an event-bound message dies when the game starts'
);
select is(
  public.outbox_expires_at('event_cancelled',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-02T23:00:00Z'::timestamptz),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a cancellation outlives the slot it cancelled, by a day'
);
select is(
  public.outbox_expires_at('broadcast',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-05T23:00:00Z'::timestamptz),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a broadcast is stale after a day whatever it was about'
);
select is(
  public.outbox_expires_at('broadcast',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           null),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a club-wide broadcast has no event to die with'
);

-- ---------------------------------------------------------------------
-- Backoff and the attempt ceiling.
-- ---------------------------------------------------------------------
select is(
  array[public.outbox_backoff(1), public.outbox_backoff(2),
        public.outbox_backoff(3), public.outbox_backoff(4),
        public.outbox_backoff(5)],
  array[interval '5 minutes',  interval '10 minutes',
        interval '20 minutes', interval '40 minutes',
        interval '80 minutes'],
  'backoff doubles from five minutes'
);
select is(public.outbox_max_attempts(), 5,
          'five attempts, then the row is dead-lettered');

select * from finish();
rollback;
