/*
 * The list, render-ready, in one call.
 *
 * The join lives in SQL for the reason the notifications spec gave for
 * claim_notification_batch: the client should not re-implement tenancy
 * rules that already live inside security definer functions. It also
 * avoids repeating the dashboard's per-club fan-out, which that plan's
 * deferred item 8 already names as chatty — a member in three clubs would
 * otherwise cost four round trips for one screen.
 *
 * `thread_id` is NULL for a club thread nobody has opened. The row is still
 * listed — the artboard always shows "Everyone at <club>" — and the client
 * calls open_thread_for_club(club_id) on tap. That is why every caller
 * navigates through open_thread_for_club rather than straight to an id:
 * one path, whether the row exists or not.
 */
create function public.fetch_my_threads()
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
      when v.kind = 'club' then 'Everyone at ' || c.name
      when v.kind = 'game' then e.title
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
    select count(*)::int as n
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
  ) u on true

  order by v.last_message_at desc nulls last;
$$;

/*
 * Derived from fetch_my_threads rather than re-deriving the same CTE, so
 * the badges and the list cannot disagree about what is unread. One row per
 * club with anything unread, plus one row with a NULL club_id covering
 * groups and directs — the "People" section's total.
 *
 * The client sums these for the tab badge and indexes them by club for the
 * dashboard chips: one round trip serves both, where two RPCs would cost
 * two per tab screen for one badge.
 */
create function public.my_unread_counts()
returns table (club_id uuid, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select t.club_id, sum(t.unread)::int
    from public.fetch_my_threads() t
   group by t.club_id
  having sum(t.unread) > 0;
$$;

revoke execute on function public.fetch_my_threads() from public, anon;
revoke execute on function public.my_unread_counts() from public, anon;
grant execute on function public.fetch_my_threads() to authenticated;
grant execute on function public.my_unread_counts() to authenticated;
