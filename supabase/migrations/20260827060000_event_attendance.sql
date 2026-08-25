/*
 * The door list.
 *
 * `security definer` for the same reason event_seating is (20260825070000):
 * the profiles policy has been SELF-ONLY since 20260822180000, so a client
 * joining check_ins to profiles gets its own name and NULL for everybody
 * else — silently, with no error. Names are published deliberately, by a
 * function whose return type IS the exposure surface, and which re-asks the
 * organizer question because RLS does not protect a definer function.
 *
 * Organizer-gated, not member-gated: arrival state is operational, and
 * publishing it to the whole roster would turn it into a standing record of
 * who was late at every game they attended.
 *
 * READS ARE NOT WINDOW-BOUND. Only writes are. An organizer can open this
 * months later; the client disables the controls once the tail has closed.
 * A record you cannot look at afterwards is not a record.
 */
create function public.event_attendance(target_event uuid)
returns table (
  profile_id     uuid,
  display_name   text,
  skill_level    public.skill_level,
  event_table_id uuid,
  table_label    text,
  table_position int,
  booking_status public.booking_status,
  state          public.attendance_state,
  recorded_by    uuid,
  recorded_at    timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_club uuid;
begin
  select e.club_id into target_club
    from public.events e where e.id = target_event;

  -- Folded together so "no such event" and "an event you do not organize"
  -- are the same answer to somebody holding a guessed uuid.
  if target_club is null or not public.is_club_organizer(target_club) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  return query
  /*
   * `union all`, not `union`, and the not-exists is what makes that safe:
   * the two arms are disjoint by construction, so there is nothing for
   * `union`'s dedup to do except cost a sort. Anyone with a confirmed
   * booking comes from the first arm WITH their table; a check_ins row for
   * that same person would otherwise produce a second, table-less row for
   * them.
   */
  with people as (
    select b.profile_id as pid,
           b.event_table_id as tid,
           b.status as bstatus
      from public.bookings b
     where b.event_id = target_event
       and b.status = 'confirmed'
    union all
    select c.profile_id, null::uuid, null::public.booking_status
      from public.check_ins c
     where c.event_id = target_event
       and not exists (
         select 1 from public.bookings b2
          where b2.event_id = target_event
            and b2.profile_id = c.profile_id
            and b2.status = 'confirmed')
  )
  select p.pid,
         pr.display_name,
         pr.skill_level,
         p.tid,
         t.label,
         t.position,
         p.bstatus,
         ci.state,
         ci.recorded_by,
         ci.recorded_at
    from people p
    join public.profiles pr on pr.id = p.pid
    left join public.event_tables t on t.id = p.tid
    left join public.check_ins ci
      on ci.event_id = target_event and ci.profile_id = p.pid
   -- Table order first, then name, so the screen's grouping is stable
   -- across refetches. Nulls last puts the "any table" group after the
   -- real tables, which is where the design puts it too. profile_id is
   -- a third key, not noise: display_name has no uniqueness constraint
   -- (two blank names both default to ''), so without a final
   -- tiebreaker two people at the same table can tie on both position
   -- and name, and Postgres does not promise a stable order for ties
   -- across separate executions -- the door screen could then reorder
   -- them between refetches while the host is tapping down the list.
   order by t.position nulls last, pr.display_name, p.pid;
end;
$$;

revoke execute on function public.event_attendance(uuid) from public, anon;
grant execute on function public.event_attendance(uuid) to authenticated;
