/*
 * Recording who won a hand.
 *
 * assert_round_writable is the one ladder rung both record_round and
 * delete_round would otherwise duplicate for TENANCY AND GAME STATE --
 * delete_round deliberately does NOT call it, though: Decision 5/spec
 * "Risks" note that delete carries no live-game requirement at all, on
 * purpose (an organizer fixing a mis-recorded round after the fact is
 * legitimate; there is no "the game must still be happening" reason to
 * refuse it the way there is for a fresh recording).
 */
create function public.assert_round_writable(target_table uuid)
returns public.event_tables
language plpgsql
stable
set search_path = public
as $$
declare
  tbl public.event_tables;
  ev  public.events;
begin
  select * into tbl from public.event_tables where id = target_table;

  -- Tenancy first, folded into the same raise as "does not exist" -- an
  -- outsider holding a guessed uuid learns nothing more than a stranger
  -- guessing at random. Same shape assert_event_bookable and
  -- assert_attendance_writable already use.
  if tbl.id is null or not public.is_club_member(tbl.club_id) then
    raise exception 'no such table' using errcode = '42501';
  end if;

  select * into ev from public.events where id = tbl.event_id;

  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;

  -- The opposite of plan 4's booking freeze on purpose: a round belongs to
  -- the session that is actually happening, not to a game that has not
  -- started or one being rewritten after the fact.
  if ev.starts_at > now() then
    raise exception 'this game has not started yet' using errcode = '23514';
  end if;

  if ev.ends_at <= now() then
    raise exception 'this game has already ended' using errcode = '23514';
  end if;

  return tbl;
end;
$$;

revoke execute on function public.assert_round_writable(uuid)
  from public, anon, authenticated;

create function public.record_round(
  target_table   uuid,
  winner_profile uuid,
  target_points  int
)
returns public.table_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  tbl       public.event_tables;
  caller    uuid := auth.uid();
  organizer boolean;
  round     public.table_rounds;
begin
  tbl := public.assert_round_writable(target_table);
  organizer := public.is_club_organizer(tbl.club_id);

  -- Either role, never neither -- neither role alone is reliably the one
  -- holding the phone at a casual table.
  if not organizer and not exists (
    select 1 from public.bookings b
     where b.event_table_id = target_table
       and b.profile_id = caller
       and b.status = 'confirmed')
  then
    raise exception 'only an organizer or a player at this table can record a round'
      using errcode = '42501';
  end if;

  -- The winner has to be seated at THIS table right now -- re-derived from
  -- bookings, never trusted from the client, the same "ask the current
  -- state" pattern place_booking uses for its own seat checks.
  if not exists (
    select 1 from public.bookings b
     where b.event_table_id = target_table
       and b.profile_id = winner_profile
       and b.status = 'confirmed')
  then
    raise exception 'the winner is not seated at this table' using errcode = '23514';
  end if;

  -- Belt-and-suspenders alongside table_rounds' own check constraint --
  -- the constraint is what actually stops a bad row; this raises the
  -- friendlier, mapped message.
  if target_points <= 0 then
    raise exception 'points must be greater than zero' using errcode = '23514';
  end if;

  insert into public.table_rounds
    (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
  values
    (target_table, tbl.event_id, tbl.club_id, winner_profile, target_points, caller)
  returning * into round;

  return round;
end;
$$;

create function public.delete_round(target_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rnd public.table_rounds;
begin
  select * into rnd from public.table_rounds where id = target_round;

  if rnd.id is null or not public.is_club_member(rnd.club_id) then
    raise exception 'no such round' using errcode = '42501';
  end if;

  -- Organizer only -- not the round's own recorder. There is no
  -- self-correction case here: a player recording someone else's round has
  -- nothing of "their own" to undo, and giving every recorder delete
  -- rights over a shared, everybody-can-see-it log invites exactly the
  -- dispute the spec avoids by not offering edit at all.
  perform public.assert_club_organizer(rnd.club_id);

  delete from public.table_rounds where id = target_round;
end;
$$;

revoke execute on function public.record_round(uuid, uuid, int)
  from public, anon;
grant execute on function public.record_round(uuid, uuid, int)
  to authenticated;

revoke execute on function public.delete_round(uuid) from public, anon;
grant execute on function public.delete_round(uuid) to authenticated;
