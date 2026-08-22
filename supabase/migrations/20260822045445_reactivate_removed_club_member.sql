/*
 * Corrective migration for accept_club_invite (20260822044023), found in
 * review. Two fixes, forward-only per this project's rule: an already
 * applied migration is never hand-edited again, because `supabase db push`
 * tracks applied migrations by version timestamp, not content hash, so an
 * amended file is silently invisible to it once the old timestamp is
 * recorded as applied on a target.
 *
 * 1. Reactivate a removed member instead of stranding them. club_members
 *    defaults status to 'active' and is_club_member requires it, so the
 *    original `on conflict (club_id, profile_id) do nothing` left a
 *    previously removed-and-reinvited member's row at 'removed': the invite
 *    still got stamped spent (accepted_at is set unconditionally below,
 *    outside this insert), the function still returned the club id, and the
 *    client treated a uuid as success while every row in that club stayed
 *    RLS-invisible to them, with no way to redeem another invite for it.
 *
 *    The `where` guard is what keeps this from opening a tampering path in
 *    the other direction: without it, an existing host who redeemed a
 *    plain member-level invite would be silently demoted on conflict. It can
 *    only ever flip removed -> active, never touch role.
 *
 * 2. PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so the
 *    original migration's `grant ... to authenticated` was decorative:
 *    `anon` could call this function too (harmless only because the
 *    `caller is null` guard returns null for it, verified live). Revoke
 *    first so the ACL matches the intent.
 */
create or replace function public.accept_club_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.club_invites%rowtype;
  caller uuid := auth.uid();
begin
  if caller is null then
    return null;
  end if;

  select * into invite
  from public.club_invites
  where token = invite_token
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.expires_at < now() then
    return null;
  end if;

  insert into public.club_members (club_id, profile_id, role)
  values (invite.club_id, caller, 'member')
  on conflict (club_id, profile_id) do update
    set status = 'active'
    where club_members.status = 'removed';

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  return invite.club_id;
end;
$$;

revoke execute on function public.accept_club_invite(text) from public;
grant execute on function public.accept_club_invite(text) to authenticated;
