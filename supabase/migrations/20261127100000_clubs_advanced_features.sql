/*
 * Group settings -> Advanced (pivot batch 1: clubs to groups).
 *
 * MahjHero now leads with small groups. The club-scale controls -- co-host
 * roles, table levels, open seating, the door list, cost to play, minimum
 * spend, venue management, the leaderboard -- stay in the product but are
 * hidden unless a host turns this on.
 *
 * This flag only decides what the app SHOWS. Every server-side path keeps
 * working regardless of its value, so a group that turns it off later
 * loses no data and no existing game changes behaviour.
 *
 * Off for every row, existing ones included: there are no production users
 * yet, so nothing needs to be grandfathered in.
 *
 * Written only through set_club_advanced(); a direct UPDATE is refused by
 * clubs_freeze_identity, the same as code and cover.
 */
alter table public.clubs
  add column advanced_enabled boolean not null default false;

-- create or replace, extending 20260930100100_club_covers.sql's definition
-- verbatim with the advanced_enabled guard below; nothing else here changed.
create or replace function public.clubs_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'club slug cannot be changed' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'club created_by cannot be changed' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'club id cannot be changed' using errcode = '42501';
  end if;

  if new.code is distinct from old.code then
    raise exception 'club code cannot be changed directly' using errcode = '42501';
  end if;

  if new.cover_path is distinct from old.cover_path
     or new.cover_color is distinct from old.cover_color then
    raise exception 'club cover cannot be changed directly' using errcode = '42501';
  end if;

  if new.advanced_enabled is distinct from old.advanced_enabled then
    raise exception 'club advanced setting cannot be changed directly' using errcode = '42501';
  end if;

  return new;
end;
$$;

/*
 * Host or co-host, the same gate set_default_game_mode uses. Definer rights
 * run as the table owner, which the freeze trigger lets through.
 */
create function public.set_club_advanced(
  target_club uuid,
  enabled     boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_club_organizer(target_club);

  update public.clubs set advanced_enabled = coalesce(enabled, false)
  where id = target_club;
end;
$$;

revoke execute on function public.set_club_advanced(uuid, boolean)
  from public, anon;
grant execute on function public.set_club_advanced(uuid, boolean)
  to authenticated;
