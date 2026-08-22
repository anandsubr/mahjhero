/*
 * Review fixes for 20260822197000. The date arithmetic and the DST handling
 * were verified correct and are carried across unchanged; what changes is
 * where the window starts, who can call the date function, and what happens
 * to the sweep when one tenant's data is bad.
 *
 * Migrations are forward-only, so 20260822197000 is left exactly as it was
 * and this file replaces the two function bodies.
 */

/*
 * 1. Fail loudly on an unhandled frequency.
 *
 * The original fell off the end of the if/elsif chain and returned zero
 * rows, so a future `series_frequency` member would produce a series that
 * silently never materializes. A series that generates nothing is
 * indistinguishable from a series whose window is empty, which is the worst
 * possible way for that bug to present.
 *
 * Everything else in this function is byte-identical to 20260822197000.
 */
create or replace function public.series_occurrence_dates(
  freq         public.series_frequency,
  weekday      smallint,
  nth_week     smallint,
  starts_on    date,
  ends_on      date,
  window_start date,
  window_end   date
)
returns setof date
language plpgsql
immutable
set search_path = public
as $$
declare
  lower_bound date := greatest(starts_on, window_start);
  upper_bound date := least(window_end, coalesce(ends_on, window_end));
  cursor_date date;
  month_start date;
  month_end   date;
  candidate   date;
begin
  if upper_bound < lower_bound then
    return;
  end if;

  if freq = 'weekly' then
    cursor_date := lower_bound
      + ((weekday - extract(dow from lower_bound)::int + 7) % 7);
    while cursor_date <= upper_bound loop
      return next cursor_date;
      cursor_date := cursor_date + 7;
    end loop;

  elsif freq = 'biweekly' then
    -- Anchored on starts_on, never on the window. Anchoring on the window
    -- would let the fortnight drift whenever the horizon is extended in two
    -- steps instead of one — a club would find its every-other-Tuesday game
    -- quietly moving to the alternate Tuesdays.
    cursor_date := starts_on
      + ((weekday - extract(dow from starts_on)::int + 7) % 7);
    if cursor_date < lower_bound then
      cursor_date := cursor_date
        + 14 * ceil((lower_bound - cursor_date)::numeric / 14)::int;
    end if;
    while cursor_date <= upper_bound loop
      return next cursor_date;
      cursor_date := cursor_date + 14;
    end loop;

  elsif freq = 'monthly_nth_weekday' then
    month_start := date_trunc('month', lower_bound::timestamp)::date;
    while month_start <= upper_bound loop
      month_end := (month_start + interval '1 month - 1 day')::date;

      if nth_week = -1 then
        candidate := month_end
          - ((extract(dow from month_end)::int - weekday + 7) % 7);
      else
        candidate := month_start
          + ((weekday - extract(dow from month_start)::int + 7) % 7)
          + 7 * (nth_week - 1);
      end if;

      -- A month with no fifth Tuesday produces nothing that month, rather
      -- than falling back to the fourth. "The fifth Tuesday" means what it
      -- says, and a club that asked for it would rather skip than be
      -- surprised a week early.
      if candidate between greatest(lower_bound, month_start)
                       and least(upper_bound, month_end) then
        return next candidate;
      end if;

      month_start := (month_start + interval '1 month')::date;
    end loop;

  else
    -- Reached only if someone adds a `series_frequency` value without
    -- teaching this function what it means. Better a hard error at the
    -- moment the series is created than a club whose games never appear.
    raise exception 'series_occurrence_dates: unhandled frequency %', freq
      using errcode = 'feature_not_supported';
  end if;
end;
$$;

/*
 * The ACL 20260822197000 meant to write.
 *
 * That migration revoked this function from `public, anon` only, on the
 * strength of the local stack's `proacl`. 20260822045809 records — verified
 * against hosted — that the hosted project bootstraps every new function
 * with EXECUTE granted DIRECTLY to anon, authenticated and service_role, and
 * that `revoke ... from public` does not clear a direct grant. Local
 * `proacl` after `db reset` cannot show that, which is exactly how the same
 * mistake was made twice.
 *
 * Nobody outside the database needs this. It is called only by
 * materialize_one_series, which is `security definer` and therefore runs it
 * as its owner. service_role is revoked too, for the same reason: it reaches
 * materialization through materialize_event_series, never through the date
 * function on its own.
 *
 * `create or replace` preserves the existing ACL, so these revokes are
 * against whatever grants are actually there — local or hosted.
 */
revoke execute on function public.series_occurrence_dates(
  public.series_frequency, smallint, smallint, date, date, date, date)
  from public, anon, authenticated, service_role;

/*
 * 2. A club's timezone must name a real zone.
 *
 * `clubs.timezone` is plain text and feeds `at time zone` in the
 * materializer, so one club holding 'Nowhere/Fake' raised
 * `time zone "Nowhere/Fake" not recognized` and rolled back the sweep for
 * every other tenant.
 *
 * A trigger, not a check constraint. A check constraint cannot contain a
 * subquery, and the usual workaround — wrapping the lookup in a function
 * marked `immutable` so the planner will accept it — would be a lie:
 * pg_timezone_names is built from the tzdata the server was compiled or
 * packaged against, and zones do get renamed and retired between releases.
 * Declaring that function immutable invites the planner to fold it, and
 * worse, a check constraint is re-evaluated by `pg_dump`/restore and by
 * `alter table ... validate`, so a zone dropped by a future tzdata update
 * would turn an existing club's row into an unrestorable one. A trigger
 * fires only on the writes it should police: existing rows are untouched,
 * restores keep working, and only new or edited values must be currently
 * valid.
 */
