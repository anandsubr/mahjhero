/*
 * Ties a club invite to one specific game -- accepting it both joins the
 * club (unchanged) and seats the guest at this event (Task 8). Nullable:
 * every existing club_invites row, and most new ones, tie to no event at
 * all and behave exactly as today.
 *
 * A plain CHECK cannot express "event_id's own club_id must match this
 * row's club_id" (no subqueries in a CHECK), so a trigger enforces it
 * instead -- integrity, not a new authorization boundary: RLS already
 * requires the caller to organize club_id, and a mismatched event_id would
 * only ever misbehave harmlessly at accept time (assert_players_bookable
 * would refuse a non-member of the event's real club), but a dangling,
 * wrong reference is still worth refusing outright rather than silently
 * accepting.
 */
alter table public.club_invites
  add column event_id uuid references public.events(id) on delete set null;

create function public.check_club_invite_event_matches_club()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.events where id = new.event_id and club_id = new.club_id
  ) then
    raise exception 'invite event does not belong to this club'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger club_invites_event_matches_club
  before insert or update of event_id, club_id on public.club_invites
  for each row execute function public.check_club_invite_event_matches_club();

revoke execute on function public.check_club_invite_event_matches_club() from public;
revoke execute on function public.check_club_invite_event_matches_club() from anon;
