# Mahjong Tile Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bottom tab bar and the top of each of its four sections a real mahjong feel, reusing the exact tile chrome already built for the welcome screen's hero (`app/welcome.tsx`'s `TileHero`) instead of a new visual language.

**Architecture:** One new shared component, `components/MahjongTile.tsx`, renders a tile (chrome + a real suit/dragon glyph, optionally a label, optionally the "selected" accent-tile treatment) at one of two sizes. `components/TabBar.tsx`'s four buttons render one each (size `"tab"`, with a label). The four landing screens (`app/clubs/index.tsx`, `app/messages/index.tsx`, `app/profile.tsx`, `app/alerts.tsx`) each render one small, undecorated instance (size `"section"`, no label) immediately before their own heading. No other screen changes — every nested screen under each section keeps its existing header untouched.

**Tech Stack:** React Native + Expo, TypeScript, `react-native-svg`, Vitest + `@testing-library/react`.

**Spec:** [../specs/2026-09-03-mahjong-tile-nav-design.md](../specs/2026-09-03-mahjong-tile-nav-design.md)

## Global Constraints

- Reuse `TileHero`'s real chrome values, not new ones: `colors.surface` fill, a raised "lip" via `borderBottomWidth`/`borderBottomColor`, `shadow.sm`, rounded corners. Tab-bar tiles are **upright, no rotation** — `TileHero`'s fan/rotate treatment is decorative-hero-only.
- Glyph-to-section mapping, fixed for both the tab and its matching section tile: **Club = dots** (`colors.accentColor` stroke), **Messages = bamboo** (`colors.accent2[600]` stroke), **Profile = 中** red dragon (`colors.accentColor` text), **Alerts = 發** green dragon (`colors.accent2[700]` text). Chosen for visual variety and authentic ink colors, not semantic meaning — do not second-guess or reassign these during implementation.
- Tab tile size **70×77px** (not taller — an earlier, un-approved pass at 96px was explicitly cut ~20%). Section tile size **30×40px**. Both use `border-radius: 12` (a deliberate, non-token value, same convention `TileHero` itself already sets with its own hardcoded `15`).
- The section tile is **purely decorative** — no label, no selected/accent treatment, no press handler — matching `TileHero`'s own `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"`/`aria-hidden` treatment.
- The section tile appears on exactly the four landing screens named above, and **only** their top-level render (not nested screens under each section — event detail, thread detail, friends, notifications, venues, etc. are all out of scope and must not change).
- `components/DashboardHeader.tsx` itself must not change — it is reused, unmodified, by two screens (`app/clubs/[id]/index.tsx`, `app/clubs/[id]/venues.tsx`) that must not gain a tile. The Clubs screen's tile is a sibling row above its own `<DashboardHeader ... />` calls, not a change inside that component.
- `TabBar.tsx`'s existing behavior — routing, the "already on this route" no-op, `aria-selected`, unread badges and their composed accessible names — does not change. This is a visual restyle only. `app/__tests__/tab-bar.test.tsx`'s existing tests must keep passing unchanged.
- CJK glyphs (中/發) render in the platform's default font — do not apply `type.heading` (Caprasimo) to them; Caprasimo has no CJK coverage.

---

## File Structure

| File | Responsibility |
|---|---|
| `components/MahjongTile.tsx` | The shared tile: chrome, glyph (dots/bamboo/中/發), optional label, optional selected treatment |
| `components/__tests__/MahjongTile.test.tsx` | Unit tests for the above |
| `components/TabBar.tsx` | Renders one `MahjongTile` per tab (size `"tab"`), keeps its own routing/selection/badge logic |
| `app/clubs/index.tsx` | Renders a size-`"section"` dots tile before each of its 3 heading branches |
| `app/messages/index.tsx` | Renders a size-`"section"` bamboo tile before its heading |
| `app/profile.tsx` | Renders a size-`"section"` red-dragon (中) tile before its heading |
| `app/alerts.tsx` | Renders a size-`"section"` green-dragon (發) tile before its heading |

