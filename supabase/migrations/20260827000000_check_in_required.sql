/*
 * Check-in is opt-in, per event, inherited from the series.
 *
 * A club running two tables of eight does not need an app to track who
 * turned up, and a feature that appears on every game teaches hosts to
 * ignore it. So the door screen, the member's control, and every write
 * function in this plan refuse outright when this flag is false.
 *
 * The flag lives on BOTH tables because plan 3 made series templates and
 * events their materialization: a weekly club ticks the box once on the
 * series and every occurrence inherits it. Per-event-only was considered
 * and rejected — it makes a weekly host re-tick a box forever, which they
 * will not do.
 *
 * `default false` is a constant, not a volatile expression, so Postgres
 * stores it as a missing-value and neither ALTER rewrites its table. This
 * is the distinction plan 6's Task 1 ran into from the other side, where
 * `default now()` on notification_outbox forced a full rewrite under
 * ACCESS EXCLUSIVE.
 */
alter table public.event_series
  add column check_in_required boolean not null default false;

alter table public.events
  add column check_in_required boolean not null default false;

/*
 * The fifth override key.
 *
 * `overrides` records which fields a host set by hand on ONE occurrence, so
 * a later series edit skips them. Without this key, a host who turns
 * check-in off for one quiet week would have it silently turned back on the
 * next time they edited anything about the series.
 *
 * Dropped and re-added rather than altered: a check constraint's expression
 * cannot be modified in place.
 *
 * `and array_ndims(overrides) = 1` is carried over from
 * 20260822195000_fix_event_constraints.sql, not part of the brief's snippet
 * for this migration -- dropping it here would have silently let a
 * multi-dimensional overrides array back in, which is exactly what that
 * migration's comment says the shape check exists to reject.
 */
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required']
    and array_ndims(overrides) = 1
  );

/*
 * Replaced only to carry check_in_required onto each occurrence. Everything
 * else is 20260823040000's body unchanged — the current_date floor that
 * stops a backfill inventing 111 past games, the materialized_through
 * advance, the `ended_at` early return that stops a host-stopped series
 * from generating a fresh occurrence, and the (series_id, occurrence_date)
 * conflict target that makes a second run a no-op.
 *
 * DEVIATION FROM BRIEF: the brief's Step 4 named
 * 20260823000000_harden_event_series_materialization.sql (lines 202-305) as
 * the source to copy byte-for-byte. That is not the current body.
 * 20260823040000_series_propagation_gate_and_ended_at.sql redefines this
 * same function afterward, adding the `if s.ended_at is not null then
 * return 0; end if;` guard described in its own file-level comment
 * ("Materialization looks at `ended_at`"). Copying from 20260823000000 as
 * literally instructed drops that guard and reintroduces the bug
 * 20260823040000 fixed: editing an ended series would materialize a fresh
 * occurrence for it. This was caught by the full `npm run test:db` run
 * (event_series_edits.test.sql tests 69 and 76) as the brief said it would
 * be. The body below is copied byte-for-byte from
 * 20260823040000_series_propagation_gate_and_ended_at.sql lines 421-508
 * instead, with the same two fragments changed.
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

  -- A series the host has stopped generates nothing, whoever asks and by
  -- whichever door. See 20260823040000's note on ended_at vs ends_on.
  if s.ended_at is not null then
    return 0;
  end if;

  /*
   * The floor at current_date is the fix for the backfill; unchanged from
   * 20260823000000, whose comment explains it in full.
   */
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
      starts_at, ends_at, occurrence_date, check_in_required, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.created_by
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
