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

> **Superseded for the Clubs section (Addendum 2):** decision #5 no longer
> holds for Clubs specifically. Addendum 2 replaced the fixed "dots" glyph
> at the top of the Clubs section with a per-club glyph (`glyphForClub`),
> shown only in the single-club scope, while the flat all-clubs scope's
> *populated* branch (several clubs, none selected — where `ClubChips`
> leads the page instead) shows no header tile at all. The flat shape's
> other two branches (`loadFailed`, and the empty-clubs-list "you're not
> in a club yet" state) still show the original fixed dots tile, since
> neither of those has a chip row to lead with instead. So there is no
> longer one fixed tile face shared between the Clubs tab and every Clubs
> screen's own heading. Messages, Profile, and Alerts are unaffected;
> decision #5 still holds for those three sections as originally written.

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

## Addendum 2: the club's own tile representation, everywhere a club is shown large

The addendum above covers the *chip* (club switcher) size. This one
carries the same idea — a mahjong tile with the club's own stable glyph
plus its initials — to every place a club gets a large, header-sized
circular avatar today, and tightens one layout that reads oddly once a
tile sits inside it.

### Where a large club avatar exists today

Every one of these renders `ThreadAvatar` with `kind="club"` at
`size={72}` (a `72px` circle, `colors.accent[700]` fill, plain
initials — confirmed by reading `components/ThreadAvatar.tsx` and every
call site directly, not assumed):

1. `components/DashboardHeader.tsx`'s own centred "Your club" shape
   (`kicker === 'Your club'`) — reached via `app/clubs/index.tsx` (a
   member's own single club, whether because they have only one or have
   filtered into one) **and** `app/clubs/[id]/index.tsx` (the club's own
   detail/management page, reached via the pencil — this addendum's
   "club edit page").
2. `app/messages/club/[threadId]/index.tsx`'s own header (the ongoing
   club message board — this addendum's "club messages page").
3. `app/messages/club/new.tsx`'s header (the new-club-thread composer) —
   not explicitly named in the request, included here for consistency
   since it is architecturally the same call (same component, same
   size, same `kind`) as (2); flag during spec review if this one should
   stay circular instead.

`ThreadAvatar` is **also** used at its smaller `52px` default by
`components/ThreadRow.tsx` for every thread row in the Messages list
(club threads included) — this is a *different, much smaller* context
where several avatar kinds sit side by side in a scrollable list, and
turning club rows there into tiles was not requested and is explicitly
**out of scope**: only the three `size={72}` header uses above change.

### The mechanism: an opt-in `asTile` treatment on `ThreadAvatar`, not a new component

`ThreadAvatar`'s `kind === 'club'` branch gains an additional, **opt-in**
tile rendering — a `colors.surface`-filled tile (`TileHero`'s chrome
family, same as every other tile in this spec) showing the club's own
stable glyph (Addendum 1's 8-glyph, hash-of-`id` set — the *same*
glyph a club's chip already shows, computed the *same* way, so a
member sees one consistent face for "this club" everywhere) above its
initials, matching Addendum 1's chip content shape but at a larger,
header-appropriate size.

- Default behavior is **unchanged** for every existing caller —
  `ThreadRow.tsx`'s list rows, and any future caller that doesn't ask
  for the tile, keep the plain circle exactly as today. This is an
  additive, opt-in prop, not a redefinition of what `kind="club"` means.
- The three header call sites above pass whatever new prop(s) turn this
  on, plus the club's own `id` (needed for the glyph hash — `name` alone
  isn't enough, unlike the plain circle which only ever needed initials).
  `DashboardHeader.tsx` itself doesn't currently receive a club id at
  all — it will need one threaded in from both of its "Your club"-shape
  callers to pass down to its own internal `ThreadAvatar` call.
- The `direct`/`game`/`group` kinds are untouched — this only ever
  branches inside the existing `kind === 'club'` case.

### Tighter top row for `app/clubs/index.tsx`'s single-club header

The exact layout the request's screenshot flagged as odd: today, when a
member's own single club resolves into view on the Clubs *dashboard*
(not the club's own detail page), the page stacks — a decorative tile
(Task 3 of this same plan's own sibling-tile-above-the-centred-shape
choice) — *then*, on its own row below that, a back-chevron and a ⊕
"add a game" button — *then* the circular avatar — *then* the name pill
— *then* the meta line. Four stacked rows before any real content,
with the tile floating disconnected above the back/plus row it has
nothing to do with.

**New layout, this screen only:** one row — back-chevron (left) → the
club's own tile, now carrying the glyph+initials this addendum adds
(centre) → ⊕ "add a game" (right) — replacing all of the above. Name
pill and meta stay below that row, as today. This absorbs Task 3's
separate sibling tile entirely (it's now *inside* the same row as the
back/plus controls, not a disconnected element above them) and replaces
the plain circular avatar with the tile.

This is scoped to `app/clubs/index.tsx`'s own single-club state
specifically — confirmed during brainstorming that `app/clubs/[id]/index.tsx`
(the "club edit" page) keeps its current structure (its own separate "←
Clubs" ghost button above the header, per its own established, unrelated
design) and only swaps its avatar for the tile — it does not gain this
tighter combined row, since that page never had a back/plus row inside
`DashboardHeader` to begin with (it passes neither `onPressBack` nor
`onPressAddGame` today).

### The "club game page": a new small tile, not a modified avatar

`app/clubs/[id]/events/[eventId]/index.tsx` (a single game's own
screen — round timer, seat tiles, the works) shows the club's name today
as plain kicker text (`styles.clubKicker`, added earlier in this
session's own separate game-screen-cleanup work) with **no avatar of any
kind**. "Carrying the representation" here means adding a small
decorative tile before that existing text — the same `MahjongTile`
`size="section"` treatment the four nav landing pages already use, with
this specific club's own stable glyph (via the same hash-of-`id`
function Addendum 1 introduced) rather than one of the four fixed
nav-section glyphs. No initials here — matching the nav section tiles'
own "just the glyph, the real text carries the name" precedent, not the
chip/header tiles' "glyph plus initials" combination (there's no room
for both at this small, purely-decorative size, and the club's full name
is already right next to it).

### Open items for the implementation plan to resolve

- The exact new prop name(s) on `ThreadAvatar` (e.g. `asTile` +
  `clubId`) and on `DashboardHeader` (e.g. `clubId`) — functionally
  specified above, naming left to the plan.
- The large tile's exact pixel size (72px circle replaced by a tile —
  probably close to, not necessarily identical to, Addendum 1's 48×60
  chip size; needs a live check, not an assumption, the same way every
  other size in this spec was tested before being locked in).
