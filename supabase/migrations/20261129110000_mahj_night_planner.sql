/*
 * Mahj Night planner (pivot batch 2b): sets, beginners and money.
 *
 * - events.host_sets: how many mahjong sets the host has. Sets available =
 *   host_sets + guests who said yes and are bringing one; tables that can
 *   run = the smaller of that and the tables planned. Shown to the host as a
 *   warning, never enforced.
 * - events.money_norm / money_note: "No money", "Quarters" or the host's own
 *   words. Shown on the event page only. Nothing here processes, holds or
 *   records any money.
 * - event_rsvps.can_teach / brings_set / has_card: from the RSVP form.
 *   Experience is one choice on the form (new / played / can teach), stored
 *   as is_beginner and can_teach.
 * - event_rsvps.table_number: set only when the host moves a guest to a
 *   table by hand. The rest of the seating plan is suggested afresh from
 *   the RSVPs every time the page is read (supabase/functions/_shared/
 *   seating.ts), so it can't go stale. RSVPs are not seats: signed-in
 *   guests still pick their own seat on the game screen.
 * - 'waitlist': a yes once the night is full. When a seat opens, maybes
 *   and waitlisted guests can claim it, first come; nothing is promoted
 *   automatically.
 */

create type public.mahj_money as enum ('none', 'quarters', 'host_choice');

alter table public.events
  add column host_sets int not null default 1
    constraint events_host_sets_range check (host_sets between 0 and 20),
  add column money_norm public.mahj_money not null default 'none',
  add column money_note text not null default ''
    constraint events_money_note_length check (length(money_note) <= 60);

alter table public.event_rsvps
  add column can_teach boolean not null default false,
  add column brings_set boolean not null default false,
  add column has_card boolean not null default false,
  add column table_number int
    constraint event_rsvps_table_number_positive check (table_number is null or table_number > 0),
  -- "I'm new" and "I can teach" are one choice on the form, so never both.
  add constraint event_rsvps_new_or_teacher check (not (is_beginner and can_teach));

-- ---------------------------------------------------------------------------
-- create_mahj_night: + sets and money. New signature, so drop the old one.
-- ---------------------------------------------------------------------------
drop function public.create_mahj_night(
  text, date, time, int, text, text, int, text, boolean, text, text);

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
  night_timezone   text,
  sets             int default 1,
  money            public.mahj_money default 'none',
  money_text       text default ''
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
  note_money text := trim(coalesce(money_text, ''));
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
  if sets is null or sets not between 0 and 20 then
    raise exception 'set count out of range' using errcode = '23514';
  end if;
  if length(note_money) > 60 then
    raise exception 'money note too long' using errcode = '23514';
  end if;

  new_club := public.create_club(coalesce(title, 'Mahj Night'), '', null);

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
         beginners_welcome = coalesce(beginners, false),
         host_sets = sets,
         money_norm = coalesce(money, 'none'),
         money_note = case when money = 'host_choice' then note_money else '' end
   where id = new_event;

  select link_token into token from public.clubs where id = new_club;

  return jsonb_build_object('club_id', new_club, 'event_id', new_event, 'link_token', token);
end;
$$;
revoke execute on function public.create_mahj_night(
  text, date, time, int, text, text, int, text, boolean, text, text, int, public.mahj_money, text)
  from public, anon;
