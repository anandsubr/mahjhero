# MahjHero Seating & Booking — Design

**Date:** 2026-08-23
**Plan:** V1 plan 4 of 6, following [foundation & identity](2026-08-01-mahjhero-v1-design.md)
(plan 1), clubs & membership (plan 2), and
[events & scheduling](2026-08-22-events-and-scheduling-design.md) (plan 3).
**Parent spec:** [2026-08-01-mahjhero-v1-design.md](2026-08-01-mahjhero-v1-design.md) —
sections 5 (Events and seating), 6 (Seating and booking mechanics), 8 (Permissions),
9 (Error handling), 10 (Testing).

---

## Goal

A member takes a seat. Plan 3 gave a club a calendar that members can read and
nothing more; this plan makes the calendar answer the question the product exists
to answer — *are we four tonight?* A member books a seat, brings friends, joins a
waitlist and is promoted off it automatically, and a table sitting at three of four
calls for a fourth.

## Scope

**In.** Solo booking, group booking with splits, booking on behalf of other club
members with a one-tap decline, "any table" bookings and host placement, member and
host cancellation, the waitlist with FIFO auto-promotion, timed partial-fit
promotion offers, "need a 4th" detection and claiming, and the voiding of bookings
when a host cancels a game or removes a table.

**Out, and deliberately so.** Check-in (plan 5). Push and email delivery, host
broadcasts, and reminder scheduling (plan 6). Guest attendance, scoring, and
automatic seating by skill are not in V1 at all.

### The plan 4 / plan 6 boundary

Three moments in this plan are specified as notifications — *"Jane booked you at
Table 2"*, *"2 of your 3 seats are available"*, *"Table 3 needs a 4th"* — and plan 4
cannot deliver a notification.

Every such moment writes a row to `notification_outbox`, and the same fact is
surfaced in the app where the member already is. Plan 6 drains the outbox to push
and email and adds nothing else: no new trigger points, no reconstruction of who
should have been told.

The alternative — deriving every trigger point again in plan 6 — was rejected
because a notifiable moment that has already passed leaves no trace. An offer that
expires unseen is exactly the case worth recording, and it is exactly the case a
read-time derivation cannot see.

**What this costs, stated plainly.** Until plan 6 ships, a member who does not open
the app can miss a promotion offer and let it expire. This is accepted rather than
designed around; adding an interim delivery channel would mean building plan 6's
infrastructure inside plan 4 under a different name.

---

## Decisions locked during brainstorming

| Decision | Choice | Why |
|---|---|---|
| Scope | All of parent-spec section 6, offers and "need a 4th" included | The mechanic is incoherent in halves — a waitlist with no partial-fit rule silently drops the case it exists for |
| Notification seam | Outbox rows plus contextual in-app surfaces | Plan 6 adds delivery only; nothing is re-derived and no passed moment is lost |
| Skill tiers at booking | Soft warning, member may proceed | `profiles.skill_level` is self-reported and nullable; hard-blocking turns every mis-set profile into a support conversation with the host |
| Host removes a table | Its bookings become "any table", never destroyed | Reuses a concept the parent spec already defines instead of inventing an unseated state |
| Host cancels a game | Every booking voided, waitlist cleared, outbox row each | Matches plan 3, where nothing un-cancels |
| Waitlist promotion | Inline in the transaction that frees the seat; cron for expiry only | A five-minute dead window in front of a visibly empty seat reads as a broken app |
| "Any table" bookings | Claim a seat against event capacity | Otherwise members book past a full game without limit and the waitlist means nothing |
| Offered seats | Held against capacity until the offer resolves | A two-hour promise a faster member can take is not a promise |
| Member surface | "Your games" on `/clubs`, detail on the event screen | `/clubs` is the only screen every signed-in member lands on |
| Table rendering | A seat grid — every seat drawn, empties tappable | "Three of four" is the product's core fact and should not need reading |
| Seat tap | Books you immediately; "Bring someone" opens the group sheet | The common case is one tap; the group case is one tap deeper |

---

## Data model

Four new tables. Three of them are club-scoped and follow plan 3's denormalized
`club_id` with a composite foreign key; the fourth, `notification_outbox`, is
infrastructure and has no client access at all.

