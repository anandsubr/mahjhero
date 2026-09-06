# Open-seating events & payment tracking — Design

**Date:** 2026-09-06
**Status:** Approved (design); pending implementation plan

## Problem

A new class of organizer has appeared: clubs running **60–70 players** in a single
session. For them, assigning every player to a numbered table in advance is not a
feature — it is the thing that makes the event unmanageable. Who actually turns up
is not known until the door, so any advance seating plan is obsolete on arrival.

What these organizers still need is the unglamorous half: **who signed up, who
actually showed, and who has paid.**

MahjHero cannot express this today. Every event is built around tables:
`create_event` rejects a `table_count` below 1
(`supabase/migrations/20260823010000_event_mutations.sql:68`), `remove_event_table`
refuses to remove the last one (same file, :320-325), and capacity is *derived* by
summing table capacities (`20260825000000_create_bookings.sql:195-203`). An event
with no tables therefore has capacity 0, and `plan_seating` waitlists everyone
(`20260825020000_booking_mutations.sql:126`).

## What already works (and shapes this design)

Research before designing found the foundations are largely in place, which is why
this is an additive change rather than a rewrite:

- **`bookings.event_table_id` is already nullable**, and null already means "any
  table" — documented at `20260825000000_create_bookings.sql:9-10` and :85.
- **A tableless booking path already exists.** `seat_assignments`
  (`20260825010000:29-32, :56-63`) returns a null table when no table is preferred,
  and never consults capacity.
- **Check-in is already table-independent.** `check_ins` is keyed on
  `(event_id, profile_id)` with no booking or table reference at all
  (`20260827020000_create_check_ins.sql:7-11`), `record_attendance` never looks at a
  table, and the door screen already buckets tableless bookings into an "any table"
  group (`check-in.tsx:39-62`, rendered :666-669).
- **Event pricing already exists.** `fee_cents` and `min_spend_cents` are on both
  `events` and `event_series` (`20260903130000_event_fees.sql:14-20`) with UI in the
  edit screen. What has never existed is any per-player paid/unpaid state.

The single genuine blocker is that capacity has no source other than tables.

## Decisions

Settled during brainstorming, with the reasoning that produced them:

1. **Seating style is per-event, not per-club.** Asked how 60–70 player events
   actually seat people, the answer was "mixed — depends on the event": some are
   free-for-all, some the organizer assigns on the day, some rotate. The app must
   not assume one model.
2. **Capacity is the organizer's choice per event** — some events cap at venue
   size, others are open-ended. So capacity is nullable, and both paths are
   supported.
3. **Payment is a marker only.** No money moves through MahjHero. The organizer
   ticks people off; cash/Venmo/whatever is settled outside the app. This
   deliberately preserves the roadmap's indefinite deferral of billing
   (`docs/roadmap.md:62-63`) — no processing, no refunds, no disputes, no PCI scope.
4. **Paid status is organizer-only.** A player is never shown "unpaid", because the
   marker lags reality by design — money changes hands at the door, and the
   organizer may not have ticked them off yet. An accusatory lag is worse than no
   information.
5. **Group bookings survive open seating, and are shown to the organizer.**
   "Book a seat next to Jamie" loses its literal meaning with no tables, but a group
   still means *admit us together*. Since organizers sometimes assign tables on the
   day, "these four arrived together" is exactly the input they need.
6. **Open seating and payment tracking ship as one spec.** They are independent
   features — payment tracking is equally useful on a 3-table game — but they serve
   one story ("run a 70-person event") and both surface on the same screen, so
   designing them together avoids designing that screen twice.

## Data model

### Seating mode

- **`seating_mode` enum**: `'assigned_tables' | 'open_seating'`.
- **`events.seating_mode`** and **`event_series.seating_mode`**, both defaulting to
  `'assigned_tables'`. Seeded from the series at materialization and overridable per
  occurrence — the same shape `check_in_required` and `game_mode` already use, so
  the existing per-occurrence override machinery applies unchanged.
