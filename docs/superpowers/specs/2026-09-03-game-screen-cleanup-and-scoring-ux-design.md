# MahjHero Game Screen Cleanup & Scoring UX — Design

**Date:** 2026-09-03
**Status:** Approved for implementation planning

---

## Goal

A round of feedback on the game (event detail) screen after using the newly-shipped scoring feature: the screen is cluttered with per-table setup that belongs on the edit screen, missing basic context (which club is this?), stating the obvious ("3 seats free"), and — the biggest piece — the round-recording flow itself is clunkier than it needs to be. This redesigns recording around the seat tiles themselves: tap a seat, record that person's win, done — no separate winner picker, no free-text points field, and the running score lives on the tile instead of a separate row.

## Scope

### In

1. **Move the per-table skill-level picker off the game screen**, onto the edit-game screen.
2. **Show the club name** at the top of the game screen.
3. **Drop "N seats free"** — the seat grid already shows this visually.
4. **Combine the tier label onto the table's own heading line** (currently two lines: table name, then tier).
5. **Visually highlight the Rounds section** so it reads as a distinct block, not more body text.
6. **A full-screen overlay for the running round timer**, toggled by tapping the countdown.
7. **Points are one of exactly seven fixed values** — 25 / 30 / 35 / 40 / 45 / 50 / 75 — enforced client and server side, replacing free-text entry.
8. **Recording moves into the existing seat-tap panel.** No separate winner picker or points field: tap a seat, that panel gains a "Record a win" option that reveals the seven point values as one-tap chips.
9. **Running totals move into the seat tiles themselves**, replacing the separate totals line: a plain round badge with the player's point total, becoming a star for whoever is currently leading at that table (ties share the star).
10. **Fix the seat-management panel's contrast**, found while touching it for (8) — the current combination is hard to read against at least the "your own seat" background.

### Out

| Item | Why |
|---|---|
| **Letting a seated (non-organizer) member record someone else's win** | Confirmed during brainstorming: stays exactly as today's seat-panel access rule already works — a plain member can only open their own seat's panel. Recording someone else's win needs either that person doing it themselves or an organizer. Extending panel access to any seated player for any seat is a separate, larger change not requested here. |
| **Add a table / Remove this table** | Stay on the game screen. These are live-capacity actions tied to who is seated right now, not really "editing" — moving them alongside the tier picker would strand a host mid-seating. |
| **Any points value outside the fixed seven** | Confirmed as a hard rule, not just a shortcut set — no free-text fallback anywhere, client or server. |
| **Timer state changing in any way** | The overlay is a pure display toggle. Nothing about what the timer tracks, persists, or resets changes — see the original round-timer design's own "local UI state only" decision, untouched here. |

## Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | Recording lives in the **existing seat-tap panel**, not a new UI surface | Reuses a gesture members already know; the panel is already scoped to exactly one person, which is also exactly what a round-winner needs to be. |
| 2 | Points are **25/30/35/40/45/50/75, and only those**, enforced server-side too | Matches the club's actual scoring; a hard rule removes an entire class of "what did you mean by 42" ambiguity. |
| 3 | **A member can only record their own win**; unchanged from today's panel-access rule | Simplest option; extending cross-member access is real, separate scope. |
| 4 | **Totals move into the seat tile**, replacing the separate row; **leader(s) get a star, ties included** | Confirmed via mockup — see "Seat tile layout" below for the exact locked visual. |
| 5 | **Add/Remove table stay on the game screen**; only the tier picker moves to Edit | The former are live operations, the latter is setup. |

## Seat tile layout (locked via mockup)

Every occupied seat tile keeps its name as today. Alongside it, a fixed-size (40×40) badge:

- **No badge at all** if that person has never won a round at this table (identical to today's plain tile).
- **A plain round (circular) badge**, filled with the accent colour, showing their point total, if they've won at least one round but are not currently the leader.
- **A star-shaped badge** (same 40×40 footprint, same position), showing their point total, if they are the current leader — the highest total among anyone with at least one recorded round at that table. **Ties: everyone tied for the lead gets the star**, not just the first to reach it.

The badge sits at the tile's trailing edge, vertically centred, matching the tile's own height rather than floating as a small corner overlay — confirmed against the actual app colours (`colors.accentColor` for the round badge, `colors.accent[400]` for the star fill, `colors.accent[900]`-ish ink for the number) in the brainstorming mockup.

Recomputed from `rounds` on every render (via `roundTotals`, already in `lib/rounds.ts`) — not stored, matching the running-totals principle the original scoring design already established. No change to `lib/rounds.ts` itself; this is a rendering change to how `TableCard`/`SeatGrid` consume the same data `RoundLog` already receives.

## Recording flow (replaces the current picker + text field)

**Today:** `RoundLog` renders its own winner-picker (a row of name pills) and a free-text `TextField` for points, gated on `canRecord`.

**New:** that form is deleted from `RoundLog` entirely. Recording happens through the seat's own tap panel (`SeatGrid`'s existing Move/Remove/Leave panel):

