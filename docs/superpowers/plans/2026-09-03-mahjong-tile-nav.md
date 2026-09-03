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

## Final check (Tasks 1-4)

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm no nested screen under any of the four sections (spot-check `app/clubs/[id]/index.tsx`, `app/clubs/[id]/venues.tsx`, a thread detail screen, `app/friends.tsx`, `app/notifications.tsx`) gained a tile — these should all be untouched by this plan's diff.
- [ ] ~~Confirm `components/DashboardHeader.tsx` itself has no diff~~ — **superseded**: Tasks 8-11 below deliberately modify `DashboardHeader.tsx` (the club's own tile representation) and `app/clubs/[id]/index.tsx`/`venues.tsx` (the same file this check names) as part of this plan's own later, explicitly-scoped work. This line held for Tasks 1-4 alone; do not use it as a gate once Task 8 has landed.
- [ ] A final visual pass across all four landing screens and the tab bar together, at a mobile viewport width, confirming the whole nav reads coherently as one design (same tile chrome, same glyph per section top-to-bottom).

Tasks 1-4 above were already implemented, reviewed (including a whole-branch
review with two fix passes), and iterated on directly with the user (three
follow-up UI fixes: back-row layout, tab-bar background removal, and the
Clubs screen's tile-inline-with-title fix) before this plan was extended
with the tasks below. Do not re-dispatch Tasks 1-4 — they are done.

---

## Task 5: Expand `MahjongTile`'s glyph set, add the per-club glyph hash

**Files:**
- Modify: `components/MahjongTile.tsx`
- Modify: `components/__tests__/MahjongTile.test.tsx`
- Modify: `lib/dashboard.ts`
- Modify: `lib/dashboard.test.ts`

**Interfaces:**
- Produces: `MahjongSuit` (in `components/MahjongTile.tsx`) grows from 4 to 8 members — `'dots' | 'bamboo' | 'red-dragon' | 'green-dragon' | 'east-wind' | 'south-wind' | 'west-wind' | 'north-wind'`. `MahjongTile`'s `size` prop grows from `'tab' | 'section'` to `'tab' | 'section' | 'chip'` (48×60, glyph + a `label` — repurposed to carry initials, not a full word — same as `'tab'`'s label rendering). `lib/dashboard.ts` exports `type ClubGlyph` (the same 8 string literals, NOT imported from `components/MahjongTile.tsx` — see below) and `function glyphForClub(clubId: string): ClubGlyph`. Consumed by: Task 6 (`ClubChips.tsx`, `size="chip"`), Task 9 (`ThreadAvatar.tsx`, the new large-tile treatment), Task 13 (the game screen's small tile).

**Why `ClubGlyph` is a separate, structurally-identical type, not an import:** no file under `lib/` imports anything from `components/` anywhere in this codebase (`lib/dashboard.ts`'s own docstring: "no React and no network in sight") — `lib/dashboard.ts` must stay free of that dependency. TypeScript's structural typing means a locally-defined 8-member string-literal union with the *same* members as `MahjongSuit` is still a fully type-checked match at every call site (a `ClubGlyph` value is assignable anywhere a `MahjongSuit` is expected, and vice versa) — this is not a "hopeful string", it's a real, compiler-enforced parity, just declared in two places rather than shared via import. Keep the two lists byte-identical; a mismatch would surface immediately as a type error at whichever call site tries to pass one where the other is expected.

- [ ] **Step 1: Write the failing tests**

Add to `components/__tests__/MahjongTile.test.tsx`:

```tsx
  it('renders all four wind characters', () => {
    const winds: { suit: MahjongSuit; char: string }[] = [
      { suit: 'east-wind', char: '東' },
      { suit: 'south-wind', char: '南' },
      { suit: 'west-wind', char: '西' },
      { suit: 'north-wind', char: '北' },
    ];
    for (const { suit, char } of winds) {
      const { unmount } = render(<MahjongTile suit={suit} size="tab" label="X" />);
      expect(screen.getByText(char)).toBeTruthy();
      unmount();
    }
  });

  it('renders a chip-size tile with a glyph and a short label (initials), no larger label styling', () => {
    render(<MahjongTile suit="dots" size="chip" label="RM" />);
    expect(screen.getByText('RM')).toBeTruthy();
  });

  it('renders no label for size="section" even if one is passed', () => {
    render(<MahjongTile suit="dots" size="section" label="RM" />);
    expect(screen.queryByText('RM')).toBeNull();
  });
```

(Add `import type { MahjongSuit } from '../MahjongTile';` alongside the existing default import, if not already present as a named export — check `MahjongTile.tsx`'s current export statement first; it's currently `export type MahjongSuit = ...` alongside the default export, so this should already work.)

Add to `lib/dashboard.test.ts` (read the file first to match its existing style/imports):

```ts
describe('glyphForClub', () => {
  it('is stable for the same id across repeated calls', () => {
    const id = 'club-riverside-mahjong-abc123';
    expect(glyphForClub(id)).toBe(glyphForClub(id));
  });

  it('returns a value from the fixed 8-glyph set for a range of ids', () => {
    const valid = new Set([
      'dots', 'bamboo', 'red-dragon', 'green-dragon',
      'east-wind', 'south-wind', 'west-wind', 'north-wind',
    ]);
    const sampleIds = [
      'a', 'b', 'club-1', 'club-2', '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff', 'z'.repeat(40), '',
    ];
    for (const id of sampleIds) {
      expect(valid.has(glyphForClub(id))).toBe(true);
    }
  });

  it('two different ids can resolve to different glyphs', () => {
    // Not a fairness/distribution test (8 buckets, no uniformity
    // requirement) -- just confirms the hash isn't a constant that always
    // returns the same glyph regardless of input.
    const glyphs = new Set(
      ['club-1', 'club-2', 'club-3', 'club-4', 'club-5', 'club-6'].map(glyphForClub),
    );
    expect(glyphs.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/MahjongTile.test.tsx lib/dashboard.test.ts`
Expected: FAIL — the winds don't exist yet, `size="chip"` isn't a valid type yet, `glyphForClub` doesn't exist.

- [ ] **Step 3: Extend `MahjongTile.tsx`**

Change the `MahjongSuit` type:

```ts
export type MahjongSuit =
  | 'dots'
  | 'bamboo'
  | 'red-dragon'
  | 'green-dragon'
  | 'east-wind'
  | 'south-wind'
  | 'west-wind'
  | 'north-wind';
```

Change `GLYPH_COLOR`:

```ts
const GLYPH_COLOR: Record<MahjongSuit, string> = {
  dots: colors.accentColor,
  bamboo: colors.accent2[600],
  'red-dragon': colors.accentColor,
  'green-dragon': colors.accent2[700],
  // Real mahjong sets print the wind tiles in plain black ink, not the
  // suit/dragon colors -- colors.text is this palette's nearest match,
  // same reasoning every other glyph's color already follows here.
  'east-wind': colors.text,
  'south-wind': colors.text,
  'west-wind': colors.text,
  'north-wind': colors.text,
};
```

Change the `Glyph` function's character branch (currently `if (suit === 'red-dragon' || suit === 'green-dragon')`) to a lookup table, so adding future honor tiles doesn't mean another `||`:

```tsx
const CHARACTER_GLYPHS: Partial<Record<MahjongSuit, string>> = {
  'red-dragon': '中',
  'green-dragon': '發',
  'east-wind': '東',
  'south-wind': '南',
  'west-wind': '西',
  'north-wind': '北',
};

function Glyph({ suit, color }: { suit: MahjongSuit; color: string }) {
  const character = CHARACTER_GLYPHS[suit];
  if (character) {
    return <Text style={[styles.character, { color }]}>{character}</Text>;
  }
  // dots/bamboo SVG branch below, unchanged from the current file.
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
```

Change `MahjongTile`'s own `Props` type and body:

```ts
type Props = {
  suit: MahjongSuit;
  /** `"tab"`: the bottom tab bar's own tile (70x77), carries `label` (the
   *  tab's full word). `"section"`: the small tile before a landing
   *  screen's own heading (30x40) -- no label, ever, even if one is
   *  passed. `"chip"`: a club's own tile (48x60, `ClubChips.tsx` and the
   *  large club-header treatment) -- carries `label` too, but as the
   *  club's initials, not a full word. */
  size: 'tab' | 'section' | 'chip';
  selected?: boolean;
  /** Rendered for `size="tab"` and `size="chip"`; never for `"section"`. */
  label?: string;
};
```

```tsx
export default function MahjongTile({ suit, size, selected = false, label }: Props) {
  const glyphColor = selected ? colors.bg : GLYPH_COLOR[suit];
  const labelColor = selected ? colors.bg : colors.neutral[800];
  const showsLabel = size === 'tab' || size === 'chip';

  const sizeStyle =
    size === 'tab' ? styles.tab : size === 'chip' ? styles.chip : styles.section;

  return (
    <View
      style={[styles.tile, sizeStyle, selected ? styles.selected : null]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      <Glyph suit={suit} color={glyphColor} />
      {showsLabel && label ? (
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      ) : null}
    </View>
  );
}
```

Add the `chip` size style, alongside the existing `tab`/`section`:

```ts
  chip: {
    width: 48,
    height: 60,
    justifyContent: 'flex-end',
    paddingBottom: space[1],
    gap: 2,
    borderBottomWidth: 3,
  },
```

(`tile`'s own base `borderBottomWidth: 4` is overridden by `chip`'s `3`, same pattern `section`'s `3` already uses against the shared base.)

- [ ] **Step 4: Add `glyphForClub` to `lib/dashboard.ts`**

Add near `initialsFrom` (same file, same "pure derivation" spirit):

```ts
// Mirrors components/MahjongTile.tsx's MahjongSuit type, deliberately
// duplicated rather than imported -- this file stays free of any
// components/ dependency (see this file's own header comment), and
// TypeScript's structural typing still checks every call site for real:
// a ClubGlyph value is assignable anywhere a MahjongSuit is expected, and
// vice versa, because the two lists have identical members. Keep them
// byte-identical if either ever changes.
export type ClubGlyph =
  | 'dots'
  | 'bamboo'
  | 'red-dragon'
  | 'green-dragon'
  | 'east-wind'
  | 'south-wind'
  | 'west-wind'
  | 'north-wind';

const CLUB_GLYPHS: ClubGlyph[] = [
  'dots',
  'bamboo',
  'red-dragon',
  'green-dragon',
  'east-wind',
  'south-wind',
  'west-wind',
  'north-wind',
];

/**
 * A club's own tile face, stable for a given id -- every member sees the
 * same glyph for the same club, everywhere it's shown (its chip, its
 * header, the game screen's small tile), not a fresh pick per render.
 * No fairness/collision-resistance requirement: a plain string hash into
 * 8 buckets is enough, this is decoration, not a security boundary.
 */
export function glyphForClub(clubId: string): ClubGlyph {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) {
    hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  }
  return CLUB_GLYPHS[Math.abs(hash) % CLUB_GLYPHS.length];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/MahjongTile.test.tsx lib/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add components/MahjongTile.tsx components/__tests__/MahjongTile.test.tsx \
  lib/dashboard.ts lib/dashboard.test.ts
git commit -m "feat(nav): expand MahjongTile's glyph set, add a stable per-club glyph"
```

---

## Task 6: `ClubChips.tsx` becomes mahjong tiles

**Files:**
- Modify: `components/ClubChips.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `MahjongTile` (`suit`, `size="chip"`, `selected`, `label`) from Task 5; `glyphForClub` from `lib/dashboard.ts` (Task 5). `Chip` type (`{ id: string; label: string }`, unchanged) already carries the `id` `glyphForClub` needs.

- [ ] **Step 1: Read the current file**

Read `components/ClubChips.tsx` in full — the brief describes edits relative to its current content (already shown in full earlier in this plan's own research; confirm it still matches before editing).

- [ ] **Step 2: Write the failing tests**

Add to `components/__tests__/dashboard-parts.test.tsx`'s existing `describe('ClubChips', ...)` block:

```tsx
  it('shows each club as a mahjong tile, not a circular avatar', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    // The old circular-avatar testID this replaces.
    expect(screen.queryByTestId('thread-avatar-club')).toBeNull();
    // Both initials still read, now on the tile face rather than a circle.
    expect(screen.getByText('RM')).toBeTruthy();
    expect(screen.getByText('HT')).toBeTruthy();
  });

  it("gives the same club the same glyph every time, matching lib/dashboard's own glyphForClub", () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    // Rendered twice (re-render, not remount) to prove it's not a fresh
    // random pick per render -- a real regression a naive
    // Math.random()-based glyph pick would pass the single-render version
    // of this test but fail here.
    const firstGlyph = screen.getByTestId('chip-glyph-club-1').textContent;
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(screen.getAllByTestId('chip-glyph-club-1')[0].textContent).toBe(firstGlyph);
  });
```

(This second test assumes `MahjongTile`'s `Glyph` sub-component or `ClubChips` itself exposes a `testID` distinguishing which club's glyph is which — check whether `MahjongTile` already has a stable way to query "this specific tile's glyph" from Task 5's own tests; if not, add a `testID={`chip-glyph-${chip.id}`}` on the wrapping `View` around each chip's `MahjongTile` in `ClubChips.tsx` itself, Step 3 below, and query THAT wrapper's text content instead of trying to reach inside `MahjongTile`'s own internals — adjust this test's exact query to whatever you actually add, the intent — same id, same glyph, provably not per-render-random — is what matters, not the literal query shown here.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx`
Expected: FAIL on the two new tests; existing `ClubChips` tests still pass (nothing about selection/routing/badges has changed yet).

- [ ] **Step 4: Rewrite `ClubChips.tsx`'s render**

Replace the import of `initialsFrom` alone with both `initialsFrom` and `glyphForClub`:

```ts
import { glyphForClub, initialsFrom } from '../lib/dashboard';
```

Import `MahjongTile` instead of relying on the plain `View`/`Text` avatar:

```ts
import MahjongTile from './MahjongTile';
```

Replace the per-chip `<View style={styles.avatarWrap}>...</View>` block with:

```tsx
            <View style={styles.tileWrap} testID={`chip-glyph-${chip.id}`}>
              <MahjongTile
                suit={glyphForClub(chip.id)}
                size="chip"
                selected={active}
                label={initialsFrom(chip.label)}
              />
              <View style={styles.badgeWrap}>
                <UnreadBadge count={count} />
              </View>
            </View>
```

Replace the "New club" tile's avatar (`<View style={[styles.avatar, styles.avatarNewClub]}>...</View>`) with a same-sized, same-shaped-but-distinct tile — outlined/transparent, not filled, matching the mockup:

```tsx
          <View style={styles.newClubTile}>
            <PlusIcon size={16} color={colors.text} />
          </View>
```

- [ ] **Step 5: Update the styles**

Remove `avatar`/`avatarClub`/`avatarActive`/`avatarNewClub`/`avatarInitials` (all superseded by `MahjongTile`'s own styling); keep `avatarWrap`'s positioning role but rename it (it now wraps a tile, not a circle) and adjust the badge offset for the new tile's shape:

```ts
  tileWrap: {
    position: 'relative',
  },
  badgeWrap: {
    position: 'absolute',
    top: -6,
    right: -8,
  },
  newClubTile: {
    width: 48,
    height: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: control.hairline,
    borderColor: colors.textMuted,
  },
```

(`tile`'s own width changes from `72` to whatever fits the new 48px-wide tiles plus label wrapping comfortably — check the `label`/`row` styles too; `tile: { alignItems: 'center', gap: space[1], width: 72 }` may need its `width` adjusted down to roughly match the new tile's own 48px width plus a little room for the label to wrap onto two lines for longer club names, same as before. Verify visually in Step 6 rather than guessing a number here.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx`
Expected: PASS.

- [ ] **Step 7: Visually verify in the browser**

View `ClubChips` at a plausible club count (3-4 clubs plus New Club) and mobile width, per the spec's own testing note. Confirm: glyph+initials are both legible on the 48×60 tile face, the selected tile's accent treatment reads correctly, the New Club tile's outlined style is visually distinct from a real club's filled tile, and the row still wraps sensibly. Adjust `tile`'s `width` and any spacing that reads cramped or too loose. Use a temporary debug route if reaching a real screen with several clubs isn't practical, per this branch's own established pattern — delete it before committing.

- [ ] **Step 8: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(nav): ClubChips becomes mahjong tiles, glyph stable per club"
```

---

## Task 7: `app/clubs/index.tsx` — clubs lead, no header line, in the flat scope

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:** none new — pure conditional-render change.

- [ ] **Step 1: Read the current file**

Read `app/clubs/index.tsx`'s main branch return in full (already shown earlier in this plan's own research, but re-read for current-state confirmation — Tasks 1-4 and the three follow-up UI fixes already changed this file since the plan's own initial research).

- [ ] **Step 2: Write the failing test**

Add to `app/__tests__/clubs.test.tsx` (matching its existing fixture/mock conventions for the "several clubs, none selected" scenario):

```tsx
  it('leads with the club chips, no header line, when several clubs and none is selected', async () => {
    // Reuse whatever this file's existing multi-club fixture already is
    // for the flat-scope case (search this file for other tests already
    // reaching that state) rather than inventing a new one.
    render(<ClubsScreen />);
    await screen.findByRole('button', { name: /Riverside/ }); // a chip has rendered
    expect(screen.queryByText('Your clubs')).toBeNull();
  });
```

(Adapt the exact fixture/mock setup to whatever this file's existing multi-club, nothing-selected test already uses — read the file first, don't invent new fixture data if a suitable one already exists.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: FAIL — "Your clubs" still renders today.

- [ ] **Step 4: Skip `DashboardHeader` in the flat scope**

In the main branch's return, wrap the `<DashboardHeader ... />` call (the one with `onPressScope`/`onPressAddGame`/`onPressBack`, at the end of the file) in a condition:

```tsx
      {scope.kicker === 'Your club' ? (
        <DashboardHeader
          kicker={scope.kicker}
          name={scope.name}
          meta={scope.meta}
          titleAccessory={undefined}
          onPressScope={
            scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
          }
          onPressAddGame={
            scopeClubId ? () => router.push(`/clubs/${scopeClubId}/events/new`) : undefined
          }
          onPressBack={
            selected !== ALL_CLUBS
              ? () => {
                  setSelected(ALL_CLUBS);
                  setNotice(null);
                }
              : undefined
          }
        />
      ) : null}
```

(Keep every existing prop exactly as it already is in the current file — this step only ADDS the `scope.kicker === 'Your club'` wrapping condition, it does not change any of the props themselves. `titleAccessory={undefined}` is shown explicitly only to flag that this call site no longer needs the flat-shape tile logic Task 3/the earlier UI-fix pass added — since this call now only ever renders in the CENTRED shape, `titleAccessory` — which only does anything in the FLAT shape — is genuinely dead for this specific call site going forward. Remove the prop entirely, along with whatever conditional expression previously computed it, rather than passing an explicit `undefined` — check the current file for exactly what that expression looks like before deleting it.)

Also remove the now-fully-unreachable flat-shape `DashboardHeader` call this file may still have from earlier work (the one that used to render when `scope.kicker !== 'Your club'`) — since that branch's ENTIRE header, not just its tile accessory, is now skipped per this task. Search the current file for any remaining conditional flat-shape rendering left over from the earlier UI-fix pass and remove it; only the centred-shape call above should remain in the main branch's return.

Leave the empty-clubs-list branch (`list.length === 0`) and the `loadFailed` branch completely untouched — this task only changes the main, populated-list branch's flat-scope case.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean. (`tsc` in particular should confirm no other code still expects the removed flat-shape call or its now-deleted `titleAccessory` computation.)

- [ ] **Step 7: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(nav): clubs lead the dashboard, no header line, when none is selected"
```

---

## Task 8: `ThreadAvatar.tsx` gains an opt-in large-tile treatment for clubs

**Files:**
- Modify: `components/ThreadAvatar.tsx`
- Modify: `components/__tests__/ThreadAvatar.test.tsx`

**Interfaces:**
- Consumes: `MahjongTile` (`suit`, `size="chip"`, `label`) and `glyphForClub` from Tasks 5. (Reuses the `"chip"` size, not a new one — the spec's own open item said the exact size needs a live check before settling; starting from the same 48×60 as `ClubChips` is the simplest default, adjust in Task 9's live-check step if it reads too small standing alone in a header.)
- Produces: `ThreadAvatar` gains two new optional props: `asTile?: boolean` (opt-in, defaults to `false` — every existing caller is completely unaffected) and `clubId?: string` (required in practice whenever `asTile` is true and `kind === 'club'`; ignored otherwise). Consumed by Task 9 (`DashboardHeader.tsx`) and Task 12 (the two messages-club screens).

- [ ] **Step 1: Read the current file**

Read `components/ThreadAvatar.tsx` in full (already shown earlier in this plan's own research — confirm it still matches).

- [ ] **Step 2: Write the failing tests**

Add to `components/__tests__/ThreadAvatar.test.tsx` (read the file first to match its existing style):

```tsx
  it('renders the plain circle by default, even for kind="club"', () => {
    render(<ThreadAvatar kind="club" name="Riverside Mah Jongg" />);
    expect(screen.getByTestId('thread-avatar-club')).toBeTruthy();
    expect(screen.queryByText('RM')).toBeTruthy(); // initials, same as before
  });

  it('renders a mahjong tile instead of a circle when asTile is true', () => {
    render(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    expect(screen.queryByTestId('thread-avatar-club')).toBeNull();
    expect(screen.getByText('RM')).toBeTruthy();
  });

  it('gives the same club id the same glyph as asTile=false does not need to care about, but stays stable across renders', () => {
    const { rerender } = render(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    const first = screen.getByTestId('thread-avatar-club-tile').textContent;
    rerender(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    expect(screen.getByTestId('thread-avatar-club-tile').textContent).toBe(first);
  });

  it('ignores asTile for non-club kinds', () => {
    render(<ThreadAvatar kind="direct" name="Ada" asTile />);
    // Still the plain circle -- asTile only ever does anything for kind="club".
    expect(screen.getByTestId('thread-avatar-direct')).toBeTruthy();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- components/__tests__/ThreadAvatar.test.tsx`
Expected: FAIL — `asTile`/`clubId` aren't valid props yet.

- [ ] **Step 4: Add the opt-in tile branch**

Add the new props and import:

```ts
import MahjongTile from './MahjongTile';
import { glyphForClub, initialsFrom } from '../lib/dashboard';
```

(`initialsFrom` is already imported — just add `glyphForClub` alongside it.)

```ts
export default function ThreadAvatar({
  kind,
  name,
  size = DEFAULT_SIZE,
  testID,
  asTile = false,
  clubId,
}: {
  kind: ThreadKind;
  name: string;
  size?: number;
  testID?: string;
  /** Opt-in: renders `kind="club"` as a mahjong tile (this club's own
   *  stable glyph + initials) instead of the plain circle every other
   *  caller still gets. Default false so every existing caller — in
   *  particular components/ThreadRow.tsx's small list-row avatars, which
   *  must stay circular — is completely unaffected. Ignored for any
   *  kind other than 'club'. */
  asTile?: boolean;
  /** Required (in practice) whenever `asTile` is true and `kind==='club'`
   *  — the tile's glyph is derived from this, not from `name`. */
  clubId?: string;
}) {
```

Inside the function body, before the existing `if (kind === 'club')` branch, add:

```tsx
  if (kind === 'club' && asTile && clubId) {
    return (
      <View testID={testID ?? 'thread-avatar-club-tile'}>
        <MahjongTile
          suit={glyphForClub(clubId)}
          size="chip"
          label={initialsFrom(name)}
        />
      </View>
    );
  }
```

(This ignores the `size` prop entirely for the tile path — `MahjongTile`'s own `"chip"` size is fixed at 48×60, not proportional the way the circle's `dim`/`glyphSize`/`initialsStyle` computation is. If Task 9's live-check finds 48×60 reads too small standing alone in a 72px-circle's old slot, that is the value to revisit in `MahjongTile.tsx`'s own `chip` style — not something to parametrize here.)

Leave the existing `if (kind === 'club')` (no `asTile`), `game`, `group`, and `direct` branches completely untouched below this new one.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/ThreadAvatar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run `ThreadRow.tsx`'s own tests to confirm zero impact**

Run: `npm test -- components/__tests__/ThreadRow.test.tsx` (or wherever its tests live — search first)
Expected: PASS, unchanged — `ThreadRow` never passes `asTile`, so its every call site keeps rendering the plain circle exactly as before.

- [ ] **Step 7: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add components/ThreadAvatar.tsx components/__tests__/ThreadAvatar.test.tsx
git commit -m "feat(nav): ThreadAvatar gets an opt-in mahjong-tile treatment for clubs"
```

---

## Task 9: `DashboardHeader.tsx`'s "Your club" shape gets the tile, and a tighter top row

**Files:**
- Modify: `components/DashboardHeader.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `ThreadAvatar`'s `asTile`/`clubId` props from Task 8.
- Produces: `DashboardHeader` gains a new prop, `clubId?: string`, meaningful only in the "Your club" shape (ignored in the flat shape). Consumed by Task 10 (`app/clubs/index.tsx`) and Task 11 (`app/clubs/[id]/index.tsx`).

This task restructures the centred "Your club" shape's internal layout: the club's tile (not a circular avatar) moves from the `clubCenter` block into the `clubTopRow` — back-chevron (left, optional) / tile (centre, **always** rendered now, not gated on `onPressBack || onPressAddGame` the way the whole row used to be) / add-game button (right, optional) — with the name pill and meta line remaining below in `clubCenter`. This is a real, deliberate layout change, not a drop-in avatar swap — read it carefully against the current file before editing.

- [ ] **Step 1: Read the current file**

Read `components/DashboardHeader.tsx` in full (already shown earlier in this plan's own research — confirm it still matches, including the `titleAccessory` addition from the earlier UI-fix pass, which this task does not touch).

- [ ] **Step 2: Write the failing tests**

The existing test `'draws no top row at all when given neither a chevron nor a way to add a game'` (in `components/__tests__/dashboard-parts.test.tsx`'s `describe('the "Your club" variant', ...)` block) asserts a behavior this task deliberately changes — a top row (containing the tile) now ALWAYS renders in this shape. Update that test rather than deleting it, since the underlying claim ("no chevron, no add-game button, when neither is given") is still true and worth keeping:

```tsx
    it('draws no chevron or add-game button — but still the tile — when given neither', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          clubId="club-1"
        />,
      );
      expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
      expect(screen.getByTestId('thread-avatar-club-tile')).toBeTruthy();
    });
```

(Rename the `it(...)` string too, per the code block above — the old name ("draws no top row at all") is no longer true.)

Add a new test confirming the tile replaces the old circle in this shape:

```tsx
    it('shows the club as a tile, not a circular avatar, now that clubId is given', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          clubId="club-1"
        />,
      );
      expect(screen.queryByTestId('thread-avatar-club')).toBeNull();
      expect(screen.getByTestId('thread-avatar-club-tile')).toBeTruthy();
    });
```

The existing test `'shows the club's avatar, name and rhythm instead of a kicker'` asserts `screen.getByTestId('thread-avatar-club')` — update it to `'thread-avatar-club-tile'` and add `clubId="club-1"` to its render call, since this task changes what testID that element carries. Leave every other existing test in this `describe` block (the manage-button, chevron-press, add-game-press tests) untouched apart from adding `clubId="club-1"` to each render call if `DashboardHeader` requires it to actually render a tile — check Step 3 below for whether `clubId` is required or merely optional-but-expected in this shape before deciding whether every existing test needs the new prop added.

- [ ] **Step 3: Run the tests to verify the changed/new ones fail**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx`
Expected: FAIL on the updated/new assertions.

- [ ] **Step 4: Restructure the centred shape**

Add `clubId` to the props:

```ts
export default function DashboardHeader({
  kicker,
  name,
  meta,
  titleAccessory,
  clubId,
  onPressScope,
  onPressAddGame,
  onPressBack,
}: {
  kicker: string;
  name: string;
  meta: string;
  titleAccessory?: ReactNode;
  /** The "Your club" shape's own club id -- required in practice for
   *  that shape to draw its tile (ThreadAvatar's asTile treatment needs
   *  it for the glyph hash). Ignored in the flat shape. */
  clubId?: string;
  onPressScope?: () => void;
  onPressAddGame?: () => void;
  onPressBack?: () => void;
}) {
```

Replace the centred-shape `return` block:

```tsx
  if (kicker === 'Your club') {
    return (
      <View style={styles.clubHeader}>
        <View style={styles.clubTopRow}>
          {/* Fixed 44x44 footprint whether or not the chevron itself
              draws, so the tile stays perfectly centred either way --
              same reasoning the ⊕'s own flanking box already used before
              this task, now applied symmetrically on both sides. */}
          <View style={styles.clubBack}>
            {onPressBack ? (
              <Pressable
                onPress={onPressBack}
                accessibilityRole="button"
                accessibilityLabel="Clear club filter"
                style={styles.clubBack}
              >
                <ChevronLeftIcon color={colors.text} size={22} />
              </Pressable>
            ) : null}
          </View>
          {clubId ? (
            <ThreadAvatar kind="club" name={name} clubId={clubId} asTile size={72} />
          ) : null}
          <View style={styles.clubBack}>
            {onPressAddGame ? (
              <PlusButton onPress={onPressAddGame} accessibilityLabel="Add a game" />
            ) : null}
          </View>
        </View>
        <View style={styles.clubCenter}>
          {onPressScope ? (
            <Pressable
              onPress={onPressScope}
              accessibilityRole="button"
              accessibilityLabel={
                meta.length > 0 ? `Manage ${name}, ${meta}` : `Manage ${name}`
              }
              style={styles.clubNamePill}
            >
              <Text numberOfLines={1} style={styles.clubNamePillText}>
                {name}
              </Text>
              <PencilIcon size={14} color={colors.accentColor} />
            </Pressable>
          ) : (
            <View style={styles.clubNamePill}>
              <Text numberOfLines={1} style={styles.clubNamePillText}>
                {name}
              </Text>
            </View>
          )}
          {meta.length > 0 ? <Text style={styles.clubMeta}>{meta}</Text> : null}
        </View>
      </View>
    );
  }
```

(Note `clubId ? <ThreadAvatar .../> : null` — the tile is genuinely optional on whether a `clubId` was passed, not unconditional, since a caller mid-migration or a genuinely id-less state should not crash. Every real caller (Tasks 10-11) will pass one.)

Import `ThreadAvatar` (it's likely not currently imported directly by `DashboardHeader.tsx`, since it previously called it inline only inside the removed `clubCenter` block — check the current file's imports and add if missing):

```ts
import ThreadAvatar from './ThreadAvatar';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx`
Expected: PASS.

- [ ] **Step 6: Visually verify in the browser**

This is the spec's own flagged "needs a live check, not an assumption" item for the tile's exact size. Render `DashboardHeader`'s centred shape (via a temporary debug route, this branch's established pattern) in three states: with both chevron and add-game button (the Clubs-dashboard case), with neither (the club-edit-page case, Task 11), and with a long club name (pill wrapping). Confirm the 48×60 tile reads well standing alone in a 72px-circle's old slot — visually judge whether it looks too small/cramped compared to the surrounding chrome (the manage pill, the meta line). If it does, increase `MahjongTile.tsx`'s `chip` style (Task 5's file) rather than inventing a second tile size here, and re-run Task 5's and Task 6's own tests afterward to confirm the size change doesn't break their assertions (they check content, not exact pixel size, so this should be safe — confirm rather than assume).

- [ ] **Step 7: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(nav): DashboardHeader's Your-club shape gets the tile, tighter top row"
```

(If Step 6 changed `MahjongTile.tsx`'s `chip` size, include it in this same commit — it's one coherent change with this task's own live-check step, not a separate task.)

---

## Task 10: `app/clubs/index.tsx` — wire `clubId` into the tighter top row

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `DashboardHeader`'s new `clubId` prop from Task 9.

- [ ] **Step 1: Read the current file**

Read `app/clubs/index.tsx`'s main branch return (post-Task-7 — the centred-shape `DashboardHeader` call is now the ONLY one in this branch, per Task 7's own change).

- [ ] **Step 2: Write the failing test**

Add to `app/__tests__/clubs.test.tsx` (matching its existing single-club fixture, if one already reaches the centred shape — read the file first):

```tsx
  it('shows the club as a tile in the combined top row, for the single-club scope', async () => {
    // Reuse whichever existing fixture already reaches the centred
    // "Your club" shape (a one-club member, or a filtered-in club).
    render(<ClubsScreen />);
    await screen.findByTestId('thread-avatar-club-tile');
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: FAIL — no `clubId` is passed to `DashboardHeader` yet, so Task 9's own `clubId ? <ThreadAvatar ... /> : null` renders nothing.

- [ ] **Step 4: Pass `clubId`**

In the (now sole, post-Task-7) `<DashboardHeader ... />` call in the main branch's return, add:

```tsx
        clubId={scopeClubId ?? undefined}
```

(`scopeClubId` is already computed earlier in this file, exactly the id this shape needs — `list.find((club) => club.id === selected)?.id ?? (list.length === 1 ? list[0].id : null)`. It's typed as `string | null`; `DashboardHeader`'s own `clubId` prop is `string | undefined`, hence the `?? undefined` — check whether this file already has a established local convention for this exact null-to-undefined conversion elsewhere before introducing a new one.)

**Also remove the old, now-redundant sibling tile block** this file still carries from the earlier UI-fix pass (search for `testID="section-tile"` with a `style={styles.sectionTileCentered}` — a `<View>` wrapping its own standalone `<MahjongTile suit="dots" size="section" />`, rendered as a sibling immediately above the centred-shape `<DashboardHeader ... />` call). Once `clubId` is passed, `DashboardHeader` renders its OWN tile internally (Task 9) — leaving the old sibling block in place would show two tiles stacked on top of each other. Delete that whole conditional block (and the `sectionTileCentered` style it used, if nothing else in this file still references it — check first) along with its explanatory comment, which is now inaccurate (it describes the pre-Task-9 layout).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(nav): wire clubId into the Clubs dashboard's tighter top row"
```

---

## Task 11: `app/clubs/[id]/index.tsx` — the club's own "edit" page gets the tile

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Modify: its own test file (search for it — likely `app/__tests__/clubs.test.tsx` or a dedicated `club-detail.test.tsx`; read the file first to confirm which)

**Interfaces:**
- Consumes: `DashboardHeader`'s new `clubId` prop from Task 9.

This page keeps its own separate "← Clubs" ghost button exactly as it is today — it does NOT gain the combined back/tile/plus row Task 9/10 built for the Clubs dashboard specifically. This page passes neither `onPressBack` nor `onPressAddGame` to `DashboardHeader` today and continues not to; only `clubId` is new here.

- [ ] **Step 1: Read the current file**

Read `app/clubs/[id]/index.tsx`'s header section in full (already shown earlier in this plan's own research — confirm the `<DashboardHeader kicker="Your club" name={club.name} meta={club.rhythm} />` call and the separate ghost "Clubs" button above it still match).

- [ ] **Step 2: Write the failing test**

Add to this screen's own test file:

```tsx
  it('shows the club as a tile, still with its own separate back button unchanged', async () => {
    render(<ClubDetailScreen />); // or whatever this screen's exported name is -- confirm from the file
    expect(await screen.findByTestId('thread-avatar-club-tile')).toBeTruthy();
    // The separate ghost back button is untouched by this task.
    expect(screen.getByRole('button', { name: 'Back to your clubs' })).toBeTruthy();
    // No combined-row buttons -- this page never had them and doesn't gain them.
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });
```

(Confirm the exported component name and existing render/mock setup by reading the test file first — this is a sketch of the assertion, not a verbatim drop-in.)

- [ ] **Step 3: Run the test to verify it fails**

Run the test file directly (path confirmed in Step 1).
Expected: FAIL — no `clubId` passed yet.

- [ ] **Step 4: Pass `clubId`**

```tsx
      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        clubId={club.id}
      />
```

- [ ] **Step 5: Run the tests to verify they pass**

Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add "app/clubs/[id]/index.tsx" <the test file from Step 1>
git commit -m "feat(nav): the club's own edit page gets the tile too"
```

---

## Task 12: The two club-messages screens get the tile

**Files:**
- Modify: `app/messages/club/[threadId]/index.tsx`
- Modify: its own test file (search for it)
- Modify: `app/messages/club/new.tsx`
- Modify: its own test file (search for it)

**Interfaces:**
- Consumes: `ThreadAvatar`'s `asTile`/`clubId` props from Task 8.

- [ ] **Step 1: Read both current files**

Read `app/messages/club/[threadId]/index.tsx`'s header section and `app/messages/club/new.tsx`'s header section in full (both already shown earlier in this plan's own research). Confirm `thread.club_id` (the first file) and `clubId` (the second, an existing local variable from `useLocalSearchParams`) are both genuinely available at the point each `<ThreadAvatar ... />` call sits.

- [ ] **Step 2: Write the failing tests**

For each screen's own test file, add a test in the same shape as Task 11's:

```tsx
  it('shows the club as a mahjong tile', async () => {
    // render with whatever this file's existing fixture/mocks already
    // reach a loaded thread/club state
    expect(await screen.findByTestId('thread-avatar-club-tile')).toBeTruthy();
  });
```

- [ ] **Step 3: Run both test files to verify they fail**

Expected: FAIL — `asTile`/`clubId` not yet passed.

- [ ] **Step 4: Pass `asTile`/`clubId` at both call sites**

In `app/messages/club/[threadId]/index.tsx`:

```tsx
            <ThreadAvatar
              kind={kind}
              name={title}
              size={72}
              testID={`thread-header-avatar-${kind}`}
              asTile={kind === 'club'}
              clubId={kind === 'club' ? thread.club_id : undefined}
            />
```

(`kind` here is dynamic — per `ThreadAvatar`'s own Task 8 contract, `asTile` is a no-op for any non-club kind, so passing `asTile={kind === 'club'}` unconditionally is safe and simpler than an extra branch; `clubId` similarly only matters when `kind === 'club'`. Verify `thread.club_id` is genuinely typed as available at this point — the surrounding code already reads it at another call site in this same file, per this plan's own earlier research, so it should already be in scope.)

In `app/messages/club/new.tsx` (this one's `kind` is always the literal `'club'`, per this plan's own earlier research):

```tsx
            <ThreadAvatar
              kind="club"
              name={clubName}
              size={72}
              testID="thread-header-avatar-club"
              asTile
              clubId={clubId}
            />
```

(`clubId` here is the screen's own existing `useLocalSearchParams` variable, already confirmed available.)

- [ ] **Step 5: Run both test files to verify they pass**

Expected: PASS.

- [ ] **Step 6: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add "app/messages/club/[threadId]/index.tsx" <its test file> \
  app/messages/club/new.tsx <its test file>
git commit -m "feat(nav): the club messages board and new-thread composer get the tile"
```

---

## Task 13: The game screen gets a small club tile next to its kicker text

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:**
- Consumes: `MahjongTile` (`suit`, `size="section"`) and `glyphForClub` from Task 5.

- [ ] **Step 1: Read the current file**

Read `app/clubs/[id]/events/[eventId]/index.tsx`'s header section in full (already shown earlier in this plan's own research — the `styles.headerRow` block containing the back Pressable and `<Text style={styles.clubKicker}>{club.name}</Text>`, added in this session's earlier, separate game-screen-cleanup work).

- [ ] **Step 2: Write the failing test**

Add to `app/__tests__/events-detail.test.tsx`:

```tsx
  it('shows a small mahjong tile before the club name, matching that club\'s own glyph elsewhere', async () => {
    render(<EventScreen />);
    await screen.findByText(CLUB.name);
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
```

(This file's own `TabBar` also renders `aria-hidden` tiles, same caveat every other landing-screen test in this plan already handled — scope the query to a `testID` on the new tile's own wrapper if a bare `document.querySelector` risks a false positive here, matching whichever precedent this specific test file already uses elsewhere for the same class of query. Read the file first.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: FAIL — no new tile exists yet (this specific assertion; the bare `aria-hidden` query may already pass due to TabBar's own tiles, in which case tighten it with a `testID` before this step, per the note above, so the RED is genuine).

- [ ] **Step 4: Add the tile**

Import `MahjongTile` and `glyphForClub`:

```ts
import MahjongTile from '../../../../../components/MahjongTile';
import { glyphForClub } from '../../../../../lib/dashboard';
```

Change the `headerRow`:

```tsx
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.push('/clubs')}
          accessibilityRole="button"
          accessibilityLabel="Back to your clubs"
          style={styles.backButton}
        >
          <ChevronLeftIcon color={colors.accentColor} />
        </Pressable>
        <MahjongTile suit={glyphForClub(clubId)} size="section" />
        <Text style={styles.clubKicker}>{club.name}</Text>
      </View>
```

(`clubId` here is this screen's own existing route-param variable, already used elsewhere in this same file per its established `router.push(\`/clubs/${clubId}/...\`)` calls — confirm it's in scope at this exact point before using it, it should already be.)

`styles.headerRow` already lays out as a `flexDirection: 'row', alignItems: 'center', gap: space[1]` (added in the earlier session work that combined the back arrow and club name onto one line) — the new tile slots in as a third row child with no style changes needed, per the same pattern the nav's own section tiles already use elsewhere in this plan. Verify this visually in Step 6 rather than assuming the existing `gap: space[1]` reads right with a 30×40 tile added — this exact three-way spacing (chevron, tile, text) was never tested before.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Visually verify in the browser**

View the game screen's header at mobile width. Confirm the tile sits cleanly between the back chevron and the club name, doesn't crowd either, and shows the correct glyph for whichever club fixture you're viewing (cross-check against that same club's chip/header tile elsewhere if practical, confirming the "same club, same face, everywhere" guarantee holds visually, not just in the hash function's own unit tests).

- [ ] **Step 7: Run the full suite and the type checker**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" app/__tests__/events-detail.test.tsx
git commit -m "feat(nav): the game screen gets its club's own small tile"
```

---

## Final check (Tasks 5-13)

- [ ] Run the full suite end to end: `npm test && npx tsc --noEmit`
- [ ] Confirm `components/ThreadRow.tsx`'s tests still pass unmodified — the `asTile` opt-in must have zero effect on the Messages list's small avatars (club threads included).
- [ ] Confirm the SAME club id resolves to the SAME glyph everywhere it's shown — spot-check one real club across its chip (Task 6), its dashboard tile (Task 10), its edit-page tile (Task 11), its messages-board tile (Task 12), and its game-screen tile (Task 13) in one live browser session, not just via the unit-level stability tests.
- [ ] A final visual pass, mobile width: the Clubs dashboard's combined top row (single-club case), the club edit page, a club's message board, and a game screen — confirming the whole "club representation" reads as one consistent design across all of them.
- [ ] Open a PR from `feat/mahjong-tile-nav` into `main` (per the standing branch-per-plan rule) rather than merging locally.
