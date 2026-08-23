/*
 * "Need a 4th".
 *
 * Nothing here is stored. A table needs a fourth when it holds
 * capacity - 1 confirmed bookings and the game starts within 48 hours;
 * the call widens to adjacent tiers inside 12 hours. Both are pure
 * functions of occupancy and time-to-start, so the screen derives them and
 * nothing can go stale, and claiming the seat is an ordinary
 * commit_booking — first commit wins on the event lock, and the call
 * disappears from everybody else's next read because it was never a row.
 *
 * The only durable artifact is the outbox row. Its dedupe_key carries the
 * table, the stage AND the recipient (see announce_table_fourth below for
 * why the recipient has to be in there too), so the 15-minute job
 * announces a table to a given person once per stage and the widening
 * announces exactly once more.
 *
 * The two windows are plain intervals against starts_at, an instant. That
 * is arithmetic on instants and not a timezone conversion; it is correct
 * under any server zone, which is why no club timezone appears here.
 */

create function public.tier_matches(
  tier  public.skill_tier,
  lvl   public.skill_level,
  wide  boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    -- A mixed table wants anybody, at either stage.
    when tier = 'mixed' then true
    when not wide then lvl::text = tier::text
    -- Wide: adjacent tiers, and the unclassified. Beginner and advanced
    -- are NOT adjacent to each other; an advanced player at a beginner
    -- table is a different evening from the one anybody signed up for.
    when lvl is null then true
    when tier = 'beginner'     then lvl in ('beginner', 'intermediate')
    when tier = 'intermediate' then true
    when tier = 'advanced'     then lvl in ('advanced', 'intermediate')
    else false
  end;
$$;

/*
 * null when the table is not calling for anybody. 'tier' or 'wide'
 * otherwise. Deliberately says nothing about the 48-hour announcement
 * window: that is the cron job's business, and a host calling early is
 * asking to skip exactly that window.
 */
create function public.need_a_fourth_stage(target_table uuid)
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
    when (select count(*) from public.bookings b
          where b.event_table_id = t.id and b.status = 'confirmed')
         <> t.capacity - 1 then null
    when e.starts_at <= now() + interval '12 hours' then 'wide'
    else 'tier'
  end
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;
$$;

create function public.tables_needing_a_fourth()
returns table (event_table_id uuid, event_id uuid, club_id uuid, stage text)
language sql
stable
set search_path = public
as $$
  select t.id, t.event_id, t.club_id, public.need_a_fourth_stage(t.id)
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where e.starts_at <= now() + interval '48 hours'
    and public.need_a_fourth_stage(t.id) is not null;
$$;

/*
 * Writes the outbox rows for one table at one stage. Returns how many
 * people were told, which is 0 on a second run for the same people — the
 * dedupe key already holds them.
 *
 * The dedupe key is 'need_a_fourth:<table>:<stage>:<recipient>', not just
 * '<table>:<stage>'. Without the recipient, every row this INSERT ...
 * SELECT produces for one table+stage would carry the exact same key —
 * and a multi-row INSERT with ON CONFLICT DO NOTHING does not keep the
 * first N-1 duplicates and skip the last one, it keeps exactly ONE row
 * total, because each row is checked against the unique index as it is
 * inserted, including the rows this same statement has already placed.
 * A table calling three eligible tiers wide would silently tell only one
 * of them. The recipient in the key is what makes each of their rows a
 * distinct key, while a rerun for the same table+stage+person is still
 * the duplicate ON CONFLICT exists to catch.
 */
create function public.announce_table_fourth(target_table uuid, at_stage text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t     record;
  told  int;
begin
  select tt.id, tt.event_id, tt.club_id, tt.label, tt.skill_tier
  into t
  from public.event_tables tt where tt.id = target_table;

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

/*
 * Every 15 minutes. Returns the number of TABLES considered, not the
 * number of people told — a table already announced at this stage is
 * still a table that needs a fourth, and reporting it is how the job's
 * own test distinguishes "nothing qualifies" from "nothing new to say".
 */
create function public.announce_need_a_fourth()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t      record;
  tables int := 0;
begin
  for t in select * from public.tables_needing_a_fourth() loop
    perform public.announce_table_fourth(t.event_table_id, t.stage);
    tables := tables + 1;
  end loop;
  return tables;
end;
$$;

/*
 * The host's "call for a fourth now", available before the 48-hour window
 * opens. Same dedupe key, so a manual call inside the window does not
 * double up with the job.
 */
create function public.call_for_a_fourth(target_table uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  at_stage    text;
begin
  select club_id into owning_club
  from public.event_tables where id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  at_stage := public.need_a_fourth_stage(target_table);
  if at_stage is null then
    raise exception 'table does not need a fourth' using errcode = '23514';
  end if;

  return public.announce_table_fourth(target_table, at_stage);
end;
$$;

revoke execute on function
  public.tier_matches(public.skill_tier, public.skill_level, boolean)
  from public, anon;
revoke execute on function public.need_a_fourth_stage(uuid)   from public, anon;
revoke execute on function public.tables_needing_a_fourth()   from public, anon;
revoke execute on function public.announce_table_fourth(uuid, text)
  from public, anon;
revoke execute on function public.announce_need_a_fourth()    from public, anon;
revoke execute on function public.call_for_a_fourth(uuid)     from public, anon;

-- Only the host's button. The client derives the call for display from
-- bookings it can already read; it does not need the helpers.
grant execute on function public.call_for_a_fourth(uuid) to authenticated;
