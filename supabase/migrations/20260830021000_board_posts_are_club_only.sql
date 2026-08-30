/*
 * fetch_club_posts learns to refuse a thread that has no posts at all.
 *
 * DROP then CREATE, not CREATE OR REPLACE, for the reason
 * 20260830011000 already gives for post_message: the signature is
 * unchanged (still 3 arguments), so an overload is not the risk — but a
 * bare `create or replace function` on plpgsql cannot reorder or
 * restructure the body's declared logic paths the way this change does,
 * and DROP/CREATE is the pattern this migration series already uses for
 * that shape of edit. The closed-world arrays in portable/grants.test.sql
 * key on the signature, which does not move, but the grants themselves are
 * destroyed by the drop and must be re-issued below.
 */
drop function public.fetch_club_posts(uuid, int, timestamptz);

/*
 * The board: one row per root, most recent activity first.
 *
 * `unread` counts the root itself as well as its replies — a post you have
 * never opened is unread whether or not anybody has answered it.
 *
 * The floor is the member's club_members.joined_at, exactly as
 * fetch_my_threads uses it: without it, somebody joining a three-year-old
 * club opens the board to a badge reading 400. Visibility and obligation
 * are different questions, and a new member inherits the first without the
 * second.
 */
create function public.fetch_club_posts(
  target_thread uuid,
  p_limit       int default 30,
  p_before      timestamptz default null
)
returns table (
  id               uuid,
  author_id        uuid,
  author_name      text,
  body             text,
  subject          text,
  is_announcement  boolean,
  created_at       timestamptz,
  reply_count      int,
  last_reply_at    timestamptz,
  last_activity_at timestamptz,
  unread           int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller   uuid := (select auth.uid());
  floor_at timestamptz;
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  /*
   * A club board is the only kind of thread this function knows how to
   * present as posts. can_read_thread has already settled whether the
   * caller may see this thread's messages at all — this check is not that
   * question again. It is "you asked the wrong function about this
   * thread": a game or group thread has no posts to list, and post_message
   * (20260830011000) already refuses the identical mistake on the write
   * side — 'only a club has posts to reply to' rather than silently
   * dropping p_root. Read follows write: a caller who reaches here on a
   * flat thread is told so, rather than handed every message in it
   * relabelled as roots with unread forced to zero, which is what an
   * empty-result-set answer would have amounted to — `root_id is null` is
   * true of every message in a flat thread, not of none.
   */
  if not exists (
    select 1 from public.message_threads t
     where t.id = target_thread
       and t.club_id is not null
       and t.event_id is null
  ) then
    raise exception 'only a club has posts to list' using errcode = '22023';
  end if;

  select cm.joined_at into floor_at
    from public.message_threads t
    join public.club_members cm
      on cm.club_id = t.club_id
     and cm.profile_id = caller
     and cm.status = 'active'
   where t.id = target_thread;

  -- Every caller who reaches this line already cleared the club-board
  -- guard above, and can_read_thread's own club branch (20260829010000)
  -- requires exactly the active club_members row this select is looking
  -- for — so floor_at is never actually null here. The coalesce is a
  -- defensive fallback for that guarantee, not a path this function
  -- expects to take; it stays rather than being removed so the arithmetic
  -- below keeps a non-null floor_at to depend on even if that guarantee is
  -- ever loosened.
  floor_at := coalesce(floor_at, 'infinity'::timestamptz);

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_count, m.last_reply_at,
           greatest(m.created_at, coalesce(m.last_reply_at, m.created_at)),
           coalesce(u.n, 0)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join lateral (
        select count(*)::int as n
          from public.messages r
         where (r.id = m.id or r.root_id = m.id)
           and r.author_id <> caller
           and r.created_at > greatest(
                 floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = m.id
                              and pr.profile_id = caller),
                          floor_at))
      ) u on true
     where m.thread_id = target_thread
       and m.root_id is null
       and (p_before is null
            or greatest(m.created_at, coalesce(m.last_reply_at, m.created_at))
                 < p_before)
     order by greatest(m.created_at, coalesce(m.last_reply_at, m.created_at)) desc,
              m.id desc
     -- Bounded here as well as by the caller: a client asking for 10000
     -- should get a page, not a table scan rendered into a list.
     limit least(coalesce(p_limit, 30), 100);
end;
$$;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke execute on function public.fetch_club_posts(uuid, int, timestamptz)
  from public, anon;
grant execute on function public.fetch_club_posts(uuid, int, timestamptz)
  to authenticated;
