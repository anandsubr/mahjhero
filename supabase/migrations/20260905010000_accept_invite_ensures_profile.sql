/*
 * Hardening, not a signature change -- `create or replace` is safe here.
 *
 * Observed live: a brand-new signup's `auth.users` row was created and
 * confirmed normally, but `handle_new_user`'s trigger (20260801221252)
 * never produced the matching `profiles` row -- a one-off, not reproduced
 * on any other account in this database, most likely a transient
 * contention window rather than a defect in the trigger itself. Whatever
 * the cause, `accept_club_invite` then failed the `club_members` insert
 * with a raw foreign-key violation (`club_members_profile_id_fkey`),
 * surfaced to the member as an opaque database error instead of either
 * working or a friendly message.
 *
 * The fix makes `accept_club_invite` self-healing against exactly this
 * failure mode: it ensures the caller's own profile row exists,
 * immediately before the `club_members` insert that depends on it,
 * using the identical shape `handle_new_user` itself inserts (empty
 * `display_name`, `on conflict do nothing`) so a normal, already-present
 * profile is untouched and only a genuinely missing one is backfilled.
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

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

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
