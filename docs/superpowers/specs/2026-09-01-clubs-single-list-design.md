# One club list on the clubs dashboard — design

**Date:** 2026-09-01
**Base branch:** `feat/clubs-single-list`, cut from `feat/club-boards` — the
components this changes (`ClubChips`, `DashboardHeader`, `lib/dashboard.ts`) do
not exist on `origin/main`; they arrive with [PR #11](https://github.com/anandsubr/mahjhero/pull/11).

---

## The problem

The clubs dashboard lists your clubs twice. `buildChips` renders each club as a
filter pill under the header, and the `Your clubs` section at the foot of the
page renders the same clubs again as cards. Between them sits `Your games`, so
the two lists are far enough apart that they do not read as a duplication —
they read as two unrelated things you have to learn separately.

They are not unrelated. They are one list doing two jobs: the chip **filters
the page in place**, the card **navigates into the club**. Neither presentation
tells you the other exists.

The duplication has already left a mark on the tests. `Your clubs` renders
twice on this screen — once as the header kicker, once as the section title —
and the e2e suite carries a `.first()` and a comment explaining why
(`e2e/visual.spec.ts:233`).

---

## The shape

One list, at the top, and it keeps the chip row exactly as it is. The
`Your clubs` heading, its cards, and the `Start another club` button are
deleted from the bottom of the page.

Entering a club moves into the header.

`headerScope` already retitles the header to the selected club's name and
rhythm. The header is therefore already a club card in everything but
behaviour — it shows the club, it just cannot be pressed. Making it pressable
is the whole of the navigation change.

The loop a member walks:

1. Tap a chip. The page filters, and the header retitles to that club.
2. Tap the header. The club opens.

`DashboardHeader` gains an optional `onPressScope`. When it is supplied, the
scope block becomes a `Pressable` labelled `Open ⟨club name⟩` and draws a
chevron beside the kicker. When it is not, the header renders exactly as it
does today, so the club detail screen that also uses this component is
untouched.

That chevron is not an invention. The artboard specified it, and the
component's own comment records that it was dropped only because the club list
was already on this screen and the chevron would have had nowhere to go.
Removing the list gives the chevron its destination back, and the comment
should be rewritten rather than deleted — the reasoning still holds, its
premise has simply changed.

In `All clubs` scope no chevron is drawn and the header does not respond to
presses. There is no single club to open, and an affordance that does nothing
is worse than none.

---

## Club counts

**Zero clubs.** No chip row. The `You are not in a club yet…` help text and the
`Start a club` button move up to sit directly under the header, where the row
would otherwise be. With no clubs there are no games either, so this is the
whole screen.

**One club.** No club chips — with one club there is nothing to filter, and a
lone `All clubs` pill beside a lone club pill is noise. The row itself is still
drawn, holding only the `+ New club` chip described below.

`headerScope` learns to resolve a single-club list to that club: kicker
`Your club`, the club's name, its rhythm — instead of today's
`All your clubs` / `1 club`. The header is then titled and pressable, and the
solo member reaches their club in one tap.

This mirrors reasoning the screen already applies. `hostClubId` deliberately
derives its target from the clubs themselves rather than from chip state,
because a one-club member's `selected` stays `ALL_CLUBS` forever — the chip row
that would change it is never drawn. A solo member's scope is never genuinely
ambiguous, and `headerScope` should stop pretending otherwise.

**Two or more clubs.** The row as it stands: `All clubs`, one chip per club,
unread badges intact.

---

## Starting a club

`Start another club` becomes a trailing `+ New club` chip at the end of the
row: outlined, no leading dot, no unread badge, so it does not read as one more
thing you could filter by.

The row is therefore drawn whenever the member is in **at least one** club,
even though club chips themselves only appear at two or more. At exactly one
club the row holds nothing but the `+ New club` pill.

This is a deliberate trade. The alternative — trailing chip at two or more
clubs, and today's secondary button left at the page foot for zero and one —
costs two presentations of one action, in exactly the case where the action
matters most. A member in one club is the member most likely to start a second;
hiding the affordance from them to avoid a lone pill is the wrong way round.
A single pill under the header is a small ugliness, and it is honest.

At zero clubs the row is not drawn at all. The empty state's `Start a club`
button is already the same action, stated more fully, and two of them would
compete.

---

## What this touches

**`components/ClubChips.tsx`** — an optional trailing action chip. It reports a
press like the others but carries its own styling: outlined rather than filled,
never active, never badged. Filters and actions sharing a row is the reason it
must look different.

**`components/DashboardHeader.tsx`** — optional `onPressScope`, the chevron,
and the `Open ⟨name⟩` accessible label. Absent the prop, no behaviour change.

**`lib/dashboard.ts`** — `headerScope` resolves a one-club list to that club.

**`app/clubs/index.tsx`** — delete the `Your clubs` section; render the row at
one or more clubs; move the empty state above `Your games`; pass
`onPressScope` when a single club is in scope.

**Tests.** `lib/dashboard.test.ts` asserts the current one-club behaviour
(`headerScope([CLUBS[0]], ALL_CLUBS).meta` is `1 club`) and that assertion
inverts. `app/__tests__/clubs.test.tsx` reaches for the club card in
`Your clubs` and for `Start another club`; both move. The `clubs` and
`clubs-populated` visual snapshots regenerate.

The `.first()` in `e2e/visual.spec.ts` and the comment explaining it can go:
`Your clubs` now renders once, as the header kicker, and only in `All clubs`
scope.

---

## Not in scope

**Per-club unread on the way in.** The chips carry unread badges and the
deleted cards did not, so nothing is lost. Surfacing unread in the header is a
separate question.

**A `Your clubs` screen.** The artboard's chevron originally tapped through to
a dedicated list. It now opens the club in scope instead. If the row ever stops
being enough — many clubs, horizontal scrolling that hides most of them — that
screen is the answer, and this design does not foreclose it.

**Reordering `Your games` and the row.** Untouched.
