/*
 * Home's Games list (pivot batch 2b follow-up): the caller's upcoming Mahj
 * Nights with their own part in each, so a night sits in the same list as
 * every other game, with the right tag ("You're hosting", "Going", "Maybe",
 * "Waitlist") and how many are going ("5/8"), instead of in a separate
 * section.
 *
 * A night counts when the caller hosts it (host or co-host of its hidden
 * group) or has an RSVP linked to their account that isn't "no". RSVPs
 * have no RLS policies, so this definer function is how the app reads the
 * caller's own answer; it never returns anyone else's.
 */
create function public.my_mahj_nights()
returns table (
  club_id      uuid,
  event_id     uuid,
  title        text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  timezone     text,
  area         text,
  link_token   text,
  theme_id     text,
  cancelled    boolean,
  is_host      boolean,
  rsvp_status  text,
  going_count  int,
  seats        int
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, e.id, coalesce(e.title, c.name), e.starts_at, e.ends_at, c.timezone,
         e.public_area, c.link_token, c.theme_id, e.status = 'cancelled',
         coalesce(m.role in ('host', 'co_organizer'), false),
         r.status::text,
         public.mahj_night_going(e.id), public.mahj_night_seats(e.id)
    from public.clubs c
    join public.events e on e.club_id = c.id and e.event_type = 'mahj_night'
    left join public.club_members m
      on m.club_id = c.id and m.profile_id = auth.uid() and m.status = 'active'
    left join public.event_rsvps r
      on r.event_id = e.id and r.profile_id = auth.uid()
   where c.kind = 'event'
     and auth.uid() is not null
     and e.ends_at > now()
     and (m.role in ('host', 'co_organizer')
          or (r.id is not null and r.status <> 'no'))
   order by e.starts_at;
$$;
revoke execute on function public.my_mahj_nights() from public, anon;
grant execute on function public.my_mahj_nights() to authenticated;
