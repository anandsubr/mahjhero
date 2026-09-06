/*
 * Corrective migration. `20260905130000_accept_invite_seats_guest.sql` had
 * to `drop function public.accept_club_invite(text)` (the return type
 * changed from `uuid` to `jsonb`), which reset the function's ACL to
 * Postgres's default of EXECUTE granted to PUBLIC. That migration's
 * re-grant only restored the `revoke ... from anon` half of this
 * function's ACL history, not the earlier `revoke ... from public` from
 * `20260822045445_reactivate_removed_club_member.sql` — leaving
 * `has_function_privilege('anon', 'public.accept_club_invite(text)',
 * 'EXECUTE')` true again, same as before that migration.
 *
 * Harmless in practice (the function's own `caller is null` guard already
 * makes an anon call a no-op), but the ACL should say what it means, so
 * restore both revokes here.
 */
revoke execute on function public.accept_club_invite(text) from public, anon;
