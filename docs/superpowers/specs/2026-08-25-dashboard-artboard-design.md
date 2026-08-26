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

No schema change, no new SQL, no new RPC. Every existing behaviour is
preserved: promotion offers, waitlist management, decline, and check-in all
keep their current logic and their current copy.

The screen calls three existing functions it did not call before:

- `fetchProfile(userId)` (`lib/profile.ts`) for the avatar's initials. It
  replaces the bottom "Your profile" link rather than adding a net
  affordance. On failure the avatar falls back to a neutral glyph.
- `fetchUpcomingEvents(clubId)` (`lib/events.ts`), once per club. This is
  what makes the "Need a 4th" card and the Join button possible — see below.
- `commitBooking(...)` (`lib/bookings.ts`) for the "I'm in" and "Join"
  actions.

One new route is added: a Messages placeholder, so the tab bar has four real
destinations.

### Correction to an earlier draft of this spec

An earlier draft deferred the "Need a 4th" card and the Join button on the
grounds that the dashboard could not get seat counts. That was wrong, and it
came from looking only at `my_upcoming_bookings`.

`fetchMyUpcomingBookings()` indeed carries no capacity or confirmed counts,
and returns only bookings the caller is already in. But
`fetchUpcomingEvents(clubId)` returns `ClubEvent`, which carries
`event_tables` (each with `capacity`) and `bookings` (every row, live and
dead) — and `needsAFourth(capacity, confirmed, startsAt, now)` plus
`eventStatusLine()` already compute the need-a-fourth condition from exactly
that shape. It also returns every upcoming event in the club, not merely the
caller's, so "open games you are not in" is derivable from the same data.

Both features are therefore buildable with no new SQL, at a cost of one
additional read per club.

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

### 3. Notice banner

An accent-2 card with a check icon and a ghost "Dismiss" button, shown after
taking a seat from an alert. Its copy mirrors the design's: "You're in — "
plus the alert text. Client-side state, cleared on dismiss.

### 4. Loading

Three shimmering blocks — 86px tall, `radius.card`, `colors.surface`,
staggered — replacing the full-screen `ActivityIndicator` for the `!ready`
state, driven by `Animated.loop` on opacity. The pre-session `loading` gate
keeps its spinner; that is an auth gate, not content loading.

### 5. "Need a 4th" alert cards

One card per table in the chip scope that `needsAFourth()` reports as one
short and starting within 48 hours, excluding events the viewer is already
in. Accent background, a `中` glyph on a `colors.bg` tile, an uppercase
"Need a 4th · <club>" kicker over the call text, and an "I'm in" button.

Data comes from `fetchUpcomingEvents(clubId)` per club — `event_tables`
gives `capacity`, `bookings` gives the confirmed count per table. The
condition is `needsAFourth()` itself, not a fourth reimplementation of the
rule; `lib/bookings.ts` already warns that this rule reached three copies
before one drifted.

"I'm in" calls `commitBooking({ eventId, players: [userId], preferredTableId,
allowSplit: false })`, then reloads and raises the notice banner.

### 6. Section header

The artboard's baseline-aligned row. No "See all" link: there is no
all-games screen to link to.

### 7. Game rows

The substantive change. Each `Card` becomes a three-part row:

- **Date tile** on the left: day abbreviation over the date number, on
  `colors.bg`, with a 4px `neutral[200]` bottom border standing in for the
  artboard's `inset 0 -4px 0` shadow, which React Native cannot express.
- **Title block**: club name as an uppercase muted kicker, event title in
  bold, venue and time as the muted meta line.
