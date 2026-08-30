/*
 * Club threads become BOARDS: a list of root posts, each with its own
 * replies. This migration adds only the container; post_message
 * (20260830010000) is what enforces how it may be filled.
 *
 * `root_id` and `reply_to_id` answer two different questions and so they
 * are two different columns:
 *
 *   root_id     — WHICH POST does this message belong to. Structure. Set
 *                 once at insert, never changed.
 *   reply_to_id — WHICH LINE am I quoting. Presentation, rendered as the
 *                 quote chip. Unchanged in meaning by this migration.
 *
 * Collapsing them would mean the quote chip and the containment relation
 * could never disagree, and they legitimately do: quoting an earlier reply
 * from inside the same post is normal.
 */
alter table public.messages
  add column root_id       uuid,
  -- Denormalised, written by post_message in the same transaction. The
  -- board's list would otherwise need a correlated count(*) per root on
  -- every read, which is the shape that gets slow first — the same
  -- argument message_threads.last_message_at already makes.
  add column reply_count   int not null default 0,
  add column last_reply_at timestamptz;

/*
 * The COMPOSITE foreign key, for exactly the reason reply_to_id's own
 * docstring gives (20260829000000). A bare `references messages(id)` would
 * let a member of two clubs hang a reply off a root in the other club's
 * thread, and can_read_thread is asked about a row's own thread_id — a
 * containment pointer carries no thread of its own to be asked about, so
 * nothing downstream would catch it. This makes it unstateable rather than
 * merely refused.
 *
 * The `(root_id)` COLUMN LIST on `on delete set null` is required, not
 * stylistic: a bare form nulls EVERY referencing column, thread_id
 * included, which is `not null`.
 */
alter table public.messages
  add constraint messages_root_in_thread
  foreign key (root_id, thread_id)
    references public.messages (id, thread_id) on delete set null (root_id);

-- One level of nesting is enforced in post_message, which needs a subquery
-- and so cannot be a table check. This catches the one degenerate case that
-- CAN be expressed without one.
alter table public.messages
  add constraint messages_root_not_self
  check (root_id is null or root_id <> id);

-- The board's list: roots in a thread, most recent activity first.
create index messages_thread_roots
  on public.messages (thread_id, last_reply_at desc nulls last, created_at desc)
  where root_id is null;

-- A post's replies.
create index messages_by_root
  on public.messages (root_id, created_at)
  where root_id is not null;

/*
 * Per-POST read markers.
 *
 * thread_reads cannot express "read post A, not post B" — its primary key
 * is (thread_id, profile_id). Keeping the single watermark would mean
 * opening any one post marks the whole club read, so every other post's
 * unread dot vanishes unread. That is the failure this whole feature
 * exists to remove, so it gets its own table.
 *
 * thread_reads is untouched and keeps serving game and group threads.
 */
create table public.post_reads (
  root_id      uuid not null references public.messages(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),

  primary key (root_id, profile_id)
);

/*
 * `revoke all` first, and it is not belt-and-braces: Supabase grants ALL on
 * every table in `public` to `authenticated` by default, and ALL includes
 * TRUNCATE, which is NOT subject to row-level security. The same note
 * 20260829000000 carries for its four tables.
 *
 * Only `select` is granted. The write goes through mark_post_read
 * (20260830020000) so the can_read_thread check cannot be skipped — the
 * identical treatment thread_reads gets.
 */
alter table public.post_reads enable row level security;
revoke all on public.post_reads from authenticated;
grant select on public.post_reads to authenticated;

create policy post_reads_select_own on public.post_reads
  for select to authenticated
  using (profile_id = (select auth.uid()));