grant execute on function public.create_mahj_night(
  text, date, time, int, text, text, int, text, boolean, text, text, int, public.mahj_money, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_mahj_night_details: + sets and money. New signature.
-- ---------------------------------------------------------------------------
drop function public.set_mahj_night_details(uuid, text, boolean);

create function public.set_mahj_night_details(
  target_event uuid,
  area_label   text,
  beginners    boolean,
  sets         int,
  money        public.mahj_money,
  money_text   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club uuid;
  area text := trim(coalesce(area_label, ''));
  note_money text := trim(coalesce(money_text, ''));
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
  if sets is null or sets not between 0 and 20 then
    raise exception 'set count out of range' using errcode = '23514';
  end if;
  if length(note_money) > 60 then
    raise exception 'money note too long' using errcode = '23514';
  end if;

  update public.events
     set public_area = area, beginners_welcome = coalesce(beginners, false),
         host_sets = sets, money_norm = coalesce(money, 'none'),
         money_note = case when money = 'host_choice' then note_money else '' end
   where id = target_event;
end;
$$;
revoke execute on function public.set_mahj_night_details(
  uuid, text, boolean, int, public.mahj_money, text) from public, anon;
grant execute on function public.set_mahj_night_details(
  uuid, text, boolean, int, public.mahj_money, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_rsvp_table: the host moves a guest who said yes to a table, or (null)
-- hands them back to the suggested plan.
-- ---------------------------------------------------------------------------
create function public.set_rsvp_table(target_rsvp uuid, table_no int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.event_rsvps%rowtype;
  target_club uuid;
  tables int;
begin
  select * into r from public.event_rsvps where id = target_rsvp;
  if not found then
    raise exception 'not a guest of this night' using errcode = '42501';
  end if;
  select club_id into target_club from public.events where id = r.event_id;
  perform public.assert_club_organizer(target_club);

  if table_no is not null then
    if r.status <> 'going' then
      raise exception 'only a guest who said yes has a table' using errcode = '23514';
    end if;
    select count(*) into tables from public.event_tables where event_id = r.event_id;
    if table_no < 1 or table_no > tables then
      raise exception 'no such table' using errcode = '23514';
    end if;
  end if;

  update public.event_rsvps set table_number = table_no, updated_at = now()
   where id = target_rsvp;
end;
$$;
revoke execute on function public.set_rsvp_table(uuid, int) from public, anon;
grant execute on function public.set_rsvp_table(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- event_page: + sets, money, the new RSVP answers, and `_seating`, the input
-- the mahj-night edge function plans the tables from. The edge function
-- strips every `_`-prefixed key before anything leaves the server: guests'
-- ids and experience never reach a browser that isn't the host's.
-- ---------------------------------------------------------------------------
create or replace function public.event_page(
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
    'money_norm',        e.money_norm,
    'money_note',        e.money_note,
    'my_rsvp',           case when mine.id is null then null else jsonb_build_object(
                           'name', mine.name, 'email', mine.email, 'status', mine.status,
                           'is_beginner', mine.is_beginner, 'can_teach', mine.can_teach,
                           'brings_set', mine.brings_set, 'has_card', mine.has_card) end,
    '_my_rsvp_id',       mine.id,
    '_seating', jsonb_build_object(
      'capacities', (select coalesce(jsonb_agg(t.capacity order by t.position), '[]'::jsonb)
                       from public.event_tables t where t.event_id = e.id),
      'guests', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', r.id,
                   'level', case when r.is_beginner then 'new'
                                 when r.can_teach then 'teach' else 'played' end,
                   'pinned', r.table_number) order by r.created_at), '[]'::jsonb)
                   from public.event_rsvps r where r.event_id = e.id and r.status = 'going')
    )
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
      'host_sets',      e.host_sets,
      'guest_sets',     (select count(*) from public.event_rsvps r
                          where r.event_id = e.id and r.status = 'going' and r.brings_set),
      'card_count',     (select count(*) from public.event_rsvps r
                          where r.event_id = e.id and r.status = 'going' and r.has_card),
      'beginner_count', (select count(*) from public.event_rsvps r
                          where r.event_id = e.id and r.status = 'going' and r.is_beginner),
      'teacher_count',  (select count(*) from public.event_rsvps r
                          where r.event_id = e.id and r.status = 'going' and r.can_teach),
      'rsvps', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'name', r.name, 'email', r.email, 'status', r.status,
                 'is_beginner', r.is_beginner, 'can_teach', r.can_teach,
                 'brings_set', r.brings_set, 'has_card', r.has_card,
                 'table_number', r.table_number,
                 'signed_in', r.profile_id is not null,
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
-- submit_rsvp: + experience, set, card; a yes past the seats joins the
-- waitlist instead of being refused. New signature.
-- ---------------------------------------------------------------------------
drop function public.submit_rsvp(text, text, text, public.rsvp_status, boolean, text, text);

create function public.submit_rsvp(
  token        text,
  rsvp_name    text,
  rsvp_email   text,
  rsvp_status  public.rsvp_status,
  beginner     boolean,
  teacher      boolean,
  bringing_set boolean,
  card         boolean,
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
  wanted   public.rsvp_status;
  final    public.rsvp_status;
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
  -- Asking for the waitlist is asking for a seat.
  wanted := case when rsvp_status = 'waitlist' then 'going'::public.rsvp_status else rsvp_status end;

  select * into existing from public.event_rsvps
   where event_id = e.id and lower(email) = clean_email
   for update;

  if found and (secret is null or secret <> existing.rsvp_secret) then
    outcome := 'exists';
    row_id := existing.id;
    row_secret := existing.rsvp_secret;
    final := existing.status;
  else
    final := wanted;
    -- A new yes past the seats (host included) joins the waitlist. Someone
    -- already going keeps their seat whatever else they change.
    if wanted = 'going' and (existing.id is null or existing.status <> 'going')
       and public.mahj_night_going(e.id) + 1 > public.mahj_night_seats(e.id) then
      final := 'waitlist';
    end if;

    if existing.id is null then
      insert into public.event_rsvps (
        event_id, name, email, status, is_beginner, can_teach, brings_set, has_card)
      values (
        e.id, clean_name, clean_email, final,
        coalesce(beginner, false) and not coalesce(teacher, false),
        coalesce(teacher, false), coalesce(bringing_set, false), coalesce(card, false))
      returning id, rsvp_secret into row_id, row_secret;
      outcome := 'created';
    else
      update public.event_rsvps
         set name = clean_name, status = final,
             is_beginner = coalesce(beginner, false) and not coalesce(teacher, false),
             can_teach = coalesce(teacher, false),
             brings_set = coalesce(bringing_set, false),
             has_card = coalesce(card, false),
             -- A table the host chose only means something while going.
             table_number = case when final = 'going' then existing.table_number end,
             updated_at = now()
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
    'status',    final,
    'title',     coalesce(e.title, c.name),
    'host_first_name', coalesce(host_name, ''),
    'starts_at', e.starts_at,
    'timezone',  c.timezone,
    'area',      e.public_area
  );
end;
$$;
revoke execute on function public.submit_rsvp(
  text, text, text, public.rsvp_status, boolean, boolean, boolean, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_rsvp(
  text, text, text, public.rsvp_status, boolean, boolean, boolean, boolean, text, text)
  to service_role;

-- claim_my_rsvps joins a night's group for 'going' and 'maybe'; a waitlisted
-- guest is as interested as a maybe, so they join too.
create or replace function public.claim_my_rsvps()
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
     where r.profile_id = caller and r.status in ('going', 'maybe', 'waitlist')
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
