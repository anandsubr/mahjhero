# Drop the club page's duplicate games, fix two back links — design

**Date:** 2026-09-02
**Base branch:** `UI-tweaks` (this branch)

---

## The problem

Three small navigation problems, all downstream of the same fact: the club
management page (`app/clubs/[id]/index.tsx`, reached via the dashboard
header's pencil) still lists the club's upcoming games under an "Upcoming"
heading, with its own "Add a game" ⊕ — a full second copy of what the
dashboard already shows once a club is in view (its own header now carries
an "Add a game" ⊕ too, from the prior plan on this branch), and what the
dashboard's own games list already surfaces per-club.

1. The club management page's games list is a duplicate for no reason —
   nothing on it does anything the dashboard doesn't already do once you've
   filtered to that club.
2. The event detail page's back button always returns to the club
   management page (`/clubs/${clubId}`), regardless of where the visitor
   actually came from. Today that's arguably right some of the time — the
   club page's own games list is one of two ways in. Once (1) removes that
   list, the club page is no longer a real entry point at all, and the
   *only* way into event detail becomes the dashboard's own games list
   (`app/clubs/index.tsx`) — so the back button should say so.
3. The "Add a game" form (`app/clubs/[id]/events/new.tsx`) has no back
   button at all — only a bottom "Cancel". Once (1) removes the club page's
   own ⊕, every real way into this form is the dashboard (its header's own
   ⊕, or the empty-state "Host a table" button) — the same fact that
   motivates (2)'s fix, and the same missing affordance the back-links plan
   already added to four sibling screens.

---

## The shape

### 1. Drop the "Upcoming" section from the club management page

Delete the `Text` heading, the `PlusButton` "Add a game" control, and the
whole events list (loading/empty/populated branches) from
`app/clubs/[id]/index.tsx`. This also retires everything that existed only
to feed that section: the `events`/`eventsFailed` state, the
`fetchUpcomingEvents` call in the mount effect, and the
`fetchUpcomingEvents`/`formatEventWhen`/`eventStatusLine`/`PlusButton`
imports. `Pressable` (from `react-native`) turns out to have no other use
on this page either — the events list was its only caller — so it drops
too. `Link`, `Card`, and `Tag` all stay: `Link` for the "Venues" link at
the foot of the page, `Card`/`Tag` for the roster and invite rows.

The page keeps everything else: its own back link, the club header, roster,
invites, "Open the club thread", "Create an invite link", "Import a
roster", "Venues". This narrows the page to what its own header already
calls it — "Manage" — roster, invites, venues, import. Games move
entirely to the dashboard.

### 2. Point the event detail page's back link at the dashboard

`app/clubs/[id]/events/[eventId]/index.tsx`'s back button changes from
`router.push(\`/clubs/${clubId}\`)` (label "{club.name}", accessible name
"Back to the club") to `router.push('/clubs')` (label "Clubs", accessible
name "Back to your clubs") — the same label/accessible-name pair already
used by the club management page's own back link and `clubs/new.tsx`'s.
This is correct now that (1) removes the club page's games list: the
dashboard is the only real way into this screen going forward (the two
other places that reference this route,
`events/[eventId]/edit.tsx` and `check-in.tsx`, are programmatic returns
*from* this screen's own sub-flows, not entry points *into* it — landing
back here after a save or a cancel is exactly what they should do, and
neither changes).

The stale comment explaining why `/clubs/${clubId}` was "kept, not
dropped" (it distinguished this screen's case from the club page's own,
now-removed contrast) gets rewritten to explain the new destination
instead.

### 3. Add a back link to the "Add a game" form

`app/clubs/[id]/events/new.tsx` gets the same top-of-screen control the
back-links plan already put on four sibling screens: a ghost `Button` with
`ChevronLeftIcon`, `style={styles.backButton}` (`{ alignSelf: 'flex-start' }`,
the identical literal already used in three other files), placed as the
first child of the populated `Screen`, before the "Add a game" heading.
Label "Clubs", accessible name "Back to your clubs", destination `/clubs` —
same reasoning as (2): once (1) ships, every real way into this form is the
dashboard (the header's ⊕ or "Host a table"), so that's where back goes.

This needs a new `ChevronLeftIcon` import (not currently imported here) and
a new `backButton` style entry. The file's own docstring currently explains
only why the bottom Cancel button isn't redundant with the Club tab
(different destinations: this club vs. the dashboard); it gets one more
sentence explaining the new top link the same way the back-links spec
explains its own four screens — the Club tab renders as already-active
here (`active="club"`), which reads as "you are here", not "go back", so an
explicit link is still worth having despite the tab technically being able
to reach the same place.

The bottom "Cancel" button is untouched — it's a different action (abandon
the draft, prefer `router.back()` with a `replace` fallback) serving a
different moment than a plain "I didn't mean to be here" back link.

---

## What this touches

- `app/clubs/[id]/index.tsx` — delete the Upcoming section and its
  supporting state/imports.
- `app/clubs/[id]/events/[eventId]/index.tsx` — change the back button's
  destination, label, accessible name, and its explanatory comment.
- `app/clubs/[id]/events/new.tsx` — add a back button (new import, new
  style, one docstring sentence).

**Tests.** `app/__tests__/clubs.test.tsx`'s `ClubDetailScreen` describe
block loses every assertion about the "Upcoming" heading, the events list,
and the "Add a game" control on that page (several tests currently seed
`fetchUpcomingEvents` and assert on its results there — those either get
deleted outright if they test nothing else, or trimmed to drop only the
now-gone assertions). Its own event-detail and new-event describe blocks
(if this repo's test files split them out — check before assuming) gain
tests for the new/changed back buttons, following the exact pattern the
back-links plan's own tests already use elsewhere in this file (render,
click the back button by role/name, assert `push` was called with the
right route).

---

## Not in scope

- **The dashboard's own games list or its "Add a game" ⊕** — both already
  correct from the prior plan on this branch; this document only removes
  the club page's now-redundant second copy.
- **The bottom "Cancel" button on the "Add a game" form** — different
  control, different job, untouched.
- **Visual baselines** — still unregenerable in this environment (no
  Docker), same accepted gap as the rest of this branch's work.
