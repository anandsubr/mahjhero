/*
 * Mahj Nights (pivot batch 2): create, view, RSVP, claim.
 *
 * Who calls what:
 *   - create_mahj_night, set_mahj_night_details, claim_my_rsvps:
 *     signed-in users, through PostgREST.
 *   - event_page, submit_rsvp, claim_rsvp_email_slot: the `mahj-night` edge
 *     function only, with the service-role key. The event page is public by
 *     token, but no function here is granted to anon: the edge function is
 *     the single public door, the same shape as calendar-feed, so
 *     grants.test.sql's "nothing is executable by anon" catch-all still
 *     holds. The edge function verifies the caller's JWT itself and passes
 *     the user id in as `viewer`.
 */

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- First word of a display name, for the public page ("Hosted by Priya").
create function public.first_name(full_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(split_part(trim(coalesce(full_name, '')), ' ', 1), ''), '');
$$;
revoke execute on function public.first_name(text) from public, anon, authenticated;

-- Seats at a night: four per table. The host takes one of them.
create function public.mahj_night_seats(target_event uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(t.capacity), 0)::int
    from public.event_tables t where t.event_id = target_event;
$$;
revoke execute on function public.mahj_night_seats(uuid) from public, anon, authenticated;

-- Going = yes RSVPs plus the host.
create function public.mahj_night_going(target_event uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select 1 + (select count(*)::int from public.event_rsvps r
               where r.event_id = target_event and r.status = 'going');
$$;
revoke execute on function public.mahj_night_going(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_mahj_night
-- ---------------------------------------------------------------------------

/*
 * One transaction: the hidden event group (caller as host), its private
 * venue, one game with N tables of four, and the link. Reuses create_club,
 * create_venue and create_event so every rule they enforce (a start in the
 * future, duration and table bounds, organizer checks) applies here too.
 *
 * night_timezone is the host device's IANA zone: the group's timezone is
 * what create_event reads the date and start time in.
 */
create function public.create_mahj_night(
  night_name       text,
  event_date       date,
  start_time       time,
  duration_minutes int,
  place_address    text,
  area_label       text,
  table_count      int,
  theme            text,
  beginners        boolean,
  host_note        text,
  night_timezone   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  title      text := nullif(trim(coalesce(night_name, '')), '');
  address    text := trim(coalesce(place_address, ''));
  area       text := trim(coalesce(area_label, ''));
  new_club   uuid;
  new_venue  uuid;
  new_event  uuid;
  token      text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if length(address) = 0 then
    raise exception 'an address is required' using errcode = '23514';
  end if;
  if length(area) > 40 then
    raise exception 'area label too long' using errcode = '23514';
  end if;
  if theme is null or theme !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'unknown theme' using errcode = '22023';
  end if;
  if night_timezone is null
     or not exists (select 1 from pg_timezone_names where name = night_timezone) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;

  new_club := public.create_club(coalesce(title, 'Mahj Night'), '', null);

  -- Definer rights run as the table owner, which clubs_freeze_identity lets
  -- through for kind and theme_id.
  update public.clubs
     set kind = 'event', theme_id = theme, timezone = night_timezone
   where id = new_club;

  new_venue := public.create_venue(left(address, 120), address, null, null, null, new_club, false);

  new_event := public.create_event(
    target_club      => new_club,
    event_title      => title,
    target_venue     => new_venue,
    event_notes      => coalesce(host_note, ''),
    event_date       => event_date,
    start_time       => start_time,
    duration_minutes => duration_minutes,
    table_count      => table_count
  );

  update public.events
     set event_type = 'mahj_night', public_area = area,
         beginners_welcome = coalesce(beginners, false)
   where id = new_event;

  select link_token into token from public.clubs where id = new_club;

  return jsonb_build_object('club_id', new_club, 'event_id', new_event, 'link_token', token);
end;
$$;
revoke execute on function public.create_mahj_night(
  text, date, time, int, text, text, int, text, boolean, text, text)
  from public, anon;
grant execute on function public.create_mahj_night(
  text, date, time, int, text, text, int, text, boolean, text, text)
  to authenticated;

/*
 * The two Mahj Night fields the normal Edit game form doesn't carry. The
 * rest (name, date, time, place, tables, note) is edited there as for any
 * game.
 */
create function public.set_mahj_night_details(
  target_event uuid,
  area_label   text,
  beginners    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club uuid;
  area text := trim(coalesce(area_label, ''));
begin
  select club_id into target_club from public.events
   where id = target_event and event_type = 'mahj_night';
  if target_club is null then
    raise exception 'not a mahj night' using errcode = '42501';
  end if;
  perform public.assert_club_organizer(target_club);
  if length(area) > 40 then
    raise exception 'area label too long' using errcode = '23514';
  end if;

  update public.events
     set public_area = area, beginners_welcome = coalesce(beginners, false)
   where id = target_event;
end;
$$;
revoke execute on function public.set_mahj_night_details(uuid, text, boolean) from public, anon;
grant execute on function public.set_mahj_night_details(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- event_page (service role only)
-- ---------------------------------------------------------------------------

/*
 * Everything the event page shows, cut to what this viewer may see:
 *
 *   public  anyone with the link: name, host first name, when, area, tables,
 *           beginners badge, how many are going, the theme.
 *   guest   said yes (proved by rsvp_secret, or signed in with a linked yes
 *           RSVP, or a member of the event group): + full address, host
 *           note, first names of who's going.
 *   host    host or co-host of the event group: + every RSVP, the beginner
 *           count, and the link settings.
 *
 * Null when the token matches no Mahj Night, or the link is off and the
 * viewer isn't the host -- the two look the same from outside on purpose.
 *
 * `viewer` is the user id the edge function verified from the caller's JWT,
 * or null when signed out. Never trust a viewer id from a client.
 */
create function public.event_page(
  token       text,
  secret      text default null,
  viewer      uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c       public.clubs%rowtype;
  e       public.events%rowtype;
  v       public.venues%rowtype;
  mine    public.event_rsvps%rowtype;
  tier    text := 'public';
  host_name text;
  result  jsonb;
begin
  if token is null or length(token) < 20 then
    return null;
  end if;

  select * into c from public.clubs where link_token = token and kind = 'event';
  if not found then
    return null;
  end if;

  select * into e from public.events
   where club_id = c.id and event_type = 'mahj_night'
   order by starts_at limit 1;
  if not found then
    return null;
  end if;

  if viewer is not null and exists (
    select 1 from public.club_members m
     where m.club_id = c.id and m.profile_id = viewer and m.status = 'active'
       and m.role in ('host', 'co_organizer')
  ) then
    tier := 'host';
  end if;

  if tier <> 'host' and not c.link_enabled then
    return null;
  end if;

  -- This viewer's own RSVP: by secret first, then by signed-in account.
  if secret is not null and length(secret) >= 20 then
    select * into mine from public.event_rsvps
     where event_id = e.id and rsvp_secret = secret;
  end if;
  if mine.id is null and viewer is not null then
    select * into mine from public.event_rsvps
     where event_id = e.id and profile_id = viewer;
  end if;

  if tier = 'public' and (
       mine.status = 'going'
       or (viewer is not null and exists (
             select 1 from public.club_members m
              where m.club_id = c.id and m.profile_id = viewer and m.status = 'active')))
  then
    tier := 'guest';
  end if;

  select public.first_name(p.display_name) into host_name
    from public.club_members m join public.profiles p on p.id = m.profile_id
   where m.club_id = c.id and m.role = 'host' and m.status = 'active'
   order by m.joined_at limit 1;

  result := jsonb_build_object(
    'tier',              tier,
    'title',             coalesce(e.title, c.name),
    'host_first_name',   coalesce(host_name, ''),
    'starts_at',         e.starts_at,
    'ends_at',           e.ends_at,
    'timezone',          c.timezone,
    'area',              e.public_area,
    'status',            e.status,
    'theme_id',          c.theme_id,
    'beginners_welcome', e.beginners_welcome,
    'tables',            (select count(*) from public.event_tables t where t.event_id = e.id),
    'seats',             public.mahj_night_seats(e.id),
    'going_count',       public.mahj_night_going(e.id),
    'my_rsvp',           case when mine.id is null then null else jsonb_build_object(
                           'name', mine.name, 'email', mine.email, 'status', mine.status,
                           'is_beginner', mine.is_beginner) end
  );

  if tier in ('guest', 'host') then
    select * into v from public.venues where id = e.venue_id;
    result := result || jsonb_build_object(
      'club_id',  c.id,
      'event_id', e.id,
      'note',     e.notes,
      'address',  concat_ws(', ', nullif(v.address_line, ''), nullif(v.locality, ''),
                            nullif(v.region, ''), nullif(v.postal_code, '')),
      'going_names', (
        select coalesce(jsonb_agg(n order by n), '[]'::jsonb) from (
          select public.first_name(r.name) as n from public.event_rsvps r
           where r.event_id = e.id and r.status = 'going'
        ) names where n <> ''
      )
    );
  end if;

  if tier = 'host' then
    result := result || jsonb_build_object(
      'link_token',     c.link_token,
      'link_enabled',   c.link_enabled,
      'beginner_count', (select count(*) from public.event_rsvps r
                          where r.event_id = e.id and r.status = 'going' and r.is_beginner),
      'rsvps', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'name', r.name, 'email', r.email, 'status', r.status,
                 'is_beginner', r.is_beginner, 'signed_in', r.profile_id is not null,
                 'created_at', r.created_at) order by r.created_at), '[]'::jsonb)
          from public.event_rsvps r where r.event_id = e.id
      )
    );
  end if;

  return result;
end;
$$;
revoke execute on function public.event_page(text, text, uuid) from public, anon, authenticated;
grant execute on function public.event_page(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- submit_rsvp (service role only)
-- ---------------------------------------------------------------------------

/*
 * Create or change an RSVP. The edge function passes the client's IP.
 *
 * Outcomes:
 *   created   a new row; `secret` is returned for the browser and the email.
 *   updated   the caller proved the row is theirs (secret); changed in place.
 *   exists    this email already RSVP'd and the caller didn't prove it was
 *             them. Nothing changes; the edge function emails the address
 *             its own link instead. `secret` is returned for that email
 *             only -- the edge function never passes it to the client --
 *             so typing someone's email can't take over their RSVP.
 *
 * Raises 'rate_limited' past 20 attempts per link per IP, or 300 per link,
 * in an hour; 'full' when a new yes would pass the seats (host included);
 * 'not_found' for an unknown, switched-off, cancelled or finished night.
 */
create function public.submit_rsvp(
  token        text,
  rsvp_name    text,
  rsvp_email   text,
  rsvp_status  public.rsvp_status,
  beginner     boolean,
  client_ip    text,
  secret       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.clubs%rowtype;
  e        public.events%rowtype;
  existing public.event_rsvps%rowtype;
  clean_name  text := trim(coalesce(rsvp_name, ''));
  clean_email text := lower(trim(coalesce(rsvp_email, '')));
  ip          text := coalesce(nullif(trim(client_ip), ''), 'unknown');
  outcome  text;
  row_id   uuid;
  row_secret text;
  host_name text;
begin
  select * into c from public.clubs
   where link_token = token and kind = 'event' and link_enabled;
  if not found then
    raise exception 'not_found';
  end if;
  select * into e from public.events
   where club_id = c.id and event_type = 'mahj_night'
   order by starts_at limit 1;
  if not found or e.status <> 'published' or e.ends_at < now() then
    raise exception 'not_found';
  end if;

  if (select count(*) from public.rsvp_attempts a
       where a.club_id = c.id and a.client_ip = ip
         and a.attempted_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.rsvp_attempts a
          where a.club_id = c.id and a.attempted_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate_limited';
  end if;
  insert into public.rsvp_attempts (club_id, client_ip) values (c.id, ip);

  if length(clean_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(clean_email) > 254 or clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if rsvp_status is null then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into existing from public.event_rsvps
   where event_id = e.id and lower(email) = clean_email
   for update;

  if found and (secret is null or secret <> existing.rsvp_secret) then
    outcome := 'exists';
    row_id := existing.id;
    row_secret := existing.rsvp_secret;
  else
    if rsvp_status = 'going' and (existing.id is null or existing.status <> 'going')
       and public.mahj_night_going(e.id) + 1 > public.mahj_night_seats(e.id) then
      raise exception 'full';
    end if;

    if existing.id is null then
      insert into public.event_rsvps (event_id, name, email, status, is_beginner)
      values (e.id, clean_name, clean_email, rsvp_status, coalesce(beginner, false))
      returning id, rsvp_secret into row_id, row_secret;
      outcome := 'created';
    else
      update public.event_rsvps
         set name = clean_name, status = rsvp_status,
             is_beginner = coalesce(beginner, false), updated_at = now()
       where id = existing.id
      returning id, rsvp_secret into row_id, row_secret;
      outcome := 'updated';
    end if;
  end if;

  select public.first_name(p.display_name) into host_name
    from public.club_members m join public.profiles p on p.id = m.profile_id
   where m.club_id = c.id and m.role = 'host' and m.status = 'active'
   order by m.joined_at limit 1;

  return jsonb_build_object(
    'outcome',   outcome,
    'rsvp_id',   row_id,
    'secret',    row_secret,
    'email',     clean_email,
    'name',      clean_name,
    'status',    case when outcome = 'exists' then existing.status else rsvp_status end,
    'title',     coalesce(e.title, c.name),
    'host_first_name', coalesce(host_name, ''),
    'starts_at', e.starts_at,
    'timezone',  c.timezone,
    'area',      e.public_area
  );
end;
$$;
revoke execute on function public.submit_rsvp(
  text, text, text, public.rsvp_status, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_rsvp(
  text, text, text, public.rsvp_status, boolean, text, text)
  to service_role;

/*
 * May the edge function email this RSVP its link now? At most 3 emails per
 * RSVP and 10 per address in 24 hours. Records the send when it says yes.
 */
create function public.claim_rsvp_email_slot(target_rsvp uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  addr text;
begin
  select lower(email) into addr from public.event_rsvps where id = target_rsvp;
  if addr is null then
    return false;
  end if;
  if (select count(*) from public.rsvp_emails
       where rsvp_id = target_rsvp and sent_at > now() - interval '24 hours') >= 3
     or (select count(*) from public.rsvp_emails
          where lower(email) = addr and sent_at > now() - interval '24 hours') >= 10 then
    return false;
  end if;
  insert into public.rsvp_emails (rsvp_id, email) values (target_rsvp, addr);
  return true;
end;
$$;
revoke execute on function public.claim_rsvp_email_slot(uuid) from public, anon, authenticated;
grant execute on function public.claim_rsvp_email_slot(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- claim_my_rsvps (signed-in guest)
-- ---------------------------------------------------------------------------

/*
 * After a guest signs in with the email code: link every unclaimed RSVP made
 * with their (verified) email to their account, and add them to each
 * night's group when they said yes or maybe -- that is what lets them
 * message, pick a seat or, later, join the group. A removed member stays
 * removed. Returns the event groups they're now in.
 */
create function public.claim_my_rsvps()
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  addr   text;
  joined uuid[] := '{}';
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select lower(u.email) into addr from auth.users u
   where u.id = caller and u.email_confirmed_at is not null;
  if addr is null then
    return joined;
  end if;

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  update public.event_rsvps
     set profile_id = caller, updated_at = now()
   where lower(email) = addr and profile_id is null;

  with targets as (
    select distinct ev.club_id
      from public.event_rsvps r
      join public.events ev on ev.id = r.event_id
      join public.clubs cl on cl.id = ev.club_id and cl.kind = 'event'
     where r.profile_id = caller and r.status in ('going', 'maybe')
  ), added as (
    insert into public.club_members (club_id, profile_id, role)
    select t.club_id, caller, 'member' from targets t
    on conflict (club_id, profile_id) do nothing
    returning club_id
  )
  select coalesce(array_agg(club_id), '{}') into joined from added;

  return joined;
end;
$$;
revoke execute on function public.claim_my_rsvps() from public, anon;
grant execute on function public.claim_my_rsvps() to authenticated;
