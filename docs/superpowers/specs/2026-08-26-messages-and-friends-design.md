# Messages & Friends — Design

**Date:** 2026-08-26
**Branch:** `feat/messages` (stacked on `feat/dashboard-artboard`, not `main` — see Branching)
**Artboards:** `1C messages`, `1C thread`, `1C compose`, `1C friends` in
`.superpowers/design/MahjHero.dc.html`
**Follows:** [dashboard artboard](2026-08-25-dashboard-artboard-design.md) (which
shipped the `/messages` placeholder and deferred this),
[notifications & comms](2026-08-23-notifications-and-comms-design.md) (which shipped
broadcasts, the thing this plan absorbs).

---

## Goal

Give the Messages tab something to be. Today
[app/messages.tsx](../../../app/messages.tsx) is a placeholder that says so out
loud, and the only way one member reaches another is a one-way organizer broadcast
that arrives as email and cannot be replied to.

This plan builds two-way messaging in four shapes — a club thread, a game thread, an
ad-hoc group, and a direct message — plus the friends list that makes a group
possible across clubs. It absorbs broadcasts rather than sitting beside them.

## Scope

**In.** A `friendships` edge and the `1C friends` screen; `message_threads` with
three derived kinds; `messages`, `thread_reads`; posting, reading, unread counts and
badges; a `Recent | By club` sort; the thread screen with Supabase Realtime; group
creation, joining and leaving; organizer announcements that also email, replacing
the two broadcast screens; a backfill so no broadcast history is lost.

**Out.** Blocking or reporting. Message edit, delete, reactions, attachments,
typing indicators, read receipts. Named per-club groups. Friend-invite by email.
Push delivery (still dark — see the notifications spec). Search. Pinning. Threading
within a thread.

---

## Decisions locked during brainstorming

1. **Four shapes, three stored kinds.** Club, game and group threads; a direct
   message is a group of two, not a fourth kind.
2. **Friends is one-way, with no approval.** Exactly what the artboard draws.
   Permission to message comes from a separate predicate, not from friendship alone.
3. **Broadcasts are absorbed, not kept alongside.** The compose and history screens
   are deleted; the `broadcasts` table survives as the email record.
4. **Ordinary messages never email.** In-app badges only. Only organizer
   announcements reach the outbox.
5. **Realtime in the open thread only.** Everything else refetches on focus.
6. **Group membership is explicit; club and game membership is derived.**
7. **Anyone in a group can add; anyone can leave; nobody removes anybody.**
8. **One two-segment sort control**, `Recent | By club`, with a `People` section
   pinned above the clubs in the second view.

---

## Part 1 — Friends

### Why it is in this plan at all

It was raised as a scope concern during brainstorming and overruled deliberately, so
the reasoning is recorded rather than lost: the `1C friends` artboard describes
friends as *"the people you can hold seats with when you join a table"* — which
makes it a **booking** feature, whose larger payoff is
[BringSomeoneSheet](../../../components/BringSomeoneSheet.tsx), not a messaging one.
It is built here because group threads need a candidate pool that outlives a shared
club, and because building it twice is worse than building it early.

