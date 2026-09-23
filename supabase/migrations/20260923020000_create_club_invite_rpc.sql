-- Invite creation moves from a plain client-side insert to a
-- security-definer RPC so a friendly "already a member" error is possible
-- (an RLS WITH CHECK failure only ever reports as an opaque "row-level
-- security policy violation", not a message a UI can show as-is).
--
-- Direct INSERT on club_invites is revoked below once this exists, so
-- creation only ever happens through this one path.
create function public.create_club_invite(
  target_club_id uuid,
  target_email text,
  target_display_name text,
  target_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  -- Raises 42501 itself if the caller does not organize this club (or the
  -- club does not exist) -- same helper, same error class, as
  -- set_payment_status's own tenancy check.
  perform public.assert_club_organizer(target_club_id);

  if exists (
    select 1
    from public.club_members cm
    join auth.users u on u.id = cm.profile_id
    where cm.club_id = target_club_id
      and cm.status = 'active'
      and lower(u.email) = lower(target_email)
  ) then
    raise exception 'That person is already in this club';
  end if;

  insert into public.club_invites (club_id, email, display_name, event_id)
  values (
    target_club_id,
    target_email,
    nullif(target_display_name, ''),
    target_event_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.create_club_invite(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.create_club_invite(uuid, text, text, uuid)
  to authenticated;

-- Creation only ever happens through create_club_invite now.
revoke insert on public.club_invites from authenticated;
