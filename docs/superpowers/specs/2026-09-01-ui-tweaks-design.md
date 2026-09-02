# Seven small UI tweaks — design

**Date:** 2026-09-01
**Base branch:** cut from `main` (includes `feat/club-boards`)

---

## The problem

A grab-bag of small UI inconsistencies, gathered by eye rather than by a
single root cause:

1. The Messages list's "New" control is a text `Button`; every other
   "create" action in the app (starting a club) is a circular icon-only `+`.
2. `ClubChips` renders each club as a pill (dot + text). The app's one real
   icon-over-label pattern — `TabBar` — is more scannable at a glance and is
   what a member already reads on every screen's bottom bar.
3. Selecting a club filters `app/clubs/index.tsx`'s content, but the header
   above it still reads as a flat kicker/name/meta block. The messages board
   screens already show a club as a centred avatar with its name in a pill
   below — a stronger "this is the thing you're looking at" treatment that
   the clubs header doesn't share.
4. "Add a game" on a club's page is a labelled secondary `Button`, not the
   `+` used everywhere else a list gains an item.
5. `DashboardHeader`'s profile avatar duplicates the bottom tab bar's own
   `Profile` tab, which is reachable from every screen this header appears
   on.
6. `app/clubs/index.tsx` labels its game list "Your games" directly under a
   header that already says "Your clubs" or a specific club's name — the
   list needs no further introduction.
7. `app/clubs/[id]/index.tsx` (reached via the header's "Manage" pencil) has
   no way back except the `Club` tab, which renders as *already active* on
   that screen and so reads as "you are here", not "go back". This exact gap
   — and three sibling screens with the same shape — is already fully
   speced in
   [2026-09-01-back-links-design.md](2026-09-01-back-links-design.md); it
   was written and committed but deliberately left for its own branch, and
   was never implemented. This branch implements it rather than re-deriving
   it.

---

## The shape

### 1. Messages "+"

`app/messages/index.tsx`'s header `Button` ("New" →
`router.push('/messages/new')`) becomes a circular icon-only `+`, matching
`DashboardHeader`'s `newClub` control exactly: 50×50, 1px `textMuted`
border, transparent fill, centred `PlusIcon`. Same position (the header's
right-hand slot), same `onPress`, `accessibilityLabel="New message"`.

### 2. `ClubChips` → icon-over-label tiles

Each chip becomes a column: a small circular avatar on top (32px,
initials, same fill/initials treatment `DashboardHeader`'s avatar and
`ThreadAvatar` already use), the club's name below in `TabBar`'s label
style, `alignItems: 'center'`, in a row that still wraps
(`flexWrap: 'wrap'`) rather than scrolling — the horizontal-scroll fix from
`2026-09-01-clubs-header-actions-design.md` is preserved, only the
per-chip shape changes.

- Selected state: the avatar gets a 2px `accentColor` ring instead of the
  current leading dot (the dot has nowhere clean to sit on a tile).
- Unread badge: moves to the avatar's corner (`position: absolute`, same
  `UnreadBadge` component), off the label.
- "All clubs" tile: no club to initial, so it gets a generic glyph avatar
  (`PeopleIcon` on the same circular fill) instead of initials.
- Tap target stays the whole tile (`Pressable` wraps avatar + label), same
  `onSelect` contract, same `accessibilityLabel`.

### 3. Selected-club header: avatar + name pill + pencil

`app/clubs/index.tsx` (filtered to one club) and `app/clubs/[id]/index.tsx`
already render `DashboardHeader` with the same shape today
(`kicker="Your club", name=club.name, meta=club.rhythm`). `DashboardHeader`
gains a `club` variant for exactly that shape, replacing the flat
kicker/name/meta block with the messages-board header's own treatment:

- A small chevron-back control, top-left (see below for what it does per
  caller).
- A centred avatar (club initials, same fill as `ThreadAvatar`'s `club`
  kind) below the chevron's row.
- A name pill below the avatar (`club.name`, same pill styling as the
  messages board header), with `PencilIcon` inline beside the name text
  where `onPressScope` is supplied — this replaces today's
  pencil-next-to-kicker placement. Same `Manage ⟨name⟩` accessible label
  behaviour as today.