It is nevertheless a separable subsystem, which is why this spec yields two
implementation plans rather than one — see [Plans](#plans).

### `friendships`

```
profile_id  uuid not null references profiles(id) on delete cascade
friend_id   uuid not null references profiles(id) on delete cascade
created_at  timestamptz not null default now()

primary key (profile_id, friend_id)
check (profile_id <> friend_id)
```

A **one-way edge**. `(a, b)` says "a keeps b in their list" and says nothing about
what b thinks. There is no pending state, no accept, and no notification, because
the artboard has no design for any of them and because a request/accept flow makes
adding a two-person, two-session act for a list whose only job is to shorten a
picker.

RLS: `select`, `insert` and `delete` where `profile_id = (select auth.uid())`, and
nothing else. Nobody can read who has friended them. This is the whole privacy story
for the table, and it is why a one-way edge is safe: the edge is invisible to its
target, so it cannot function as a signal or a slight.

### Acquiring a friend

`add_friend(target)` asserts that the caller currently shares an **active** club
membership with the target. That is the only route in — there is no search by email,
no username lookup, and no way to friend a stranger.

This is also what makes the cross-club story real. You can only *acquire* a friend
inside a shared club, but **the friendship outlives the club**: leave the club, or
watch them leave, and the edge remains. A group thread assembled from friends can
therefore span clubs that no longer overlap, which is precisely the case that
motivated the feature.

### `can_reach(a, b)`

One `security definer` predicate, true when `b` is in `a`'s friends **or** `a` and
`b` share an active club. Every "may I message this person" question in Part 2 is
this function, so the answer cannot drift between the picker, the create RPC and the
add-to-group RPC. Same posture as `assert_club_organizer`, which
[send_broadcast](../../../supabase/migrations/20260826030000_broadcasts.sql) reuses
rather than reimplementing.

### `app/friends.tsx`

The `1C friends` artboard, reached from Profile — the artboard's own back link goes
there, so Profile gains a `Friends` row.

Your friends, each with a `Remove`; below them, "People in your clubs" with an `Add`.
Both lists come from RPCs (`fetch_friends`, `fetch_addable_people`) that resolve the
shared-club names in SQL, so the screen is not a fan-out over club rosters.

**The "+ Invite someone by email" ghost button is dropped.** It would need its own
token, an acceptance path and account linking — a second invite system beside
`club_invites`, which already covers inviting somebody who is not in the app.

---

## Part 2 — Threads

### `message_threads`

```
id             uuid primary key default gen_random_uuid()
club_id        uuid references clubs(id) on delete cascade
event_id       uuid references events(id) on delete cascade
title          text                       -- group threads only
created_by     uuid references profiles(id)  -- group threads only
created_at     timestamptz not null default now()
last_message_at timestamptz

foreign key (event_id, club_id) references events (id, club_id) on delete cascade
check (event_id is null or club_id is not null)
```

The composite foreign key is the same guard `bookings` and `broadcasts` already
carry: a thread cannot point at an event in a different club. The check constraint
says a game thread always knows its club.

**Kind is derived, never stored:**

| `event_id` | `club_id` | kind |
|---|---|---|
| set | set | **game** |
| null | set | **club** |
| null | null | **group** — rendered "Direct" when it has exactly two members |

A direct message is a group of two. Storing `direct` as a fourth kind would mean
deciding what a direct thread becomes when a third person is added, and that is a
question nobody needs to answer.

**Uniqueness needs two partial indexes, not one composite unique:**

```sql
create unique index message_threads_one_per_club
  on message_threads (club_id) where event_id is null and club_id is not null;
create unique index message_threads_one_per_event
  on message_threads (event_id) where event_id is not null;
```

`unique (club_id, event_id)` looks like it would do the job and does not: NULLs are
distinct in a unique index, so it would permit a club unlimited club threads. Group
threads are deliberately unconstrained — two groups with the same members are two
groups.

`last_message_at` is denormalised, written by `post_message` in the same
transaction. The `Recent` sort orders on it, and computing it with a correlated
`max(created_at)` per thread on every list read is the shape that gets slow first.
Null for a club thread nobody has posted in, which sorts last.

Index: `message_threads (last_message_at desc nulls last)`.

### `thread_members`

```
thread_id   uuid not null references message_threads(id) on delete cascade
profile_id  uuid not null references profiles(id) on delete cascade
added_by    uuid references profiles(id)
joined_at   timestamptz not null default now()

primary key (thread_id, profile_id)
```

**Populated for group threads only.** Club and game membership stays derived from
`club_members` and `bookings`.

This asymmetry is the single most important choice in the data model, so it is
argued rather than asserted. Materialising a 42-member roster into `thread_members`
would mean keeping it correct across joins, leaves, role changes, bookings,
cancellations, waitlist promotions, declines and event cancellation — nine write
paths that already exist and would each grow a second thing to remember. Deriving
costs one join at read time and cannot go stale. A group has no other source of
truth, so it gets a table.

### `messages`

```
id              uuid primary key default gen_random_uuid()
thread_id       uuid not null references message_threads(id) on delete cascade
author_id       uuid not null references profiles(id)
body            text not null check (length(trim(body)) between 1 and 2000)
subject         text check (subject !~ '[[:cntrl:]]' and length(subject) <= 120)
is_announcement boolean not null default false
broadcast_id    uuid references broadcasts(id) on delete set null
created_at      timestamptz not null default now()

index (thread_id, created_at desc)
```

`subject` is non-null only on announcements. The control-character check mirrors
`broadcasts.subject` exactly, and for the same reason: the Edge Function drops the
subject into an SMTP header, where a CR or LF is header injection.

No `updated_at` and no `deleted_at`. Edit and delete are out of scope, and adding
the columns now would invite a half-built version of both.

### `thread_reads`

```
thread_id   uuid not null references message_threads(id) on delete cascade
profile_id  uuid not null references profiles(id) on delete cascade
last_read_at timestamptz not null default now()

primary key (thread_id, profile_id)
```

Unread for a viewer is the count of messages in the thread with
`created_at > floor` and `author_id <> viewer`, where **floor** is:

| kind | floor |
|---|---|
| club, game | `greatest(last_read_at, club_members.joined_at)` |
| group | `greatest(last_read_at, thread_members.joined_at)` |

A missing `thread_reads` row means the join timestamp alone. Without that floor a
member joining a three-year-old club opens the app to a badge reading 400, and a
person added to an old group inherits somebody else's backlog as their own homework.

Note the deliberate split for groups: a newly added member **sees the full history**
— the thread is not truncated for them — but **does not inherit it as unread**.
Visibility and obligation are different questions and are answered differently.

---

## Permissions

| | read | post | announce |
|---|---|---|---|
| **club** | active club member | active club member | organizers |
| **game** | confirmed ∪ waitlisted ∪ organizers | confirmed ∪ organizers | organizers |
| **group** | row in `thread_members` | row in `thread_members` | — |

A waitlisted member reads a game thread and cannot post to it. They have no seat, so
the thread is information rather than a conversation they are part of; when they are
promoted, they can post.

Two `security definer` predicates, `can_read_thread(thread_id)` and
`can_post_thread(thread_id)`, branch on the derived kind. RLS on `messages`,
`thread_members` and `thread_reads` calls them, and so does every RPC. The rule is
written once.

### The grant matrix

| Object | anon | authenticated |
|---|---|---|
| `friendships` | — | own rows (`profile_id = auth.uid()`) |
| `message_threads` | — | `select` via `can_read_thread`, no DML |
| `thread_members` | — | `select` via `can_read_thread`, no DML |
| `messages` | — | `select` via `can_read_thread`, no DML |
| `thread_reads` | — | own rows |
| every RPC below | — | execute |
| `can_reach`, `can_read_thread`, `can_post_thread` | — | **revoked** |

Every write goes through an RPC; no table takes direct DML. This is the posture
plans 3, 4 and 6 established.

The explicit `revoke execute from authenticated` on the three predicates is not
belt-and-braces. Supabase's hosted bootstrap grants `execute` to `authenticated` at
function-creation time and `revoke … from public` does not clear it. This repository
has been bitten by exactly that four times — migrations `20260823020000`,
`20260823030000`, `20260823060000` and `20260825061000` — and each time the gap was
invisible against the local stack, which grants `authenticated` nothing by default.

---

## RPCs

### Friends

| Function | Does |
|---|---|
| `add_friend(target)` | Asserts a shared active club, inserts the edge. Idempotent. |
| `remove_friend(target)` | Deletes the edge. |
| `fetch_friends()` | Friends with display name, initials and shared-club names. |
| `fetch_addable_people()` | People in your clubs who are not yet friends, with their club. |

### Threads

| Function | Does |
|---|---|
| `open_thread_for_club(club_id)` | Create-if-absent, return id. Asserts membership. |
| `open_thread_for_event(event_id)` | Create-if-absent, return id. Asserts read access. |
| `create_group_thread(title, members[])` | Asserts `can_reach` for every member. Direct dedupe — see below. |
| `add_to_group_thread(thread_id, members[])` | Caller must be a member; `can_reach` per addition. |
| `leave_group_thread(thread_id)` | Removes the caller. Last one out deletes the thread. |
| `post_message(thread_id, body, announce)` | Asserts `can_post_thread`; announcement path below. |
| `mark_thread_read(thread_id)` | Upserts `last_read_at = now()`. |
| `fetch_my_threads()` | The list, render-ready, unread counts included. |
| `my_unread_counts()` | The viewer's total unread plus a per-club breakdown, in one call. |

### Why threads are created on open, not on first message

`open_thread_for_club` and `open_thread_for_event` create the row when the screen is
opened. A row is cheap; deferring creation to the first send would mean every caller
of `post_message` handling "the thread does not exist yet", and the thread screen
handling an id it does not have.

Emptiness is a **list** concern, not an existence concern, and the list rules below
handle it directly.

### Direct dedupe, at creation only

`create_group_thread` with exactly one member checks for an existing group thread
whose member set is exactly `{caller, member}` and returns that id instead of
creating a second one. Picking one person twice takes you back to the same
conversation.

This is a creation-time convenience, **not a constraint**. A group of four that
people leave until two remain stays its own thread. Enforcing "one thread per pair"
as an invariant would mean a unique index over a member set, which Postgres cannot
express without a maintained digest column, and would make `leave_group_thread` able
to violate it.

### `fetch_my_threads` does the join in SQL

One RPC returning render-ready rows for all three kinds: id, kind, title, club name,
subtitle, last-message preview and author, `last_message_at`, unread count, and for
game threads the event's `starts_at` and the day/date the tile needs.

This follows the argument the notifications spec made for
`claim_notification_batch` — the client should not re-implement tenancy rules that
already live inside `security definer` functions — and it avoids repeating the
dashboard's per-club fan-out, which that spec's deferred item 8 already names as
chatty.

It also **synthesises the always-present club thread** for clubs with no row yet, so
the client never merges two lists.

### List membership rules

| kind | appears in the list |
|---|---|
| club | **always**, for every club you are an active member of, even with no messages |
| game | only with ≥ 1 message, and only until **24 hours after the event ends** |
| group | always, from creation |

The game window is the answer to thread sprawl: a weekly club would otherwise
accumulate fifty-odd dead threads a year. After the window a game thread is not
deleted and stays readable from the game screen — it simply stops competing for
attention in a list about what is happening next.

### The announcement path

`post_message(thread_id, body, announce := true)`:

1. asserts `can_post_thread`, then `assert_club_organizer` on the thread's club;
2. refuses on a group thread — a group has no roster to announce to;
3. derives the subject: the body up to its first newline — the whole body when there
   is none — with control characters stripped and truncated to 120 characters,
   ellipsized when truncation happened;
4. inserts the `broadcasts` row and fans out to `notification_outbox` through the
   existing `broadcast_recipients(club_id, event_id)`;
5. inserts the message with `is_announcement`, `subject` and `broadcast_id` set.

Step 4 **reuses** `broadcast_recipients` rather than writing a second resolver. Its
own docstring is the reason: the count the confirmation previews and the set the
fan-out mails cannot disagree once they are one function, and they disagree the
moment they are two.

Announcements work on both club and game threads because `broadcast_recipients`
already handles both targets — the club roster when `event_id` is null, the event's
confirmed bookings otherwise. That is exactly the two entry points broadcasts had.

### Why the subject is derived rather than typed

An email needs a subject line; the `1C compose` artboard has one input. Rather than
add a field the design does not have, the subject is taken from the body's first
(the whole body when it has no newline) and **shown back to the organizer in the
confirmation** — "Emails 14 members,
subject: …" — so it is disclosed rather than invented silently. A broadcast is
irreversible and outward-facing, and that confirmation step already exists today.

Backfilled announcements keep the real broadcast subject, so history reads correctly.

---

## Absorbing broadcasts

`app/clubs/[id]/broadcast.tsx` and `app/clubs/[id]/broadcasts.tsx` are **deleted**.
Their routes redirect to the club thread. The two entry points — "Message members"
on the club screen and "Message everyone booked" on the event screen — now call
`open_thread_for_club` and `open_thread_for_event` respectively.

`lib/broadcasts.ts` loses `fetchBroadcasts` and gains nothing; `sendBroadcast` is
superseded by `post_message`. `countBroadcastRecipients`, `isValidBroadcast` and the
`CONTROL_CHAR_PATTERN` it guards with move to `lib/messages.ts` — the confirmation
still needs the count, and the control-character rule still needs enforcing before
the database sees the text.

The `broadcasts` **table stays**. It is what the Edge Function's renderer reads, it
anchors the per-recipient dedupe key, and deleting it would orphan every outbox row
already queued.

### Backfill

One migration turns every existing `broadcasts` row into an announcement message:
ensure the club thread exists, insert a message per broadcast with `is_announcement`
true, `subject` and `body` copied verbatim, `broadcast_id` set, and `created_at`
carried over so ordering is preserved. `last_message_at` is set from the newest.

Event-targeted broadcasts land in that **event's** thread, not the club's, which is
where their recipients would look for them.

No history is lost, and the sent-history screen that is being deleted is replaced by
the thread it was always describing.

---

## Screens

`app/messages.tsx` becomes `app/messages/index.tsx`. The `TabBar` href is unchanged,
and the placeholder has no test today, so nothing moves. The two tests that do go are
`app/__tests__/broadcast.test.tsx` and `app/__tests__/broadcasts-history.test.tsx`,
with the screens they cover.

| Route | Screen |
|---|---|
| `app/messages/index.tsx` | The list |
| `app/messages/[threadId].tsx` | A thread |
| `app/messages/new.tsx` | New message |
| `app/friends.tsx` | Friends |

### The list — `1C messages`

Heading, a subhead reading `N clubs` or the single club's name, and a `New` button.
Below it, a two-segment `Recent | By club` control.

- **Recent** — one flat list ordered by `last_message_at desc nulls last`, so empty
  club threads sink. Each row carries its club as a kicker.
- **By club** — the same rows under section headers: a **People** section pinned
  first holding every group and direct, then one section per club (club thread
  first, then that club's game threads by soonest start). Each header carries the
  section's total unread.

The `People` section is pinned rather than filed under a club because a group's club
membership is not a stable fact — deriving one from the member set would move a
group between sections the moment somebody from another club is added.

A row is a left tile, a title block, and a right column:

| kind | tile |
|---|---|
| club | accent chat glyph on `colors.bg` |
| game | the existing [DateTile](../../../components/DateTile.tsx) |
| direct | the other person's initials on `accent2[500]` |
| group | a people glyph on `colors.bg` |

Reusing `DateTile` rather than drawing a second 52×70 tile is what makes a game
thread readable as a game at a glance. Title block: title, a muted `club · kind`
line, and the last message as `Author: body` truncated to one line. Right column:
relative timestamp and the accent unread pill, capped at `99+`.

### The thread — `1C thread`

Back link, title, a muted `kind · subtitle` line, then bubbles: your own
right-aligned on `accent`, everyone else's left-aligned on `surface` with the
author's name in `accent2[700]`. Announcements get the accent-2 card treatment, the
subject in bold above the body, and an `Announcement` tag.

A composer at the bottom. Organizers on a club or game thread also see an "Also
email everyone" toggle; turning it on reveals the recipient count and turns Send
into a confirmation.

A group thread's header is pressable, opening a members list with `Add people` and
`Leave`.

### New message — `1C compose`, adapted

A club chip row (only when you are in more than one club), then two choices rather
than the artboard's three:

- **Everyone** — the club thread, with the artboard's accent-2 note: "Goes to all N
  members of X as a club announcement."
- **People** — the member picker: your friends first, then people in your clubs
  grouped by club, multi-select. One person creates or reopens a direct; two or more
  create a group.

**The artboard's middle "A group" segment is dropped.** There, a group is a named
per-club list — "Tuesday table", "Hosts" — maintained by somebody. Here a group is
an ad-hoc member set that cuts across clubs, so **People** covers the same ground
and a third choice would be a distinction without a difference.

### Badges elsewhere

- A count badge on the Messages tab in `TabBar`, from `my_unread_counts()`. This is
  the **only** signal an ordinary message produces, since ordinary messages never
  email, so it is not decoration.
- `hasUnread` / `unread` on the dashboard's club chips — the design already models
  both, and it is the dashboard spec's deferred item 2, now cheap.

Both come from one `my_unread_counts()` call — a total for the tab and a per-club
breakdown for the chips — behind one shared `useUnreadCounts()` hook, refetched on
screen focus. Two RPCs would mean two round trips per tab screen for one badge.

---

## Realtime

The open thread subscribes to `postgres_changes` on `INSERT` into `messages`
filtered by `thread_id`, and unsubscribes on blur. `messages` joins the
`supabase_realtime` publication; `postgres_changes` applies RLS per subscriber, so
the channel delivers exactly what `can_read_thread` allows and no more.

This is the app's first use of Realtime, and it is scoped to one screen on purpose.
Subscribing across every thread would update badges live at the cost of holding a
connection per client for the whole session and being the hardest thing in the plan
to test. The list refetches on focus and after a send instead.

A message that arrives while the thread is open also advances `last_read_at`, so a
conversation you are watching never accumulates a badge.

---

## Error handling

| Failure | Behaviour |
|---|---|
| Post to a thread you cannot post to | 42501 from `can_post_thread`, surfaced as the ordinary refusal copy |
| Add someone `can_reach` rejects | Refused with words; the picker should not have offered them, so this is the race, not the path |
| Realtime channel drops | Silent. The thread refetches on focus, and sending refetches |
| `fetch_my_threads` fails | The list shows the shared error banner with a retry, not an empty state — "no messages" and "we could not ask" are different claims |
| Announcement fan-out interrupted | `on conflict do nothing` on the dedupe key; re-running inserts only what is missing |
| Last member leaves a group | Thread and messages deleted by cascade. Deliberate: nobody can reach it again |
| `add_friend` for an existing edge | No-op, not an error |

---

## Testing

Test-driven throughout.

**pgTAP** — the two partial unique indexes actually preventing a second club thread
and a second game thread; the read/post matrix above across member, non-member,
confirmed, waitlisted, organizer and stranger; `can_reach` in both its branches and
after the shared club is left; `add_friend` refusing a stranger; the unread floor at
`club_members.joined_at` and at `thread_members.joined_at`; `create_group_thread`
deduping a one-person pick and not deduping a shrunk group; `add_to_group_thread`
refusing a member the caller cannot reach; `leave_group_thread` deleting the thread
on the last exit; `post_message` with `announce` writing a `broadcasts` row, fanning
out with correct dedupe keys and a correct `recipient_count`, and refusing a
non-organizer and a group thread; the backfill placing event-targeted broadcasts in
the event's thread; and the grant matrix, in the portable suite that runs against
the hosted project.

**Vitest** — `lib/messages.ts` and `lib/friends.ts` pure helpers: thread sorting in
both modes, the People-first grouping, badge capping at `99+`, subject derivation
from a body, preview truncation, and the relative timestamp. Then the four screens:
structure, empty states, error states, the sort toggle changing the rendered order,
the picker's friends-first ordering, and the announcement confirmation. Realtime is
mocked at the `supabase.channel` boundary, with subscribe-on-mount and
unsubscribe-on-unmount both asserted — an un-torn-down subscription is the bug this
kind of screen actually ships.

**Playwright** — the list in both sorts, a thread, the picker and the friends screen,
at both viewports, with visual baselines.

---

## Risks and open items

1. **No blocking.** Leaving a thread is the escape hatch and works for a direct as
   well as a group, but somebody in your club can start another one. The shared-club
   gate keeps strangers out; it does not help with an unwanted club-mate. Worth its
   own pass.
2. **A one-way friend edge is invisible to its target.** That is the privacy
   property, and it also means nobody can tell you they consider you a friend. If
   the product later wants mutuality, the edge is already the right shape for it.
3. **Realtime is new operational surface.** The publication, the connection count
   and the Realtime quota all become things to watch that were not before.
4. **A club thread is one room for up to a whole club.** At 42 members it may want
   the named per-club groups the artboard drew and this plan dropped. The
   `thread_members` table can carry them unchanged when that time comes.
5. **Ordinary messages produce no notification off-device.** Deliberate — email per
   message does not scale and digests are out of scope — but it means a member who
   does not open the app does not know. This is the strongest argument for making
   push real, and ordinary messages are its natural first payload.
6. **Deleting two shipped screens.** `broadcast.tsx` and `broadcasts.tsx` have
   tests, visual baselines and entry points. The backfill covers the data; the
   review needs to confirm nothing else links to them.

## Plans

This spec yields **two** implementation plans, executed in order:

1. **Friends** — `friendships`, `can_reach`, the four friend RPCs, `app/friends.tsx`,
   the Profile link. Self-contained, independently useful, and it unblocks the
   picker.
2. **Messages** — everything in Part 2: the three tables, the predicates, the RPCs,
   the three screens, realtime, the badges, the broadcast absorption and the
   backfill.

## Branching

`feat/messages`, branched from `feat/dashboard-artboard` rather than `main`. This
plan needs `TabBar` and the dashboard's chips (dashboard-artboard), `broadcasts` and
the outbox (notifications), `bookings` (seating), and `check_in` only transitively.
`main` currently ends at PR #5. The pull request targets `feat/dashboard-artboard`,
or is rebased onto `main` once the stack ahead of it merges — the same arrangement,
and the same reasoning, the dashboard spec recorded for its own branch.
