/*
 * The Board redesign (club-hub phase 4): hearts on posts, and one feed RPC
 * that returns everything a post card needs in a single round trip.
 *
 * fetch_club_posts (20260830021000) stays as it is; fetch_club_feed is a
 * superset of its columns with the same access rule, the same club-board-only
 * guard and the same unread / last_activity arithmetic.
 */

-- ---------------------------------------------------------------------
-- post_hearts: one heart per member per root post.
--
-- Not a client surface at all: no policies, every privilege revoked. Hearts
-- are written only by toggle_post_heart and read only through
-- fetch_club_feed (a count plus the caller's own flag — never a list of who
-- hearted).
-- ---------------------------------------------------------------------
create table public.post_hearts (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

-- The primary key already serves "hearts on this post"; this one serves the
-- profile_id side of the cascade from profiles.
create index post_hearts_profile_id_idx on public.post_hearts (profile_id);

alter table public.post_hearts enable row level security;
-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke all on public.post_hearts from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- toggle_post_heart: flip the caller's heart on one root post and return the
-- new state (true = hearted).
-- ---------------------------------------------------------------------
create function public.toggle_post_heart(p_post uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  msg    public.messages;
  th     public.message_threads;
begin
  if caller is null then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  select * into msg from public.messages where id = p_post;

  -- Readability first, so a stranger learns nothing about which ids are
  -- posts. An id that names no message at all has no thread to be refused
  -- from and falls through to not_a_post below, which reveals nothing.
  if found and not public.can_read_thread(msg.thread_id) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  if found then
    select * into th from public.message_threads where id = msg.thread_id;
  end if;

  if msg.id is null
     or msg.root_id is not null
     or th.club_id is null
     or th.event_id is not null then
    raise exception 'not_a_post' using errcode = '22023';
  end if;

  /*
   * Serialize toggles by the same member on the same post. Without this, two
   * concurrent taps both see "no heart", both insert, one is swallowed by
   * the primary key, and both return true — the second tap's intent (off) is
   * lost. With it, the second waits for the first and sees its row. The
   * primary key alone already guarantees the count can never double.
   */
  perform pg_advisory_xact_lock(
    hashtextextended('post_heart:' || p_post::text || ':' || caller::text, 0));

  delete from public.post_hearts
   where message_id = p_post and profile_id = caller;
  if found then
    return false;
  end if;

  insert into public.post_hearts (message_id, profile_id)
  values (p_post, caller)
  on conflict do nothing;
  return true;
end;
$$;

revoke execute on function public.toggle_post_heart(uuid) from public, anon;
grant execute on function public.toggle_post_heart(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- fetch_club_feed: one page of a club board's posts, ready to render.
--
-- p_order 'recent' keys on created_at, 'activity' on last_activity_at
-- (greatest of created_at and last_reply_at — fetch_club_posts' definition).
-- Paging is keyset on (key, id) descending: pass the last row's key as
-- p_before and its id as p_before_id. p_before alone (no id) still pages,
-- strictly before that key, for callers that only have a timestamp.
-- ---------------------------------------------------------------------
create function public.fetch_club_feed(
  target_thread uuid,
  p_limit       int default 30,
  p_before      timestamptz default null,
  p_before_id   uuid default null,
  p_order       text default 'recent'
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
  unread           int,
  author_role      public.club_role,
  heart_count      int,
  hearted_by_me    boolean,
  attachments      jsonb,
  recent_comments  jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller    uuid := (select auth.uid());
  floor_at  timestamptz;
  thread_club uuid;
  by_activity boolean;
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  -- Same guard, same words as fetch_club_posts (20260830021000): a game or
  -- group thread has no posts to list.
  select t.club_id into thread_club
    from public.message_threads t
   where t.id = target_thread
     and t.club_id is not null
     and t.event_id is null;
  if thread_club is null then
    raise exception 'only a club has posts to list' using errcode = '22023';
  end if;

  -- An unrecognised order is a caller bug; refusing it beats silently
  -- handing back a differently-ordered page the client would then key on.
  case coalesce(p_order, 'recent')
    when 'recent'   then by_activity := false;
    when 'activity' then by_activity := true;
    else raise exception 'unknown feed order' using errcode = '22023';
  end case;

  select cm.joined_at into floor_at
    from public.club_members cm
   where cm.club_id = thread_club
     and cm.profile_id = caller
     and cm.status = 'active';

  -- As in fetch_club_posts: can_read_thread's club branch already requires
  -- this active row, so the coalesce is a defensive fallback only.
  floor_at := coalesce(floor_at, 'infinity'::timestamptz);

  return query
    with posts as (
      select m.*,
             greatest(m.created_at, coalesce(m.last_reply_at, m.created_at))
               as activity_at
        from public.messages m
       where m.thread_id = target_thread
         and m.root_id is null
    ), keyed as (
      select po.*,
             case when by_activity then po.activity_at else po.created_at end
               as order_key
        from posts po
    )
    select k.id, k.author_id, p.display_name, k.body, k.subject,
           k.is_announcement, k.created_at, k.reply_count, k.last_reply_at,
           k.activity_at,
           coalesce(u.n, 0),
           am.role,
           coalesce(h.n, 0),
           coalesce(h.mine, false),
           coalesce(att.items, '[]'::jsonb),
           coalesce(rc.items, '[]'::jsonb)
      from keyed k
      join public.profiles p on p.id = k.author_id
      left join public.club_members am
        on am.club_id = thread_club
       and am.profile_id = k.author_id
       and am.status = 'active'
      left join lateral (
        select count(*)::int as n
          from public.messages r
         where (r.id = k.id or r.root_id = k.id)
           and r.author_id <> caller
           and r.created_at > greatest(
                 floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = k.id
                              and pr.profile_id = caller),
                          floor_at))
      ) u on true
      left join lateral (
        select count(*)::int as n,
               bool_or(ph.profile_id = caller) as mine
          from public.post_hearts ph
         where ph.message_id = k.id
      ) h on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height,
                   'sort_order', a.sort_order
                 ) order by a.sort_order
               ) as items
          from public.message_attachments a
         where a.message_id = k.id and a.thread_id = k.thread_id
      ) att on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', last2.id, 'author_id', last2.author_id,
                   'author_name', last2.display_name, 'body', last2.body,
                   'created_at', last2.created_at
                 ) order by last2.created_at, last2.id
               ) as items
          from (
            select r.id, r.author_id, rp.display_name, r.body, r.created_at
              from public.messages r
              join public.profiles rp on rp.id = r.author_id
             where r.root_id = k.id
             order by r.created_at desc, r.id desc
             limit 2
          ) last2
      ) rc on true
     where p_before is null
        or (p_before_id is null and k.order_key < p_before)
        or (p_before_id is not null and (k.order_key, k.id) < (p_before, p_before_id))
     order by k.order_key desc, k.id desc
     -- Bounded here as well as by the caller, as fetch_club_posts is.
     limit least(coalesce(p_limit, 30), 100);
end;
$$;

revoke execute on function
  public.fetch_club_feed(uuid, int, timestamptz, uuid, text) from public, anon;
grant execute on function
  public.fetch_club_feed(uuid, int, timestamptz, uuid, text) to authenticated;
