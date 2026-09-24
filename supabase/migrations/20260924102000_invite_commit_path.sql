/*
 * Game invites, commit path: every member a sender adds to a game other
 * than themselves is INVITED, not booked
 * (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md).
 * The invite is a bookings row with status 'invited' in the sender's
 * group, booked_by = the sender.
 *
 *   invite_holds_seat = true   the planner seated them; the seat is held
 *                              (counted by the capacity family,
 *                              20260924101000) until they answer, the
 *                              sender or an organizer withdraws, or the
 *                              game starts.
 *   invite_holds_seat = false  the game was full when sent; accepting joins
 *                              the waitlist at the back, as of accepting.
 *
 * Every body below is the latest definition copied verbatim (source named
 * per function) with only the invite change applied. `create or replace`
 * keeps each ACL; it is restated anyway, per the house rule, matching the
 * latest ACL of each function (the internal helpers stay revoked from
 * authenticated, per 20260825061000).
 */

-- ---------------------------------------------------------------------
-- assert_players_bookable (from 20260825020000): an invited row is an
-- active row. A member already booked, waitlisted OR invited cannot be
-- invited again. Distinct message so the client can say "already
-- invited" rather than "already has a seat".
-- ---------------------------------------------------------------------
create or replace function public.assert_players_bookable(
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

    if exists (
      select 1 from public.bookings
      where event_id = target_event and profile_id = p
        and status = 'invited')
    then
      raise exception 'already invited'
        using errcode = '23514', detail = p::text;
    end if;
  end loop;
end;
$$;

revoke execute on function public.assert_players_bookable(uuid, uuid, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- close_group_if_empty (from 20260825030000). Two changes:
--   1. a pending invite keeps a group alive (rules.md, spec table);
--   2. a group left 'waitlisted' with NO waitlisted row (its only waiting
--      member -- typically the sender -- left, but invites are still
--      pending) is no longer a waiting group: promote_waitlist would skip
--      it forever (`continue when wanted = 0`) while it still occupies a
--      place in every waitlist_position count. It becomes 'confirmed'
--      (a container of invites), and any offer it held is resolved.
-- ---------------------------------------------------------------------
create or replace function public.close_group_if_empty(target_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where group_id = target_group
      and status in ('confirmed', 'waitlisted', 'invited'))
  then
    -- A group with no live bookings must not stay 'confirmed' or
    -- 'waitlisted': promote_waitlist would keep considering a group that
    -- no longer exists.
    update public.booking_groups
       set status = 'cancelled', waitlisted_at = null
     where id = target_group and status <> 'cancelled';

    update public.promotion_offers
       set responded_at = now(), outcome = 'declined'
     where group_id = target_group and responded_at is null;
  elsif not exists (
    select 1 from public.bookings
    where group_id = target_group and status = 'waitlisted')
  then
    update public.booking_groups
       set status = 'confirmed', waitlisted_at = null
     where id = target_group and status = 'waitlisted';

    if found then
      update public.promotion_offers
         set responded_at = now(), outcome = 'declined'
       where group_id = target_group and responded_at is null;
    end if;
  end if;
end;
$$;

revoke execute on function public.close_group_if_empty(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- booking_result (from 20260825020000). Top-level keys are UNCHANGED
-- (lib/schema-contract.test.ts asserts the exact key set). Changes:
--   - placements include invited rows, each placement gains a 'status'
--     key (additive; the contract test uses toMatchObject per element);
--   - 'split' counts held seats as seats;
--   - a non-waitlisted group with no seat at all (nothing confirmed,
--     nothing held) and a table-less invite reports 'waitlisted' -- the
--     sender-not-playing, game-full case, which is what propose_booking
--     showed them. waitlist_position stays null for it: nobody in it is
--     in the queue yet.
-- ---------------------------------------------------------------------
create or replace function public.booking_result(target_group uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id,
    'outcome', case
      when g.status = 'waitlisted' then 'waitlisted'
      when g.status = 'cancelled' then 'cancelled'
      when not exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and (b.status = 'confirmed'
                    or (b.status = 'invited' and b.invite_holds_seat)))
       and exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and b.status = 'invited' and not b.invite_holds_seat)
        then 'waitlisted'
      else 'seated' end,
    'split', (
      select count(distinct b.event_table_id) > 1
      from public.bookings b
      where b.group_id = g.id
        and (b.status = 'confirmed'
             or (b.status = 'invited' and b.invite_holds_seat))
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
        'table_label', t.label,
        'status', b.status) order by b.created_at, b.id)
      from public.bookings b
      left join public.event_tables t on t.id = b.event_table_id
      where b.group_id = g.id
        and b.status in ('confirmed', 'waitlisted', 'invited')
    ), '[]'::jsonb))
  from public.booking_groups g where g.id = target_group;
