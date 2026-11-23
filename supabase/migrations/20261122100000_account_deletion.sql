/*
 * Account deletion, database half (docs/superpowers/specs/
 * 2026-11-22-app-store-1-0-design.md, "Account deletion").
 *
 * The delete-account edge function calls delete_account_data(target) with
 * the service role, removes the storage objects it returns, then deletes
 * the auth user. Deleting the auth user cascades to profiles and from there
 * to everything already declared `on delete cascade` (memberships -- whose
 * club_members_after_delete trigger hands a hosted club to its
 * longest-tenured member or deletes a club left empty -- friendships,
 * check-ins, payments, reads, hearts, tokens, calendar feeds, outbox).
 *
 * 1. Rows other people own that merely record this person as an actor
 *    survive, anonymised: their FKs become `on delete set null`, dropping
 *    `not null` where it was set. (clubs.created_by and the club_invites
 *    columns already were, 20260822040732.)
 *
 * 2. The person's own content is DELETED, not anonymised, by
 *    delete_account_data: messages (and the replies under their board
 *    posts, which `root_id ... on delete set null` would otherwise surface
 *    as top-level posts), archived chat, announcements, club media, and
 *    bookings. Those four FKs (messages.author_id, broadcasts.author_id,
 *    club_media.uploaded_by, bookings.profile_id) are deliberately left
 *    NO ACTION: if the function was skipped, or something was written in
 *    between, the auth delete fails loudly instead of cascading away a
 *    seat without promoting the waitlist, or a post without its replies or
 *    its storage objects. The edge function can simply run both again.
 *
 * 3. Four existing functions are copied verbatim from their latest
 *    definitions with only a null-booker change, because a booking's
 *    booked_by can now be null on a live row (a seat or invite from
 *    somebody who has since left):
 *      - event_seating (20260924104000) and my_upcoming_bookings
 *        (20261021100000): `join profiles bp on bp.id = b.booked_by`
 *        becomes a LEFT join, or the seat would vanish from the game's
 *        seating and the member's upcoming games while still taking a seat.
 *      - decline_booking (20260924103000) and accept_booking_invite
 *        (20260924106000): the "tell the booker" outbox insert is skipped
 *        when there is no booker (recipient_id is not null, so the insert
 *        would otherwise make the seat impossible to decline or accept).
 */

-- ---------------------------------------------------------------------
-- 1. Actor columns: on delete set null.
-- ---------------------------------------------------------------------
alter table public.venues
  alter column created_by drop not null,
  drop constraint venues_created_by_fkey,
  add constraint venues_created_by_fkey foreign key (created_by)
    references public.profiles(id) on delete set null;

alter table public.event_series
  alter column created_by drop not null,
  drop constraint event_series_created_by_fkey,
  add constraint event_series_created_by_fkey foreign key (created_by)
    references public.profiles(id) on delete set null;

alter table public.events
  alter column created_by drop not null,
  drop constraint events_created_by_fkey,
  add constraint events_created_by_fkey foreign key (created_by)
    references public.profiles(id) on delete set null;

alter table public.booking_groups
  alter column created_by drop not null,
  drop constraint booking_groups_created_by_fkey,
  add constraint booking_groups_created_by_fkey foreign key (created_by)
    references public.profiles(id) on delete set null;

alter table public.bookings
  alter column booked_by drop not null,
  drop constraint bookings_booked_by_fkey,
  add constraint bookings_booked_by_fkey foreign key (booked_by)
    references public.profiles(id) on delete set null,
  drop constraint bookings_cancelled_by_fkey,
  add constraint bookings_cancelled_by_fkey foreign key (cancelled_by)
    references public.profiles(id) on delete set null;

alter table public.check_ins
  alter column recorded_by drop not null,
  drop constraint check_ins_recorded_by_fkey,
  add constraint check_ins_recorded_by_fkey foreign key (recorded_by)
    references public.profiles(id) on delete set null;

alter table public.message_threads
  drop constraint message_threads_created_by_fkey,
  add constraint message_threads_created_by_fkey foreign key (created_by)
    references public.profiles(id) on delete set null;

alter table public.thread_members
  drop constraint thread_members_added_by_fkey,
  add constraint thread_members_added_by_fkey foreign key (added_by)
    references public.profiles(id) on delete set null;

alter table public.table_rounds
  alter column winner_profile_id drop not null,
  alter column recorded_by drop not null,
  drop constraint table_rounds_winner_profile_id_fkey,
  add constraint table_rounds_winner_profile_id_fkey
    foreign key (winner_profile_id)
    references public.profiles(id) on delete set null,
  drop constraint table_rounds_recorded_by_fkey,
  add constraint table_rounds_recorded_by_fkey foreign key (recorded_by)
    references public.profiles(id) on delete set null;

alter table public.event_payments
  alter column marked_by drop not null,
  drop constraint event_payments_marked_by_fkey,
  add constraint event_payments_marked_by_fkey foreign key (marked_by)
    references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. delete_account_data(target): everything the person made that is
