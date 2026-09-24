/*
 * Game invites, reads and privacy (user decision P1, 2026-09-24).
 *
 * Open play: a pending invitee is shown by name to every member who can
 * see the game, the same as a confirmed player.
 *
 * Invite-only: another person's pending invite is visible only to the
 * club's organizers, its sender (booked_by) and its invitee -- enforced in
 * bookings_select_member below, not just in the UI. event_seating mirrors
 * it for the roster: anybody else who may see the roster gets the held
 * seat as an anonymous 'invited' row, so it still draws as taken.
 *
 * The invite-only roster now unlocks on "accepted and holding a seat"
 * (confirmed, with or without a table) instead of "placed at a table".
 * event_has_my_placed_seat keeps its name -- bookings_select_member,
 * booking_groups_select_member and the table_rounds policy all call it --
 * and takes the new meaning. Waitlisted and invited never unlock.
 */

-- ---------------------------------------------------------------------
-- A pending invite makes an invite-only game visible to its invitee.
-- events_select_member reaches bookings only through this function, so
-- this one list is the whole visibility change.
-- ---------------------------------------------------------------------
create or replace function public.event_has_my_active_booking(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and status in ('confirmed', 'waitlisted', 'invited')
  );
$$;

revoke execute on function public.event_has_my_active_booking(uuid) from public, anon;
grant execute on function public.event_has_my_active_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- "Accepted and holding a seat": a confirmed booking, table or not.
-- Formerly "confirmed or waitlisted AND placed at a table" (20260905080000).
-- ---------------------------------------------------------------------
create or replace function public.event_has_my_placed_seat(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and status = 'confirmed'
  );
$$;

comment on function public.event_has_my_placed_seat(uuid) is
  'True when the caller holds a CONFIRMED booking on the event, with or '
  'without a table: "accepted and holding a seat". Unlocks the invite-only '
  'roster (bookings, booking_groups, table_rounds, event_seating). '
  'Waitlisted and invited bookings never unlock. Name kept from '
  '20260905080000, when it meant "placed at a table".';

revoke execute on function public.event_has_my_placed_seat(uuid) from public, anon;
grant execute on function public.event_has_my_placed_seat(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- bookings_select_member: in open play every member reads every row (as
-- before). Otherwise an 'invited' row is readable by an organizer, its
-- invitee, or its sender -- never through the roster unlock -- while
-- every other row keeps its 20260905080000 rule.
-- ---------------------------------------------------------------------
drop policy bookings_select_member on public.bookings;

create policy bookings_select_member on public.bookings
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = bookings.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      or profile_id = auth.uid()
      or (status = 'invited' and booked_by = auth.uid())
      or (status <> 'invited'
          and public.event_has_my_placed_seat(bookings.event_id))
    )
  );

-- ---------------------------------------------------------------------
-- event_seating: invited rows too, plus invite_holds_seat (the app needs
-- it to tell a held "any table" invite from one that would join the
-- waitlist -- both have a null table). Drop + create: a new OUT column
-- changes the return type (42P13). No SQL object references it.
--
-- Visibility: open play, an organizer, or any active booking of the
-- caller's (invited included -- the invitee sees the game).
-- Rows: open play and organizers get every row; otherwise the full list
-- only once the caller is confirmed (event_has_my_placed_seat), plus the
-- caller's own row and any invite the caller sent.
-- Names: an invited row names its invitee only in open play, or to an
-- organizer, its sender or its invitee; anybody else gets it anonymous.
-- Invited rows carry no waitlist_position: the group's queue place is not
-- theirs until they accept.
-- ---------------------------------------------------------------------
drop function if exists public.event_seating(uuid);

