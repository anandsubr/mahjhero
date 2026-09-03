# Mahjong Tile Navigation Design

## Goal

Give the app's persistent chrome — the bottom tab bar, and the top of each of
its four sections — a real mahjong feel, using the same tile styling already
built for the signed-out welcome screen's hero (`app/welcome.tsx`'s
`TileHero`), rather than inventing a new visual language.

## Background

`app/welcome.tsx` already draws three free-standing, gently fanned mahjong
tiles as decoration: a proper tile shape (rounded rect, `colors.surface`
fill, a raised ivory "lip" via `borderBottomWidth`/`borderBottomColor`, a
soft `shadow.sm`), each showing one real suit or honor glyph — dots
(three stacked circles), bamboo (three stalks with cross-ties), and the red
dragon character `中` on a solid-accent tile. This spec reuses that exact
chrome for two purposes elsewhere in the app, arrived at after comparing
several rounds of live-rendered options:

1. Flat colored boxes with just a word (rejected — read as generic chips,
   not tiles).
2. The real tile chrome (shadow, lip, surface fill) with just a word
   (closer, but still didn't read as a mahjong tile without a glyph).
3. **The real tile chrome with a suit/dragon glyph above the label**
   (approved) — this is what's specified below.

## Scope

### 1. The bottom tab bar becomes four tiles

`components/TabBar.tsx` is shared, persistent chrome — rendered by every
screen in the app (24 files across the four sections, not just the four
landing screens). Its four buttons change from icon-above-label to
tile-above-label:

- Tile chrome, scaled from `TileHero`'s real values: ~70×77px (not
  70×96 — reduced ~20% from the first full-height pass, confirmed as the
  right size for legibility), `border-radius: 12`, `colors.surface` fill,
  `borderBottomWidth: 3` in `colors.neutral[200]`, `shadow.sm`. Upright, no
  rotation — this is a functional nav row, not decoration.
- Each tile shows a real suit/honor glyph above its label (label at the
  tile's bottom edge, not centered):
  - **Club** — dots (three stacked circles, `TileHero`'s exact SVG,
    `colors.accentColor` stroke)
  - **Messages** — bamboo (three stalks + cross-ties, `TileHero`'s exact
    SVG, `colors.accent2[600]` stroke)
  - **Profile** — 中 (red dragon character, `colors.accentColor` text —
    the authentic ink color for this tile in real mahjong sets)
  - **Alerts** — 發 (green dragon character, `colors.accent2[700]` text —
    likewise the authentic ink color)
- The selected tab's tile switches to `TileHero`'s accent-tile treatment:
  `colors.accentColor` fill, `accent[700]` lip, glyph and label both in
  `colors.bg`. This replaces the current `accent[700]`-vs-`neutral[700]`
  tint swap — selection is now a tile-color change, not a text/icon-color
  change.
- The existing unread-badge dot (Messages, Alerts) stays, positioned at
  the tile's corner instead of the icon's corner.
- Label stays each tab's existing text (`Club`, `Messages`, `Profile`,
  `Alerts`) — only the visual treatment changes, not the copy, routing, or
  `active`/selection logic in `TabBar.tsx`.

### 2. A small matching tile before each landing screen's own title

On exactly the four top-level screens the tab bar's four buttons lead to —
`app/clubs/index.tsx`, `app/messages/index.tsx`, `app/profile.tsx`,
`app/alerts.tsx` — a small (~30×40px, same chrome scaled down further,
`borderBottomWidth: 2`) decorative tile sits immediately before that
screen's own heading, showing **the same glyph as that section's tab**:
dots before "Your clubs", bamboo before "Messages", 中 before "Your
profile", 發 before "Alerts". Purely decorative, matching `TileHero`'s own
`aria-hidden`/`accessibilityElementsHidden` treatment — it reinforces which
section you're in, it isn't a control.

This does **not** extend to nested screens under each section (event
detail, thread detail, friends, notifications, venues, etc.) — only the
four landing screens themselves, matching today's scope of "the main four
pages."

`app/clubs/index.tsx`'s own heading is `components/DashboardHeader.tsx`,
a shared component with two internal shapes (a flat kicker/name/meta block
for "all clubs", and a centered avatar+name-pill block for a single-club
scope) that is also reused, unmodified, by `app/clubs/[id]/index.tsx` and
`app/clubs/[id]/venues.tsx` — screens that must **not** gain this tile. The
tile therefore sits as a sibling row directly above `app/clubs/index.tsx`'s
own `<DashboardHeader ... />` call, not inside `DashboardHeader.tsx` itself,
so the other two screens that render that same component are untouched.

