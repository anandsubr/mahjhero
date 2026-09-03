/*
 * reset_event_to_series (last redefined by
 * 20260823050000_reset_event_to_series_past_guard.sql, and not touched by
 * any later migration -- confirmed by grepping every migration for the
 * function name) copies `title`, `venue_id`, `notes`, `starts_at`, `ends_at`
 * back from the series when a host resets an overridden occurrence, then
 * clears `overrides`. It never copied back `check_in_required`, `fee_cents`,
 * or `min_spend_cents` (added after it was last written, by
 * 20260903130000_event_fees.sql / 20260903140000_event_fee_mutations.sql),
 * so a reset occurrence was marked as no longer overridden while still
 * carrying stale fee/check-in values that could disagree with the series.
 *
 * Signature is unchanged (same single `target_event uuid` argument, same
 * `returns boolean`), so this is a plain `create or replace`, not a
 * drop-and-recreate. Body is otherwise 20260823050000's own body, byte for
 * byte, with only the three new assignments added to the `update` list.
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
    title              = se.title,
    venue_id           = se.venue_id,
    notes              = se.notes,
    starts_at          = (ev.occurrence_date + se.start_time) at time zone club_tz,
    ends_at            = ((ev.occurrence_date + se.start_time) at time zone club_tz)
                            + make_interval(mins => se.duration_minutes),
    check_in_required  = se.check_in_required,
    fee_cents          = se.fee_cents,
    min_spend_cents    = se.min_spend_cents,
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