- The panel that opens for a given occupied seat is already scoped to exactly one person (the organizer's Move/Remove panel for that seat, or the member's own "Leave this game" panel) — so **no winner-selection step is needed at all**. The person whose seat you opened is the person being recorded.
- That panel gains a **"Record a win"** control. Tapping it reveals the seven fixed point values (25/30/35/40/45/50/75) as one-tap chips, replacing (or added below) the panel's existing action(s).
- Tapping a chip calls the existing `record_round` RPC (via `lib/rounds.ts`'s `recordRound`, already wired to the event screen's `recordTableRound`) with that seat's `profile_id` and the tapped value, then closes the panel — same shape as every other seat-panel action (`Move to …`, `Remove from game`, `Leave this game`) already closing on completion.
- Gated on the SAME `canRecordRound` the screen already computes per table (`gameLive && (isOrganizer || iAmSeatedHere)`) — nothing about eligibility changes, only where the control lives. An organizer sees "Record a win" on every occupied seat's panel (since they can already open any of them); a plain member sees it only on their own seat's panel (since that is the only one they can open) — consistent with Decision 3.

`RoundLog` itself becomes read-only: the round-by-round list (winner name, points, organizer-only Delete) stays exactly as it is today. Its own totals line and its own record form are both removed — the totals line because the data now lives on the tiles (Decision 4), the form because recording now happens through the seat panel (Decision 1).

## Data model changes

### Points become a fixed set

`supabase/migrations/20260902070000_table_rounds_mutations.sql`'s `record_round` currently raises `'points must be greater than zero'` for `target_points <= 0`. A new migration changes this to reject anything outside the fixed set:

```sql
if target_points not in (25, 30, 35, 40, 45, 50, 75) then
  raise exception 'points must be 25, 30, 35, 40, 45, 50, or 75' using errcode = '23514';
end if;
```

And `table_rounds`' own check constraint (`supabase/migrations/20260902060000_create_table_rounds.sql:22`, `check (points > 0)`) — already live on the hosted database — needs an `alter table` in the same new migration to match, so the constraint stays the real backstop rather than the RPC's raise being the only thing enforcing it:

```sql
alter table public.table_rounds
  drop constraint table_rounds_points_check,
  add constraint table_rounds_points_check check (points in (25, 30, 35, 40, 45, 50, 75));
```

Confirmed against the live hosted schema (`select conname from pg_constraint where conrelid = 'public.table_rounds'::regclass and contype = 'c'`): the auto-generated name really is `table_rounds_points_check`, matching above.

