/*
 * Plan 3 wrote these three functions and left a hole in each, marked in
 * its own comments as "a plan 4 problem that cannot be designed correctly
 * while bookings do not exist". Bookings exist now.
 *
 * remove_event_table DELETES the table row, which — now that bookings
 * carry a composite foreign key to (id, event_id) — raises 23503 the
 * moment anybody is sitting there. The rule is UNSEAT, NEVER DESTROY: the
 * bookings become event_table_id = null, which is the "any table" state
 * the schema already has, so nobody is silently ejected from a game they
 * were coming to.
 *
 * cancel_event set a status and stopped. It now voids the bookings too.
 * Nothing un-cancels, exactly as in plan 3.
 */

create or replace function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  owning_event uuid;
  event_status public.event_status;
  remaining    int;
begin
  select t.club_id, t.event_id, e.status
  into owning_club, owning_event, event_status
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  perform 1 from public.events where id = owning_event for update;

  with locked as (
    select id from public.event_tables
    where event_id = owning_event
    for update
  )
  select count(*) into remaining from locked;

  if remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  -- Unseat before deleting. These people are still coming; they just have
  -- nowhere to sit until the host places them.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, b.club_id, b.event_id, 'unseated',
         jsonb_build_object('booking_id', b.id,
                            'event_table_id', target_table),
         'unseated:' || b.id::text || ':' || target_table::text
  from public.bookings b
  where b.event_table_id = target_table and b.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  update public.bookings
     set event_table_id = null
   where event_table_id = target_table;

  -- Explicit, not load-bearing: 20260825041000 scopes booking_groups' composite
  -- FK to event_tables so its ON DELETE SET NULL only ever touches
  -- preferred_table_id, never event_id, so the DELETE below would leave
  -- this column correctly nulled on its own. Kept anyway so the effect is
  -- visible right here, before promote_waitlist reads booking_groups a few
  -- lines down, rather than asking a reader to know which ON DELETE action
  -- a constraint two migrations away performs.
  update public.booking_groups
     set preferred_table_id = null
   where preferred_table_id = target_table;

  delete from public.event_tables where id = target_table;

  -- Capacity just dropped; nobody new can be promoted into it. The call
  -- is here anyway because a group that wanted THIS table may now fit
  -- somewhere else, and because leaving it out would make "every path
  -- that changes capacity promotes" a rule with an exception.
  perform public.promote_waitlist(owning_event);

  return true;
end;
$$;

create or replace function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  bk          record;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  perform 1 from public.events where id = target_event for update;

  update public.events set status = 'cancelled' where id = target_event;

  for bk in
    select * from public.bookings
    where event_id = target_event and status in ('confirmed', 'waitlisted')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = auth.uid()
     where id = bk.id;

    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, target_event, 'event_cancelled',
            jsonb_build_object('booking_id', bk.id),
            'event_cancelled:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end loop;

  update public.promotion_offers
     set responded_at = now(), outcome = 'expired'
   where event_id = target_event and responded_at is null;

  update public.booking_groups
     set status = 'cancelled', waitlisted_at = null
   where event_id = target_event and status <> 'cancelled';

  -- No promote_waitlist call: a cancelled game has nobody to promote, and
  -- promote_waitlist returns immediately on a non-published event anyway.
  return true;
end;
$$;

/*
 * Based on the version 20260823020000 shipped (event_status guard,
 * live_count-based cap), NOT the brief's literal text for this function
 * -- that text reverted to 20260823010000's pre-fix body (no cancelled-
 * event guard, cap on next_pos rather than row count), which would have
 * regressed Minor 1 and Minor 4 the moment this ran. The only change here
 * is the one line the task actually asks for: promote_waitlist at the end.
 */
create or replace function public.add_event_table(target_event uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  event_status public.event_status;
  next_pos     int;
  live_count   int;
  new_id       uuid;
begin
  select club_id, status into owning_club, event_status
  from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  -- Read-then-insert over a *set* (max(position), count(*)), not a
  -- single-row read-modify-write -- a different race from update_event's.
  -- Two concurrent adds can compute the same next_pos, but (event_id,
  -- position) is already unique (20260822194000), so the loser gets a
  -- 23505 and can retry instead of silently colliding or losing data. That
  -- is an acceptable failure mode for an already-rare race, so this
  -- function is deliberately left without an explicit row lock.
  select coalesce(max(position), 0) + 1, count(*)
  into next_pos, live_count
  from public.event_tables where event_id = target_event;

  if live_count >= 20 then
    raise exception 'too many tables' using errcode = '23514';
  end if;

  insert into public.event_tables (event_id, club_id, label, position)
  values (target_event, owning_club, 'Table ' || next_pos, next_pos)
  returning id into new_id;

  -- New room, used immediately rather than in up to five minutes.
  perform public.promote_waitlist(target_event);

  return new_id;
end;
$$;
