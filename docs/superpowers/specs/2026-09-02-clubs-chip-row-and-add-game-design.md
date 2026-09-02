# The chip row replaces the header's "start a club" ⊕ — design

**Date:** 2026-09-02
**Base branch:** `UI-tweaks` (this branch, cut from `main`) — revises behavior
`2026-09-01-ui-tweaks-design.md`'s items 2 and 3 shipped in PR #12

---

## The problem

PR #12 shipped a working filter/chevron mechanic on the clubs dashboard, but
owner feedback on the merged behavior surfaced two problems once it was
actually used:

1. Once a member filters to one club, the chip row that got them there is
   still on screen — redundant now that the header carries a back chevron
   back to "All clubs".
2. The header's ⊕ always means "start a club", everywhere, including when
   a specific club is already in view. A member looking at one club's games
   reaches for that ⊕ expecting "add a game to *this* club" and gets
   "create an entirely new club" instead.

Fixing (2) naively — swap the ⊕'s meaning to "add a game" whenever a single
club is showing — breaks a case (1) doesn't touch: a one-club member's
header *always* shows their one club (`headerScope`'s existing "a one-club
member's scope is never ambiguous" rule, unrelated to this branch), and
their filter state (`selected`) never has a reason to leave `ALL_CLUBS`,
because they have no chip row to change it with (`list.length > 1` guards
it today). Losing "start a club" for them, with no replacement, was the
question that stopped a quick patch — a one-club member would have had no
dashboard route to a second club at all.

---

## The shape

**The chip row becomes the only route to "start a club", and the header's
⊕ becomes exclusively "add a game".**

### The chip row

- Drops the `ALL_CLUBS` chip. It never represented a real club, and once
  the row's own visibility (below) already means "you're looking at
  everything", a chip that also says "everything" is the same fact twice.
- Shows every one of the member's clubs, **even a single one** — the
  `list.length > 1` guard is replaced by a visibility rule tied to filter
  state, not count (below), so a one-club member sees their own club as a
  tile rather than no row at all.
- Gains a trailing tile: a ⊕ avatar (outlined, matching `PlusButton`'s
  treatment rather than a club's solid initials fill, so it reads as an
  action rather than a fourth club) with the label **"New club"** beneath
  it, in the same icon-over-label shape every other tile already uses.
  Accessible name stays **"Start a club"**, matching the phrase used
  everywhere else in the app for this action (the zero-club empty state's
  own button). Presses `router.push('/clubs/new')`.

**Row visibility:** `selected === ALL_CLUBS` — shown while nothing is
filtered (which is where a one-club member's `selected` sits by default,
since nothing they can tap ever moves it away on its own), hidden the
moment any club is filtered in, regardless of how many clubs exist. This
single rule replaces both the old `list.length > 1` guard and the
chip-row-hides-when-filtered behavior from PR #12 — same effect for the
filtered case, but no longer gated on count for the unfiltered one.

This *was* tried before — an earlier design (`2026-09-01-clubs-header-actions-design.md`)
deliberately removed a trailing "+ New club" chip because the row scrolled
horizontally and the chip clipped off-screen at two clubs. That reason no
longer applies: `2026-09-01-clubs-header-actions-design.md`'s own follow-up
already changed the row to *wrap* instead of scroll, specifically so
nothing on it is ever hidden. A trailing tile now just wraps onto its own
line if it has to.

### The header

`DashboardHeader`'s `onPressNew` prop — the flat-branch and "Your club"
branch's shared "start a club" ⊕ — is deleted outright. Nothing will call
it once the dashboard stops passing it, and no other screen (`clubs/[id]/
index.tsx`, `venues.tsx`) ever did.

A new prop, `onPressAddGame`, takes its place — **only in the "Your club"
branch**. Same visual slot (the top-row ⊕, beside the existing back
chevron), same `PlusButton` component, new accessible label: **"Add a
game"**. The flat branch drops its ⊕ entirely; nothing replaces it there.

`app/clubs/index.tsx` wires this from `scopeClubId` — the same derivation
that already resolves to "the club currently in view" for both cases at
once: an explicitly filtered club (`selected` matches a real id) and a
one-club member's own club (`list.length === 1` fallback), the identical
signal `headerScope` already uses to decide whether the "Your club" branch
draws at all. One condition, both cases handled, no special-casing for the
one-club member — they get "Add a game" on their header for free, which is
also the answer to "how does a one-club member add a game quickly" that
blocked the naive version of this fix.

```tsx
onPressAddGame={
  scopeClubId ? () => router.push(`/clubs/${scopeClubId}/events/new`) : undefined
}
```

**The chevron's gate changes to match the row's:** `onPressBack` was
`list.length > 1 ? … : undefined`; it becomes `selected !== ALL_CLUBS ? …
: undefined` — shown exactly when the row is hidden, for the same reason.
A one-club member who taps their own tile (a harmless, redundant action —
`selected` moves off `ALL_CLUBS` even though the header's content doesn't
change) still gets a working way back, rather than a chevron gated on a
club count that says nothing about their actual filter state anymore.

### What doesn't change

- `app/clubs/[id]/index.tsx`'s own "Add a game" ⊕ (Task 2, at the top of
  its "Upcoming" section) is untouched — a member reaching that page via
  the header's pencil still adds a game the same way they do today. This
  design is entirely about the dashboard's own header/chip row.