### `booking_groups` — the social unit

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `event_id`, `club_id` | composite FK to `events (id, club_id)` |
| `created_by` | the booker |
| `preferred_table_id` | nullable; composite FK to `event_tables (id, event_id)` |
| `allow_split` | boolean, default **true** |
| `status` | `confirmed` / `waitlisted` / `cancelled` |
| `waitlisted_at` | timestamptz, non-null exactly when status is `waitlisted` |
| `created_at` | |

**Every booking belongs to a group, solo bookings included.** A group of one is not
a special case; it is the ordinary case with one member, and it means the propose →
commit path has one implementation rather than two.

**Two deliberate departures from the parent spec's sketch:**

- **No `size` column.** It is `count(*)` over the group's live bookings. A stored
  copy is a second source of truth that goes wrong the first time one member of a
  three-person group declines.
- **No `waitlist_position` integer.** `waitlisted_at` orders the queue and position
  is computed on read with `row_number()`. A stored position must be renumbered on
  every departure — and the parent spec's rule that a group skipped for not fitting
  *keeps its place* is free under time ordering and fiddly under integers.

### `bookings` — one person, one seat

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `group_id` | FK to `booking_groups`, on delete cascade |
| `event_id`, `club_id` | composite FK to `events (id, club_id)` |
| `event_table_id` | **nullable** — null means "any table", confirmed but unplaced; composite FK to `event_tables (id, event_id)` |
| `profile_id` | who is playing |
| `booked_by` | who created the row; equal to `profile_id` for a self-booking |
| `status` | `confirmed` / `waitlisted` / `cancelled` / `declined` |
| `cancelled_by`, `cancelled_at` | who ended it and when |
| `created_at` | |

Constraints that carry weight:

- **One active booking per person per event** — a partial unique index on
  `(event_id, profile_id) where status in ('confirmed', 'waitlisted')`. This is the
  constraint that stops two friends booking the same person into the same game.
- **A waitlisted booking has no table** — `check (status <> 'waitlisted' or
  event_table_id is null)`. A waitlisted member is in a queue, not in a chair.
- **A closed booking records how it closed** — `check ((status in ('cancelled',
  'declined')) = (cancelled_at is not null))`.
- The composite FKs are the tenancy guard: a booking cannot point at a table
  belonging to another event, nor at an event belonging to another club. Plan 3
  already carries `events_id_club_unique`; this plan adds the matching
  `event_tables_id_event_unique` that the table-side composite FK needs.

`declined` is a distinct status rather than a flavour of `cancelled` because the
booker's outbox row has to say which happened. "Jane declined the seat you booked"
and "Jane cancelled" are different messages to receive.

### `promotion_offers` — a timed partial fit

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `group_id`, `event_id` | the waitlisted group being offered fewer seats than it asked for |
| `offered_seat_count` | int, `> 0` |
| `expires_at` | `min(now() + interval '2 hours', event start)` |
| `responded_at` | null while outstanding |
| `outcome` | null / `accepted` / `declined` / `expired` |
| `created_at` | |

A partial unique index on `(group_id) where responded_at is null` keeps a group to
one outstanding offer.

**Departure from the parent spec: no `event_table_id`.** The offer promises a
*count*, not a location. Seats can move between the offer and the acceptance, and an
offer that names Table 2 becomes a promise the accepting transaction may be unable
to keep. Placement resolves at acceptance, against fresh state.

### `notification_outbox` — plan 6's queue, written now

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `recipient_id` | FK to `profiles` |
| `club_id`, `event_id` | context for delivery and deep-linking |
| `kind` | enum: `booked_by_friend`, `booking_declined`, `booking_cancelled_by_host`, `waitlist_promoted`, `promotion_offer`, `promotion_offer_expired`, `unseated`, `event_cancelled`, `need_a_fourth` |
| `payload` | jsonb — table label, seat count, expiry, booker name |
| `dedupe_key` | text, **unique**; the idempotency guard for both cron jobs |
| `created_at`, `sent_at` | `sent_at` stays null until plan 6 |

**No RLS policy and no grant to `authenticated`.** The outbox is written by
`security definer` functions and read by plan 6's delivery job under `service_role`.
Members never read it: everything they see comes from live state instead —
`promotion_offers` for a held offer, `bookings.booked_by` for a friend-booked seat,
occupancy and time for a table needing a fourth. The outbox and the screen describe
the same facts, but only one of them is ever the source.

### What is deliberately not stored

