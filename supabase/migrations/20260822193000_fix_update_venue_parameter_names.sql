/*
 * Fixes a regression in 20260822192000_create_venues.sql.
 *
 * update_venue's four address-ish parameters were renamed to
 * new_address_line / new_locality / new_region / new_postal_code to work
 * around plpgsql treating an unqualified column reference inside
 * UPDATE ... SET as ambiguous when a parameter shares the column's name.
 * That fixed the 42702 the SQL engine raised, but it broke the RPC contract:
 * PostgREST resolves an rpc() call by argument NAME, not position, and every
 * call site in this codebase — lib/clubs.ts's existing rpc() calls, and the
 * events-and-scheduling plan's Task 8 (lib/venues.ts) — calls this function
 * with the original names: address_line, locality, region, postal_code.
 * Against the renamed function that resolution fails with PGRST202/404, and
 * every venue edit would silently fail.
 *
 * The fix restores the original, documented parameter names and resolves
 * the ambiguity by qualifying each reference with the function's own name
 * (update_venue.address_line) instead of renaming the parameter. Do not
 * "simplify" this back to a bare `address_line = coalesce(address_line,
 * address_line)` — that is exactly the form that raises 42702, which is why
 * the qualification exists.
 *
 * Postgres will not rename a function's parameters via
 * `create or replace function`, so the old signature has to be dropped and
 * recreated. A DROP does not preserve the function's ACL, so the
 * revoke/grant pair from the original migration is re-issued at the bottom
 * of this file — without it the recreated function would be left
 * EXECUTE-to-PUBLIC.
 */

drop function public.update_venue(uuid, text, text, text, text, text);

create function public.update_venue(
  target_venue uuid,
  venue_name   text default null,
  address_line text default null,
  locality     text default null,
  region       text default null,
  postal_code  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  steward uuid;
begin
  select added_by_club_id into steward
  from public.venues where id = target_venue;

  if steward is null then
    raise exception 'no such venue' using errcode = 'P0002';
  end if;

  perform public.assert_club_organizer(steward);

  -- Parameters share their names with the columns they update
  -- (address_line, locality, region, postal_code), which is what the RPC
  -- callers require. That makes an unqualified reference inside
  -- UPDATE ... SET ambiguous, so each side is qualified explicitly instead:
  -- the parameter by the function's name, the column by the table's.
  update public.venues set
    name         = coalesce(nullif(trim(coalesce(venue_name, '')), ''), name),
    address_line = coalesce(update_venue.address_line, venues.address_line),
    locality     = coalesce(update_venue.locality,     venues.locality),
    region       = coalesce(update_venue.region,       venues.region),
    postal_code  = coalesce(update_venue.postal_code,  venues.postal_code)
  where id = target_venue;

  return true;
end;
$$;

-- The drop above did not preserve this ACL; re-issue it exactly as the
-- original migration did.
revoke execute on function public.update_venue(uuid, text, text, text, text, text)
  from public, anon;
grant  execute on function public.update_venue(uuid, text, text, text, text, text)
  to authenticated;