- **Backfill:** every existing row gets `'assigned_tables'`. No club sees any
  behavior change.

### Capacity

- **`events.capacity`** and **`event_series.capacity`**, `int null`.
- Resolution rules for `event_capacity()`:
  - `assigned_tables` → `sum(event_tables.capacity)`, exactly as today. The new
    column is ignored, so today's behavior is bit-for-bit preserved.
  - `open_seating` with `capacity` set → that number.
  - `open_seating` with `capacity` null → uncapped.
- `event_free_seats` keeps its current definition (`capacity − confirmed − held`)
  and its integer return type for the first two cases.
- **The uncapped case is expressed as a separate predicate, not as a magic value.**
  A new `event_is_capped(target_event) returns boolean` is added, and
  `plan_seating`'s gate (`20260825020000_booking_mutations.sql:126`) short-circuits:
  when the event is uncapped, the capacity check is skipped entirely and the booking
  proceeds as confirmed.
  Rejected alternatives: returning `null` from `event_free_seats` to mean unbounded
  relies on SQL's `null < n` evaluating to null and therefore falsy — correct by
  accident, unreadable, and it would silently change the meaning of every other
  caller of that function; a large sentinel integer can be confused with a real
  number in arithmetic. Every existing caller of `event_free_seats` must be audited
  during implementation to confirm none of them needs the uncapped branch too.

### Tables

- `create_event` accepts `table_count = 0`, but **only** when the event is
  `open_seating`; `assigned_tables` keeps the existing `>= 1` floor.
- `event_series.table_count`'s `check (table_count between 1 and 20)` becomes a
  table-level check permitting 0 when `seating_mode = 'open_seating'` (a table-level
  CHECK may reference both columns of the same row).
- `remove_event_table`'s "an event must keep at least one table" guard applies to
  `assigned_tables` only.
- Bookings on an open-seating event simply leave `event_table_id` null — the
  existing nullable column and existing tableless `seat_assignments` branch carry
  this with no new booking path.
- **Switching an existing event's mode is non-destructive.** Switching to
  `open_seating` does **not** delete `event_tables` rows or null out any booking's
  `event_table_id`; those rows are retained and simply ignored — capacity comes from
  the explicit field, and the seat-grid UI is hidden. Switching back to
  `assigned_tables` restores the previous view intact. Nothing in this design ever
  destroys seating data as a side effect of a toggle.
- Consequently an open-seating event **may** hold table rows (from a prior mode),
  but nothing in this design creates or displays them. Day-of table assignment
  tooling is explicitly out of scope, so no UI is added for managing tables while in
  open seating.

### Payment

- **New table `event_payments`**, deliberately mirroring `check_ins`:
  `(event_id, profile_id, paid_at timestamptz, marked_by uuid)`, uniquely keyed on
  `(event_id, profile_id)`.
- **Why not a column on `bookings`:** bookings are player-readable under existing
  RLS, and Postgres RLS cannot hide a single column without a view or column
  privileges. A dedicated table is what actually delivers decision 4. It also means
  payment survives a cancel-and-rebook, which is correct — the player already handed
  over cash, and a booking churn should not erase that.
- **`set_payment_status(target_event uuid, target_profile uuid, paid boolean)`** —
  a security-definer RPC gated on host/co-organizer, mirroring `record_attendance`'s
  permission shape. Setting `paid` false deletes the row rather than storing a
  false, so "no row" unambiguously means unpaid.
- **RLS:** host and co-organizers of the owning club may read and write; nobody else
  may read at all. This is the load-bearing rule of decision 4 and must be tested
  directly.
- Payment tracking applies to **every** event, not only open-seating ones.

## Behavior

- **Waitlist and promotion offers are untouched.** With an explicit capacity they
  work exactly as they do now, including group admission and the offer/accept
  countdown. With capacity null they simply never trigger, because the event is
  never full.
