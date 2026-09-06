/*
 * Capacity stops being derived-only.
 *
 * Until now capacity was always sum(event_tables.capacity), which is exactly
 * why a tableless event was unreachable: zero tables meant zero capacity, and
 * plan_seating's gate waitlisted everybody. An open-seating event carries its
 * own headcount instead, and may carry none at all.
 *
 * "Uncapped" is a SEPARATE PREDICATE, not a magic value. Returning null from
 * event_free_seats to mean unbounded would have worked only because SQL's
 * `null < n` is null and therefore not-true — correct by accident, unreadable,
 * and it would silently change the meaning of the function for every other
 * caller. A large sentinel integer can be confused with a real number in
 * arithmetic. So: event_free_seats keeps its integer contract untouched, and
 * plan_seating asks event_is_capped first.
 */
create or replace function public.event_capacity(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when e.seating_mode = 'open_seating' then coalesce(e.capacity, 0)
    else coalesce(
      (select sum(t.capacity)::int from public.event_tables t
        where t.event_id = e.id), 0)
  end
  from public.events e
  where e.id = target_event;
$$;

/*
 * coalesce(..., true): a target_event that does not exist yields no row and
 * therefore null, and the safe reading of "I cannot tell" is "capped" — that
 * routes an unknown event through the normal capacity gate rather than
 * admitting an unbounded number of people to it.
 */
create function public.event_is_capped(target_event uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select not (e.seating_mode = 'open_seating' and e.capacity is null)
       from public.events e where e.id = target_event),
    true);
$$;

-- Internal, like every other member of the capacity family
-- (20260825000000, 20260825061000): granted to nobody. Handing this to
-- authenticated would be an occupancy oracle for a club they are not in.
revoke execute on function public.event_is_capped(uuid)
  from public, anon, authenticated;

-- event_capacity's ACL is restated after create or replace, per the house
-- rule; it stays revoked from authenticated too.
revoke execute on function public.event_capacity(uuid)
  from public, anon, authenticated;

/*
 * The plan. Read-only, and the only place that turns "these people, this
 * table, this split preference" into placements.
 *
 * Body copied verbatim from 20260825020000_booking_mutations.sql except the
 * capacity gate immediately below, which now short-circuits for uncapped
 * events — event_is_capped is checked first so event_free_seats (whose
 * integer contract is unchanged) is never even consulted for them.
 */
create or replace function public.plan_seating(
  target_event uuid,
  players      uuid[],
  preferred    uuid,
  allow_split  boolean
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  n          int := coalesce(array_length(players, 1), 0);
  a          record;
  i          int;
  idx        int := 1;
  placements jsonb := '[]'::jsonb;
begin
  if n = 0 then
    raise exception 'no players' using errcode = '23514';
  end if;

  -- `preferred` is only ever used as an ORDER BY tiebreak inside
  -- seat_assignments, never checked against target_event, so a foreign or
  -- deleted table id silently degraded to plain position order instead of
  -- being refused. That let propose_booking answer "seated" for a table
  -- that does not exist, with commit_booking then failing on
  -- booking_groups' composite FK as a raw, unmessaged 23503 -- reachable
  -- for real, since remove_event_table hard-deletes a table a member may
  -- already be looking at.
  if preferred is not null and not exists (
    select 1 from public.event_tables
    where id = preferred and event_id = target_event)
  then
    raise exception 'no such table' using errcode = '23514';
  end if;

  -- Admission is an EVENT-level question. No group is ever half-admitted
  -- at commit time; a group too big for the room waits as one. An uncapped
  -- event has no room to be too big for, so its capacity check is skipped
  -- entirely rather than consulting event_free_seats.
  if public.event_is_capped(target_event)
     and public.event_free_seats(target_event) < n then
    return jsonb_build_object(
      'outcome', 'waitlisted', 'split', false,
      'placements', '[]'::jsonb);
  end if;

  if not exists (
    select 1 from public.seat_assignments(
      target_event, n, preferred, allow_split))
  then
    -- Room in the game, but not in the shape this group asked for.
    return jsonb_build_object(
      'outcome', 'waitlisted', 'split', false,
      'placements', '[]'::jsonb);
  end if;

  for a in
    select * from public.seat_assignments(
      target_event, n, preferred, allow_split)
  loop
    for i in 1 .. a.seats loop
      placements := placements || jsonb_build_array(jsonb_build_object(
        'profile_id', players[idx],
        'event_table_id', a.event_table_id,
        'table_label', (select label from public.event_tables
                         where id = a.event_table_id)));
      idx := idx + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'outcome', 'seated',
    'split', (select count(distinct (p->>'event_table_id')) > 1
              from jsonb_array_elements(placements) p),
    'placements', placements);
end;
$$;

revoke execute on function
  public.plan_seating(uuid, uuid[], uuid, boolean)
  from public, anon, authenticated;
