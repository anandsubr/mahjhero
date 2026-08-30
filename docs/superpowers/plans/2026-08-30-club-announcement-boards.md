# Club Announcement Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a club's single flat chat thread into a board of root posts, each opening to its own replies, with announcements as a flag on a root rather than a separate object.

**Architecture:** One new column, `messages.root_id`, is the container — it says which post a message belongs to. `reply_to_id` keeps its existing job of pointing at the specific line being quoted. Both carry the same composite foreign key `(col, thread_id) → messages(id, thread_id)` so a post can never contain a reply from another club's thread. Nesting is one level, enforced in `post_message`, which is the only write path. `can_read_thread` and `can_post_thread` are not touched: permission stays per-thread and a post inherits it. Game and direct threads keep their existing flat-chat rendering untouched.

**Tech Stack:** Postgres 17 / Supabase (migrations + `security definer` RPCs + RLS), pgTAP for database tests, React Native + Expo Router (react-native-web) for screens, vitest for unit tests, Playwright for visual baselines.

**Spec:** [docs/superpowers/specs/2026-08-30-club-announcement-boards-design.md](../specs/2026-08-30-club-announcement-boards-design.md)
**Orientation for the code you are changing:** [docs/messaging.md](../../messaging.md) — read it before Task 1. It records nine decisions that look wrong at a glance and are not.

## Global Constraints

- **Branch:** `feat/club-boards`, already cut from `origin/main` at `c3bd08a`. Do not commit to `main`. The work merges via a PR.
- **Migrations are append-only.** Never edit a committed migration. New files only, timestamps after `20260829090000`.
- **Every write goes through an RPC.** Only `select` is granted on `messages`; `post_reads` follows the same rule as `thread_reads`.
- **`lib/` never rejects.** Every exported async resolves `null` or `{ error }`. `null` means "we could not ask"; `[]` means "there is nothing".
- **Refusals relay verbatim.** Database refusal text is written to be read by a member. `lib/messages.ts` never maps it through a refusal table.
- **Granting a function to `authenticated`** means updating BOTH closed-world arrays in `supabase/tests/database/portable/grants.test.sql` (around lines 728 and 808) — the expected-reachable list and the no-unexpected list — or the whole db suite goes red. A signature change is a removal plus an addition in both.
- **Every new `raise exception` message** needs an entry in the `ALLOWLIST` in `lib/bookings.test.ts` (around line 363) or `npm test` goes red while pgTAP stays green. Note `bookingErrorMessage` matches by **substring**.
- **pgTAP must run against a freshly reset container:** `npx supabase db reset --local && npm run test:db`. The Playwright suite seeds into the same database and two fixtures count rows globally.
- **`now()` is transaction-constant** and a pgTAP fixture is one transaction, so a seeded root and its reply tie. Never assert with a strict `>` on `created_at` inside a fixture; use `>=` or seed explicit timestamps.
- **WCAG AA:** cream on `colors.accentColor` is 3.03:1 and **fails**; `colors.accent[700]` is 5.72:1. Any new colour pairing is computed from `lib/theme.ts` and pinned in `lib/theme.test.ts`.
- **`accessibilityLabel` on a `Pressable` REPLACES** the name computed from its children in react-native-web. It does not merge. Compose counts and titles into the label.
- **Every new scroller needs `testID="screen-scroll"`** or Playwright's `captureScreen` silently truncates it.
- **Key effects on `session?.user.id`, never the `session` object.** `lib/session.tsx` hands out a fresh `Session` on every `onAuthStateChange`, and `TOKEN_REFRESHED` fires hourly and on web tab focus.
- **Guard re-entrancy with a ref written synchronously**, cleared on *every* exit path. `if (busy) return` read from render state is blind to a second activation in the same tick.
- **Do not weaken the test doubles.** The Realtime mock models reuse-by-topic and throws like the real client; `useSession` mocks return a module-scoped constant; `useFocusEffect` keys on callback identity. Four bugs shipped behind lying mocks on the messaging branch.
- **The hosted project is what `.env.local` points at.** New migrations need `npx supabase db push` — but only at Task 13, never mid-plan.

## File Structure

**Create:**

| file | responsibility |
|---|---|
| `supabase/migrations/20260830000000_club_boards.sql` | `root_id`, `reply_count`, `last_reply_at`, `post_reads` |
| `supabase/migrations/20260830010000_post_message_roots.sql` | `post_message` gains `p_root` |
| `supabase/migrations/20260830020000_board_reads.sql` | `fetch_club_posts`, `fetch_post_messages`, `mark_post_read` |
| `supabase/migrations/20260830030000_board_unread.sql` | `fetch_my_threads`'s club branch |
| `supabase/migrations/20260830040000_archive_club_chat.sql` | `archived_messages` + the data move |
| `supabase/tests/database/fixtures/club_board_schema.test.sql` | Task 1's guards |
| `supabase/tests/database/fixtures/club_board_post.test.sql` | Task 2's guards and counters |
| `supabase/tests/database/fixtures/club_board_reads.test.sql` | Task 3's read RPCs |
| `supabase/tests/database/fixtures/club_board_unread.test.sql` | Task 4's per-post unread |
| `supabase/tests/database/fixtures/club_board_archive.test.sql` | Task 5's migration |
| `components/messages/MessageBubble.tsx` | one message, four treatments |
| `components/messages/Composer.tsx` | the draft input, quote chip and Send |
| `components/messages/MembersPanel.tsx` | roster, add people, leave |
| `components/messages/PostRow.tsx` | one row on the board |
| `components/messages/__tests__/MessageBubble.test.tsx` | |
| `components/messages/__tests__/PostRow.test.tsx` | |
| `lib/use-thread-realtime.ts` | the app's only Realtime subscription, as a hook |
| `lib/use-thread-realtime.test.ts` | |
| `app/messages/club/[threadId].tsx` | the board |
| `app/messages/club/[threadId]/[postId].tsx` | one post: root + replies + composer |
| `app/messages/club/new.tsx` | compose a post, with the organizer Announcement toggle |
| `app/__tests__/club-board.test.tsx` | board screen |
| `app/__tests__/club-post.test.tsx` | post screen |
| `app/__tests__/club-post-new.test.tsx` | compose screen |

**Modify:**

| file | change |
|---|---|
| `lib/messages.ts` | `ClubPost`, `postTitle`, `fetchClubPosts`, `fetchPostMessages`, `markPostRead`; `postMessage` gains `rootId` |
| `lib/messages.test.ts` | tests for the above |
| `app/messages/[threadId].tsx` | shrinks to a dispatch + the flat chat thread |
| `app/messages/index.tsx` | a club row routes to the board |
| `supabase/tests/database/portable/grants.test.sql` | both closed-world arrays |
| `lib/bookings.test.ts` | `ALLOWLIST` entries for the new refusals |
| `docs/messaging.md` | refreshed: PR #9 is merged, sub-threads are no longer out of scope |

---

### Task 1: Schema — `root_id`, counters, and `post_reads`

**Files:**
- Create: `supabase/migrations/20260830000000_club_boards.sql`
- Create: `supabase/tests/database/fixtures/club_board_schema.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`

**Interfaces:**
- Produces: `public.messages.root_id uuid`, `public.messages.reply_count int not null default 0`, `public.messages.last_reply_at timestamptz`, and table `public.post_reads (root_id uuid, profile_id uuid, last_read_at timestamptz, primary key (root_id, profile_id))`. Every later task depends on these names.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/club_board_schema.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Lakeside', 'lakeside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.messages (id, thread_id, author_id, body) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Riverside root'),
  ('bb000000-0000-0000-0000-00000000000b',
   '22222222-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Lakeside root');

select has_column('public', 'messages', 'root_id', 'messages has root_id');
select col_type_is('public', 'messages', 'reply_count', 'integer',
  'reply_count is an integer');
select col_has_default('public', 'messages', 'reply_count',
  'reply_count defaults so existing rows read 0');
select has_column('public', 'messages', 'last_reply_at', 'messages has last_reply_at');

-- The disclosure guard: a reply cannot hang off a root in another thread.
select throws_ok(
  $$ insert into public.messages (thread_id, author_id, body, root_id)
     values ('11111111-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000001', 'cross-club reply',
             'bb000000-0000-0000-0000-00000000000b') $$,
  '23503',
  null,
  'a root in another thread is unstateable, not merely refused'
);

-- Degenerate self-reference.
select throws_ok(
  $$ update public.messages
        set root_id = id
      where id = 'aa000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a message cannot be its own root'
);