- **Status slot** on the right: `Tag` in the `accent2` variant reading
  "Seated" for a confirmed seat; a "Join" button for an open game the viewer
  is not in; otherwise the existing vocabulary (`waitlistLabel(...)`, "Not
  seated yet").

The list is the union of the viewer's bookings (`fetchMyUpcomingBookings`)
and open events they are not in (`fetchUpcomingEvents` per club), matching
the artboard's mixed Seated/Join list. Rows are keyed by event id so a game
the viewer is booked into never appears twice.

Offer countdown, accept/decline, leave-waitlist and `CheckInControl` keep
their current behaviour and gating, stacked below the row inside the same
card. The artboard has no place for them because it predates those features;
dropping them to match it literally would delete shipped functionality.

### 8. Empty state

A card with a 2px dashed `neutral[400]` border. Its "Host a table" button
renders only when the chip filter is scoped to a single club, since the
route needs a club id.

### 9. Your clubs list

Kept, under a section header matching the new visual language. The bottom
"Your profile" link is removed — the avatar is now that affordance.

## Tab bar

The artboard's four-tab bottom bar, on `colors.surface`, active tab in
`colors.accent[700]` — not the artboard's `accentColor`, which measures
2.69:1 on that ground and made the selected tab less legible than the
unselected ones.

It is a plain component (`components/TabBar.tsx`) that each tab screen renders
through `Screen`'s `tabBar` prop, **not** an expo-router layout. A `(tabs)`
route group would put `app/(tabs)/clubs/index.tsx` in the same URL namespace as
the existing `app/clubs/[id]/` tree and would move files that several test
files import by relative path. Migrating to expo-router's own `Tabs` is a
follow-up, not a prerequisite; see the component's own docstring.

| Tab | Route | State |
|---|---|---|
| Club | `/clubs` | exists |
| Messages | `/messages` | **new placeholder** — "Messages are on the way", nothing else |
| Profile | `/profile` | exists |
| Alerts | `/notifications` | exists |

The Alerts tab needs no new screen. The design's "Notifications" artboard is
a *settings* screen — delivery channel, quiet hours, "Mute need a 4th" —
which is what `app/notifications.tsx` already implements. It is not a feed,
and nothing in the design implies one.

Screens outside the four tabs (`/clubs/[id]/...`, `/sign-in`, `/join/...`,
`/profile` sub-flows) stay on the stack and are pushed over the tab shell as
they are today.

## Structure

`app/clubs/index.tsx` is 501 lines before this change. Extract into
`components/`:

- `DateTile.tsx` — day/date tile, no knowledge of bookings
- `ClubChips.tsx` — the scroller, takes labels and a selection callback
- `DashboardHeader.tsx` — kicker/name/meta plus the avatar
- `Skeleton.tsx` — one shimmer block
- `NeedAFourthCard.tsx` — the accent alert card and its "I'm in" action
- `NoticeBanner.tsx` — the dismissible accent-2 confirmation

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

### Features, not presentation

1. **Messages** — the artboards `1C messages`, `1C thread` and `1C compose`
   describe club threads with replies. This pass ships only a placeholder at
   `/messages` so the tab bar has four destinations. The app's existing
   broadcasts are a different thing: one-way, organizer-to-club, no thread.
2. **Unread badges on club chips** — the design's model carries `hasUnread`
   and `unread` per club. Depends on Messages existing.
3. **Friends** (`1C friends`), **Host a table** (`1C host a table`),
   **Start a club** (`1C start a club`), **Join a table**
   (`1C join a table`) — separate screens, separate passes. `/clubs/new` and
   `/clubs/[id]/events/new` cover some of this ground today with a different
   layout.

### Needs data the app does not read

4. **Member count in the header meta** — restoring the artboard's
   `"3 clubs · 47 members"` needs counts `fetchMyClubs()` does not return.
   Reachable via `fetchRoster()` per club, but that is a second N-read fan-out
   for one line of text; better folded into the batching work in item 8.

### Needs screens or navigation this pass does not add

5. **Header switcher chevron** — becomes meaningful only if the dashboard and
   the clubs list are split into separate screens as the design has them.
   Here they share one screen and the chips do the switching.
6. **"See all"** — needs an all-games screen.

### Presentation work not attempted here

7. **"This week" windowing** — filtering to 7 days and grouping the remainder
   under a "Later" heading, which would let the section carry the artboard's
   actual label instead of "Your games".
8. **Batching the dashboard's reads** — this pass leaves the screen at
   `fetchMyClubs` + `fetchMyUpcomingBookings` + `fetchProfile` + one
   `fetchUpcomingEvents` per club. For a member in three clubs that is six
   round trips where one RPC would do. Correct but chatty; worth collapsing
   once the shape settles.
9. **`app/clubs/[id]/index.tsx`** — the per-club screen keeps its current
   look and will visually clash with the rebuilt dashboard until it gets the
   same treatment.
10. **Desktop artboard** (`1C desktop`) — a three-column layout. The app caps
    content at `layout.contentMaxWidth` (440px) on every viewport.

## Testing

Test-driven. `app/__tests__/clubs.test.tsx` holds 27 tests; those asserting
text that this change removes or renames need updating. Introducing the tab
layout also touches `app/_layout.tsx`, so the whole suite is run to catch any
screen whose test depends on the current navigation shape. New coverage:

- chip filtering narrows the games list and updates the header
- header meta reads `"N clubs"` for all, the club's `rhythm` for one
- the skeleton state renders while `!ready`
- the date tile shows the right day and date for a booking's timezone
- the status slot shows "Seated" for confirmed, the waitlist label otherwise
- a table one short and starting inside 48 hours raises exactly one
  "Need a 4th" card, and none is raised for an event the viewer is in
- "I'm in" and "Join" call `commitBooking` with the viewer as the only
  player, and a failure surfaces the error without leaving a stale notice
- the games list de-duplicates an event the viewer is booked into against
  the same event coming back from `fetchUpcomingEvents`
- offers, decline, leave-waitlist and check-in still behave as before

The tab bar gets its own coverage: four tabs render, the active one is
marked, and each routes where the table above says.

## Branching

Branched from `feat/check-in`, not `main`, because the dashboard renders
`MyBooking.check_in_required` and `CheckInControl`, both of which land in
PR #7. The pull request should target `feat/check-in`, or be rebased onto
`main` once #7 merges.
