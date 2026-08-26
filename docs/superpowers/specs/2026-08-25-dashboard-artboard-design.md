# Dashboard — bringing `app/clubs/index.tsx` to the `1C club` artboard

Date: 2026-08-25
Branch: `feat/dashboard-artboard` (stacked on `feat/check-in`, not `main` — see Branching)

## Problem

The dashboard does not look like the design. The design has not moved: the
canvas pulled from the Claude Design project
(`95a6747b-dc90-432d-9fe6-203873801b76`, file `MahjHero.dc.html`) is
byte-identical to the copy already committed at
`.superpowers/design/MahjHero.dc.html`. The app drifted from it, or never
matched.

`lib/theme.ts` is already a faithful port of the design system's
`organic.css` tokens, so the gap is layout and composition, not colour or
type.

## Which artboard, and which screen

The relevant artboard is `1C club` (the `<!-- 1C club -->` block in
`MahjHero.dc.html`). It is a **cross-club** dashboard, which is what makes
the mapping non-obvious. The canvas's own view model settles it:

- `chips` is `[{ id: 'all', label: 'All clubs' }, ...one per club]`
- the games list is built by iterating `scope`, a set of clubs, and each row
  carries `club: cl.short` for its kicker
- `clubMeta` is `all.length + ' clubs · ' + totalMembers + ' members'` when
  the scope is all clubs

So the artboard corresponds to **`app/clubs/index.tsx`** — the screen that
already renders "Your games" from `fetchMyUpcomingBookings()` (which carries
`club_name`) plus "Your clubs" — and **not** to `app/clubs/[id]/index.tsx`,
which is scoped to a single club.

## Scope of this pass

Presentation only. No new routes, no schema change, no new SQL, no new RPC,
and no new query written. Every existing behaviour is preserved: promotion
offers, waitlist management, decline, and check-in all keep their current
logic and their current copy.

The screen does gain one call to an existing function — `fetchProfile(userId)`
from `lib/profile.ts` — to supply the avatar's initials. It replaces the
bottom "Your profile" link rather than adding a net affordance. If it fails,
the avatar falls back to a neutral glyph and the screen is otherwise
unaffected.

## Layout

Top to bottom, replacing the current flat stack of headings and cards.

### 1. Header

A row. On the left, a kicker (`Your clubs` when the scope is all, `Your
club` when a chip is picked), the scope's name in the heading font at 30px,
and a muted meta line. On the right, a circular initials avatar on
`accent2[500]`, pressable, labelled "Your profile", routing to `/profile`.

Meta line: `"N clubs"` when the scope is all; the club's `rhythm` when a
single club is picked — `rhythm` is this app's analogue of the artboard's
per-club `meta`.

The artboard's up/down chevron beside the kicker is **dropped**. In the
design it navigates to a separate "Your clubs" screen; here that list lives
on this same screen, so the chevron would be an affordance with no
destination. The chips carry the switching instead.

### 2. Chip row

A horizontal scroller: `All clubs` followed by one chip per club, using
`club.name` (the app has no short name). The active chip shows the
artboard's 8px accent dot. Selection is client-side state only and filters
both the games list and the header.

Rendered only when the member belongs to more than one club. A single-club
member gets no switcher, because there is nothing to switch between.

### 3. Loading

Three shimmering blocks — 86px tall, `radius.card`, `colors.surface`,
staggered — replacing the full-screen `ActivityIndicator` for the `!ready`
state, driven by `Animated.loop` on opacity. The pre-session `loading` gate
keeps its spinner; that is an auth gate, not content loading.

### 4. Section header

The artboard's baseline-aligned row. No "See all" link: there is no
all-games screen to link to.

### 5. Game rows

The substantive change. Each booking's `Card` becomes a three-part row:

- **Date tile** on the left: day abbreviation over the date number, on
  `colors.bg`, with a 4px `neutral[200]` bottom border standing in for the
  artboard's `inset 0 -4px 0` shadow, which React Native cannot express.
- **Title block**: club name as an uppercase muted kicker, event title in
  bold, venue and time as the muted meta line.
- **Status slot** on the right: `Tag` in the `accent2` variant reading
  "Seated" for a confirmed seat; otherwise the existing vocabulary
  (`waitlistLabel(...)`, "Not seated yet").

Offer countdown, accept/decline, leave-waitlist and `CheckInControl` keep
their current behaviour and gating, stacked below the row inside the same
card. The artboard has no place for them because it predates those
features; dropping them to match it literally would delete shipped
functionality.

### 6. Empty state

