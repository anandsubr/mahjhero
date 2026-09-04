# Message image attachments — design

**Date:** 2026-09-04
**Reverses part of:** [2026-08-26-messages-and-friends-design.md](2026-08-26-messages-and-friends-design.md), which named attachments *out of scope by decision*
**Orientation:** [docs/messaging.md](../../messaging.md)

---

## The problem

`docs/messaging.md` lists attachments under *Out of scope by decision*, alongside
blocking, edit/delete, reactions and the rest — named at the same time as those,
with no dedicated argument for why. This document reopens it: a member should be
able to attach one or more images to a message, in every message surface —
direct/group threads, club board posts and replies, and the screens that start a
new thread or post.

This is the first feature in the app to touch Supabase Storage. Nothing here
today uses it — `profiles.avatar_url` exists as a column but is never populated
or rendered (`components/ThreadAvatar.tsx` renders initials only). So this design
also stands up the app's first storage bucket, and the RLS pattern for it needs
to earn the same care the message schema already has: `can_read_thread` exists
specifically so a disclosure question is asked once and reused, not
reimplemented at a second call site that might get it wrong.

---

## 1. Schema

One new table, no changes to `messages`.

```sql
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

  /*
   * Same shape as messages.reply_to_id and root_id, and the same reason:
   * `references messages(id)` alone would be a disclosure bug. A member of
   * two clubs could otherwise cause an attachment row to reference a
   * message in a thread they cannot read, and nothing downstream asks
   * whether the reader may see it — can_read_thread is asked about a row's
   * OWN thread_id, and a bare message_id carries none of its own to be
   * asked about.
   */
  foreign key (message_id, thread_id)
    references public.messages (id, thread_id) on delete cascade
);

create index message_attachments_message on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;
revoke all on public.message_attachments from authenticated;
grant select on public.message_attachments to authenticated;

create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (public.can_read_thread(thread_id));
```

`on delete cascade` (not `set null`, unlike the quote pointer): an attachment
without its message is not somebody's words minus a pointer, it is nothing —
there is no case where keeping an orphaned attachment row is the right call.

Rows are written by `post_message` itself, in the same transaction as the
message — never inserted directly by the client, matching every other write
path in this schema (`grant select` only, same as `messages`).

`width`/`height` are captured client-side at pick time and stored, not
recomputed. `MessageBubble`/`PostRow` need them to lay out a correctly-aspect-
ratioed placeholder before the image itself has loaded, and asking Supabase to
introspect a file it never decodes is unnecessary work.

---

## 2. Storage bucket and RLS

One new **private** bucket, `message-images`. Path convention:

```
{thread_id}/{uuid}.jpg
```

`thread_id` leads the path, and only that — not `message_id`, because images
upload *before* the message row exists (§3), and not `author_id`, because the
read policy only needs to answer "can this viewer see this thread."

```sql
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
```

`can_read_thread` and `can_post_thread` are already `security definer` and
already granted to `authenticated` for exactly this reason (decision #2 in
`docs/messaging.md`) — an RLS `USING`/`WITH CHECK` expression runs as the
querying user, so a function it names must be callable by that user, not just
by the RPCs that use it internally.

No `update` or `delete` policy: nothing in this design edits or removes an
attachment once posted, matching `messages` having no edit or delete at all.

**Reads are always signed URLs**, never the bucket's public URL — the bucket is
private, so there is no public URL to leak. The client requests them in one
batch per screen load (`supabase.storage.from('message-images').createSignedUrls(paths, 3600)`)
across every attachment on the visible messages, not one request per image, and
caches them in memory keyed by path until they expire. One hour is long enough
to outlast a normal scroll session in a thread without the image flashing
blank, short enough that a signed URL copied out of the app (a screenshot's
metadata, a shared link) is worthless within the day.

---

## 3. Compose flow

New dependencies: `expo-image-picker` (camera and library, offered behind one
action sheet) and `expo-image-manipulator` (client-side resize to a 1600px long
edge, JPEG ~80% quality, before upload — a modern phone photo can be 5–15MB and
nothing about this app's realtime-driven UI wants to move that much data per
message).

