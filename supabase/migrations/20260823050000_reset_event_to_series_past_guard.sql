/*
 * Fix pass 2 on 20260823040000, closing two follow-ups from that migration's
 * review. Forward-only: 20260823040000 is left exactly as it was.
 *
 *   1. reset_event_to_series gains the `starts_at > now()` guard it shipped
 *      without.
 *   2. new_duration, new_ends_on, and the shortening branch's own
 *      `starts_at > now()` guard gain mutation-tested coverage. That is a
 *      test-only change -- see
 *      supabase/tests/database/fixtures/event_series_edits.test.sql section
 *      13 -- and touches no function, so nothing else appears below.
 */

/*
 * ---------------------------------------------------------------------------
 * reset_event_to_series: refuse a past occurrence.
 * ---------------------------------------------------------------------------
 *
 * Without this, resetting a game that already happened replaced it with
 * whatever the series looks like TODAY -- after it may since have been
 * renamed, moved and re-timed. Verified before this fix: a series edited from
 * "PAST CUSTOM / Marie's place / past notes / 21:00" to "Weekly game / The
 * Hall / base notes / 19:00" between the occurrence and the reset silently
 * overwrote a game that had already been played, with today's series values,
 * and cleared its overrides as if nothing about it had ever been true.
 *
 * The design principle this closes is stated in 20260823030000's file-level
 * comment for update_event_series -- "past occurrences are history and are
 * never rewritten" -- and applies harder here: propagation already respects
 * it via `starts_at > now()` on every statement it writes, but Reset is a
 * single button reaching exactly where propagation deliberately does not.
 * Nothing stopped it from reaching there anyway.
 *
 * Mirrors the shape of the cancelled-event refusal directly above it: same
 * errcode, same "why", checked before the write. update_event deliberately
 * keeps no such guard -- a host typing values for one specific event is a
 * different act from a reset that reaches for "whatever the series says
 * today" -- so this guard belongs here and nowhere else; update_event is not
 * touched.
 */
create or replace function public.reset_event_to_series(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev      public.events;
  se      public.event_series;
  club_tz text;
begin
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);

  if ev.series_id is null then
    raise exception 'this event is not part of a series'
      using errcode = '42501';
  end if;
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;
  if ev.starts_at <= now() then
    raise exception 'a past occurrence is history and cannot be reset'
      using errcode = '42501';
  end if;

  select * into se from public.event_series where id = ev.series_id;
  select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

  update public.events set
    title     = se.title,
    venue_id  = se.venue_id,
    notes     = se.notes,
    starts_at = (ev.occurrence_date + se.start_time) at time zone club_tz,
    ends_at   = ((ev.occurrence_date + se.start_time) at time zone club_tz)
                  + make_interval(mins => se.duration_minutes),
    overrides = '{}'
  where id = target_event;

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated rather than
-- assumed -- the house rule after 20260822045809.
revoke execute on function public.reset_event_to_series(uuid)
  from public, anon;
grant execute on function public.reset_event_to_series(uuid)
  to authenticated;
