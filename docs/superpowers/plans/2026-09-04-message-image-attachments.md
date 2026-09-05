# Message Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member attach up to 4 images to a message, in every message surface (direct/group threads, club board posts and replies, and the screens that start a new thread or post), stored privately and read back only by thread members.

**Architecture:** A new `message_attachments` table (composite-FK-guarded like `reply_to_id`/`root_id`) and a private `message-images` Storage bucket, both gated by the existing `can_read_thread`/`can_post_thread` predicates. `post_message` gains an optional `p_attachments jsonb` parameter and inserts attachment rows in the same transaction as the message. The client compresses images before upload, uploads to Storage, then calls `post_message` with the resulting paths. Reads always go through short-lived signed URLs.

**Tech Stack:** Expo/React Native (Expo Router, RN 0.86), Supabase (Postgres + Storage + RLS), `expo-image-picker`, `expo-image-manipulator`, `expo-crypto`, vitest, pgTAP, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-04-message-image-attachments-design.md](../specs/2026-09-04-message-image-attachments-design.md)
**Orientation:** [docs/messaging.md](../../messaging.md)

## Global Constraints

- Max 4 images per message (`message_attachments.sort_order between 0 and 3`, enforced again in `post_message`).
- Client-side compression before upload: resize to a 1600px long edge, JPEG quality 0.8.
- Signed URLs expire after 3600 seconds (1 hour), requested in one batch per screen load.
- `message-images` Storage bucket is **private** — never a public URL.
- Storage path convention: `{thread_id}/{uuid}.jpg` — no `message_id`, no `author_id`.
- Body becomes optional **only** when at least one attachment is present; the 2000-character body cap is unchanged.
- Migrations are append-only — never edit a committed one. New migrations start at `20260905020000` (the last committed migration is `20260905010000_accept_invite_ensures_profile.sql`).
- `post_message`'s signature change must be reflected in **both** closed-world arrays in `supabase/tests/database/portable/grants.test.sql`, plus its own `EXECUTE` assertion — three call sites, all in that one file.
- `lib/` never rejects: every exported async resolves `null` or `{ error }`. New code in `lib/attachments.ts` and `lib/messages.ts` follows this.
- Every new scroller/modal that could grow content needs to work with `captureScreen`'s overflow-based viewport measurement (see Task 13) — the tab bar is a flex sibling outside the scroller.

---

## Task 1: `message_attachments` table and RLS

**Files:**
- Create: `supabase/migrations/20260905020000_message_attachments.sql`
- Create: `supabase/tests/database/fixtures/message_attachments_schema.test.sql`

**Interfaces:**
- Produces: table `public.message_attachments (id, message_id, thread_id, storage_path, width, height, sort_order, created_at)`, RLS policy `message_attachments_select` using `can_read_thread(thread_id)`.

- [ ] **Step 1: Write the failing pgTAP fixture**

```sql
begin;
set local search_path to extensions, public;

select plan(8);

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
   'aaaaaaaa-0000-0000-0000-000000000001', 'Riverside message'),
  ('bb000000-0000-0000-0000-00000000000b',
   '22222222-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Lakeside message');

select has_table('public', 'message_attachments', 'message_attachments exists');
select has_column('public', 'message_attachments', 'sort_order', 'has sort_order');
select col_type_is('public', 'message_attachments', 'width', 'integer', 'width is an integer');

insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order)
values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/img1.jpg', 800, 600, 0);

select ok(true, 'a same-thread attachment inserts cleanly');

-- The disclosure guard: an attachment cannot name a message in another
-- thread, the same shape as messages.reply_to_id and root_id.
select throws_ok(
  $$ insert into public.message_attachments
       (message_id, thread_id, storage_path, width, height, sort_order)
     values ('aa000000-0000-0000-0000-00000000000a',
             '22222222-0000-0000-0000-000000000002',
             '22222222-0000-0000-0000-000000000002/img2.jpg', 800, 600, 0) $$,
  '23503',
  null,
  'an attachment naming a message in another thread is unstateable'
);

-- A fifth sort_order is refused at the column check.
select throws_ok(
  $$ insert into public.message_attachments
       (message_id, thread_id, storage_path, width, height, sort_order)
     values ('bb000000-0000-0000-0000-00000000000b',
             '22222222-0000-0000-0000-000000000002',
             '22222222-0000-0000-0000-000000000002/img3.jpg', 800, 600, 4) $$,
  '23514',
  null,
  'sort_order is bounded to 0-3'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- Bob is not a member of Riverside's club (Lakeside only, via the seed
-- above -- actually neither; check_read below proves the deny).
select is(
  (select count(*)::int from public.message_attachments
    where thread_id = '11111111-0000-0000-0000-000000000001'),
  0,
  'a non-member of the thread reads no attachments'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset --local && npx supabase test db --local -f message_attachments_schema`
Expected: FAIL — `relation "public.message_attachments" does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905020000_message_attachments.sql

/*
 * Images attached to a message, up to four, ordered.
 *
 * Same shape as messages.reply_to_id and root_id, and the same reason: a
 * bare `references messages(id)` would be a disclosure bug. A member of two
 * clubs could otherwise cause an attachment row to reference a message in a
 * thread they cannot read, and nothing downstream asks whether the reader
 * may see it -- can_read_thread is asked about a row's OWN thread_id, and a
 * bare message_id carries none of its own to be asked about. See decision
 * #4 in docs/messaging.md.
 *
 * width/height are captured client-side at pick time, not recomputed here --
 * MessageBubble needs them to lay out a correctly-aspect-ratioed placeholder
 * before the signed URL resolves, and asking Postgres to introspect a file
 * it never decodes is unnecessary work.
 */
create table public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null,
  thread_id     uuid not null,
  storage_path  text not null,
  width         int not null check (width > 0),
  height        int not null check (height > 0),
  sort_order    smallint not null check (sort_order between 0 and 3),
  created_at    timestamptz not null default now(),

  unique (message_id, sort_order),

  foreign key (message_id, thread_id)
    references public.messages (id, thread_id) on delete cascade
);

-- The reply screen's read: every attachment for the messages on one page,
-- resolved by lib/messages.ts's batched signed-URL fetch.
create index message_attachments_message on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

-- revoke all first, not belt-and-braces: Supabase grants ALL on every new
-- table in `public` to `authenticated` by default, and ALL includes
-- TRUNCATE, which RLS does not govern. See 20260829000000's own comment.
revoke all on public.message_attachments from authenticated;
grant select on public.message_attachments to authenticated;

-- Rows are written only by post_message (20260905040000), inside the same
-- transaction as the message itself -- never a direct client insert.
create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (public.can_read_thread(thread_id));
```

- [ ] **Step 4: Run the fixture again to verify it passes**

Run: `npx supabase db reset --local && npx supabase test db --local -f message_attachments_schema`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905020000_message_attachments.sql \
        supabase/tests/database/fixtures/message_attachments_schema.test.sql
git commit -m "feat(messaging): add message_attachments table and RLS"
```

---

## Task 2: `message-images` Storage bucket and RLS

**Files:**
- Create: `supabase/migrations/20260905030000_message_images_bucket.sql`
- Create: `supabase/tests/database/fixtures/message_images_storage.test.sql`

**Interfaces:**
- Consumes: `can_read_thread(uuid)`, `can_post_thread(uuid)` (both already `security definer`, granted to `authenticated`).
- Produces: private bucket `message-images`; RLS policies `message_images_select`, `message_images_insert` on `storage.objects`, keyed off the path's leading `{thread_id}` folder.

- [ ] **Step 1: Write the failing pgTAP fixture**

```sql
begin;
set local search_path to extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

select bool_or(id = 'message-images') from storage.buckets \gset present_
select ok(present_bool_or, 'message-images bucket exists');

