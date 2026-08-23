/*
 * The waitlist.
 *
 * Promotion runs INLINE, inside whichever transaction freed the seat —
 * cancel, decline, host removal, adding a table. `pg_cron` only expires
 * offers. A member watching the screen after a friend drops out is seated
 * immediately rather than up to five minutes later in front of a visibly
 * empty seat.
 *
 * Two rules are worth naming before reading the code:
 *
 *   1. A group skipped for not fitting keeps its waitlisted_at, and
 *      therefore its place. Nothing renumbers.
 *
 *   2. An outstanding offer HOLDS its seats (event_held_seats subtracts
 *      them), so the two hours a group has to answer are two hours nobody
 *      can take the seats out from under them.
 */

/*
 * The single placement rule, used by promotion here and by the booking
 * planner in the next migration.
 *
 * Returns NO ROWS rather than a partial answer when the request cannot be
 * satisfied. "The whole group or nobody" is a property of this function,
 * not a rule repeated by each caller.
 */
create function public.seat_assignments(
  target_event uuid,
  want         int,
  preferred    uuid,
  allow_split  boolean
)
returns table (event_table_id uuid, seats int)
language plpgsql
stable
set search_path = public
as $$
declare
  remaining int := want;
  single    uuid;
  ids       uuid[] := '{}';
  counts    int[]  := '{}';
  t         record;
  i         int;
begin
  if want is null or want <= 0 then
    return;
  end if;

  -- "Any table". Nobody is placed, by request, so allow_split has nothing
  -- to act on: a group nobody seats is trivially sitting together.
  if preferred is null then
    event_table_id := null;
    seats := want;
    return next;
    return;
  end if;

  -- Keep us together: one table has to hold all of us. Preferred first,
  -- then the rest in position order. Note this is NOT "the preferred table
  -- or nothing" — the request is togetherness, not that specific table.
  if not allow_split then
    select s.id into single from (
      select tt.id, (tt.id = preferred) as is_preferred, tt.position
      from public.event_tables tt
      where tt.event_id = target_event
        and public.table_free_seats(tt.id) >= want
      order by is_preferred desc, tt.position
    ) s limit 1;

    if single is null then
      return;
    end if;

    event_table_id := single;
    seats := want;
    return next;
    return;
  end if;

  for t in
    select tt.id, public.table_free_seats(tt.id) as room
    from public.event_tables tt
    where tt.event_id = target_event
    order by (tt.id = preferred) desc, tt.position
  loop
    exit when remaining <= 0;
    if t.room > 0 then
      ids    := ids || t.id;
      counts := counts || least(t.room, remaining);
      remaining := remaining - least(t.room, remaining);
    end if;
  end loop;

  -- Could not seat everybody. Emit nothing: a partial plan is not an
  -- answer to the question that was asked.
  if remaining > 0 then
    return;
  end if;

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    event_table_id := ids[i];
    seats := counts[i];
    return next;
  end loop;
end;
$$;

/*
 * Confirm up to `want` of a group's waitlisted bookings and place them.
 *
 * Returns how many were actually confirmed — 0 means the group could not
 * be satisfied and must keep waiting. The caller does not decide placement;
 * seat_assignments does.
 *
 * Order within the group is the booker first, then the order they were
 * added. Nobody has asked for the booker to choose who gets a partial fit;
 * if they do, that is an argument to accept_promotion_offer, not a
 * different rule here.
 */
