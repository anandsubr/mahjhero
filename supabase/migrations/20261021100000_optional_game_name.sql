/*
 * Optional game name.
 *
 * Giving every game a name was overkill: events.title and event_series.title
 * become nullable, and an unnamed game is shown as "Open play", or "Private
 * game" when invite-only -- lib/home.ts gameHeadline on the client, and
 * event_headline() below wherever SQL hands the client a finished string.
 *
 * Storage rule: a blank or whitespace title is stored as NULL, never ''.
 * The old `length(trim(title)) > 0` checks are replaced by
 * `title is null or length(trim(title)) > 0` (same constraint names) so a
 * direct write cannot sneak a blank in either.
 *
 * Redefined from their LATEST definitions, each change marked "-- CHANGED":
 *
 *   create_event, create_event_series
 *     (20260906120000_seating_mode_create.sql): no 'title is required';
 *     the title is stored as nullif(trim(title), ''). Signatures unchanged,
 *     so create-or-replace.
 *
 *   update_event, update_event_series
 *     (20261018100000_event_updated_tag.sql): new_title keeps
 *     "null = leave it alone" and gains "'' (or whitespace) = clear it to
 *     NULL" -- the client sends '' when the host empties the field. No
 *     'title is required'. The existing comparisons are already NULL-safe
 *     (`trim(eff_title) is distinct from trim(ev.title)`), so naming or
 *     clearing a name stamps details_changed_at, records the 'title'
 *     override on a series occurrence, and propagates through a series
 *     exactly like any other rename; re-clearing an unnamed game is a no-op
 *     and does not stamp. Nothing raises 'title is required' after this.
 *
 *   outbox_render_context (20260924105000_outbox_render_context_accepted_by.sql)
 *     -- feeds claim_notification_batch (emails/push) and
 *     fetch_my_notifications (Alerts), neither of which carries game_mode --
 *   fetch_my_threads (20260830030000_board_unread.sql), the game thread's
 *     title in the Messages list,
 *   my_upcoming_bookings (20260924104000_invite_reads_and_privacy.sql), the
 *     Needs-you invites and seat offers,
 *   fetch_my_pending_invites (20260923030000_club_invite_accept_decline_fetch.sql),
 *     a club invite that names a game:
 *     the title they return is event_headline(e.title, e.game_mode). Each
 *     reaches events through a LEFT join or an inner one; on the left-join
 *     ones a missing event keeps returning NULL (event_headline(null, null)
 *     is NULL), so "no game" and "the game is gone" read as before.
 *     Return types unchanged, so create-or-replace; ACLs restated.
 *
 * Not redefined: my_games and club_games return game_mode and pass a NULL
 * title through for the client to format. materialize_one_series and
 * reset_event_to_series copy the series title as-is (NULL included).
 */

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.events alter column title drop not null;
alter table public.events drop constraint events_title_check;
alter table public.events add constraint events_title_check
  check (title is null or length(trim(title)) > 0);

alter table public.event_series alter column title drop not null;
alter table public.event_series drop constraint event_series_title_check;
alter table public.event_series add constraint event_series_title_check
  check (title is null or length(trim(title)) > 0);

-- ---------------------------------------------------------------------------
-- event_headline: the SQL twin of lib/home.ts gameHeadline. NULL mode means
-- no event was joined, and gives NULL back. Internal: only the security
-- definer functions below call it, as their owner.
-- ---------------------------------------------------------------------------
create function public.event_headline(title text, mode public.game_mode)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when mode is null then null
    else coalesce(nullif(trim(title), ''),
                  case when mode = 'invite_only' then 'Private game'
                       else 'Open play' end)
  end;
