/*
 * Whole-branch review finding: "need a fourth" announcements broadcast
 * invite-only games to the whole club. Neither `tables_needing_a_fourth`
 * (the cron sweep) nor `announce_table_fourth` (the fan-out, called both by
 * the cron job and by the host's manual `call_for_a_fourth`) filtered on
 * `game_mode` -- a private table sitting at capacity - 1 confirmed bookings
 * would surface exactly like an open_play one, and cron would fan its
 * "come join" notification out to every eligible club member, defeating the
 * entire point of an invite-only game.
 *
 * `create or replace`, not drop+create: both functions keep their exact
 * signature and return type, only their bodies change.
 */

-- ---------------------------------------------------------------------------
-- tables_needing_a_fourth: exclude invite_only tables from the sweep outright.
-- ---------------------------------------------------------------------------
create or replace function public.tables_needing_a_fourth()
returns table (event_table_id uuid, event_id uuid, club_id uuid, stage text)
language sql
stable
set search_path = public
as $$
  select t.id, t.event_id, t.club_id, public.need_a_fourth_stage(t.id)
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where e.starts_at <= now() + interval '48 hours'
    and e.game_mode = 'open_play'
    and public.need_a_fourth_stage(t.id) is not null;
$$;

-- ---------------------------------------------------------------------------
-- announce_table_fourth: belt-and-braces guard, since call_for_a_fourth (the
-- host's manual path) calls this directly and never goes through
-- tables_needing_a_fourth's filter above.
-- ---------------------------------------------------------------------------
create or replace function public.announce_table_fourth(target_table uuid, at_stage text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t     record;
  told  int;
begin
  if at_stage not in ('tier', 'wide') then
    raise exception 'unrecognized stage: %', at_stage using errcode = '23514';
  end if;

  select tt.id, tt.event_id, tt.club_id, tt.label, tt.skill_tier
  into t
  from public.event_tables tt where tt.id = target_table;

  -- Never fan out for a private game. Belt-and-braces alongside the
  -- game_mode filter above: this function has two callers
  -- (announce_need_a_fourth, which now only ever reaches an open_play table
  -- via tables_needing_a_fourth, and call_for_a_fourth, the host's manual
  -- "call for a 4th now" button, which calls this directly with no such
  -- filter upstream of it).
  if (select e.game_mode from public.events e where e.id = t.event_id)
       = 'invite_only' then
    return 0;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select cm.profile_id, t.club_id, t.event_id, 'need_a_fourth',
         jsonb_build_object('event_table_id', t.id,
                            'table_label', t.label,
                            'stage', at_stage),
         'need_a_fourth:' || t.id::text || ':' || at_stage
           || ':' || cm.profile_id::text
  from public.club_members cm
  join public.profiles p on p.id = cm.profile_id
  where cm.club_id = t.club_id
    and cm.status = 'active'
    and not p.mute_need_a_fourth
    and public.tier_matches(t.skill_tier, p.skill_level, at_stage = 'wide')
    -- Somebody already coming to this game is not a fourth.
    and not exists (
      select 1 from public.bookings b
      where b.event_id = t.event_id and b.profile_id = cm.profile_id
        and b.status in ('confirmed', 'waitlisted'))
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  return told;
end;
$$;
