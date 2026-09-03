# MahjHero Seat Placement During a Live Game — Design

**Date:** 2026-09-03
**Status:** Approved for implementation planning

---

## Goal

A member who books "any table" and never gets assigned a seat before kickoff is currently stuck for the rest of the game — permanently. `place_booking` refuses every placement and every table-to-table move the instant `starts_at` passes, for anyone, including the host standing at the door with an obviously-open seat in front of them. This was found live: a confirmed, unplaced booking on a started game with an open seat at its only table, refused with `event already started` when the member tried to seat themselves.

The fix narrows that freeze to what it actually needs to protect.

## Root cause

`place_booking` (`supabase/migrations/20260825030000_booking_cancellation.sql:291-294`) refuses unconditionally once `ev.starts_at <= now()`. Traced the reason this exists: every successful placement calls `promote_waitlist(bk.event_id)` afterward, because moving someone off a table frees a seat a waitlisted group might now fit in — and `promote_waitlist` mid-game, filling a seat with someone who "left home an hour ago" (the check-in design's own words), is the actual risk the freeze was built to prevent.

But `promote_waitlist` **already refuses to run once `starts_at <= now()`, on its own** (`supabase/migrations/20260825010000_waitlist_promotion.sql:228`: `if ev.id is null or ev.status <> 'published' or ev.starts_at <= now() then return; end if;`). The protection this design cared about does not live in `place_booking` at all — it lives independently in `promote_waitlist`, and fires regardless of what triggered the call. `place_booking`'s own freeze is therefore stricter than the actual risk requires: it blocks every placement, including the completely safe case of filling an already-confirmed, already-committed member into an open seat with nobody waiting to be bumped.

## Scope

### In

- `place_booking` allows placement and table-to-table moves through the whole live game (`starts_at <= now() < ends_at`), refusing only once the game has actually ended.
- Applies identically to self-placement and organizer-placement — `place_booking` already splits permission that way (`bk.profile_id = caller or is_club_organizer(bk.club_id)`); this removes a time restriction, not a permission one.
- Applies to both directions: an unplaced ("any table") confirmed booking getting its first table, and an already-seated booking moving to a different table.
- A member's own self-service placement (tapping an empty seat when they already hold a confirmed booking elsewhere or unplaced) becomes available through the same live-game window, not just before kickoff.

### Out

| Item | Why |
|---|---|
| **`cancel_booking`/`decline_booking`/`cancel_booking_group`** (giving up a seat) | This is the genuinely risky case the original design targeted — freeing a seat mid-game that nobody physically present can use. Untouched; still frozen at kickoff. |
| **Creating a brand-new booking after kickoff** (`commit_booking`/`propose_booking`) | A different question from placing an *already-confirmed* member — not what was asked, not touched. `assert_event_bookable`'s own `starts_at` guard is unchanged. |
| **A tail after the game ends** | Confirmed during brainstorming: matches the table-rounds feature's own live-game window (`starts_at <= now() < ends_at`), and nothing downstream needs a seat assignment once the game is over — round recording and check-in's own write windows both end at (or before) `ends_at` too. |
| **Any change to `promote_waitlist` itself** | It already correctly self-guards; this fix relies on that guard, it doesn't touch it. |

## Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | Both self and organizer placement | `place_booking`'s existing permission split already covers this; only the time guard changes. |
| 2 | Both first-time placement AND table-to-table moves | Verified safe: the waitlist-promotion risk that motivated the original freeze is independently guarded inside `promote_waitlist`, regardless of which kind of move triggers it. |
| 3 | Window is `starts_at <= now() < ends_at`, no tail | Matches table-rounds' `assert_round_writable` window; nothing past `ends_at` needs a seat assignment. |

## Data model changes

No new table, no new function. One existing function's guard changes.

### `place_booking` — guard change

`supabase/migrations/20260825030000_booking_cancellation.sql`. The event lookup (line 291, currently `select id, starts_at into ev from public.events where id = bk.event_id;`) needs `ends_at` too:

```sql
select id, starts_at, ends_at into ev from public.events where id = bk.event_id;
```

And the guard (lines 292-294, currently):

```sql
if ev.starts_at <= now() then
  raise exception 'event already started' using errcode = '23514';
end if;
```

becomes:

```sql
if ev.ends_at <= now() then
  raise exception 'this game has already ended' using errcode = '23514';
end if;
```

Everything else in the function — the composite lookup, `table_free_seats` re-check under lock, the `promote_waitlist` call at the end — is untouched. `promote_waitlist` firing after a live-game move is safe exactly because of its own independent `starts_at`-based no-op, described above.

### Client-side refusal copy

`lib/bookings.ts`'s `BOOKING_REFUSALS`. `'this game has already ended'` is a new message on this branch (the identical string exists in a different, not-yet-merged branch's own migration for an unrelated function — this is a coincidence of matching wording, not a shared code path; if both branches merge, the two mappings converge to the same harmless, redundant entry, worth a quick dedup pass at that point but not a blocker for either branch alone). Maps to: `"This game has already ended."` — codes: `['23514']`.

