/*
 * Messaging: one table, three kinds, none of them stored.
 *
 *   event_id set   → a GAME thread
 *   club_id set    → the CLUB thread
 *   neither        → a GROUP thread, rendered "Direct" when it has exactly
 *                    two members
 *
 * A direct message is a group of two. Storing `direct` as a fourth kind
 * would mean deciding what a direct thread becomes when a third person is
 * added, and that is a question nobody needs to answer.
 */
create table public.message_threads (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid references public.clubs(id) on delete cascade,
  event_id        uuid references public.events(id) on delete cascade,
  -- Group threads only. Null means "name it from the members' first names",
  -- which fetch_my_threads does at read time rather than freezing a name
  -- that goes stale the moment somebody is added.
  title           text check (length(title) <= 80),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  /*
   * Denormalised, written by post_message in the same transaction. The
   * Recent sort orders on it, and computing it with a correlated
   * max(created_at) per thread on every list read is the shape that gets
   * slow first. Null for a club thread nobody has posted in, which sorts
   * last.
   */
  last_message_at timestamptz,

  -- A thread cannot point at an event belonging to a different club. The
  -- same guard bookings (20260825000000) and broadcasts (20260826030000)
  -- carry, and it makes the state unrepresentable rather than merely
  -- refused.
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,

  -- A game thread always knows its club.
  constraint message_threads_event_needs_club
    check (event_id is null or club_id is not null)
);

/*
 * PARTIAL unique indexes, and this is not a stylistic choice.
 *
 * `unique (club_id, event_id)` looks like it would do the same job and does
 * not: NULLs are distinct in a unique index, so every club-thread row has a
 * NULL event_id and no two of them ever collide. A club would get unlimited
 * club threads and the bug would only show up as a duplicated conversation.
 */
create unique index message_threads_one_per_club
  on public.message_threads (club_id)
  where event_id is null and club_id is not null;

create unique index message_threads_one_per_event
  on public.message_threads (event_id)
  where event_id is not null;

-- The Recent sort's ordering.
create index message_threads_recent
  on public.message_threads (last_message_at desc nulls last);

/*
 * Materialised for GROUP threads only.
 *
 * Club and game membership stays derived from club_members and bookings.
 * That asymmetry is the most important choice in this schema, so it is
 * argued rather than assumed: materialising a 42-member roster here would
 * mean keeping it correct across joins, leaves, role changes, bookings,
 * cancellations, waitlist promotions, declines and event cancellation —
 * nine existing write paths that would each grow a second thing to
 * remember. Deriving costs one join at read time and cannot go stale. A
 * group has no other source of truth, so it gets a table.
 *
 * `joined_at` is also the unread floor: a person added to an old group sees
 * the full history but does not inherit it as unread. Visibility and
 * obligation are different questions.
 */
create table public.thread_members (
  thread_id  uuid not null references public.message_threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id),
  joined_at  timestamptz not null default now(),

  primary key (thread_id, profile_id)
);

create index thread_members_profile_idx on public.thread_members (profile_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.message_threads(id) on delete cascade,
  author_id       uuid not null references public.profiles(id),
  body            text not null check (length(trim(body)) between 1 and 2000),
  /*
   * Non-null only on announcements, where it is the email's subject line.
   * The control-character check mirrors broadcasts.subject exactly and for
   * the same reason: deliver-notifications drops this into an SMTP header,
   * where a CR or LF lets the author inject an arbitrary header — an extra
   * Bcc:, for one.
   */
  subject         text
                    check (length(subject) <= 120)
                    check (subject !~ '[[:cntrl:]]'),
  is_announcement boolean not null default false,
  -- Set when the announcement was mailed, so the message and the record the
  -- Edge Function renders from stay tied together.
  broadcast_id    uuid references public.broadcasts(id) on delete set null,
  -- Quote-reply: a pointer to ONE earlier message, never a branch. See the
  -- composite foreign key below, which is the whole design.
  reply_to_id     uuid,
  created_at      timestamptz not null default now(),

  /*
   * Redundant against the primary key, and not decorative: it is what lets
   * the composite foreign key below be declared at all.
   */
  unique (id, thread_id),

  /*
   * `reply_to_id uuid references messages(id)` would be the obvious column
   * and it would be a DISCLOSURE BUG.
   *
   * A member of two clubs could quote a message out of one club's thread
   * into the other's, and the quoted text would then render for people who
   * cannot read where it came from. can_read_thread is asked about a row's
   * OWN thread_id, and a quoted stub carries no thread of its own to be
   * asked about — so nothing downstream would catch it.
   *
   * The composite key makes that unstateable rather than merely refused: a
   * reply's parent must live in the same thread as the reply. Same shape,
   * and the same reasoning, as the (event_id, club_id) guard on bookings,
   * broadcasts and message_threads above.
   *
   * `on delete set null`, not `cascade`: nothing deletes a message in this
   * plan, but if anything ever does, the reply is still somebody's words
   * and must not vanish with the thing it answered.
   *
   * The `(reply_to_id)` COLUMN LIST is required, not stylistic. A bare
   * `on delete set null` on a composite key nulls EVERY referencing column
   * — here thread_id too, which is `not null` — so deleting a quoted
   * message would fail with a not-null violation instead of clearing the
   * pointer. The column-list form landed in Postgres 15; supabase/config.toml
   * pins major_version = 17.
   */
  foreign key (reply_to_id, thread_id)
    references public.messages (id, thread_id) on delete set null (reply_to_id)
);

-- The thread screen's read, newest last but fetched newest first.
create index messages_thread_recent on public.messages (thread_id, created_at desc);

/*
 * No updated_at and no deleted_at. Edit and delete are out of scope, and
 * adding the columns now would invite a half-built version of both.
 */

create table public.thread_reads (
  thread_id    uuid not null references public.message_threads(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),

  primary key (thread_id, profile_id)
);

-- ---------------------------------------------------------------------
-- Privileges.
--
-- `revoke all` first on every table, and it is not belt-and-braces:
-- Supabase grants ALL on every table in `public` to `authenticated` by
-- default, and ALL includes TRUNCATE, which is NOT subject to row-level
-- security. Without these lines the policies in 20260829010000 stop
-- nothing.
--
-- Only `select` is granted. Every write goes through an RPC.
-- thread_reads is the one exception: a member owns their own read marker,
-- but even that is written through mark_thread_read so the can_read_thread
-- check cannot be skipped.
-- ---------------------------------------------------------------------
alter table public.message_threads enable row level security;
alter table public.thread_members  enable row level security;
alter table public.messages        enable row level security;
alter table public.thread_reads    enable row level security;

revoke all on public.message_threads from authenticated;
revoke all on public.thread_members  from authenticated;
revoke all on public.messages        from authenticated;
revoke all on public.thread_reads    from authenticated;

grant select on public.message_threads to authenticated;
grant select on public.thread_members  to authenticated;
grant select on public.messages        to authenticated;
grant select on public.thread_reads    to authenticated;
