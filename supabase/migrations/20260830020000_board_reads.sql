/*
 * The board's reads.
 *
 * All three are SECURITY DEFINER for the reason 20260829080000 already
 * argues at length: public.profiles has been self-row-only since
 * 20260822180000, so a PostgREST embed of profiles(display_name) resolves
 * to NULL for every row but the caller's own. Do not "fix" sender names by
 * widening profiles.
 *
 * None of them re-derives membership. can_read_thread is the same gate
 * messages_select and fetch_thread_messages already lean on; a post
 * inherits its thread's permission and has none of its own.
 */

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

  select cm.joined_at into floor_at
    from public.message_threads t
    join public.club_members cm
      on cm.club_id = t.club_id
     and cm.profile_id = caller
     and cm.status = 'active'
   where t.id = target_thread;

  -- A game thread's reader has no club_members row of their own to floor
  -- against only when the thread is not a club thread at all, and a caller
  -- who reached here on one gets an empty board rather than every message.
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

/*
 * One post: its root and its replies, in the SAME ten columns
 * fetch_thread_messages returns, so lib/messages.ts maps one row shape for
 * both and the bubble component does not learn a second one.
 */
create function public.fetch_post_messages(p_root uuid)
returns table (
  id              uuid,
  author_id       uuid,
  author_name     text,
  body            text,
  subject         text,
  is_announcement boolean,
  created_at      timestamptz,
  reply_to_id     uuid,
  reply_to_body   text,
  reply_to_author text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  th uuid;
begin
  select m.thread_id into th
    from public.messages m
   where m.id = p_root and m.root_id is null;

  -- Refused before can_read_thread is asked, and deliberately with the same
  -- words for "no such post" and "a reply, not a post": distinguishing them
  -- would let a caller probe for message ids.
  if th is null then
    raise exception 'that post is no longer here' using errcode = '22023';
  end if;

  if not public.can_read_thread(th) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
     where m.id = p_root or m.root_id = p_root
     order by m.created_at, m.id;
end;
$$;

/*
 * The per-post watermark. Guarded by can_read_thread for the same reason
 * mark_thread_read is: an unguarded write would let a member probe for
 * message ids by whether it succeeded.
 */
create function public.mark_post_read(p_root uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  th     uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select m.thread_id into th
    from public.messages m
   where m.id = p_root and m.root_id is null;

  if th is null then
    raise exception 'that post is no longer here' using errcode = '22023';
  end if;

  if not public.can_read_thread(th) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  insert into public.post_reads (root_id, profile_id, last_read_at)
  values (p_root, caller, now())
  on conflict (root_id, profile_id)
  do update set last_read_at = now();
end;
$$;

revoke execute on function public.fetch_club_posts(uuid, int, timestamptz)
  from public, anon;
revoke execute on function public.fetch_post_messages(uuid) from public, anon;
revoke execute on function public.mark_post_read(uuid) from public, anon;
grant execute on function public.fetch_club_posts(uuid, int, timestamptz)
  to authenticated;
grant execute on function public.fetch_post_messages(uuid) to authenticated;
grant execute on function public.mark_post_read(uuid) to authenticated;