$$;
revoke execute on function public.event_headline(text, public.game_mode)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
create or replace function public.create_event(
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
  min_spend_cents  int default 0,
  event_game_mode  public.game_mode default null,
  event_seating_mode public.seating_mode default 'assigned_tables',
  capacity_limit     int default null
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
  eff_mode public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  -- CHANGED: no title check. A null or blank name is stored as NULL below.
  if event_date is null or start_time is null then
    raise exception 'an event must have a date and a start time'
      using errcode = '23514';
  end if;
  -- The same window event_series.duration_minutes is constrained to
  -- (20260822194000), so a one-off and a series cannot disagree about what
  -- a plausible game length is.
  if duration_minutes is null or duration_minutes not between 15 and 1440 then
    raise exception 'duration out of range' using errcode = '23514';
  end if;
  if event_seating_mode = 'open_seating' then
    if table_count < 0 or table_count > 20 then
      raise exception 'table count out of range' using errcode = '23514';
    end if;
  else
    if table_count < 1 or table_count > 20 then
      raise exception 'table count out of range' using errcode = '23514';
    end if;
  end if;

  if capacity_limit is not null and capacity_limit < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  -- assert_club_organizer already established that this club exists and that
  -- the caller organizes it, so this cannot come back null.
  select c.timezone, coalesce(event_game_mode, c.default_game_mode)
    into club_tz, eff_mode
    from public.clubs c where c.id = target_club;

  -- The one conversion. Character-for-character the expression
  -- materialize_one_series uses (20260823000000), because a one-off game at
  -- 7pm and the first week of a series at 7pm must land on the same instant.
  starts := (event_date + start_time) at time zone club_tz;

  -- The new check. After the conversion, because the club's timezone is what
  -- decides whether the host's digits are in the past.
  if starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, game_mode,
    seating_mode, capacity, created_by
  ) values (
    target_club, nullif(trim(event_title), ''), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, eff_mode,
    event_seating_mode, capacity_limit, auth.uid()
  )
  returning id into new_id;

  -- generate_series(1, 0) yields no rows, so an open-seating event created
  -- with table_count => 0 falls out of this insert with zero event_tables
  -- rows naturally -- no branch needed here.
  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
create or replace function public.create_event_series(
  target_club     uuid,
  series_title    text,
  target_venue    uuid,
  series_notes    text default '',
  freq            public.series_frequency default 'weekly',
  weekday         smallint default 2,
  nth_week        smallint default null,
  start_time      time default '19:00',
  duration_minutes int default 180,
  table_count     int default 1,
  starts_on       date default null,
  ends_on         date default null,
  check_in        boolean default false,
  fee_cents       int default 0,
  min_spend_cents int default 0,
  series_game_mode public.game_mode default null,
  series_seating_mode public.seating_mode default 'assigned_tables',
  capacity_limit      int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
  eff_mode   public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  -- CHANGED: no title check. A null or blank name is stored as NULL below.
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  select coalesce(series_game_mode, default_game_mode) into eff_mode
    from public.clubs where id = target_club;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, game_mode,
    seating_mode, capacity, created_by
  ) values (
    target_club, nullif(trim(series_title), ''), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, eff_mode,
    series_seating_mode, capacity_limit, auth.uid()
  )
  returning id into new_id;

  /*
   * The new check: a capped run that produces no game at all.
   *
   * A series with `ends_on` already behind us materializes nothing, ever, and
   * used to report success -- the same invisible-save this file exists to
   * close, one level up. So does a run capped before its own first
   * occurrence: "every 5th Tuesday, stopping in three weeks" is a rule and an
   * end date that never meet.
   *
   * Asked of series_occurrence_dates rather than reimplemented, so this
   * cannot drift from what materialization will actually generate, and asked
   * over the WHOLE remaining run ([today-or-later .. ends_on], the same floor
   * materialize_one_series applies) rather than the 42-day horizon -- a
   * monthly rule can legitimately produce nothing for six weeks and still be
   * a perfectly good series.
   *
   * Only when `ends_on` is set. An open-ended series always produces
   * something eventually, whatever the rule.
   *
   * Placed AFTER the insert on purpose: event_series' own constraints
   * (nth_week matching the frequency, ends_on >= starts_on) have already been
   * enforced by then, so a monthly series sent with a null nth_week gets the
   * constraint error that names its real problem instead of this one, which
   * would be true but misleading. The exception rolls the insert back with
   * it.
   */
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

  -- Synchronously, in the same transaction, and for THIS series only. A host
  -- who creates a series and sees no games has watched the feature fail,
  -- whatever happens at 3am -- and materialize_one_series lets the error
  -- propagate, so a failure rolls the creation back with it rather than
  -- leaving an empty series behind a success message. The sweep is for cron:
  -- calling it here would make one host's request materialize every club's
  -- series, and would swallow the failure of the very series being created.
  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
