/*
 * Same drop-and-recreate dance as 20260827010000_event_mutations_check_in.sql
 * (whose own header comment explains why `create or replace` cannot add a
 * parameter): two new trailing, defaulted arguments on each of these four,
 * bodies copied byte-for-byte from that migration (each function's own most
 * recent redefinition), with fee_cents/min_spend_cents threaded through
 * exactly where check_in/check_in_required already are.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean);

create function public.create_event(
  target_club      uuid,
  event_title      text,
  target_venue     uuid,
  event_notes      text default '',
  event_date       date default null,
  start_time       time default null,
  duration_minutes int default 180,
  table_count      int default 1,
  check_in         boolean default false,
  fee_cents        int default 0,
  min_spend_cents  int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id  uuid;
  club_tz text;
  starts  timestamptz;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(event_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if event_date is null or start_time is null then
    raise exception 'an event must have a date and a start time'
      using errcode = '23514';
  end if;
  if duration_minutes is null or duration_minutes not between 15 and 1440 then
    raise exception 'duration out of range' using errcode = '23514';
  end if;
  if table_count < 1 or table_count > 20 then
    raise exception 'table count out of range' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  select c.timezone into club_tz from public.clubs c where c.id = target_club;

  starts := (event_date + start_time) at time zone club_tz;

  if starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
drop function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean);

create function public.update_event(
  target_event         uuid,
  new_title            text default null,
  new_venue_id         uuid default null,
  new_notes            text default null,
  new_date             date default null,
  new_start_time       time default null,
  new_duration_minutes int default null,
  new_check_in_required boolean default null,
  new_fee_cents        int default null,
  new_min_spend_cents  int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  club_tz        text;
  local_start    timestamp;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
  eff_date       date;
  eff_time       time;
  eff_duration   int;
  eff_starts     timestamptz;
  eff_ends       timestamptz;
  eff_check_in   boolean;
  eff_fee        int;
  eff_min_spend  int;
  next_overrides text[];
begin
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title := coalesce(new_title, ev.title);
  eff_venue := coalesce(new_venue_id, ev.venue_id);
  eff_notes := coalesce(new_notes, ev.notes);
  eff_check_in := coalesce(new_check_in_required, ev.check_in_required);
  eff_fee := coalesce(new_fee_cents, ev.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, ev.min_spend_cents);

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  if new_date is null and new_start_time is null
     and new_duration_minutes is null then
    eff_starts := ev.starts_at;
    eff_ends   := ev.ends_at;
  else
    if new_duration_minutes is not null
       and new_duration_minutes not between 15 and 1440 then
      raise exception 'duration out of range' using errcode = '23514';
    end if;

    select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

    local_start := ev.starts_at at time zone club_tz;

    eff_date := coalesce(new_date, local_start::date);
    eff_time := coalesce(new_start_time, local_start::time);
    eff_duration := coalesce(
      new_duration_minutes,
      (extract(epoch from (ev.ends_at - ev.starts_at)) / 60)::int);

    eff_starts := (eff_date + eff_time) at time zone club_tz;
    eff_ends   := eff_starts + make_interval(mins => eff_duration);
  end if;

  if eff_venue is distinct from ev.venue_id then
    perform public.assert_venue_available(ev.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  if eff_starts is distinct from ev.starts_at and eff_starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    if trim(eff_title) is distinct from trim(ev.title) then
      next_overrides := array_append(next_overrides, 'title');
    end if;
    if eff_venue is distinct from ev.venue_id then
      next_overrides := array_append(next_overrides, 'venue_id');
    end if;
    if eff_notes is distinct from ev.notes then
      next_overrides := array_append(next_overrides, 'notes');
    end if;
    if eff_starts is distinct from ev.starts_at
       or eff_ends is distinct from ev.ends_at then
      next_overrides := array_append(next_overrides, 'starts_at');
    end if;
    if new_check_in_required is not null
       and new_check_in_required is distinct from ev.check_in_required then
      next_overrides := array_append(next_overrides, 'check_in_required');
    end if;
    if new_fee_cents is not null
       and new_fee_cents is distinct from ev.fee_cents then
      next_overrides := array_append(next_overrides, 'fee_cents');
    end if;
    if new_min_spend_cents is not null
       and new_min_spend_cents is distinct from ev.min_spend_cents then
      next_overrides := array_append(next_overrides, 'min_spend_cents');
    end if;

    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title              = trim(eff_title),
    venue_id           = eff_venue,
    notes              = eff_notes,
    starts_at          = eff_starts,
    ends_at            = eff_ends,
    check_in_required  = eff_check_in,
    fee_cents          = eff_fee,
    min_spend_cents    = eff_min_spend,
    overrides          = next_overrides
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean);

create function public.create_event_series(
  target_club   uuid,
  series_title  text,
  target_venue  uuid,
  series_notes  text default '',
  freq          public.series_frequency default 'weekly',
  weekday       smallint default 2,
  nth_week      smallint default null,
  start_time    time default '19:00',
  duration_minutes int default 180,
  table_count   int default 1,
  starts_on     date default null,
  ends_on       date default null,
  check_in      boolean default false,
  fee_cents     int default 0,
  min_spend_cents int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(series_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, auth.uid()
  )
  returning id into new_id;

  if ends_on is not null then
    select d into first_date
    from public.series_occurrence_dates(
      freq, weekday, nth_week,
      coalesce(starts_on, current_date), ends_on,
      greatest(coalesce(starts_on, current_date), current_date), ends_on
    ) d
    limit 1;

    if first_date is null then
      raise exception 'no games before that end date' using errcode = '23514';
    end if;
  end if;

  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------------
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean);

create function public.update_event_series(
  target_series      uuid,
  new_title          text default null,
  new_venue_id       uuid default null,
  new_notes          text default null,
  new_start_time     time default null,
  new_duration       int default null,
  new_table_count    int default null,
  new_ends_on        date default null,
  include_overridden boolean default false,
  clear_ends_on      boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents      int default null,
  new_min_spend_cents int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se            public.event_series;
  club_tz       text;
  eff_title     text;
  eff_venue     uuid;
  eff_notes     text;
  eff_start     time;
  eff_dur       int;
  eff_count     int;
  eff_ends      date;
  eff_check_in  boolean;
  eff_fee       int;
  eff_min_spend int;
  touched_title boolean;
  touched_venue boolean;
  touched_notes boolean;
  touched_time  boolean;
  touched_check_in boolean;
  touched_fee   boolean;
  touched_min_spend boolean;
begin
  select * into se from public.event_series where id = target_series for update;

  if se.id is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(se.club_id);

  select timezone into club_tz from public.clubs where id = se.club_id;

  eff_title := coalesce(new_title, se.title);
  eff_venue := coalesce(new_venue_id, se.venue_id);
  eff_notes := coalesce(new_notes, se.notes);
  eff_start := coalesce(new_start_time, se.start_time);
  eff_dur   := coalesce(new_duration, se.duration_minutes);
  eff_count := coalesce(new_table_count, se.table_count);
  eff_check_in := coalesce(new_check_in_required, se.check_in_required);
  eff_fee := coalesce(new_fee_cents, se.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, se.min_spend_cents);
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;
  touched_check_in := eff_check_in is distinct from se.check_in_required;
  touched_fee := eff_fee is distinct from se.fee_cents;
  touched_min_spend := eff_min_spend is distinct from se.min_spend_cents;

  if eff_venue is distinct from se.venue_id then
    perform public.assert_venue_available(se.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  update public.event_series set
    title            = trim(eff_title),
    venue_id         = eff_venue,
    notes            = eff_notes,
    start_time       = eff_start,
    duration_minutes = eff_dur,
    table_count      = eff_count,
    ends_on          = eff_ends,
    check_in_required = eff_check_in,
    fee_cents        = eff_fee,
    min_spend_cents  = eff_min_spend
  where id = target_series;

  if touched_title then
    update public.events e set title = trim(eff_title)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('notes' = any(e.overrides)));
  end if;

  if touched_check_in then
    update public.events e set check_in_required = eff_check_in
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('check_in_required' = any(e.overrides)));
  end if;

  if touched_fee then
    update public.events e set fee_cents = eff_fee
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('fee_cents' = any(e.overrides)));
  end if;

  if touched_min_spend then
    update public.events e set min_spend_cents = eff_min_spend
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('min_spend_cents' = any(e.overrides)));
  end if;

  if touched_time then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'      and touched_title)
        or (k = 'venue_id' and touched_venue)
        or (k = 'notes'    and touched_notes)
        or (k = 'starts_at' and touched_time)
        or (k = 'check_in_required' and touched_check_in)
        or (k = 'fee_cents' and touched_fee)
        or (k = 'min_spend_cents' and touched_min_spend)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select distinct on (b.profile_id)
           b.profile_id, b.club_id, null::uuid, 'event_cancelled',
           jsonb_build_object(
             'booking_id', b.id,
             'series_id',  target_series,
             'event_id',   e.id,
             'starts_at',  e.starts_at),
           'series_shortened:' || b.id::text
    from public.bookings b
    join public.events e on e.id = b.event_id
    where e.series_id = target_series
      and e.occurrence_date > eff_ends
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and b.status in ('confirmed', 'waitlisted')
    order by b.profile_id, e.occurrence_date, b.id
    on conflict (dedupe_key) do nothing;

    delete from public.events
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  to authenticated;
