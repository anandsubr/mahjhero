/*
 * Two optional per-game money fields, following check_in_required's own
 * shape exactly (supabase/migrations/20260827000000_check_in_required.sql):
 * both live on `event_series` (the template) and `events` (each
 * materialization), so a weekly host sets a price once and every future
 * occurrence inherits it via materialize_one_series.
 *
 * Stored as integer cents, not `numeric` dollars, so nothing above this
 * layer ever does float arithmetic on money. `0` means "not set" — there is
 * no reading of "explicitly free" that differs from "never priced" for
 * display purposes, so this follows the same "always a real value, never
 * NULL" convention `notes`/`check_in_required` already established.
 */
alter table public.event_series
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);

alter table public.events
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);

/*
 * Two more override keys. Dropped and re-added rather than altered: a check
 * constraint's expression cannot be modified in place (same reasoning
 * 20260827000000 already documents for this exact constraint).
 */
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required', 'fee_cents', 'min_spend_cents']
    and array_ndims(overrides) = 1
  );

/*
 * Replaced only to carry fee_cents/min_spend_cents onto each occurrence.
 * Signature is unchanged (same two arguments, same `returns int`), so this
 * is a plain `create or replace`, not a drop-and-recreate — unlike the RPCs
 * in the next migration, whose PARAMETER lists actually change.
 *
 * Everything else is 20260827000000_check_in_required.sql's own body,
 * unchanged — including its own already-corrected deviation from an
 * earlier brief (the current_date floor, the ended_at guard, and the
 * (series_id, occurrence_date) conflict target).
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
      fee_cents, min_spend_cents, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.fee_cents, s.min_spend_cents, s.created_by
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
