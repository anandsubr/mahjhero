/*
 * The club threads' existing contents, reshaped into posts.
 *
 * The owner's call: announcements become the board's posts, and every
 * message that followed one belongs to it. The rule is TIME, not quoting.
 * reply_to_id is opt-in state in the composer — a member who read an
 * announcement and typed "sounds good, I'll be there" without long-pressing
 * to quote it left no pointer behind — so a rule that kept only what quoted
 * an announcement would keep the citations and throw away the conversation,
 * which in a flat chat is nearly all of it.
 *
 * So: a non-announcement message in a club thread belongs to the most
 * recent announcement in that same thread that precedes it. What precedes
 * the club's FIRST announcement belongs to no post, and leaves — there is
 * no post for it to open under.
 *
 * What leaves MOVES to archived_messages rather than being deleted. The
 * rows leave the app exactly as intended and a mistake stays recoverable by
 * a follow-up migration. archived_messages carries no policy and no grant:
 * it is a bucket, not a table the app can see.
 *
 * Game and group threads are not touched. Every statement below names
 * `club_id is not null and event_id is null`.
 */
create table public.archived_messages (
  like public.messages including defaults,
  archived_at timestamptz not null default now()
);

alter table public.archived_messages enable row level security;
revoke all on public.archived_messages from authenticated, anon;

/*
 * 1. Each message joins the post that was open when it was written.
 *
 *    "Precedes" is measured on the pair (created_at, id), and the ordering
 *    picks the most recent by reading that same pair descending. Ties are
 *    not hypothetical: created_at defaults to now(), which is the
 *    TRANSACTION's clock, so anything that wrote several messages in one
 *    transaction stamped them identically. Breaking the tie on id in the
 *    same direction as the timestamp is what the board itself already does
 *    (fetch_club_posts, 20260830020000: `order by … desc, m.id desc`), and
 *    using one total order for both halves is what makes the outcome
 *    defensible rather than merely deterministic — a message can never be
 *    filed under an announcement that the board renders as the later of the
 *    two, because the same comparison decides both.
 *
 *    A message with nothing before it selects null, keeps it, and is
 *    archived by step 3.
 */
update public.messages m
   set root_id = (
         select a.id
           from public.messages a
          where a.thread_id = m.thread_id
            and a.is_announcement
            and (a.created_at, a.id) < (m.created_at, m.id)
          order by a.created_at desc, a.id desc
          limit 1)
  from public.message_threads t
 where m.thread_id = t.id
   and t.club_id is not null and t.event_id is null
   and not m.is_announcement;

/*
 * 2. A quote that now points into somebody else's post loses its pointer.
 *
 *    Time decides the post, so a member can quote a line and then be filed
 *    under an announcement that landed between that line and their reply.
 *    That is precisely the state 20260830011000 refuses for every new
 *    write — and it refuses it in plpgsql, with no CHECK behind it, so such
 *    a row would simply sit there and the board would render a chip
 *    quoting text from a post nobody has open.
 *
 *    `coalesce(q.root_id, q.id)` is "the post q belongs to"; a root belongs
 *    to itself. It is compared against m.root_id RAW, not coalesced, and
 *    that asymmetry is the point: a root's root_id is null, no post is ever
 *    null, so every quote an ANNOUNCEMENT carries is nulled here too. That
 *    is the other half of 20260830011000's rule — a new post may not quote
 *    anything — reached without a second statement. It is not a
 *    hypothetical case: the pre-board post_message never coupled
 *    p_announce to p_reply_to, so an announcement that quotes an earlier
 *    line is a row that can exist today.
 *
 *    The POINTER goes, never the message. A reply is still somebody's
 *    words, and the citation going stale is not a reason to remove them —
 *    the precedent `on delete set null (reply_to_id)` set in 20260829000000.
 *
 *    Rows step 3 is about to archive are excluded. Their pointers are
 *    history the moment they leave, and archived_messages is only worth
 *    keeping if it is a faithful copy of what left.
 */
update public.messages m
   set reply_to_id = null
  from public.message_threads t,
       public.messages q
 where m.thread_id = t.id
   and t.club_id is not null and t.event_id is null
   and q.id = m.reply_to_id
   and (m.is_announcement or m.root_id is not null)
   and coalesce(q.root_id, q.id) is distinct from m.root_id;

/*
 * 3. Everything with no post to belong to leaves.
 *
 *    `root_id is null` on a non-announcement, after step 1, means exactly
 *    "was written before this club ever announced anything".
 *
 *    The delete is correlated to the rows this statement just archived, not
 *    to archived_messages as a whole. Those are the same set today, and
 *    they stop being the same set the moment a second migration ever writes
 *    into that table — a statement that removes members' messages should
 *    not be one re-reading of an unscoped table away from removing the
 *    wrong ones.
 *
 *    A surviving reply that quoted an archived message keeps its words; the
 *    composite foreign key's `on delete set null (reply_to_id)` clears only
 *    the pointer.
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
),
archived as (
  insert into public.archived_messages
    (id, thread_id, author_id, body, subject, is_announcement, broadcast_id,
     reply_to_id, created_at, root_id, reply_count, last_reply_at)
  select m.id, m.thread_id, m.author_id, m.body, m.subject, m.is_announcement,
         m.broadcast_id, m.reply_to_id, m.created_at, m.root_id, m.reply_count,
         m.last_reply_at
    from public.messages m
    join doomed d on d.id = m.id
  returning id
)
delete from public.messages m
 using archived a
 where m.id = a.id;

/*
 * 4. Rebuild the denormalised counters from what actually survived.
 *
 *    post_message wrote them only for replies it handled itself, and step 3
 *    just took rows out from under them, so neither branch can be skipped:
 *    the first fixes roots that have replies, the second zeroes roots that
 *    ended up with none. Both are scoped to club threads — root_id can only
 *    be set inside one, but that is post_message's rule, not a constraint,
 *    and "game and group threads are not touched" above is a promise this
 *    migration should keep from its own text rather than from another
 *    function's behaviour.
 */
update public.messages a
   set reply_count   = r.n,
       last_reply_at = r.mx
  from (
    select m.root_id, count(*)::int as n, max(m.created_at) as mx
      from public.messages m
     where m.root_id is not null
     group by m.root_id
  ) r,
  public.message_threads t
 where a.id = r.root_id
   and a.thread_id = t.id
   and t.club_id is not null and t.event_id is null;

update public.messages a
   set reply_count = 0, last_reply_at = null
  from public.message_threads t
 where a.thread_id = t.id
   and t.club_id is not null and t.event_id is null
   and a.root_id is null
   and not exists (select 1 from public.messages r where r.root_id = a.id);

/*
 * 5. A club thread whose last message just left would otherwise sort by a
 *    timestamp for a message nobody can see.
 */
update public.message_threads t
   set last_message_at = (
     select max(m.created_at) from public.messages m where m.thread_id = t.id)
 where t.club_id is not null and t.event_id is null;
