begin;
set local search_path to extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');

-- First call creates a token for the caller and returns it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select public.my_calendar_feed_token() as first_token \gset

select matches(
  :'first_token'::text,
  '^[A-Za-z0-9_-]{32}$',
  'my_calendar_feed_token returns a 32-char URL-safe token'
);

-- A second call is stable: same profile, same token.
select is(
  public.my_calendar_feed_token(),
  :'first_token'::text,
  'my_calendar_feed_token returns the same token on a later call'
);

select public.reset_calendar_feed_token() as reset_token \gset

select isnt(
  :'reset_token'::text,
  :'first_token'::text,
  'reset_calendar_feed_token returns a different token'
);

select is(
  public.my_calendar_feed_token(),
  :'reset_token'::text,
  'my_calendar_feed_token returns the reset token afterwards'
);

reset role;

-- authenticated cannot read the table directly; the token is only ever
-- returned through the definer functions.
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select token from public.calendar_feeds$$,
  '42501', null, 'authenticated cannot select from calendar_feeds directly'
);

reset role;

-- anon cannot call the RPC at all.
set local role anon;

select throws_ok(
  $$select public.my_calendar_feed_token()$$,
  '42501', null, 'anon cannot call my_calendar_feed_token'
);

reset role;

select * from finish();
rollback;
