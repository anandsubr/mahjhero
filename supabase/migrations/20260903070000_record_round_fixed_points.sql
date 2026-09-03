/*
 * Points become a fixed set: 25, 30, 35, 40, 45, 50, 75 -- the club's real
 * scoring values, not an arbitrary positive integer. Confirmed during the
 * 2026-09-03 game-screen-cleanup brainstorm as a hard rule, enforced here
 * (not just as a UI convenience) so a direct RPC call cannot record a score
 * this club's own rules do not recognise.
 *
 * Both halves of the belt-and-suspenders pair record_round already had for
 * "points > 0" move together: the RPC's own explicit raise (the friendly,
 * mapped message) and table_rounds' check constraint (the actual backstop).
 */
create or replace function public.record_round(
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
  if target_points is null or target_points not in (25, 30, 35, 40, 45, 50, 75) then
    raise exception 'points must be 25, 30, 35, 40, 45, 50, or 75'
      using errcode = '23514';
  end if;

  insert into public.table_rounds
    (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
  values
    (target_table, tbl.event_id, tbl.club_id, winner_profile, target_points, caller)
  returning * into round;

  return round;
end;
$$;

-- The RPC's own raise above is the friendly message; this is the actual
-- backstop, matching the fixed set exactly. Name confirmed against the
-- live hosted schema (`select conname from pg_constraint where conrelid =
-- 'public.table_rounds'::regclass and contype = 'c'`).
alter table public.table_rounds
  drop constraint table_rounds_points_check,
  add constraint table_rounds_points_check check (points in (25, 30, 35, 40, 45, 50, 75));