select has_table('public', 'post_reads', 'post_reads exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: FAIL — `club_board_schema.test.sql` reports `has_column ... root_id` failing, and the whole file errors on `insert ... root_id` with `column "root_id" of relation "messages" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830000000_club_boards.sql`:

```sql
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
```

- [ ] **Step 4: Add `post_reads` to the grants fixture**

In `supabase/tests/database/portable/grants.test.sql`, beside the existing `thread_reads` TRUNCATE assertion (around line 888), add two assertions and raise the plan count by 2:

```sql
select ok(
  not has_table_privilege('authenticated', 'public.post_reads', 'TRUNCATE'),
  'authenticated cannot TRUNCATE post_reads'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_reads', 'UPDATE'),
  'authenticated cannot UPDATE post_reads directly'
);
```

Change `select plan(102);` on line 6 to `select plan(104);`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: PASS. `club_board_schema.test.sql` 7/7, `grants.test.sql` 104/104, and every pre-existing fixture still green.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260830000000_club_boards.sql supabase/tests/database/fixtures/club_board_schema.test.sql supabase/tests/database/portable/grants.test.sql
git commit -m "feat(db): give messages a root_id container and per-post read markers"
```

---

### Task 2: `post_message` gains `p_root`

**Files:**
- Create: `supabase/migrations/20260830010000_post_message_roots.sql`
- Create: `supabase/tests/database/fixtures/club_board_post.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql` (both arrays, lines ~728 and ~808, plus the named-grant assertion at ~962)
- Modify: `lib/bookings.test.ts` (`ALLOWLIST`, around line 363)

**Interfaces:**
- Consumes: `messages.root_id`, `messages.reply_count`, `messages.last_reply_at` (Task 1).
- Produces: `public.post_message(target_thread uuid, p_body text, p_announce boolean default false, p_reply_to uuid default null, p_root uuid default null) returns uuid`. The old 4-argument signature is dropped. Task 6 calls this with `p_root`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/club_board_post.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(9);

-- Alice hosts Riverside. Bob is a plain member. Both are in the club thread.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- A group thread, to prove p_root is refused outside a club board.
insert into public.message_threads (id, created_by) values
  ('33333333-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.thread_members (thread_id, profile_id) values
  ('33333333-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- A plain member may start a post.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Anyone free Thursday?') $$,
  'a plain member can start a post'
);

select is(
  (select root_id from public.messages where body = 'Anyone free Thursday?'),
  null,
  'a new post is a root'
);

-- A reply attaches to that root and bumps its counters.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'I am',
       false, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  'a member can reply into a post'
);

select is(
  (select reply_count from public.messages where body = 'Anyone free Thursday?'),
  1,
  'the root counts its reply'
);

select isnt(
  (select last_reply_at from public.messages where body = 'Anyone free Thursday?'),
  null,
  'the root records when it was last replied to'
);

-- One level only.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'nested',
       false, null,
       (select id from public.messages where body = 'I am')) $$,
  '22023',
  'you can only reply to a post in this conversation',
  'a reply cannot be replied to'
);

-- p_root is meaningless outside a club board.
select throws_ok(
  $$ select public.post_message('33333333-0000-0000-0000-000000000003',
       'grouped',
       false, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  '22023',
  'only a club has posts to reply to',
  'a group thread has no posts'
);

-- A plain member cannot announce.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Hear ye', true) $$,
  '42501',
  null,
  'a plain member cannot announce'
);

-- An announcement must be a new post, not a reply.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Hear ye', true, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  '22023',
  'only a new post can be an announcement',
  'an announcement is always a root'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: FAIL — every `post_message(..., p_root)` call errors with `function public.post_message(unknown, unknown, boolean, unknown, uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830010000_post_message_roots.sql`:

```sql
/*
 * post_message learns about posts.
 *
 * DROP then CREATE, not CREATE OR REPLACE: adding a defaulted parameter
 * changes the signature, and `create or replace` would leave the old
 * 4-argument function in place as an overload. Two functions with defaults
 * make `post_message(uuid, text)` ambiguous, and PostgREST would resolve
 * whichever it liked. Its signature in BOTH closed-world arrays in
 * portable/grants.test.sql moves with it.
 *
 * The announcement path is untouched below: broadcast_recipients still
 * resolves the roster, still feeds the outbox, and is still the single
 * source of both the count the compose screen previews and the set the
 * fan-out mails.
 */
drop function public.post_message(uuid, text, boolean, uuid);

create function public.post_message(
  target_thread uuid,
  p_body        text,
  p_announce    boolean default false,
  p_reply_to    uuid default null,
  p_root        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  th     public.message_threads;
  body   text := trim(coalesce(p_body, ''));
  subj   text;
  bid    uuid;
  told   int;
  mid    uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Checked before the length bound so a member who cannot post here is
  -- told that, rather than being told their empty message is too short.
  if not public.can_post_thread(target_thread) then
    raise exception 'you cannot post in this conversation' using errcode = '42501';
  end if;

  if length(body) = 0 then
    raise exception 'write something first' using errcode = '22023';
  end if;
  if length(body) > 2000 then
    raise exception 'that message is too long' using errcode = '22023';
  end if;

  /*
   * The composite foreign key already makes a cross-thread quote
   * unstateable, so this check exists only to turn a 23503 into words
   * somebody can read. It is not the guard — the constraint is, and it stays
   * the thing that would stop a future caller that forgot this branch.
   */
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to and m.thread_id = target_thread
  ) then
    raise exception 'you can only reply to a message in this conversation'
      using errcode = '22023';
  end if;

  select * into th from public.message_threads where id = target_thread;

  /*
   * The board guards. Ordered so the most specific refusal wins: a reply
   * that also asked to announce is told announcements are always roots
   * rather than being sent through assert_club_organizer first, which
   * would refuse an organizer for the wrong reason.
   */
  if p_root is not null then
    if th.club_id is null or th.event_id is not null then
      raise exception 'only a club has posts to reply to' using errcode = '22023';
    end if;
    if coalesce(p_announce, false) then
      raise exception 'only a new post can be an announcement'
        using errcode = '22023';
    end if;
    -- `root_id is null` is the one-level rule. The composite foreign key
    -- already makes the cross-thread case unstateable; the thread_id
    -- clause here is what turns it into readable words.
    if not exists (
      select 1 from public.messages m
       where m.id = p_root
         and m.thread_id = target_thread
         and m.root_id is null
    ) then
      raise exception 'you can only reply to a post in this conversation'
        using errcode = '22023';
    end if;
  end if;

  if coalesce(p_announce, false) then
    if th.club_id is null then
      raise exception 'a group has no roster to announce to' using errcode = '22023';
    end if;

    -- Raises 42501 for anyone who is not host or co-organizer. Reused
    -- rather than reimplemented, so the UI's gate and this one cannot
    -- drift apart.
    perform public.assert_club_organizer(th.club_id);

    /*
     * The subject is DERIVED, not typed. deriveSubject in lib/messages.ts
     * must agree with this character for character — it is shown to the
     * organizer as the subject their email will carry.
     *
     * Control characters are stripped because deliver-notifications drops
     * this straight into an SMTP header, where a CR or LF would let an
     * organizer inject an arbitrary header — an extra Bcc:, for one.
     */
    subj := regexp_replace(
      split_part(body, E'\n', 1), '[[:cntrl:]]', '', 'g');
    subj := trim(subj);
    if length(subj) > 120 then
      subj := left(subj, 119) || '…';
    end if;
    if length(subj) = 0 then
      raise exception 'an announcement needs a first line to use as its subject'
        using errcode = '22023';
    end if;

    insert into public.broadcasts (club_id, event_id, author_id, subject, body)
    values (th.club_id, th.event_id, caller, subj, body)
    returning id into bid;

    /*
     * The dedupe key carries the recipient, not just the broadcast. A
     * multi-row INSERT ... ON CONFLICT DO NOTHING checks each row against
     * the unique index as it is inserted, INCLUDING rows the same statement
     * has already placed — so a key of `broadcast:<id>` alone would keep
     * exactly ONE row for the whole fan-out and tell one person.
     */
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select r.profile_id, th.club_id, th.event_id, 'broadcast',
           jsonb_build_object('broadcast_id', bid),
           'broadcast:' || bid::text || ':' || r.profile_id::text
      from public.broadcast_recipients(th.club_id, th.event_id) r
     -- You do not need mailing about the thing you just wrote.
     where r.profile_id <> caller
    on conflict (dedupe_key) do nothing;

    get diagnostics told = row_count;
    update public.broadcasts set recipient_count = told where id = bid;
  end if;

  insert into public.messages
    (thread_id, author_id, body, subject, is_announcement, broadcast_id,
     reply_to_id, root_id)
  values (target_thread, caller, body, subj, coalesce(p_announce, false), bid,
          p_reply_to, p_root)
  returning id into mid;

  -- Denormalised in the same transaction, so neither the Recent sort nor
  -- the board's own ordering has to compute an aggregate at read time.
  update public.message_threads
     set last_message_at = now()
   where id = target_thread;

  if p_root is not null then
    update public.messages
       set reply_count   = reply_count + 1,
           last_reply_at = now()
     where id = p_root;
  end if;

  return mid;
end;
$$;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke execute on function public.post_message(uuid, text, boolean, uuid, uuid)
  from public, anon;
grant execute on function public.post_message(uuid, text, boolean, uuid, uuid)
  to authenticated;
```

- [ ] **Step 4: Move the signature in both grants arrays**

In `supabase/tests/database/portable/grants.test.sql`, replace **both** occurrences (around lines 728 and 808) of:

```sql
       'public.post_message(uuid, text, boolean, uuid)',
```

with:

```sql
       'public.post_message(uuid, text, boolean, uuid, uuid)',
```

(the second occurrence is indented two spaces further — match the surrounding indentation). Then update the named assertion around line 962:

```sql
    'authenticated', 'public.post_message(uuid, text, boolean, uuid, uuid)', 'EXECUTE'),
  'authenticated can execute post_message'
```

- [ ] **Step 5: Add the three new refusals to the vitest allowlist**

In `lib/bookings.test.ts`, inside `ALLOWLIST` (around line 363), beside the existing `'you can only reply to a message in this conversation'` entry, add:

```ts
    // Raised by post_message when p_root names a message that is not a root
    // in the target thread — a reply-to-a-reply, or a root from another
    // club. The composite foreign key already makes the cross-thread case
    // unstateable; this is the readable-words wrapper. The board only ever
    // offers Reply on a root, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it and relays it verbatim.
    'you can only reply to a post in this conversation':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_root is passed on a game or group
    // thread, neither of which is a board. The composer only passes a root
    // from the club post screen, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it.
    'only a club has posts to reply to':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_announce is true on a reply. The
    // Announcement toggle only renders on the new-post screen, never in a
    // post's reply composer, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it.
    'only a new post can be an announcement':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
```

- [ ] **Step 6: Run both suites to verify they pass**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: PASS — `club_board_post.test.sql` 9/9, `grants.test.sql` 104/104.

```bash
npm test -- lib/bookings.test.ts
```

Expected: PASS — the `BOOKING_REFUSALS (self-audit against the migrations)` suite names no unmapped string.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260830010000_post_message_roots.sql supabase/tests/database/fixtures/club_board_post.test.sql supabase/tests/database/portable/grants.test.sql lib/bookings.test.ts
git commit -m "feat(db): let post_message start a post and reply into one"
```

---

### Task 3: The board's read RPCs

**Files:**
- Create: `supabase/migrations/20260830020000_board_reads.sql`
- Create: `supabase/tests/database/fixtures/club_board_reads.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql` (both arrays)

**Interfaces:**
- Consumes: `post_reads`, `messages.root_id`, `messages.reply_count`, `messages.last_reply_at` (Tasks 1–2).
- Produces:
  - `public.fetch_club_posts(target_thread uuid, p_limit int default 30, p_before timestamptz default null)` returning `(id uuid, author_id uuid, author_name text, body text, subject text, is_announcement boolean, created_at timestamptz, reply_count int, last_reply_at timestamptz, last_activity_at timestamptz, unread int)`
  - `public.fetch_post_messages(p_root uuid)` returning the **same ten columns as `fetch_thread_messages`**: `(id, author_id, author_name, body, subject, is_announcement, created_at, reply_to_id, reply_to_body, reply_to_author)`
  - `public.mark_post_read(p_root uuid) returns void`

  Task 6 wraps all three.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/club_board_reads.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(8);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active',
   now() - interval '30 days');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Two roots by Alice, each with one reply by Alice. Timestamps are seeded
-- EXPLICITLY: now() is transaction-constant, so a fixture that relies on
-- insert order for ordering assertions proves nothing.
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Older post',
   now() - interval '5 days', 1, now() - interval '4 days'),
  ('cc000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Newer post',
   now() - interval '2 days', 1, now() - interval '1 day');

insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('a1000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply to older',
   'aa000000-0000-0000-0000-00000000000a', now() - interval '4 days'),
  ('c1000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply to newer',
   'cc000000-0000-0000-0000-00000000000c', now() - interval '1 day');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')),
  2,
  'the board lists roots only, never replies'
);