- Whether `app/messages/club/new.tsx` gets the tile treatment (see
  above — included by default for consistency, flag during spec review
  to exclude it instead).
- Confirm `app/clubs/[id]/index.tsx`'s own `club` object (fetched
  elsewhere in that file) already carries an `id` field ready to pass
  through — expected, given `[id]` is the route's own club id, but worth
  a one-line confirmation rather than an assumption.

### Testing

- `ThreadRow.tsx`'s existing tests (list-row rendering, all four kinds)
  must keep passing unchanged — the opt-in prop's default path is
  exactly today's behavior.
- Each of the three (or four, pending the open item above) header call
  sites gets a test confirming the tile — and the correct, *stable*
  glyph for a given club id — renders instead of the plain circle.
- A test that two DIFFERENT club ids can (not must, given only 8
  buckets) resolve to different glyphs, and that the SAME club id always
  resolves to the same glyph as its own chip elsewhere (Addendum 1) —
  the one-club-one-face guarantee this whole addendum exists to keep.
- A live visual check of `app/clubs/index.tsx`'s new combined top row
  (back/tile/plus in one row) at mobile width, and of the game screen's
  new small club tile sitting next to its existing kicker text.

## Addendum 3: club-identity consistency, live-only rounds/timer, and an admin-managed daily greeting

