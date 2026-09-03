# MahjHero Table Rounds — Design

**Date:** 2026-09-02
**Status:** Approved for implementation planning
**Parent spec:** [2026-08-01-mahjhero-v1-design.md](2026-08-01-mahjhero-v1-design.md) —
explicitly deferred scoring to V2; this is the first slice of that.

---

## Goal

A table plays several hands over the course of a game. Right now nothing in the app
remembers who won any of them. Give the people actually at a table — and the
organizer — a one-tap way to log "Jane won, 8 points" after each hand, see the log
and each player's running total, and optionally start a countdown so a hand does not
run long.

This is deliberately the smallest useful slice of the "scoring, leaderboards" V2 item
the parent spec named and deferred. Leaderboards, cross-game stats, and anything
club-wide are still out — this is a per-table log for the game in progress.

## Scope

### In

- A **round** record per table: one winner (a confirmed seated player at that table),
  their points (a positive whole number), who recorded it, when.
- Multiple rounds per table over one game — a running log, not a single result.
- Recording by **either** the table's organizer or any of that table's currently
  confirmed occupants.
- Recording restricted to while the game is **live**: started, not yet ended, not
  cancelled.
- A running per-player point total at the table, computed from the round log.
- Organizer-only **delete**. No edit; a mistake is deleted and re-recorded, keeping
  the log free of a second "what changed and who changed it" concern.
- A personal, per-table **round timer**: pick a duration, it counts down, it signals
  at zero. Client-side only, resets if you leave the table's screen.
- Visible to anyone who can already see the game screen (matches seating's own
  visibility — no new privacy tier).

### Out

| Item | Why |
|---|---|
| **Leaderboards, cross-game or cross-club stats** | The parent spec's original V2 item, still deferred. This spec only makes the raw record exist. |
| **Editing a recorded round** | Delete-and-re-record is simpler than an edit history, and disputes are rare enough not to need one. |
| **Timer persistence / sync across devices** | It is a pacing aid for whoever is looking at the screen, not a table-wide clock other players' phones need to agree on. |
| **Recording for a non-seated / non-club-member winner** | The winner pool is the table's own confirmed occupants, same as seating. |
| **Notifications about rounds** | Nothing about a logged round is time-sensitive or actionable by someone not already looking at the table. |
| **Offline queueing** | Same online-only stance plan 5 (check-in) took; no new infrastructure exists for it. |

## Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | Rounds, not a single result | A table plays multiple hands; one result per table would throw away everything but the last. |
| 2 | **Both** organizer and seated players can record | Neither role is reliably the one holding the phone at a casual table. |
| 3 | Winner must be a **confirmed seated occupant** of that table | Reuses the seating truth the screen already has; no second roster to reconcile. |
| 4 | Points: **positive whole number only** | Matches "how many points they won" literally; a negative or zero "win" is not a win. |
| 5 | **Organizer-only delete, no edit** | One correction mechanism, one role that can use it — mirrors check-in's "member self-serve, organizer corrects" split, simplified because there is no self-correction case here (a player can't un-record someone else's round anyway). |
| 6 | Recording only while the game is **live** | Matches the seating freeze's own logic (plan 4): a round belongs to the session that is actually happening, not to history being rewritten later or a game that hasn't started. |
| 7 | Running totals are **computed, not stored** | Same reasoning as `booking_groups` dropping `size` — a derived sum can't drift from the rows it sums. |
| 8 | Timer is **local UI state only** | Confirmed as a personal pacing aid, not a synced table clock — no backend, no persistence, resets on navigation. |

## Data model

### `table_rounds`

```sql
create table public.table_rounds (
  id                uuid primary key default gen_random_uuid(),
  event_table_id    uuid not null,
  event_id          uuid not null,
  club_id           uuid not null,
  winner_profile_id uuid not null references public.profiles(id),
  points            int not null check (points > 0),
  recorded_by       uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),

  foreign key (event_table_id, event_id)
    references public.event_tables (id, event_id) on delete cascade,
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade
);

create index table_rounds_table_idx on public.table_rounds (event_table_id, created_at);
```

Same denormalized-`club_id`-plus-composite-FK shape every club-scoped table in this
app uses (`bookings`, `check_ins`, `event_tables` itself) — a round whose club
disagrees with its table's or event's is unrepresentable, not merely unlikely.

No `round_number`. Order is `created_at`, the same call `booking_groups` made in
dropping a stored `waitlist_position`: a stored sequence number is a second source of
truth for something `created_at` already answers, and it would need renumbering on
delete, which this table explicitly allows (organizer deletes).