select is(
  (select id from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001') limit 1),
  'cc000000-0000-0000-0000-00000000000c'::uuid,
  'most recent activity sorts first'
);

select is(
  (select author_name from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001') limit 1),
  (select display_name from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'sender names survive profiles self-row-only RLS'
);

-- Everything is unread: Bob has read neither post. Each post counts its own
-- root plus its own replies.
select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'aa000000-0000-0000-0000-00000000000a'),
  2,
  'an unopened post counts its root and its replies'
);

select lives_ok(
  $$ select public.mark_post_read('aa000000-0000-0000-0000-00000000000a') $$,
  'a member can mark one post read'
);

select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'aa000000-0000-0000-0000-00000000000a'),
  0,
  'reading a post clears its own unread'
);

select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'cc000000-0000-0000-0000-00000000000c'),
  2,
  'and leaves every OTHER post untouched — the whole point of post_reads'
);

-- A stranger to the club cannot read the board.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select * from public.fetch_club_posts(
       '11111111-0000-0000-0000-000000000001') $$,
  '42501',
  'you cannot read this conversation',
  'a stranger is refused by can_read_thread, not by an empty list'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: FAIL — `function public.fetch_club_posts(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830020000_board_reads.sql`:

```sql
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
```

- [ ] **Step 4: Add the three signatures to both grants arrays**

In `supabase/tests/database/portable/grants.test.sql`, in **both** arrays, after `'public.thread_roster(uuid)'` add a comma and these three (match the surrounding indentation in each — the second array is indented two spaces further):

```sql
       'public.fetch_club_posts(uuid, integer, timestamp with time zone)',
       'public.fetch_post_messages(uuid)',
       'public.mark_post_read(uuid)'
```

Note the types are spelled as `pg_proc` renders them (`integer`, `timestamp with time zone`), not as written in the `create` — the arrays are compared against `p.oid::regprocedure`.

- [ ] **Step 5: Add the new refusal to the vitest allowlist**

In `lib/bookings.test.ts`'s `ALLOWLIST`:

```ts
    // Raised by fetch_post_messages and mark_post_read when the id names no
    // root — a deleted post, or a reply id. Deliberately the same words for
    // both cases: distinguishing them would let a caller probe for message
    // ids. Reachable only by following a stale link. lib/messages.ts owns it.
    'that post is no longer here':
      'raised by fetch_post_messages and mark_post_read — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: PASS — `club_board_reads.test.sql` 8/8, `grants.test.sql` 104/104.

```bash
npm test -- lib/bookings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260830020000_board_reads.sql supabase/tests/database/fixtures/club_board_reads.test.sql supabase/tests/database/portable/grants.test.sql lib/bookings.test.ts
git commit -m "feat(db): read a club board, one post, and a post's read marker"
```

---

### Task 4: Per-post unread in `fetch_my_threads`

**Files:**
- Create: `supabase/migrations/20260830030000_board_unread.sql`
- Create: `supabase/tests/database/fixtures/club_board_unread.test.sql`

**Interfaces:**
- Consumes: `post_reads` (Task 1).
- Produces: no signature change. `fetch_my_threads()` and `my_unread_counts()` keep their existing return types; only the club branch's unread arithmetic changes. The Messages list badge and the dashboard chips keep working with no client change.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/club_board_unread.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(3);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active',
   now() - interval '30 days');

insert into public.message_threads (id, club_id, created_by, last_message_at) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 day');

-- Two posts by Alice, one reply each. Four messages Bob has not read.
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Post one',
   now() - interval '5 days', 1, now() - interval '4 days'),
  ('cc000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Post two',
   now() - interval '2 days', 1, now() - interval '1 day');

insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('a1000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply one',
   'aa000000-0000-0000-0000-00000000000a', now() - interval '4 days'),
  ('c1000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply two',
   'cc000000-0000-0000-0000-00000000000c', now() - interval '1 day');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select unread from public.fetch_my_threads()
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and kind = 'club'),
  4,
  'the club row totals every unread message across every post'
);

select lives_ok(
  $$ select public.mark_post_read('aa000000-0000-0000-0000-00000000000a') $$,
  'Bob reads post one'
);

select is(
  (select unread from public.fetch_my_threads()
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and kind = 'club'),
  2,
  'reading one post subtracts only that post — mark_thread_read is not involved'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: FAIL on the third assertion — `have: 4, want: 2`. The club branch still floors on `thread_reads`, which `mark_post_read` never writes.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830030000_board_unread.sql`. It is a `create or replace` of `fetch_my_threads` with the same signature; copy `20260829050000_thread_lists.sql`'s body verbatim and replace **only** the final `u` lateral join with the version below.

```sql
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
 * read-time group naming — is reproduced verbatim from 20260829050000.
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
  -- ⟨copy the entire body of 20260829050000_thread_lists.sql's
  --  fetch_my_threads here, unchanged, down to and including the
  --  `left join lateral (...) g on v.kind = 'group'` join⟩

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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: PASS — `club_board_unread.test.sql` 3/3, and `thread_lists.test.sql` still 12/12 (its game and group assertions exercise the `else` branch unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830030000_board_unread.sql supabase/tests/database/fixtures/club_board_unread.test.sql
git commit -m "feat(db): count a club's unread per post, not per thread"
```

---

### Task 5: Archive the existing club chat

**Files:**
- Create: `supabase/migrations/20260830040000_archive_club_chat.sql`
- Create: `supabase/tests/database/fixtures/club_board_archive.test.sql`

**Interfaces:**
- Consumes: `messages.root_id`, `messages.reply_count`, `messages.last_reply_at` (Task 1).
- Produces: `public.archived_messages`, ungranted and unreadable from the app. No client interface.

**Context:** this migration is destructive by decision — the owner's call is that the existing free-floating club chat is throwaway. It **moves** rather than deletes, so a mistake stays recoverable by a follow-up migration.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/club_board_archive.test.sql`. It cannot re-run the migration, so it asserts the migration's *result* on rows the migration already processed — instead, it seeds a fresh club and asserts the invariants the migration establishes hold for the schema, plus that `archived_messages` is unreachable:

```sql
begin;
set local search_path to extensions, public;

select plan(5);

select has_table('public', 'archived_messages', 'archived_messages exists');

select ok(
  not has_table_privilege('authenticated', 'public.archived_messages', 'SELECT'),
  'authenticated cannot read archived_messages'
);

select ok(
  not has_table_privilege('authenticated', 'public.archived_messages', 'TRUNCATE'),
  'authenticated cannot TRUNCATE archived_messages'
);

-- Every surviving club-thread message is either a root or hangs off one.
-- After the migration there are no free-floating non-announcement messages
-- left in any club thread.
select is(
  (select count(*)::int
     from public.messages m
     join public.message_threads t on t.id = m.thread_id
    where t.club_id is not null and t.event_id is null
      and m.root_id is null
      and not m.is_announcement),
  0,
  'no free-floating club chat survives the archive'
);

-- Counters agree with reality for every root the migration rebuilt.
select is(
  (select count(*)::int
     from public.messages a
    where a.root_id is null
      and a.reply_count <> (select count(*)::int from public.messages r
                             where r.root_id = a.id)),
  0,
  'every root''s reply_count matches its actual replies'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: FAIL — `has_table('public','archived_messages')` fails, and the two privilege assertions error on a table that does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830040000_archive_club_chat.sql`:

```sql
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: PASS — `club_board_archive.test.sql` 5/5. Note the local database is seeded only by fixtures, each of which rolls back, so the migration runs against an empty `messages` table locally; its correctness against real rows is proved by the invariant assertions plus the hosted push in Task 13.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260830040000_archive_club_chat.sql supabase/tests/database/fixtures/club_board_archive.test.sql
git commit -m "feat(db): reshape club threads into boards and archive the loose chat"
```

---

### Task 6: The client boundary in `lib/messages.ts`

**Files:**
- Modify: `lib/messages.ts`
- Modify: `lib/messages.test.ts`

**Interfaces:**
- Consumes: `fetch_club_posts`, `fetch_post_messages`, `mark_post_read`, `post_message(…, p_root)` (Tasks 2–3).
- Produces:
  - `export type ClubPost = { id: string; author_id: string; author_name: string | null; body: string; subject: string | null; is_announcement: boolean; created_at: string; reply_count: number; last_reply_at: string | null; last_activity_at: string; unread: number }`
  - `export function postTitle(post: ClubPost): string`
  - `export function replyCountLabel(n: number): string`
  - `export async function fetchClubPosts(threadId: string, before?: string | null): Promise<ClubPost[] | null>`
  - `export async function fetchPostMessages(rootId: string): Promise<ThreadMessage[] | null>`
  - `export function markPostRead(rootId: string): Promise<{ error: string | null }>`
  - `postMessage(threadId, body, announce = false, replyToId = null, rootId = null)`

  Tasks 10–12 consume all of these.

- [ ] **Step 1: Write the failing tests**

Append to `lib/messages.test.ts`:

```ts
describe('postTitle', () => {
  const base = {
    id: 'p1',
    author_id: 'a1',
    author_name: 'Alice',
    body: 'body',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-30T10:00:00.000Z',
    reply_count: 0,
    last_reply_at: null,
    last_activity_at: '2026-08-30T10:00:00.000Z',
    unread: 0,
  };

  it('uses the subject when the post has one', () => {
    expect(postTitle({ ...base, subject: 'Doors at seven' })).toBe('Doors at seven');
  });

  it('falls back to the first line of the body', () => {
    expect(postTitle({ ...base, body: 'Anyone free?\nI have a table.' }))
      .toBe('Anyone free?');
  });

  it('truncates a long first line rather than wrapping the whole row', () => {
    const long = 'x'.repeat(200);
    const title = postTitle({ ...base, body: long });
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });

  it('never returns an empty string', () => {
    expect(postTitle({ ...base, body: '   ' })).toBe('Untitled post');
  });
});

describe('replyCountLabel', () => {
  it('says nothing about a post with no replies', () => {
    expect(replyCountLabel(0)).toBe('No replies');
  });

  it('is singular at one', () => {
    expect(replyCountLabel(1)).toBe('1 reply');
  });

  it('is plural above one', () => {
    expect(replyCountLabel(4)).toBe('4 replies');
  });
});

describe('fetchClubPosts', () => {
  it('resolves null when the RPC fails, never throws', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchClubPosts('t1')).resolves.toBeNull();
  });

  it('resolves an empty array when there are no posts', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchClubPosts('t1')).resolves.toEqual([]);
  });
});

describe('postMessage with a root', () => {
  it('passes p_root through to the RPC', async () => {
    rpc.mockResolvedValueOnce({ data: 'm1', error: null });
    await postMessage('t1', 'I am', false, null, 'root1');
    expect(rpc).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'I am',
      p_announce: false,
      p_reply_to: null,
      p_root: 'root1',
    });
  });

  it('still sends p_root: null for a flat thread', async () => {
    rpc.mockResolvedValueOnce({ data: 'm1', error: null });
    await postMessage('t1', 'hello');
    expect(rpc).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'hello',
      p_announce: false,
      p_reply_to: null,
      p_root: null,
    });
  });
});
```

