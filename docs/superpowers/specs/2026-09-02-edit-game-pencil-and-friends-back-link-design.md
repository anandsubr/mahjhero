# Edit-game pencil, friends back link — design

**Date:** 2026-09-02
**Base branch:** `UI-tweaks` (this branch)

---

## The problem

Two small, unrelated navigation/consistency issues, bundled because both are
quick and well-precedented:

1. The event detail page's "Edit this game" is a plain text `Link`, alone
   at the bottom of the organizer controls, disconnected from the game
   title it edits — the app has an established pattern for exactly this
   (a small pencil inline beside the name it edits, `DashboardHeader`'s own
   "Manage a club" pencil), and this control never adopted it.
2. `app/friends.tsx` has no back link. Its own docstring explains why: an
   earlier version dropped an inherited back link on the premise that the
   Profile tab already reaches `/profile`. But that's the exact reasoning
   the back-links work already overturned for four other screens — an
   "active" tab reads as "you are here", not "go back" — and `friends.tsx`
   fits the identical shape (`active="profile"`, reached by pushing from
   Profile) without ever getting the same fix.

---

## The shape

### 1. Edit-game pencil

`app/clubs/[id]/events/[eventId]/index.tsx`'s title row
(`<View style={styles.row}><Text style={styles.heading}>{event.title}</Text>{cancelled tag}</View>`)
gets a small `<PencilIcon size={16} color={colors.accentColor} />` inside a
`Pressable`, nested with the title in its own inner row so the pencil sits
immediately beside the name rather than floating in `row`'s
`space-between` gap against the Cancelled tag. Same gate the old link had
(`isOrganizer && event.status !== 'cancelled'`), same destination
(`/clubs/${clubId}/events/${eventId}/edit`). Accessible label composes the
title, matching `DashboardHeader`'s own "Manage {name}" convention:
`Edit ${event.title}`.

The old bottom `Link`/`styles.linkRow`/`styles.link` are deleted outright —
confirmed they have no other use in this file (`Link` from `expo-router` is
imported for this one call only).

### 2. Friends page back link

`app/friends.tsx` gains the same ghost-`Button`-plus-`ChevronLeftIcon`
pattern used everywhere else, first child of the populated `Screen`,
pushing `/profile` — reusing `app/notifications.tsx`'s own existing
`accessibilityLabel="Back to profile"` (that screen already reaches Profile
the same way; no new label invented). The file's docstring paragraph
explaining the *absence* of a back link is rewritten to explain its
*presence* instead, citing the same correction the back-links design
already made for the club detail, new-club, new-message and check-in
screens.

`app/friends.tsx` doesn't import `useRouter` today (only `Redirect`) — this
adds it. `app/__tests__/friends.test.tsx`'s `useRouter` mock currently
returns a **fresh `vi.fn()` per call** (`useRouter: () => ({ push: vi.fn(),
back: vi.fn() })`), which cannot be asserted against — this needs hoisting
to a module-level `const push = vi.fn();`, matching every other test file
in this app, before a back-link test can assert on it.

---

## What this touches

- `app/clubs/[id]/events/[eventId]/index.tsx` — title row, imports
  (`Pressable` added to the `react-native` import, `PencilIcon` added to
  the icons import, `Link` removed from the `expo-router` import), two
  dead styles removed.
- `app/friends.tsx` — new import, new back button, new style, docstring
  rewrite.
- `app/__tests__/events-detail.test.tsx` — the "shows the edit link..."
  test renamed and switched from a text query to a role query (the label
  is icon-only now); a new test asserting the pencil's actual navigation,
  which nothing tested before (the old `Link`'s destination was never
  asserted, only its visible text).
- `app/__tests__/friends.test.tsx` — the `useRouter` mock's `push` hoisted
  to module scope; a new back-link test.

---

## Not in scope

- **The "Alerts" module.** Handled separately — it needs real backend
  design work (a new RLS policy on a table deliberately built unreadable,
  plus a new feed screen), not a quick fix alongside these two.
- **Any other control on the event detail page or the friends page.**
