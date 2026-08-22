/*
 * Redeems an invite token and returns the club id, or null if the token is
 * unknown, expired, or already spent.
 *
 * security definer because the caller is by definition not yet a member, so
 * every membership-scoped policy excludes them — they can neither read the
 * invite nor insert their own membership row.
 *
 * RLS therefore does NOT protect this function. It validates the token itself,
 * as its first statements, and the row lock closes the window where two taps
 * on the same link could both succeed.
 */
create function public.accept_club_invite(invite_token text)
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
  on conflict (club_id, profile_id) do nothing;

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  return invite.club_id;
end;
$$;

grant execute on function public.accept_club_invite(text) to authenticated;