- `headerScope`, `inScope`, `buildDashboardRows`, `needAFourthAlerts`,
  `ALL_CLUBS` the constant — none of the filtering/scope math changes,
  only which chip represents "no filter" (none, now) and which controls
  read `selected`.
- The zero-club early return (`app/clubs/index.tsx`'s `list.length === 0`
  branch) already renders no chip row and no header ⊕; unaffected either
  way.

---

## What this touches

- **`lib/dashboard.ts`** — `buildChips` stops prepending the `ALL_CLUBS`
  entry; it becomes a plain map over the member's clubs.
- **`components/ClubChips.tsx`** — drops the `ALL_CLUBS`-specific glyph
  branch (nothing in `chips` is ever the `ALL_CLUBS` id anymore); gains an
  optional `onPressNewClub` prop rendering the trailing tile.
- **`components/DashboardHeader.tsx`** — `onPressNew` deleted from the
  type and both branches; `onPressAddGame` added, rendered only in the
  "Your club" branch's top row in the exact slot `onPressNew` used to
  occupy there. The flat branch's `row`/`scope` layout simplifies since it
  no longer ever has a second (⊕) child.
- **`app/clubs/index.tsx`** — the chip row's guard becomes
  `selected === ALL_CLUBS` (was `list.length > 1`); `onPressBack`'s guard
  becomes `selected !== ALL_CLUBS` (was `list.length > 1`); the
  `DashboardHeader` call drops `onPressNew`, adds `onPressAddGame` and
  `onPressNewClub` (on the `ClubChips` call) wired to `router.push`.

**Tests.** `lib/dashboard.test.ts`'s `buildChips` tests lose their
`ALL_CLUBS`-entry assertions. `components/__tests__/dashboard-parts.test.tsx`
loses its `ALL_CLUBS`-glyph `ClubChips` test and its `onPressNew`-flavored
`DashboardHeader` tests in both branches, gains tests for the new trailing
tile and for `onPressAddGame`. `app/__tests__/clubs.test.tsx` and
`app/__tests__/your-games.test.tsx` both carry the heaviest rework — every
test that asserted an "All clubs" chip, a `list.length > 1` visibility
guard, or a header "Start a club" button needs its assertions updated to
the new mechanics, including the two screen-level tests PR #12's own final
review just added (`'clears the club filter …'`,
`'draws no chevron for a one-club member'`) — both need re-pointing at
`onPressAddGame`'s "Add a game" label and the `selected`-based guard rather
than the count-based one they were written against.

---

## Not in scope

- **`app/clubs/[id]/index.tsx`'s own header.** It never passed `onPressNew`
  and won't pass `onPressAddGame` either — that page keeps its existing,
  separate "Add a game" control near "Upcoming". "When I click a club" in
  this design means filtering the dashboard, not navigating to that page.
- **Any change to how a club is selected/filtered internally.** `selected`,
  `ALL_CLUBS`, `inScope` are untouched — only which UI reads and writes
  them changes.