- `meta` (the club's rhythm), shown as a small line under the pill when
  non-empty, same as today.

The all-clubs shape (`kicker: '', name: 'Your clubs'`) and the Venues
screen's shape (`kicker: club.name, name: 'Venues'`) are untouched — this
variant only replaces the single-club block.

**The chevron's action differs by caller, and is a new, narrow addition
distinct from item 7 below:**

- On `app/clubs/index.tsx`, it clears the club filter
  (`setSelected(ALL_CLUBS)`, client state, no navigation) — the same effect
  as tapping the "All clubs" tile. `accessibilityLabel="Clear club filter"`.
- On `app/clubs/[id]/index.tsx`, `DashboardHeader`'s new chevron is **not**
  used for navigation — that screen's way back is the separate ghost
  `Button` from `2026-09-01-back-links-design.md` (item 7), rendered above
  the header as that spec already lays out. So this screen passes no
  chevron handler to `DashboardHeader` and none is drawn there; the
  ghost-Button back link is the only "back" control on that screen. This
  keeps the two concerns (filter-clearing vs. real navigation) visually and
  mechanically separate rather than overloading one glyph with two
  meanings.

### 4. Add-a-game "+"

`app/clubs/[id]/index.tsx`'s "Add a game" secondary `Button` becomes the
same circular icon-only `+` as items 1 and 5 (50×50, outlined, `PlusIcon`),
placed at the top of the games section (where the text button sits today).
Same `mayInvite` gating, same destination
(`/clubs/${id}/events/new`), `accessibilityLabel="Add a game"`.

### 5. Remove the profile icon

`DashboardHeader`'s `avatar` `Pressable` and its `onPressAvatar` prop are
deleted outright — not hidden behind a flag, since every caller
(`app/clubs/index.tsx`, `app/clubs/[id]/index.tsx`,
`app/clubs/[id]/venues.tsx`) sits behind the same `TabBar` that already
carries a `Profile` tab.

### 6. Remove "Your games"

The `<Text style={styles.sectionTitle}>Your games</Text>` in
`app/clubs/index.tsx` and its now-unused `sectionTitle` style are deleted.
Existing spacing above the list (currently the gap between the heading and
the list) is kept as-is so the list doesn't sit flush under the chips.

### 7. Back links (implementing the existing spec)

Implements `2026-09-01-back-links-design.md` as written: a ghost `Button`
with `ChevronLeftIcon`, pushing an explicit route (never `router.back()`),
added to the four screens that spec names —
`app/clubs/[id]/index.tsx`, `app/clubs/new.tsx`, `app/messages/new.tsx`,
`app/clubs/[id]/events/[eventId]/check-in.tsx` — with the exact labels,
destinations, and accessible names that document's table specifies. No
design changes from that document; see it for the full rationale. Broadcast
pages (`broadcast.tsx`, `broadcasts.tsx`) stay out of scope, as that
document already explains: they are pure redirect stubs with nothing to go
back from.

---

## What this touches

- `app/messages/index.tsx` — item 1.
- `components/ClubChips.tsx` — item 2.
- `components/DashboardHeader.tsx` — items 3 and 5 (new `club` variant,
  avatar/pill/pencil layout, `onPressAvatar` and its control removed).
- `app/clubs/index.tsx` — items 3 (chevron clears filter) and 6 (title
  removed).
- `app/clubs/[id]/index.tsx` — items 3 (club-variant header, no chevron
  handler), 4 (add-a-game `+`), and 7 (ghost back button).
- `app/clubs/new.tsx`, `app/messages/new.tsx`,
  `app/clubs/[id]/events/[eventId]/check-in.tsx` — item 7 only.
- `components/icons.tsx` — no new icons; `PlusIcon`, `PencilIcon`,
  `ChevronLeftIcon`, `PeopleIcon` all already exist.

**Tests.** Existing suites cover every touched screen/component
(`app/__tests__/clubs.test.tsx`, `clubs-new.test.tsx`, `messages.test.tsx`,
`messages-new.test.tsx`, `check-in.test.tsx`,
`components/__tests__/dashboard-parts.test.tsx`) and get updated
assertions rather than new files: button labels/roles, chevron press
behaviour, chip tile structure, and the four back-link push destinations
from `2026-09-01-back-links-design.md`'s own test plan. `e2e/visual.spec.ts`
baselines for `clubs`, `clubs-populated`, `club-detail`, `messages`,
`messages-populated`, `message-new`, and `check-in` all regenerate.

---

## Not in scope

- **Editing a club.** There is still no club-edit form; the pencil still
  opens the management screen (roster/invites/venues/import), same as
  today.
- **A visible header treatment for the broadcast redirect stubs.** Per
  `2026-09-01-back-links-design.md`, they render nothing to add a back
  control to.
- **`clubs/[id]/venues.tsx`'s header shape.** It already has its own back
  button (`import.tsx`-style ghost button, "Back to the club") and its
  `kicker: club.name, name: 'Venues'` shape is unrelated to the `club`
  variant added here.