Client-side refusal copy (`lib/bookings.ts`'s `BOOKING_REFUSALS`) gains an entry mapping the new message to friendly copy, following the same self-audited pattern every other refusal in this codebase already uses.

## Screens

### `components/RoundLog.tsx`

Loses its winner-picker and points `TextField` entirely, along with the `selectedWinner`/`pointsText` local state and the totals-line rendering. Keeps: the round-by-round list, organizer-only Delete. `canRecord` is no longer consumed by this component at all (recording moved elsewhere) — `TableCard` stops passing it here; whether `canRecordRound` still needs to reach `TableCard` at all depends on whether `SeatGrid` needs it directly (it does, for the new panel control) or `TableCard` gates the prop before forwarding.

Gains a visual treatment for the "Rounds" heading/section — a tinted `Card` (this app's `Card` component already accepts a `background` prop; use the same accent-tint family `Tag`'s `accent` variant already draws from, e.g. `colors.accent[100]`) so the section reads as a distinct block against the rest of the table card, addressing item 5.

### `components/SeatGrid.tsx`

The organizer's and the self-manage panel both gain a new "Record a win" affordance, revealing the seven point chips on tap, wired to a new prop (exact shape decided during planning — likely a `canRecordRound: boolean` alongside a `points: number | null` / `isLeader: boolean` per seat for the tile badge, and an `onRecordRound: (profileId: string, points: number) => void` callback). Needs each `Seat` to carry its `profileId` (currently only `bookingId`/`name`/`isYou`), since `record_round` takes a winner's profile id, not a booking id.

Also where item 10 (panel contrast) gets fixed — the exact colour combination will be confirmed against a real screenshot during implementation rather than guessed here, but the requirement is: every button/text inside an open seat panel must clear this app's existing contrast bar against BOTH backgrounds a panel can sit on (`seatYou`'s `accent2Color` olive, and the plain `neutral[300]` for anyone else's seat).

### `components/TableCard.tsx`

- Drops the `TierPicker`/`SkillTierPips` row entirely (moves to Edit — see below). Keeps "Remove this table" and "Call for a 4th now" (Add a table stays screen-level, unaffected).
- Drops the `seatsFreeLabel` text (item 3).
- Combines the table's label and tier onto one line (item 4) — the tier pips + word move up next to `table.label` instead of their own row below it.
- Computes each seated occupant's badge state (`points`/`isLeader`) from `rounds` via `roundTotals`, threading it into `SeatGrid`'s per-seat data instead of (or alongside) rendering `RoundLog`'s now-removed totals line.

### `app/clubs/[id]/events/[eventId]/index.tsx`

- Adds the club name near the event title (item 2) — `club.name` is already loaded on this screen, just not shown.
- No longer renders a `TierPicker` per table (moved to Edit).
- Still computes and passes `canRecordRound`/`onRecordRound` per table exactly as today — only where they're consumed downstream changes (`SeatGrid` instead of `RoundLog`).

### `app/clubs/[id]/events/[eventId]/edit.tsx`

Gains a new "Tables" section: fetches this event's tables (`fetchEventTables`, already used elsewhere) and renders one `TierPicker` per table, calling the existing `updateEventTable(table.id, { tier })` RPC — no new RPC, this is the same call the game screen already makes, just from a different screen. Table add/remove stay off this screen per the Out list.

### `components/RoundTimer.tsx`

Once running, tapping the countdown text opens a full-screen overlay (a `Modal` or equivalent) showing the same countdown at a much larger size, readable from across a room; tapping it again (or a close control) returns to the normal inline view. The timer's own `durationMinutes`/`secondsLeft` state is untouched by this — it is a display-only toggle layered on top of the existing countdown, not a new timer.

## Testing

| Suite | Covers |
|---|---|
| `supabase/tests/database/fixtures/table_rounds_mutations.test.sql` | Extended: `record_round` accepts each of the seven values, refuses anything else (0, negative, and a plausible-but-wrong value like 20 or 100), with the new message. |
| `lib/bookings.test.ts` | The new refusal's client-side mapping, via the existing self-audit. |
| `components/__tests__/RoundLog.test.tsx` | Rewritten: no more picker/points-field tests (removed along with the code); keeps list rendering and organizer-only Delete. |
| `components/__tests__/SeatGrid.test.tsx` | New: the "Record a win" control appears only when eligible, reveals exactly the seven chips, calls through with the right profile id and points, and closes the panel on success — mirroring the existing Move/Remove/Leave test shape. |
| `components/__tests__/TableCard.test.tsx` | Updated: no more `TierPicker`/seats-free-text assertions; new assertions for the tile badge (none/round/star) at various total-points combinations, including a tie. |
| `components/__tests__/RoundTimer.test.tsx` | New: the full-screen overlay opens on tap while running, closes on tap/close, and the underlying countdown value is unaffected by opening or closing it. |
| `app/__tests__/events-detail.test.tsx` | Club name renders; no `TierPicker` on this screen anymore. |
| `app/__tests__/events-edit.test.tsx` (or equivalent) | The new Tables section renders one `TierPicker` per table and calls `updateEventTable` correctly. |
| `e2e/visual.spec.ts` | New/updated baselines: the cleaned-up game screen, a seat tile with a round badge and with a star, the open seat panel with "Record a win" and legible contrast, and the full-screen timer overlay. |

## Risks and open items

1. **`SeatGrid`'s exact new prop shape** is deliberately left to the planning stage rather than fixed here — the component already has a wide prop surface (see its own docstring), and the plan should choose whichever shape composes cleanly with what's already there rather than this spec dictating component internals prematurely.
2. **The panel contrast fix (item 10) has no prescribed colour values** — the actual fix depends on seeing the real rendered issue, not guessed here. The plan/implementation should take a screenshot of the current state first, then confirm the fix visually rather than by inspection alone.
