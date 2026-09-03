# MahjHero Organizer Visibility for Unbooked Games — Design

**Date:** 2026-09-03
**Status:** Approved for implementation planning

---

## Goal

An organizer who creates a game but never books themselves a seat at it currently loses all access to that game the instant it starts. It vanishes from the home page — not degraded, not hidden behind a toggle, just gone — with no check-in control and (as of the table-rounds feature) no way to record scores, because the only route to either is through the event screen and the only route to the event screen was this list.

This was found live: a host created two test games, never booked a seat at either, and watched both disappear from `/clubs` at kickoff. A third game they had booked stayed visible, confirming the gap is specifically "organizer, no personal booking, game in progress."

## Scope

### In

- A new row on the `/clubs` dashboard for an event that is **currently in progress** (`starts_at <= now < ends_at`), **published**, where the viewer **organizes the event's club** (host or co-organizer) and **holds no live booking** at it.
- The row is a plain, always-tappable link into the event screen — same date tile / title / venue treatment every other row already has — carrying a "Hosting" tag instead of "Seated" or a Join button. No seat action is offered, because booking is frozen the moment a game starts anyway ([`assert_event_bookable`](../../supabase/migrations/20260825020000_booking_mutations.sql) already refuses it).

### Out

| Item | Why |
|---|---|
| **Future (not-yet-started) organized games** | Already visible today as an open, joinable row — `fetchUpcomingEvents` already returns them and `buildDashboardRows` already lists them. Not part of the gap. |
| **Past (already-ended) organized games** | Confirmed out of scope during brainstorming — this fixes the "I can't reach my own live game" pain, not a durable "games I've ever run" archive. `ends_at` is exactly where every other "still relevant" rule in this app already draws the same line (`my_upcoming_bookings`, `assert_round_writable`). |
| **A "take a seat" affordance on the new row** | Deliberately refused during brainstorming — booking is frozen once a game starts, so offering one would be a button whose only outcome is a refusal, the same reasoning `BookingSeatControls` already applies to its own `notStarted` gate. |
| **Any change to who counts as "organizer"** | Reuses `canInvite` (host or co-organizer) unchanged — the same predicate every other organizer-only affordance in this codebase already uses. Not re-litigated. |

## Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope is **in-progress only**, not future+in-progress or unbounded | Future games already have a visibility path (joinable rows); past games are a different, unrequested feature (a "games I've run" archive). This is the minimal fix for the actual gap. |
| 2 | The row is **read-only navigation, no seat action** | Confirmed explicitly: a Join-style button would fail the instant it's tapped, since seating is frozen post-kickoff. |
| 3 | Organizer definition reuses **`canInvite`** (host/co-organizer) | Standing convention across this codebase; not a new role concept. |

## Root cause

`/clubs`'s game list has exactly two sources, merged by `buildDashboardRows` (`lib/dashboard.ts`):

1. **`my_upcoming_bookings()`** — every event where the viewer holds a live (confirmed/waitlisted) booking, kept visible through `ends_at` (fixed by `20260827070000_my_upcoming_bookings_check_in.sql`, specifically so a member has somewhere to check in after kickoff).
2. **`fetchUpcomingEvents(clubId)`** (`lib/events.ts`) — every published event with `starts_at >= now()`, merged in as a "joinable" row for anyone not already covered by source 1.

Neither source has ever covered "an event I organize but hold no booking at." Before kickoff this was invisible only in principle — such an event still shows up via source 2, since it has a free seat and the organizer isn't seated at it. The moment `starts_at` passes, source 2's own filter drops it, and source 1 never had it. Result: total disappearance, verified directly against the hosted database (two organizer-created, self-unbooked games vanished at their `starts_at`; a third the same organizer had booked stayed visible throughout).

## Data model / read path changes

No schema change. Two existing read paths change shape, one new one is added.

### `fetchUpcomingEvents` — filter widens

`lib/events.ts`. Change `.gte('starts_at', new Date().toISOString())` to `.gte('ends_at', new Date().toISOString())` — the same "relevant until it ends" rule `my_upcoming_bookings` and `record_round`'s `assert_round_writable` already apply. One call site (`app/clubs/index.tsx`), feeding both `buildDashboardRows` and `needAFourthAlerts`.