## Decisions locked during brainstorming

| # | Decision |
|---|---|
| 1 | Reuse `TileHero`'s real chrome (shadow, lip, surface fill, radius) — not a new, flatter visual style. |
| 2 | Tab bar tiles carry a glyph above the label, not label-only — confirmed by live comparison. |
| 3 | Tab tile size: ~70×77px (20% shorter than the first full-height pass). |
| 4 | Glyph-to-tab mapping: Club=dots, Messages=bamboo, Profile=中 (red), Alerts=發 (green) — authentic suit/ink pairing, chosen for visual variety, not semantic meaning (there's no "correct" mahjong glyph for a profile screen). |
| 5 | The landing-page tile matches its own section's tab glyph, so the same tile face appears at both the top and bottom of a section's screens. |
| 6 | Tab bar tiles stay upright — no rotation. Rotation is `TileHero`'s decorative-hero-only treatment. |
| 7 | Selected-tab styling moves from a tint swap to `TileHero`'s solid accent-tile treatment (whole tile re-colors, not just the glyph/text). |

## Open items for the implementation plan to resolve

- Exact glyph/label sizing inside the 70×77 tile (tested visually in
  mockup; needs porting to real `StyleSheet` values, not copied from a
  browser mockup pixel-for-pixel).
- `app/clubs/index.tsx`'s exact current render branches (it has a
  fallback plain-heading path in addition to `DashboardHeader`, per its
  own code) — the plan should place the tile so it works identically
  across every branch that screen can render.
- Whether the tab bar's overall height needs to grow to fit the taller
  tiles without cramping `paddingTop`/`paddingBottom`, and if so by how
  much.
- Accessibility labels for the tab buttons are unchanged (`${tab.label}${unreadSuffix}`)
  — only the visual content behind that label changes.

## Testing

- `components/TabBar.tsx`'s existing tests (roles, labels, selection,
  unread badges, navigation) should keep passing unchanged — this is a
  purely visual restyle, not a behavior change.
- New tests: each landing screen renders its own tile-before-title, with
  the correct glyph, and does not render on nested screens under that
  section (spot-check one, e.g. `app/clubs/[id]/index.tsx`, does not gain
  a tile).
- A visual check (browser preview, matching this branch's established
  practice of live-verifying layout/contrast fixes) of the tab bar at
  mobile width, and of at least the Clubs landing screen in both its
  "all clubs" and "single club" `DashboardHeader` shapes.

## Post-implementation refinements (landed after the design above)

Two smaller adjustments made directly during implementation review, not
worth their own brainstorming round:

- **The Clubs landing screen's tile now sits inline with "Your clubs"**,
  not stacked on its own row above the whole header block — matching
  every other landing screen's inline treatment. `DashboardHeader` gained
  an optional `titleAccessory` prop (rendered inline before `name`, flat
  shape only) for this; its other two callers never pass it, so they're
  unaffected. The centred "Your club" (single-club) shape has no
  comparable inline slot and keeps its own tile as a separate centred
  sibling above the block, unchanged.
- **The tab bar no longer paints its own background** — each tile already
  carries its own surface fill and shadow, so the bar itself is
  transparent and the four tiles float directly on the screen's own
  background instead of sitting on a same-toned strip.

## Addendum: club chips become mahjong tiles

A further request, explored the same way as the sections above (live
mockups, iterative comparison): `components/ClubChips.tsx` — the
club-switcher row shown on the Clubs landing screen whenever no single
club is resolved into view (see "Scope for this addendum" below) — turns
each club's circular initials-avatar into a small mahjong tile, and the
screen drops its "Your clubs" header line entirely in that state, letting
the chip row become the first thing on the page.

### Design (approved via mockup)

- Each chip becomes a ~48×60px tile, same chrome family as the rest of
  this spec (`colors.surface` fill, ivory lip, `shadow.sm`, radius
  scaled down from the tab/section tiles' 12 — exact value for the
  implementation plan to pick, tested small in the mockup).
- **Glyph on top, the club's initials (`lib/dashboard.ts`'s existing
  `initialsFrom`) below, on the same tile face** — approved directly over
  an alternative (initials dominant, glyph as a small corner badge) after
  a live side-by-side comparison.
- The club's name stays below the tile, unchanged from today's
  below-avatar label.