**There is no "need a 4th" record.** A table needs a fourth when it holds
`capacity - 1` confirmed bookings and the event starts within 48 hours; the call
widens to adjacent tiers inside 12 hours. Both are pure functions of occupancy and
time-to-start, so the screen derives them and nothing can go stale. The only durable
artifact is the outbox row, and its `dedupe_key`
(`need_a_fourth:<table_id>:<stage>:<recipient_id>`) is what stops the 15-minute job
announcing the same table twice.

`checkins`, `broadcasts` and `notification_log` from the parent spec's data model
stay unbuilt. They belong to plans 5 and 6.

---

## Capacity, holds, and the one lock

Every seat mutation for an event begins with `select … from public.events where
id = p_event for update`. Proposals, commits, cancellations, offer acceptances,
host placement and both cron jobs serialize on that row. Contention is a handful of
people around one game; the alternative is a family of subtler locks bought for
nothing.

**Event capacity** is `sum(event_tables.capacity)` for the event. Against it stand:

- every **confirmed** booking, seated **or** unseated, and
- every seat **held** by an outstanding `promotion_offer`.

```
free_seats(event) = capacity(event)
                  - confirmed_bookings(event)
                  - outstanding_offered_seats(event)
```

Two consequences, both intended:

- **An "any table" booking is a real seat claim.** It occupies no particular table,
  but it costs the event a seat. Without this the waitlist is decorative: members
  book past a full game indefinitely, and the host discovers it at the door.
- **Offered seats are unavailable to everyone else** for the life of the offer. A
  two-hour promise that a faster member can take out from under the group is not a
  promise, and the group has already waited its turn.

Placement additionally requires room at the specific table:
`table_free_seats(table) = capacity - confirmed bookings placed there`.

Both floor at zero. Removing a table lowers capacity without ejecting anybody, so an
event can legitimately hold more confirmed bookings than seats for as long as it
takes the host to sort it out; that state admits nobody new and must not read as
negative free seats.

---

## Booking mechanics

### propose → commit

```
propose_booking(p_event uuid, p_players uuid[], p_preferred_table uuid,
                p_allow_split boolean) returns jsonb
commit_booking (p_event uuid, p_players uuid[], p_preferred_table uuid,
                p_allow_split boolean) returns jsonb
```

`propose_booking` reads and returns a plan — everyone at the preferred table, a
named split showing exactly who sits where, or everyone waitlisted. It writes
nothing.

`commit_booking` takes **the same arguments, not the proposal**. There is no plan
token to go stale, to be replayed, or to be forged; the commit re-derives the plan
inside the transaction and writes it atomically. It returns what it actually did, and
the client compares that against what it displayed — if the outcome changed because
seats disappeared between the two calls, the member is told what changed rather than
shown a silent difference.

A solo tap-to-book is `commit_booking(event, array[me], table, true)` with no
proposal step at all: for one player there is nothing to confirm, so the extra round
trip would buy a confirm dialog nobody needs.

Both refuse: a `draft` or `cancelled` event, an event whose start has passed, a
player who is not an active member of the club, and a player who already holds an
active booking for this event.

### Tiers

`event_tables.skill_tier` is advisory at the point of booking. The **client** warns
when a player's `skill_level` does not match the table's tier — "Table 2 is set up
for advanced players. Book anyway?" — and proceeds on confirmation. A null
`skill_level` never warns, and `mixed` matches everyone. The booking functions do not
check tiers at all: they stay a pure capacity-and-atomicity concern, and the host
retains the last word by moving people.

### Booking on behalf of friends

Seats are secured immediately — that is the entire point of the feature. Each named
friend gets a `booked_by_friend` outbox row and, in the app, their seat appears under
"Your games" with a one-tap **Decline** that frees it and notifies the booker. There
is no accept: doing nothing means the seat is theirs.

Only active club members may be added to a group. A member already booked for the
event cannot be added again — the partial unique index refuses, and the client says
"Jane already has a seat at this game" rather than reporting a constraint.

---

## The waitlist

When `free_seats(event) = 0`, `commit_booking` creates the group as `waitlisted`
with `waitlisted_at = now()` and all its bookings `waitlisted`. Position is
`row_number()` over the event's waitlisted groups by `waitlisted_at`.

`promote_waitlist(p_event uuid)` walks the queue in `waitlisted_at` order and, per
group:

- **Whole group fits** → confirm and place. Preferred table first, then any table
  with room. `allow_split = false` requires one table holding all of them; otherwise
  the group is treated as a partial fit. No consent is asked: they got what they
  asked for. One `waitlist_promoted` outbox row per member.