Order of operations, on Send:

1. Every attached image is already compressed at pick time (not deferred to
   Send) so the thumbnail strip can show real upload progress rather than a
   compress-then-upload stall.
2. Each image uploads to `message-images/{thread_id}/{uuid}.jpg`. Send is
   disabled until every attached image has either finished uploading or been
   removed from the strip.
3. Once every upload has a `storage_path`, the client calls `post_message`
   with a new `p_attachments jsonb default null` parameter — an array of
   `{storage_path, width, height}`, client-ordered — and `p_body` becomes
   optional (§4).
4. `post_message` inserts the message row, then loops the array inserting
   `message_attachments` rows with `sort_order` set from array order, all in
   the one transaction it already runs in. A message and its attachments
   exist together or not at all.

**Known gap, accepted rather than solved:** if step 2 succeeds but step 3
fails or is abandoned, the uploaded objects are never referenced by any
message — an orphan in storage with no cleanup path in this design. This is
the same shape as the existing documented gap in `docs/messaging.md`'s *Known
gaps*: "create-succeeds-then-post-fails-then-abandon leaves an empty thread."
Neither gets a cleanup job here; a scheduled sweep of unreferenced storage
objects is a reasonable follow-up if it turns out to matter, not a blocker for
this design.

`post_message`'s signature changes (`post_message(uuid, text, boolean, uuid,
uuid, jsonb)`), which — per the two hazards this codebase's own history
already names — means updating both closed-world arrays in
`supabase/tests/database/portable/grants.test.sql`, and dropping the old
signature rather than overloading it (`create or replace` would leave the old
5-argument version in place as an ambiguous overload; the same reasoning
`20260830010000_post_message_roots.sql` already records).

---

## 4. `post_message`'s new guards

- `p_body` becomes optional: `trim(coalesce(p_body, ''))` may now be empty
  **only if** `p_attachments` carries at least one entry. A message with
  neither is refused with the existing "write something first" — attachments
  don't relax that, they give it a second way to be satisfied.
- The existing `length(body) > 2000` bound is unchanged and still applies
  whenever body is non-empty.
- `p_attachments`, when provided, must have between 1 and 4 entries — a
  fifth is refused with a readable message, the same belt this schema's
  `check (sort_order between 0 and 3)` already provides as the constraint of
  last resort.
- Each entry's `storage_path` must start with `target_thread::text || '/'`.
  The storage INSERT policy already makes a mismatched path unwritable by
  anyone but a thread member, so this is the same belt-and-braces move as the
  existing `p_reply_to`/`p_root` checks: turning something the constraints
  already prevent into words a member can read, not the guard itself.

---

## 5. Reading attachments back

`fetch_thread_messages` and `fetch_post_messages` each gain one column,
resolved with a lateral aggregate rather than a second round trip — the same
choice `fetch_thread_messages` already made for the quoted-parent join:

```sql
attachments jsonb  -- '[]'::jsonb when none; else an ordered array of
                    -- {id, storage_path, width, height}
