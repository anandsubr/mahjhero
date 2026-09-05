/*
 * The club-level default toggle. A dedicated RPC rather than a direct
 * client UPDATE through clubs_update_host: that policy is host-only, while
 * every other organizer-facing action in this app (invite, venues, event
 * mutations) is host-OR-co-organizer via assert_club_organizer. Widening
 * clubs_update_host itself would also hand co-organizers every other
 * column that policy guards (name, slug, rhythm, timezone) -- out of scope
 * here and not asked for.
 */
create function public.set_default_game_mode(
  target_club uuid,
  new_mode    public.game_mode
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_club_organizer(target_club);

  update public.clubs set default_game_mode = new_mode
  where id = target_club;
end;
$$;

revoke execute on function public.set_default_game_mode(uuid, public.game_mode)
  from public, anon;
grant execute on function public.set_default_game_mode(uuid, public.game_mode)
  to authenticated;
