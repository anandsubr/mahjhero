begin;
set local search_path to extensions, public;

select plan(14);

-- The two new kinds. enum_range is the only way to ask "does this enum
-- carry this label" without casting, and a cast would fail the whole file
-- rather than fail one assertion.
select ok(
  'event_reminder' = any(enum_range(null::public.outbox_kind)::text[]),
  'outbox_kind carries event_reminder'
);
select ok(
  'broadcast' = any(enum_range(null::public.outbox_kind)::text[]),
  'outbox_kind carries broadcast'
);

select has_column('public', 'notification_outbox', 'attempts',        'attempts exists');
select has_column('public', 'notification_outbox', 'next_attempt_at', 'next_attempt_at exists');
select has_column('public', 'notification_outbox', 'last_error',      'last_error exists');
select has_column('public', 'notification_outbox', 'failed_at',       'failed_at exists');
select has_column('public', 'notification_outbox', 'expired_at',      'expired_at exists');

select col_not_null('public', 'notification_outbox', 'attempts',
                    'attempts is not null');
select col_not_null('public', 'notification_outbox', 'next_attempt_at',
                    'next_attempt_at is not null');
select col_default_is('public', 'notification_outbox', 'attempts', '0',
                      'attempts defaults to 0');

-- A row inserted by plan 4's producers must be due immediately, or the
-- very first drain would find an empty queue.
insert into auth.users (id, email)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'event_cancelled', '{}'::jsonb, 'lifecycle:1');

select ok(
  (select next_attempt_at <= now() from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'a freshly queued row is due immediately'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  0,
  'a freshly queued row has made no attempts'
);

-- The terminal states are mutually exclusive. Without the constraint a
-- retry could mark a row both failed and sent, and "what happened to this
-- message" stops being answerable from the row.
select throws_ok(
  $$update public.notification_outbox
       set sent_at = now(), failed_at = now()
     where id = '0b0b0b0b-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'a row cannot be both sent and failed'
);

select has_index('public', 'notification_outbox', 'notification_outbox_due',
                 'the due index exists');

select * from finish();
rollback;