select ok(
  not (select public from storage.buckets where id = 'message-images'),
  'message-images bucket is private'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Alice is a Riverside member: she can write under that thread's folder.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('message-images',
             '11111111-0000-0000-0000-000000000001/pic.jpg',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'a thread member can write under the thread''s own folder'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- Bob is not a Riverside member: the insert policy denies him, so the row
-- is silently not inserted rather than an exception -- RLS WITH CHECK
-- failures raise 42501 under `insert`, which throws_ok below asserts.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('message-images',
             '11111111-0000-0000-0000-000000000001/intruder.jpg',
             'bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'a non-member cannot write under another thread''s folder'
);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'message-images'
      and name = '11111111-0000-0000-0000-000000000001/pic.jpg'),
  0,
  'a non-member reading that folder sees nothing'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset --local && npx supabase test db --local -f message_images_storage`
Expected: FAIL — no row in `storage.buckets` named `message-images`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905030000_message_images_bucket.sql

/*
 * The app's first Storage bucket. Private -- reads always go through a
 * short-lived signed URL (lib/attachments.ts), never the bucket's public
 * URL, because there is no public URL for a private bucket to leak.
 *
 * Path convention: {thread_id}/{uuid}.jpg -- thread_id leads, and only that.
 * Not message_id: images upload before the message row exists (the client
 * uploads first, then calls post_message with the resulting paths). Not
 * author_id: the read policy only needs to answer "can this viewer see this
 * thread."
 */
insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', false);

/*
 * can_read_thread and can_post_thread are already SECURITY DEFINER and
 * already granted to `authenticated` for exactly this reason (decision #2
 * in docs/messaging.md): an RLS USING/WITH CHECK expression runs as the
 * QUERYING USER, so a function it names must be callable by that user, not
 * only by the RPCs that use it internally.
 *
 * storage.foldername(name) splits the object path on '/' and returns it as
 * a text[]; [1] is the leading {thread_id} segment.
 */
create policy message_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-images'
    and public.can_read_thread((storage.foldername(name))[1]::uuid)
  );

create policy message_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images'
    and public.can_post_thread((storage.foldername(name))[1]::uuid)
  );

-- No update or delete policy: nothing in this design edits or removes an
-- attachment once posted, matching messages having no edit or delete.
```

- [ ] **Step 4: Run the fixture again to verify it passes**

Run: `npx supabase db reset --local && npx supabase test db --local -f message_images_storage`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905030000_message_images_bucket.sql \
        supabase/tests/database/fixtures/message_images_storage.test.sql
git commit -m "feat(messaging): add private message-images Storage bucket and RLS"
```

---

## Task 3: `post_message` learns about attachments

**Files:**
- Create: `supabase/migrations/20260905040000_post_message_attachments.sql`
- Modify: `supabase/tests/database/fixtures/club_board_post.test.sql` (add cases at the end, before `select * from finish();`)
- Modify: `supabase/tests/database/portable/grants.test.sql:739`, `:825`, `:990` (see Step 5)

**Interfaces:**
- Consumes: `public.message_attachments` (Task 1).
- Produces: `post_message(target_thread uuid, p_body text, p_announce boolean default false, p_reply_to uuid default null, p_root uuid default null, p_attachments jsonb default null) returns uuid` — body may now be empty when `p_attachments` carries at least one entry.

- [ ] **Step 1: Write the failing pgTAP fixture (appended to `club_board_post.test.sql`)**

First bump the plan count at the top of that file from `select plan(15);` to `select plan(21);`, then add before the final `select * from finish(); rollback;`:

```sql
-- Attachments: a message may now carry images with no body.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       '', false, null, null,
       '[{"storage_path":"11111111-0000-0000-0000-000000000001/a.jpg","width":800,"height":600}]'::jsonb) $$,
  'an empty body is allowed when an attachment is present'
);

select is(
  (select count(*)::int from public.message_attachments ma
     join public.messages m on m.id = ma.message_id
    where m.body = ''),
  1,
  'the attachment row was inserted'
);

-- Still refused with neither body nor attachments.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       '', false, null, null, null) $$,
  '22023',
  'write something first',
  'empty body with no attachments is still refused'
);

-- A 5th attachment is refused before any row is written.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'five', false, null, null,
       '[{"storage_path":"11111111-0000-0000-0000-000000000001/1.jpg","width":1,"height":1},
         {"storage_path":"11111111-0000-0000-0000-000000000001/2.jpg","width":1,"height":1},
         {"storage_path":"11111111-0000-0000-0000-000000000001/3.jpg","width":1,"height":1},
         {"storage_path":"11111111-0000-0000-0000-000000000001/4.jpg","width":1,"height":1},
         {"storage_path":"11111111-0000-0000-0000-000000000001/5.jpg","width":1,"height":1}]'::jsonb) $$,
  '22023',
  'a message can carry at most 4 images',
  'a fifth attachment is refused'
);

-- A path naming a different thread's folder is refused, belt-and-braces
-- alongside the storage INSERT policy (Task 2) that already makes writing
-- the object itself impossible.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'mismatched', false, null, null,
       '[{"storage_path":"99999999-0000-0000-0000-000000000009/x.jpg","width":1,"height":1}]'::jsonb) $$,
  '22023',
  'an attachment must belong to this conversation',
  'a path naming another thread is refused'
);

-- Order is preserved.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'ordered', false, null, null,
       '[{"storage_path":"11111111-0000-0000-0000-000000000001/first.jpg","width":1,"height":1},
         {"storage_path":"11111111-0000-0000-0000-000000000001/second.jpg","width":1,"height":1}]'::jsonb) $$,
  'two attachments post together'
);

