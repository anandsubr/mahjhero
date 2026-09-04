/*
 * A pending invite could be created but never deleted or resent — the roster
 * showed it under "Invited" with no way to revoke it (e.g. the wrong person,
 * or the link needs regenerating) short of waiting out the 30-day expiry.
 * Mirrors club_invites_select_organizer and club_invites_insert_organizer
 * exactly: the same host-or-co-organizer-of-this-club check, just for
 * `delete`. A direct table grant, not an RPC — there is no business logic
 * beyond "you organize this club", the same shape already used for
 * push_tokens and greetings (both grant delete straight to authenticated
 * behind an RLS policy).
 */
create policy club_invites_delete_organizer on public.club_invites
  for delete using (
    exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

grant delete on public.club_invites to authenticated;
