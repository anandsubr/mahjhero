/*
 * A club-level default for whether new games are open to the whole
 * roster or visible only to people the organizer invites, plus a
 * per-occurrence override carried the same way check_in_required and
 * fee_cents already are: template (event_series) -> materialization
 * (events) -> per-occurrence override tracked in events.overrides.
 *
 * Deliberately a new column, not a repurposing of clubs.visibility
 * (public/private) -- that column already has a different, documented,
 * not-yet-built meaning (an invite LINK that either admits instantly or
 * raises a host-approved join REQUEST for club membership). This is
 * about who can see/join one GAME, not who can join the club.
 */
create type public.game_mode as enum ('open_play', 'invite_only');

alter table public.clubs
  add column default_game_mode public.game_mode not null default 'open_play';

alter table public.event_series
  add column game_mode public.game_mode not null default 'open_play';

alter table public.events
  add column game_mode public.game_mode not null default 'open_play';

-- One more override key. Dropped and re-added rather than altered: a check
-- constraint's expression cannot be modified in place.
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required', 'fee_cents', 'min_spend_cents',
                       'game_mode']
    and array_ndims(overrides) = 1
  );

/*
 * Replaced only to carry game_mode onto each occurrence, same shape as
 * 20260903130000's own replacement for fee_cents/min_spend_cents.
 * Signature is unchanged, so this is a plain create or replace.
 */
create or replace function public.materialize_one_series(
  target_series uuid,
  horizon_days  int default 42
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s            record;
  d            date;
  new_event    uuid;
  created      int := 0;
  window_start date;
  window_end   date;
begin
  select es.*, c.timezone as club_timezone
    into s
    from public.event_series es
    join public.clubs c on c.id = es.club_id
    where es.id = target_series;

  if not found then
    return 0;
  end if;

  if s.ended_at is not null then
    return 0;
  end if;

  window_start := greatest(
    s.starts_on,
    coalesce(s.materialized_through + 1, s.starts_on),
    current_date
  );
  window_end := least(
    current_date + horizon_days,
    coalesce(s.ends_on, current_date + horizon_days)
  );

  if window_end < window_start then
    return 0;
  end if;

  for d in
    select * from public.series_occurrence_dates(
      s.frequency, s.weekday, s.nth_week,
      s.starts_on, s.ends_on, window_start, window_end
    )
  loop
    new_event := null;

    insert into public.events (
      club_id, series_id, title, venue_id, notes,
      starts_at, ends_at, occurrence_date, check_in_required,
      fee_cents, min_spend_cents, game_mode, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.fee_cents, s.min_spend_cents, s.game_mode,
      s.created_by
    )
    on conflict (series_id, occurrence_date) where series_id is not null
    do nothing
    returning id into new_event;

    if new_event is not null then
      insert into public.event_tables (event_id, club_id, label, position)
      select new_event, s.club_id, 'Table ' || g, g
      from generate_series(1, s.table_count) g;

      created := created + 1;
    end if;
  end loop;

  update public.event_series
    set materialized_through = window_end
    where id = s.id;

  return created;
end;
$$;