```

```sql
left join lateral (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id, 'storage_path', a.storage_path,
        'width', a.width, 'height', a.height
      ) order by a.sort_order
    ), '[]'::jsonb
  ) as attachments
    from public.message_attachments a
   where a.message_id = m.id and a.thread_id = m.thread_id
) att on true
```

`fetch_club_posts` and `fetch_my_threads` (the board list and the messages
list) are **not** changed — no attachment preview or camera-icon indicator on
a list row in this design. That's a real nicety and a real follow-up, not
something this design needs to ship attachments at all.

---

## 6. Screens

**`components/messages/Composer.tsx`** — an attach button opens the action
sheet (camera / library); selected images show as a thumbnail strip above the
text input, each with a remove control and an upload-progress state; Send
disables while any upload is in flight.

**`components/messages/MessageBubble.tsx`** and **`components/messages/PostRow.tsx`** —
render 1–4 images as a grid (single image full width; 2 side by side; 3–4 as a
2×2), sized from the stored `width`/`height` before the signed URL resolves so
the bubble doesn't reflow once it loads. Tapping opens a full-screen swipeable
viewer scoped to that message's own images — not every image in the thread.

**`app/messages/new.tsx`** and **`app/messages/club/new.tsx`** — the same attach
control, wired to whichever call posts their first message. Both already funnel
through `post_message` (a new group or club thread's first message is not a
structurally different write), so this is the same client-side plumbing as
`Composer.tsx`, not a second implementation.

---

## 7. Testing

**pgTAP** — a new fixture, `message_attachments.test.sql`:

- an attachment's `(message_id, thread_id)` must name a real message in that
  thread; the composite FK makes the cross-thread case unstateable, and this
  fixture proves it rather than merely asserting the SQL compiles
- `post_message` with empty body and no attachments is refused; empty body
  with one attachment succeeds
- a 5th attachment is refused
- `message_attachments_select` denies a non-member of the thread
- the storage RLS predicates (`message_images_select`/`_insert`) deny a
  non-member's path even when the path is well-formed — a member of one
  club attaching an image under another club's `thread_id` folder

Two existing hazards apply here as much as anywhere else in this schema: `now()`
is transaction-constant inside one pgTAP fixture, and any new `raise exception`
message needs a mapped or allowlisted entry so `lib/bookings.test.ts` stays
green (it greps every migration; `bookingErrorMessage` matches by substring).

**vitest** — the new pure helpers (grid layout arithmetic, signed-URL cache),
and the `lib/messages.ts` wrapper for `postMessage`'s new `attachments` param
following the existing "never rejects, resolves `null`/`{error}`" contract
(decision #9).

**Playwright** — new baselines for a bubble/post with 1, 2, and 4 images, and
the full-screen viewer. Every new scroller needs `testID="screen-scroll"` or
`captureScreen` silently truncates it (it measures overflow, not content
height).

**The full gate**, unchanged from `docs/messaging.md`:

```bash
npx supabase db reset --local && npm run test:db   # pgTAP — reset FIRST
npm test                                           # vitest
npx tsc --noEmit
npm run test:visual                                # Playwright, FOREGROUND
npm run test:db:remote                             # hosted grant matrix
```

---

## 8. Out of scope

Carried forward, unchanged: blocking, edit/delete, reactions, typing
indicators, read receipts, search, push.

Newly named and deliberately excluded from this design:

- **Orphaned-upload cleanup.** Argued in §3 — accepted as a known gap, not
  solved here.
- **Attachment preview on list rows** (`fetch_club_posts`, `fetch_my_threads`).
  Argued in §5.
- **Non-image attachments** (PDFs, other files). The picker, the compression
  step, and the grid layout are all image-specific; generalising to arbitrary
  files is a different, larger design.
- **Editing or removing an attachment after the message is sent.** No message
  editing exists anywhere in this app (decision carried from the messaging
  spec); this would be the first.
- **Full-resolution download / share-out of an attached image.** The viewer
  displays the (already-compressed) uploaded image; there is no original to
  fall back to once the client-side compression step has run.

---

## 9. Risks

| risk | mitigation |
|---|---|
| `post_message`'s signature change ripples through grants, callers and tests | named explicitly in §3; both `grants.test.sql` arrays updated in the same commit |
| First use of Supabase Storage in this app — no existing pattern to follow | §2 mirrors the message schema's own composite-FK/security-definer-predicate pattern as closely as storage RLS allows, rather than inventing a new one |
| Large uploads on a realtime-driven, mobile-first UI | client-side compression before upload (§3), not left to chance or to a server-side resize step |
| Orphaned storage objects on a failed post | named as an accepted gap in §3/§8, same treatment as the existing create-succeeds-then-post-fails gap |
| A malformed `storage_path` naming another thread's folder | blocked twice — storage INSERT RLS (§2) and `post_message`'s own check (§4) — same belt-and-braces relationship the composite FKs already have with their RPC-level checks elsewhere in this schema |