select is(
  (select ma.storage_path from public.message_attachments ma
     join public.messages m on m.id = ma.message_id
    where m.body = 'ordered' and ma.sort_order = 0),
  '11111111-0000-0000-0000-000000000001/first.jpg',
  'sort_order 0 is the first attachment in array order'
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset --local && npx supabase test db --local -f club_board_post`
Expected: FAIL — `function public.post_message(unknown, unknown, boolean, unknown, unknown, jsonb) does not exist`

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905040000_post_message_attachments.sql

/*
 * post_message learns about attachments.
 *
 * DROP then CREATE, not CREATE OR REPLACE, for the same reason
 * 20260830010000 already records: adding a parameter changes the
 * signature, and `create or replace` would leave the old 5-argument
 * function in place as an ambiguous overload. Its signature in BOTH
 * closed-world arrays in portable/grants.test.sql moves with it.
 */
drop function public.post_message(uuid, text, boolean, uuid, uuid);

create function public.post_message(
  target_thread  uuid,
  p_body         text,
  p_announce     boolean default false,
  p_reply_to     uuid default null,
  p_root         uuid default null,
  p_attachments  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller           uuid := (select auth.uid());
  th               public.message_threads;
  body             text := trim(coalesce(p_body, ''));
  subj             text;
  bid              uuid;
  told             int;
  mid              uuid;
  attachment_count int := coalesce(jsonb_array_length(p_attachments), 0);
  attachment       jsonb;
  idx              smallint := 0;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.can_post_thread(target_thread) then
    raise exception 'you cannot post in this conversation' using errcode = '42501';
  end if;

  -- A message may now be empty of body text if it carries at least one
  -- attachment -- attachments give the length bound a second way to be
  -- satisfied, they don't relax it.
  if length(body) = 0 and attachment_count = 0 then
    raise exception 'write something first' using errcode = '22023';
  end if;
  if length(body) > 2000 then
    raise exception 'that message is too long' using errcode = '22023';
  end if;
  if attachment_count > 4 then
    raise exception 'a message can carry at most 4 images' using errcode = '22023';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to and m.thread_id = target_thread
  ) then
    raise exception 'you can only reply to a message in this conversation'
      using errcode = '22023';
  end if;

  select * into th from public.message_threads where id = target_thread;

  if p_root is not null then
    if th.club_id is null or th.event_id is not null then
      raise exception 'only a club has posts to reply to' using errcode = '22023';
    end if;
    if coalesce(p_announce, false) then
      raise exception 'only a new post can be an announcement'
        using errcode = '22023';
    end if;
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

    perform public.assert_club_organizer(th.club_id);

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

    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select r.profile_id, th.club_id, th.event_id, 'broadcast',
           jsonb_build_object('broadcast_id', bid),
           'broadcast:' || bid::text || ':' || r.profile_id::text
      from public.broadcast_recipients(th.club_id, th.event_id) r
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

  /*
   * Each attachment's storage_path must live under this thread's own
   * folder. The storage INSERT policy (20260905030000) already makes a
   * mismatched path unwritable by anyone but a member of the NAMED
   * folder's thread, so this is belt-and-braces the same way the
   * p_reply_to/p_root checks above are: turning something the storage
   * policy already prevents into words a member can read.
   */
  for attachment in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    if left(attachment->>'storage_path', length(target_thread::text) + 1)
         <> target_thread::text || '/' then
      raise exception 'an attachment must belong to this conversation'
        using errcode = '22023';
    end if;

    insert into public.message_attachments
      (message_id, thread_id, storage_path, width, height, sort_order)
    values (
      mid, target_thread,
      attachment->>'storage_path',
      (attachment->>'width')::int,
      (attachment->>'height')::int,
      idx
    );
    idx := idx + 1;
  end loop;

  if p_root is not null then
    update public.messages
       set reply_count = reply_count + 1, last_reply_at = now()
     where id = p_root;
  end if;

  update public.message_threads
     set last_message_at = now()
   where id = target_thread;

  return mid;
end;
$$;

revoke execute on function public.post_message(uuid, text, boolean, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.post_message(uuid, text, boolean, uuid, uuid, jsonb)
  to authenticated;
```

**Note on the `root_id`/`reply_count` block above:** the pre-existing `post_message_roots` migration's reply-count bump was in the version this task's `drop function` removes. Confirm against `supabase/migrations/20260830010000_post_message_roots.sql` before writing this file — if that migration's `insert into public.messages` and reply-count bump differ in any column order or guard from what's reproduced here, copy its exact current text and only add the attachment loop and the widened empty-body check, so nothing else about the roots behavior shifts incidentally.

- [ ] **Step 4: Run the fixture again to verify it passes**

Run: `npx supabase db reset --local && npx supabase test db --local -f club_board_post`
Expected: PASS (21/21)

- [ ] **Step 5: Update `grants.test.sql`'s three call sites**

Open `supabase/tests/database/portable/grants.test.sql`. At each of the three lines that read exactly:

```sql
'public.post_message(uuid, text, boolean, uuid, uuid)',
```

(lines 739 and 825 — both inside `unnest(array[...])` closed-world lists) replace with:

```sql
'public.post_message(uuid, text, boolean, uuid, uuid, jsonb)',
```

And at line 990:

```sql
'authenticated', 'public.post_message(uuid, text, boolean, uuid, uuid)', 'EXECUTE'),
```

replace with:

```sql
'authenticated', 'public.post_message(uuid, text, boolean, uuid, uuid, jsonb)', 'EXECUTE'),
```

- [ ] **Step 6: Run the full local db suite to verify nothing else broke**

Run: `npx supabase db reset --local && npm run test:db`
Expected: PASS, all files green (this is the "run `npm test` on database tasks too" hazard `docs/messaging.md` names — a migration's `raise exception` message must be mapped or allowlisted in `lib/bookings.test.ts`'s ALLOWLIST or that suite goes red separately; the messages here — "an attachment must belong to this conversation", "a message can carry at most 4 images" — are new, so also run Step 7 before considering this task done)

- [ ] **Step 7: Check `lib/bookings.test.ts`'s ALLOWLIST**

Run: `npm test -- lib/bookings.test.ts`
Expected: PASS. If it fails, open `lib/bookings.test.ts`, find the `ALLOWLIST` (or equivalent mapped-message list) it greps every migration against, and add the two new `raise exception` message strings from Step 3 to it — the same treatment every other messaging refusal already gets.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260905040000_post_message_attachments.sql \
        supabase/tests/database/fixtures/club_board_post.test.sql \
        supabase/tests/database/portable/grants.test.sql
git commit -m "feat(messaging): post_message accepts image attachments"
```

---

## Task 4: `fetch_thread_messages` / `fetch_post_messages` return attachments

**Files:**
- Create: `supabase/migrations/20260905050000_message_reads_attachments.sql`
- Modify: `supabase/tests/database/fixtures/club_board_reads.test.sql` (add cases before `select * from finish();`)
- Create/modify: a fixture for `fetch_thread_messages` if one does not already exist for it — check `supabase/tests/database/fixtures/message_threads.test.sql` first; if it already exercises `fetch_thread_messages`, add attachment cases there instead of creating a new file.

**Interfaces:**
- Consumes: `public.message_attachments` (Task 1).
- Produces: both RPCs gain a trailing `attachments jsonb` column — `'[]'::jsonb` when none, else an array of `{id, storage_path, width, height}` ordered by `sort_order`.

- [ ] **Step 1: Write the failing pgTAP cases**

Add to `supabase/tests/database/fixtures/club_board_reads.test.sql` (bump its `plan(n)` count by 2), before `select * from finish();`:

```sql
insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order)
values
  ((select id from public.messages where body = 'Anyone free Thursday?'),
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/a.jpg', 800, 600, 0),
  ((select id from public.messages where body = 'Anyone free Thursday?'),
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/b.jpg', 400, 300, 1);

select is(
  jsonb_array_length(
    (select attachments from public.fetch_post_messages(
       (select id from public.messages where body = 'Anyone free Thursday?')
     ) where id = (select id from public.messages where body = 'Anyone free Thursday?'))
  ),
  2,
  'fetch_post_messages returns both attachments for the root'
);

select is(
  (select attachments -> 0 ->> 'storage_path' from public.fetch_post_messages(
     (select id from public.messages where body = 'Anyone free Thursday?')
   ) where id = (select id from public.messages where body = 'Anyone free Thursday?')),
  '11111111-0000-0000-0000-000000000001/a.jpg',
  'attachments come back ordered by sort_order'
);
```

Adjust the exact `set local role`/`request.jwt.claims` block to run as whichever member the surrounding fixture already establishes for reading — match the existing file's pattern rather than introducing a new one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset --local && npx supabase test db --local -f club_board_reads`
Expected: FAIL — `column "attachments" does not exist` (the function's return type doesn't have it yet)

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905050000_message_reads_attachments.sql

/*
 * fetch_thread_messages and fetch_post_messages learn to return each
 * message's attachments, resolved with a lateral aggregate rather than a
 * second round trip -- the same choice fetch_thread_messages already made
 * for the quoted-parent join (20260829080000).
 *
 * DROP then CREATE: both functions' RETURNS TABLE shape changes (a new
 * trailing column), which is a signature change for grants.test.sql
 * purposes exactly as post_message's parameter change was -- both entries
 * there change from `(uuid)` to the same `(uuid)`, since the return type is
 * not part of a function's identity in pg_proc/regprocedure. Confirmed: no
 * grants.test.sql edit is needed for THIS migration, only Task 3's.
 */
drop function public.fetch_thread_messages(uuid);
drop function public.fetch_post_messages(uuid);

create function public.fetch_thread_messages(target_thread uuid)
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
  reply_to_author text,
  attachments     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name,
           coalesce(att.attachments, '[]'::jsonb)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height
                 ) order by a.sort_order
               ) as attachments
          from public.message_attachments a
         where a.message_id = m.id and a.thread_id = m.thread_id
      ) att on true
     where m.thread_id = target_thread
     order by m.created_at, m.id;
end;
$$;

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
  reply_to_author text,
  attachments     jsonb
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

  if th is null then
    raise exception 'that post is no longer here' using errcode = '22023';
  end if;

  if not public.can_read_thread(th) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name,
           coalesce(att.attachments, '[]'::jsonb)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height
                 ) order by a.sort_order
               ) as attachments
          from public.message_attachments a
         where a.message_id = m.id and a.thread_id = m.thread_id
      ) att on true
     where m.id = p_root or m.root_id = p_root
     order by m.created_at, m.id;
end;
$$;

revoke execute on function public.fetch_thread_messages(uuid) from public, anon;
revoke execute on function public.fetch_post_messages(uuid) from public, anon;
grant execute on function public.fetch_thread_messages(uuid) to authenticated;
grant execute on function public.fetch_post_messages(uuid) to authenticated;
```

- [ ] **Step 4: Run the fixture again to verify it passes**

Run: `npx supabase db reset --local && npx supabase test db --local -f club_board_reads`
Expected: PASS

- [ ] **Step 5: Run the full local db suite**

Run: `npx supabase db reset --local && npm run test:db`
Expected: PASS, all files green.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905050000_message_reads_attachments.sql \
        supabase/tests/database/fixtures/club_board_reads.test.sql
git commit -m "feat(messaging): fetch_thread_messages/fetch_post_messages return attachments"
```

---

