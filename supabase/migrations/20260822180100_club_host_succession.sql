/*
 * Account deletion permanently orphaned clubs. Two shapes, both verified live
 * before this migration:
 *
 *   1. The sole member of a club deletes their account. `club_members`
 *      cascades from `profiles` (20260822033527:22) but `clubs.created_by` is
 *      `on delete set null` (20260822040732:95-103), so the club row survives
 *      with zero members. Every policy on `clubs`, `club_members` and
 *      `club_invites` is membership-scoped, so the row is invisible to
 *      everyone alive — while its globally-unique slug stays taken forever.
 *
 *   2. The host of a multi-member club deletes their account. The club keeps
 *      its members but has zero hosts. `clubs_update_host` and both
 *      `club_invites` organizer policies require an active host row, and role
 *      promotion is deferred to a later plan, so the remaining members cannot
 *      rename the club, change its settings, or invite anyone. Permanently
 *      frozen with no path out through the UI.
 *
 * `create_club` already establishes the invariant "a club always has a host"
 * at birth, atomically, for exactly this reason. Deletion reopened it. This
 * restores it at the other end of the lifecycle.
 *
 * An AFTER DELETE row trigger rather than a scheduled sweep: the window where
 * the invariant is violated should not exist at all, and the cascade from
 * `profiles` gives no other hook.
 */
create function public.club_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_host uuid;
begin
  -- Only active rows count. A club whose every remaining row is 'removed' is
  -- already invisible to all of them (is_club_member requires 'active'), so
  -- it is orphaned just as surely as one with no rows at all.
  if not exists (
    select 1 from public.club_members
    where club_id = old.club_id and status = 'active'
  ) then
    -- Cascades back into club_members for any leftover 'removed' rows, which
    -- re-enters this trigger once per row. That recursion terminates at depth
    -- one: the clubs row is already gone by the time the cascade fires, so
    -- the delete below matches nothing on the way back in.
    delete from public.clubs where id = old.club_id;
    return old;
  end if;

  if exists (
    select 1 from public.club_members
    where club_id = old.club_id and role = 'host' and status = 'active'
  ) then
    return old;
  end if;

  -- Longest-tenured remaining member. `id` breaks ties so two members seated
  -- in the same transaction (never today, but create_club plus a batch import
  -- could) still produce one deterministic winner rather than an arbitrary
  -- one.
  select profile_id into next_host
  from public.club_members
  where club_id = old.club_id and status = 'active'
  order by joined_at, id
  limit 1;

  update public.club_members
  set role = 'host'
  where club_id = old.club_id and profile_id = next_host;

  return old;
end;
$$;

create trigger club_members_after_delete
  after delete on public.club_members
  for each row execute function public.club_members_after_delete();

-- Not reachable from a client — there is no delete grant on club_members and
-- this is a trigger, not a callable entry point — but the ACL should say so.
revoke execute on function public.club_members_after_delete() from public;
revoke execute on function public.club_members_after_delete() from anon, authenticated;