create function public.clubs_validate_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An UPDATE that leaves the column alone is not asked to justify it. This
  -- matters for the `update of timezone` clause below, which fires whenever
  -- the column appears in the SET list even if the value is unchanged.
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'unrecognized timezone: %', new.timezone
      using errcode = 'invalid_parameter_value',
            hint = 'use an IANA zone name, for example America/New_York';
  end if;

  return new;
end;
$$;

-- Never called directly; only ever fired by the trigger below.
revoke execute on function public.clubs_validate_timezone()
  from public, anon, authenticated;

create trigger clubs_validate_timezone
  before insert or update of timezone on public.clubs
  for each row execute function public.clubs_validate_timezone();

/*
 * 3. One series, materialized. Errors propagate.
 *
 * Split out of materialize_event_series so that the two callers can have the
 * two different failure behaviours they need:
 *
 *   - The nightly sweep must survive one bad series and keep going, so it
 *     wraps each call to this function in its own exception block.
 *   - A host creating a series synchronously (plan 6's create_event_series)
 *     must NOT have its failure swallowed — an empty series and a success
 *     message is the worst outcome available. It calls this function
 *     directly, for its own series only, and any error reaches the host's
 *     request and rolls back the creation with it. It is also strictly
 *     cheaper: a user-facing request no longer sweeps every club's series
 *     to materialize the one it just created.
 */
create function public.materialize_one_series(
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

  /*
   * The floor at current_date is the fix for the backfill.
   *
   * Without it, the first materialization of a series whose `starts_on` is
   * in the past generated every occurrence back to that date: a weekly
   * series starting two years ago produced 111 events, 104 of them already
   * over. At schema limits (a ten-year weekly series, table_count 20) that
   * is ~522 events and ~10,440 event_tables rows written inside a host's
   * request, and plan 6 treats past occurrences as history it never
   * rewrites, so the junk would be permanent.
   *
   * This app schedules games; it does not invent games that never happened.
   * A series whose rule reaches into the past simply begins materializing
   * from today.
   *
   * `current_date`, not `current_date + 1`: a game this evening is not in
   * the past, and today's occurrence must still be created.
   *
   * materialized_through still advances to window_end below. It means
   * "covered up to here", not "created up to here" — flooring the start
   * cannot open a gap, because from the next run onward window_start is
   * materialized_through + 1, which is already at or beyond today.
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

  -- Nothing to cover. Leave materialized_through where it is; it is already
  -- at or past window_end, and moving it backwards would re-open work that
  -- has been done.
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
      starts_at, ends_at, occurrence_date, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.created_by
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

/*
 * Same reasoning as materialize_event_series: no club argument, no
 * membership check, so `authenticated` must not reach it. Plan 6's
 * create_event_series and update_event_series call it as their definer
 * owner, which costs them nothing.
 */
revoke execute on function public.materialize_one_series(uuid, int)
  from public, anon, authenticated;
grant execute on function public.materialize_one_series(uuid, int)
  to service_role;

/*
 * 4. The sweep, now contained.
 *
 * Each series gets its own exception block, so one series that cannot be
 * materialized — a timezone the trigger above did not exist to reject, a
 * venue deleted out from under it, anything — no longer rolls back every
 * other club's work. Before this, a single club holding 'Nowhere/Fake'
 * aborted the whole run, which would have blocked series creation for every
 * other tenant (plan 6 calls this synchronously) and killed plan 7's cron
 * job outright.
 *
 * The warning is the point of the handler. A sweep that silently skips a
 * club is a bug that never surfaces; `raise warning` names the series and
 * the club and lands in the Postgres log where the cron job's output is
 * already read.
 *
 * This does put a subtransaction around each series. At this scale — one
 * row per club-series, once a night — that is the standard shape for a
 * sweep and not worth avoiding.
 */
create or replace function public.materialize_event_series(horizon_days int default 42)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s       record;
  created int := 0;
begin
  for s in
    select es.id, es.club_id, es.title
    from public.event_series es
    where es.ends_on is null or es.ends_on >= current_date
    order by es.id
  loop
    begin
      created := created + public.materialize_one_series(s.id, horizon_days);
    exception when others then
      raise warning
        'materialize_event_series: series % (%) in club % skipped: % [%]',
        s.id, s.title, s.club_id, sqlerrm, sqlstate;
    end;
  end loop;

  return created;
end;
$$;

-- Restated rather than assumed: `create or replace` keeps the existing ACL,
-- and the point of writing it out is that the ACL is now checked by the
-- portable grants suite against hosted, not inferred from a local reset.
revoke execute on function public.materialize_event_series(int)
  from public, anon, authenticated;
grant execute on function public.materialize_event_series(int)
  to service_role;