- **Partial fit, `allow_split = true`** → create a `promotion_offer` for the seats
  available, `expires_at = min(now() + 2h, event start)`, one `promotion_offer`
  outbox row to the booker. Those seats are now held.
- **Partial fit, `allow_split = false`** → skip. The group keeps its
  `waitlisted_at`, so it keeps its place.

The walk stops when no free seats remain.

**Every path that frees capacity calls it before committing:** `cancel_booking`,
`cancel_booking_group`, `decline_booking`, a host removing a booking, a host adding a
table, and the sweep that expires an offer. One helper, one set of rules, and a
member watching the screen is seated the moment a friend cancels.

### Accepting an offer

`accept_promotion_offer(p_offer)` re-validates inside the transaction, confirms
`offered_seat_count` of the group's members — the booker first, then the order they
were added — and places them. The remainder stay waitlisted **as the same group with
its original `waitlisted_at`**, so a group that takes two of three seats does not go
to the back of the queue for the third.

`decline_promotion_offer(p_offer)` and expiry both release the hold, record the
outcome, and call `promote_waitlist` so the seats reach the next eligible group.

---

## "Need a 4th"

A table qualifies when it holds `capacity - 1` confirmed bookings and
`starts_at - now() <= 48 hours`. Inside 12 hours the call widens to adjacent tiers:
`beginner ↔ intermediate ↔ advanced`, with `mixed` matching everyone. Both thresholds
are plain intervals against an instant, so no timezone arithmetic is involved.

`announce_need_a_fourth()` runs every 15 minutes and writes a `need_a_fourth` outbox
row to each club member who matches the tier for the current stage, is not already
booked for that event, and has not set `mute_need_a_fourth`. The `dedupe_key` carries
the stage, so widening announces exactly once more and no more.

**It carries the recipient too, by necessity rather than tidiness.** The announcement
is one multi-row `insert … select … on conflict (dedupe_key) do nothing`, so a key
shared across recipients drops every row but the first and tells exactly one member —
a feature that looks like it works. Verified in Postgres, and caught during
implementation.

**Claiming is an ordinary booking.** First commit wins on the event lock. The call
resolves for everyone else immediately because it was never stored — the next read
simply no longer qualifies.

`call_for_a_fourth(p_table)` lets an organizer fire the announcement early, before
the 48-hour window opens. It writes the same rows through the same dedupe key.

---

## Cancellation, declining, and host disruption

`cancel_booking(p_booking)` accepts three callers and records which one acted in
`cancelled_by`: the member themselves, the booker who created the row, and any
organizer of the club. One function rather than three, because the difference between
them is entirely in the guard.

`decline_booking(p_booking)` is the bookee's alone, and only when
`booked_by <> profile_id`.

`cancel_booking_group(p_group)` is "leave the waitlist" — it closes every booking in
the group, and is available to the booker and to organizers. If the group holds an
outstanding offer, cancelling resolves it as `declined` and releases the hold in the
same transaction; a held seat must never outlive the group it was held for.

**A group's status is a rollup, maintained by the functions, never by the client.**
When the last active booking in a group closes — one member at a time or all at once
— the group becomes `cancelled`. A group with no live bookings and a `confirmed`
status would leave the waitlist walk considering a group that no longer exists.

**All of them are refused once `starts_at` has passed.** A seat freed mid-game frees
nothing, and a no-show is plan 5's concept, not a cancellation.