No `status`/`voided` column for a deleted round — deletion here is a hard delete, not
a soft one. Nothing downstream (no notification, no outbox row, no other table)
references a round by id, so there is nothing a hard delete could orphan.

### RLS and grants

`table_rounds` gets a **club-member select policy**: any active member of the round's
club can read it — the same audience that can already see the event screen and its
seating. No self-only restriction, unlike `check_ins`: this was the explicit call in
brainstorming ("anyone viewing the game screen").

`authenticated` gets **no DML on `table_rounds` at all**. Every write goes through the
two `security definer` functions below, and both get added to
`supabase/tests/database/portable/grants.test.sql`'s allowlist, in both directions,
same as every write path in this app.

## Write path

Two `security definer` functions, granted to `authenticated`:

```
record_round(target_table uuid, winner_profile uuid, target_points int) returns table_rounds

delete_round(target_round uuid) returns void
```

### `record_round` guard ladder

In order, matching plan 4/5's own ladder shape — tenancy first, then state, then the
role split:

1. **The caller is an active member of the table's club.** Fails first, before
   anything about the table or event is revealed, same reasoning `record_attendance`
   gives for checking tenancy before anything else.
2. **The event exists, is `published`, and is live**: `starts_at <= now() < ends_at`.
   A round cannot be logged for a game that hasn't started, has ended, or was
   cancelled. Raises with errcode `23514`, matching plan 4/5's `event already
   started`-style refusals so client error handling stays uniform.
3. **The caller is authorized to record at this table**: `is_club_organizer(club_id)`
   **or** the caller holds a `confirmed` booking at `target_table`. Neither role
   alone is sufficient by design (Decision 2).
4. **`winner_profile` currently holds a `confirmed` booking at `target_table`.** Read
   live from `bookings`, not cached — the same "ask the current state" pattern
   `place_booking` uses for its own seat checks. A winner who has since left the
   table (moved, or had their seat removed) cannot be recorded at it.
5. **`target_points > 0`.** Belt-and-suspenders alongside the column check
   constraint — the constraint is what actually stops a bad row; this raises the
   friendlier message.

Returns the inserted row so the client can append it optimistically without a full
reload, the same shape `commitBooking`'s result is used for.

### `delete_round` guard ladder

1. Tenancy: caller is an active member of the round's club.
2. **`is_club_organizer(club_id)` only.** Not the round's own recorder — Decision 5
   deliberately gives this to one role, not "whoever wrote it or the organizer" as
   check-in's edit/clear split does, because there is no self-correction case here: a
   player recording someone else's round has nothing of "their own" to undo, and
   giving every recorder delete rights over a shared, everybody-can-see-it log invites
   exactly the dispute this spec avoids by not offering edit at all.
3. No live-game requirement. An organizer fixing a mis-recorded round from earlier in
   the same session, or during the 24-hour tail pattern check-in already established
   for retroactive correction, is legitimate; unlike `record_round`, there is no
   "the game must still be happening" reason to refuse a delete once the mistake is
   noticed. (No timestamp tail is enforced here — see **Risks**, below.)

## Read path

Plain `select * from table_rounds where event_table_id = $1 order by created_at`,
scoped by the RLS policy above — no RPC needed, matching how the app already reads
`event_seating` results into `SeatOccupant[]` via a direct table read where RLS is
sufficient (`check_ins`/`event_attendance` needed a function only because that read
is organizer-gated with a hard "raise if not organizer" behavior; this read has no
such asymmetry).

`lib/rounds.ts` — typed wrapper, mirroring `lib/attendance.ts`'s shape:

```ts
export type TableRound = {
  id: string;
  event_table_id: string;
  winner_profile_id: string;
  points: number;
  recorded_by: string;
  created_at: string;
};

export async function fetchTableRounds(eventId: string): Promise<TableRound[] | null>
export async function recordRound(tableId: string, winnerProfileId: string, points: number): Promise<{ round: TableRound | null; error: string | null }>
export async function deleteRound(roundId: string): Promise<{ error: string | null }>

