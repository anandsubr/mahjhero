# Messaging — orientation and handoff

Written to be read at the start of a session that did not build this. It is not a
changelog; it is what you need to change this code without breaking it or
re-litigating decisions that already cost something.

**Spec:** [2026-08-26-messages-and-friends-design.md](superpowers/specs/2026-08-26-messages-and-friends-design.md) for the
original four-shape messaging feature; [2026-08-30-club-announcement-boards-design.md](superpowers/specs/2026-08-30-club-announcement-boards-design.md)
for the board reshape below.
**Branch history:** `feat/messages` (79 commits, stacked on `feat/dashboard-artboard`)
shipped as [PR #9](https://github.com/anandsubr/mahjhero/pull/9), now **merged**.
The board reshape is on `feat/club-boards`, cut from `main`.

---

## What exists

Two-way messaging in four shapes, plus a friends list, plus the absorption of the
app's previous one-way broadcast feature.

**The kind of a thread is derived, never stored:**

| `event_id` | `club_id` | kind |
|---|---|---|
| set | set | **game** |
| null | set | **club** |
| null | null | **group** — rendered "Direct" at exactly two members |

A direct message is a group of two. There is no `direct` kind, deliberately —
storing one would mean deciding what a direct becomes when a third person joins.

**Membership is asymmetric and that is the load-bearing choice.** Club and game
membership is *derived* from `club_members` and `bookings` at read time. Only
group membership is materialised, in `thread_members`. Materialising a 42-member
roster would mean keeping it correct across nine existing write paths — joins,
leaves, role changes, bookings, cancellations, promotions, declines, event
cancellation. Deriving costs one join and cannot go stale.

---

## Where the code is

**Migrations** — append-only, never edit a committed one:

| file | what |
|---|---|
| `20260828000000_friendships.sql` | the one-way edge, `can_reach` |
| `20260828010000_friend_mutations.sql` | `add_friend`, `remove_friend`, `fetch_friends`, `fetch_addable_people` |
| `20260829000000_message_threads.sql` | the four tables |
| `20260829010000_thread_predicates.sql` | `can_read_thread`, `can_post_thread`, `is_club_organizer_of`, the RLS policies |
| `20260829020000_open_threads.sql` | `open_thread_for_club`, `open_thread_for_event` |
| `20260829030000_group_threads.sql` | `create_group_thread`, `add_to_group_thread`, `leave_group_thread` |
| `20260829040000_post_message.sql` | `post_message`, `mark_thread_read` |
| `20260829050000_thread_lists.sql` | `fetch_my_threads`, `my_unread_counts` |
| `20260829060000_backfill_broadcasts.sql` | historical broadcasts → messages |
| `20260829070000_messages_realtime.sql` | `messages` joins `supabase_realtime` |
| `20260829080000_thread_reads_api.sql` | `fetch_thread_messages`, `thread_roster` |
| `20260829090000_club_thread_title.sql` | club thread title is the club's name |
| `20260830000000_club_boards.sql` | `root_id`, `reply_count`/`last_reply_at`, `post_reads` |
| `20260830010000_post_message_roots.sql` | `post_message` learns `p_root`, enforces one level |
| `20260830011000_quote_stays_in_post.sql` | a quote may not cross a post boundary |
| `20260830020000_board_reads.sql` | `fetch_club_posts`, `fetch_post_messages`, `mark_post_read` |
| `20260830021000_board_posts_are_club_only.sql` | a game thread has no board — one flat thread still |
| `20260830030000_board_unread.sql` | `my_unread_counts` counts per post, not per thread |
| `20260830040000_archive_club_chat.sql` | moves a club's pre-board chat into `archived_messages` |

**Client:**

| file | lines | what |
|---|---|---|
| `lib/messages.ts` | 971 | every RPC wrapper plus the pure helpers, board included |
| `lib/friends.ts` | — | the friends boundary |
| `lib/use-unread.ts` | — | `useUnreadCounts()`, drives both badges |
| `lib/use-thread-realtime.ts` | 85 | Realtime subscription, lifted into a hook shared by three screens |
| `app/messages/index.tsx` | 208 | the list |
| `app/messages/[threadId].tsx` | 473 | the thread — see *Refactor candidates* |
| `app/messages/new.tsx` | 368 | compose (direct/group) — no Everyone; see decision #7 |
| `app/messages/club/[threadId]/index.tsx` | 200 | the board |
| `app/messages/club/[threadId]/[postId].tsx` | 259 | a post, its replies, the composer |
| `app/messages/club/new.tsx` | 241 | compose a post, with the organizer-only Announcement toggle |
| `app/friends.tsx` | 252 | friends |
| `components/ThreadRow.tsx`, `ThreadAvatar.tsx`, `UnreadBadge.tsx` | — | shared row parts |
| `components/messages/MessageBubble.tsx`, `Composer.tsx`, `MembersPanel.tsx`, `PostRow.tsx` | — | extracted from the thread screen — see *Refactor candidates* |

**Tests:** pgTAP fixtures in `supabase/tests/database/fixtures/`, the hosted-only
grant matrix in `portable/grants.test.sql`, vitest beside each module, Playwright
baselines in `e2e/visual.spec.ts-snapshots/`.

---

## Decisions that must not be silently reversed

Each of these looks wrong at a glance and is not. Changing one is fine — doing it
*by accident* is not.

1. **`can_read_thread` and `can_post_thread` are two near-identical functions**, not
   one with a flag. Owner-adjudicated. They differ only in the game branch —
   read admits waitlisted, post does not.
2. **`can_read_thread` is GRANTED to `authenticated`; the other predicates are
   revoked.** An RLS policy's `USING` expression runs as the *querying user*, so a
   function named in a policy must be executable by the caller. `is_booking_group_member`
   (`20260825000000`) is the precedent. This was gotten wrong once and broke every
   read it guards.
3. **Two PARTIAL unique indexes, not one composite unique.** `unique (club_id, event_id)`
   would not enforce one club thread per club — NULLs are distinct in a unique index,
   so every club-thread row would collide with nothing.
4. **`messages.reply_to_id` is a COMPOSITE foreign key** `(reply_to_id, thread_id)`.
   The obvious `references messages(id)` is a disclosure bug: a member of two clubs
   could quote one club's words into the other's thread, where nothing downstream
   asks whether the reader may see them. Its `ON DELETE SET NULL` carries a column
   list, because a bare one would null `thread_id` too.
5. **`profiles` RLS is self-row-only** — narrowed deliberately in `20260822180000`,
   which replaced a co-member policy with `club_roster()`. That is why
   `fetch_thread_messages` and `thread_roster` exist as `security definer` RPCs. Do
   not "fix" sender names by widening `profiles`.
6. **`fetch_my_threads` synthesises club threads that have no row yet**, returning
   `thread_id: null`. The client calls `openThreadForClub(club_id)` on tap. One
   navigation path whether the row exists or not.
7. **A club thread belongs on `/messages/club/<id>`, never on the flat
   `/messages/[threadId]` screen.** `app/messages/[threadId].tsx` redirects one
   that arrives there anyway, after the load and before any content renders —
   enforced at that one choke point, not just at every caller. The flat screen
   is not a degraded board for a club thread, it is a trap: there is no
   Announcement control; the composer silently creates a junk ROOT POST for
   every line typed; a long-press to quote fails ('you can only quote a
   message from the same post'); and read-marking writes `thread_reads`, which
   the club branch of `fetch_my_threads` no longer reads, so the badge never
   clears. (The chat is NOT actually invisible there — `fetch_thread_messages`
   filters on `thread_id` alone, and `20260830040000_archive_club_chat.sql`
   only moves messages written before the club's first announcement into
   `archived_messages`, so most of a club's history typically still renders
   flat. That makes the trap worse, not better: it looks like it mostly
   works.) This invariant being written nowhere is a
   large part of why four navigation sites (`app/clubs/[id]/index.tsx`'s "Open
   the club thread", `broadcast.tsx`'s legacy compose redirect,
   `broadcasts.tsx`'s legacy history redirect, and `app/messages/new.tsx`'s
   Everyone compose target) kept sending a club thread here through thirteen
   reviews — the fourth survived even the fix meant to catch them all — before
   the screen-level redirect closed it off for good. (The fourth site no
   longer exists in the current code — `app/messages/new.tsx`'s Everyone
   target was removed entirely once the club board gave it a strictly
   better replacement — but the history is why the redirect exists at all,
   not just at that one site.)
8. **`deriveSubject` must agree with `post_message`'s SQL character for character** —
   it is shown to an organizer as the subject their email will carry.
9. **`lib/` never rejects.** Every exported async resolves `null` or `{ error }`.
   `null` means "we could not ask"; `[]` means "there is nothing". Conflating them
   tells a member something false about themselves.
10. **Refusals relay verbatim.** The database's messages are written to be read by a
   member. `lib/bookings.test.ts`'s ALLOWLIST names `lib/messages.ts` as responsible
   for exactly this.
11. **`root_id` and `reply_to_id` are deliberately two columns, not one.** They
    answer different questions — `root_id` is the CONTAINER, which post a message
    belongs to, set once at insert and never changed; `reply_to_id` is the QUOTE,
    which line it cites, and can name any message in the same post, including
    another reply. Collapsing them would mean the quote chip and the containment
    relation could never disagree, and they legitimately do. `root_id` carries the
    same composite foreign key `(root_id, thread_id)` that `reply_to_id` already
    does, for the same disclosure reason: a bare `references messages(id)` would
    let a member of two clubs hang a reply off a root in the other club's thread,
    and nothing downstream would catch it — `can_read_thread` is asked about a
    row's own `thread_id`, and a bare containment pointer carries none of its own
    to be asked about.

    `post_reads` is a second trap in the same neighbourhood. Its primary key is
    `(root_id, profile_id)` — two foreign-key columns as a composite primary key,
    which PostgREST reads as a many-to-many JUNCTION TABLE. That makes it infer a
    *second* `messages`-to-`profiles` relationship (through `post_reads`,
    alongside the direct `messages_author_id_fkey`), so a bare
    `profiles(display_name)` embed on `messages` is now ambiguous (PGRST201) even
    though `post_reads` has nothing to do with who sent a message. `MESSAGE_COLUMNS`
    (`lib/messages.ts`) carries the `!messages_author_id_fkey` hint to say which one
    is meant. This one cost a real debugging round — don't drop the hint chasing a
    "simpler" select.

---

## Traps this codebase will spring on you

Every one of these cost at least one round during the build. They are ordered by
how much.

**Test doubles that do not behave like the real thing.** Four separate bugs shipped
behind a lying mock:
- `useFocusEffect: (cb) => cb()` fires every render; the real hook keys a `useEffect`
  on the callback identity. A screen grew a guard it did not need to survive it.
- A `useSession` mock returning a fresh object per render broke referential
  stability and produced a genuine render loop once the focus mock was honest.
  **Use a module-scoped constant.**
- The Realtime mock returned a fresh channel per call and never threw, hiding a
  production crash. It now models reuse-by-topic and throws like the real client.
  Do not weaken it.
- Any wholesale `vi.mock('expo-router', …)` missing a hook a shared component
  adopted throws everywhere at once. `TabBar` needs `usePathname`, `useRouter` and
  (via `useUnreadCounts`) `useFocusEffect`.

**Keying an effect on the `session` OBJECT.** `lib/session.tsx` hands out a fresh
`Session` on every `onAuthStateChange`; `TOKEN_REFRESHED` fires hourly and on web
tab focus. **Key on `session?.user.id`.** This is still live: four instances were
fixed on this branch, once causing a Realtime crash, and three more remain —
`app/clubs/[id]/broadcast.tsx`, `app/clubs/[id]/broadcasts.tsx`, and
`app/messages/new.tsx` each still key an effect on `session` itself. `lib/use-unread.ts`
and `app/profile.tsx` document the fix.

**A guard read from render state.** `if (busy) return` is blind to a second
activation in the same tick. Use a ref written synchronously, cleared on *every*
exit path. Six instances in this repo.

**WCAG AA on accent colours.** Cream on `colors.accentColor` is **3.03:1 and fails**;
`colors.accent[700]` is 5.72:1. Seven AA failures were found here, one at **1.10:1**
where an organizer literally could not read their own announcement. Compute ratios
from `lib/theme.ts` and pin new pairings in `lib/theme.test.ts`.

**`accessibilityLabel` on a `Pressable` REPLACES the name computed from its
children** in react-native-web. It does not merge. Compose the count/title into the
label. Three instances.

**Granting a function to `authenticated`** means adding its signature to BOTH
closed-world arrays in `portable/grants.test.sql`, or the whole db suite goes red.

**A migration adding `raise exception`** turns `lib/bookings.test.ts` red while
pgTAP stays green — it greps every migration and demands each message be mapped or
allowlisted. **Run `npm test` on database tasks too.** Note `bookingErrorMessage`
matches by *substring*.

**pgTAP must run against a freshly reset container.** The Playwright suite seeds
rows into the same database, and two pre-existing fixtures count rows globally
(`bookings_commit.test.sql:28`, `event_series_edits.test.sql:76`). Run pgTAP first,
or `npx supabase db reset --local`.

**`now()` is transaction-constant** and a pgTAP fixture is one transaction, so a
seeded join and a posted message tie — and a strict `>` then counts nothing.

**Changing a screen means regenerating its baselines**, and *inspecting the diff
image first*. A blindly refreshed baseline bakes in whatever regressed. Also:
`captureScreen` grows the viewport by measuring **overflow**, not content height,
because the tab bar is a flex sibling *outside* the scroller — a screen whose
scroller lacks `testID="screen-scroll"` gets silently truncated.

---

## Verifying

```bash
npx supabase db reset --local && npm run test:db   # pgTAP — reset FIRST
npm test                                           # vitest
npx tsc --noEmit
eval "$(npx supabase status -o env | sed -n 's/^API_URL=/export SUPABASE_LOCAL_URL=/p; s/^ANON_KEY=/export SUPABASE_LOCAL_ANON_KEY=/p; s/^SERVICE_ROLE_KEY=/export SUPABASE_LOCAL_SERVICE_ROLE_KEY=/p')"
npm run test:visual                                # Playwright, FOREGROUND
npm run test:db:remote                             # hosted grant matrix
```

Green at handoff (`feat/club-boards`, local suites only): **pgTAP 1098/41 files ·
vitest 1129/70 files · Playwright 48/48 · tsc clean**.

`.env.local` points the app at the **hosted** project. Local suites do not exercise
it — this branch's seven migrations (`20260830000000` through `20260830040000`) are
**not yet pushed**. `20260830040000_archive_club_chat.sql` moves a club's real
chat into `archived_messages` on whichever database it runs against, which is why
the push and the hosted grant matrix (`npm run test:db:remote`) are the owner's own
step, taken deliberately, not part of this handoff's local gate.

---

## Open items

Composing an announcement is reachable again, from `app/messages/club/new.tsx`'s
organizer-only toggle — the capability gap this section used to flag closed with
the board reshape.

**Never verified.** A live two-session cross-user Realtime check against the hosted
project. RLS on `postgres_changes` was confirmed locally only, and Supabase Cloud
carries project-level Realtime settings outside this repo.

**Known gaps, none blocking:**
- A past announcement's recipient count is not shown anywhere, and event-targeted
  backfilled announcements drop off the list 24h after their game.
- `useUnreadCounts` runs per TabBar screen, and twice on the dashboard and the
  messages list. A context provider in `app/_layout.tsx` is the fix.
- Compose: create-succeeds-then-post-fails-then-abandon leaves an empty thread.
- Concurrent last-leavers can orphan a zero-member group thread (unreachable after).
- No baseline pictures the members panel.
- `'you are not a member of this club'` inherits `BOOKING_REFUSALS`' copy by
  substring. Inert — messaging relays verbatim and never calls `bookingErrorMessage`.

**Out of scope by decision:** blocking, edit/delete, reactions, attachments, typing
indicators, read receipts, named per-club groups, search, push. And, named when the
board itself was designed:
- **Pinning an announcement.** Considered and rejected — with no unpin affordance,
  a pinned announcement would sit above this morning's post forever, and the top
  of the board would become an archive of stale ones rather than a live one.
- **Reply notifications.** Replies never email or notify; an organizer learns
  about them only by opening the app. A reasonable follow-up, but it means a new
  outbox kind, and that is more surface than it appears.
- **Muting a post.** Without it, a busy post keeps producing unread. Acceptable
  at club scale; the first thing to add if it stops being so.
- **Moving an existing message into a post.** No message editing exists anywhere
  in this app, and this would be the first.
- **Deeper nesting.** One level is the whole point — see decision #11 above.

---

## Refactor candidates — an honest read

**`app/messages/[threadId].tsx` was 1094 lines and is now 473** — the split this
section used to propose actually happened, done for the board and post screens
rather than in place. What came out of it:

- `components/messages/MessageBubble.tsx` — one message, in its four treatments
  (yours, somebody else's, an announcement, any of those carrying a quote stub).
- `components/messages/Composer.tsx` — the quoted-reply row, the input, and Send.
- `components/messages/MembersPanel.tsx` — the roster, with add and leave.
- `lib/use-thread-realtime.ts` — the Realtime subscription and its teardown, as a
  hook (see the property it has to keep, below).
- `components/messages/PostRow.tsx` — new for the board, not extracted from the
  thread screen, but cut from the same cloth: one post's row, given a post.

What is left in `app/messages/[threadId].tsx` is the header and avatar, the
message list and group separators, quote-reply state, the long-press affordance,
and read-marking — plus wiring the four extracted pieces together. The board
(`app/messages/club/[threadId]/index.tsx`) and the post screen
(`app/messages/club/[threadId]/[postId].tsx`) wire up the same pieces differently:
the board renders `PostRow` and nothing else from this list; the post screen reuses
`MessageBubble` and `Composer` exactly as the flat thread screen does, subscribing
on the same hook.

**`lib/messages.ts` is now 971 lines**, up from 798 — the board's RPC wrappers and
its own pure helpers (`postTitle`, `replyCountLabel`, …) landed here rather than in
a new module, the same reasoning that kept the original ~16 helpers beside every
RPC wrapper. Still a legitimate split candidate for the same reason it was before:
the pure formatting and ordering helpers are separable from the data boundary, and
are the parts with the densest tests.

Two things to preserve through any further refactor:
- The pure helpers are what the tests actually pin. Keep them pure and keep them
  exported, or the coverage moves from "tested" to "rendered and hoped for".
- **The Realtime subscription is the app's only one**, now shared by three screens
  through `useThreadRealtime` — the flat thread screen, the board, and the post
  screen all call it with the same `threadId`. Its topic is unique **per
  subscription**, not per thread, on purpose: `supabase.channel(topic)` reuses an
  existing channel by topic, `removeChannel` is async, and `.on()` throws on an
  already-subscribed channel, so a topic that could be handed back to a still-live
  channel would crash under React's dev double-mount or a fast navigation racing
  its own teardown. `lib/use-thread-realtime.ts` guarantees this with a
  module-scoped monotonic counter (`subscriptionSeq`), not `Date.now()` or a PRNG.
  Any further change to this hook — or a second call site — has to keep that
  guarantee, not just the dependency-array fix beside it.