A follow-up request after living with Addenda 1-2, driven by two reference
screenshots (a clean club-identity header, and the home grid's tile row)
and a fresh look at four screens side by side.

### Part A — club tile+name consistency across every context

Read fresh, not assumed, before deciding what to change:

1. **Home dashboard's club chips** (`components/ClubChips.tsx`) — already
   the correct "grid" shape from Addendum 1 (tile above, initials+name
   below). The one bug: the name `Text` at `ClubChips.tsx:80-82` is
   `numberOfLines={1}`, so a longer name ("Tuesday Circle", "West
   Chapter") truncates with an ellipsis instead of wrapping to a second
   line the way the reference screenshot shows. **Fix:** raise to
   `numberOfLines={2}` — `styles.tile` (`width: 64`, centered text) needs
   no other change to wrap cleanly.
2. **Club Dashboard and Club Edit headers** — both already render
   `DashboardHeader`'s `kicker === 'Your club'` shape (`ThreadAvatar
   asTile`, the 48x60 chip, name pill below) — the correct "header" shape
   from Addendum 2, and already shared correctly between the two screens.
   No change needed to tile/name styling itself. What IS wrong: Club Edit
   duplicates its back control — a standalone ghost `Button` reading
   "Clubs" sits above the header (`app/clubs/[id]/index.tsx:172-181`),
   while the header's own built-in chevron slot (`clubTopRow`) sits empty
   because that `DashboardHeader` call passes no `onPressBack`
   (`183-188`). **Fix:** delete the ghost Button block entirely and pass
   `onPressBack={() => router.push('/clubs')}` into the existing
   `DashboardHeader` call — the exact prop `app/clubs/index.tsx` already
   uses for its own back-to-all-clubs chevron. One header block, one back
   control, matching Club Dashboard's own shape exactly — no new
   component required. One real difference to carry along:
   `app/clubs/index.tsx`'s own `onPressBack` clears a client-side filter
   ("all clubs" again), while Club Edit's is real navigation back to
   `/clubs` — the chevron's hardcoded `accessibilityLabel="Clear club
   filter"` (`DashboardHeader.tsx:96-97`) would misdescribe the latter.
   `DashboardHeader` needs a new optional `backLabel` prop (defaulting to
   today's "Clear club filter" so `app/clubs/index.tsx` is unaffected),
   with Club Edit passing "Back to your clubs" — the exact label its
   deleted ghost Button used — so assistive tech still hears the right
   thing.
3. **Message board header** (`app/messages/club/[threadId]/index.tsx`,
   and the same pattern in `[postId].tsx` / `new.tsx`) — already calls
   `ThreadAvatar kind="club" asTile size={72} clubId={...}`. Since
   `ThreadAvatar`'s `asTile` branch (`ThreadAvatar.tsx:63-72`) always
   renders `MahjongTile size="chip"` regardless of the `size` number
   passed in, this already renders byte-identical tile chrome to Club
   Dashboard/Club Edit today. **No change needed here** — this screen is
   already consistent; the `size={72}` prop is simply dead code on this
   branch, worth a one-line comment but not a functional fix.
4. **Game screen header** (`app/clubs/[id]/events/[eventId]/index.tsx:728-749`)
   — the one genuinely inconsistent case. It already has the right
   *structure* (back chevron, then tile, then club name, all in one row,
   `headerRow`) — but the tile itself is `MahjongTile size="section"`
   (30x40, no initials label), the small decorative form Addendum 1 built
   for the four nav landing pages, not the 48x60 chip-with-initials form
   every other club-identity context uses. **Fix:** swap it for the same
   `ThreadAvatar kind="club" asTile clubId={clubId} name={club.name}`
   used everywhere else, keeping the existing `View testID="section-tile"`
   wrapper around it (so `events-detail.test.tsx`'s existing scoped query
   keeps working unchanged) and the existing `clubKicker` text styling
   (already the correct uppercase/accent look — no text change needed).
   This supersedes one piece of Addendum 2 for this specific consumer
   only (`MahjongTile.tsx:120-124`'s own doc comment calls out "a single
   game's own screen ... size 'section'"); the four nav landing pages
   keep their `section` tiles unchanged.

No new shared component anywhere in Part A — every context already has
the right building block. This is three small, targeted fixes (#1, one
prop wired through in #2, one swap in #4) rather than a refactor.

### Part B — rounds and the timer show only while the game is live

`app/clubs/[id]/events/[eventId]/index.tsx` already computes `gameLive`
(lines 445-448: `status === 'published' && starts_at <= now < ends_at`),
today used only to gate `canRecordRound`. `TableCard`
(`components/TableCard.tsx`) always renders `RoundLog` and `RoundTimer`
regardless of that. **Fix:** thread `gameLive` down as a new prop to
`TableCard`, and render the `RoundLog`/`RoundTimer` block only when it's
true — before the game starts and after it ends, that block disappears
entirely; the seat/table roster underneath stays visible throughout,
unaffected.

### Part C — Club Dashboard's game row: three aligned lines

`GameRow` (`app/clubs/index.tsx:627-732`)'s body (`gameBody`, lines
686-693) currently shows three lines of very different weight: a small
caps club-name kicker, a bold event title, then one combined "when ·
venue" line. **New shape:** three lines of comparable weight — **club
name**, **time only**, **venue** — replacing all three current lines.
The event's own title is dropped from this row entirely (still the
heading of the screen you land on after tapping through; the date badge
plus club name/time/venue already identify the row in the list). This
needs one new formatter beside `formatEventWhen` in `lib/events.ts` —
`formatEventTime(startsAt, timezone, locale?)`, the same
`Intl.DateTimeFormat` call minus `weekday`/`day`/`month` — since the
`DateTile` badge already to the row's left already carries the day/date,
and showing it twice was exactly the "time only, as the date repeats"
complaint. The badge's own size (52x70) already sets the row's height;
the three text lines just need even spacing within `gameBody`.

### Part D — a daily, admin-managed greeting on the Dashboard

Net-new — nothing like this exists in the app today.

- **Admin flag** — a new migration adds `is_admin boolean not null
  default false` to `public.profiles`, seeded `true` for the requesting
  user's own account (matched by email against `auth.users`, since
  `profiles` itself carries no email column).
  `lib/schema-contract.test.ts:272`'s column whitelist needs `is_admin`
  added alongside the new column, or that test fails on the very next
  schema read.
- **Storage** — a new `public.greetings` table: `id uuid primary key
  default gen_random_uuid()`, `text text not null` (a template
  containing a literal `{name}` token), `created_at timestamptz not null
  default now()`. RLS: any signed-in member can `select`;
  `insert`/`update`/`delete` require the caller's own `profiles.is_admin
  = true`. A new `lib/greetings.ts` exposes `fetchGreetings()`,
  `addGreeting(text)`, `updateGreeting(id, text)`, `deleteGreeting(id)` —
  the same shape `lib/profile.ts`'s own functions already follow.
- **Daily pick** — deterministic, not re-rolled per render: hash today's
  local calendar date (`YYYY-MM-DD`) into an index over the fetched
  greeting list, so every user sees the same greeting all day and it
  changes at local midnight. An empty list means the dashboard simply
  shows no greeting line — not an error state.
- **Personalization** — the signed-in profile's `display_name` (via
  `lib/profile.ts`'s existing `fetchProfile`, not currently called from
  `app/clubs/index.tsx` — this adds that one call) replaces the
  template's `{name}` token. An empty `display_name` (a real, reachable
  state — see `app/clubs/[id]/index.tsx:236-238`'s own existing "Member"
  fallback) substitutes the same fallback word used there, rather than
  rendering "Hi , ready...".
- **Display** — a new heading at the very top of `app/clubs/index.tsx`,
  above `DashboardHeader`/`ClubChips`, styled with `type.heading`
  (Caprasimo) — the same font `app/welcome.tsx`'s own headline uses — at
  a size suited to an in-app screen heading (e.g. `profile.tsx`'s own
  `type.size.h2` treatment) rather than the welcome screen's larger
  marketing `type.size.display`.
- **Admin management UI** — a new screen (e.g. `app/admin/greetings.tsx`)
  listing every greeting with edit/delete plus an add field, following
  `app/profile.tsx`'s existing `Card`/`settingsRow` visual pattern.
  Linked from Profile via one new `Card`
  (`settingsCard`/`settingsRow`/`settingsLabel`/"Manage" `editLink`,
  copying the existing "Friends" card's exact shape at
  `app/profile.tsx:218-226`), rendered only when the loaded profile's
  `is_admin` is true.

### Decisions locked during brainstorming (Addendum 3)

| # | Decision |
|---|---|
| 1 | No new shared "ClubTile" component — every context already has the right building block; this is targeted fixes, not a refactor. |
| 2 | Admin is a new `profiles.is_admin` boolean, not a reuse of per-club host/co-organizer roles. |
| 3 | Greeting template holds a `{name}` placeholder, filled from `display_name` at render time. |
| 4 | Greeting changes once per calendar day (deterministic hash), not on every dashboard visit. |
| 5 | The game-row restructure (Part C) drops the event's own title from the row entirely. |

### Open items for the implementation plan to resolve

- Exact `formatEventTime` output format (12-hour, matching
  `formatEventWhen`'s existing `hour12: true` convention) and the exact
  line spacing/sizing for the three `gameBody` lines once they replace
  today's two differently-weighted ones.
- Exact heading font size token for the dashboard greeting — a live
  check against the existing dashboard layout, not an assumption.
- The date-hash function for the daily greeting pick (no security or
  uniformity requirement, only "stable across a day, spreads reasonably"
  — the same bar Addendum 1 set for `glyphForClub`'s own hash).
- Whether `is_admin` should be settable only by direct SQL for now (no
  UI to promote a second admin) — reasonable given there's exactly one
  admin today; flag if a future admin-management UI is wanted instead.

### Testing

- `components/ClubChips.tsx`: existing tests updated for
  `numberOfLines={2}`; a new case for a name long enough to wrap.
- `app/clubs/[id]/index.tsx`: a test confirming the ghost "Clubs" button
  is gone and `DashboardHeader`'s own chevron now calls
  `router.push('/clubs')`.
- `app/clubs/[id]/events/[eventId]/index.tsx`:
  `events-detail.test.tsx`'s existing `section-tile`-scoped query keeps
  passing; a new assertion that the tile inside it now carries the
  club's initials label (the chip form), not the label-less section
  form.
- `components/TableCard.tsx`: existing round/timer tests split into
  "game live" and "game not live" cases; a new test confirming neither
  renders outside the live window.
- `lib/events.ts`: a new `formatEventTime` unit test (format, and the
  existing `RangeError` guard).
- `lib/greetings.ts`: CRUD tests following `lib/profile.test.ts`'s
  existing shape; a test for the deterministic daily-pick function (same
  date -> same index; varying list lengths don't throw).
- `lib/schema-contract.test.ts`: updated column whitelist including
  `is_admin`, and a new `greetings` table contract test alongside the
  existing `profiles` one.
- A live visual check (this branch's established practice) of: the Home
  grid with a long club name wrapping to two lines; the Club Edit header
  with its single back chevron; the game screen's upsized tile; a game
  row before/during/after its live window (timer/rounds appearing and
  disappearing); and the Dashboard's new greeting line both with and
  without a `display_name` set.

## Addendum 4: the Messages list's club avatar, and an optional per-game fee

Two more requests, added before implementation began on the plan built from
Addenda 1-3.

### Part A — the Messages list's club rows get the mahjong tile too

`components/ThreadRow.tsx:69` renders every kind's avatar identically:

```tsx
<ThreadAvatar kind={row.kind} name={row.kind === 'club' ? row.club_name ?? '' : title} />
```

— no `size`, no `asTile`, no `clubId`, so a club thread gets `ThreadAvatar`'s
plain-circle fallback (`accent[700]` fill, initials), not the tile treatment
`DashboardHeader` and the club message-board header already use. The data is
already there: `ThreadListRow` (`lib/messages.ts:16-43`, what
`app/messages/index.tsx` maps over) already carries `club_id` on every row —
`app/messages/index.tsx` itself already reads `row.club_id` elsewhere
(lines 102, 107). **Fix:** pass `asTile`/`clubId` through for club rows only:

```tsx
<ThreadAvatar
  kind={row.kind}
  name={row.kind === 'club' ? row.club_name ?? '' : title}
  asTile={row.kind === 'club'}
  clubId={row.kind === 'club' ? row.club_id ?? undefined : undefined}
/>
```

Non-club kinds ignore `asTile` (`ThreadAvatar.tsx`'s tile branch requires
`kind === 'club'`), so this is a no-op for direct/group/game rows. Two small,
accepted side effects, neither worth extra code to avoid:

- The chip tile is 48px wide vs. the circle's 52px — `ThreadRow.tsx`'s
  divider (`DIVIDER_INSET = space[4] + AVATAR_SIZE + space[3]`, `AVATAR_SIZE
  = 52`) ends up 4px right of the tile's true edge on club rows. A
  sub-pixel-scale cosmetic drift on a hairline, left alone rather than adding
  a per-row-kind width calculation to chase it.
- The tile is 60px tall vs. the circle's 52px — club rows grow ~8px taller
  than other rows (the row's own `alignItems: 'center'` handles this with no
  layout risk). Visual-only, no test currently pins an exact row height.

### Part B — an optional per-game fee: cost to play and/or minimum spend

Confirmed during brainstorming: two independent optional fields (a game can
have neither, either, or both), each a flat USD amount, always per person, no
currency picker — this app has no currency/money precedent anywhere today
(grepped the whole codebase for `price|fee|cost|amount|currency|
Intl.NumberFormat`; nothing). Shown on the Dashboard's game tile only as a
small, quiet addition when actually set — never a "Free" placeholder taking
up space on the common case.

This touches every layer `check_in_required` already touches, and follows
that exact precedent throughout (same tables, same RPCs, same dual-scope
edit-screen pattern) rather than inventing a new shape:

#### Schema

`supabase/migrations/20260827000000_check_in_required.sql` is the template.
New migration adds, to BOTH `public.events` and `public.event_series`
(mirroring why `check_in_required` lives on both — a series is a template,
occurrences are its materializations, and a weekly host sets an economic fact
once, not every week):

```sql
alter table public.event_series
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);

alter table public.events
  add column fee_cents        integer not null default 0 check (fee_cents >= 0),
  add column min_spend_cents  integer not null default 0 check (min_spend_cents >= 0);
```

Stored as integer cents (not a `numeric` dollar amount) to avoid float
rounding entirely — the client converts a host's typed dollar string to
cents once, at submit, and every stored/compared value from then on is an
exact integer. `0` means "not set" — there is no meaningful difference
between "explicitly free" and "never priced" for display purposes (both mean
"show no fee badge"), so this follows the same "always a real value, never
NULL" convention `notes`/`check_in_required` already established, with no
tri-state to reason about anywhere downstream.

`events_overrides_known_keys` gains both new keys, the same
drop-and-re-add-the-constraint dance `check_in_required` used (a check
constraint's expression cannot be altered in place):

```sql
alter table public.events drop constraint events_overrides_known_keys;
alter table public.events add constraint events_overrides_known_keys check (
  overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                     'check_in_required', 'fee_cents', 'min_spend_cents']
  and array_ndims(overrides) = 1
);
```

#### RPC surface

Five functions need updating, each following the codebase's own documented
rule (`20260827010000_event_mutations_check_in.sql`'s own header comment):
**a parameter list or `returns table` column list cannot be changed with
`create or replace`** — it either creates an ambiguous overload or Postgres
outright refuses (`42P13`) — so each of these is `drop function` +
`create function`, restating the `revoke`/`grant`, with the body copied
byte-for-byte from its own **most recently redefined** version (confirmed by
grepping every migration that touches each name — not necessarily the one
that first introduced it):

1. **`create_event`** (last redefined `20260827010000`) — add
   `fee_cents int default 0, min_spend_cents int default 0` as new trailing
   defaulted params; insert both into the `events` insert list.
2. **`update_event`** (last redefined `20260827010000`) — add
   `new_fee_cents int default null, new_min_spend_cents int default null`;
   `eff_fee_cents := coalesce(new_fee_cents, ev.fee_cents)` (and the min-spend
   twin); include both in the `update ... set` list; extend the
   overrides-tracking block with the same "append the key if the effective
   value differs from the stored one, only when this occurrence belongs to a
   series" shape `check_in_required` already uses there.
3. **`create_event_series`** (last redefined `20260827010000`) — same two
   trailing defaulted params; insert both into `event_series`.
4. **`update_event_series`** (last redefined `20260827010000`) — same two
   `new_*` params defaulting to `null`; `eff_fee_cents`/`eff_min_spend_cents`
   coalesced against the series row; `touched_fee`/`touched_min_spend` gates
   computed the same way `touched_check_in` is; a propagation `update
   public.events e set fee_cents = eff_fee_cents where e.series_id =
   target_series and e.starts_at > now() and e.status <> 'cancelled' and
   (include_overridden or not ('fee_cents' = any(e.overrides)))` block (and
   its min-spend twin) alongside the existing title/venue/notes/check-in
   ones; both keys added to the overrides-clearing block under
   `include_overridden`.
5. **`my_upcoming_bookings`** (last redefined `20260827070000`, a
   `returns table` function — same drop/recreate rule applies to its OUT
   columns) — add `fee_cents int, min_spend_cents int` to the `returns
   table (...)` list and `select e.fee_cents, e.min_spend_cents` (via the
   already-joined `e` alias) to the query body.

**`materialize_one_series`** (last redefined
`20260827000000_check_in_required.sql`, unchanged signature) needs only a
plain `create or replace` (no drop needed — it takes the same two
arguments and returns the same `int`), copying `s.fee_cents, s.min_spend_cents`
into the `insert into public.events (...)` list the exact way
`s.check_in_required` already is — **this is the one function it would be
easy to forget**, and skipping it would silently leave every series-generated
occurrence at the column default (0/unpriced) regardless of what the host set
on the series.

#### Client types and reads

Following `check_in_required`'s exact footprint:

- `lib/events.ts`: `ClubEvent` and `EventSeries` each gain `fee_cents:
  number` and `min_spend_cents: number`; `OverrideKey` gains `'fee_cents'`
  and `'min_spend_cents'`; `EVENT_COLUMNS`/`SERIES_COLUMNS` gain both
  columns (`toClubEvent`/`toEventSeries` need no change — both already
  spread `...rest` from the raw row rather than naming every field).
  `createEvent`/`createEventSeries` take required `feeCents`/`minSpendCents`
  numbers (defaulting to `0` at the call site the same way `checkInRequired`
  always has an explicit value from the form); `updateEvent`/
  `updateEventSeries` take `feeCents?: number | null` /
  `minSpendCents?: number | null` (`null`/omitted = "leave this alone").
- `lib/bookings.ts`: `MyBooking` gains `fee_cents: number` and
  `min_spend_cents: number` (from `my_upcoming_bookings`'s new columns).
- `lib/dashboard.ts`: `DashboardRow` gains the same two fields;
  `buildDashboardRows` copies them from whichever branch built the row —
  the booking-sourced branch from `MyBooking`, the event-sourced branch from
  `ClubEvent`.

#### Formatting

New pure helpers in `lib/events.ts`, beside `formatEventTime`:
`formatFeeCents(cents: number): string`, a plain
`Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)` —
whole-dollar fees read as `$15`, fees with cents read as `$15.50`. A second
small helper, `parseDollarsToCents(value: string): number`, turns a form
field's raw text into cents (blank or unparseable → `0`, negative clamped to
`0` — the DB's own `check (... >= 0)` is the real backstop, this just avoids
a round-trip error for an obviously-bad client value).

#### Forms — add-game and edit-game screens

`app/clubs/[id]/events/new.tsx`'s "Require check-in" block
(`Text` label + control + `Text` help, lines 402-411) is the exact template.
Two new fields, placed right after it: `TextField label="Cost to play"
keyboardType="decimal-pad" placeholder="0.00"` and `TextField label="Minimum
spend" keyboardType="decimal-pad" placeholder="0.00"`, each backed by its own
plain string state (`feeText`/`minSpendText`, matching how every other typed
field on this screen holds a string until submit), parsed via
`parseDollarsToCents` only inside `onSave`, then passed as `feeCents`/
`minSpendCents` to `createEvent`/`createEventSeries` alongside the existing
`checkInRequired`.