## Task 5: `lib/messages.ts` — types, `postMessage`, and read mapping

**Files:**
- Modify: `lib/messages.ts:45-62` (the `ThreadMessage` type), `lib/messages.ts:740-779` (`ThreadMessageRow`/`mapThreadMessageRow`), `lib/messages.ts:938-963` (`postMessage`)
- Modify: `lib/messages.test.ts:920-980` (`postMessage` describe block), and the `ThreadMessage`-shaped fixtures wherever `fetchThreadMessages`/`fetchPostMessages` tests build rows (`lib/messages.test.ts:762-838`, `:1078-1163`)

**Interfaces:**
- Produces: `export type MessageAttachment = { id: string; storage_path: string; width: number; height: number }`, `export type MessageAttachmentInput = { storage_path: string; width: number; height: number }`, `ThreadMessage.attachments: MessageAttachment[]`, `postMessage(threadId, body, announce?, replyToId?, rootId?, attachments?: MessageAttachmentInput[])`.
- Consumes: nothing new — this task only reshapes existing exports.

- [ ] **Step 1: Write the failing tests**

In `lib/messages.test.ts`, replace the existing `describe('postMessage', ...)` block (currently `lib/messages.test.ts:921-980`) with:

```ts
describe('postMessage', () => {
  beforeEach(() => rpcMock.mockReset());

  it('posts, defaulting announce to false', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm1', error: null });
    await expect(postMessage('t1', ' hello ')).resolves.toEqual({
      id: 'm1',
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'hello',
      p_announce: false,
      p_reply_to: null,
      p_root: null,
      p_attachments: null,
    });
  });

  it('carries the quoted message when replying', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm4', error: null });
    await postMessage('t1', 'Yes', false, 'm1');
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'Yes',
      p_announce: false,
      p_reply_to: 'm1',
      p_root: null,
      p_attachments: null,
    });
  });

  it('refuses an empty body with no attachments before ever calling the RPC', async () => {
    await expect(postMessage('t1', '   ')).resolves.toEqual({
      id: null,
      error: 'Write something first.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('allows an empty body when an attachment is present', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm5', error: null });
    await expect(
      postMessage('t1', '   ', false, null, null, [
        { storage_path: 't1/a.jpg', width: 800, height: 600 },
      ]),
    ).resolves.toEqual({ id: 'm5', error: null });
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: '',
      p_announce: false,
      p_reply_to: null,
      p_root: null,
      p_attachments: [{ storage_path: 't1/a.jpg', width: 800, height: 600 }],
    });
  });

  it('relays a refusal verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'you cannot post in this conversation' },
    });
    await expect(postMessage('t1', 'hi')).resolves.toEqual({
      id: null,
      error: 'you cannot post in this conversation',
    });
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(postMessage('t1', 'hi')).resolves.toEqual({
      id: null,
      error: GENERIC_ERROR,
    });
  });
});
```

Then update `describe('fetchThreadMessages', ...)` (`lib/messages.test.ts:762-838`) and `describe('fetchPostMessages', ...)` (`:1078-1163`): every mocked RPC row object needs a trailing `attachments: []` field (or a populated array for a case that asserts attachment mapping), and every expected `ThreadMessage` the test compares against needs a matching `attachments` field. Add one new case to `fetchThreadMessages`'s describe block:

```ts
it('maps attachments in order', async () => {
  rpcMock.mockResolvedValueOnce({
    data: [
      {
        id: 'm1',
        author_id: 'u1',
        author_name: 'Alice',
        body: '',
        subject: null,
        is_announcement: false,
        created_at: '2026-09-04T10:00:00Z',
        reply_to_id: null,
        reply_to_body: null,
        reply_to_author: null,
        attachments: [
          { id: 'a1', storage_path: 't1/a.jpg', width: 800, height: 600 },
        ],
      },
    ],
    error: null,
  });
  const rows = await fetchThreadMessages('t1');
  expect(rows?.[0]?.attachments).toEqual([
    { id: 'a1', storage_path: 't1/a.jpg', width: 800, height: 600 },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/messages.test.ts`
Expected: FAIL — `p_attachments` missing from the actual call, and `attachments` missing from mapped rows / type errors from `npx tsc --noEmit` once Step 1's fixtures reference a field the type doesn't have yet.

- [ ] **Step 3: Update `lib/messages.ts`**

Add near the top, after `ThreadMessage`'s existing block (`lib/messages.ts:45-62`):

```ts
export type MessageAttachment = {
  id: string;
  storage_path: string;
  width: number;
  height: number;
};

/** What `postMessage` sends for a not-yet-attached image — no `id` yet. */
export type MessageAttachmentInput = {
  storage_path: string;
  width: number;
  height: number;
};
```

And add `attachments: MessageAttachment[];` as a new field on `ThreadMessage` (after `reply_to`).

Update `ThreadMessageRow` (`lib/messages.ts:741-752`) to add `attachments: MessageAttachment[];` as a trailing field, and `mapThreadMessageRow` (`lib/messages.ts:761-779`) to carry it through:

```ts
function mapThreadMessageRow(r: ThreadMessageRow): ThreadMessage {
  return {
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
    attachments: r.attachments ?? [],
  };
}
```

Replace `postMessage` (`lib/messages.ts:938-963`):

```ts
/** How many images a single message may carry. Mirrors post_message's own bound. */
export const MAX_ATTACHMENTS = 4;

export async function postMessage(
  threadId: string,
  body: string,
  announce = false,
  replyToId: string | null = null,
  // Null in a game or direct thread, and null for a NEW post on a club
  // board. Set only when replying inside a post.
  rootId: string | null = null,
  attachments: MessageAttachmentInput[] = [],
): Promise<{ id: string | null; error: string | null }> {
  const trimmed = (body ?? '').trim();
  // Checked here as well as in post_message so a member who taps Send on an
  // empty composer with no attachments gets an answer without a round trip.
  // An attachment gives this bound a second way to be satisfied -- it does
  // not relax it.
  if (trimmed.length === 0 && attachments.length === 0) {
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
    p_attachments: attachments.length > 0 ? attachments : null,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/messages.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/messages.ts lib/messages.test.ts
git commit -m "feat(messaging): thread messages carry attachments, postMessage sends them"
```

---

## Task 6: `lib/attachments.ts` — pick, compress, upload, sign