/** Sums points per winner, in first-seen order. Pure, no I/O — the running-totals line. */
export function roundTotals(rounds: TableRound[]): { profileId: string; points: number }[]
```

`fetchTableRounds` takes `eventId`, not per-table, and returns every round across the
event's tables in one query — the event screen already fetches per-event, and
`TableCard` filters to its own `event_table_id` client-side, the same pattern
`seating`/`tableOccupants` already use one component up.

## Screens

### `components/TableCard.tsx`

New content, gated the same way the rest of the card's organizer/member split already
is:

- **Round log**: newest first, `{winner display name} · {points} pts`. Needs display
  names, so the event screen resolves `winner_profile_id`/`recorded_by` against the
  roster it already fetches (`fetchRoster`), the same join `seating` already gets —
  `TableCard` takes rounds pre-joined, not raw ids, keeping the roster lookup in one
  place.
- **Running totals** line above the log, from `roundTotals`.
- **"Record a round" control** — a winner picker scoped to the table's currently
  confirmed occupants (reuses the same list `SeatGrid` already renders for this
  table) plus a numeric points field — shown only when `canRecordRound`: the event is
  live (mirrors `canBook`'s inverse — started, not ended, not cancelled) **and**
  (`isOrganizer` **or** the signed-in member is one of this table's confirmed
  occupants).
- **Delete** affordance per round row, organizer-only.
- **Round timer**: "Start timer" → a duration picker → countdown text → a visual
  (and, if the app has an existing haptic/sound convention, that too — confirm during
  planning) signal at zero. Local `useState`/`setInterval` inside `TableCard`, keyed
  so it resets if `table.id` changes; no prop threading up to the event screen, since
  nothing outside this card needs to know about it.

`TableCard` is 171 lines today; this adds a genuinely new concern (round
recording/display, separate from seating) rather than growing the existing seat
grid, so it is worth asking during planning whether the round log should be its own
small component (`components/RoundLog.tsx`) rendered into `TableCard`, the same way
`SeatGrid` already is — keeping `TableCard` itself from becoming the seating file's
own "did too much" problem.

### `app/clubs/[id]/events/[eventId]/index.tsx`

One addition: `fetchTableRounds(eventId)` joins the screen's existing `Promise.all`
load, alongside `fetchEventSeating`/`fetchEventTables`. Failure degrades only the
rounds section (same `xFailed` pattern as `tablesFailed`/`seatingFailed`) — a failed
rounds fetch must not read as "no rounds have been played."

## Error handling

- **Guard failures are database refusals** (errcode `23514`), not merely hidden
  controls — same split check-in/booking already draw between "the client hides the
  button" and "the server is the actual authority."
- **A failed rounds fetch degrades only its own section**, following
  `tablesFailed`/`seatingFailed`'s established pattern on this exact screen.
- **`record_round`'s winner-still-seated check** means a stale client (someone who
  moved tables in another tab a second ago) gets a clean refusal rather than a
  silently wrong row.

## Testing

| Suite | Covers |
|---|---|
| `fixtures/table_rounds.test.sql` | Full guard ladder for both functions: tenancy refusal, live-game window (not started / already ended / cancelled all refused), the organizer-or-seated-occupant authorization split, winner-not-seated refusal, non-positive points refusal, delete organizer-only refusal. |
| `fixtures/table_rounds_rls.test.sql` | Any active club member can `select`; a member of a different club cannot; `authenticated` has no DML and no TRUNCATE on `table_rounds`. |
| `portable/grants.test.sql` | `record_round`/`delete_round` added to the allowlist, both directions. |
| `lib/rounds.test.ts` | `roundTotals`, and the two RPC wrappers against the local stack (`lib/schema-contract.test.ts`-style signature check). |
| Vitest + component tests | `TableCard`'s new round log, record control (visible/hidden per role and per live-game state), delete affordance, and timer countdown/expiry behavior. |
| `e2e/visual.spec.ts` | Baseline for a table card with rounds recorded, at both widths. |

## Risks and open items

1. **No time tail on `delete_round`.** Check-in gave organizer writes a 24-hour tail
   specifically to bound retroactive correction; this spec gives the organizer
   unbounded delete on any round, ever. Accepted for a first slice — a round log has
   no downstream consequence (no seat freed, no notification sent) the way attendance
   does, so an unbounded delete costs less here. Worth revisiting if this table ever
   grows a "history" surface where old, silently-deleted rounds would be missed.
2. **A table with zero confirmed occupants can never have a round recorded** (the
   winner-seated check has nothing to satisfy). This is correct, not a bug, but is
   worth a specific empty-state string ("Seat players before recording a round") so it
   does not read as the feature being broken.
3. **Running totals are table-scoped, not event-scoped.** A player who moves tables
   mid-game has separate totals per table they sat at, not one combined number. This
   matches Decision 3 (winner must be seated *at that table*) and was not raised as a
   problem during brainstorming, but is worth confirming reads correctly once there is
   a real multi-table game to look at.