- **Check-in needs no changes at all** — it is already keyed on
  `(event_id, profile_id)`.
- **`check_in_required`** is expected to be on for these events, but stays an
  independent per-event flag; this design does not couple it to `seating_mode`.

## UI

### The door list — the screen this feature lives or dies on

Chosen from three mockups reviewed at real phone width. The selected direction
groups the roster **by status** — *Still to arrive* / *Here* / *Not coming* — each
with a count, above a sticky search field. At 68 people the list the organizer is
actively working through visibly shrinks as the evening goes on, and search still
gives the fast path when a specific person walks up.

Each row carries: name, group badge (when the booking is part of a group), the
amount owed (when the event charges a fee and the person is unpaid), a paid
toggle, and a "Here" action.

**Skill level is deliberately not on this row**, though the design originally
listed it. At 68 rows the door list is a scanning surface — the organizer is
looking for one name while somebody stands in front of them — and skill level
plays no part in either check-in or payment. It was implemented, then removed
during review as unrequested; this line records that the removal was the right
call rather than an omission, so nobody adds it back on the strength of an
older draft.

**Row-move behavior (the detail that decides whether this feels smooth).** Marking
someone here and marking them paid are one interaction in practice, so the row must
not run away between them:

- Tapping "Here" marks the row done but **holds its position**.
- The row slides into the *Here* section only after a settle window — **start at
  4 seconds** — which **any further tap on that row resets**, so *Here → paid* is one
  uninterrupted gesture on a stationary row.
- The move carries an **undo** affordance.
- The paid toggle is present in **both** sections, so marking paid later is never a
  dead end.

### Elsewhere

- **Hidden when `open_seating`:** the seat grid and `TableCard`
  (`app/clubs/[id]/events/[eventId]/index.tsx:883-894`, `components/SeatGrid.tsx`),
  the "need a 4th" card (`components/NeedAFourthCard.tsx` — there is no table to
  fill), and the "how many tables?" picker on create/edit
  (`app/clubs/[id]/events/new.tsx:394-410`, which also hardcodes "every table seats
  four").
- **Replaced when `open_seating`:** the event detail header currently reads
  "N tables · M seats"; it must read as a headcount instead (signed up, and the cap
  when there is one). The per-table seat grid is replaced by a plain roster.
- **New on create/edit when `open_seating`:** an optional capacity field, clearly
  optional so "leave blank for no limit" is discoverable.

## Out of scope

- Any movement of money: processing, collection, refunds, payouts, per-player
  amounts owed beyond displaying the event's existing `fee_cents`.
- Player-visible payment status of any kind.
- Automatic table assignment, day-of table assignment tooling, or rotation
  management. Organizers who assign on the day continue to do it on paper; this
  design only ensures the app does not fight them, and shows them who arrived
  together.
- Changes to waitlist, promotion-offer, or check-in mechanics.

## Verification

- **pgTAP:** capacity resolution across all three cases, including
  `event_is_capped` and a booking that would have been waitlisted under the old
  derived-capacity rule now confirming on an uncapped event; `table_count = 0`
  permitted only under `open_seating`; the `remove_event_table` guard still firing
  for `assigned_tables`; **the non-destructive mode switch** (toggle to
  `open_seating` and back, asserting `event_tables` rows and every booking's
  `event_table_id` are byte-identical afterwards); payment surviving a
  cancel-and-rebook; and — most importantly — **RLS proving a non-organizer club
  member cannot read `event_payments` at all**, since that is the whole of
  decision 4.
- **Schema contract + Vitest** for the data layer, following existing patterns.
- **Playwright visual:** the door list with a large roster at both 375px and 1440px,
  covering all three status sections.
- **One by-hand pass** with a 60+ name roster on a real phone at a real door. The
  settle-window behavior, and whether 4 seconds is right, cannot be proven by any
  automated test — it is a feel question and needs a human thumb.

## Open items

- The 4-second settle window is a starting value, to be confirmed or adjusted during
  the by-hand pass.
