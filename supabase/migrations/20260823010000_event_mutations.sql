/*
 * Every write to events and event_tables.
 *
 * Clients hold `select` on these tables and nothing else, so this file is the
 * complete list of things that can change them. Two guards repeat in every
 * function and neither is decorative:
 *
 *   1. assert_club_organizer against the row's OWN club — not "does the
 *      caller organize something". Plan 2 shipped a policy that constrained
 *      who a row was about and not which club it belonged to, and any member
 *      could make themselves host of any club. The helper raises; the
 *      argument is what matters.
 *
 *   2. The venue must be reachable by that club: its own, or public. Without
 *      it, a host could attach another club's private venue to their event
 *      and its name and address would render for every one of their members —
 *      the privacy promise of `visibility = 'club'` leaking out sideways.
 *
 * A null argument means "leave this alone", never "clear this". Clearing a
 * text field is done by passing '', which is non-null and therefore an
 * intentional change.
 */

create function public.assert_venue_available(target_club uuid, target_venue uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.venues v
    where v.id = target_venue
      and (v.added_by_club_id = target_club or v.visibility = 'public')
  ) then
    raise exception 'venue not available to this club'
      using errcode = '42501';
  end if;
end;
$$;

create function public.create_event(
  target_club  uuid,
  event_title  text,
  target_venue uuid,
  event_notes  text default '',
  event_starts timestamptz default null,
  event_ends   timestamptz default null,
  table_count  int default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(event_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if event_starts is null or event_ends is null or event_ends <= event_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;
  if table_count < 1 or table_count > 20 then
    raise exception 'table count out of range' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    event_starts, event_ends, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

/*
 * Editing one occurrence. Each field that ACTUALLY changes is recorded in
 * `overrides` — so a host who moves one week to a different hall has changed
 * the address and not the schedule, and a later change to the series' start
 * time still reaches that week.
 *
 * `starts_at` covers both instants deliberately: a hand-set 6:30-9:30 week
 * must not keep its start and silently take the series' new length.
 *
 * A one-off event records nothing, because it has no series to diverge from.
 */
create function public.update_event(
  target_event  uuid,
  new_title     text default null,
  new_venue_id  uuid default null,
  new_notes     text default null,
  new_starts_at timestamptz default null,
  new_ends_at   timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
  eff_starts     timestamptz;
  eff_ends       timestamptz;
  next_overrides text[];
begin
  select * into ev from public.events where id = target_event;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);
  -- Cancelling is a different kind of statement from customising, and
  -- un-cancelling by editing would be a nasty surprise for everyone who was
  -- told the game was off.
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title  := coalesce(new_title, ev.title);
  eff_venue  := coalesce(new_venue_id, ev.venue_id);
  eff_notes  := coalesce(new_notes, ev.notes);
  eff_starts := coalesce(new_starts_at, ev.starts_at);
  eff_ends   := coalesce(new_ends_at, ev.ends_at);

  perform public.assert_venue_available(ev.club_id, eff_venue);

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    -- array_append, not `next_overrides || 'title'`: with a plain-text
    -- literal on the right, `||` resolves to the anyarray-concatenation
    -- overload rather than anyarray-append, and tries to parse 'title' as
    -- an array literal -- "malformed array literal: title" (22P02),
    -- confirmed against the live database. array_append forces the
    -- unambiguous element-append overload.
    if eff_title is distinct from ev.title then
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

    -- Editing the same field twice must not stack the key. The FROM clause
    -- reads next_overrides's current value in full before the INTO target
    -- is assigned, so this is a plain read-then-replace, not a mutation
    -- feeding on itself.
    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title     = trim(eff_title),
    venue_id  = eff_venue,
    notes     = eff_notes,
    starts_at = eff_starts,
    ends_at   = eff_ends,
    overrides = next_overrides
  where id = target_event;

  return true;
end;
$$;

/*
 * Cancelling sets status and nothing else. Booking cascades, promotion-offer
 * voiding, and telling the attendees are plan 4 and plan 6 — named here so
 * their absence is a documented boundary rather than an oversight.
 *
 * The row stays, which is also what stops materialization resurrecting a
 * cancelled week: it still occupies its (series_id, occurrence_date) slot.
 */
create function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.events set status = 'cancelled' where id = target_event;
  return true;
end;
$$;

create function public.add_event_table(target_event uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  next_pos    int;
  new_id      uuid;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  select coalesce(max(position), 0) + 1 into next_pos
  from public.event_tables where event_id = target_event;

  if next_pos > 20 then
    raise exception 'too many tables' using errcode = '23514';
  end if;

  insert into public.event_tables (event_id, club_id, label, position)
  values (target_event, owning_club, 'Table ' || next_pos, next_pos)
  returning id into new_id;

  return new_id;
end;
$$;

/*
 * Label and tier only. Capacity is not editable in this plan — every table
 * seats four. The column and its 1-8 check exist for the club that eventually
 * turns up with a five-player table, and adding a parameter here is the whole
 * change when that happens.
 */
create function public.update_event_table(
  target_table uuid,
  new_label    text default null,
  new_tier     public.skill_tier default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.event_tables set
    label      = coalesce(nullif(trim(coalesce(new_label, '')), ''), label),
    skill_tier = coalesce(new_tier, skill_tier)
  where id = target_table;

  return true;
end;
$$;

/*
 * Plan 4 attaches bookings to event_tables.id. When it does, this function
 * needs a rule for what happens to the people sitting there. It is granular
 * now — rather than a wholesale "replace the table list" — precisely so that
 * rule can be added without restructuring, and so a replace cannot orphan
 * bookings that do not exist yet.
 */
create function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  owning_event uuid;
  remaining    int;
begin
  select club_id, event_id into owning_club, owning_event
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  select count(*)::int into remaining
  from public.event_tables where event_id = owning_event;

  if remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  delete from public.event_tables where id = target_table;
  return true;
end;
$$;

-- Not granted to authenticated: it is only ever called from inside the
-- definer functions below, which run as their owner. Hosted's bootstrap
-- grants EXECUTE to authenticated directly (not through PUBLIC), so
-- `revoke ... from public` alone would leave it reachable there.
revoke execute on function public.assert_venue_available(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.create_event(
  uuid, text, uuid, text, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, timestamptz, timestamptz, int) to authenticated;

revoke execute on function public.update_event(
  uuid, text, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, timestamptz, timestamptz) to authenticated;

revoke execute on function public.cancel_event(uuid) from public, anon;
grant  execute on function public.cancel_event(uuid) to authenticated;

revoke execute on function public.add_event_table(uuid) from public, anon;
grant  execute on function public.add_event_table(uuid) to authenticated;

revoke execute on function public.update_event_table(uuid, text, public.skill_tier)
  from public, anon;
grant execute on function public.update_event_table(uuid, text, public.skill_tier)
  to authenticated;

revoke execute on function public.remove_event_table(uuid) from public, anon;
grant  execute on function public.remove_event_table(uuid) to authenticated;
