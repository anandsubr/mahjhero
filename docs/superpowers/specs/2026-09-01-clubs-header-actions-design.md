# The clubs header carries the actions — design

**Date:** 2026-09-01
**Revises:** [2026-09-01-clubs-single-list-design.md](2026-09-01-clubs-single-list-design.md)
**Base branch:** `feat/clubs-single-list`, before it becomes a PR

---

## The problem

The single-list design put `Start another club` into the chip row as a
trailing `+ New club` pill. The regenerated visual baselines showed what that
actually costs.

At **two** clubs the row renders `● All clubs | Riverside Mah Jongg | Thursda…`
— the second club's chip is cut mid-word and the `+ New club` chip is not on
screen at all. The content column is ~415px on mobile and desktop alike, and
`showsHorizontalScrollIndicator={false}` means the clipped sliver is the only
cue that the row scrolls. Every club a member joins pushes the action further
out of sight.

`/clubs/new` has exactly two callers: the zero-club `Start a club` button and
that chip. So for any member who already has a club, an invisible pill at the
end of a scrollbar-less row is the only way to start another. Before the
single-list change it was a full-width button at the foot of a vertically
scrolling page.

The e2e assertion written to guard this does not catch it. Playwright's
`toBeVisible()` is a bounding-box and `visibility` check; an element scrolled
outside an `overflow: auto` ancestor still has a box and still passes.

The earlier spec did weigh a trade here, but a different one. Both options it
compared put the chip in the row at two or more clubs, so the clipping was
never on the table; its argument — that a lone pill under the header is a
small, honest ugliness — was about the **one-club** case, where the pill is
the row's only content and fully visible. That argument stands. This document
replaces the decision it was attached to.

A second, smaller problem: the header's press target draws a right-chevron and
is labelled `Open ⟨club⟩`, but it lands on the club's roster, invites, venues
and import. That is management, and the glyph should say so.

---

## The shape

**The row goes back to holding nothing but filters.** Both actions move into
the header, which does not scroll.

### Starting a club

In the all-clubs scope the title shortens from `All your clubs` to
`Your clubs`. That makes the `YOUR CLUBS` kicker above it a literal
duplicate, so **that scope drops the kicker** and keeps `2 clubs` as its meta.
The single-club scope is untouched: `YOUR CLUB` / the club's name / its
rhythm.

`DashboardHeader` already guards `meta.length > 0` before rendering the meta;
the kicker gets the same guard, so an empty kicker draws nothing rather than
an empty line.

The freed width takes a **⊕ button in the header's right-hand cluster**,
immediately left of the avatar — same size and shape, so the two read as one
group of controls. Accessible name `Start a club`. It is a fixed target at
every club count and it never scrolls.

The `+ New club` chip comes out of the row, and the `action` prop is **deleted
from `ClubChips`** rather than left unused. This undoes Task 3 of the
single-list plan. That task built exactly what its spec asked for; the spec
was wrong, and the baseline is what showed it.

The zero-club screen keeps its full-width `Start a club` button. It is the
only thing on that screen and a ⊕ in the corner would be a worse answer than
the button already there.

### Managing a club

`ChevronRightIcon` in the pressable scope block becomes a new `PencilIcon`,
and the accessible label changes from `Open ⟨club⟩` to `Manage ⟨club⟩` —
"manage" describes roster, invites, venues and import; "edit" promises a form
that does not exist.

The label keeps composing the meta on the same `meta.length > 0` guard it uses
today. That is not cosmetic: `accessibilityLabel` replaces the accessible name
computed from a `Pressable`'s children under react-native-web, so without it
the club's rhythm is visible and unannounceable.

The chevron's own rationale — that it points right rather than the artboard's
up/down, because it navigates rather than expanding a picker — no longer
applies to a pencil, and the component comment recording it must be revised
rather than carried forward unchanged.

---

## What this touches

**`components/icons.tsx`** — a `PencilIcon` and a `PlusIcon`, matching the
existing icons' signature (`{ size, color }` with defaults).

**`components/DashboardHeader.tsx`** — the kicker's `length > 0` guard; the
pencil in place of the chevron; the `Manage ⟨name⟩` label; an optional
`onPressNew?: () => void` that draws the ⊕ button beside the avatar when
supplied. Optional for the same reason `onPressScope` is: the club detail and
venues screens render this header and have no club to start.

**`components/ClubChips.tsx`** — the `action` prop and its styling deleted;
the horizontal `ScrollView` replaced by a wrapping `View`, taking
`SCROLL_GUTTER` with it.

**`lib/dashboard.ts`** — `headerScope`'s all-clubs branch returns
`kicker: ''` and `name: 'Your clubs'`.

**`app/clubs/index.tsx`** — passes `onPressNew`; stops passing `action`.

**Tests.** `lib/dashboard.test.ts` asserts the current all-clubs kicker and
name. `components/__tests__/dashboard-parts.test.tsx` covers the chevron by
`testID="scope-chevron"` and the `Open …` label, and has two `ClubChips`
action tests to delete. `app/__tests__/clubs.test.tsx` and
`app/__tests__/your-games.test.tsx` both assert `Open …` labels, and one
asserts the `Start another club` chip. `e2e/visual.spec.ts` asserts
`+ New club` and `Start another club`, and its four clubs baselines
regenerate — as do the two `messages-badge` baselines, which shoot the same
`/clubs` route. The wrap moves the four two-club baselines a second time; the
two zero-club ones are unaffected, since that screen draws no row.

---

## The row wraps rather than scrolls

An earlier draft of this document left the row's `showsHorizontalScrollIndicator={false}`
alone, on the reasoning that a clipped chip hides only a filter — a member who
cannot see a club's chip can still see that club's games under `All clubs`.

That reasoning was false by the time it was written. Deleting the `Your clubs`
card list made chip selection the only thing that arms the header's `Manage`
control, so the row is now the sole route into a club's roster, invites,
venues and import. At four clubs, chips three and four sit off-screen with no
scrollbar. Keyboard and screen-reader users are unaffected — focus scrolls an
element into view — but a pointer user on a ~415px column has no cue that the
row continues.

So the row stops scrolling. `ClubChips` renders a wrapping `View` instead of a
horizontal `ScrollView`, and the chips flow onto as many lines as they need.
Nothing is ever hidden, at any club count, and the scroll-cue question stops
existing rather than being answered.

The cost is honest and accepted: the header-plus-chips block grows taller with
each club, pushing `Your games` further down. A member in many clubs trades
vertical space for never losing a club — and the page already scrolls
vertically, which is the axis people expect to scroll.

`SCROLL_GUTTER` in `components/ClubChips.tsx` — a literal 2px of
`paddingBottom` that existed to keep the scrollbar off the chips — goes with
the `ScrollView`. So does the component's description of itself as a
"horizontal club switcher".

---

## Not in scope

**A one-club visual baseline.** The e2e fixtures seed zero clubs or two, so
nothing pictures the state this design turns on — a pencil in the header and,
now, a ⊕ beside the avatar. Worth adding; it needs a new seeded fixture and
belongs with that work, not here.

**The scroll indicator** — because the row stops scrolling at all. See *The
row wraps rather than scrolls* above.

**Back navigation.** Tracked in
[2026-09-01-back-links-design.md](2026-09-01-back-links-design.md), on its own
branch.