A card with a 2px dashed `neutral[400]` border. Its "Host a table" button
renders only when the chip filter is scoped to a single club, since the
route needs a club id.

### 7. Your clubs list

Kept, under a section header matching the new visual language. The bottom
"Your profile" link is removed — the avatar is now that affordance.

## Structure

`app/clubs/index.tsx` is 501 lines before this change. Extract into
`components/`:

- `DateTile.tsx` — day/date tile, no knowledge of bookings
- `ClubChips.tsx` — the scroller, takes labels and a selection callback
- `DashboardHeader.tsx` — kicker/name/meta plus the avatar
- `Skeleton.tsx` — one shimmer block

Each is independently testable and none needs to know about `MyBooking`.

## Deliberate deviations from the artboard

| Artboard | Here | Why |
|---|---|---|
| 15px body / muted text | 18pt body, 16pt helper | Existing documented accessibility decision in `lib/theme.ts` — the player base skews older |
| `"3 clubs · 47 members"` | `"3 clubs"` | `fetchMyClubs()` returns no member counts |
| "This week" | "Your games" | The list is all upcoming bookings, not a 7-day window. Calling a game three weeks out "this week" would be false |
| Switcher chevron | omitted | No destination — the clubs list is on this screen |
| "See all" | omitted | No all-games screen exists |
| `inset` tile shadow | 4px bottom border | React Native has no inset box-shadow |

## Deferred to a next pass

Recorded here so none of it is lost. Nothing below is built in this pass.

### Needs data the app does not yet read

1. **"Need a 4th" alert card** — the accent card with the 中 tile glyph and
   the "I'm in" button. `needsAFourth(capacity, confirmed, startsAt, now)`
   already exists in `lib/bookings.ts`, but `MyBooking` carries no per-table
   capacity or confirmed count, so the dashboard cannot evaluate it. Needs a
   cross-club read of table seat counts.
2. **"Join" button and open-game rows** — the artboard's `g.open` state.
   `fetchMyUpcomingBookings()` returns only bookings you are already in, so
   every row is by definition already yours. Needs a cross-club "open games
   you are not in" read.
3. **Member count in the header meta** — restoring `"N clubs · M members"`
   needs `fetchMyClubs()` to return counts.

### Depends on deferred items above

4. **Dismissible notice banner** — the accent-2 card with the check icon.
   In the design its only source is taking an alert (`alertTaken` sets
   `notice`), so it has nothing to show until item 1 exists.

### Needs screens or navigation the app does not have

5. **Four-tab bottom bar** (Club / Messages / Profile / Alerts) — the app
   has no tab navigation at all; adding it restructures expo-router layout
   across every screen. Explicitly out of scope, decided up front.
6. **Header switcher chevron** — becomes meaningful only if the dashboard
   and the clubs list are split into separate screens as the design has
   them.
7. **"See all"** — needs an all-games screen.
8. **Messages, thread and compose screens** — artboards `1C messages`,
   `1C thread`, `1C compose`. No such feature exists; the app has
   broadcasts, which is a different thing.
9. **Unread badges on club chips** — the design's model carries
   `hasUnread` / `unread` per club. Depends on messages.
10. **Friends, Host a table, Start a club, Join a table** — artboards
    `1C friends`, `1C host a table`, `1C start a club`, `1C join a table`.
    Separate screens, separate passes.

### Presentation work not attempted here

11. **"This week" windowing** — filtering to 7 days and grouping the
    remainder under a "Later" heading, which would let the section carry the
    artboard's actual label.
12. **`app/clubs/[id]/index.tsx`** — the per-club screen keeps its current
    look and will visually clash with the rebuilt dashboard until it gets
    the same treatment.
13. **Desktop artboard** (`1C desktop`) — a three-column layout. The app
    caps content at `layout.contentMaxWidth` (440px) on every viewport.

## Testing

Test-driven. `app/__tests__/clubs.test.tsx` holds 27 tests; those asserting
text that this change removes or renames need updating. New coverage:

- chip filtering narrows the games list and updates the header
- header meta reads `"N clubs"` for all, the club's `rhythm` for one
- the skeleton state renders while `!ready`
- the date tile shows the right day and date for a booking's timezone
- the status slot shows "Seated" for confirmed, the waitlist label otherwise
- offers, decline, leave-waitlist and check-in still behave as before

## Branching

Branched from `feat/check-in`, not `main`, because the dashboard renders
`MyBooking.check_in_required` and `CheckInControl`, both of which land in
PR #7. The pull request should target `feat/check-in`, or be rebased onto
`main` once #7 merges.
