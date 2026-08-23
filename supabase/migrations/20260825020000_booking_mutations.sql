/*
 * Booking a seat.
 *
 * propose_booking reads and returns a plan. commit_booking takes THE SAME
 * ARGUMENTS — not the plan — re-derives it under the event lock, and
 * writes it atomically. There is no proposal token to go stale, to replay,
 * or to forge, and the client compares what came back against what it
 * showed the member.
 *
 * Skill tiers are NOT checked here and must not be. The client warns and
 * the member decides; these functions are a capacity-and-atomicity
 * concern. The fixture asserts a beginner can take an advanced table's
 * seat precisely so that this stays true.
 */

create function public.assert_event_bookable(target_event uuid)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  ev record;
begin
  select id, club_id, status, starts_at into ev
  from public.events where id = target_event;

  if ev.id is null then
    raise exception 'no such event' using errcode = '42501';
  end if;
  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  return ev.club_id;
end;
$$;

/*
 * `detail` carries the profile id the refusal is about, so the client can
 * name the person from the roster it already holds. PostgREST surfaces it
 * as `details` alongside `message`.
 */
create function public.assert_players_bookable(
  target_club  uuid,
  target_event uuid,
  players      uuid[]
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  p uuid;
begin
  if coalesce(array_length(players, 1), 0) = 0 then
    raise exception 'no players' using errcode = '23514';
  end if;

  if array_length(players, 1) <>
     (select count(distinct x)::int from unnest(players) x) then
    raise exception 'duplicate player' using errcode = '23514';
  end if;

  foreach p in array players loop
    if not exists (
      select 1 from public.club_members
      where club_id = target_club and profile_id = p and status = 'active')
    then
      raise exception 'not a member'
        using errcode = '23514', detail = p::text;
    end if;

    if exists (
      select 1 from public.bookings
      where event_id = target_event and profile_id = p
        and status in ('confirmed', 'waitlisted'))
    then
      raise exception 'already booked'
        using errcode = '23514', detail = p::text;
    end if;
  end loop;
end;
$$;

/*
 * The plan. Read-only, and the only place that turns "these people, this
 * table, this split preference" into placements.
 */
create function public.plan_seating(
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

  -- Admission is an EVENT-level question. No group is ever half-admitted
  -- at commit time; a group too big for the room waits as one.
  if public.event_free_seats(target_event) < n then
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

/*
 * What actually happened, read back from the rows rather than echoed from
 * the plan. The client compares this against what it displayed.
 *
 * waitlist_position uses the same ordering promote_waitlist walks, so a
 * member is never told "2nd" by one function and promoted third by
 * another.
 */
create function public.booking_result(target_group uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id,
    'outcome', case when g.status = 'waitlisted' then 'waitlisted'
                    else 'seated' end,
    'split', (
      select count(distinct b.event_table_id) > 1
      from public.bookings b
      where b.group_id = g.id and b.status = 'confirmed'
        and b.event_table_id is not null),
    'waitlist_position', case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    'offer', (
      select jsonb_build_object('id', po.id, 'seats', po.offered_seat_count,
                                'expires_at', po.expires_at)
      from public.promotion_offers po
      where po.group_id = g.id and po.responded_at is null),
    'placements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', b.profile_id,
        'event_table_id', b.event_table_id,
        'table_label', t.label) order by b.created_at, b.id)
      from public.bookings b
      left join public.event_tables t on t.id = b.event_table_id
      where b.group_id = g.id and b.status in ('confirmed', 'waitlisted')
    ), '[]'::jsonb))
  from public.booking_groups g where g.id = target_group;
$$;

/*
 * Read-only, and deliberately takes no lock: it is advice, not a
 * reservation. commit_booking re-derives everything under the lock.
 */
create function public.propose_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_club uuid;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  return public.plan_seating(target_event, players, preferred, allow_split)
       || jsonb_build_object('group_id', null,
                             'waitlist_position', null,
                             'offer', null);
end;
$$;

create function public.commit_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club uuid;
  seating     jsonb;
  new_group   uuid;
  placement   jsonb;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  -- Everything after this line is inside the event's lock. Two members
  -- racing for the last seat serialize here, which is what makes the
  -- race impossible rather than unlikely.
  perform 1 from public.events where id = target_event for update;

  perform public.assert_players_bookable(target_club, target_event, players);

  seating := public.plan_seating(target_event, players, preferred, allow_split);

  insert into public.booking_groups
    (event_id, club_id, created_by, preferred_table_id, allow_split,
     status, waitlisted_at)
  values (
    target_event, target_club, auth.uid(), preferred, allow_split,
    case when seating->>'outcome' = 'seated' then 'confirmed'::public.booking_group_status
         else 'waitlisted'::public.booking_group_status end,
    case when seating->>'outcome' = 'seated' then null else now() end)
  returning id into new_group;

  if seating->>'outcome' = 'seated' then
    for placement in select * from jsonb_array_elements(seating->'placements')
    loop
      insert into public.bookings
        (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
      values (new_group, target_event, target_club,
              (placement->>'event_table_id')::uuid,
              (placement->>'profile_id')::uuid,
              auth.uid());
    end loop;
  else
    insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by, status)
    select new_group, target_event, target_club, p, auth.uid(), 'waitlisted'
    from unnest(players) p;
  end if;

  -- Securing the seats is the whole point of booking for a friend; the
  -- message is what gives the person actually attending a way out that
  -- does not involve texting the booker.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booked_by_friend',
         jsonb_build_object('booking_id', b.id, 'booked_by', auth.uid()),
         'booked_by_friend:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.profile_id <> auth.uid();

  -- A group can be waitlisted with seats still free — it was simply too
  -- big for them, or asked to stay together. Walking the queue now is
  -- what turns that into an offer immediately instead of in five minutes.
  if seating->>'outcome' <> 'seated' then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.assert_event_bookable(uuid) from public, anon;
revoke execute on function public.assert_players_bookable(uuid, uuid, uuid[])
  from public, anon;
revoke execute on function public.plan_seating(uuid, uuid[], uuid, boolean)
  from public, anon;
revoke execute on function public.booking_result(uuid) from public, anon;
revoke execute on function public.propose_booking(uuid, uuid[], uuid, boolean)
  from public, anon;
revoke execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  from public, anon;

grant execute on function public.propose_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
grant execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
-- booking_result is read back by the two functions above and by the data
-- layer after a cancellation, so the client needs it.
grant execute on function public.booking_result(uuid) to authenticated;