`app/clubs/[id]/events/[eventId]/edit.tsx` mirrors its own existing
`checkInRequired` dual-scope machinery exactly: `OriginalOccurrence` gains
`feeCents`/`minSpendCents`; the screen gets `eventFeeText`/`seriesFeeText`
(and the min-spend twins) as separate state, seeded from the occurrence and
the series row respectively — **never cross-seeded**, for the identical
reason this file's own header comment already gives for
title/venue/notes/check-in (an overridden occurrence's values differ from
the series precisely because they're overridden; sharing state across scopes
silently rewrites every future week the moment "The whole series" is chosen
with nothing changed). "This game" sends `feeCents`/`minSpendCents` to
`updateEvent` only when the parsed value differs from
`original.feeCents`/`original.minSpendCents` (same changed-only gate every
other field on that path already uses); "The whole series" sends both
unconditionally to `updateEventSeries`, safe for the same reason it already
is for title/venue/notes/check-in (seeded from the series row, so an
untouched field round-trips as a no-op through the RPC's own `coalesce`
gate).

#### Dashboard display

`app/clubs/index.tsx`'s `GameRow` (its body already restructured to three
lines by this plan's Task 5 — club name / time / venue) gets a fourth,
conditional line: `{(row.feeCents > 0 || row.minSpendCents > 0) ? <Text
style={styles.gameFee}>{feeLine}</Text> : null}`, where `feeLine` joins
whichever of `` `${formatFeeCents(row.feeCents)} to play` `` / `` `${
formatFeeCents(row.minSpendCents)} min spend` `` apply (both, joined by
` · `, when a host set both). Nothing renders for the common free-game case —
matching the "small badge/line, only when set" decision, not a
consistently-reserved "Free" slot.

