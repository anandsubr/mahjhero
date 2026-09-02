# Club announcement boards — design

**Date:** 2026-08-30
**Supersedes part of:** [2026-08-26-messages-and-friends-design.md](2026-08-26-messages-and-friends-design.md)
**Orientation:** [docs/messaging.md](../../messaging.md)
**Base branch:** `feat/club-boards`, cut from `origin/main` (messaging landed in [PR #9](https://github.com/anandsubr/mahjhero/pull/9))

---

## The problem

A club has exactly one thread, and everything lands in it: announcements from
organizers, member chat, and quote-replies to both. Two things with different
lifetimes share one scroll.

An announcement is durable — people come back to it days later — and it is
buried within an hour. A quote-reply is a *pointer*, not a *container*, so a
discussion of one announcement interleaves with a discussion of another and
neither reads as a conversation. In use the club surface is confusing, and the
confusion is structural rather than cosmetic.

`docs/messaging.md` lists **sub-threads** under *Out of scope by decision*. This
document reverses that, deliberately. The reason it is now worth doing is that
the schema already carries most of the cost: `messages.reply_to_id` exists with
a composite foreign key, and the read predicates need no change at all. What is
missing is a *container*, and a container is one column.

---

## The model

The club thread stops being a chat and becomes a **board**: a list of root
posts, newest activity first, each opening to its own replies.

**Anyone in the club can start a post.** An organizer can additionally mark
their post as an **announcement**, which is a flag on a root — not a separate
kind of object. That keeps one posting path, one permission model, and one
email fan-out.

Game threads and direct messages are unchanged and stay flat chat. A game
thread is six people coordinating one evening and a DM is two people talking;
both are genuinely chat-shaped, and threading them would add ceremony for no
gain. The cost is two rendering modes in the app, and §4 spends it deliberately.

---

## 1. Schema

Three columns on `messages`, plus `post_reads`. No new message table. (§5 adds
one more table, `archived_messages`, purely to hold migrated-out rows.)

| column | meaning |
|---|---|
| `root_id uuid` | which post this message belongs to. `null` means this message **is** a root, or the thread is flat. |
| `reply_count int not null default 0` | denormalised; written by `post_message` in the same transaction |
| `last_reply_at timestamptz` | denormalised; the board's sort key |

### `root_id` is structure; `reply_to_id` stays presentation

They answer different questions and so they stay different columns:

- `root_id` — *which post contains this message.* Set once at insert, never changes.
- `reply_to_id` — *which line am I quoting.* Renders as the quote chip. Unchanged
  in meaning, unchanged in behaviour, still optional.

Collapsing them would mean the quote chip and the containment relation could
never disagree, and they legitimately do: inside one post, quoting an earlier
reply is normal.

### The composite foreign key is not optional

```sql
foreign key (root_id, thread_id)
  references public.messages (id, thread_id) on delete set null (root_id)
```

The obvious `references messages(id)` is the same disclosure bug recorded as
decision #4 in `docs/messaging.md`: it would let a member of two clubs attach a
reply to a root in the other club's thread, where nothing downstream asks
whether the reader may see it. The `(root_id)` column list on `on delete set
null` is likewise required — a bare one would null `thread_id` too.

### One level of nesting, enforced in the RPC

A root has `root_id is null`. A reply's `root_id` must point at a message that
is itself a root. There is no reply-to-a-reply.

This is guarded in `post_message` rather than by a table constraint, because
the check needs a subquery. That is sound here for the reason the schema
already states: **every write goes through an RPC**, and only `select` is
granted on `messages`. A `check (root_id is null or root_id <> id)` catches the
degenerate self-reference at the table.

### Denormalised counters

`reply_count` and `last_reply_at` live on the root and are written by
`post_message` in the same transaction. This is the same argument that
`message_threads.last_message_at` already makes: a correlated aggregate per
root on every board read is the shape that gets slow first.

### No title column

The board renders a post's `subject` when it has one — announcements already
carry it, derived by `deriveSubject`, which must keep agreeing with
`post_message`'s SQL character for character (decision #7). A member post shows
the first line of its body.

A separate title field for member posts is one people leave blank, and a board
of empty titles reads worse than a board of first lines.

### `post_reads`

```sql
create table public.post_reads (
  root_id      uuid not null references public.messages(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (root_id, profile_id)
);
```

`thread_reads` cannot express "read post A, not post B" — its primary key is
`(thread_id, profile_id)`. Keeping the single watermark would mean opening any
one post marks the whole club read, so every other post's unread dot vanishes
unread. That is the failure this whole design exists to remove, so it gets its
own table.

`thread_reads` is untouched and keeps serving games and DMs.

---

## 2. RPCs

| function | what |
|---|---|
| `post_message(target_thread, p_body, p_announce, p_reply_to, p_root)` | gains `p_root uuid default null` |
| `fetch_club_posts(target_thread, p_limit, p_before)` | the board: roots + author + reply count + per-post unread |
| `fetch_post_messages(p_root)` | a root and its replies; same row shape as `fetch_thread_messages` |
| `mark_post_read(p_root)` | writes `post_reads` |
| `my_unread_counts`, `fetch_my_threads` | grow a club branch summing per-post unread |

All `security definer`. `profiles` RLS is self-row-only, narrowed deliberately
in `20260822180000`; that is why `fetch_thread_messages` and `thread_roster`
already exist in this shape. Do not widen `profiles` to get sender names.

### `post_message`'s new guards

- `p_root` must be null unless the thread is a club thread.
- `p_root`, when set, must name a message in the same thread whose `root_id` is
  null. The composite FK makes the cross-thread case unstateable; this check
  exists to turn a `23503` into words a member can read, exactly as the
  existing `p_reply_to` check does.
- `p_announce` is legal only on a root (`p_root is null`) and only when
  `is_club_organizer_of` the thread's club.
- On success with `p_root` set: bump the root's `reply_count` and
  `last_reply_at`.

`can_read_thread` and `can_post_thread` are **not touched**. Permission stays
per-thread and a post inherits it. This is the main reason the change is cheap,
and it is worth protecting: a future "private post" feature would break it, and
should be argued separately.

### Two hazards this creates

- **`post_message`'s signature changes.** Its new signature must be added to
  *both* closed-world arrays in `portable/grants.test.sql`, and the old
  signature removed, or the entire db suite goes red.
- **New `raise exception` messages** turn `lib/bookings.test.ts` red while
  pgTAP stays green — it greps every migration and demands each message be
  mapped or allowlisted. Run `npm test` on the database work too. Note that
  `bookingErrorMessage` matches by *substring*.

---

## 3. Sorting and presentation

The board sorts by `greatest(created_at, coalesce(last_reply_at, created_at))`
descending — a post rises when it gets a reply.

**Announcements do not pin.** They are visually distinct (accent border, an
"Announcement" label, the organizer's name) and sort by recency like everything
else. Pinning was considered and rejected: with no unpin affordance in this
design, the top of the board becomes a permanent archive of stale
announcements, and a time-boxed pin makes the sort time-dependent, which is
harder to test and surprising when a post moves on its own.

Accessibility, from the traps this codebase has already sprung: compute the
contrast ratio for any new accent pairing from `lib/theme.ts` and pin it in
`lib/theme.test.ts`. Cream on `colors.accentColor` is 3.03:1 and **fails** AA;
`colors.accent[700]` is 5.72:1. An organizer once could not read their own
announcement at 1.10:1.

---

## 4. Screens

`app/messages/[threadId].tsx` is 1094 lines and now needs two modes. Splitting
it is part of this work, not a follow-up.

```
app/messages/[threadId].tsx           dispatch: club → ClubBoard, else → ChatThread
app/messages/[threadId]/[postId].tsx  a post: root + replies + composer
components/messages/MessageBubble.tsx
components/messages/Composer.tsx
components/messages/MembersPanel.tsx
lib/use-thread-realtime.ts
```

Navigation is **Messages → club board → post**. The Messages list keeps its
club row, so games, DMs and clubs all stay reachable from one place, and
`fetch_my_threads`' synthesised club rows (`thread_id: null`, opened via
`openThreadForClub` on tap — decision #6) keep working unchanged.

### Composing

A "New post" action on the board opens a sheet. Organizers see an
**Announcement** toggle; members do not.

This restores a capability the branch currently lacks. `docs/messaging.md`
records that announcement compose is **unreachable** — the organizer toggle was
removed pending a friendlier design, and until it lands there is no way to email
a club from the app. This is that design, and `countBroadcastRecipients` — parked
for exactly this — gets its consumer back.

### Realtime

The board subscribes for new roots; a post subscribes for new replies. Both
filter on `thread_id` as today and narrow by `root_id` on the client.

Extracting the subscription into `use-thread-realtime.ts` must carry its
unique-topic-per-subscription property with it. `supabase.channel(topic)`
returns an *existing* channel, `removeChannel` is async, and `.on()` throws on a
subscribed channel. The uniqueness is not incidental.

### Two things to preserve through the split

- The pure helpers in `lib/messages.ts` are what the tests actually pin. Keep
  them pure and keep them exported, or the coverage moves from "tested" to
  "rendered and hoped for".
- Every new scroller needs `testID="screen-scroll"`, or Playwright's
  `captureScreen` silently truncates it — it grows the viewport by measuring
  overflow, and the tab bar is a flex sibling outside the scroller.

---

## 5. Migration of existing data

Two migrations. Append-only; never edit a committed one.

**`20260830000000_club_boards.sql`** — the columns, the composite FK, the
indexes, `post_reads`, and the RPC changes.

**`20260830010000_archive_club_chat.sql`** — the existing club thread's
contents:

1. Every announcement (`is_announcement`) becomes a root. It already has
   `root_id is null`; nothing to write but its counters.
2. **Every non-announcement club message joins the most recent announcement
   posted strictly before it.** Time decides this, not quoting.

   The first version of this migration walked `reply_to_id` chains instead,
   which sounded equivalent and was not. `reply_to_id` is *opt-in* — it is
   set only when somebody long-presses a message to quote it (`app/messages/
   [threadId].tsx`, `replyTo` defaults null). A member who reads an
   announcement and types "sounds good, I'll be there" has no `reply_to_id`
   at all, so a chain-walk would have archived most of the discussion under
   every announcement while claiming to keep it. Review caught it before the
   hosted push. The accepted cost of the wider rule is the mirror image:
   chatter that merely *followed* an announcement is now filed under it.
3. Chat that precedes the club's first announcement belongs to no post and
   **moves** to a new `archived_messages` table, deleted from `messages`.
4. A quote whose target ends up in a different post has its **pointer**
   nulled — never the message. Under a time-based rule a quote can straddle
   two posts, which is exactly what `20260830011000_quote_stays_in_post.sql`
   forbids for new writes; this repair makes the migrated rows obey the same
   invariant. Rows on their way to the archive are skipped, so
   `archived_messages` keeps their citations intact and stays a faithful copy.

Step 3 is a move, not a `delete`. The rows leave the app exactly as intended,
and a mistake stays recoverable by a follow-up migration. `archived_messages`
carries no RLS policy and no grant to `authenticated`; it is not readable from
the app.

Game and DM threads are not touched by this migration.

**`.env.local` points the app at the hosted project.** Every migration on this
branch is already pushed; these two need `npx supabase db push`.

---

## 6. Testing

**pgTAP** — a new fixture `club_board.test.sql`:

- a reply's `root_id` must name a root in the same thread; a root in another
  thread is refused, and the composite FK makes it unstateable besides
- reply-to-a-reply is refused
- `p_announce` on a reply is refused; `p_announce` by a non-organizer is refused
- `reply_count` and `last_reply_at` are correct after concurrent replies
- `post_reads` isolates: reading post A leaves post B unread
- the archive migration is idempotent and moves exactly the intended rows

Two existing hazards apply. `now()` is transaction-constant and a pgTAP fixture
is one transaction, so a seeded root and its reply tie — a strict `>` counts
nothing. And pgTAP must run against a freshly reset container, because the
Playwright suite seeds into the same database and two fixtures count rows
globally.

**vitest** — the new pure helpers, and `lib/theme.test.ts` for any new pairing.

**Playwright** — regenerate the baselines for the board and the post screen,
and *inspect the diff images first*. A blindly refreshed baseline bakes in
whatever regressed.

**Mocks that must not be weakened** — four bugs shipped behind lying test
doubles on this branch. `useFocusEffect` must key on callback identity;
`useSession` must return a module-scoped constant; the Realtime mock must model
reuse-by-topic and throw like the real client; and any wholesale
`vi.mock('expo-router')` must include every hook a shared component adopted.

**The full gate:**

```bash
npx supabase db reset --local && npm run test:db   # pgTAP — reset FIRST
npm test                                           # vitest
npx tsc --noEmit
npm run test:visual                                # Playwright, FOREGROUND
npm run test:db:remote                             # hosted grant matrix
```

Green at the start of this work: pgTAP 1052/36 · vitest 1042/62 · Playwright
44/44 · tsc clean · hosted grants 115.

---

## 7. Email and notifications

**Only an announcement root fans out.** `post_message` already does this, via
`broadcast_recipients`, which resolves the club roster when `event_id` is null
and the event's confirmed bookings otherwise. That function stays the single
source of both the count the compose sheet previews and the set the fan-out
mails; its docstring records why they must not become two.

**Replies never email, and send no notification.** Nobody's inbox is hostage to
a busy post. The accepted cost is that an organizer learns about replies to
their announcement only by opening the app. A reply notification is a
reasonable follow-up, but it means a new outbox kind, and that is more surface
than it appears.

---

## 8. Out of scope

Carried forward from the messaging spec and still out: blocking, edit and
delete, reactions, attachments, typing indicators, read receipts, search, push.

Newly named and deliberately excluded:

- **Pinning** — argued in §3.
- **Reply notifications** — argued in §7.
- **Muting a post.** Without it, a busy post keeps producing unread. Acceptable
  at club scale; the first thing to add if it is not.
- **Moving an existing message into a post.** No message editing exists, and
  this would be the first.
- **Deeper nesting.** One level is the whole point.

---

## 9. Risks

| risk | mitigation |
|---|---|
| `post_message`'s signature change ripples through grants, callers and tests | named explicitly in §2; both `grants.test.sql` arrays updated in the same commit |
| Two rendering modes in the messages surface | the §4 split makes the branch a one-line dispatch rather than a conditional threaded through 1094 lines |
| The archive migration deletes member-written content | it moves rather than deletes; `archived_messages` is ungranted and recoverable |
| Baselines refreshed blindly hide a regression | diff images inspected before accepting; `testID="screen-scroll"` on both new scrollers |
| Realtime hook extraction loses unique-topic-per-subscription | called out in §4; the mock throws like the real client, so a regression fails a test |