Add `ClubPost`, `postTitle`, `replyCountLabel` and `fetchClubPosts` to the file's existing import from `./messages`. Reuse whatever `rpc` mock handle the file already declares for `supabase.rpc`; do not introduce a second one.

- [ ] **Step 2: Run them to verify they fail**

```bash
npm test -- lib/messages.test.ts
```

Expected: FAIL — `postTitle is not a function`, and the `postMessage` assertions fail on a payload with no `p_root` key.

- [ ] **Step 3: Write the implementation**

In `lib/messages.ts`, add the type and the two pure helpers beside the other pure helpers (after `quoteStub`, around line 471):

```ts
/** One row of `fetch_club_posts` — a root post as the board renders it. */
export type ClubPost = {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  reply_count: number;
  last_reply_at: string | null;
  /** `greatest(created_at, last_reply_at)` — what the board sorts on. */
  last_activity_at: string;
  unread: number;
};

/** How long a post's title may run before the row wraps to three lines. */
export const POST_TITLE_MAX = 80;

/**
 * A post's display line.
 *
 * There is no title column, deliberately: an announcement already carries a
 * `subject` (derived by the same rule `post_message` uses), and a member
 * post shows its own first line. A separate title field for member posts is
 * one people leave blank, and a board of empty titles reads worse than a
 * board of first lines.
 */
export function postTitle(post: ClubPost): string {
  const raw = (post.subject ?? post.body.split('\n')[0] ?? '').trim();
  if (raw.length === 0) return 'Untitled post';
  if (raw.length <= POST_TITLE_MAX) return raw;
  return `${raw.slice(0, POST_TITLE_MAX - 1)}…`;
}

/**
 * The reply count as words. Composed into the row's accessibilityLabel
 * rather than sitting beside it, because accessibilityLabel on a Pressable
 * REPLACES the name computed from its children in react-native-web.
 */
export function replyCountLabel(n: number): string {
  if (n <= 0) return 'No replies';
  return n === 1 ? '1 reply' : `${n} replies`;
}
```

Add the reads beside `fetchThreadMessages` (after line 706):

```ts
/** One row of `fetch_club_posts`, as the RPC returns it. */
type ClubPostRow = {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  reply_count: number;
  last_reply_at: string | null;
  last_activity_at: string;
  unread: number;
};

export async function fetchClubPosts(
  threadId: string,
  before: string | null = null,
): Promise<ClubPost[] | null> {
  try {
    // security definer for the same reason fetch_thread_messages is:
    // profiles' self-only RLS would otherwise null out every author name
    // but the caller's own.
    const { data, error } = await supabase.rpc('fetch_club_posts', {
      target_thread: threadId,
      p_before: before,
    });
    if (error) {
      console.error('fetchClubPosts failed', error);
      return null;
    }
    return ((data ?? []) as ClubPostRow[]).map((r) => ({ ...r }));
  } catch (cause) {
    console.error('fetchClubPosts failed', cause);
    return null;
  }
}

/**
 * One post's root and replies. Returns the SAME shape as
 * fetchThreadMessages — the RPCs return the same ten columns on purpose, so
 * MessageBubble never learns a second row shape.
 */
export async function fetchPostMessages(
  rootId: string,
): Promise<ThreadMessage[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_post_messages', {
      p_root: rootId,
    });
    if (error) {
      console.error('fetchPostMessages failed', error);
      return null;
    }
    const rows = (data ?? []) as ThreadMessageRow[];

    return rows.map((r) => ({
      id: r.id,
      author_id: r.author_id,
      body: r.body,
      subject: r.subject,
      is_announcement: r.is_announcement,
      created_at: r.created_at,
      profiles: r.author_name ? { display_name: r.author_name } : null,
      reply_to_id: r.reply_to_id,
      reply_to: r.reply_to_id
        ? {
            id: r.reply_to_id,
            body: r.reply_to_body ?? '',
            profiles: r.reply_to_author ? { display_name: r.reply_to_author } : null,
          }
        : null,
    }));
  } catch (cause) {
    console.error('fetchPostMessages failed', cause);
    return null;
  }
}
```

Move `type ThreadMessageRow` above `fetchThreadMessages` if it is not already, so both functions can use it.

Then change `postMessage` and add `markPostRead` at the end of the file:

```ts
export async function postMessage(
  threadId: string,
  body: string,
  announce = false,
  replyToId: string | null = null,
  // Null in a game or direct thread, and null for a NEW post on a club
  // board. Set only when replying inside a post.
  rootId: string | null = null,
): Promise<{ id: string | null; error: string | null }> {
  const trimmed = (body ?? '').trim();
  // Checked here as well as in post_message so a member who taps Send on an
  // empty composer gets an answer without a round trip.
  if (trimmed.length === 0) {
    return { id: null, error: 'Write something first.' };
  }
  if (trimmed.length > BODY_MAX) {
    return { id: null, error: 'That message is too long.' };
  }
  return idRpc('post_message', {
    target_thread: threadId,
    p_body: trimmed,
    p_announce: announce,
    p_reply_to: replyToId,
    p_root: rootId,
  });
}

export function markPostRead(rootId: string) {
  return voidRpc('mark_post_read', { p_root: rootId });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- lib/messages.test.ts && npx tsc --noEmit
```

Expected: PASS, and tsc clean. `app/messages/[threadId].tsx` still compiles: `rootId` is defaulted, so its existing four-argument call is unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/messages.ts lib/messages.test.ts
git commit -m "feat(messages): add the club board's data boundary"
```

---

### Task 7: Extract `MessageBubble`

**Files:**
- Create: `components/messages/MessageBubble.tsx`
- Create: `components/messages/__tests__/MessageBubble.test.tsx`
- Modify: `app/messages/[threadId].tsx` (the render block around lines 590–700, and the styles it uses)

**Interfaces:**
- Produces: `export default function MessageBubble(props: { message: ThreadMessage; mine: boolean; showAuthor: boolean; tailed: boolean; onReply: (m: ThreadMessage) => void })`. Tasks 10–12 render it.

**This task changes no behaviour.** It is a move. The proof is that the existing thread tests and visual baselines stay green without being regenerated.

- [ ] **Step 1: Write the failing test**

Create `components/messages/__tests__/MessageBubble.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import MessageBubble from '../MessageBubble';
import type { ThreadMessage } from '../../../lib/messages';

const message: ThreadMessage = {
  id: 'm1',
  author_id: 'a1',
  body: 'Anyone free Thursday?',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:00:00.000Z',
  profiles: { display_name: 'Alice Chen' },
  reply_to_id: null,
  reply_to: null,
};