**Removing a table** (plan 3's `remove_event_table`, amended here): its confirmed
bookings become `event_table_id = null` — still confirmed for the game, unplaced —
with an `unseated` outbox row each. Plan 3's existing refusal to remove the last
table stands.

**Cancelling a game** (plan 3's `cancel_event`, amended here): every confirmed and
waitlisted booking is cancelled, every outstanding offer is marked `expired`, the
group rows are cancelled, and each affected member gets an `event_cancelled` outbox
row. Nothing un-cancels — matching plan 3, where a cancelled occurrence stays
cancelled.

**Placement.** `place_booking(p_booking, p_table)` seats an unplaced booking or moves
a placed one. A member may place or move **their own** booking; an organizer may
place or move anyone's. `p_table = null` returns a booking to "any table".

---

## Scheduled work

Two jobs, both `pg_cron`, both following plan 3's pattern — plain plpgsql called
synchronously, no Edge Function and no HTTP, so pgTAP can test them by calling them.

| Job | Frequency | Purpose |
|---|---|---|
| `sweep_promotion_offers()` | every 5 min | Expire offers past `expires_at`, release their holds, promote the next eligible group |
| `announce_need_a_fourth()` | every 15 min | Write outbox rows for tables at `capacity - 1` inside the alert window |

Neither is granted to `authenticated`. `promote_waitlist` is likewise internal — it
is called by the granted functions, never directly by a client.

Plan 3's `pg_cron` caveat carries forward: if the extension is unavailable in an
environment, offers still expire correctly on read (the app never shows an offer past
`expires_at`) but the seats behind an unswept offer stay held until someone touches
the event. This is degradation, not correctness loss, and it is exactly what plan 6's
infrastructure picks up.

---

## Permissions

Authenticated clients hold `select` on `booking_groups`, `bookings` and
`promotion_offers`, **nothing at all** on `notification_outbox`, and no DML anywhere.
Every mutation is a `security definer` function with a pinned `search_path`.

Read policies:

- `booking_groups`, `bookings` — `is_club_member(club_id)`. Who is coming is the
  club's business; that is the product.
- `promotion_offers` — visible to the group's own members, via a new
  `is_booking_group_member(group uuid)` helper (`security definer`, `stable`, pinned
  `search_path`) that exists for the same reason `is_club_member` does: a policy
  asking the question directly through `bookings` would recurse.
- `notification_outbox` — no policy. `service_role` only.

Functions granted to `authenticated`: `propose_booking`, `commit_booking`,
`cancel_booking`, `cancel_booking_group`, `decline_booking`, `place_booking`,
`accept_promotion_offer`, `decline_promotion_offer`, `call_for_a_fourth`.

Internal (no `authenticated` grant): `promote_waitlist`, `sweep_promotion_offers`,
`announce_need_a_fourth`.

Organizer-guarded, via plan 3's shared `assert_club_organizer(uuid)`:
`call_for_a_fourth`, and the organizer branches of `cancel_booking`,
`cancel_booking_group` and `place_booking`.

Plan 2's hygiene applies to every new object: grants written verb-for-verb rather
than `all` (which includes `TRUNCATE`, which RLS does not filter), and
`revoke execute … from public, anon, authenticated` before every grant.

**`authenticated` belongs in that revoke, and leaving it out is the mistake this
project keeps making.** Two independent mechanisms hand out EXECUTE: a null
`proacl` means EXECUTE to PUBLIC, *and* Supabase's hosted bootstrap grants EXECUTE
to `authenticated` directly at function-creation time — which a revoke from
`public` never touches. The local stack adds no such grant, so an internal
function reachable by every signed-in user on hosted looks clean locally and stays
clean through every local test run. Plan 3 was bitten three times; plan 4 shipped
sixteen functions that way, `promote_waitlist` and `confirm_group_seats` among
them — `security definer`, no membership check, written to trust their callers
because they were supposed to be unreachable. Only `portable/grants.test.sql` run
against hosted finds it, which is the argument for running it early rather than at
merge.

---

## Screens

Three surfaces change. No new routes.

**`app/clubs/[id]/events/[eventId]/index.tsx`** — the seat grid. Each table card
draws every seat: filled ones name the member, the member's own seat is marked,
empty ones are tappable and book immediately. A tier mismatch warns first. A quieter
**"Bring someone"** control per card opens the group sheet (who's coming, preferred
table, the plainly-worded split toggle, and the split proposal to confirm). Below the
tables: members not yet seated, the waitlist in order, and any live offer with its
expiry. Organizers additionally get seat/move/remove per booking and "Call for a 4th
now" per table.

*The seats are drawn but not numbered.* The schema counts seats; the grid renders
occupied bookings followed by empty placeholders. Nothing in the UI should imply
that Table 2 seat 3 is a durable place, because it is not one.

**This screen is already 432 lines and booking would roughly double it.** The design
extracts `SeatGrid`, `TableCard`, `BringSomeoneSheet`, `WaitlistPanel` and
`HostSeating` as components with their own tests, leaving the screen with fetch and
refresh orchestration. This is not general refactoring — it is the part of the file
this plan is about to rewrite.

**`app/clubs/index.tsx`** — a **"Your games"** section above the club list: upcoming
seats across every club, each showing when, where and which table. A seat booked by
someone else carries "Jane booked this for you" and the one-tap decline; a live
promotion offer carries its held seat count and expiry with accept and decline.
Empty for a member with no bookings — a plain line, not an error.

*This screen also carries the two bugs logged in `todo.md`* — no page padding, and no
gap between the last club card and the button. Fixed here, in the layout, with the
`clubs*` visual baselines regenerated in the same PR.

**`app/clubs/[id]/index.tsx`** — each upcoming-event card gains one status line:
"You're in · Table 2", "Waitlisted · 2nd", "Needs a 4th", or "3 seats free". This is
where a call for a fourth in a game you are *not* in reaches you; "Your games" stays
about games you are in.

New data layer `lib/bookings.ts`, mirroring `lib/events.ts`, with its own failure
flags per fetch — plan 3's lesson that a failed fetch must never be rendered as
"none".

---

## Error handling

Plan 3's correction is binding: a refusal raised by a definer function reaches the
member as the sentence explaining it, never as "Check your connection." Every
refusal in this plan has written wording, including:

| Refusal | What the member reads |
|---|---|
| Event full at commit | "That game filled up while you were looking. Join the waitlist?" |
| Table full at commit | "Someone just took the last seat at Table 2." |
| Player already booked | "Jane already has a seat at this game." |
| Player not a member | "Jane is no longer in this club." |
| Cancelling after start | "This game has already started." |
| Offer expired | "That offer has expired — you're still on the waitlist." |
| Booking a cancelled game | "This game was cancelled." |

---

## Testing

The branch's existing layers, unchanged in kind:

- **pgTAP** for every function, policy and constraint, and for both cron jobs called
  directly. Every assertion is **mutation-checked** — deliberately broken to prove it
  can fail. Plan 3 shipped assertions that could not fail, including one that ratified
  a data-loss bug, and this is the discipline that caught them.
- **Concurrency** — two transactions racing for one last seat produce exactly one
  booking; two racing offer acceptances produce exactly one placement.
- **Vitest** for `lib/bookings.ts` and each extracted component.
- **Schema contract test** extended to the four new tables.
- **Playwright visual baselines** for the new states: seat grid with a mix of filled
  and empty seats, a full game with the waitlist panel, a held offer with its expiry,
  and a table calling for a fourth. Per `docs/testing.md`, the visual layer cannot
  fail on a one-glyph text change — text is protected by `getByText` preconditions,
  not pixels — and new baselines are written with `--update-snapshots=all` and
  **looked at**.

Cases that get explicit tests because they are where this design is most likely to be
wrong: an "any table" booking consuming event capacity; an outstanding offer holding
seats against a third party's booking attempt; a skipped `allow_split = false` group
keeping its place; a partially-accepted offer keeping its original `waitlisted_at`;
and a removed table unseating rather than deleting.

---

## Risks and open items

1. **The seat grid implies numbered seats.** Members may come to expect "my usual
   chair". The schema counts seats and does not name them; a future request for real
   seat identity is a new column and a migration, not a tweak.
2. **An offer can expire unseen** until plan 6 delivers push. Accepted above, and the
   single strongest argument for plan 6 following immediately.
3. **"Any table" claiming capacity removes the host's ability to overbook.** A host
   who knows two regulars always drop out cannot pre-empt it. If this bites, the fix
   is an explicit per-event overbooking allowance, not a quiet exception.
4. **A held offer keeps a seat empty for up to two hours** while a club plays a player
   short. This is the parent spec's deliberate trade. The expiry caps how long ANY ONE
   offer holds its seats, but it is not a cap on the group's place in line: a group
   whose offer lapses unanswered is treated exactly like a group that does not fit —
   it keeps its `waitlisted_at` and is not offered that same partial fit again, but it
   remains eligible to be seated outright the moment enough seats are free at once.
   (An earlier version of `promote_waitlist` minted a fresh offer for the same seats
   the instant the old one lapsed, which re-held them and could starve every smaller
   group waiting behind it indefinitely — fixed in 20260825090000; see that
   migration's header for the full account.)
5. **Group placement order is booker-first**, then join order. Nobody has asked for
   the booker to choose who gets the partial seats; if they do, it is an argument to
   `accept_promotion_offer`, not a redesign.

## Not in this plan

Check-in (plan 5). Push and email delivery, host broadcasts, reminder scheduling
(plan 6). Guest attendance, scoring, leaderboards, in-club chat, and automatic table
assignment by skill — all deferred by the roadmap, none prefigured here with
placeholder state.