create function public.event_seating(target_event uuid)
returns table (
  booking_id        uuid,
  group_id          uuid,
  profile_id        uuid,
  display_name      text,
  skill_level       public.skill_level,
  event_table_id    uuid,
  status            public.booking_status,
  booked_by         uuid,
  booked_by_name    text,
  group_status      public.booking_group_status,
  waitlist_position int,
  created_at        timestamptz,
  invite_holds_seat boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with ev as (
    select id, club_id, game_mode from public.events where id = target_event
  )
  select
    b.id,
    b.group_id,
    case when v.named then b.profile_id end,
    case when v.named then p.display_name end,
    case when v.named then p.skill_level end,
    b.event_table_id,
    b.status,
    b.booked_by,
    bp.display_name,
    g.status,
    case when b.status = 'invited' or g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    b.created_at,
    b.invite_holds_seat
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.profiles p  on p.id = b.profile_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  cross join ev
  cross join lateral (
    select (
      ev.game_mode = 'open_play'
      or b.status <> 'invited'
      or b.profile_id = auth.uid()
      or b.booked_by  = auth.uid()
      or public.is_club_organizer(ev.club_id)
    ) as named
  ) v
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted', 'invited')
    and public.is_club_member(ev.club_id)
    -- Visibility: same test as events_select_member, re-asked here
    -- because this function bypasses RLS. An invitee passes.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or public.event_has_my_active_booking(target_event)
    )
    -- Roster privacy, invite-only: the full list once the caller is
    -- confirmed; otherwise their own row and the invites they sent.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or public.event_has_my_placed_seat(target_event)
      or b.profile_id = auth.uid()
      or b.booked_by = auth.uid()
    )
  order by t.position nulls last, b.created_at, b.id;
$$;

revoke execute on function public.event_seating(uuid) from public, anon, authenticated;
grant execute on function public.event_seating(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- event_accepted_count: an invitee on an invite-only game gets the
-- headcount (routed through event_has_my_active_booking). The COUNT is
-- unchanged -- a pending invite has not accepted anything.
-- ---------------------------------------------------------------------
create or replace function public.event_accepted_count(target_event uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case when exists (
    select 1 from public.events e
    where e.id = target_event
      and public.is_club_member(e.club_id)
      and (
        e.game_mode = 'open_play'
        or public.is_club_organizer(e.club_id)
        or public.event_has_my_active_booking(target_event)
      )
  )
  then (
    select count(*)::int from public.bookings b
    where b.event_id = target_event and b.status in ('confirmed', 'waitlisted')
  )
  else null end;
$$;

revoke execute on function public.event_accepted_count(uuid) from public, anon;
grant execute on function public.event_accepted_count(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- my_upcoming_bookings: pending invites are the source of the dashboard's
-- Accept / Decline card, so they come back too, with the sender
-- (booked_by / booked_by_name, already present) and invite_holds_seat.
-- For an invited row the offer and waitlist columns are null (both
-- describe the SENDER's group), and the row stops appearing at kickoff
-- rather than at ends_at -- nothing can be done with it once the game has
-- started. Drop + create: a new OUT column (42P13), same dance as
-- 20260827070000 and 20260903150000.
-- ---------------------------------------------------------------------
drop function if exists public.my_upcoming_bookings();

create function public.my_upcoming_bookings()
returns table (
  booking_id       uuid,
  group_id         uuid,
  event_id         uuid,
  club_id          uuid,
  club_name        text,
  event_title      text,
  starts_at        timestamptz,
  club_timezone    text,
  venue_name       text,
  event_table_id   uuid,
  table_label      text,
  status           public.booking_status,
  booked_by        uuid,
  booked_by_name   text,
  offer_id         uuid,
  offer_seats      int,
  offer_expires_at timestamptz,
  waitlist_position  int,
  check_in_required  boolean,
  check_in_state     public.attendance_state,
  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,
  fee_cents          int,
  min_spend_cents    int,
  invite_holds_seat  boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id, b.group_id, b.event_id, b.club_id, c.name, e.title, e.starts_at,
    c.timezone, v.name, b.event_table_id, t.label, b.status,
    b.booked_by, bp.display_name,
    po.id, po.offered_seat_count, po.expires_at,
    case when b.status = 'invited' or g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    e.check_in_required,
    ci.state,
    case when e.check_in_required
         then e.starts_at - interval '1 hour' end,
    case when e.check_in_required then e.ends_at end,
    e.fee_cents,
    e.min_spend_cents,
    b.invite_holds_seat
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
   and b.status <> 'invited'
  left join public.check_ins ci
    on ci.event_id = b.event_id and ci.profile_id = b.profile_id
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted', 'invited')
    and e.status = 'published'
    and e.ends_at > now()
    and (b.status <> 'invited' or e.starts_at > now())
  order by e.starts_at, c.name;
$$;

revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant execute on function public.my_upcoming_bookings() to authenticated;
