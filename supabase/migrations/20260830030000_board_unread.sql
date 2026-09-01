/*
 * fetch_my_threads learns that a club thread's unread lives per POST.
 *
 * Signature unchanged, so no grant moves and neither closed-world array in
 * portable/grants.test.sql is touched. my_unread_counts still derives from
 * this function rather than re-deriving the CTE, so the badges and the list
 * cannot disagree about what is unread.
 *
 * Only the unread lateral changes. Everything above it — the three-way
 * union, the derived member counts, the direct-at-exactly-two rule, the
 * read-time group naming — is reproduced verbatim from the function's
 * current body (20260829050000, as amended by 20260829090000's title
 * change — "Everyone at " was dropped there, and this migration does not
 * revert it; thread_lists.test.sql's own title assertion is the check that
 * catches a copy from the wrong source).
 */
create or replace function public.fetch_my_threads()
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
      -- Just the club's name -- see 20260829090000's header comment for why
      -- this no longer says "Everyone at " (this migration only reproduces
      -- that change verbatim; see this file's own header for why).
      when v.kind = 'club' then c.name
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
    /*
     * A club thread's watermark is per POST; every other kind's is the
     * single thread_reads row it has always been.
     *
     * The club branch reads each message's OWN post's marker — `coalesce(
     * m.root_id, m.id)` is the post a message belongs to, which for a root
     * is itself. That is what makes reading one announcement leave the
     * others' dots alone, and it is the whole reason post_reads exists.
     *
     * Both branches floor at v.floor_at, so a member joining an old club
     * still does not inherit a stranger's backlog as their own homework.
     */
    select case when v.kind = 'club' then (
        select count(*)::int
          from public.messages m
         where m.thread_id = v.thread_id
           and m.author_id <> (select auth.uid())
           and m.created_at > greatest(
                 v.floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = coalesce(m.root_id, m.id)
                              and pr.profile_id = (select auth.uid())),
                          v.floor_at))
      ) else (
        select count(*)::int
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
      ) end as n
  ) u on true

  order by v.last_message_at desc nulls last;
$$;
