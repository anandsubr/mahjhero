begin;
set local search_path to extensions, public;

select plan(6);

select has_table('public', 'archived_messages', 'archived_messages exists');

select ok(
  not has_table_privilege('authenticated', 'public.archived_messages', 'SELECT'),
  'authenticated cannot read archived_messages'
);

select ok(
  not has_table_privilege('authenticated', 'public.archived_messages', 'TRUNCATE'),
  'authenticated cannot TRUNCATE archived_messages'
);

/*
 * ⚠️ READ THIS BEFORE TRUSTING THE NEXT THREE ASSERTIONS.
 *
 * Every fixture in this suite runs in a transaction that ROLLS BACK, so the
 * local `messages` table is EMPTY when the archive migration runs against
 * it. All three assertions below therefore count zero rows out of zero rows
 * and pass VACUOUSLY. They are a regression tripwire for a future migration
 * that reintroduces free-floating club chat — not evidence that the archive
 * transformed anything correctly.
 *
 * The archive's real verification is Task 13 Step 6: the hosted push,
 * performed under the owner's eye, where `select count(*) from
 * archived_messages` is checked against what left `messages`. That gap is
 * accepted deliberately (see the plan's pre-flight adjudications); do not
 * "fix" it by weakening these assertions further or by claiming coverage
 * they do not have.
 */
select is(
  (select count(*)::int
     from public.messages m
     join public.message_threads t on t.id = m.thread_id
    where t.club_id is not null and t.event_id is null
      and m.root_id is null
      and not m.is_announcement),
  0,
  'tripwire: no free-floating club chat exists in any club thread (vacuous locally — see the note above)'
);

-- Also vacuous on an empty local table, and kept for the same tripwire
-- reason: a future migration that writes reply_count without writing the
-- replies would trip it the moment any fixture seeds a root.
select is(
  (select count(*)::int
     from public.messages a
    where a.root_id is null
      and a.reply_count <> (select count(*)::int from public.messages r
                             where r.root_id = a.id)),
  0,
  'tripwire: every root''s reply_count matches its actual replies (vacuous locally — see the note above)'
);

-- Vacuous for the same reason, and the tripwire for the same reason. The
-- comparison is against m.root_id RAW: a root's root_id is null and no post
-- is ever null, so a root holding a quote at all trips this too — both
-- halves of 20260830011000's rule, which lives in plpgsql with no CHECK
-- behind it and so cannot stop a future migration from writing such a row.
select is(
  (select count(*)::int
     from public.messages m
     join public.message_threads t on t.id = m.thread_id
     join public.messages q on q.id = m.reply_to_id
    where t.club_id is not null and t.event_id is null
      and coalesce(q.root_id, q.id) is distinct from m.root_id),
  0,
  'tripwire: no club-thread message quotes outside its own post (vacuous locally — see the note above)'
);

select * from finish();
rollback;