- Selected-state styling matches the nav tiles' own convention: the
  active chip's tile switches to the solid accent-tile treatment
  (`accent[700]` fill / `accent[800]` lip, per this spec's own contrast
  fix — **not** `accentColor`) rather than today's ring-around-the-circle
  border. In practice this state is transient — see "Scope for this
  addendum" below for why a selected chip's own row disappears on the
  very next render — but the styling should still be correct for
  whatever brief window it's visible.
- The "New club" tile keeps its own distinct treatment (outlined, not
  filled — it's an action, not a club) at the same new tile size/shape.

### Glyph assignment (a genuinely new problem this piece introduces)

Unlike the four nav sections (a fixed, hand-picked 1:1 mapping), a member
can belong to any number of clubs. Decided:

1. **The glyph set expands** beyond the nav's four (dots, bamboo, 中, 發)
   to include the four wind honor tiles — 東 (east), 南 (south), 西
   (west), 北 (north) — eight glyphs total. Real mahjong's third dragon,
   白 (white), is deliberately **excluded**: it is traditionally a truly
   blank tile face, which would read as a broken/missing icon in this UI
   rather than a deliberate design choice. The "characters" numbered suit
   (万) is also excluded — it needs a numeral *and* a character together,
   more artwork than this addendum's scope justifies for a purely
   decorative avatar.
   - Wind ink color: real mahjong sets print winds in plain black, not
     the reds/greens dragons and colored suits get. This app's palette
     has no black; use `colors.text` for all four, on the same reasoning
     `MahjongTile`'s existing suits already use per-glyph authentic ink.
2. **Each club's glyph is stable, not random per render** — derived
   deterministically from the club's own `id` (a hash into the 8-glyph
   set), so a given club always shows the same tile face to every member
   who sees it, not just within one session. The exact hash function is
   an implementation-plan detail (a simple, well-tested string hash is
   sufficient — this has no security or collision-resistance
   requirement, only "stable and reasonably spread across 8 buckets").

### Scope for this addendum

`ClubChips` already renders in exactly one condition today
(`app/clubs/index.tsx`): `!list.some((club) => club.id === selected)` —
i.e. no single real club is currently resolved into view. This is
**not** the same condition as `DashboardHeader`'s own flat-vs-centered
shape choice — `lib/dashboard.ts`'s `headerScope` independently resolves
a *lone* club (`clubs.length === 1`) into the centred "Your club" shape
even while `selected` is still the `ALL_CLUBS` sentinel, so a one-club
member sees the chip row *and* the centred single-club header at the
same time today. Dropping "the top line with the tile and 'Your Clubs'"
therefore means exactly this: when `headerScope` resolves to its
flat, no-real-club-selected shape (`kicker === ''`, `name === 'Your
clubs'`) — **and only then** — skip rendering `DashboardHeader`
entirely, letting `ClubChips` (now tile-based) be the first content on
the page. The centred "Your club" shape (a real, named club — whether
because the member has exactly one, or has actively filtered into one)
is untouched by this addendum: it keeps showing its own header exactly
as today, with `ClubChips` still appearing below it whenever the
existing visibility condition says to.

The already-empty-of-clubs state (`list.length === 0`, a distinct early
return in `app/clubs/index.tsx` with its own "you are not in a club yet"
copy) is **not** affected by this addendum — there is nothing to lead
with as "the clubs, first line" when there are none, so that branch
keeps its header exactly as the earlier section of this spec left it.

### Testing

- `components/ClubChips.tsx`'s existing tests (chip rendering, selection,
  the New Club tile, unread badges) should be updated for the new tile
  markup but keep asserting the same underlying behavior — nothing about
  *what* a tap does changes, only how each chip looks.
- A new test for the glyph-assignment function: stable across repeated
  calls with the same id, and produces a value from the 8-glyph set for
  a range of sample ids (not a statistical distribution test — this has
  no fairness requirement, just "doesn't crash, doesn't return outside
  the set").
- A test confirming `app/clubs/index.tsx` does not render
  `DashboardHeader` at all when `headerScope` resolves to its flat,
  no-club-selected shape, and does render it (centred shape) when a lone
  or filtered-in club resolves — both already-reachable states in that
  screen's existing test fixtures.
- A live visual check (this branch's established practice) of the chip
  row at a plausible club count (e.g. 3-4 clubs plus the New Club tile),
  confirming legibility of glyph+initials together at the small tile
  size and that wrapping still behaves sensibly at various widths.