create function public.confirm_group_seats(target_group uuid, want int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  a       record;
  b       record;
  taken   int := 0;
  filled  int;
begin
  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    return 0;
  end if;

  if not exists (
    select 1 from public.seat_assignments(
      g.event_id, want, g.preferred_table_id, g.allow_split))
  then
    return 0;
  end if;

  for a in
    select * from public.seat_assignments(
      g.event_id, want, g.preferred_table_id, g.allow_split)
  loop
    filled := 0;
    for b in
      select bk.id from public.bookings bk
      where bk.group_id = target_group and bk.status = 'waitlisted'
      order by (bk.profile_id = g.created_by) desc, bk.created_at, bk.id
      limit a.seats
    loop
      update public.bookings
         set status = 'confirmed', event_table_id = a.event_table_id
       where id = b.id;
      filled := filled + 1;
      taken  := taken + 1;
    end loop;
    exit when filled = 0;
  end loop;

  if taken = 0 then
    return 0;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select bk.profile_id, g.club_id, g.event_id, 'waitlist_promoted',
         jsonb_build_object('booking_id', bk.id,
                            'event_table_id', bk.event_table_id),
         'waitlist_promoted:' || bk.id::text
  from public.bookings bk
  where bk.group_id = target_group and bk.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  -- A group with nobody left in the queue is no longer a waiting group.
  if not exists (
    select 1 from public.bookings
    where group_id = target_group and status = 'waitlisted')
  then
    update public.booking_groups
       set status = 'confirmed', waitlisted_at = null
     where id = target_group;
  end if;

  return taken;
end;
$$;

/*
 * The walk. Called by every path that frees a seat, and by the sweep.
 *
 * The caller is expected to already hold `for update` on the event row.
 * Every granted function in this plan takes that lock as its first
 * statement; this one is never granted to authenticated.
 */
create function public.promote_waitlist(target_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        record;
  g         record;
  free      int;
  wanted    int;
  seated    int;
  new_offer uuid;
begin
  select id, status, starts_at, club_id into ev
  from public.events where id = target_event;

  -- A cancelled or already-started game promotes nobody. Without the
  -- second test an offer could be created with expires_at in the past.
  if ev.id is null or ev.status <> 'published' or ev.starts_at <= now() then
    return;
  end if;

  for g in
    select * from public.booking_groups
    where event_id = target_event and status = 'waitlisted'
    order by waitlisted_at, created_at, id
  loop
    free := public.event_free_seats(target_event);
    exit when free <= 0;

    -- A group already holding an offer is waiting on its own answer, not
    -- on us.
    continue when exists (
      select 1 from public.promotion_offers
      where group_id = g.id and responded_at is null);

    select count(*) into wanted from public.bookings
    where group_id = g.id and status = 'waitlisted';
    continue when wanted = 0;

    if free >= wanted then
      seated := public.confirm_group_seats(g.id, wanted);
      -- 0 means allow_split is off and no single table holds them all.
      -- The group keeps its waitlisted_at, and therefore its place.
      continue when seated = 0;
    elsif g.preferred_table_id is null or g.allow_split then
      insert into public.promotion_offers
        (group_id, event_id, offered_seat_count, expires_at)
      values (g.id, target_event, free,
              least(now() + interval '2 hours', ev.starts_at))
      returning id into new_offer;

      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (g.created_by, ev.club_id, target_event, 'promotion_offer',
              jsonb_build_object('offer_id', new_offer, 'seats', free),
              'promotion_offer:' || new_offer::text);
    end if;
    -- else: a group that asked to stay together at a table cannot be
    -- offered part of itself. Skipped, place retained.
  end loop;
end;
$$;

create function public.accept_promotion_offer(target_offer uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o      record;
  g      record;
  seated int;
begin
  select * into o from public.promotion_offers where id = target_offer;
  if o.id is null then
    raise exception 'no such offer' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = o.group_id;
  if g.created_by <> auth.uid() then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  perform 1 from public.events where id = o.event_id for update;

  -- Re-read under the lock: the sweep may have expired it in between.
  select * into o from public.promotion_offers where id = target_offer;
  if o.responded_at is not null or o.expires_at <= now() then
    raise exception 'offer expired' using errcode = '23514';
  end if;

  -- Release the hold FIRST, so the seats this group was holding are
  -- available to itself.
  update public.promotion_offers
     set responded_at = now(), outcome = 'accepted'
   where id = o.id;

  seated := public.confirm_group_seats(o.group_id, o.offered_seat_count);
  perform public.promote_waitlist(o.event_id);
  return seated;
end;
$$;

create function public.decline_promotion_offer(target_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  g record;
begin
  select * into o from public.promotion_offers where id = target_offer;
  if o.id is null then
    raise exception 'no such offer' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = o.group_id;
  if g.created_by <> auth.uid() then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  perform 1 from public.events where id = o.event_id for update;

  update public.promotion_offers
     set responded_at = now(), outcome = 'declined'
   where id = o.id and responded_at is null;

  perform public.promote_waitlist(o.event_id);
end;
$$;

/*
 * Every five minutes. The ONLY thing the schedule is responsible for:
 * everything else promotes inline.
 */
create function public.sweep_promotion_offers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o     record;
  swept int := 0;
begin
  for o in
    select po.id, po.group_id, po.event_id, bg.created_by, bg.club_id
    from public.promotion_offers po
    join public.booking_groups bg on bg.id = po.group_id
    where po.responded_at is null and po.expires_at <= now()
    order by po.expires_at
  loop
    perform 1 from public.events where id = o.event_id for update;

    update public.promotion_offers
       set responded_at = now(), outcome = 'expired'
     where id = o.id and responded_at is null;

    if found then
      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (o.created_by, o.club_id, o.event_id, 'promotion_offer_expired',
              jsonb_build_object('offer_id', o.id),
              'promotion_offer_expired:' || o.id::text)
      on conflict (dedupe_key) do nothing;

      swept := swept + 1;
      perform public.promote_waitlist(o.event_id);
    end if;
  end loop;

  return swept;
end;
$$;

revoke execute on function public.seat_assignments(uuid, int, uuid, boolean)
  from public, anon;
revoke execute on function public.confirm_group_seats(uuid, int)
  from public, anon;
revoke execute on function public.promote_waitlist(uuid)      from public, anon;
revoke execute on function public.sweep_promotion_offers()    from public, anon;
revoke execute on function public.accept_promotion_offer(uuid)  from public, anon;
revoke execute on function public.decline_promotion_offer(uuid) from public, anon;

-- Only the two the client calls.
grant execute on function public.accept_promotion_offer(uuid)  to authenticated;
grant execute on function public.decline_promotion_offer(uuid) to authenticated;