**Confirmed safe for `needAFourthAlerts`:** `needsAFourth` (`lib/bookings.ts`) already requires `until > 0` (`startsAt.getTime() - now.getTime()`), i.e. it refuses to fire for a table whose event has already started. Widening the upstream fetch cannot produce a spurious "needs a 4th" alert for an in-progress game — that function self-gates on exactly the timing this change touches.

The doc comment on this function's own docstring, and the one at `app/clubs/[id]/events/new.tsx:173` describing it as "filters `starts_at >= now()`", both need updating to match.

### New: `fetchMyRoles(userId)`

`lib/clubs.ts`. A plain, RLS-scoped read — no new RPC needed:

```ts
export async function fetchMyRoles(
  userId: string,
): Promise<{ club_id: string; role: ClubRole }[] | null> {
  const { data, error } = await supabase
    .from('club_members')
    .select('club_id, role')
    .eq('profile_id', userId)
    .eq('status', 'active');
  ...
}
```

`club_members_select_member`'s existing policy (`is_club_member(club_id)`, `20260822033527_create_clubs.sql`) already permits a member reading their own row — this is not a new grant, just a query the dashboard has never issued before. The dashboard currently fetches clubs (`fetchMyClubs`) with no role information at all; this is the first time it needs to know the viewer's own role per club.

### `buildDashboardRows` — third row category

`lib/dashboard.ts`. New parameter, `organizerClubIds: Set<string>` (derived from `fetchMyRoles` filtered through `canInvite`). Inside the existing loop over `input.events`, after the current `viewerIsIn`/dedup checks, a new branch:

```ts
const inProgress =
  new Date(event.starts_at).getTime() <= now.getTime() &&
  new Date(event.ends_at).getTime() > now.getTime();

if (inProgress && organizerClubIds.has(event.club_id)) {
  // push a row: booking: null, joinable: false, organizing: true
} else if (!inProgress && hasFreeSeat(event)) {
  // existing joinable branch, unchanged
}
```

`DashboardRow` gains one field: `organizing: boolean` (default `false` for every existing row shape — bookings-derived rows and joinable rows are both unaffected).

## Screens

### `app/clubs/index.tsx`

- `load()` gains one more call: `fetchMyRoles(userId)`, alongside the existing `fetchMyClubs`/`fetchMyUpcomingBookings`/per-club `fetchUpcomingEvents` calls. Degrades independently, matching the screen's own established pattern (a failed roles fetch means no organizing rows appear — no crash, no stale error banner over the rest of the screen — the same treatment `bookingsFailed`/other per-section failures already get).
- `GameRow` (the shared row renderer) gains a third branch in its trailing-action slot: `row.organizing ? <Tag variant="accent">Hosting</Tag> : ...` — same visual slot the "Seated" tag already occupies, no new layout.
- No change to `BookingSeatControls` — it is never rendered for an organizing row (`booking === null`), exactly like a joinable row today.

## Error handling

- A failed `fetchMyRoles` degrades only the organizing-row feature — every other section of the dashboard (clubs, bookings, joinable events, alerts) renders exactly as it does today. Matches the screen's existing per-section failure isolation.
- No new write path exists in this change — it is read-only, so there is no new refusal vocabulary to map.

## Testing

| Suite | Covers |
|---|---|
| `lib/dashboard.test.ts` | `buildDashboardRows`: an organizing row appears for an in-progress, unbooked, organized event; does NOT appear for a plain member of the same club; does NOT appear before `starts_at` or after `ends_at`; does NOT appear if the viewer already holds a booking there (booking wins, matching the existing de-dup rule). |
| `lib/clubs.test.ts` | `fetchMyRoles` unit test (mocked Supabase chain), matching the existing pattern for other plain-select reads in that file. |
| `app/__tests__/clubs.test.tsx` | The "Hosting" tag renders for an organizing row and no Join button is offered; tapping the row still navigates to the event screen. |

## Risks and open items

1. **A host who never books a seat still can't manage seating from this row** — by design (Out-of-scope item 3). This fix restores *navigation*, not a new capability; once on the event screen, existing organizer controls (table management, door list, round recording) already work regardless of whether the organizer holds a seat.
2. **`fetchUpcomingEvents`'s widened filter changes `needAFourthAlerts`'s input set**, confirmed safe above but worth re-confirming visually once implemented — an in-progress table one seat short should still correctly show no alert (the function's own `until > 0` gate), not a false positive.
