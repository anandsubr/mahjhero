# Messaging — orientation and handoff

Written to be read at the start of a session that did not build this. It is not a
changelog; it is what you need to change this code without breaking it or
re-litigating decisions that already cost something.

**Spec:** [2026-08-26-messages-and-friends-design.md](superpowers/specs/2026-08-26-messages-and-friends-design.md)
**Branch:** `feat/messages`, 79 commits, stacked on `feat/dashboard-artboard` (not `main`), [PR #9](https://github.com/anandsubr/mahjhero/pull/9)

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

**Client:**

| file | lines | what |
|---|---|---|
| `lib/messages.ts` | 798 | every RPC wrapper plus ~16 pure helpers |
| `lib/friends.ts` | — | the friends boundary |
| `lib/use-unread.ts` | — | `useUnreadCounts()`, drives both badges |
| `app/messages/index.tsx` | 194 | the list |
| `app/messages/[threadId].tsx` | **1094** | the thread — see *Refactor candidates* |
| `app/messages/new.tsx` | 453 | compose |
| `app/friends.tsx` | 252 | friends |
| `components/ThreadRow.tsx`, `ThreadAvatar.tsx`, `UnreadBadge.tsx` | — | shared row parts |

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
7. **`deriveSubject` must agree with `post_message`'s SQL character for character** —
   it is shown to an organizer as the subject their email will carry.
8. **`lib/` never rejects.** Every exported async resolves `null` or `{ error }`.
   `null` means "we could not ask"; `[]` means "there is nothing". Conflating them
   tells a member something false about themselves.
9. **Refusals relay verbatim.** The database's messages are written to be read by a
   member. `lib/bookings.test.ts`'s ALLOWLIST names `lib/messages.ts` as responsible
   for exactly this.

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
tab focus. **Key on `session?.user.id`.** This was hit four times, once causing a
Realtime crash. `lib/use-viewer.ts` and `app/profile.tsx` document it.

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

Green at handoff: **pgTAP 1052/36 · vitest 1042/62 · Playwright 44/44 · tsc clean · hosted grants 115**.

`.env.local` points the app at the **hosted** project. Local suites do not exercise
it — every migration here is already pushed, but a new one needs `npx supabase db push`.

---

## Open items

**Capability gap, flagged on the PR.** Composing an announcement is **unreachable** —
the organizer toggle was removed pending a friendlier design. Everything beneath is
intact and tested; `countBroadcastRecipients` is parked for the replacement. Until
it lands there is no way to email a club from the app, where before this branch
there was.

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
indicators, read receipts, named per-club groups, search, push, sub-threads.

---

## Refactor candidates — an honest read

**`app/messages/[threadId].tsx` is 1094 lines** and is the obvious target. It
carries, in one component: the header and avatar, the message list and four bubble
treatments, group separators, quote-reply state, the long-press affordance, the
members panel with add and leave, the composer, the Realtime subscription and its
teardown, and read-marking. Natural seams: the bubble (given a message, render it),
the members panel, the composer, and the Realtime subscription as a hook.

**`lib/messages.ts` is 798 lines** holding ~16 pure helpers next to every RPC
wrapper. The pure formatting and ordering helpers are separable from the data
boundary, and are the parts with the densest tests.

Two things to preserve through any refactor:
- The pure helpers are what the tests actually pin. Keep them pure and keep them
  exported, or the coverage moves from "tested" to "rendered and hoped for".
- The Realtime subscription is the app's only one. Its topic is unique per
  subscription **on purpose** — `supabase.channel(topic)` returns an existing
  channel, `removeChannel` is async, and `.on()` throws on a subscribed channel.
  If you extract it into a hook, that property has to come with it.