---

## Task 1: `MahjongTile.tsx`, the shared tile component

**Files:**
- Create: `components/MahjongTile.tsx`
- Create: `components/__tests__/MahjongTile.test.tsx`

**Interfaces:**
- Produces: `export type MahjongSuit = 'dots' | 'bamboo' | 'red-dragon' | 'green-dragon';` and `export default function MahjongTile({ suit, size, selected, label }: { suit: MahjongSuit; size: 'tab' | 'section'; selected?: boolean; label?: string })`. Consumed by Task 2 (`TabBar.tsx`, size `"tab"`) and Tasks 3-4 (the four screens, size `"section"`).

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/MahjongTile.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MahjongTile from '../MahjongTile';

describe('MahjongTile', () => {
  it('renders a label only for size="tab"', () => {
    const { rerender } = render(<MahjongTile suit="dots" size="tab" label="Club" />);
    expect(screen.getByText('Club')).toBeTruthy();

    rerender(<MahjongTile suit="dots" size="section" />);
    expect(screen.queryByText('Club')).toBeNull();
  });

  it('renders the red dragon character for suit="red-dragon"', () => {
    render(<MahjongTile suit="red-dragon" size="tab" label="Profile" />);
    expect(screen.getByText('中')).toBeTruthy();
  });

  it('renders the green dragon character for suit="green-dragon"', () => {
    render(<MahjongTile suit="green-dragon" size="tab" label="Alerts" />);
    expect(screen.getByText('發')).toBeTruthy();
  });

  it('is hidden from assistive tech -- purely decorative chrome, the caller supplies any real label', () => {
    render(<MahjongTile suit="dots" size="section" />);
    // react-native-web's flat aria-hidden, the same convention TileHero
    // itself uses (app/welcome.tsx) for exactly this kind of decoration.
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('does not throw for every suit at both sizes', () => {
    const suits = ['dots', 'bamboo', 'red-dragon', 'green-dragon'] as const;
    for (const suit of suits) {
      for (const size of ['tab', 'section'] as const) {
        expect(() =>
          render(<MahjongTile suit={suit} size={size} label={size === 'tab' ? 'X' : undefined} />),
        ).not.toThrow();
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/MahjongTile.test.tsx`
Expected: FAIL — `../MahjongTile` does not exist yet.

- [ ] **Step 3: Write `MahjongTile.tsx`**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, shadow, space, type } from '../lib/theme';

export type MahjongSuit = 'dots' | 'bamboo' | 'red-dragon' | 'green-dragon';

type Props = {
  suit: MahjongSuit;
  /** `"tab"`: the bottom tab bar's own tile (70x77), carries `label`.
   *  `"section"`: the small tile before a landing screen's own heading
   *  (30x40) -- no label, the real heading already says the words. */
  size: 'tab' | 'section';
  /** `TileHero`'s (app/welcome.tsx) accent-tile treatment: solid
   *  `accentColor` fill, `accent[700]` lip, glyph/label in `colors.bg`.
   *  Only meaningful for `size="tab"` -- the section tile is always the
   *  plain, decorative surface-fill tile. */
  selected?: boolean;
  /** Only rendered for `size="tab"`. */
  label?: string;
};

// Authentic mahjong ink colors -- dots/bamboo stroke colors match
// TileHero's own two suit tiles exactly; red/green dragon match the real
// ink each of those two honor tiles is traditionally printed in. Not
// chosen for any semantic link to Profile/Alerts.
const GLYPH_COLOR: Record<MahjongSuit, string> = {
  dots: colors.accentColor,
  bamboo: colors.accent2[600],
  'red-dragon': colors.accentColor,
  'green-dragon': colors.accent2[700],
};

const GLYPH_HEIGHT = 24;

function Glyph({ suit, color }: { suit: MahjongSuit; color: string }) {
  if (suit === 'red-dragon' || suit === 'green-dragon') {
    return (
      <Text style={[styles.character, { color }]}>
        {suit === 'red-dragon' ? '中' : '發'}
      </Text>
    );
  }
  // Both suit glyphs share TileHero's own viewBox and stroke shape --
  // copied from app/welcome.tsx's TileHero verbatim, only width/height/
  // stroke-width/color are this component's own.
  const width = Math.round(GLYPH_HEIGHT * 0.67);
  if (suit === 'dots') {
    return (
      <Svg width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3}>
        <Circle cx={13} cy={8} r={4.5} />
        <Circle cx={13} cy={20} r={4.5} />
        <Circle cx={13} cy={32} r={4.5} />
      </Svg>
    );
  }
  return (
    <Svg width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
      <Path d="M7 6v28M13 6v28M19 6v28" />
      <Path d="M4 14h6M10 14h6M16 14h6M4 26h6M10 26h6M16 26h6" />
    </Svg>
  );
}

/**
 * A mahjong tile: the same chrome `TileHero` (app/welcome.tsx) draws for
 * its three decorative hero tiles -- `colors.surface` fill, a raised ivory
 * lip via `borderBottomWidth`/`borderBottomColor`, `shadow.sm` -- carrying
 * one real suit or honor glyph, and (size `"tab"` only) a label at the
 * tile's bottom edge. Used by the bottom tab bar (components/TabBar.tsx,
 * size `"tab"`, one per tab) and by each of the four landing screens'own
 * headings (size `"section"`, purely decorative, no label).
 *
 * Unlike `TileHero`'s three tiles, this one is always upright -- rotation
 * is that hero's own decorative-only treatment, not this shared tile's.
 */
export default function MahjongTile({ suit, size, selected = false, label }: Props) {
  const glyphColor = selected ? colors.bg : GLYPH_COLOR[suit];
  const labelColor = selected ? colors.bg : colors.neutral[800];

  return (
    <View
      style={[
        styles.tile,
        size === 'tab' ? styles.tab : styles.section,
        selected ? styles.selected : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      <Glyph suit={suit} color={glyphColor} />
      {size === 'tab' && label ? (
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 4,
    borderBottomColor: colors.neutral[200],
    ...shadow.sm,
    alignItems: 'center',
  },
  tab: {
    width: 70,
    height: 77,
    justifyContent: 'flex-end',
    paddingBottom: space[2],
    gap: 3,
  },
  section: {
    width: 30,
    height: 40,
    borderBottomWidth: 3,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.accentColor,
    borderBottomColor: colors.accent[700],
  },
  character: {
    fontSize: 21,
    lineHeight: GLYPH_HEIGHT,
  },
  label: {
    fontFamily: type.heading,
    fontSize: 12,
    lineHeight: 14,
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/MahjongTile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the type checker**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/MahjongTile.tsx components/__tests__/MahjongTile.test.tsx
git commit -m "feat(nav): add the shared MahjongTile component"
```

---

## Task 2: `TabBar.tsx` renders four tiles

**Files:**
- Modify: `components/TabBar.tsx`

**Interfaces:**
- Consumes: `MahjongTile` from Task 1 (`suit`, `size="tab"`, `selected`, `label`).
- Produces: nothing new — `TabBar`'s own exported `TabKey` type and props are unchanged.

- [ ] **Step 1: Read the current file in full**

Read `components/TabBar.tsx` (already summarized above, but read the real current file yourself — confirm the `icon()` function, the `TABS` array, and the `tab`/`iconWrap`/`badge`/`label` styles still match what's described here before editing).

- [ ] **Step 2: Add the suit mapping and replace the icon+label rendering**

Replace the `icon()` helper:

```ts
function suitFor(key: TabKey): MahjongSuit {
  if (key === 'club') return 'dots';
  if (key === 'messages') return 'bamboo';
  if (key === 'profile') return 'red-dragon';
  return 'green-dragon';
}
```

Replace the import of icon components with `MahjongTile`:

```ts
import MahjongTile, { type MahjongSuit } from './MahjongTile';
```

(Remove the now-unused `import { BellIcon, HomeIcon, MessageIcon, PersonIcon } from './icons';` line — confirm none of those four are used anywhere else in this file before removing.)

Inside the `TABS.map(...)` render, replace:

```tsx
const tint = selected ? colors.accent[700] : colors.neutral[700];
```

— this line is no longer needed (selection is now the tile's own `selected` prop, not a color swap) — remove it, but keep `badgeCount`'s computation unchanged.

Replace the `<View style={styles.iconWrap}>...</View>` and the sibling `<Text style={[styles.label,...]}>` block with:

```tsx
<View style={styles.tileWrap}>
  <MahjongTile
    suit={suitFor(tab.key)}
    size="tab"
    selected={selected}
    label={tab.label}
  />
  {tab.key === 'messages' || tab.key === 'alerts' ? (
    <View style={styles.badge}>
      <UnreadBadge count={badgeCount} />
    </View>
  ) : null}
</View>
```

- [ ] **Step 3: Update the styles**

Replace `iconWrap`/`label` and adjust `tab`/`badge`/`bar`:

```ts
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileWrap: {
    // Positions the badge relative to the tile alone, not the whole tab --
    // an absolutely-positioned child otherwise anchors to the nearest
    // positioned ancestor, which would be this Pressable's full width.
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -space[2],
    right: -space[2],
  },
});
```

(`bar`'s `paddingBottom` drops from `space[4]` to `space[3]` since the taller tile itself now carries its own internal bottom padding via `MahjongTile`'s `tab` style — verify this visually in Step 5 below and adjust if the bar reads too cramped or too tall against the rest of the screen.)

- [ ] **Step 4: Run the existing test suite to confirm no behavior regression**

Run: `npm test -- app/__tests__/tab-bar.test.tsx`
Expected: PASS, all existing tests unchanged — this file tests roles, labels, selection, routing and badges, none of which this task's diff touches.

- [ ] **Step 5: Visually verify in the browser**

Start this project's dev server via its own preview tooling and view the tab bar at a mobile viewport width. Confirm: all four tiles render with their correct glyph (dots/bamboo/中/發), the selected tab shows the solid accent-tile treatment, unread badges (seed nonzero counts, e.g. via a temporary debug route rendering `<TabBar active="club" />` directly if reaching a real authenticated screen isn't practical) sit at the tile's corner without being clipped, and the bar's overall height doesn't crowd the content above it. Adjust `bar`'s `paddingTop`/`paddingBottom` if it looks wrong — this exact value was flagged in the spec as needing a live check, not assumed correct from the mockup alone. Also check the badge's `top`/`right` offset in `styles.badge` (changed from the pre-existing icon-based values to `-space[2]`/`-space[2]` in Step 3 above, to suit the wider tile) — adjust if the badge overlaps the tile's rounded corner awkwardly or sits too far off it. Delete any temporary debug route before committing.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add components/TabBar.tsx
git commit -m "feat(nav): tab bar buttons become mahjong tiles"
```

---

## Task 3: Clubs landing screen gets its section tile

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `MahjongTile` from Task 1 (`suit="dots"`, `size="section"`).

- [ ] **Step 1: Read the current file's three heading branches**

Read `app/clubs/index.tsx` in full. Confirm the three places a heading renders (the `loadFailed` branch's `<Text style={styles.heading}>Your clubs</Text>`, the empty-clubs-list branch's `<DashboardHeader ... />`, and the main populated-list branch's `<DashboardHeader ... />`) still match what's described here — this plan was written against the file's current content, but confirm before editing. The `loading`/not-yet-`ready` branches (spinner, skeleton) render no heading at all and do not need a tile.

- [ ] **Step 2: Write the failing tests**

Add to `app/__tests__/clubs.test.tsx` (read the file first to match its existing render/mock setup — it already mocks `fetchMyClubs` etc. for each of these branches):

```tsx
  it('shows a decorative dots tile before the heading when clubs fail to load', async () => {
    fetchMyClubs.mockResolvedValue(null);
    render(<ClubsScreen />);
    await screen.findByText('Your clubs');
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('shows a decorative dots tile before the heading with no clubs', async () => {
    fetchMyClubs.mockResolvedValue([]);
    render(<ClubsScreen />);
    await screen.findByText('Start a club');
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
```

(Adapt the exact mock function names/return shapes to whatever this test file's existing tests already use for these two states — read them first rather than guessing. If a dots tile already legitimately appears in the DOM for an unrelated reason in either of these render paths, scope the query more precisely, e.g. via a wrapping `testID` you add in Step 3.)

Also add a test confirming the third (main, populated-list) branch, matching whatever fixture this file's existing "renders the dashboard" style test already sets up — add the same `document.querySelector('[aria-hidden="true"]')` assertion to that existing test rather than writing a whole new one, if one already renders that branch.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: FAIL on the new/extended assertions — no tile renders yet.

- [ ] **Step 4: Add the tile**

Import `MahjongTile` in `app/clubs/index.tsx`:

```ts
import MahjongTile from '../../components/MahjongTile';
```

In the `loadFailed` branch, wrap the existing heading in a row with the tile above/before it:

```tsx
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <View style={styles.titleRow}>
          <MahjongTile suit="dots" size="section" />
          <Text style={styles.heading}>Your clubs</Text>
        </View>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
```

In the empty-clubs-list branch, add the tile immediately before `<DashboardHeader ... />` (as a preceding sibling, not wrapping it — `DashboardHeader` already manages its own internal layout):

```tsx
      <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <MahjongTile suit="dots" size="section" />
        <DashboardHeader
          kicker={empty.kicker}
          name={empty.name}
          meta={empty.meta}
        />
        ...
```

Do the same immediately before the main branch's `<DashboardHeader ... />` call (the one at the very end of the file, with `onPressScope`/`onPressAddGame`/`onPressBack`):

```tsx
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <MahjongTile suit="dots" size="section" />
      <DashboardHeader
        kicker={scope.kicker}
        ...
```

Add a `titleRow` style (used only by the `loadFailed` branch, since the other two just place the tile as a plain preceding sibling — `DashboardHeader`'s own `gap`/layout already reads fine with a sibling above it, but the plain `<Text style={styles.heading}>` branch has no wrapping row of its own yet):

```ts
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Visually verify in the browser**

View the Clubs screen in both its "all clubs" (flat kicker/name/meta `DashboardHeader` shape) and "single club" (centered avatar+pill shape) states. Confirm the small dots tile reads as a clean, correctly-aligned accent before each shape, not awkwardly spaced or overlapping the avatar in the single-club shape. Adjust spacing (a `marginBottom`/`gap` on the tile itself, or wrapping it in a small `View` with its own margin) if the plain sibling placement reads wrong against either `DashboardHeader` shape — this exact interaction was flagged in the spec as unverified until a live check.

- [ ] **Step 7: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(nav): add the dots section tile to the Clubs landing screen"
```

---

## Task 4: Messages, Profile, and Alerts landing screens get their section tiles

**Files:**
- Modify: `app/messages/index.tsx`
- Modify: `app/__tests__/messages.test.tsx`
- Modify: `app/profile.tsx`
- Modify: `app/__tests__/profile.test.tsx`
- Modify: `app/alerts.tsx`
- Modify: `app/__tests__/alerts.test.tsx`

**Interfaces:**
- Consumes: `MahjongTile` from Task 1 (`suit="bamboo"` for Messages, `suit="red-dragon"` for Profile, `suit="green-dragon"` for Alerts; all `size="section"`).

Each of these three screens has a single, simpler heading render (unlike Clubs' three branches) — read each file's current heading render first, then apply the same pattern.

- [ ] **Step 1: `app/messages/index.tsx`**

Read the file, find its `<Text style={styles.heading}>Messages</Text>` (or equivalent) render. Import `MahjongTile` (`../../components/MahjongTile`). Wrap the heading in a row the same way Task 3's `loadFailed` branch did:

```tsx
<View style={styles.titleRow}>
  <MahjongTile suit="bamboo" size="section" />
  <Text style={styles.heading}>Messages</Text>
</View>
```

Add the same `titleRow` style (`flexDirection: 'row', alignItems: 'center', gap: space[2]`) to this file's own stylesheet.

Add a test to `app/__tests__/messages.test.tsx` (matching its existing render setup):

```tsx
  it('shows a decorative bamboo tile before the heading', async () => {
    render(<MessagesScreen />);
    await screen.findByText('Messages');
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
```

- [ ] **Step 2: `app/profile.tsx`**

Same pattern: `<MahjongTile suit="red-dragon" size="section" />` before `<Text style={styles.heading}>Your profile</Text>`, same `titleRow` style added, same style of test added to `app/__tests__/profile.test.tsx` asserting `document.querySelector('[aria-hidden="true"]')` once the heading text is present.

- [ ] **Step 3: `app/alerts.tsx`**

Same pattern: `<MahjongTile suit="green-dragon" size="section" />` before `<Text style={styles.heading}>Alerts</Text>`, same `titleRow` style added, same style of test added to `app/__tests__/alerts.test.tsx`.

- [ ] **Step 4: Run each new/changed test file to verify RED then GREEN**

For each of the three files, run its test BEFORE adding the tile (confirm it fails — no `aria-hidden` element exists yet) and AFTER (confirm it passes). Since these are quick, mechanical, near-identical changes, do all three edits then run all three test files together:

Run: `npm test -- app/__tests__/messages.test.tsx app/__tests__/profile.test.tsx app/__tests__/alerts.test.tsx`
Expected: PASS, all three.

- [ ] **Step 5: Visually verify in the browser**

View all three screens. Confirm each tile shows its correct glyph (bamboo/中/發) at a legible size and reads cleanly next to that screen's own heading — the character glyphs (中/發) at the small 30×40 section size were never tested in the mockup rounds (only dots was), so check specifically whether `MahjongTile`'s `character` style's `fontSize: 21` looks visually balanced against the dots/bamboo glyphs' `24`-tall SVGs at this size, on Profile and Alerts in particular. If it reads too big/small relative to the SVG-based glyphs on the other two screens, adjust `MahjongTile`'s `character` style (Task 1's file) and re-run every affected test.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add app/messages/index.tsx app/__tests__/messages.test.tsx \
  app/profile.tsx app/__tests__/profile.test.tsx \
  app/alerts.tsx app/__tests__/alerts.test.tsx
git commit -m "feat(nav): add bamboo/dragon section tiles to Messages, Profile, Alerts"
```

---

## Final check

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm no nested screen under any of the four sections (spot-check `app/clubs/[id]/index.tsx`, `app/clubs/[id]/venues.tsx`, a thread detail screen, `app/friends.tsx`, `app/notifications.tsx`) gained a tile — these should all be untouched by this plan's diff.
- [ ] Confirm `components/DashboardHeader.tsx` itself has no diff — `git diff main -- components/DashboardHeader.tsx` should be empty.
- [ ] A final visual pass across all four landing screens and the tab bar together, at a mobile viewport width, confirming the whole nav reads coherently as one design (same tile chrome, same glyph per section top-to-bottom).
- [ ] Open a PR from `feat/mahjong-tile-nav` into `main` (per the standing branch-per-plan rule) rather than merging locally.