**Files:**
- Create: `lib/attachments.ts`
- Create: `lib/attachments.test.ts`
- Modify: `package.json` (add `expo-image-picker`, `expo-image-manipulator`, `expo-crypto`)
- Modify: `app.json` (add `expo-image-picker`'s plugin config)

**Interfaces:**
- Produces: `pickImages(source: 'camera' | 'library'): Promise<PickedImage[] | null>`, `compressImage(image: PickedImage): Promise<PickedImage>`, `uploadAttachment(threadId: string, image: PickedImage): Promise<{ storagePath: string | null; error: string | null }>`, `getSignedUrls(paths: string[]): Promise<Record<string, string>>`, `type PickedImage = { uri: string; width: number; height: number }`.
- Consumes: `supabase` (`lib/supabase.ts`).

- [ ] **Step 1: Install the new dependencies**

```bash
npx expo install expo-image-picker expo-image-manipulator expo-crypto
```

`expo install` (not plain `npm install`) pins each package to the version this project's `expo` (`~57.0.9`) expects, matching how every other `expo-*` dependency in `package.json` is already pinned (`~57.0.x`).

- [ ] **Step 2: Add the Expo config plugin for image-picker permissions**

Edit `app.json`'s `plugins` array (currently ending `"expo-splash-screen"`) to add the picker plugin with its permission strings, since this is the app's first feature to request camera or photo-library access:

```json
"plugins": [
  "expo-router",
  "expo-apple-authentication",
  "expo-web-browser",
  "@react-native-community/datetimepicker",
  "expo-font",
  "expo-splash-screen",
  [
    "expo-image-picker",
    {
      "photosPermission": "MahjHero uses your photos to attach images to messages.",
      "cameraPermission": "MahjHero uses your camera to attach a photo to a message."
    }
  ]
]
```

- [ ] **Step 3: Write the failing test for the signed-URL cache**

```ts
// lib/attachments.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrlsMock = vi.fn();
const uploadMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: (...args: unknown[]) => createSignedUrlsMock(...args),
        upload: (...args: unknown[]) => uploadMock(...args),
      })),
    },
  },
}));

import { getSignedUrls, MAX_ATTACHMENTS } from './attachments';

describe('getSignedUrls', () => {
  beforeEach(() => {
    createSignedUrlsMock.mockReset();
  });

  it('requests every path in one batched call', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [
        { path: 't1/a.jpg', signedUrl: 'https://example.com/a', error: null },
        { path: 't1/b.jpg', signedUrl: 'https://example.com/b', error: null },
      ],
      error: null,
    });
    const urls = await getSignedUrls(['t1/a.jpg', 't1/b.jpg']);
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['t1/a.jpg', 't1/b.jpg'], 3600);
    expect(urls).toEqual({
      't1/a.jpg': 'https://example.com/a',
      't1/b.jpg': 'https://example.com/b',
    });
  });

  it('caches a path already resolved this session and does not re-request it', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [{ path: 't1/a.jpg', signedUrl: 'https://example.com/a', error: null }],
      error: null,
    });
    await getSignedUrls(['t1/a.jpg']);
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [{ path: 't1/c.jpg', signedUrl: 'https://example.com/c', error: null }],
      error: null,
    });
    const urls = await getSignedUrls(['t1/a.jpg', 't1/c.jpg']);
    expect(createSignedUrlsMock).toHaveBeenLastCalledWith(['t1/c.jpg'], 3600);
    expect(urls).toEqual({
      't1/a.jpg': 'https://example.com/a',
      't1/c.jpg': 'https://example.com/c',
    });
  });

  it('returns an empty map rather than throwing on failure', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    await expect(getSignedUrls(['t1/missing.jpg'])).resolves.toEqual({});
  });
});

describe('MAX_ATTACHMENTS', () => {
  it('is 4, mirroring post_message’s own bound', () => {
    expect(MAX_ATTACHMENTS).toBe(4);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- lib/attachments.test.ts`
Expected: FAIL — `Cannot find module './attachments'`

- [ ] **Step 5: Write `lib/attachments.ts`**

```ts
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

const BUCKET = 'message-images';

/** Mirrors post_message's own bound (lib/messages.ts's MAX_ATTACHMENTS). */
export const MAX_ATTACHMENTS = 4;

/** The long edge a compressed upload is resized to, and its JPEG quality. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

/** How long a signed URL lives before it must be re-requested. */
const SIGNED_URL_TTL_SECONDS = 3600;

export type PickedImage = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Opens the system library or camera picker. Returns `null` on cancel or a
 * denied permission -- never throws, matching this module's own "never
 * rejects" contract (lib/messages.ts's decision #9, applied here too).
 *
 * Multi-select only applies to the library: a single camera capture is one
 * photo, so `selectionLimit` is meaningless there.
 */
export async function pickImages(
  source: 'camera' | 'library',
  alreadyPicked: number,
): Promise<PickedImage[] | null> {
  const remaining = MAX_ATTACHMENTS - alreadyPicked;
  if (remaining <= 0) return null;

  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return null;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || result.assets.length === 0) return null;
      const a = result.assets[0];
      return [{ uri: a.uri, width: a.width, height: a.height }];
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled) return null;
    return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
  } catch (cause) {
    console.error('pickImages failed', cause);
    return null;
  }
}

/**
 * Resizes to a 1600px long edge and re-encodes as JPEG at 0.8 quality
 * before upload -- a modern phone photo can be 5-15MB, and nothing about
 * this app's realtime-driven UI wants to move that much data per message.
 * A source already smaller than the long edge is not upscaled.
 */
export async function compressImage(image: PickedImage): Promise<PickedImage> {
  const longEdge = Math.max(image.width, image.height);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const context = ImageManipulator.manipulate(image.uri);
  if (scale < 1) {
    context.resize({
      width: Math.round(image.width * scale),
      height: Math.round(image.height * scale),
    });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Uploads one already-compressed image to `{threadId}/{uuid}.jpg`. The
 * storage INSERT policy (20260905030000) is what actually enforces that
 * only a member of this thread can write here -- this function does not
 * duplicate that check, it just names the path the policy expects.
 */
export async function uploadAttachment(
  threadId: string,
  image: PickedImage,
): Promise<{ storagePath: string | null; error: string | null }> {
  try {
    const path = `${threadId}/${Crypto.randomUUID()}.jpg`;
    const response = await fetch(image.uri);
    const bytes = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg' });
    if (error) return { storagePath: null, error: error.message };
    return { storagePath: path, error: null };
  } catch (cause) {
    console.error('uploadAttachment failed', cause);
    return { storagePath: null, error: GENERIC_ERROR };
  }
}

// Session-lifetime cache, keyed by storage path. A signed URL is only ever
// re-requested once its own TTL has elapsed -- not on every render, and not
// once per image, since getSignedUrls always batches.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Batches every path into ONE createSignedUrls call rather than one request
 * per image -- a thread screen with a dozen visible attachments would
 * otherwise fire a dozen round trips on every load.
 */
export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const toFetch: string[] = [];

  for (const path of paths) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) {
      result[path] = cached.url;
    } else {
      toFetch.push(path);
    }
  }

  if (toFetch.length === 0) return result;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(toFetch, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.error('getSignedUrls failed', error);
      return result;
    }
    for (const row of data) {
      if (!row.signedUrl) continue;
      signedUrlCache.set(row.path ?? '', {
        url: row.signedUrl,
        expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
      });
      result[row.path ?? ''] = row.signedUrl;
    }
    return result;
  } catch (cause) {
    console.error('getSignedUrls failed', cause);
    return result;
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- lib/attachments.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If `expo-image-manipulator`'s exported API differs from `ImageManipulator.manipulate(...).resize(...).renderAsync()`/`SaveFormat.JPEG` as installed, `tsc` will name the actual mismatch — fix `compressImage` to match the installed package's real types rather than adjusting the type-checker.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app.json lib/attachments.ts lib/attachments.test.ts
git commit -m "feat(messaging): add lib/attachments.ts (pick, compress, upload, sign)"
```

---

## Task 7: `components/messages/AttachmentPicker.tsx`

**Files:**
- Create: `components/messages/AttachmentPicker.tsx`

**Interfaces:**
- Consumes: `pickImages`, `compressImage`, `uploadAttachment`, `MAX_ATTACHMENTS`, `type PickedImage` (`lib/attachments.ts`).
- Produces: `<AttachmentPicker threadId={string} onAttachmentsChange={(ready: MessageAttachmentInput[], pending: boolean) => void} />` — a `key`-remountable component (the caller bumps its `key` prop to reset it after a successful send, the same reset shape a controlled form input would need; there is no imperative reset method).

This component owns its own upload-progress state internally and only reports finished results upward — the same shape `MembersPanel.tsx` already uses ("MembersPanel owns everything about opening Add people and leaving," per `Composer.tsx`'s own docstring) for a self-contained concern the caller doesn't need to micromanage.

- [ ] **Step 1: Write the component**

```tsx
// components/messages/AttachmentPicker.tsx
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon, TrashIcon } from '../icons';
import {
  compressImage,
  pickImages,
  uploadAttachment,
  MAX_ATTACHMENTS,
  type PickedImage,
} from '../../lib/attachments';
import type { MessageAttachmentInput } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Item = {
  localId: string;
  uri: string;
  width: number;
  height: number;
  storagePath: string | null;
  status: 'uploading' | 'done' | 'error';
};

type Props = {
  threadId: string;
  onAttachmentsChange: (ready: MessageAttachmentInput[], pending: boolean) => void;
};

let nextLocalId = 0;

export default function AttachmentPicker({ threadId, onAttachmentsChange }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  // Reports upward whenever the item list changes -- the caller derives
  // Send's disabled state from `pending` and the final payload from `ready`.
  // A ref, not a dependency on `onAttachmentsChange` itself: the callers
  // below pass an inline closure, and re-running this effect on every
  // parent render (rather than only when `items` actually changes) would
  // fire it far more than the caller's own state actually changed.
  const onChangeRef = useRef(onAttachmentsChange);
  onChangeRef.current = onAttachmentsChange;
  useEffect(() => {
    const ready = items
      .filter((i): i is Item & { storagePath: string } => i.status === 'done' && i.storagePath !== null)
      .map((i) => ({ storage_path: i.storagePath, width: i.width, height: i.height }));
    const pending = items.some((i) => i.status === 'uploading');
    onChangeRef.current(ready, pending);
  }, [items]);

  async function addPicked(picked: PickedImage[]) {
    const pending: Item[] = picked.map((p) => ({
      localId: `a${nextLocalId++}`,
      uri: p.uri,
      width: p.width,
      height: p.height,
      storagePath: null,
      status: 'uploading',
    }));
    setItems((prev) => [...prev, ...pending]);

    for (const [index, picture] of picked.entries()) {
      const localId = pending[index].localId;
      try {
        const compressed = await compressImage(picture);
        const { storagePath, error } = await uploadAttachment(threadId, compressed);
        setItems((prev) =>
          prev.map((i) =>
            i.localId === localId
              ? {
                  ...i,
                  width: compressed.width,
                  height: compressed.height,
                  storagePath,
                  status: error || !storagePath ? 'error' : 'done',
                }
              : i,
          ),
        );
      } catch (cause) {
        console.error('attachment upload failed', cause);
        setItems((prev) =>
          prev.map((i) => (i.localId === localId ? { ...i, status: 'error' } : i)),
        );
      }
    }
  }

  async function choose(source: 'camera' | 'library') {
    setSourceMenuOpen(false);
    const picked = await pickImages(source, items.length);
    if (picked && picked.length > 0) void addPicked(picked);
  }

  function remove(localId: string) {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  }

  const atLimit = items.length >= MAX_ATTACHMENTS;

  return (
    <View style={styles.container}>
      {items.length > 0 ? (
        <View style={styles.strip} testID="attachment-strip">
          {items.map((item) => (
            <View key={item.localId} style={styles.thumbWrap}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
              {item.status === 'uploading' ? (
                <View style={styles.overlay}>
                  <Text style={styles.overlayText}>…</Text>
                </View>
              ) : null}
              {item.status === 'error' ? (
                <View style={[styles.overlay, styles.overlayError]}>
                  <Text style={styles.overlayText}>!</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => remove(item.localId)}
                accessibilityRole="button"
                accessibilityLabel="Remove image"
                style={styles.removeButton}
              >
                <TrashIcon size={14} color={colors.bg} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => setSourceMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Attach an image"
        disabled={atLimit}
        style={[styles.attachButton, atLimit ? styles.attachButtonDisabled : null]}
      >
        <PlusIcon size={18} color={colors.text} />
      </Pressable>

      {/*
        A hand-rolled action sheet, not Alert.alert: react-native-web's
        Alert has no real UI (it degrades to a no-op or a bare confirm()),
        and this app targets web as a first-class platform. Modal is the
        same primitive RoundTimer.tsx already uses for an overlay.
      */}
      <Modal
        visible={sourceMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSourceMenuOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setSourceMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <View style={styles.sheet}>
            {/* Camera capture has no reliable web equivalent -- library only there. */}
            {Platform.OS !== 'web' ? (
              <Pressable
                onPress={() => void choose('camera')}
                accessibilityRole="button"
                style={styles.sheetOption}
              >
                <Text style={styles.sheetOptionText}>Take a photo</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void choose('library')}
              accessibilityRole="button"
              style={styles.sheetOption}
            >
              <Text style={styles.sheetOptionText}>Choose from library</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[2] },
  strip: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  thumbWrap: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(32, 30, 29, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayError: { backgroundColor: 'rgba(140, 73, 26, 0.65)' },
  overlayText: { color: colors.bg, fontFamily: type.bodyBold, fontSize: type.size.body },
  removeButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  attachButtonDisabled: { opacity: 0.4 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(32, 30, 29, 0.3)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    gap: space[2],
  },
  sheetOption: { paddingVertical: space[3] },
  sheetOptionText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. `View`'s `inset` style shorthand requires RN's `Position` typing to accept it (available since RN 0.72's StyleSheet types) — if `tsc` rejects `inset: 0` on this RN version, replace it with `{ top: 0, left: 0, right: 0, bottom: 0 }` in the `overlay`/`overlayError` styles instead.

- [ ] **Step 3: Commit**

```bash
git add components/messages/AttachmentPicker.tsx
git commit -m "feat(messaging): add AttachmentPicker (pick, compress, upload, thumbnail strip)"
```

---

## Task 8: `components/messages/AttachmentGrid.tsx` and the full-screen viewer

**Files:**
- Create: `components/messages/AttachmentGrid.tsx`

**Interfaces:**
- Consumes: `getSignedUrls` (`lib/attachments.ts`), `type MessageAttachment` (`lib/messages.ts`).
- Produces: `<AttachmentGrid attachments={MessageAttachment[]} />` — renders nothing when `attachments.length === 0`.

- [ ] **Step 1: Write the component**

```tsx
// components/messages/AttachmentGrid.tsx
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { getSignedUrls } from '../../lib/attachments';
import type { MessageAttachment } from '../../lib/messages';
import { colors, radius, space } from '../../lib/theme';

type Props = { attachments: MessageAttachment[] };

/**
 * 1-4 images as a grid: one full width, two side by side, three or four as
 * a 2x2 (a lone third slot spans the remaining width rather than leaving a
 * gap). Sized from the stored width/height so the bubble doesn't reflow
 * once the signed URL resolves and the real image loads.
 */
export default function AttachmentGrid({ attachments }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (attachments.length === 0) return;
    let cancelled = false;
    void getSignedUrls(attachments.map((a) => a.storage_path)).then((resolved) => {
      if (!cancelled) setUrls(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  if (attachments.length === 0) return null;

  return (
    <View style={styles.grid} testID="attachment-grid">
      {attachments.map((a, index) => (
        <Pressable
          key={a.id}
          onPress={() => setViewerIndex(index)}
          accessibilityRole="button"
          accessibilityLabel={`View image ${index + 1} of ${attachments.length}`}
          style={[
            styles.cell,
            attachments.length === 1 ? styles.cellSingle : styles.cellGrid,
            { aspectRatio: attachments.length === 1 ? a.width / a.height : 1 },
          ]}
        >
          {urls[a.storage_path] ? (
            <Image source={{ uri: urls[a.storage_path] }} style={styles.image} />
          ) : (
            <View style={styles.placeholder} />
          )}
        </Pressable>
      ))}

      {viewerIndex !== null ? (
        <AttachmentViewer
          attachments={attachments}
          urls={urls}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

function AttachmentViewer({
  attachments,
  urls,
  startIndex,
  onClose,
}: {
  attachments: MessageAttachment[];
  urls: Record<string, string>;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const { width, height } = useWindowDimensions();
  const current = attachments[index];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.viewerBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close image viewer"
      >
        {urls[current.storage_path] ? (
          <Image
            source={{ uri: urls[current.storage_path] }}
            style={{ width, height: height * 0.8 }}
            resizeMode="contain"
          />
        ) : null}
      </Pressable>
      {attachments.length > 1 ? (
        <View style={styles.viewerNav} pointerEvents="box-none">
          <Pressable
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            accessibilityRole="button"
            accessibilityLabel="Previous image"
            disabled={index === 0}
            style={styles.viewerNavButton}
          >
            {index > 0 ? <ChevronLeftIcon size={28} color={colors.bg} /> : null}
          </Pressable>
          <Pressable
            onPress={() => setIndex((i) => Math.min(attachments.length - 1, i + 1))}
            accessibilityRole="button"
            accessibilityLabel="Next image"
            disabled={index === attachments.length - 1}
            style={styles.viewerNavButton}
          >
            {index < attachments.length - 1 ? (
              <ChevronRightIcon size={28} color={colors.bg} />
            ) : null}
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[2] },
  cell: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: 'transparent' },
  cellSingle: { width: '100%' },
  cellGrid: { width: '48%' },
  image: { width: '100%', height: '100%' },
  placeholder: { width: '100%', height: '100%', backgroundColor: 'rgba(32, 30, 29, 0.08)' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNav: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  viewerNavButton: {
    width: 64,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/messages/AttachmentGrid.tsx
git commit -m "feat(messaging): add AttachmentGrid and full-screen image viewer"
```

---

## Task 9: Wire `MessageBubble.tsx` to render attachments

**Files:**
- Modify: `components/messages/MessageBubble.tsx`

**Interfaces:**
- Consumes: `<AttachmentGrid attachments={...} />` (Task 8).

- [ ] **Step 1: Add the import and render call**

In `components/messages/MessageBubble.tsx`, add the import alongside the existing ones (after the `Tag` import):

```tsx
import AttachmentGrid from './AttachmentGrid';
```

Insert `<AttachmentGrid attachments={m.attachments} />` immediately after the quote-stub block and before the `displayBody` block (i.e., between the closing `) : null}` of the `m.reply_to` conditional and the `{displayBody ? (` line), so an image-only message (empty `displayBody`) still renders its images with nothing empty above them.

- [ ] **Step 2: Update the component's baseline snapshot expectations mentally, then move to Task 13 for the real Playwright regen**

No action here — flagged so this task isn't mistaken for done without a visual check; Task 13 covers it.

- [ ] **Step 3: Typecheck and run the existing bubble tests**

Run: `npx tsc --noEmit && npm test -- components`
Expected: PASS. If any existing `MessageBubble` test builds a `ThreadMessage` fixture without an `attachments` field, add `attachments: []` to that fixture (the type from Task 5 requires it).

- [ ] **Step 4: Commit**

```bash
git add components/messages/MessageBubble.tsx
git commit -m "feat(messaging): MessageBubble renders attached images"
```

---

## Task 10: Wire the flat thread screen and its post-reply counterpart

**Files:**
- Modify: `components/messages/Composer.tsx`
- Modify: `app/messages/[threadId].tsx:75-187` (state and `send`)
- Modify: `app/messages/club/[threadId]/[postId].tsx` (its own `send`, same shape)

**Interfaces:**
- Consumes: `<AttachmentPicker threadId={...} onAttachmentsChange={...} />` (Task 7), `postMessage(..., attachments)` (Task 5).
- Produces: `Composer`'s `Props` gains `threadId: string`, `attachments: MessageAttachmentInput[]`, `onAttachmentsChange: (ready, pending) => void`, `attachmentsResetKey: number`; `sending` now also reflects "an attachment upload is still in flight."

- [ ] **Step 1: Add attachment props to `Composer.tsx`**

In `components/messages/Composer.tsx`, add to the `Props` type (after `sending: boolean;`):

```tsx
  threadId: string;
  attachments: MessageAttachmentInput[];
  onAttachmentsChange: (ready: MessageAttachmentInput[], pending: boolean) => void;
  /** Bumped by the caller after a successful send to remount AttachmentPicker clean. */
  attachmentsResetKey: number;
```

Add the import (with the existing `quoteStub, type ThreadMessage` import line, extend it):

```tsx
import { quoteStub, type MessageAttachmentInput, type ThreadMessage } from '../../lib/messages';
import AttachmentPicker from './AttachmentPicker';
```

Destructure the new props in the function signature, and render `<AttachmentPicker key={attachmentsResetKey} threadId={threadId} onAttachmentsChange={onAttachmentsChange} />` inside the `<View style={styles.composer}>` block, before the `<TextInput>` — as its own row above the input/send row, since a thumbnail strip needs its own width rather than squeezing beside the input:

```tsx
      <AttachmentPicker
        key={attachmentsResetKey}
        threadId={threadId}
        onAttachmentsChange={onAttachmentsChange}
      />
      <View style={styles.composer}>
        <TextInput
          ...
```

The `Send` button's `disabled={sending}` is unchanged here — Composer stays presentation-only, same as its own docstring already states; whether an attachment upload is in flight is folded into the caller's own `sending` state (Step 2 below), not tracked separately inside Composer.

- [ ] **Step 2: Wire `app/messages/[threadId].tsx`**

Add state near the existing `replyTo`/`sending` declarations (`app/messages/[threadId].tsx:75-92`):

```tsx
  const [attachments, setAttachments] = useState<MessageAttachmentInput[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [attachmentsResetKey, setAttachmentsResetKey] = useState(0);
```

Add `MessageAttachmentInput` to the existing `lib/messages` import list.

Replace the `send` callback (`app/messages/[threadId].tsx:155-187`) — change the guard and the `postMessage` call:

```tsx
  const send = useCallback(async () => {
    if (sendingRef.current || attachmentsPending || !threadId) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      false,
      replyTo?.id ?? null,
      null,
      attachments,
    );
    if (refusal) {
      sendingRef.current = false;
      setSending(false);
      setError(refusal);
      return;
    }
    setDraft('');
    setReplyTo(null);
    setAttachments([]);
    setAttachmentsResetKey((k) => k + 1);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, draft, replyTo, attachments, attachmentsPending, load]);
```

Update the `<Composer>` element (`app/messages/[threadId].tsx:372-378`) to pass the new props:

```tsx
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={() => void send()}
            sending={sending || attachmentsPending}
            threadId={threadId ?? ''}
            attachments={attachments}
            onAttachmentsChange={(ready, pending) => {
              setAttachments(ready);
              setAttachmentsPending(pending);
            }}
            attachmentsResetKey={attachmentsResetKey}
          />
```

- [ ] **Step 3: Wire `app/messages/club/[threadId]/[postId].tsx` the same way**

Apply the identical shape: add `attachments`/`attachmentsPending`/`attachmentsResetKey` state, thread the `MessageAttachmentInput` import, extend its `send` function's `postMessage(...)` call with `attachments` as the final positional argument (its `p_root` argument stays whatever it already passes — this screen already supplies a `rootId`, unlike the flat thread screen), reset `attachments`/`attachmentsResetKey` alongside its own draft-clearing on success, and pass the five new props to its `<Composer>` element the same way.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification (this task has no dev server preview per this project's conventions — see Task 13 for the scripted equivalent)**

Run: `npm test -- app/messages`
Expected: PASS. If an existing test for either screen calls `postMessage` and asserts the exact argument list, update that assertion to include the trailing `[]` (empty attachments) the same way Task 5's `postMessage` tests were updated.

- [ ] **Step 6: Commit**

```bash
git add components/messages/Composer.tsx app/messages/[threadId].tsx \
        "app/messages/club/[threadId]/[postId].tsx"
git commit -m "feat(messaging): wire image attachments into the thread and post composers"
```

---

## Task 11: `app/messages/new.tsx` becomes a people-picker only

**Files:**
- Modify: `app/messages/new.tsx`
- Modify: `app/messages/new.test.tsx` (or wherever this screen's tests live — locate via `find . -iname "new.test.tsx" -path "*messages*"`)

**Interfaces:**
- Removes: this screen's `postMessage` call and its `draft`/message-input UI entirely.
- Produces: `start()` now only creates the thread (or opens the existing one) and navigates to it — the first message, attachments included, is composed on `/messages/{threadId}` using Task 10's already-wired `Composer`.

**Resolved sequencing (confirmed with the user):** split into two visible steps. This screen creates the thread as soon as people are picked and immediately navigates to it; the thread screen's own composer — already carrying `AttachmentPicker` from Task 10 — is where the first message, with or without images, actually gets typed and sent. This is a genuine simplification of this screen, not just a wiring change: the `draft` state, the "write something first" pre-check, the `createdThreadRef` retry-dedup guard (there is no longer a second RPC call after thread creation that could fail and need retrying into the same thread), and the `postMessage` call all go away.

- [ ] **Step 1: Write the failing test**

Locate this screen's existing test file and find its test(s) covering `start()` (or the "Send"/"Start" button's press handler) that currently assert both `createGroupThread` and `postMessage` are called. Replace the assertion with one that expects only thread creation followed by navigation:

```tsx
it('creates the thread and navigates to it, with no message posted here', async () => {
  createGroupThreadMock.mockResolvedValueOnce({ id: 't9', error: null });
  // ... render the screen, pick a candidate, press the button ...
  await waitFor(() => {
    expect(createGroupThreadMock).toHaveBeenCalledWith('', ['p1']);
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/messages/t9');
  });
});
```

(Match the exact mocking setup — `vi.mock` targets, render helper, candidate-picking helper — already used by this file's other tests; the snippet above shows the assertion shape, not a full replacement test suite.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/messages/new.test.tsx` (adjust path to whatever Step 1 found)
Expected: FAIL — `postMessageMock` was called (the current code still posts here).

- [ ] **Step 3: Simplify `start()`**

Replace the `start` callback (`app/messages/new.tsx:157-232`):

```tsx
  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    if (picked.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Pick somebody to message.');
      return;
    }

    const result = await createGroupThread('', picked);
    if (result.error || !result.id) {
      busyRef.current = false;
      setBusy(false);
      setError(result.error ?? GENERIC_ERROR);
      return;
    }

    busyRef.current = false;
    setBusy(false);
    // `replace`, not `push`: the picker has served its purpose, and backing
    // out of the new thread should land on the list, not on a picker with
    // stale selections. The first message -- text, images, or both -- is
    // composed on the thread screen itself now, through the same Composer
    // every other thread already uses (Task 10), not here.
    router.replace(`/messages/${result.id}`);
  }, [picked, router]);
```

Remove the now-unused `draft`/`setDraft` state (`app/messages/new.tsx:96`), the `createdThreadRef` (`:107-117`), and the `postMessage` import (keep `createGroupThread`).

- [ ] **Step 4: Remove the message input from the JSX**

Delete the `<Text style={styles.label}>Message</Text>` and `<TextInput ...>` block (`app/messages/new.tsx:325-333`). Update the button's label back to context-appropriate copy — "Start conversation" or "Next" rather than "Send", since this button no longer sends a message:

```tsx
          <Button
            block
            accessibilityLabel="Start conversation"
            disabled={busy}
            loading={busy}
            onPress={() => void start()}
          >
            Start conversation
          </Button>
```

Remove the button's preceding comment block (`:335-340`), which explained wording that no longer applies, and remove the `input` style from `StyleSheet.create` if nothing else in the file uses it (check first — `grep -n "styles.input" app/messages/new.tsx`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- app/messages/new.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors (a removed `styles.input` reference would surface here if Step 4 missed a use).

- [ ] **Step 6: Commit**

```bash
git add app/messages/new.tsx app/messages/new.test.tsx
git commit -m "refactor(messaging): new-thread picker creates and navigates; compose happens on the thread screen"
```

---

## Task 12: Wire `app/messages/club/new.tsx`

**Files:**
- Modify: `app/messages/club/new.tsx`

**Interfaces:**
- Consumes: `<AttachmentPicker threadId={...} onAttachmentsChange={...} />` (Task 7).

- [ ] **Step 1: Read the current submit flow before editing**

Read `app/messages/club/new.tsx` in full (241 lines). Unlike `app/messages/new.tsx` (Task 11), this screen already targets an **existing** club thread (`threadId` arrives as a route param — confirm by reading the file, since this was not verified in the research this plan is based on) rather than creating one as part of submission. If that's confirmed, this task has none of Task 11's sequencing problem: `threadId` is available from the moment the screen mounts, so `<AttachmentPicker threadId={threadId} ...>` can render immediately alongside the body input.

- [ ] **Step 2: Add attachment state and wire the picker**

Same shape as Task 10 Step 2: add `attachments`/`attachmentsPending` state (and `attachmentsResetKey` if this screen can submit more than once without navigating away — check whether it navigates away on success, per its existing `submit` function around line 227; if it navigates away immediately, a reset key is unnecessary since the screen unmounts). Add the `AttachmentPicker` import and the `MessageAttachmentInput` type import. Render `<AttachmentPicker threadId={threadId} onAttachmentsChange={...} />` near the body `TextInput`.

- [ ] **Step 3: Extend the submit call**

Find the `postMessage(...)` call inside `submit` (around line 232) and add `attachments` as its trailing argument, matching whatever `p_root`/other arguments this screen already passes (it posts a new root, not a reply, so `rootId` stays whatever this screen already sends — confirm it's `null`, consistent with "a new post can be an announcement" only applying to roots per Task 3's guard).

Gate `submit`'s existing `busy` guard on `attachmentsPending` too, the same way Task 10 gated `send`.

- [ ] **Step 4: Typecheck and run this screen's tests**

Run: `npx tsc --noEmit && npm test -- app/messages/club`
Expected: PASS, updating any exact-argument-list assertion on `postMessage` the same way Task 5/10 did.

- [ ] **Step 5: Commit**

```bash
git add "app/messages/club/new.tsx"
git commit -m "feat(messaging): wire image attachments into new-post compose"
```

---

## Task 13: Playwright baselines and the full verification gate

**Files:**
- Modify: Playwright snapshot files under `e2e/visual.spec.ts-snapshots/` (regenerated, not hand-edited)
- Modify: `e2e/visual.spec.ts` (only if it needs a new scenario added — see Step 1)

**Interfaces:**
- Consumes: everything from Tasks 1-12.

- [ ] **Step 1: Check whether `e2e/visual.spec.ts` needs a new scenario**

Read `e2e/visual.spec.ts` to see whether it already seeds a message with attachments for a bubble/viewer baseline, or whether a new scenario needs adding (a message with 1 image, a message with 4, and the full-screen viewer open). If none exists, add one following the file's existing seeding pattern — do not invent a new seeding mechanism.

- [ ] **Step 2: Regenerate baselines**

Run: `npm run test:visual -- --update-snapshots`
Expected: new/changed `.png` files under `e2e/visual.spec.ts-snapshots/`.

- [ ] **Step 3: Inspect every diff image before accepting, per `docs/messaging.md`'s own warning**

A blindly refreshed baseline bakes in whatever regressed. Open each new/changed snapshot and visually confirm: the image grid renders correctly for 1/2/3/4 images, the full-screen viewer opens and shows the right image, and nothing *unrelated* to this feature shifted (a layout regression elsewhere would also show up as a diff here). Every new scroller/modal from Tasks 7-8 needs `testID="screen-scroll"` on its scrollable container if Playwright's `captureScreen` is used against it — it measures overflow, not content height, because the tab bar is a flex sibling outside the scroller (per `docs/messaging.md`'s own trap list).

- [ ] **Step 4: Run the full local gate**

```bash
npx supabase db reset --local && npm run test:db   # pgTAP — reset FIRST
npm test                                           # vitest
npx tsc --noEmit
npm run test:visual                                # Playwright, FOREGROUND
```

Expected: everything green.

- [ ] **Step 5: Push migrations and run the hosted grant matrix (owner's own step)**

Per `docs/messaging.md`'s existing convention, this is a deliberate step the owner takes, not part of the automated local gate — `.env.local` points the app at the hosted project, and this branch's four new migrations (`20260905020000` through `20260905050000`) are not pushed until this is run:

```bash
npx supabase db push
npm run test:db:remote
```

- [ ] **Step 6: Commit any baseline/spec changes from this task**

```bash
git add e2e/
git commit -m "test(messaging): regenerate Playwright baselines for image attachments"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Schema | Task 1 |
| §2 Storage bucket and RLS | Task 2 |
| §3 Compose flow (deps, order of operations) | Tasks 6, 7 |
| §4 `post_message`'s new guards | Task 3 |
| §5 Reading attachments back | Task 4 |
| §6 Screens — Composer | Tasks 7, 10 |
| §6 Screens — MessageBubble | Tasks 8, 9 |
| §6 Screens — new-thread/new-post screens | Tasks 11, 12 |
| §7 Testing (pgTAP, vitest, Playwright, full gate) | Tasks 1-4 (pgTAP), 5-6 (vitest), 13 (Playwright + gate) |

**Resolved during planning:** Task 11 (`app/messages/new.tsx`) hit a real sequencing question the spec's brainstorming session didn't examine at this level of detail — the screen used to create its thread and post its first message in one action, but attaching an image needs a thread to upload under. Confirmed with the user: split into two visible steps. The task was rewritten so this screen only picks people and creates/opens the thread; the first message (text, images, or both) is composed on the thread screen itself, through the same `Composer` Task 10 already wires up — a genuine simplification of `app/messages/new.tsx`, not just new wiring.

**Placeholder scan:** none remaining — the viewer's nav buttons (Task 8) now use real `ChevronLeftIcon`/`ChevronRightIcon` icons rather than empty stand-ins.

**Type consistency:** `MessageAttachmentInput` (Task 5) is the type every later task's `AttachmentPicker`/`postMessage` call sites use; `MessageAttachment` (Task 5) is what `ThreadMessage.attachments` and `AttachmentGrid` consume. Checked consistent across Tasks 5, 7, 8, 9, 10, 12.