### Decisions locked during brainstorming (Addendum 4)

| # | Decision |
|---|---|
| 1 | Cost-to-play and minimum-spend are two independent optional fields, not one relabeled field. |
| 2 | Flat USD, always per person, no currency selector — matches this app's existing simplicity and its total lack of any prior money-handling code. |
| 3 | Stored as integer cents, not a `numeric` dollar column — avoids float rounding at every layer above the database. |
| 4 | `0` means "not set"; there is no separate NULL/"unset" state — same "always a real value" convention `notes`/`check_in_required` already follow. |
| 5 | Both fields live on `events` AND `event_series`, and are `overrides`-eligible per occurrence — the exact same shape `check_in_required` already established, not a new pattern. |
| 6 | The Dashboard tile shows the fee only when set, as a small extra line — never a reserved "Free" placeholder. |

### Open items for the implementation plan to resolve

- Exact copy for the fee line's join when both cost-to-play and min-spend
  are set on the same game (a straw draft is above; needs a live check like
  every other copy/layout decision on this branch).
- Whether the add/edit forms validate an absurdly large fee client-side
  (e.g. a typo'd `$1500` for `$15`) — the spec takes no position; the
  database's only real constraint is non-negativity, and the implementation
  plan should decide whether a soft warning belongs on the form or whether
  trusting the host is enough (this app has no other input-typo guards of
  this kind today, e.g. table count and duration are `Chip` selectors over a
  fixed set precisely to avoid this class of problem — a fee is free text by
  necessity, so it does not have that option).
- Whether `formatFeeCents`/`parseDollarsToCents` belong in `lib/events.ts`
  (co-located with the type they decorate, matching `formatEventTime`) or a
  new `lib/currency.ts` if a future feature needs money formatting for
  something other than an event — this spec defaults to `lib/events.ts` per
  YAGNI (no second consumer exists yet).

### Testing

- `components/__tests__/ThreadRow.test.tsx`: its existing
  `'shows the club's initials in the avatar for a club thread'` test moves
  from asserting `getByTestId('thread-avatar-club')` to
  `getByTestId('thread-avatar-club-tile')`. `components/__tests__/
  ThreadAvatar.test.tsx` needs no change — the `asTile` branch it already
  covers is reused verbatim, not modified.
- `lib/events.test.ts`: new tests for `formatFeeCents` (whole dollars,
  dollars-and-cents, zero) and `parseDollarsToCents` (a plain number string,
  blank, garbage text, a negative value clamped to zero).
- `lib/events.ts`'s `createEvent`/`updateEvent`/`createEventSeries`/
  `updateEventSeries` tests (`lib/events.test.ts`'s existing `describe`
  blocks for each) get a case confirming `fee_cents`/`min_spend_cents` (or
  `new_fee_cents`/`new_min_spend_cents`) are sent with the right values,
  matching how `check_in`/`new_check_in_required` are already asserted
  there today.
- `app/__tests__/events-detail.test.tsx` / the new/edit-event screen tests:
  a case for each form asserting the typed dollar amount reaches
  `createEvent`/`updateEvent` as the correct integer cents.
- `app/__tests__/clubs.test.tsx`: a case asserting the fee line appears on
  a `GameRow` only when `feeCents`/`minSpendCents` is non-zero, and asserting
  its exact joined text when both are set.
- `lib/schema-contract.test.ts`: `EVENT_COLUMNS`/`SERIES_COLUMNS`'s exact
  key-set assertions (mirroring the `PROFILE_COLUMNS` one this plan's Task 6
  already updates) gain `fee_cents`/`min_spend_cents`.
- A live visual check of the add-game and edit-game screens' two new fields,
  and of a Dashboard game tile with a fee set, matching this branch's
  established practice for every other layout change.
