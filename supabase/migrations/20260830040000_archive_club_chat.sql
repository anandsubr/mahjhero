/*
 * The club threads' existing contents, reshaped into posts.
 *
 * The owner's call: the free-floating club chat that accumulated while the
 * club thread was a single scroll is throwaway, and the board should open
 * as a board rather than as shredded chat. Announcements survive as roots,
 * and the discussion that hung off them survives as their replies —
 * that discussion is exactly what the new model is built to hold.
 *
 * Everything else MOVES to archived_messages rather than being deleted.
 * The rows leave the app exactly as intended and a mistake stays
 * recoverable by a follow-up migration. archived_messages carries no
 * policy and no grant: it is a bucket, not a table the app can see.
 *
 * Game and group threads are not touched.
 */
create table public.archived_messages (
  like public.messages including defaults,
  archived_at timestamptz not null default now()
);

alter table public.archived_messages enable row level security;
revoke all on public.archived_messages from authenticated, anon;

/*
 * 1. Announcements become roots, and everything that quoted one — directly
 *    or down a chain of quotes — becomes that announcement's reply.
 *
 *    Recursive, not a single join on reply_to_id = announcement.id: a reply
 *    to a reply to an announcement is still part of that discussion, and
 *    flattening it into the announcement is the whole point of one-level
 *    nesting. Cycles are impossible — reply_to_id can only point at a row
 *    that already existed — so no cycle guard is needed.
 */
with recursive club_threads as (
  select id from public.message_threads
   where club_id is not null and event_id is null
),
descendants as (
  select m.id, m.id as owns_root
    from public.messages m
   where m.is_announcement
     and m.thread_id in (select id from club_threads)
  union all
  select c.id, d.owns_root
    from public.messages c
    join descendants d on c.reply_to_id = d.id
   where c.thread_id in (select id from club_threads)
     and not c.is_announcement
)
update public.messages m
   set root_id = d.owns_root
  from descendants d
 where m.id = d.id
   and d.id <> d.owns_root;

/*
 * 1b. An announcement that itself quoted an earlier message (legal under
 *     the pre-board post_message, which never forbade p_announce and
 *     p_reply_to together) is now a ROOT, and 20260830011000 made a root
 *     that quotes anything unstateable for every write from here on. There
 *     is no CHECK enforcing that retroactively, so a historical row like
 *     this would otherwise sit there violating the rule silently.
 *
 *     There is nothing correct to point it at: the quoted message is either
 *     about to be archived below (it was free-floating chat, since nothing
 *     that survives step 1 as a bare announcement can quote another
 *     surviving announcement — a root can't be another root's reply), or it
 *     is itself now a reply living under a *different* post, which would be
 *     a cross-post quote if kept. Dropping the pointer — not the message —
 *     matches on delete set null (reply_to_id)'s own precedent: the
 *     announcement's words are not going anywhere, only the stale citation
 *     is cleared.
 *
 *     This must run before step 2's archival test below, but the ordering
 *     doesn't actually matter for correctness — it targets is_announcement
 *     rows, which step 2 never touches.
 */
update public.messages m
   set reply_to_id = null
  from public.message_threads t
 where m.thread_id = t.id
   and t.club_id is not null and t.event_id is null
   and m.is_announcement
   and m.reply_to_id is not null;

/*
 * 2. Everything else in a club thread leaves. `root_id is null` after step
 *    1 means "was never part of an announcement's discussion".
 */
with club_threads as (
  select id from public.message_threads
   where club_id is not null and event_id is null
),
doomed as (
  select m.id
    from public.messages m
   where m.thread_id in (select id from club_threads)
     and not m.is_announcement
     and m.root_id is null
)
insert into public.archived_messages
  (id, thread_id, author_id, body, subject, is_announcement, broadcast_id,
   reply_to_id, created_at, root_id, reply_count, last_reply_at)
select m.id, m.thread_id, m.author_id, m.body, m.subject, m.is_announcement,
       m.broadcast_id, m.reply_to_id, m.created_at, m.root_id, m.reply_count,
       m.last_reply_at
  from public.messages m
  join doomed d on d.id = m.id;

-- A surviving reply that quoted an archived message keeps its words; the
-- composite foreign key's `on delete set null (reply_to_id)` clears only
-- the pointer. That is the behaviour 20260829000000 chose deliberately.
delete from public.messages m
 using public.archived_messages a
 where m.id = a.id;

/*
 * 3. Rebuild the denormalised counters from what actually survived, for
 *    every root in the database. Cheap once, and the alternative is a
 *    board whose reply counts were correct only for rows post_message
 *    happened to have written.
 */
update public.messages a
   set reply_count   = coalesce(r.n, 0),
       last_reply_at = r.mx
  from (
    select m.root_id, count(*)::int as n, max(m.created_at) as mx
      from public.messages m
     where m.root_id is not null
     group by m.root_id
  ) r
 where a.id = r.root_id;

update public.messages a
   set reply_count = 0, last_reply_at = null
 where a.root_id is null
   and not exists (select 1 from public.messages r where r.root_id = a.id);

/*
 * 4. A club thread whose last message just left would otherwise sort by a
 *    timestamp for a message nobody can see.
 */
update public.message_threads t
   set last_message_at = (
     select max(m.created_at) from public.messages m where m.thread_id = t.id)
 where t.club_id is not null and t.event_id is null;
