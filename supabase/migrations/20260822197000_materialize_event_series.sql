/*
 * Turning a rule into rows.
 *
 * Recurring events materialize into concrete `events` rather than being
 * computed on read, because bookings (plan 4) need something real to attach
 * to and notifications (plan 6) need something real to find.
 */

/*
 * The date arithmetic, isolated so it can be tested without touching a table.
 *
 * `weekday` is 0-6 with Sunday = 0, matching both `extract(dow ...)` and
 * JavaScript's `getDay()`, so the client-side preview in lib/events.ts and
 * this function speak the same language.
 */
create function public.series_occurrence_dates(
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
  end if;
end;
$$;

/*
 * Fills every active series' horizon and returns how many events it created.
 *
 * Called two ways: nightly by pg_cron, and synchronously in the same
 * transaction as series creation and series edits. The second matters more
 * than it looks — a host who creates a series and sees no games has watched
 * the feature fail, whatever happens at 3am.
 *
 * The `on conflict` target names the partial index's predicate because
 * Postgres requires inference against a partial unique index to include it.
 * This is what makes two overlapping runs safe: the concurrency question is
 * answered by a constraint rather than by locking discipline.
 */
create function public.materialize_event_series(horizon_days int default 42)
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
  for s in
    select es.*, c.timezone as club_timezone
    from public.event_series es
    join public.clubs c on c.id = es.club_id
    where es.ends_on is null or es.ends_on >= current_date
  loop
    window_start := greatest(
      s.starts_on,
      coalesce(s.materialized_through + 1, s.starts_on)
    );
    window_end := least(
      current_date + horizon_days,
      coalesce(s.ends_on, current_date + horizon_days)
    );

    continue when window_end < window_start;

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
  end loop;

  return created;
end;
$$;

/*
 * Not callable by a client. It takes no club argument and checks no
 * membership, because it is maintenance across every series in the system —
 * which is exactly why `authenticated` must not reach it. The functions that
 * DO check membership (create_event_series, update_event_series) call it as
 * their definer owner, so revoking it here costs them nothing.
 */
revoke execute on function public.series_occurrence_dates(
  public.series_frequency, smallint, smallint, date, date, date, date)
  from public, anon;

revoke execute on function public.materialize_event_series(int)
  from public, anon, authenticated;
grant execute on function public.materialize_event_series(int)
  to service_role;
