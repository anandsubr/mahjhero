begin;
set local search_path to extensions, public;

select plan(15);

/*
 * Nine members. The brief's fixture used six and reused `erin` both as a
 * "muted" test subject and as a warm body filling the third seat at every
 * table -- which means the mute filter was never actually exercised (she
 * was already excluded by "already seated" regardless of mute), and the
 * beginner/advanced non-adjacency rule was never exercised either (the
 * fixture's only advanced member, dan, was seated at every table that ever
 * calls, so an adjacency bug that let advanced players hear a beginner
 * table's wide call would never have shown up). Three filler identities
 * (grace, holly, ivy) take the seats instead, so erin and dan stay free
 * where the assertions below need them free.
 */
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),   -- host
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),     -- intermediate
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),   -- beginner
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),     -- advanced, kept free at E3
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),    -- beginner, muted, kept free
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),    -- no level
  ('99999999-0000-0000-0000-000000000007', 'grace@example.com'),   -- beginner, seat filler
  ('99999999-0000-0000-0000-000000000008', 'holly@example.com'),   -- muted, seat filler
  ('99999999-0000-0000-0000-000000000009', 'ivy@example.com');     -- muted, seat filler

update public.profiles set skill_level = 'intermediate'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set skill_level = 'beginner'
 where id in ('cccccccc-0000-0000-0000-000000000003',
              'eeeeeeee-0000-0000-0000-000000000005',
              '99999999-0000-0000-0000-000000000007');
update public.profiles set skill_level = 'advanced'
 where id = 'dddddddd-0000-0000-0000-000000000004';
update public.profiles set mute_need_a_fourth = true
 where id in ('eeeeeeee-0000-0000-0000-000000000005',
              '99999999-0000-0000-0000-000000000008',
              '99999999-0000-0000-0000-000000000009');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 starts in 5 days — outside the 48-hour window.
-- E2 starts in 30 hours — inside the window, narrow stage.
-- E3 starts in 6 hours — inside the window, wide stage.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next week',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '5 days', now() + interval '5 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tomorrow night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '30 hours', now() + interval '33 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tonight',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '6 hours', now() + interval '9 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Every table is beginner, capacity 4, so tier matching is the only thing
-- that varies between the stages.
insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  -- A second table at E2, genuinely two of four (holly, ivy): it must
  -- never be called, and it is what "needs two" means in the last test.
  ('7ab1e000-0000-0000-0000-000000000004',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'mixed', 4, 2);

/*
 * Three seats taken at E1 and E2's "Table 1": alice, dan, grace.
 * Three seats taken at E3's "Table 1": alice, holly, grace -- dan sits
 * this one out so he is free to prove beginner/advanced are NOT adjacent
 * even at the wide stage.
 * Two seats taken at E2's "Table 2": holly, ivy.
 *
 * Written as explicit rows rather than the brief's cross-join generator:
 * that generator's group-id expression, `'9909aaaa-...-00000000000' ||
 * t.position || t.seq`, concatenates two extra digits onto an
 * already-12-character last segment, producing a 13-character group and an
 * invalid uuid literal that fails to cast before a single assertion runs.
 */
insert into public.booking_groups (id, event_id, club_id, created_by,
                                    preferred_table_id) values
  ('99000001-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002'),
  ('99000001-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003'),
  ('99000001-0000-0000-0000-000000000004',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000004');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('99000001-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000007',
   'aaaaaaaa-0000-0000-0000-000000000001'),

  ('99000001-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000007',
   'aaaaaaaa-0000-0000-0000-000000000001'),

  ('99000001-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   '99999999-0000-0000-0000-000000000008',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   '99999999-0000-0000-0000-000000000007',
   'aaaaaaaa-0000-0000-0000-000000000001'),

  ('99000001-0000-0000-0000-000000000004',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000004',
   '99999999-0000-0000-0000-000000000008',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99000001-0000-0000-0000-000000000004',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000004',
   '99999999-0000-0000-0000-000000000009',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Qualification.
-- ---------------------------------------------------------------------
select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000004'),
  null,
  'a table at two of four is not calling for anybody');

select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000002'),
  'tier',
  'a table at three of four, more than 12 hours out, calls its own tier');

select is(
  public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  'wide',
  'inside 12 hours the call widens');

select is(
  (select count(*)::int from public.tables_needing_a_fourth()
    where event_table_id = '7ab1e000-0000-0000-0000-000000000001'),
  0,
  'a game five days out is outside the announcement window');

-- ---------------------------------------------------------------------
-- Who hears about it.
-- ---------------------------------------------------------------------
select is(public.announce_need_a_fourth(), 2,
  'the two games inside the window are announced');

-- E2 is the narrow stage on a BEGINNER table. Carol is a beginner and free:
-- she hears. Bob is intermediate: he does not. Fred has no level: he does
-- not. Erin is a beginner and free too, but muted. Alice, dan and grace are
-- already sitting there.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1,
  'the narrow stage reaches exactly the matching tier');
select is(
  (select recipient_id from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  'cccccccc-0000-0000-0000-000000000003'::uuid,
  'and that is the free beginner, not the muted one and not a player');

-- E3 is the wide stage. Carol (beginner), Bob (intermediate, adjacent) and
-- Fred (no level) all hear. Dan is free here too -- advanced is NOT
-- adjacent to beginner even at the wide stage, so he must not. Erin is
-- still muted.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'),
  3,
  'the wide stage reaches adjacent tiers and the unclassified, not advanced');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  0,
  'a member who muted these alerts is never told, at either stage');

-- ---------------------------------------------------------------------
-- Idempotency: the job runs every 15 minutes.
-- ---------------------------------------------------------------------
select is(public.announce_need_a_fourth(), 2,
  'running again still reports the two tables');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'),
  4,
  'but writes nobody a second copy');

-- ---------------------------------------------------------------------
-- Widening: the stage is part of the dedupe key.
--
-- E2's table already carries a 'tier' dedupe row for carol, from the run
-- above. As game time gets closer that same table moves to 'wide' -- and
-- if the dedupe key did not carry the stage, that widened call would be
-- silently swallowed by the narrow stage's row (carol) or, worse, the
-- table's OWN id-only key would already be spent and nobody new (bob,
-- fred) would hear either. Calling announce_table_fourth directly with an
-- explicit stage isolates exactly that, without waiting for real time to
-- pass.
-- ---------------------------------------------------------------------
select is(
  public.announce_table_fourth(
    '7ab1e000-0000-0000-0000-000000000002', 'wide'),
  3,
  'a table moving from the narrow stage to the wide one announces again');

-- ---------------------------------------------------------------------
-- The host may call early, outside the window. A member may not.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'an ordinary member cannot summon the club');

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000001'),
  1,
  'the host may call for a fourth before the window opens');

select throws_ok(
  $$select public.call_for_a_fourth('7ab1e000-0000-0000-0000-000000000004')$$,
  '23514',
  null,
  'and cannot call for a fourth at a table that needs two');

select * from finish();
rollback;