$$;

revoke execute on function public.booking_result(uuid) from public, anon;
grant execute on function public.booking_result(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- commit_booking (from 20260905090000). The sender (caller), if among
-- `players`, is booked exactly as before. Everyone else is INVITED in the
-- same group:
--   outcome 'seated'     -> invited, invite_holds_seat = true, at the
--                           planner's table (null = an "any table" hold).
--   outcome 'waitlisted' -> invited, invite_holds_seat = false, no table.
-- The group is 'waitlisted' only when the sender's own row is -- a group
-- of nothing but table-less invites waits for no one, and would otherwise
-- sit in the queue as a ghost promote_waitlist skips forever.
-- booking_invited replaces booked_by_friend on this path.
-- ---------------------------------------------------------------------
create or replace function public.commit_booking(
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
  caller       uuid := auth.uid();
  target_club  uuid;
  mode         public.game_mode;
  seating      jsonb;
  seated       boolean;
  sender_waits boolean;
  new_group    uuid;
  placement    jsonb;
  pid          uuid;
begin
  -- Bound and refused up front, as cancel_booking/decline_booking do.
  -- is_club_member below would refuse a null caller too, but only by
  -- accident of `profile_id = null` matching nothing.
  if caller is null then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  -- Everything after this line is inside the event's lock. Two members
  -- racing for the last seat serialize here, which is what makes the
  -- race impossible rather than unlikely.
  perform 1 from public.events where id = target_event for update;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  seating := public.plan_seating(target_event, players, preferred, allow_split);
  seated := seating->>'outcome' = 'seated';
  sender_waits := not seated and caller = any(players);

  insert into public.booking_groups
    (event_id, club_id, created_by, preferred_table_id, allow_split,
     status, waitlisted_at)
  values (
    target_event, target_club, caller, preferred, allow_split,
    case when sender_waits then 'waitlisted'::public.booking_group_status
         else 'confirmed'::public.booking_group_status end,
    case when sender_waits then now() else null end)
  returning id into new_group;

  if seated then
    for placement in select * from jsonb_array_elements(seating->'placements')
    loop
      pid := (placement->>'profile_id')::uuid;
      if pid = caller then
        insert into public.bookings
          (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
        values (new_group, target_event, target_club,
                (placement->>'event_table_id')::uuid, caller, caller);
      else
        insert into public.bookings
          (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
           status, invite_holds_seat)
        values (new_group, target_event, target_club,
                (placement->>'event_table_id')::uuid, pid, caller,
                'invited', true);
      end if;
    end loop;
  else
    insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by, status,
       invite_holds_seat)
    select new_group, target_event, target_club, p, caller,
           case when p = caller then 'waitlisted'::public.booking_status
                else 'invited'::public.booking_status end,
           case when p = caller then null else false end
    from unnest(players) p;
  end if;

  -- The invite is the message: nobody is committed to a game they have
  -- not said yes to, and this is how they find out there is a yes to say.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booking_invited',
         jsonb_build_object('booking_id', b.id,
                            'booked_by', caller,
                            'holds_seat', b.invite_holds_seat,
                            'event_table_id', b.event_table_id),
         'booking_invited:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.status = 'invited'
  on conflict (dedupe_key) do nothing;

  -- A group can be waitlisted with seats still free — it was simply too
  -- big for them, or asked to stay together. Walking the queue now is
  -- what turns that into an offer (or, for a sender now waiting alone, a
  -- seat) immediately instead of in five minutes.
  if not seated then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  from public, anon;
grant execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
