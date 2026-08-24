/*
 * Every internal function plan 4 (bookings, waitlist promotion, "need a
 * fourth") added was revoked with `revoke execute ... from public, anon`
 * only. Supabase's hosted bootstrap grants EXECUTE on a new function
 * DIRECTLY to `authenticated` at function-creation time, and `revoke ...
 * from public` never touches a direct grant — it only removes the
 * PostgreSQL default that grants EXECUTE to the PUBLIC pseudo-role. The
 * local stack adds no such bootstrap grant, so `supabase db reset` and
 * `npm run test:db` looked completely clean while every one of these
 * sixteen functions stayed callable by any signed-in user on hosted.
 *
 * This is the same mistake, made a fourth time. It happened before to
 * `reflow_events_for_timezone` and `assert_club_organizer` (fixed in
 * 20260823030000 and 20260823020000) and to
 * `event_series_detach_occurrences` (fixed in 20260823060000, whose
 * comment names the first two and predicted a next one). `db push`ing
 * plan 4 and running `npm run test:db:remote` against the linked hosted
 * project reproduced it a fourth time: `grants.test.sql`'s "no UNEXPECTED
 * function is reachable by authenticated" assertion failed, naming exactly
 * the sixteen signatures revoked below.
 *
 * This was not cosmetic:
 *
 *   - `promote_waitlist(uuid)`, `confirm_group_seats(uuid, int)`,
 *     `close_group_if_empty(uuid)` and `announce_table_fourth(uuid, text)`
 *     are `security definer` and perform NO membership check of their
 *     own — they were written to trust their callers precisely because
 *     the plan promised they were unreachable directly (see their
 *     defining comments in 20260825010000 and 20260825050000). Reachable
 *     on hosted, any signed-in user could confirm seats off any club's
 *     waitlist, close out any booking group, or fire a "your table needs
 *     a fourth" announcement for any table in the system.
 *   - `event_capacity`, `event_confirmed_seats`, `event_held_seats`,
 *     `event_free_seats` and `table_free_seats` leak occupancy for any
 *     event id passed in — the "occupancy oracle" that
 *     20260825000000's own comment says the no-grant policy exists to
 *     prevent.
 *   - `assert_event_bookable`, `assert_players_bookable`, `plan_seating`,
 *     `seat_assignments`, `need_a_fourth_stage`, `tables_needing_a_fourth`
 *     and `tier_matches` are read-only helpers with no membership check
 *     either; reachable directly they answer questions about players,
 *     tables and events across every club, not just the caller's own.
 *
 * `create or replace` was never involved for any of these, so a plain
 * revoke is the whole fix, exactly as it was for
 * `event_series_detach_occurrences`.
 *
 * `sweep_promotion_offers()` and `announce_need_a_fourth()` are NOT here:
 * 20260825060000 already revoked both `from authenticated` explicitly, and
 * repeating that revoke would just be noise in a file meant to read as the
 * list of what was reachable and is not any more.
 */
revoke execute on function public.event_capacity(uuid) from authenticated;
revoke execute on function public.event_confirmed_seats(uuid) from authenticated;
revoke execute on function public.event_held_seats(uuid) from authenticated;
revoke execute on function public.event_free_seats(uuid) from authenticated;
revoke execute on function public.table_free_seats(uuid) from authenticated;
revoke execute on function public.assert_event_bookable(uuid) from authenticated;
revoke execute on function public.assert_players_bookable(uuid, uuid, uuid[])
  from authenticated;
revoke execute on function public.plan_seating(uuid, uuid[], uuid, boolean)
  from authenticated;
revoke execute on function public.seat_assignments(uuid, int, uuid, boolean)
  from authenticated;
revoke execute on function public.confirm_group_seats(uuid, int)
  from authenticated;
revoke execute on function public.promote_waitlist(uuid) from authenticated;
revoke execute on function public.close_group_if_empty(uuid) from authenticated;
revoke execute on function
  public.tier_matches(public.skill_tier, public.skill_level, boolean)
  from authenticated;
revoke execute on function public.need_a_fourth_stage(uuid) from authenticated;
revoke execute on function public.tables_needing_a_fourth() from authenticated;
revoke execute on function public.announce_table_fourth(uuid, text)
  from authenticated;