-- theirs alone, in an order that keeps everyone else's data whole.
-- Returns the storage objects the caller must remove, as (bucket, path).
-- Service role only: the edge function resolves `target` from the
-- caller's JWT; no client may name somebody else.
-- ---------------------------------------------------------------------
create function public.delete_account_data(target uuid)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_claims text := current_setting('request.jwt.claims', true);
  saved_sub    text := current_setting('request.jwt.claim.sub', true);
  bk           record;
  my_messages  uuid[];
  threads      uuid[];
  roots        uuid[];
begin
  if target is null then
    raise exception 'no such account' using errcode = '22023';
  end if;

  /*
   * a. A group the person made for other people stays theirs to answer
   *    for: promote_waitlist sends the group's offers to created_by and
   *    accept_promotion_offer only takes them from created_by. It passes to
   *    the earliest-booked person still live in it. A group with nobody
   *    live in it keeps created_by and is anonymised by the FK below.
   *    Done before the cancels in b, so an offer one of them sets off for
   *    such a group goes to its new creator, not to the person leaving.
   */
  update public.booking_groups g
     set created_by = (
       select b.profile_id from public.bookings b
        where b.group_id = g.id
          and b.profile_id <> target
          and b.status in ('confirmed', 'waitlisted', 'invited')
        order by b.created_at, b.id
        limit 1)
   where g.created_by = target
     and exists (
       select 1 from public.bookings b
        where b.group_id = g.id
          and b.profile_id <> target
          and b.status in ('confirmed', 'waitlisted', 'invited'));

  /*
   * b. Future seats, waitlist places and invites go through the normal
   *    paths so the waitlist promotes and the booker hears about it exactly
   *    as if the person had done it themselves. Those paths take their
   *    caller from auth.uid(), so the person's identity is assumed for the
   *    loop (transaction-local) and the caller's put back after it.
   *    An invite is declined; a seat or waitlist place is cancelled.
   */
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', target, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', target::text, true);

  for bk in
    select b.id, b.status, b.booked_by
      from public.bookings b
      join public.events e on e.id = b.event_id
     where b.profile_id = target
       and b.status in ('confirmed', 'waitlisted', 'invited')
       and e.starts_at > now()
       -- decline_booking refuses a seat you booked yourself; an invite
       -- always has another sender, so this excludes nothing real.
       and not (b.status = 'invited' and b.booked_by = target)
     order by e.starts_at, b.created_at, b.id
  loop
    if bk.status = 'invited' then
      perform public.decline_booking(bk.id);
    else
      perform public.cancel_booking(bk.id);
    end if;
  end loop;

  -- '' when the caller had none: auth.uid() reads '' as null (nullif).
  perform set_config('request.jwt.claims', coalesce(saved_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(saved_sub, ''), true);

  -- c. Every remaining booking of theirs (history, closed rows), then any
  -- group of theirs left with no bookings at all (offers cascade).
  delete from public.bookings where profile_id = target;
  delete from public.booking_groups g
   where g.created_by = target
     and not exists (select 1 from public.bookings b where b.group_id = g.id);

  /*
   * d. Messages. The replies under their board posts go too: root_id is
   *    `on delete set null`, so left behind they would surface as
   *    top-level posts. Attachment rows cascade from messages; their
   *    storage paths are collected first.
   */
  my_messages := array(
    select m.id from public.messages m where m.author_id = target);
  threads := array(
    select distinct m.thread_id from public.messages m
     where m.author_id = target);
  roots := array(
    select distinct m.root_id from public.messages m
     where m.author_id = target and m.root_id is not null);

  return query
    select 'message-images'::text, a.storage_path
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
     where m.id = any(my_messages) or m.root_id = any(my_messages);

  delete from public.messages where root_id = any(my_messages);
  delete from public.messages where id = any(my_messages);

  -- Posts they replied to stop counting (and sorting by) their replies;
  -- the same rebuild 20260830040000 step 4 does.
  update public.messages a
     set reply_count = coalesce(r.n, 0),
         last_reply_at = r.mx
    from (select x.id,
                 (select count(*)::int from public.messages y
                   where y.root_id = x.id) as n,
                 (select max(y.created_at) from public.messages y
                   where y.root_id = x.id) as mx
            from unnest(roots) as x(id)) r
   where a.id = r.id;

  -- A thread whose last message was theirs sorts by what is left in it
  -- (20260830040000 step 5).
  update public.message_threads t
     set last_message_at = (
       select max(m.created_at) from public.messages m
        where m.thread_id = t.id)
   where t.id = any(threads);

  -- Archived club chat (20260830040000) has no FK to profiles.
  delete from public.archived_messages
   where author_id = target
      or root_id in (select am.id from public.archived_messages am
                      where am.author_id = target);

  -- e. Announcements. Their thread copies were messages, already gone.
  delete from public.broadcasts where author_id = target;

  -- f. Club photos and files.
  return query
    select 'club-media'::text, cm.storage_path
      from public.club_media cm
     where cm.uploaded_by = target;
  delete from public.club_media where uploaded_by = target;

  return;
end;
$$;

revoke execute on function public.delete_account_data(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. Null-booker readers and writers (see header).
-- ---------------------------------------------------------------------

-- event_seating (from 20260924104000). Only change: LEFT join on the
-- booker's profile. Same signature, so create or replace keeps it in place.
create or replace function public.event_seating(target_event uuid)
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
  left join public.profiles bp on bp.id = b.booked_by  -- CHANGED
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
    -- confirmed; otherwise their own row and the invites they sent that
    -- are still pending (an invite the invitee has since accepted or
    -- declined is no longer "theirs to watch" -- it reads under the
    -- ordinary rules above like any other row).
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or public.event_has_my_placed_seat(target_event)
      or b.profile_id = auth.uid()
      or (b.status = 'invited' and b.booked_by = auth.uid())
    )
  order by t.position nulls last, b.created_at, b.id;
$$;

revoke execute on function public.event_seating(uuid) from public, anon, authenticated;
grant execute on function public.event_seating(uuid) to authenticated;

-- my_upcoming_bookings (from 20261021100000). Only change: LEFT join on
-- the booker's profile.
create or replace function public.my_upcoming_bookings()
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
    b.id, b.group_id, b.event_id, b.club_id, c.name,
    public.event_headline(e.title, e.game_mode),
    e.starts_at,
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
  left join public.profiles bp on bp.id = b.booked_by  -- CHANGED
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

-- decline_booking (from 20260924103000). Only change: the booker is told
-- only when there still is one.
create or replace function public.decline_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  -- Bound and null-checked rather than compared with `<>`: a null
  -- auth.uid() makes `bk.profile_id <> auth.uid()` evaluate to NULL, so
  -- the guard would not fire and a caller with no `sub` claim could
  -- decline anybody's seat.
  caller := auth.uid();
  if caller is null or bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  -- A seat you booked yourself is cancelled, never declined. Allowing both
  -- would make the booker's outbox row a coin flip.
  if bk.booked_by = caller then
    raise exception 'nothing to decline' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock.
  select * into bk from public.bookings where id = target_booking;
  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  update public.bookings
     set status = 'declined', cancelled_at = now(), cancelled_by = caller,
         invite_holds_seat = null,
         event_table_id = case when bk.status = 'invited' then null
                               else event_table_id end
   where id = target_booking;

  -- CHANGED: a booker who has since deleted their account is told nothing.
  if bk.booked_by is not null then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.booked_by, bk.club_id, bk.event_id, 'booking_declined',
            jsonb_build_object('booking_id', bk.id,
                               'declined_by', bk.profile_id),
            'booking_declined:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.decline_booking(uuid) from public, anon;
grant execute on function public.decline_booking(uuid) to authenticated;

-- accept_booking_invite (from 20260924106000). Only change: the sender is
-- told only when there still is one.
create or replace function public.accept_booking_invite(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk        record;
  ev        record;
  caller    uuid;
  new_group uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock: a withdraw, a decline or the start-of-game
  -- sweep may have closed it in between.
  select * into bk from public.bookings where id = target_booking;
  if bk.status in ('confirmed', 'waitlisted') then
    raise exception 'invite already accepted' using errcode = '23514';
  end if;
  if bk.status <> 'invited' then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, status, starts_at into ev
  from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;
  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;

  if not public.is_club_member(bk.club_id) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  if bk.invite_holds_seat then
    update public.bookings
       set status = 'confirmed', invite_holds_seat = null
     where id = target_booking;
    new_group := bk.group_id;
  else
    insert into public.booking_groups
      (event_id, club_id, created_by, preferred_table_id, allow_split,
       status, waitlisted_at)
    values (bk.event_id, bk.club_id, caller, null, true,
            'waitlisted', now())
    returning id into new_group;

    -- booked_by becomes the invitee: they joined the queue themselves,
    -- and the sender was already notified via booking_invite_accepted.
    update public.bookings
       set group_id = new_group, status = 'waitlisted',
           invite_holds_seat = null, event_table_id = null,
           booked_by = caller
     where id = target_booking;

    perform public.close_group_if_empty(bk.group_id);
  end if;

  -- CHANGED: a sender who has since deleted their account is told nothing.
  if bk.booked_by is not null then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.booked_by, bk.club_id, bk.event_id, 'booking_invite_accepted',
            jsonb_build_object('booking_id', bk.id,
                               'accepted_by', caller,
                               'waitlisted', not bk.invite_holds_seat),
            'booking_invite_accepted:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  -- Accepting a held seat frees nothing and takes nothing new. Joining
  -- the waitlist may be answerable at once.
  if not bk.invite_holds_seat then
    perform public.promote_waitlist(bk.event_id);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.accept_booking_invite(uuid)
  from public, anon;
grant execute on function public.accept_booking_invite(uuid)
  to authenticated;
