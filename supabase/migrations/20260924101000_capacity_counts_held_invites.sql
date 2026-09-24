/*
 * Game invites: a pending invite that holds a seat TAKES that seat.
 *
 * A seat is taken by status = 'confirmed' OR (status = 'invited' and
 * invite_holds_seat) -- see 20260924100100. Four readers of occupancy
 * change, each copied verbatim from its latest definition with only that
 * predicate widened:
 *
 *   - table_free_seats (20260825000000): a held invite at a table fills it.
 *     seat_assignments, plan_seating, confirm_group_seats and
 *     place_booking all read per-table room through this, so none of them
 *     change.
 *   - event_free_seats (20260825000000): every held invite, tabled or
 *     "any table", is subtracted at event level. event_confirmed_seats and
 *     event_held_seats (promotion offers) keep their literal meanings; the
 *     invite term is its own subtraction here. plan_seating,
 *     promote_waitlist and accept_promotion_offer read admission through
 *     this, so none of them change.
 *   - need_a_fourth_stage (20260825050000): a held seat is occupied; the
 *     club is never called for a fourth over it.
 *   - announce_table_fourth (20260905150000): somebody with a pending
 *     invite to this game is not a fourth either.
 *
 * An UNHELD invite (the game was full when sent) takes nothing anywhere.
 *
 * All four signatures are unchanged, so all are `create or replace`; each
 * ACL is restated per the house rule.
 */

-- ---------------------------------------------------------------------------
-- table_free_seats
-- ---------------------------------------------------------------------------
create or replace function public.table_free_seats(target_table uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, t.capacity - (
    select count(*)::int from public.bookings b
    where b.event_table_id = t.id
      -- A held invite sits at its table exactly like a confirmed booking
      -- (game invites, 20260924100100). An unheld one never has a table.
      and (b.status = 'confirmed'
           or (b.status = 'invited' and b.invite_holds_seat))
  ))
  from public.event_tables t where t.id = target_table;
$$;

-- Internal, granted to nobody (20260825000000, 20260825061000).
revoke execute on function public.table_free_seats(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- event_free_seats
-- ---------------------------------------------------------------------------
/*
 * Floors at zero on purpose. Removing a table lowers capacity without
 * ejecting anybody, so an event can legitimately hold more confirmed
 * bookings than seats until the host sorts it out. That state admits
 * nobody new; it must not read as negative free seats.
 */
create or replace function public.event_free_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0,
    public.event_capacity(target_event)
    - public.event_confirmed_seats(target_event)
    - public.event_held_seats(target_event)
    -- Held invites, tabled or "any table" (game invites, 20260924100100).
    -- Kept out of event_confirmed_seats so "confirmed" still means
    -- confirmed, and out of event_held_seats, which is promotion offers.
    - (select count(*)::int from public.bookings
        where event_id = target_event
          and status = 'invited' and invite_holds_seat));
$$;

-- Internal, granted to nobody (20260825000000, 20260825061000).
revoke execute on function public.event_free_seats(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- need_a_fourth_stage
-- ---------------------------------------------------------------------------
/*
 * null when the table is not calling for anybody. 'tier' or 'wide'
 * otherwise. Deliberately says nothing about the 48-hour announcement
 * window: that is the cron job's business, and a host calling early is
 * asking to skip exactly that window.
 */
create or replace function public.need_a_fourth_stage(target_table uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.id is null then null
    when e.status <> 'published' then null
    when e.starts_at <= now() then null
    when t.capacity < 2 then null
    -- A seat held for a pending invite is occupied: never call the club
    -- for a fourth over it (game invites, 20260924100100).
    when (select count(*) from public.bookings b
          where b.event_table_id = t.id
            and (b.status = 'confirmed'
                 or (b.status = 'invited' and b.invite_holds_seat)))
         <> t.capacity - 1 then null
    when e.starts_at <= now() + interval '12 hours' then 'wide'
    else 'tier'
  end
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;
$$;

-- Internal (20260825050000, 20260825061000).
revoke execute on function public.need_a_fourth_stage(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- announce_table_fourth
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
    -- Somebody already coming to this game is not a fourth. Nor is somebody
    -- with a pending invite to it: they already have their own ask, and the
    -- one-active-row index would refuse them booking again anyway (game
    -- invites, 20260924100100).
    and not exists (
      select 1 from public.bookings b
      where b.event_id = t.event_id and b.profile_id = cm.profile_id
        and b.status in ('confirmed', 'waitlisted', 'invited'))
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  return told;
end;
$$;

-- Internal: security definer with no membership check of its own
-- (20260825050000, 20260825061000). 20260905150000 replaced it without
-- restating this; restated here per the house rule.
revoke execute on function public.announce_table_fourth(uuid, text)
  from public, anon, authenticated;