create or replace function public.update_event(
  target_event          uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_date              date default null,
  new_start_time        time default null,
  new_duration_minutes  int default null,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null,
  new_seating_mode      public.seating_mode default null,
  new_capacity          int default null,
  clear_capacity        boolean default false
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
  eff_game_mode  public.game_mode;
  eff_seating    public.seating_mode;
  eff_capacity   int;
  next_overrides text[];
  details_changed boolean;  -- ADDED
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

  -- CHANGED: null = leave the name alone; '' (or whitespace) = clear it.
  eff_title := case when new_title is null then ev.title
                    else nullif(trim(new_title), '') end;
  eff_venue := coalesce(new_venue_id, ev.venue_id);
  eff_notes := coalesce(new_notes, ev.notes);
  eff_check_in := coalesce(new_check_in_required, ev.check_in_required);
  eff_fee := coalesce(new_fee_cents, ev.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, ev.min_spend_cents);
  eff_game_mode := coalesce(new_game_mode, ev.game_mode);
  eff_seating := coalesce(new_seating_mode, ev.seating_mode);
  -- See the file-level comment: clear_capacity wins outright, exactly the
  -- same precedence clear_ends_on already has over new_ends_on in
  -- update_event_series.
  eff_capacity := case when clear_capacity then null
                       else coalesce(new_capacity, ev.capacity) end;

  -- The new guard (this migration). Mirrors create_event's own
  -- `capacity_limit is not null and capacity_limit < 1` check
  -- (20260906120000_seating_mode_create.sql), reading the resolved
  -- `eff_capacity` rather than the raw argument for the reason the
  -- file-level comment above gives.
  if eff_capacity is not null and eff_capacity < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;

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

    -- What the host currently sees on the club's wall clock. Whichever of
    -- the three calendar values this edit did not name is taken from here,
    -- so "move this week to Thursday" keeps 7pm rather than keeping an
    -- instant that reads as 6pm on the other side of a DST transition.
    local_start := ev.starts_at at time zone club_tz;

    eff_date := coalesce(new_date, local_start::date);
    eff_time := coalesce(new_start_time, local_start::time);
    -- Elapsed minutes, not wall-clock difference: a game that ran across a
    -- transition is three hours long in both readings, and the interval
    -- between the two stored instants is the one that is true.
    eff_duration := coalesce(
      new_duration_minutes,
      (extract(epoch from (ev.ends_at - ev.starts_at)) / 60)::int);

    eff_starts := (eff_date + eff_time) at time zone club_tz;
    eff_ends   := eff_starts + make_interval(mins => eff_duration);
  end if;

  if eff_venue is distinct from ev.venue_id then
    perform public.assert_venue_available(ev.club_id, eff_venue);
  end if;

  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  -- The new check, and note what it is conditioned on. It refuses to MOVE a
  -- game into the past; it does not refuse to edit a game that is already
  -- there. A host correcting the name or the notes on last Tuesday's game is
  -- editing history, which this function has always allowed and which
  -- rejecting `eff_starts < now()` outright would break -- an event's own
  -- stored instant is the one thing it is guaranteed to have.
  --
  -- One acknowledged edge: for an already-past event inside a DST fall-back's
  -- repeated local hour, a duration-only edit round-trips its wall clock to
  -- the OTHER of the two instants, which is `distinct from` the stored one
  -- and in the past, so it is refused. That is the same instant-moving edit
  -- the check exists to stop, arriving by an unlucky door; the alternative
  -- (dropping the `distinct from` half) would refuse every edit to every past
  -- game, which is far worse.
  if eff_starts is distinct from ev.starts_at and eff_starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    -- array_append, not `||` with a text literal on the right: that resolves
    -- to the anyarray-concatenation overload and fails with "malformed array
    -- literal" (22P02). See 20260823020000.
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
    if new_game_mode is not null
       and new_game_mode is distinct from ev.game_mode then
      next_overrides := array_append(next_overrides, 'game_mode');
    end if;
    if new_seating_mode is not null
       and new_seating_mode is distinct from ev.seating_mode then
      next_overrides := array_append(next_overrides, 'seating_mode');
    end if;
    -- Not "new_capacity is distinct from ev.capacity": a raw comparison of
    -- the argument cannot tell "capacity not touched by this call" from
    -- "explicitly cleared to null" (both leave new_capacity null). eff_capacity
    -- already resolves clear_capacity, so it reads as "not touched" (equal to
    -- ev.capacity) exactly when this call did not mean to change it -- see the
    -- file-level comment.
    if eff_capacity is distinct from ev.capacity then
      next_overrides := array_append(next_overrides, 'capacity');
    end if;

    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  -- ADDED
  details_changed := trim(eff_title) is distinct from trim(ev.title)
    or eff_venue is distinct from ev.venue_id
    or trim(eff_notes) is distinct from trim(ev.notes)
    or eff_starts is distinct from ev.starts_at
    or eff_ends is distinct from ev.ends_at;

  update public.events set
    title              = trim(eff_title),
    venue_id           = eff_venue,
    notes              = eff_notes,
    starts_at          = eff_starts,
    ends_at            = eff_ends,
    check_in_required  = eff_check_in,
    fee_cents          = eff_fee,
    min_spend_cents    = eff_min_spend,
    game_mode          = eff_game_mode,
    seating_mode       = eff_seating,
    capacity           = eff_capacity,
    overrides          = next_overrides,
    -- ADDED: stamp only when a detail actually changes.
    details_changed_at = case when details_changed then now()
                              else ev.details_changed_at end
  where id = target_event;

  -- ADDED: the editor has seen their own change.
  if details_changed then
    insert into public.event_views (profile_id, event_id, seen_at)
    values (auth.uid(), target_event, now())
    on conflict (profile_id, event_id) do update set seen_at = excluded.seen_at;
  end if;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode,
  public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode,
  public.seating_mode, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------------
create or replace function public.update_event_series(
  target_series         uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_start_time        time default null,
  new_duration          int default null,
  new_table_count       int default null,
  new_ends_on           date default null,
  include_overridden    boolean default false,
  clear_ends_on         boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null,
  new_seating_mode      public.seating_mode default null,
  new_capacity          int default null,
  clear_capacity        boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se                  public.event_series;
  club_tz             text;
  eff_title           text;
  eff_venue           uuid;
  eff_notes           text;
  eff_start           time;
  eff_dur             int;
  eff_count           int;
  eff_ends            date;
  eff_check_in        boolean;
  eff_fee             int;
  eff_min_spend       int;
  eff_game_mode       public.game_mode;
  eff_seating_mode    public.seating_mode;
  eff_capacity        int;
  touched_title       boolean;
  touched_venue       boolean;
  touched_notes       boolean;
  touched_time        boolean;
  touched_check_in    boolean;
  touched_fee         boolean;
  touched_min_spend   boolean;
  touched_game_mode   boolean;
  touched_seating_mode boolean;
  touched_capacity    boolean;
begin
  select * into se from public.event_series where id = target_series for update;

  if se.id is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(se.club_id);

  select timezone into club_tz from public.clubs where id = se.club_id;

  -- CHANGED: null = leave the name alone; '' (or whitespace) = clear it.
  eff_title := case when new_title is null then se.title
                    else nullif(trim(new_title), '') end;
  eff_venue := coalesce(new_venue_id, se.venue_id);
  eff_notes := coalesce(new_notes, se.notes);
  eff_start := coalesce(new_start_time, se.start_time);
  eff_dur   := coalesce(new_duration, se.duration_minutes);
  eff_count := coalesce(new_table_count, se.table_count);
  eff_check_in := coalesce(new_check_in_required, se.check_in_required);
  eff_fee := coalesce(new_fee_cents, se.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, se.min_spend_cents);
  eff_game_mode := coalesce(new_game_mode, se.game_mode);
  eff_seating_mode := coalesce(new_seating_mode, se.seating_mode);
  -- Same clear_capacity-wins precedence as update_event; see the file-level
  -- comment on the capacity null-semantics trap.
  eff_capacity := case when clear_capacity then null
                       else coalesce(new_capacity, se.capacity) end;
  -- `clear_ends_on` wins over `new_ends_on` outright -- there is no reading
  -- of "clear it AND set it to this date" that makes sense, so precedence,
  -- not an error, is the simplest correct answer.
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  -- The new guard (this migration). Mirrors update_event's own, and
  -- create_event_series' sibling create_event's `capacity_limit < 1` check
  -- -- see the file-level comment above.
  if eff_capacity is not null and eff_capacity < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  -- The gate. Compared against `se`, the pre-edit snapshot, and computed
  -- before the UPDATE below overwrites the stored row.
  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;
  touched_check_in := eff_check_in is distinct from se.check_in_required;
  touched_fee := eff_fee is distinct from se.fee_cents;
  touched_min_spend := eff_min_spend is distinct from se.min_spend_cents;
  touched_game_mode := eff_game_mode is distinct from se.game_mode;
  touched_seating_mode := eff_seating_mode is distinct from se.seating_mode;
  touched_capacity := eff_capacity is distinct from se.capacity;

  if eff_venue is distinct from se.venue_id then
    perform public.assert_venue_available(se.club_id, eff_venue);
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
    min_spend_cents  = eff_min_spend,
    game_mode        = eff_game_mode,
    seating_mode     = eff_seating_mode,
    capacity         = eff_capacity
  where id = target_series;

  if touched_title then
    update public.events e set title = trim(eff_title),
      -- ADDED
      details_changed_at = case when trim(e.title) is distinct from trim(eff_title)
                                then now() else e.details_changed_at end
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue,
      -- ADDED
      details_changed_at = case when e.venue_id is distinct from eff_venue
                                then now() else e.details_changed_at end
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes,
      -- ADDED
      details_changed_at = case when trim(e.notes) is distinct from trim(eff_notes)
                                then now() else e.details_changed_at end
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

  if touched_game_mode then
    update public.events e set game_mode = eff_game_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('game_mode' = any(e.overrides)));
  end if;

  if touched_seating_mode then
    update public.events e set seating_mode = eff_seating_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('seating_mode' = any(e.overrides)));
  end if;

  if touched_capacity then
    update public.events e set capacity = eff_capacity
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('capacity' = any(e.overrides)));
  end if;

  -- One guard for both instants: a hand-set 6:30-9:30 week must not keep its
  -- start and silently take the series' new length.
  if touched_time then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur),
      -- ADDED
      details_changed_at = case
        when e.starts_at is distinct from
               (e.occurrence_date + eff_start) at time zone club_tz
          or e.ends_at is distinct from
               ((e.occurrence_date + eff_start) at time zone club_tz)
                 + make_interval(mins => eff_dur)
        then now() else e.details_changed_at end
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  -- Clear only the keys this edit actually changed.
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
        or (k = 'game_mode' and touched_game_mode)
        or (k = 'seating_mode' and touched_seating_mode)
        or (k = 'capacity' and touched_capacity)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run REMOVES what now falls outside it -- see
  -- 20260824000000's file-level comment for why deleting, not cancelling,
  -- is the correct verb and what it buys. `eff_ends is not null` is what
  -- keeps this branch from firing when the run is instead being UNCAPPED
  -- (clear_ends_on, or a plain widening new_ends_on): there is nothing
  -- outside a boundary at infinity. A widening new_ends_on does enter this
  -- branch and matches no rows, which is correct and costs one indexed
  -- delete (plus, now, one indexed select that also matches no rows).
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    -- Told, not just dropped. See the file-level comment above for the
    -- event_id-cascade trap this INSERT has to run ahead of the DELETE to
    -- avoid, and why it is one row per member rather than per booking.
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
      and b.status in ('confirmed', 'waitlisted', 'invited')  -- (changed by 20260924103100)
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

  -- Extending it, clearing it, or changing nothing, all want the horizon
  -- topped up -- for this series only. With the delete above, this is also
  -- what makes shortening reversible: the freed slots are refilled here the
  -- moment the end date moves back out or goes away.
  -- ADDED: the editor has seen every occurrence this edit stamped. now() is
  -- the transaction's timestamp, so it picks out exactly the rows stamped
  -- above (the shortening delete has already removed any it dropped).
  insert into public.event_views (profile_id, event_id, seen_at)
  select auth.uid(), e.id, now()
  from public.events e
  where e.series_id = target_series and e.details_changed_at = now()
  on conflict (profile_id, event_id) do update set seen_at = excluded.seen_at;

  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- outbox_render_context (service-role only, as before)