Note: `'event already started'` — the OLD message this replaces — stays in `BOOKING_REFUSALS` unchanged. Every OTHER function that raises it (`cancel_booking`, `decline_booking`, `commit_booking`, `propose_booking`, `assert_event_bookable`, etc.) still does, and still should; only `place_booking` stops raising it.

## Screens

### `app/clubs/[id]/events/[eventId]/index.tsx`

One new boolean, alongside the existing `canBook`:

```ts
// A member's own already-confirmed booking can be placed or moved through
// the whole live game, not just before kickoff -- place_booking's own guard
// now only refuses once the game has ended (20260825030000_booking_
// cancellation.sql). Deliberately separate from `canBook`, which still
// gates a BRAND NEW booking: creating a fresh seat is untouched by this fix
// and stays frozen at kickoff.
const canManageOwnSeat =
  event.status === 'published' && new Date(event.ends_at) > now;
```

`onTakeSeat`'s gate (currently `canBook && (!myBooking || (myBooking.status === 'confirmed' && myBooking.event_table_id !== table.id))`) branches on which case a tap would produce:

```ts
onTakeSeat={
  (myBooking && myBooking.status === 'confirmed'
    ? canManageOwnSeat
    : canBook) &&
  (!myBooking ||
    (myBooking.status === 'confirmed' &&
      myBooking.event_table_id !== table.id))
    ? () => takeSeat(table)
    : undefined
}
```

A tap that would create a fresh booking (no `myBooking`, or one that's only waitlisted) still requires `canBook` — unchanged. A tap that would move an existing confirmed booking uses `canManageOwnSeat` instead — available through the live game.

**No other UI change is needed.** The organizer's two placement controls — `WaitlistPanel`'s "Seat at …" (for a confirmed-but-unplaced booking) and `SeatGrid`'s "Move to …" (an occupied seat's own tap panel) — already render with no time-based gate at all (`isOrganizer` alone), so they start succeeding the moment the server allows it, with no client change required. `onLeaveSeat` stays gated on `canBook` exactly as today — giving up a seat is out of scope, per the design above.

## Error handling

- The refusal is a database decision (errcode `23514`), not merely a hidden button — the client's `canManageOwnSeat` only decides whether to draw a control; the server is still the authority once `ends_at` actually passes.
- `WaitlistPanel`'s and `SeatGrid`'s organizer controls are not time-gated on the client at all (before or after this fix) — an organizer attempting one after the game has fully ended gets the new, mapped `'this game has already ended'` refusal rather than a silent failure or a stale generic message.

## Testing

| Suite | Covers |
|---|---|
| `supabase/tests/database/fixtures/bookings_cancellation.test.sql` (extends `place_booking`'s existing coverage there) | A confirmed, unplaced booking can be placed onto a table on a LIVE (started, not ended) event — this is the exact case that was broken. A confirmed booking can be MOVED table-to-table on a live event. Placement is refused once `ends_at` has passed, with the new message. `promote_waitlist`'s own no-op is exercised end-to-end: a waitlisted group behind a live-game move does NOT get promoted (proving the safety argument in "Root cause" holds under a real placement, not just by inspection). |
| `lib/bookings.test.ts` | The new `BOOKING_REFUSALS` entry, and the self-audit's continued coverage of every raise site (a global test, not new — just needs to keep passing). |
| `app/__tests__/events-detail.test.tsx` | `onTakeSeat`'s new split gating: a member with a confirmed, unplaced booking on a live (started, not ended) event can tap an empty seat and it moves them; a member with no booking at all on that same live event gets no tappable seat (fresh booking still frozen). |

## Risks and open items

1. **Cross-branch message duplication**, noted above under "Client-side refusal copy" — cosmetic, resolves itself (or gets a one-line dedup) whenever both branches eventually share a `main`.
2. **Organizer controls have no post-`ends_at` client gate**, before or after this fix — not a regression this change introduces, but worth a follow-up if it ever proves confusing in practice (a host tapping "Move to …" on a long-finished game and getting a refusal rather than not seeing the button at all).
