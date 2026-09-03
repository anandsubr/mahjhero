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