-- ---------------------------------------------------------------------------
create or replace function public.outbox_render_context(p_ids uuid[])
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  recipient_id      uuid,
  recipient_name    text,
  recipient_email   text,
  channel           text,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
  -- Whoever did the thing this message is about: booked the seat, declined
  -- it, or cancelled it. "Alice saved you a seat" is a different email from
  -- "someone saved you a seat".
  actor_name        text,
  broadcast_subject text,
  broadcast_body    text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.kind,
         o.payload,
         o.recipient_id,
         p.display_name,
         u.email,
         public.resolve_notify_channel(o.recipient_id),
         o.club_id,
         c.name,
         o.event_id,
         public.event_headline(e.title, e.game_mode),  -- CHANGED
         /*
          * 20260825042000 (series shortening) writes event_cancelled rows
          * with event_id = null on purpose -- the dropped occurrence is
          * deleted in the same transaction, and an outbox row still
          * pointing at it would cascade-delete right along with it. That
          * migration carries the occurrence's starts_at in the payload
          * for exactly this: so the fact survives the row that caused it.
          * Guarded with pg_input_is_valid rather than a bare ::timestamptz
          * cast -- most kinds carry no 'starts_at' key at all, and an
          * unguarded cast raises 22P02 on a missing or malformed value,
          * killing the whole batch over one oddly-shaped message.
          *
          * event_title is deliberately left NULL here, not backfilled the
          * same way: the event row is gone and that payload never
          * captured a title, so there is nothing to fall back to. The
          * template layer already degrades to "A game" / "the game" for
          * a null title.
          */
         coalesce(
           e.starts_at,
           case when pg_input_is_valid(o.payload->>'starts_at', 'timestamptz')
                then (o.payload->>'starts_at')::timestamptz
                end
         ),
         c.timezone,
         t.label,
         pa.display_name,
         bc.subject,
         bc.body,
         o.created_at
    from public.notification_outbox o
    join public.profiles p on p.id = o.recipient_id
    join auth.users      u on u.id = o.recipient_id
    join public.clubs    c on c.id = o.club_id
    left join public.events e on e.id = o.event_id
    /*
     * Compared as text, deliberately. Casting `payload->>'booking_id'` to
     * uuid would raise 22P02 for any kind whose payload has no such key or
     * whose value is not a uuid -- killing the whole batch because one
     * message had a differently shaped payload. Text comparison simply
     * misses instead.
     */
    left join public.bookings bk
           on bk.id::text = o.payload->>'booking_id'
    left join public.event_tables t
           on t.id::text = coalesce(o.payload->>'event_table_id',
                                    bk.event_table_id::text)
    left join public.broadcasts bc
           on bc.id::text = o.payload->>'broadcast_id'
    /*
     * The actor, whichever key this kind uses to name them. coalesce rather
     * than three joins because exactly one of these is ever present and the
     * templates only ever want "who did this".
     *
     * bk.cancelled_by is a fourth, lower-priority source, not a fourth
     * payload key: cancel_event (20260825040000) sets bookings.cancelled_by
     * to the host who cancelled but writes only {'booking_id': ...} into
     * the payload, so event_cancelled rows from that path had no actor at
     * all -- inconsistent with booking_cancelled_by_host, which duplicates
     * its actor into the payload on purpose. bk is already joined on
     * booking_id, so this reaches the same fact without a new join. The
     * series-shortening event_cancelled rows (20260825042000) carry no
     * booking_id that still resolves -- the booking row is cascade-deleted
     * along with the occurrence -- so bk is null there and this fallback
     * stays null too, which is correct: nobody "cancelled" that occurrence,
     * it was dropped by shortening the series.
     *
     * Gated to `o.kind = 'event_cancelled'`, not left open to every kind.
     * bk.cancelled_by is read live, at render time -- not snapshotted when
     * the outbox row was queued -- and `waitlist_promoted` (20260825010000,
     * 20260825100000) and `unseated` (20260825040000) both write
     * {'booking_id': ...} with no actor key, the same payload shape this
     * fallback targets. A promoted member's booking can be cancelled while
     * their waitlist_promoted row is still waiting to drain -- the lease,
     * backoff and quiet-hour holds can leave it queued for a while -- and
     * an unscoped fallback would then name whoever cancelled the booking
     * as the person who promoted them. Scoping to the one kind that
     * actually wants this fact keeps the other kinds' "no actor" correctly
     * null.
     *
     * bk.booked_by is deliberately NOT added here at all. It is reachable
     * through the same join, but for 'unseated' (20260825040000's
     * remove_event_table) it would name the wrong person: booked_by is
     * whoever originally booked the seat, not the host who removed the
     * table, and that kind's payload carries no actor key precisely
     * because removing a table has no per-recipient actor to name.
     * Payload keys still win over the bk.cancelled_by fallback: it is
     * checked last.
     */
    left join public.profiles pa
           on pa.id::text = coalesce(
                o.payload->>'booked_by',
                o.payload->>'declined_by',
                -- accept_booking_invite (20260924103000) names the invitee
                -- who accepted. Checked after booked_by: that row's
                -- booked_by is not in its payload, so there is no clash.
                o.payload->>'accepted_by',
                o.payload->>'cancelled_by',
                case when o.kind = 'event_cancelled'
                     then bk.cancelled_by::text end)
   where o.id = any(p_ids);
