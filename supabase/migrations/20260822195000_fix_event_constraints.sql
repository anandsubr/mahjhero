/*
 * Fixes to the events schema landed in 20260822194000, found in review
 * before anything downstream depended on the broken behaviour.
 */

/*
 * Critical: `events.series_id`'s `on delete set null` is unreachable while
 * `events_occurrence_requires_series` stands, because nulling series_id
 * alone leaves occurrence_date populated and the biconditional check fails
 * the referential action itself -- a series with any materialized
 * occurrence could never be deleted, and it would fail with a confusing
 * 23514 rather than an honest error.
 *
 * The check stays exactly as it was; it is a real invariant, and a
 * "one-off event" that kept a vestigial occurrence_date would not be an
 * ordinary one-off event, which is the whole point of the comment this
 * fixes. Instead, a `before delete` trigger clears BOTH columns on the
 * affected events before the FK's own `on delete set null` ever runs, so by
 * the time it looks there is nothing left for it to do.
 */
create function public.event_series_detach_occurrences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set series_id = null,
      occurrence_date = null
  where series_id = old.id;

  return old;
end;
$$;

-- Never called directly -- only ever fired by the trigger below, which runs
-- it with the definer's rights regardless of who deletes the series.
revoke execute on function public.event_series_detach_occurrences()
  from public, anon;

create trigger event_series_before_delete
  before delete on public.event_series
  for each row execute function public.event_series_detach_occurrences();

/*
 * Important: event_tables' select policy was a bare is_club_member check,
 * so a plain member could read the tables of a draft event even though
 * events' own policy hides the draft itself. Visibility now follows the
 * parent row exactly, by re-asking the question through the events table
 * (and therefore through events' own RLS) rather than duplicating the
 * draft carve-out here -- one draft rule to keep in sync, not two.
 */
drop policy event_tables_select_member on public.event_tables;

create policy event_tables_select_member on public.event_tables
  for select using (
    public.is_club_member(club_id)
    and exists (
      select 1 from public.events e where e.id = event_tables.event_id
    )
  );

/*
 * Minor: `overrides <@ array[...]` is containment, not set equality, so it
 * says nothing about shape. A multi-dimensional array like
 * array[array['title'],array['notes']] passes it today, and would only
 * fail later -- at Task 5's array_append, with errcode 2202E -- once a host
 * actually edited that occurrence again. Rejecting anything but a flat
 * array at write time turns that into an honest 23514 up front.
 * array_ndims('{}') is NULL, so an empty array still passes, which is
 * correct: no overrides recorded is not a shape violation.
 */
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at']
    and array_ndims(overrides) = 1
  );

/*
 * Minor: two redundant indexes, pure write cost with no read they serve
 * that isn't already served.
 *
 * events_series_idx (series_id) is subsumed by the partial unique index
 * events_series_occurrence_idx (series_id, occurrence_date) where series_id
 * is not null -- the planner already uses it for `where series_id = ?` --
 * and events_series_idx additionally indexes every NULL-series_id row,
 * which will be the majority of the table.
 *
 * event_tables_event_idx (event_id) is subsumed by the leading column of
 * unique (event_id, position).
 */
drop index public.events_series_idx;
drop index public.event_tables_event_idx;
