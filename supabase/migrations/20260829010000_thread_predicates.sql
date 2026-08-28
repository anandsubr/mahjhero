/*
 * The read and post rules, written once.
 *
 * Both branch on the DERIVED kind, so there is no stored kind column to
 * disagree with the foreign keys. RLS calls them and so does every RPC in
 * the migrations that follow; nothing reimplements the matrix.
 *
 *        | read                              | post
 *  club  | active club member                | active club member
 *  game  | confirmed ∪ waitlisted ∪ organizer| confirmed ∪ organizer
 *  group | row in thread_members             | row in thread_members
 *
 * The single difference between the two functions is the game row, which is
 * why they are two short functions rather than one with a flag: a flag
 * would put the one rule that differs behind a boolean at every call site.
 */
/*
 * assert_club_organizer raises for the CALLER; these predicates need the
 * same question asked of an arbitrary profile, and as a boolean rather than
 * an exception. One small function rather than the same two-table exists()
 * written four times below.
 */
create function public.is_club_organizer_of(target_club uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members cm
     where cm.club_id = target_club
       and cm.profile_id = who
       and cm.status = 'active'
       and cm.role in ('host', 'co_organizer')
  );
$$;

create function public.can_read_thread(t uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := (select auth.uid());
  th     public.message_threads;
begin
  if viewer is null then return false; end if;

  select * into th from public.message_threads where id = t;
  if not found then return false; end if;

  -- Group: explicit membership, and nothing else. A club organizer has no
  -- standing here — a group is not the club's business.
  if th.club_id is null then
    return exists (
      select 1 from public.thread_members m
       where m.thread_id = t and m.profile_id = viewer
    );
  end if;

  -- Game: a seat of any colour, or an organizer of the club.
  if th.event_id is not null then
    return exists (
      select 1 from public.bookings b
       where b.event_id = th.event_id
         and b.profile_id = viewer
         and b.status in ('confirmed', 'waitlisted')
    ) or public.is_club_organizer_of(th.club_id, viewer);
  end if;

  -- Club: any active member.
  return exists (
    select 1 from public.club_members cm
     where cm.club_id = th.club_id
       and cm.profile_id = viewer
       and cm.status = 'active'
  );
end;
$$;

/*
 * Same shape, one difference: a waitlisted member reads a game thread and
 * cannot post to it. They have no seat, so the thread is information rather
 * than a conversation they are part of. When they are promoted, they can
 * post — no separate grant, because the predicate reads the booking.
 */
create function public.can_post_thread(t uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := (select auth.uid());
  th     public.message_threads;
begin
  if viewer is null then return false; end if;

  select * into th from public.message_threads where id = t;
  if not found then return false; end if;

  if th.club_id is null then
    return exists (
      select 1 from public.thread_members m
       where m.thread_id = t and m.profile_id = viewer
    );
  end if;

  if th.event_id is not null then
    return exists (
      select 1 from public.bookings b
       where b.event_id = th.event_id
         and b.profile_id = viewer
         and b.status = 'confirmed'
    ) or public.is_club_organizer_of(th.club_id, viewer);
  end if;

  return exists (
    select 1 from public.club_members cm
     where cm.club_id = th.club_id
       and cm.profile_id = viewer
       and cm.status = 'active'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Policies. Select only — every write goes through an RPC.
-- ---------------------------------------------------------------------
create policy message_threads_select on public.message_threads
  for select using (public.can_read_thread(id));

create policy thread_members_select on public.thread_members
  for select using (public.can_read_thread(thread_id));

create policy messages_select on public.messages
  for select using (public.can_read_thread(thread_id));

create policy thread_reads_select_own on public.thread_reads
  for select using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Grants.
--
-- `revoke … from public` does NOT clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly below.
-- This repository has been bitten by that four times — 20260823020000,
-- 20260823030000, 20260823060000, 20260825061000 — and each time the gap
-- was invisible against the local stack, which grants `authenticated`
-- nothing by default.
--
-- `can_read_thread` is the one exception: it is invoked directly inside
-- the USING clause of the select policies above, and that invocation runs
-- under the querying role's own EXECUTE privilege, not the table owner's
-- — SECURITY DEFINER only changes whose privileges apply *inside* the
-- function body, not who may call it. `authenticated` is exactly who
-- issues the `select` that trips the policy, so it needs EXECUTE here,
-- the same way `is_booking_group_member` does at
-- 20260825000000_create_bookings.sql:309-310. Revoking it (as an earlier
-- draft of this migration did) passes every direct pgTAP call — those run
-- as the migration/test role, which bypasses the ACL — and only fails
-- once a query actually runs as `authenticated`, which is exactly what
-- this fixture's "RLS actually applies the predicate" block exists to
-- catch.
--
-- `can_post_thread` and `is_club_organizer_of` are not referenced by any
-- policy in this migration — every write goes through an RPC, and
-- `is_club_organizer_of` is only ever called from inside the other two
-- SECURITY DEFINER functions, where the nested call runs as the function
-- owner. Both stay fully internal.
-- ---------------------------------------------------------------------
revoke execute on function public.can_read_thread(uuid)
  from public, anon;
grant  execute on function public.can_read_thread(uuid)
  to authenticated;
revoke execute on function public.can_post_thread(uuid)
  from public, anon, authenticated;
revoke execute on function public.is_club_organizer_of(uuid, uuid)
  from public, anon, authenticated;