$$;

revoke execute on function public.outbox_render_context(uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fetch_my_threads
-- ---------------------------------------------------------------------------
create or replace function public.fetch_my_threads()
returns table (
  thread_id            uuid,
  kind                 text,
  title                text,
  club_id              uuid,
  club_name            text,
  member_count         int,
  last_body            text,
  last_author          text,
  last_is_announcement boolean,
  last_message_at      timestamptz,
  unread               int,
  event_id             uuid,
  event_starts_at      timestamptz,
  event_timezone       text
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (select (select auth.uid()) as id),

  /*
   * One row per thread the viewer should see, carrying the FLOOR that
   * unread counts from. The floor is never earlier than the moment they
   * joined — without it, a member joining a three-year-old club opens the
   * app to a badge reading 400, and somebody added to an old group inherits
   * a stranger's backlog as their own homework.
   */
  visible as (
    -- Club threads: one per active membership, row or no row.
    select c.id            as club_id,
           null::uuid      as event_id,
           t.id            as thread_id,
           'club'::text    as kind,
           cm.joined_at    as floor_at,
           t.title         as raw_title,
           t.last_message_at
      from viewer v
      join public.club_members cm
        on cm.profile_id = v.id and cm.status = 'active'
      join public.clubs c on c.id = cm.club_id
      left join public.message_threads t
        on t.club_id = c.id and t.event_id is null

    union all

    -- Game threads: with at least one message, until 24 hours after the
    -- game ends. Not deleted then — still readable from the game screen —
    -- it simply stops competing for attention in a list about what happens
    -- next.
    select t.club_id, t.event_id, t.id, 'game'::text,
           cm.joined_at, t.title, t.last_message_at
      from viewer v
      join public.message_threads t on t.event_id is not null
      join public.events e on e.id = t.event_id
      join public.club_members cm
        on cm.club_id = t.club_id
       and cm.profile_id = v.id
       and cm.status = 'active'
     where t.last_message_at is not null
       and now() < e.ends_at + interval '24 hours'
       and public.can_read_thread(t.id)

    union all

    -- Groups: always, from creation. joined_at is the floor here.
    select t.club_id, t.event_id, t.id, 'group'::text,
           tm.joined_at, t.title, t.last_message_at
      from viewer v
      join public.thread_members tm on tm.profile_id = v.id
      join public.message_threads t
        on t.id = tm.thread_id and t.club_id is null
  )

  select
    v.thread_id,
    -- A direct message is a group of two, decided here rather than stored.
    case when v.kind = 'group' and coalesce(g.member_count, 0) = 2
         then 'direct' else v.kind end,
    case
      -- Just the club's name -- see 20260829090000's header comment for why
      -- this no longer says "Everyone at " (this migration only reproduces
      -- that change verbatim; see this file's own header for why).
      when v.kind = 'club' then c.name
      when v.kind = 'game' then public.event_headline(e.title, e.game_mode)  -- CHANGED
      when coalesce(g.member_count, 0) = 2 then g.other_name
      -- An untitled group is named from its members at READ time. A name
      -- frozen at creation goes stale the moment somebody is added.
      else coalesce(nullif(trim(v.raw_title), ''), g.first_names)
    end,
    v.club_id,
    c.name,
    case
      when v.kind = 'club' then (
        select count(*)::int from public.club_members cm
         where cm.club_id = v.club_id and cm.status = 'active')
      when v.kind = 'game' then (
        select count(*)::int from public.bookings b
         where b.event_id = v.event_id and b.status = 'confirmed')
      else coalesce(g.member_count, 0)
    end,
    last.body,
    last.display_name,
    coalesce(last.is_announcement, false),
    v.last_message_at,
    coalesce(u.n, 0),
    v.event_id,
    e.starts_at,
    c.timezone
  from visible v
  left join public.clubs c on c.id = v.club_id
  left join public.events e on e.id = v.event_id

  left join lateral (
    select m.body, m.is_announcement, p.display_name
      from public.messages m
      join public.profiles p on p.id = m.author_id
     where m.thread_id = v.thread_id
     order by m.created_at desc
     limit 1
  ) last on true

  left join lateral (
    select count(*)::int as member_count,
           string_agg(split_part(p.display_name, ' ', 1), ', '
                      order by p.display_name)
             filter (where p.id <> (select auth.uid())) as first_names,
           -- Only ever read when member_count = 2, where max() over one row
           -- is that row.
           max(p.display_name)
             filter (where p.id <> (select auth.uid())) as other_name
      from public.thread_members tm
      join public.profiles p on p.id = tm.profile_id
     where tm.thread_id = v.thread_id
  ) g on v.kind = 'group'

  left join lateral (
    /*
     * A club thread's watermark is per POST; every other kind's is the
     * single thread_reads row it has always been.
     *
     * The club branch reads each message's OWN post's marker — `coalesce(
     * m.root_id, m.id)` is the post a message belongs to, which for a root
     * is itself. That is what makes reading one announcement leave the
     * others' dots alone, and it is the whole reason post_reads exists.
     *
     * Both branches floor at v.floor_at, so a member joining an old club
     * still does not inherit a stranger's backlog as their own homework.
     */
    select case when v.kind = 'club' then (
        select count(*)::int
          from public.messages m
         where m.thread_id = v.thread_id
           and m.author_id <> (select auth.uid())
           and m.created_at > greatest(
                 v.floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = coalesce(m.root_id, m.id)
                              and pr.profile_id = (select auth.uid())),
                          v.floor_at))
      ) else (
        select count(*)::int
          from public.messages m
         where m.thread_id = v.thread_id
           and m.author_id <> (select auth.uid())
           and m.created_at > greatest(
                 v.floor_at,
                 coalesce((select tr.last_read_at
                             from public.thread_reads tr
                            where tr.thread_id = v.thread_id
                              and tr.profile_id = (select auth.uid())),
                          v.floor_at))
      ) end as n
  ) u on true

  order by v.last_message_at desc nulls last;
$$;

revoke execute on function public.fetch_my_threads() from public, anon;
grant execute on function public.fetch_my_threads() to authenticated;

-- ---------------------------------------------------------------------------
-- my_upcoming_bookings
-- ---------------------------------------------------------------------------
create or replace function public.my_upcoming_bookings()
returns table (
  booking_id       uuid,
  group_id         uuid,
  event_id         uuid,
  club_id          uuid,
  club_name        text,
  event_title      text,
  starts_at        timestamptz,
  club_timezone    text,
  venue_name       text,
  event_table_id   uuid,
  table_label      text,
  status           public.booking_status,
  booked_by        uuid,
  booked_by_name   text,
  offer_id         uuid,
  offer_seats      int,
  offer_expires_at timestamptz,
  waitlist_position  int,
  check_in_required  boolean,
  check_in_state     public.attendance_state,
  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,
  fee_cents          int,
  min_spend_cents    int,
  invite_holds_seat  boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id, b.group_id, b.event_id, b.club_id, c.name,
    public.event_headline(e.title, e.game_mode),  -- CHANGED
    e.starts_at,
    c.timezone, v.name, b.event_table_id, t.label, b.status,
    b.booked_by, bp.display_name,
    po.id, po.offered_seat_count, po.expires_at,
    case when b.status = 'invited' or g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    e.check_in_required,
    ci.state,
    case when e.check_in_required
         then e.starts_at - interval '1 hour' end,
    case when e.check_in_required then e.ends_at end,
    e.fee_cents,
    e.min_spend_cents,
    b.invite_holds_seat
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
   and b.status <> 'invited'
  left join public.check_ins ci
    on ci.event_id = b.event_id and ci.profile_id = b.profile_id
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted', 'invited')
    and e.status = 'published'
    and e.ends_at > now()
    and (b.status <> 'invited' or e.starts_at > now())
  order by e.starts_at, c.name;
$$;

revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant execute on function public.my_upcoming_bookings() to authenticated;

-- ---------------------------------------------------------------------------
-- fetch_my_pending_invites
-- ---------------------------------------------------------------------------
create or replace function public.fetch_my_pending_invites()
returns table (
  id uuid,
  club_id uuid,
  club_name text,
  event_id uuid,
  event_title text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    return;
  end if;

  -- `auth.users` is aliased here, unlike the identical-looking lookup in
  -- accept_club_invite/decline_club_invite: this function's `returns table
  -- (id uuid, ...)` implicitly declares `id` as an OUT parameter in scope
  -- for the whole function body, so a bare `where id = caller` is ambiguous
  -- between that parameter and `auth.users.id` -- confirmed by reproducing
  -- it directly (`ERROR: column reference "id" is ambiguous`). The other
  -- two functions return a scalar (jsonb/boolean), so they have no such
  -- parameter and no ambiguity.
  select email into caller_email from auth.users u where u.id = caller;
  if caller_email is null then
    return;
  end if;

  return query
    select
      ci.id,
      ci.club_id,
      c.name as club_name,
      ci.event_id,
      public.event_headline(e.title, e.game_mode) as event_title  -- CHANGED
    from public.club_invites ci
    join public.clubs c on c.id = ci.club_id
    left join public.events e on e.id = ci.event_id
    where lower(ci.email) = lower(caller_email)
      and ci.accepted_at is null
      and ci.declined_at is null
      and ci.expires_at > now()
    order by ci.created_at;
end;
$$;

revoke execute on function public.fetch_my_pending_invites() from public, anon;
grant execute on function public.fetch_my_pending_invites() to authenticated;