describe('MessageBubble', () => {
  it('renders the body', () => {
    render(
      <MessageBubble
        message={message}
        mine={false}
        showAuthor
        tailed
        onReply={() => {}}
      />,
    );
    expect(screen.getByText('Anyone free Thursday?')).toBeTruthy();
  });

  it("names the author on somebody else's message", () => {
    render(
      <MessageBubble
        message={message}
        mine={false}
        showAuthor
        tailed
        onReply={() => {}}
      />,
    );
    expect(screen.getByText('Alice Chen')).toBeTruthy();
  });

  it('does not name the author on your own message', () => {
    render(
      <MessageBubble
        message={message}
        mine
        showAuthor
        tailed
        onReply={() => {}}
      />,
    );
    expect(screen.queryByText('Alice Chen')).toBeNull();
  });

  it('renders an announcement with its subject', () => {
    render(
      <MessageBubble
        message={{ ...message, is_announcement: true, subject: 'Doors at seven' }}
        mine={false}
        showAuthor
        tailed
        onReply={() => {}}
      />,
    );
    expect(screen.getByText(/Doors at seven/)).toBeTruthy();
  });

  it('offers reply on long press', () => {
    const onReply = vi.fn();
    render(
      <MessageBubble
        message={message}
        mine={false}
        showAuthor
        tailed
        onReply={onReply}
      />,
    );
    fireEvent(screen.getByText('Anyone free Thursday?'), 'longPress');
    expect(onReply).toHaveBeenCalledWith(message);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- components/messages/__tests__/MessageBubble.test.tsx
```

Expected: FAIL — `Cannot find module '../MessageBubble'`.

- [ ] **Step 3: Move the code**

Create `components/messages/MessageBubble.tsx`. Cut the bubble's JSX out of `app/messages/[threadId].tsx`'s message map (the block spanning roughly lines 600–700, from `const displayBody = m.is_announcement …` down to the closing of the bubble `Pressable`), and every style key it references out of that file's `StyleSheet.create` (the announcement, quote-stub, tail and author-name entries). Move `announcementBody` and `quoteStub` to this file's imports from `../../lib/messages`.

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  announcementBody,
  quoteStub,
  type ThreadMessage,
} from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Props = {
  message: ThreadMessage;
  /** Rendered right-aligned in the accent tone when true. */
  mine: boolean;
  /** First message of a run by one author — the only one that names them. */
  showAuthor: boolean;
  /** Last message of a run — the only one that draws the tail. */
  tailed: boolean;
  onReply: (message: ThreadMessage) => void;
};

/**
 * One message, in the four treatments the thread has: yours, somebody
 * else's, an announcement, and any of those carrying a quote stub.
 *
 * Extracted verbatim from app/messages/[threadId].tsx. Reply is a LONG
 * press, not a visible control: the artboard has no reply affordance on the
 * bubble, and a swipe is unavailable on web.
 *
 * accessibilityLabel composes the author and body together rather than
 * relying on the children — on a Pressable in react-native-web it REPLACES
 * the computed name rather than merging with it.
 */
export default function MessageBubble({
  message,
  mine,
  showAuthor,
  tailed,
  onReply,
}: Props) {
  const displayBody = message.is_announcement
    ? announcementBody(message.subject, message.body)
    : message.body;
  const author = message.profiles?.display_name ?? 'Someone';

  return (
    <Pressable
      onLongPress={() => onReply(message)}
      accessibilityLabel={
        mine ? `You said: ${displayBody}` : `${author} said: ${displayBody}`
      }
      style={[
        styles.bubble,
        mine ? styles.mine : styles.theirs,
        message.is_announcement ? styles.announcement : null,
        tailed ? (mine ? styles.tailMine : styles.tailTheirs) : null,
      ]}
    >
      {!mine && !message.is_announcement && showAuthor ? (
        <Text style={styles.author}>{author}</Text>
      ) : null}
      {message.reply_to ? (
        <View
          style={[
            styles.quote,
            message.is_announcement ? styles.quoteOnAnnouncement : null,
          ]}
        >
          <Text style={styles.quoteText}>{quoteStub(message.reply_to)}</Text>
        </View>
      ) : null}
      <Text
        style={[
          styles.body,
          mine ? styles.bodyMine : null,
          message.is_announcement ? styles.bodyAnnouncement : null,
        ]}
      >
        {displayBody}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ⟨move the bubble/mine/theirs/announcement/tail/author/quote/body style
  //  entries out of app/messages/[threadId].tsx verbatim — do not retune
  //  them, or Task 13's baselines will diff for a reason that is not this
  //  feature⟩
});
```

In `app/messages/[threadId].tsx`, replace the removed JSX with:

```tsx
<MessageBubble
  message={m}
  mine={m.author_id === session.user.id}
  showAuthor={startsNewGroup(m, messages[i - 1] ?? null)}
  tailed={!startsNewGroup(messages[i + 1] ?? null, m)}
  onReply={setReplyTo}
/>
```

and add `import MessageBubble from '../../components/messages/MessageBubble';`. Keep the existing arguments you were passing to `startsNewGroup` — do not change its call shape while moving the bubble.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- components/messages/__tests__/MessageBubble.test.tsx app/__tests__/thread.test.tsx && npx tsc --noEmit
```

Expected: PASS both files, tsc clean. `app/__tests__/thread.test.tsx` passing unchanged is the proof this was a move.

- [ ] **Step 5: Commit**

```bash
git add components/messages/MessageBubble.tsx components/messages/__tests__/MessageBubble.test.tsx "app/messages/[threadId].tsx"
git commit -m "refactor(messages): lift the bubble out of the thread screen"
```

---

### Task 8: Extract `Composer` and `MembersPanel`

**Files:**
- Create: `components/messages/Composer.tsx`
- Create: `components/messages/MembersPanel.tsx`
- Modify: `app/messages/[threadId].tsx`

**Interfaces:**
- Produces:
  - `export default function Composer(props: { draft: string; onDraftChange: (s: string) => void; replyTo: ThreadMessage | null; onClearReply: () => void; onSend: () => void; sending: boolean; placeholder?: string })`
  - `export default function MembersPanel(props: { thread: ThreadDetail; viewerId: string; onClose: () => void; onChanged: () => void })` — owns its own add/leave state and calls `addToGroupThread` / `leaveGroupThread` itself.

  Tasks 11–12 render `Composer`.

**This task changes no behaviour.** Same proof as Task 7.

- [ ] **Step 1: Write the failing test**

Append to `components/messages/__tests__/MessageBubble.test.tsx`'s directory a new file `components/messages/__tests__/Composer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import Composer from '../Composer';

describe('Composer', () => {
  it('sends the draft', () => {
    const onSend = vi.fn();
    render(
      <Composer
        draft="hello"
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={onSend}
        sending={false}
      />,
    );
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalled();
  });

  it('will not send an empty draft', () => {
    const onSend = vi.fn();
    render(
      <Composer
        draft="   "
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={onSend}
        sending={false}
      />,
    );
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('will not send twice while a send is in flight', () => {
    const onSend = vi.fn();
    render(
      <Composer
        draft="hello"
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={onSend}
        sending
      />,
    );
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- components/messages/__tests__/Composer.test.tsx
```

Expected: FAIL — `Cannot find module '../Composer'`.

- [ ] **Step 3: Move the code**

Create `components/messages/Composer.tsx` by cutting the composer JSX (the block around lines 710–760 of `app/messages/[threadId].tsx`, including the quote chip and the Send `Pressable`), plus `COMPOSER_HEIGHT`, `DRAFT_MAX_HEIGHT`, `handleDraftSize` and the `inputHeight` state, and every style key they use:

```tsx
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SendIcon } from '../icons';
import { quoteStub, type ThreadMessage } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

// The artboard's `.bigin` height (`min-height: 58px`), and the Send button's
// own size -- a 58x58 circle beside a 58-tall input, matched heights, one
// shape. Named once so the two are visibly the same number.
const COMPOSER_HEIGHT = 58;
// How tall a long draft may grow the input before it scrolls internally.
const DRAFT_MAX_HEIGHT = 140;

type Props = {
  draft: string;
  onDraftChange: (next: string) => void;
  replyTo: ThreadMessage | null;
  onClearReply: () => void;
  onSend: () => void;
  sending: boolean;
  placeholder?: string;
};

export default function Composer({
  draft,
  onDraftChange,
  replyTo,
  onClearReply,
  onSend,
  sending,
  placeholder = 'Message',
}: Props) {
  const [inputHeight, setInputHeight] = useState(COMPOSER_HEIGHT);

  const handleDraftSize = useCallback((height: number) => {
    setInputHeight(Math.min(Math.max(height, COMPOSER_HEIGHT), DRAFT_MAX_HEIGHT));
  }, []);

  // Checked here rather than only in the caller so the control is inert
  // both to a press and to a screen reader's activation. `sending` is the
  // caller's synchronously-written ref surfaced as a prop -- the caller
  // still holds the ref, because a boolean read from render state is blind
  // to a second activation in the same tick.
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <View style={styles.bar}>
      {replyTo ? (
        <Pressable
          onPress={onClearReply}
          accessibilityLabel={`Replying to ${quoteStub(replyTo)}. Tap to cancel.`}
          style={styles.quoteChip}
        >
          <Text style={styles.quoteChipText}>{quoteStub(replyTo)}</Text>
        </Pressable>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          placeholder={placeholder}
          accessibilityLabel={placeholder}
          multiline
          onContentSizeChange={(e) =>
            handleDraftSize(e.nativeEvent.contentSize.height)
          }
          style={[styles.input, { height: inputHeight }]}
        />
        <Pressable
          onPress={() => {
            if (!canSend) return;
            onSend();
          }}
          disabled={!canSend}
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          style={[styles.send, canSend ? null : styles.sendDisabled]}
        >
          <SendIcon />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ⟨move the composer's style entries out of app/messages/[threadId].tsx
  //  verbatim⟩
});
```

Create `components/messages/MembersPanel.tsx` by cutting the members panel JSX and **all six** pieces of state it owns (`membersOpen` stays with the caller as the mount switch; `addingOpen`, `candidates`, `pickedToAdd`, `addBusy`, `addError`, `leaveConfirming`, `leaveBusy` move into the panel), plus `openAdding`, the add handler, the leave handler and the `Candidate` type. Its `onChanged` prop is what the caller passes `load` to.

In `app/messages/[threadId].tsx`, replace both blocks with `<Composer … />` and `{membersOpen ? <MembersPanel … /> : null}`, and delete the now-unused state and imports. The `sendingRef` guard stays in the screen — it is the synchronous one.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- components/messages app/__tests__/thread.test.tsx && npx tsc --noEmit
```

Expected: PASS, tsc clean, and `app/messages/[threadId].tsx` now under 500 lines (`wc -l "app/messages/[threadId].tsx"`).

- [ ] **Step 5: Commit**

```bash
git add components/messages/Composer.tsx components/messages/MembersPanel.tsx components/messages/__tests__/Composer.test.tsx "app/messages/[threadId].tsx"
git commit -m "refactor(messages): lift the composer and members panel out of the thread screen"
```

---

### Task 9: Extract `useThreadRealtime`

**Files:**
- Create: `lib/use-thread-realtime.ts`
- Create: `lib/use-thread-realtime.test.ts`
- Modify: `app/messages/[threadId].tsx`

**Interfaces:**
- Produces: `export function useThreadRealtime(threadId: string | undefined, viewerId: string | undefined, onInsert: () => void): void`

**The property that must survive the move:** the topic is unique per subscription. `supabase.channel(topic)` returns an *existing* channel by topic, `removeChannel` is async, and `.on()` throws on a subscribed channel. `subscriptionSeq` is a monotonic counter, not `Date.now()`/`Math.random()`, so within one JS process a topic can never be handed back to a still-live channel.

- [ ] **Step 1: Write the failing test**

Create `lib/use-thread-realtime.test.ts`:

```ts
import { renderHook } from '@testing-library/react-native';
import { useThreadRealtime } from './use-thread-realtime';
import { supabase } from './supabase';

vi.mock('./supabase');

describe('useThreadRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes once for a thread', () => {
    renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  it('never reuses a topic across subscriptions', () => {
    const { unmount } = renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    unmount();
    renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    const topics = (supabase.channel as unknown as ReturnType<typeof vi.fn>).mock
      .calls.map((c) => c[0]);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('does not subscribe without a signed-in viewer', () => {
    renderHook(() => useThreadRealtime('t1', undefined, () => {}));
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
```

The `./supabase` mock already models reuse-by-topic and throws on a second `.on()` for a subscribed channel. **Do not weaken it** — it exists because a production crash hid behind a mock that returned a fresh channel per call and never threw.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- lib/use-thread-realtime.test.ts
```

Expected: FAIL — `Cannot find module './use-thread-realtime'`.

- [ ] **Step 3: Move the code**

Create `lib/use-thread-realtime.ts`, cutting the effect and `subscriptionSeq` out of `app/messages/[threadId].tsx` (lines ~187–243 and the module-level counter at ~180):

```ts
import { useEffect } from 'react';
import { supabase } from './supabase';

/*
 * Monotonic, not `Date.now()`/`Math.random()`: incremented once per
 * subscription below so a topic can never be handed back to a still-live
 * channel, no matter how the clock or a PRNG behave.
 */
let subscriptionSeq = 0;

/**
 * The app's only Realtime subscription, and deliberately the only one.
 *
 * `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what `can_read_thread` allows — there is
 * no second authorization surface.
 *
 * `onInsert` fires for every message inserted into the thread, INCLUDING
 * replies inside a post. A caller that only cares about one post filters
 * on its own side; the filter here stays `thread_id` so a board and a post
 * screen share one subscription shape.
 */
export function useThreadRealtime(
  threadId: string | undefined,
  viewerId: string | undefined,
  onInsert: () => void,
) {
  useEffect(() => {
    if (!viewerId || !threadId) return;

    /*
     * `supabase.channel(topic)` REUSES an existing channel by topic
     * (RealtimeClient.channel), and `removeChannel` is async -- it awaits
     * `channel.unsubscribe()` before deregistering the topic. A React
     * cleanup cannot await, so if this effect re-runs with the same topic,
     * `channel()` can hand back the OLD, still-subscribed channel, and
     * `.on()` throws on it. `subscriptionSeq` makes every subscription's
     * topic unique so that can never happen, regardless of how slow the
     * teardown is -- not even under React's dev double-mount or a threadId
     * change racing the old channel's teardown. `threadId` stays in the
     * topic so a live channel is still identifiable when debugging.
     */
    const topic = `thread:${threadId}:${++subscriptionSeq}`;

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          onInsertRef.current();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    /*
     * Keyed on the viewer's ID, NOT the session object: lib/session.tsx
     * hands out a fresh Session on every onAuthStateChange, TOKEN_REFRESHED
     * included, which fires within the hour and on web tab focus.
     *
     * `onInsert` is deliberately NOT a dependency — a caller passing an
     * inline closure would otherwise resubscribe on every render. It is
     * read through a ref instead, so the latest callback always runs.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, threadId]);
}
```

Add the ref above the effect:

```ts
  const onInsertRef = useRef(onInsert);
  useEffect(() => {
    onInsertRef.current = onInsert;
  }, [onInsert]);
```

(import `useRef` alongside `useEffect`).

In `app/messages/[threadId].tsx`, replace the deleted effect with:

```tsx
  useThreadRealtime(
    threadId,
    session?.user.id,
    useCallback(() => {
      // Refetch rather than appending the payload row: the payload carries
      // author_id but not the joined display_name, and a bubble that
      // renders anonymously and then re-renders with a name is worse than
      // one that arrives a beat later complete.
      void fetchThreadMessages(threadId).then((rows) => {
        if (rows) setMessages(rows);
      });
      // A conversation you are watching must never accumulate a badge --
      // but only once it has actually loaded. A screen whose initial
      // fetchThread failed never showed anything to read.
      if (loadedRef.current) void markThreadRead(threadId);
    }, [threadId]),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- lib/use-thread-realtime.test.ts app/__tests__/thread.test.tsx && npx tsc --noEmit
```

Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/use-thread-realtime.ts lib/use-thread-realtime.test.ts "app/messages/[threadId].tsx"
git commit -m "refactor(messages): make the Realtime subscription a hook"
```

---

### Task 10: The board screen

**Files:**
- Create: `components/messages/PostRow.tsx`
- Create: `components/messages/__tests__/PostRow.test.tsx`
- Create: `app/messages/club/[threadId].tsx`
- Create: `app/__tests__/club-board.test.tsx`
- Modify: `app/messages/index.tsx`

**Interfaces:**
- Consumes: `fetchClubPosts`, `markPostRead`, `postTitle`, `replyCountLabel`, `relativeTimestamp`, `ClubPost` (Task 6); `useThreadRealtime` (Task 9).
- Produces: route `/messages/club/[threadId]`, and `export default function PostRow(props: { post: ClubPost; onPress: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `components/messages/__tests__/PostRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';
import PostRow from '../PostRow';
import type { ClubPost } from '../../../lib/messages';

const post: ClubPost = {
  id: 'p1',
  author_id: 'a1',
  author_name: 'Alice Chen',
  body: 'Anyone free Thursday?\nI have a table.',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:00:00.000Z',
  reply_count: 3,
  last_reply_at: '2026-08-30T12:00:00.000Z',
  last_activity_at: '2026-08-30T12:00:00.000Z',
  unread: 2,
};

describe('PostRow', () => {
  it('shows the first line as the title', () => {
    render(<PostRow post={post} onPress={() => {}} />);
    expect(screen.getByText('Anyone free Thursday?')).toBeTruthy();
  });

  it('shows an announcement by its subject and labels it', () => {
    render(
      <PostRow
        post={{ ...post, is_announcement: true, subject: 'Doors at seven' }}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText('Doors at seven')).toBeTruthy();
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('composes title, author, replies and unread into ONE label', () => {
    // accessibilityLabel on a Pressable REPLACES the name computed from its
    // children in react-native-web. It does not merge. Everything a screen
    // reader needs has to be in this one string.
    render(<PostRow post={post} onPress={() => {}} />);
    const label = screen.getByLabelText(/Anyone free Thursday\?/);
    expect(label.props.accessibilityLabel).toContain('Alice Chen');
    expect(label.props.accessibilityLabel).toContain('3 replies');
    expect(label.props.accessibilityLabel).toContain('2 unread');
  });
});
```

Create `app/__tests__/club-board.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react-native';
import ClubBoardScreen from '../messages/club/[threadId]';
import { fetchClubPosts } from '../../lib/messages';

vi.mock('../../lib/messages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/messages')>()),
  fetchClubPosts: vi.fn(),
  markPostRead: vi.fn(),
}));

describe('the club board', () => {
  it('lists posts', async () => {
    vi.mocked(fetchClubPosts).mockResolvedValue([
      {
        id: 'p1',
        author_id: 'a1',
        author_name: 'Alice Chen',
        body: 'Anyone free Thursday?',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-30T10:00:00.000Z',
        reply_count: 0,
        last_reply_at: null,
        last_activity_at: '2026-08-30T10:00:00.000Z',
        unread: 0,
      },
    ]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByText('Anyone free Thursday?')).toBeTruthy(),
    );
  });

  it('says so when the board is empty rather than showing a blank screen', async () => {
    vi.mocked(fetchClubPosts).mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Nothing here yet/)).toBeTruthy(),
    );
  });

  it('reports a failed load as a failure, not as an empty board', async () => {
    // lib/ never rejects: null means "we could not ask", [] means "there is
    // nothing". Conflating them tells a member something false.
    vi.mocked(fetchClubPosts).mockResolvedValue(null);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
```

Follow whatever `expo-router`, `useSession` and `TabBar` mocking `app/__tests__/messages.test.tsx` already sets up — copy its mock block verbatim. A wholesale `vi.mock('expo-router', …)` missing a hook a shared component adopted throws everywhere at once: `TabBar` needs `usePathname`, `useRouter` and (via `useUnreadCounts`) `useFocusEffect`. `useSession`'s mock must return a **module-scoped constant** or referential instability produces a genuine render loop.

- [ ] **Step 2: Run them to verify they fail**

```bash
npm test -- components/messages/__tests__/PostRow.test.tsx app/__tests__/club-board.test.tsx
```

Expected: FAIL — `Cannot find module '../PostRow'` and `Cannot find module '../messages/club/[threadId]'`.

- [ ] **Step 3: Write `PostRow`**

Create `components/messages/PostRow.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Tag from '../Tag';
import UnreadBadge from '../UnreadBadge';
import {
  postTitle,
  relativeTimestamp,
  replyCountLabel,
  type ClubPost,
} from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Props = { post: ClubPost; onPress: () => void };

/**
 * One row on the board.
 *
 * An announcement is visually distinct and sorts by recency like everything
 * else — it does NOT pin. With no unpin affordance, a pinned announcement
 * would sit permanently above this morning's post, and the top of the board
 * would become an archive of stale ones. Argued in the spec's §3.
 */
export default function PostRow({ post, onPress }: Props) {
  const title = postTitle(post);
  const author = post.author_name ?? 'Someone';
  const replies = replyCountLabel(post.reply_count);
  const when = relativeTimestamp(post.last_activity_at);

  return (
    <Pressable
      onPress={onPress}
      // ONE label: accessibilityLabel on a Pressable REPLACES the name
      // computed from its children in react-native-web rather than merging
      // with it, so every part a screen reader needs is composed here.
      accessibilityLabel={[
        post.is_announcement ? 'Announcement.' : null,
        title,
        `by ${author}`,
        replies,
        when,
        post.unread > 0 ? `${post.unread} unread` : null,
      ]
        .filter(Boolean)
        .join('. ')}
      style={[styles.row, post.is_announcement ? styles.announcement : null]}
    >
      <View style={styles.head}>
        {post.is_announcement ? <Tag label="Announcement" /> : null}
        {post.unread > 0 ? <UnreadBadge count={post.unread} /> : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.meta}>
        {author} · {replies} · {when}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: space.xs,
  },
  // accent[700] is 5.72:1 against cream and passes AA. accentColor is
  // 3.03:1 and FAILS — see lib/theme.test.ts, which pins this pairing.
  announcement: { borderLeftWidth: 3, borderLeftColor: colors.accent[700] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },
});
```

If `Tag` does not take a `label` prop, match its actual API — check `components/Tag.tsx` before writing this.

- [ ] **Step 4: Write the board screen**

Create `app/messages/club/[threadId].tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import PostRow from '../../../components/messages/PostRow';
import { GENERIC_ERROR } from '../../../lib/constants';
import { fetchClubPosts, type ClubPost } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { useThreadRealtime } from '../../../lib/use-thread-realtime';
import { colors, space, type } from '../../../lib/theme';

/**
 * A club's board: root posts, most recent activity first.
 *
 * Reached from the Messages list, which keeps its club row — games, direct
 * messages and clubs all stay reachable from one place, and
 * fetch_my_threads' synthesised club rows (thread_id null, opened through
 * openThreadForClub on tap) keep working unchanged.
 *
 * Read-marking does NOT happen here. Opening the board is not reading the
 * posts on it; mark_post_read fires from the post screen, which is what
 * makes reading one announcement leave the others' dots alone.
 */
export default function ClubBoardScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();

  const [posts, setPosts] = useState<ClubPost[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!threadId) return;
    const rows = await fetchClubPosts(threadId);
    // null means "we could not ask"; [] means "there is nothing". Reporting
    // the first as the second tells a member something false about their club.
    if (rows === null) {
      setError(GENERIC_ERROR);
      setReady(true);
      return;
    }
    setError(null);
    setPosts(rows);
    setReady(true);
    loadedRef.current = true;
  }, [threadId]);

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  useThreadRealtime(
    threadId,
    session?.user.id,
    useCallback(() => {
      // Refetch rather than appending: a payload row carries author_id but
      // not the joined display_name, and the board's counters are computed
      // server-side.
      void load();
    }, [load]),
  );

  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen>
      <ScrollView testID="screen-scroll" contentContainerStyle={styles.list}>
        <View style={styles.header}>
          <Button
            label="New post"
            onPress={() => router.push(`/messages/club/new?threadId=${threadId}`)}
          />
        </View>
        {error ? <ErrorBanner message={error} /> : null}
        {ready && !error && posts.length === 0 ? (
          <Text style={styles.empty}>
            Nothing here yet. Start the first post.
          </Text>
        ) : null}
        {posts.map((p) => (
          <PostRow
            key={p.id}
            post={p}
            onPress={() => router.push(`/messages/club/${threadId}/${p.id}`)}
          />
        ))}
      </ScrollView>
      <TabBar active="messages" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center',
           paddingVertical: space.xl },
});
```

If `Screen` already renders its own `ScrollView` with `testID="screen-scroll"` (check `components/Screen.tsx:67`), use that instead of nesting a second scroller — a nested one would not be measured.

- [ ] **Step 5: Route the club row to the board**

In `app/messages/index.tsx`, at the two `router.push` sites (lines 84 and 102), send `kind === 'club'` rows to the board:

```tsx
      if (row.kind === 'club') {
        router.push(`/messages/club/${row.thread_id}`);
        return;
      }
      router.push(`/messages/${row.thread_id}`);
```

and, in the `openThreadForClub` branch (around line 102), replace `router.push(\`/messages/${id}\`)` with `router.push(\`/messages/club/${id}\`)` — that branch is only ever reached for a club row.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- components/messages app/__tests__/club-board.test.tsx app/__tests__/messages.test.tsx && npx tsc --noEmit
```

Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add components/messages/PostRow.tsx components/messages/__tests__/PostRow.test.tsx "app/messages/club/[threadId].tsx" app/__tests__/club-board.test.tsx app/messages/index.tsx
git commit -m "feat(messages): give a club a board of posts"
```

---

### Task 11: The post screen

**Files:**
- Create: `app/messages/club/[threadId]/[postId].tsx`
- Create: `app/__tests__/club-post.test.tsx`

**Interfaces:**
- Consumes: `fetchPostMessages`, `markPostRead`, `postMessage` with `rootId` (Task 6); `MessageBubble` (Task 7); `Composer` (Task 8); `useThreadRealtime` (Task 9).
- Produces: route `/messages/club/[threadId]/[postId]`.

**Note on the route:** Expo Router allows `app/messages/club/[threadId].tsx` and `app/messages/club/[threadId]/[postId].tsx` to coexist — the file and the directory share the segment name. Verify with `npx expo-router --help` is not needed; the existing `app/clubs/[id].tsx` + `app/clubs/[id]/` pair in this repo is the precedent. If the router complains, rename the board to `app/messages/club/[threadId]/index.tsx` and update the two pushes in Task 10.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/club-post.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PostScreen from '../messages/club/[threadId]/[postId]';
import { fetchPostMessages, markPostRead, postMessage } from '../../lib/messages';

vi.mock('../../lib/messages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/messages')>()),
  fetchPostMessages: vi.fn(),
  markPostRead: vi.fn(),
  postMessage: vi.fn(),
}));

const root = {
  id: 'p1',
  author_id: 'a1',
  body: 'Anyone free Thursday?',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:00:00.000Z',
  profiles: { display_name: 'Alice Chen' },
  reply_to_id: null,
  reply_to: null,
};

describe('a club post', () => {
  beforeEach(() => {
    vi.mocked(fetchPostMessages).mockResolvedValue([root]);
    vi.mocked(postMessage).mockResolvedValue({ id: 'm2', error: null });
  });

  it('renders the root and its replies', async () => {
    render(<PostScreen />);
    await waitFor(() =>
      expect(screen.getByText('Anyone free Thursday?')).toBeTruthy(),
    );
  });

  it('marks the post read once it has loaded', async () => {
    render(<PostScreen />);
    await waitFor(() => expect(markPostRead).toHaveBeenCalledWith('p1'));
  });

  it('posts a reply INTO the post, not into the thread', async () => {
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByLabelText('Reply')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Reply'), 'I am');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'I am', false, null, 'p1'),
    );
  });

  it('keeps the draft when the send is refused', async () => {
    vi.mocked(postMessage).mockResolvedValue({ id: null, error: 'Nope.' });
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByLabelText('Reply')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Reply'), 'I am');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('Nope.')).toBeTruthy());
    expect(screen.getByLabelText('Reply').props.value).toBe('I am');
  });

  it('reports a failed load as a failure, not as an empty post', async () => {
    vi.mocked(fetchPostMessages).mockResolvedValue(null);
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
```

Mock `useLocalSearchParams` to return `{ threadId: 't1', postId: 'p1' }` in the shared expo-router mock block copied from `app/__tests__/messages.test.tsx`.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- app/__tests__/club-post.test.tsx
```

Expected: FAIL — `Cannot find module '../messages/club/[threadId]/[postId]'`.

- [ ] **Step 3: Write the screen**

Create `app/messages/club/[threadId]/[postId].tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import ErrorBanner from '../../../../components/ErrorBanner';
import Screen from '../../../../components/Screen';
import TabBar from '../../../../components/TabBar';
import Composer from '../../../../components/messages/Composer';
import MessageBubble from '../../../../components/messages/MessageBubble';
import { GENERIC_ERROR } from '../../../../lib/constants';
import {
  fetchPostMessages,
  markPostRead,
  postMessage,
  startsNewGroup,
  type ThreadMessage,
} from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { useThreadRealtime } from '../../../../lib/use-thread-realtime';
import { space } from '../../../../lib/theme';

/**
 * One post: its root, its replies, and a composer that always writes INTO
 * this post.
 *
 * The quote chip (`replyTo`) still works and is still a POINTER — quoting
 * an earlier reply from inside the same post is normal, and is a different
 * question from which post the message belongs to. `rootId` never changes
 * while this screen is mounted; `replyTo` does.
 *
 * Read-marking lives here rather than on the board because opening the
 * board is not reading its posts. This is what makes reading one
 * announcement leave every other post's dot alone.
 */
export default function PostScreen() {
  const { session, loading } = useSession();
  const { threadId, postId } = useLocalSearchParams<{
    threadId: string;
    postId: string;
  }>();

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Written SYNCHRONOUSLY. A boolean read from render state is blind to a
  // second activation in the same tick, and is cleared on EVERY exit path
  // below — a ref set and never cleared makes the composer permanently dead.
  const sendingRef = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!postId) return;
    const rows = await fetchPostMessages(postId);
    if (rows === null) {
      setError(GENERIC_ERROR);
      return;
    }
    setError(null);
    setMessages(rows);
    loadedRef.current = true;
    void markPostRead(postId);
  }, [postId]);

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  useThreadRealtime(
    threadId,
    session?.user.id,
    useCallback(() => {
      // The subscription is thread-wide; a message in ANOTHER post on this
      // board wakes it too. Refetching this post is cheap and correct —
      // fetch_post_messages returns only this root and its replies.
      void load();
    }, [load]),
  );

  const send = useCallback(async () => {
    if (sendingRef.current || !threadId || !postId) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    // `false` — an announcement is always a NEW post, never a reply, and
    // post_message refuses the combination outright.
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      false,
      replyTo?.id ?? null,
      postId,
    );
    if (refusal) {
      // Neither the draft NOR the quote is cleared. Losing what somebody
      // typed because the network failed is the worst possible response to
      // a failed send, and making them re-pick what they were answering is
      // the second worst.
      sendingRef.current = false;
      setSending(false);
      setError(refusal);
      return;
    }
    setDraft('');
    setReplyTo(null);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, postId, draft, replyTo, load]);

  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen>
      <ScrollView testID="screen-scroll" contentContainerStyle={styles.list}>
        {error ? <ErrorBanner message={error} /> : null}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.author_id === session.user.id}
            showAuthor={startsNewGroup(m, messages[i - 1] ?? null)}
            tailed={!startsNewGroup(messages[i + 1] ?? null, m)}
            onReply={setReplyTo}
          />
        ))}
      </ScrollView>
      <View>
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onSend={send}
          sending={sending}
          placeholder="Reply"
        />
      </View>
      <TabBar active="messages" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.xs },
});
```

Match `startsNewGroup`'s real argument order — check its signature in `lib/messages.ts:359` and use the same call shape `app/messages/[threadId].tsx` already uses.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/club-post.test.tsx && npx tsc --noEmit
```

Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/messages/club/[threadId]/[postId].tsx" app/__tests__/club-post.test.tsx
git commit -m "feat(messages): open a post and reply inside it"
```

---

### Task 12: Compose a post, with the Announcement toggle

**Files:**
- Create: `app/messages/club/new.tsx`
- Create: `app/__tests__/club-post-new.test.tsx`

**Interfaces:**
- Consumes: `postMessage`, `deriveSubject`, `BODY_MAX` (`lib/messages.ts`); `countBroadcastRecipients` (`lib/broadcasts.ts`); `isClubOrganizer` or the equivalent role check `lib/clubs.ts` already exports — check it before writing, and reuse it rather than adding a second way to ask.
- Produces: route `/messages/club/new?threadId=…&clubId=…`.

**This closes the capability gap.** `docs/messaging.md` records that composing an announcement is currently **unreachable** — the organizer toggle was removed pending a friendlier design, and until this lands there is no way to email a club from the app, where before the messaging branch there was. `countBroadcastRecipients` gets its consumer back here.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/club-post-new.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NewPostScreen from '../messages/club/new';
import { postMessage } from '../../lib/messages';

vi.mock('../../lib/messages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/messages')>()),
  postMessage: vi.fn(),
}));

vi.mock('../../lib/broadcasts', () => ({
  countBroadcastRecipients: vi.fn().mockResolvedValue(12),
}));

describe('composing a post', () => {
  beforeEach(() => {
    vi.mocked(postMessage).mockResolvedValue({ id: 'p1', error: null });
  });

  it('posts a plain post as a root', async () => {
    render(<NewPostScreen organizer={false} />);
    fireEvent.changeText(screen.getByLabelText('Post'), 'Anyone free Thursday?');
    fireEvent.press(screen.getByLabelText('Post it'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1', 'Anyone free Thursday?', false, null, null,
      ),
    );
  });

  it('hides the Announcement toggle from a plain member', () => {
    render(<NewPostScreen organizer={false} />);
    expect(screen.queryByLabelText(/Also email/)).toBeNull();
  });

  it('offers an organizer the Announcement toggle', () => {
    render(<NewPostScreen organizer />);
    expect(screen.getByLabelText(/Also email/)).toBeTruthy();
  });

  it('shows the organizer the subject their email will carry', async () => {
    render(<NewPostScreen organizer />);
    fireEvent.changeText(screen.getByLabelText('Post'), 'Doors at seven\nBring cash');
    fireEvent.press(screen.getByLabelText(/Also email/));
    await waitFor(() => expect(screen.getByText(/Doors at seven/)).toBeTruthy());
  });

  it('announces when the toggle is on', async () => {
    render(<NewPostScreen organizer />);
    fireEvent.changeText(screen.getByLabelText('Post'), 'Doors at seven');
    fireEvent.press(screen.getByLabelText(/Also email/));
    fireEvent.press(screen.getByLabelText('Post it'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1', 'Doors at seven', true, null, null,
      ),
    );
  });
});
```

The `organizer` prop exists so the test can drive both branches without mocking a club-role RPC; the screen derives its default from the club role when the prop is omitted.

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- app/__tests__/club-post-new.test.tsx
```

Expected: FAIL — `Cannot find module '../messages/club/new'`.

- [ ] **Step 3: Write the screen**

Create `app/messages/club/new.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Button from '../../../components/Button';
import ErrorBanner from '../../../components/ErrorBanner';
import NoticeBanner from '../../../components/NoticeBanner';
import Screen from '../../../components/Screen';
import Toggle from '../../../components/Toggle';
import { countBroadcastRecipients } from '../../../lib/broadcasts';
import { BODY_MAX, deriveSubject, postMessage } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

type Props = {
  /** Test seam. Omitted in the app, where the club role decides. */
  organizer?: boolean;
};

/**
 * Start a post.
 *
 * The Announcement toggle is the entry point the messaging branch removed
 * and never replaced: docs/messaging.md records that composing an
 * announcement is unreachable, so until this screen lands there is no way
 * to email a club from the app at all.
 *
 * An announcement is a FLAG on a root, not a separate kind of object — one
 * posting path, one permission model, one fan-out. post_message refuses
 * p_announce on a reply outright, which is why the toggle exists here and
 * nowhere else.
 *
 * The subject is DERIVED from the first line, and shown back before send:
 * an email needs a subject and this screen has one input, so the derivation
 * is disclosed rather than invented silently. deriveSubject must agree with
 * post_message's SQL character for character.
 */
export default function NewPostScreen({ organizer }: Props) {
  const { session, loading } = useSession();
  const { threadId, clubId } = useLocalSearchParams<{
    threadId: string;
    clubId?: string;
  }>();
  const router = useRouter();

  const [body, setBody] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const canAnnounce = organizer ?? false;

  useEffect(() => {
    if (!announce || !clubId) return;
    // The count the organizer previews and the set the fan-out mails come
    // from ONE function (broadcast_recipients) on purpose — they disagree
    // the moment they are two.
    void countBroadcastRecipients(clubId, null).then(setRecipients);
  }, [announce, clubId]);

  const submit = useCallback(async () => {
    if (busyRef.current || !threadId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { id, error: refusal } = await postMessage(
      threadId,
      body,
      announce && canAnnounce,
      null,
      // A new post is a ROOT: p_root stays null.
      null,
    );
    if (refusal || !id) {
      // The draft survives a refusal. Losing what somebody typed because
      // the network failed is the worst possible response to a failed send.
      busyRef.current = false;
      setBusy(false);
      setError(refusal ?? 'We could not post that.');
      return;
    }
    busyRef.current = false;
    setBusy(false);
    router.replace(`/messages/club/${threadId}/${id}`);
  }, [threadId, body, announce, canAnnounce, router]);

  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  const subject = deriveSubject(body);

  return (
    <Screen>
      <View style={styles.form}>
        {error ? <ErrorBanner message={error} /> : null}
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="What's this about?"
          accessibilityLabel="Post"
          multiline
          maxLength={BODY_MAX}
          style={styles.input}
        />
        {canAnnounce ? (
          <Toggle
            value={announce}
            onValueChange={setAnnounce}
            accessibilityLabel="Also email everyone in the club"
            label="Also email everyone in the club"
          />
        ) : null}
        {canAnnounce && announce ? (
          <NoticeBanner
            message={
              recipients === null
                ? `Subject: ${subject}`
                : `Subject: ${subject} · ${recipients} ${
                    recipients === 1 ? 'person' : 'people'
                  } will be emailed`
            }
          />
        ) : null}
        <Button
          label="Post it"
          accessibilityLabel="Post it"
          onPress={submit}
          disabled={busy || body.trim().length === 0}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { padding: space.lg, gap: space.md },
  input: {
    ...type.body,
    color: colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
  },
});
```

Check `components/Toggle.tsx`, `components/NoticeBanner.tsx` and `components/Button.tsx` for their real prop names before writing, and match them. Check `countBroadcastRecipients`'s real signature in `lib/broadcasts.ts` — it takes the club and event the RPC `broadcast_recipient_count(uuid, uuid)` expects.

When `organizer` is omitted, derive it from the caller's club role using whatever `lib/clubs.ts` already exports for "is this viewer an organizer of this club" — do not add a second way to ask, and do not add a new RPC.

- [ ] **Step 4: Pass `clubId` from the board**

In `app/messages/club/[threadId].tsx`, the New post button must carry the club id so the recipient preview can be counted. Add `clubId` to what the board loads (it is already on the `ThreadListRow` the Messages list held) or fetch it once via `fetchThread(threadId)` on load, and change the push to:

```tsx
onPress={() =>
  router.push(`/messages/club/new?threadId=${threadId}&clubId=${clubId ?? ''}`)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/club-post-new.test.tsx app/__tests__/club-board.test.tsx && npx tsc --noEmit
```

Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/messages/club/new.tsx app/__tests__/club-post-new.test.tsx "app/messages/club/[threadId].tsx"
git commit -m "feat(messages): compose a post, and let an organizer announce again"
```

---

### Task 13: Baselines, docs, and the full gate

**Files:**
- Modify: `e2e/visual.spec.ts` and `e2e/visual.spec.ts-snapshots/`
- Modify: `docs/messaging.md`
- Modify: `lib/theme.test.ts`

- [ ] **Step 1: Pin the announcement border contrast**

In `lib/theme.test.ts`, beside the existing accent pairings, add:

```ts
it('the board\'s announcement accent passes AA against the surface', () => {
  // accentColor is 3.03:1 and FAILS; accent[700] is 5.72:1. An organizer
  // once could not read their own announcement at 1.10:1.
  expect(contrastRatio(colors.accent[700], colors.surface)).toBeGreaterThanOrEqual(4.5);
});
```

Use whatever the file's existing ratio helper is called — match it, do not add a second one.

- [ ] **Step 2: Add board and post baselines**

In `e2e/visual.spec.ts`, add two cases beside the existing thread case, following its exact shape (same auth seed, same `captureScreen` helper):

```ts
test('club board', async ({ page }) => {
  await signIn(page);
  await page.goto('/messages');
  await page.getByText('Everyone at').first().click();
  await expect(page).toHaveScreenshot(await captureScreen(page, 'club-board.png'));
});

test('club post', async ({ page }) => {
  await signIn(page);
  await page.goto('/messages');
  await page.getByText('Everyone at').first().click();
  await page.getByRole('button', { name: /by / }).first().click();
  await expect(page).toHaveScreenshot(await captureScreen(page, 'club-post.png'));
});
```

Match the file's real helper names and auth setup — copy them from the existing thread test rather than inventing.

- [ ] **Step 3: Generate the baselines, and INSPECT the diffs**

```bash
npm run test:visual -- --update-snapshots
```

Then open every changed PNG under `e2e/visual.spec.ts-snapshots/` and look at it. **A blindly refreshed baseline bakes in whatever regressed.** The messages-list baseline will legitimately change only if the club row's appearance changed; if any *other* screen's baseline moved, that is a regression from Tasks 7–9, not a new baseline — go back and find it.

Confirm both new screens captured at full height. `captureScreen` grows the viewport by measuring **overflow**, not content height, because the tab bar is a flex sibling outside the scroller — a screen whose scroller lacks `testID="screen-scroll"` gets silently truncated.

- [ ] **Step 4: Refresh the orientation doc**

In `docs/messaging.md`:

- The header: PR #9 is **merged**; the branch line becomes `feat/club-boards`, cut from `main`.
- *Decisions that must not be silently reversed*: add `root_id` as decision #10, with the composite-foreign-key argument, and note it is a different question from `reply_to_id`.
- *Open items → Capability gap*: **remove it.** Announcement compose is reachable again, from `app/messages/club/new.tsx`.
- *Out of scope by decision*: remove `sub-threads`; add pinning, reply notifications, muting a post, moving a message into a post, and deeper nesting, each with the one-line reason from the spec's §8.
- *Refactor candidates*: `app/messages/[threadId].tsx` is no longer 1094 lines. Replace that section with what the split produced and what must be preserved through any further one.
- *Verifying*: update the green-at-handoff counts to the numbers Step 5 actually prints.

- [ ] **Step 5: Run the whole gate**

```bash
npx supabase db reset --local && npm run test:db
```

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run test:visual
```

Run the visual suite in the FOREGROUND. Then the hosted grant matrix:

```bash
eval "$(npx supabase status -o env | sed -n 's/^API_URL=/export SUPABASE_LOCAL_URL=/p; s/^ANON_KEY=/export SUPABASE_LOCAL_ANON_KEY=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_LOCAL_SERVICE_ROLE_KEY=/p')" && npm run test:db:remote
```

Expected: every suite green. Record the actual counts — they replace `pgTAP 1052/36 · vitest 1042/62 · Playwright 44/44 · tsc clean · hosted grants 115` in `docs/messaging.md`.

- [ ] **Step 6: Push the migrations to the hosted project**

`.env.local` points the app at the hosted project, and none of these five migrations is there yet.

```bash
npx supabase db push
```

⚠️ `20260830040000_archive_club_chat.sql` **moves real club chat into `archived_messages`** on the hosted database. This is the destructive step, taken on the owner's explicit decision. Confirm with the owner before running it, and confirm afterwards that `select count(*) from archived_messages` matches what left `messages`.

- [ ] **Step 7: Commit and open the PR**

```bash
git add e2e/ docs/messaging.md lib/theme.test.ts
git commit -m "test: baseline the club board and refresh the messaging orientation"
git push -u origin feat/club-boards
```

```bash
gh pr create --base main --title "feat: club announcement boards" --body "Turns a club's single flat thread into a board of posts with replies nested one level under each. Announcements are a flag on a root, which restores the announcement compose path the messaging branch removed. Spec: docs/superpowers/specs/2026-08-30-club-announcement-boards-design.md"
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §1 Schema — `root_id`, counters, composite FK, one level, no title, `post_reads` | 1, 2 (RPC guard), 6 (`postTitle`) |
| §2 RPCs — `post_message`, the three reads, grants and allowlist hazards | 2, 3 |
| §3 Sorting and presentation — activity sort, no pin, AA | 3 (sort), 10 (`PostRow`), 13 (`theme.test.ts`) |
| §4 Screens — the split, navigation, compose, Realtime | 7, 8, 9, 10, 11, 12 |
| §5 Migration — `archived_messages`, retained announcement replies, hosted push | 5, 13 |
| §6 Testing — pgTAP fixture, vitest, baselines, mocks, full gate | 1–13, gate in 13 |
| §7 Email — announcement roots only, replies never email | 2 (`p_announce` refused on a reply), 12 (toggle only on new post) |
| §8 Out of scope | 13 (documented in `docs/messaging.md`) |
| §9 Risks | mitigations named in-task: 2 (signature ripple), 10–11 (two modes), 5 (move not delete), 13 (baselines), 9 (unique topic) |

No spec requirement is unassigned.

**Type consistency:** `ClubPost`'s eleven fields match `fetch_club_posts`'s eleven output columns, in order. `fetch_post_messages` returns the same ten columns as `fetch_thread_messages`, so `ThreadMessageRow` serves both and `MessageBubble` takes `ThreadMessage` from either. `postMessage(threadId, body, announce, replyToId, rootId)` is used with exactly that order in Tasks 11 and 12 and asserted with it in Task 6. `markPostRead(rootId)` and `mark_post_read(p_root)` agree.

**Known open judgment calls the implementer must resolve against the real code, not guess:** `Tag`'s prop name (Task 10), `Toggle`/`NoticeBanner`/`Button` prop names and `countBroadcastRecipients`' signature (Task 12), `startsNewGroup`'s argument order (Tasks 7 and 11), whether `Screen` already provides the `screen-scroll` scroller (Task 10), the club-organizer check `lib/clubs.ts` exports (Task 12), and `lib/theme.test.ts`'s contrast helper name (Task 13). Each is named in its task with instructions to check before writing.
