/*
 * Threads are created on OPEN, not on first message.
 *
 * A row is cheap. Deferring creation to the first send would mean every
 * caller of post_message handling "the thread does not exist yet", and the
 * thread screen handling an id it does not have. Emptiness is a LIST
 * concern instead, and fetch_my_threads (20260829050000) handles it
 * directly: a club thread is always listed, a game thread only once it has
 * a message.
 *
 * Both functions are idempotent by construction. `on conflict` infers the
 * PARTIAL unique index by repeating its WHERE clause — without that clause
 * Postgres cannot match a partial index and raises 42P10.
 */

create function public.open_thread_for_club(target_club uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  tid    uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.club_members cm
     where cm.club_id = target_club
       and cm.profile_id = caller
       and cm.status = 'active'
  ) then
    raise exception 'you are not a member of this club' using errcode = '42501';
  end if;

  insert into public.message_threads (club_id)
  values (target_club)
  on conflict (club_id) where event_id is null and club_id is not null
  do nothing;

  select id into tid
    from public.message_threads
   where club_id = target_club and event_id is null;

  return tid;
end;
$$;

/*
 * The read rule, restated rather than delegated to can_read_thread: that
 * function takes a thread id, and here the thread may not exist yet. The
 * two must agree, and thread_predicates.test.sql plus this migration's own
 * fixture assert the same matrix on both sides.
 */
create function public.open_thread_for_event(target_event uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  cid    uuid;
  tid    uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select club_id into cid from public.events where id = target_event;
  if cid is null then
    -- Deliberately the same refusal a non-member gets. "No such game" and
    -- "not your game" must not be distinguishable, or the id becomes a
    -- probe for which events exist.
    raise exception 'you are not part of this game' using errcode = '42501';
  end if;

  if not (
    exists (
      select 1 from public.bookings b
       where b.event_id = target_event
         and b.profile_id = caller
         and b.status in ('confirmed', 'waitlisted')
    )
    or public.is_club_organizer_of(cid, caller)
  ) then
    raise exception 'you are not part of this game' using errcode = '42501';
  end if;

  insert into public.message_threads (club_id, event_id)
  values (cid, target_event)
  on conflict (event_id) where event_id is not null
  do nothing;

  select id into tid from public.message_threads where event_id = target_event;

  return tid;
end;
$$;

revoke execute on function public.open_thread_for_club(uuid) from public, anon;
revoke execute on function public.open_thread_for_event(uuid) from public, anon;
grant execute on function public.open_thread_for_club(uuid) to authenticated;
grant execute on function public.open_thread_for_event(uuid) to authenticated;
