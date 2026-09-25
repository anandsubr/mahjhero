/*
 * search_venues gains `game_count`: how many of the CALLER'S club's games
 * (not cancelled) are at each venue, for the typeahead's "Used for N games"
 * line. Scoped to target_club on purpose -- counting every club's games at
 * a public venue would report other clubs' activity, which the original
 * function's membership check exists to prevent.
 *
 * A changed return type cannot be `create or replace`d, so drop and
 * recreate, then restore the grants the original migration set.
 */
drop function public.search_venues(uuid, text);

create function public.search_venues(target_club uuid, q text)
returns table (
  id           uuid,
  name         text,
  address_line text,
  locality     text,
  visibility   public.venue_visibility,
  is_own_club  boolean,
  game_count   int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  return query
  select v.id, v.name, v.address_line, v.locality, v.visibility,
         v.added_by_club_id = target_club as is_own_club,
         (
           select count(*)::int
           from public.events e
           where e.venue_id = v.id
             and e.club_id = target_club
             and e.status <> 'cancelled'
         ) as game_count
  from public.venues v
  where v.archived_at is null
    and (v.added_by_club_id = target_club or v.visibility = 'public')
    and (
      q is null or length(trim(q)) = 0
      or v.name ilike '%' || trim(q) || '%'
      or coalesce(v.locality, '') ilike '%' || trim(q) || '%'
    )
  order by (v.added_by_club_id = target_club) desc, v.name
  limit 20;
end;
$$;

revoke execute on function public.search_venues(uuid, text) from public, anon;
grant  execute on function public.search_venues(uuid, text) to authenticated;
