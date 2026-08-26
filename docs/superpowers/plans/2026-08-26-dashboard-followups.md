# Dashboard Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seventeen open items raised against `feat/dashboard-artboard` — six UX gaps and eleven review findings — per `docs/superpowers/specs/2026-08-26-dashboard-followups-design.md`.

**Architecture:** Sixteen independent tasks, ordered so shared pieces land before their consumers: the `textMuted` token and the `Button` destructive variant first, then the `useViewerInitials` hook, then the screens that use them, then the new welcome route. Every task is a full red-green-commit cycle against the existing Vitest suite.

**Tech Stack:** Expo 57 / React Native 0.86 / expo-router 57, TypeScript, Vitest 4 + @testing-library/react through the `react-native` → `react-native-web` alias, react-native-svg.

## Global Constraints

- Tests run with `npm test`, which is `TZ=America/New_York vitest run`. Never run bare `vitest`; several suites depend on that timezone.
- Baseline before this plan: **48 files, 767 tests, all passing.** Every task must leave the whole suite green, not just its own file.
- `globals: true` is deliberately OFF. Import `describe`/`it`/`expect`/`vi` from `vitest` in every test file. There is no `@testing-library/jest-dom`; assert DOM attributes with a plain `getAttribute(...)` comparison.
- All colour, spacing, radius, shadow and type values come from `lib/theme.ts`. Do not hardcode hex, px spacing, or font names in a screen or component.
- Body text is 18pt minimum (`type.size.body`); `type.size.helper` (16) is the only sanctioned exception, for helper/secondary text.
- Text must clear WCAG AA (4.5:1) against the surface it is drawn on.
- Do not ship copy that names a person, club, or event that does not exist. The artboard's mock strings are references, not shippable text.
- Commit after every task. Each commit message ends with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Work stays on `feat/dashboard-artboard`. Do not branch, do not merge to `main`.

## File Structure

**Created**
- `lib/theme.test.ts` — contrast assertions for the muted-text tokens.
- `lib/use-viewer.ts` — `useViewerInitials()`, the one place the avatar's initials come from.
- `lib/use-viewer.test.tsx` — that hook's tests.
- `app/welcome.tsx` — the signed-out landing screen.
- `app/__tests__/welcome.test.tsx` — that screen's tests.
- `app/__tests__/sign-in.test.tsx` — the sign-in screen's back button.

**Modified**
- `lib/theme.ts` — `textMuted` darkens.
- `lib/dashboard.ts` — `initialsFrom` iterates code points.
- `lib/events.ts` — `formatEventWhen`, `eventStartTimeInZone` guard invalid dates.
- `components/DateTile.tsx` — same guard.
- `components/Skeleton.tsx` — no native driver on web.
- `components/ClubChips.tsx` — the bare `2` gets a name.
- `components/Button.tsx` — `destructive` variant; spinner colour becomes a lookup.
- `app/profile.tsx` — back link removed; sign out becomes a block destructive button.
- `app/clubs/index.tsx` — rows open the game; one `busy` flag; mounted guard; notice names the game; adopts `useViewerInitials`.
- `app/clubs/[id]/index.tsx`, `app/clubs/[id]/venues.tsx` — header and tab bar.
- `app/index.tsx` — signed-out members go to `/welcome`.
- `app/sign-in.tsx` — back button to `/welcome`.
- `docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md` — the tab-bar paragraph.
- Test files: `lib/dashboard.test.ts`, `lib/events.test.ts`, `components/__tests__/dashboard-parts.test.tsx`, `components/__tests__/Button.test.tsx`, `app/__tests__/clubs.test.tsx`, `app/__tests__/profile.test.tsx`, `app/__tests__/venues.test.tsx`, `app/__tests__/index.test.ts`.

---

### Task 1: `textMuted` clears AA (spec item 18)

**Files:**
- Create: `lib/theme.test.ts`
- Modify: `lib/theme.ts:60-70`

**Interfaces:**
- Consumes: nothing.
- Produces: `colors.textMuted` becomes `'#676158'`. Every screen already reads it by name; no call site changes.

- [ ] **Step 1: Write the failing test**

Create `lib/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { colors } from './theme';

/**
 * WCAG 2.1 relative luminance and contrast ratio, written out rather than
 * pulled from a package: it is a dozen lines, and a dependency for two
 * assertions is not worth the supply chain.
 *
 * This file exists because a comment claimed a ratio nobody had measured.
 * `textMuted` was documented as safe "because muted text is only ever placed
 * directly on the page background" — while measuring 3.57:1 there, below
 * AA's 4.5:1. Prose cannot hold a number honest; a test can.
 */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. The app's smallest text is 16pt, so the large-text
 *  allowance of 3:1 never applies to it. */
const AA = 4.5;

describe('contrast', () => {
  // The helper is doing real work for the assertions below, so it gets its
  // own anchor: black on white is 21:1 exactly, by definition.
  it('measures the two ends of the scale', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('muted text clears AA on both grounds it is drawn on', () => {
  it('clears AA on the page background', () => {
    expect(contrast(colors.textMuted, colors.bg)).toBeGreaterThanOrEqual(AA);
  });

  // The dashboard puts helper text inside cards, which are `surface`, not
  // `bg`. This is the ground the old value failed worst on (3.17:1).
  it('clears AA on a card', () => {
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(AA);
  });
});

describe('field labels clear AA on both grounds', () => {
  it('clears AA on the page background', () => {
    expect(contrast(colors.textLabel, colors.bg)).toBeGreaterThanOrEqual(AA);
  });

  it('clears AA on a card', () => {
    expect(contrast(colors.textLabel, colors.surface)).toBeGreaterThanOrEqual(AA);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- lib/theme.test.ts
```

Expected: FAIL — 2 of 5 fail. `muted text ... on the page background` reports `3.57` and `on a card` reports `3.17`, both `toBeGreaterThanOrEqual(4.5)`. The two `textLabel` tests and the `contrast` anchor pass.

- [ ] **Step 3: Darken the token**

In `lib/theme.ts`, replace the `textMuted` declaration and the whole comment block above it:

```ts
  // The design's muted tone is `color-mix(in srgb, text 55%, transparent)`,
  // which flattens over --color-bg to #807a71 — and measures 3.57:1 there,
  // under AA's 4.5:1 for the 16px helper text this app uses it for. An
  // earlier comment here called the flattening safe "because muted text is
  // only ever placed directly on the page background, never on a card": both
  // halves were wrong. The dashboard does put it on cards (3.17:1), and the
  // background it named was already failing.
  //
  // Darkened to a 65% mix of text over --color-surface: 0.65*(32,30,29) +
  // 0.35*(235,221,197) = (103,97,88). One value covers both grounds —
  // 5.15:1 on bg (#f5ead8), 4.58:1 on surface (#ebddc5) — so every screen in
  // the app clears AA, not only the ones a card was added to. Still plainly
  // muted against text (#201e1d). lib/theme.test.ts holds both ratios, so
  // the next move of this palette cannot quietly drop below them.
  textMuted: '#676158',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- lib/theme.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Expected: 49 files, 772 tests, all passing. No existing test asserts a literal `#807a71`.

- [ ] **Step 6: Commit**

```bash
git add lib/theme.ts lib/theme.test.ts
git commit -m "fix: darken textMuted so it clears AA on both grounds

Raised as a stale comment. The comment claimed flattening was safe
'because muted text is only ever placed directly on the page background,
never on a card' — and this branch does put it on cards, at 3.17:1.

Measuring the premise: #807a71 on colors.bg is 3.57:1. It never cleared
AA on the background either. The comment was not describing a safe
arrangement this branch broke, it was describing a failure that had
always been there, so fixing only the comment would have left it
standing.

#676158 — a 65% mix of text over surface — reads 5.15:1 on bg and
4.58:1 on surface. One token, so every screen is fixed rather than only
the ones a card was added to. lib/theme.test.ts pins both ratios.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `initialsFrom` keeps astral characters whole (spec item 10)

**Files:**
- Modify: `lib/dashboard.ts:59-65`
- Test: `lib/dashboard.test.ts:122-133`

**Interfaces:**
- Consumes: nothing.
- Produces: `initialsFrom(displayName: string): string` — same signature, now code-point safe. Task 9's `useViewerInitials` calls it.

- [ ] **Step 1: Write the failing test**

In `lib/dashboard.test.ts`, add inside the existing `describe('initialsFrom', ...)` block, after the `returns empty for a name that was never set` test:

```ts
  // `word[0]` returns one UTF-16 code unit. A name starting with an astral
  // character (an emoji, or a supplementary-plane letter) is a surrogate
  // pair, so indexing yields a lone unpaired high surrogate — which renders
  // in the avatar as a replacement glyph, not a letter.
  it('keeps an astral first character whole', () => {
    // U+1D49C MATHEMATICAL SCRIPT CAPITAL A, then a plain ASCII surname.
    expect(initialsFrom('\u{1D49C}da Lovelace')).toBe('\u{1D49C}L');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- lib/dashboard.test.ts
```

Expected: FAIL — `expected '\uD835L' to be '\u{1D49C}L'`. The received value is a lone high surrogate followed by `L`.

- [ ] **Step 3: Iterate code points**

In `lib/dashboard.ts`, replace the body of `initialsFrom`:

```ts
export function initialsFrom(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    // `Array.from(word)[0]`, not `word[0]`: string indexing yields a single
    // UTF-16 code unit, so a name whose first character is astral produces a
    // lone unpaired surrogate — a replacement glyph in the avatar rather
    // than the letter the member chose. Array.from iterates code points.
    // The `?? ''` is unreachable — `filter(Boolean)` above has already
    // dropped every empty string — and is kept only so this line cannot
    // become a crash if that filter is ever loosened.
    .map((word) => (Array.from(word)[0] ?? '').toUpperCase())
    .join('');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- lib/dashboard.test.ts
```

Expected: PASS. The existing `takes the first letter of the first two words` and `returns empty for a name that was never set` still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts
git commit -m "fix: read initials by code point, not by UTF-16 unit

A display name whose first character is astral produced a lone unpaired
high surrogate in the avatar — a replacement glyph rather than a letter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: An unreadable date does not take down the screen (spec item 11)

**Files:**
- Modify: `lib/events.ts:263-277` (`formatEventWhen`), `lib/events.ts:305-315` (`eventStartTimeInZone`)
- Modify: `components/DateTile.tsx:23-33`
- Test: `lib/events.test.ts` (the existing `formatEventWhen` and `eventStartTimeInZone` describes), `components/__tests__/dashboard-parts.test.tsx` (the existing `DateTile` describe)

**Interfaces:**
- Consumes: nothing.
- Produces: `formatEventWhen(startsAt, timezone, locale?)` returns `'Date unavailable'` for an unparseable `startsAt`; `eventStartTimeInZone(startsAt, timezone)` returns `''`; `<DateTile>` renders `--` in both slots. Task 13 calls `formatEventWhen`.

All three currently hand an `Invalid Date` to `Intl.DateTimeFormat`, which throws `RangeError`. One malformed `starts_at` from the server therefore blanks every screen that lists games, rather than the one row carrying it. Verified: all three throw today.

- [ ] **Step 1: Write the three failing tests**

In `lib/events.test.ts`, add to the existing `describe('formatEventWhen', ...)`:

```ts
  // Intl.DateTimeFormat.format throws RangeError on an Invalid Date, so a
  // single malformed starts_at from the server used to take down every
  // screen that renders a list of games rather than the one row carrying it.
  it('says so rather than throwing when the date cannot be read', () => {
    expect(formatEventWhen('not-a-date', 'America/New_York')).toBe(
      'Date unavailable',
    );
  });
```

In `lib/events.test.ts`, add to the existing `describe('eventStartTimeInZone', ...)`:

```ts
  // Empty rather than a plausible-looking "00:00": this value fills a
  // TimeField, and a midnight the member never chose is a wrong answer they
  // might save over a real one. An empty field is the honest state for a
  // stored value that cannot be read.
  it('returns an empty time rather than throwing when the date cannot be read', () => {
    expect(eventStartTimeInZone('not-a-date', 'America/New_York')).toBe('');
  });
```

In `components/__tests__/dashboard-parts.test.tsx`, add to the existing `describe('DateTile', ...)`:

```ts
  it('renders placeholders rather than throwing when the date cannot be read', () => {
    render(<DateTile startsAt="not-a-date" timezone="America/New_York" />);
    expect(screen.getAllByText('--')).toHaveLength(2);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- lib/events.test.ts components/__tests__/dashboard-parts.test.tsx
```

Expected: FAIL, 3 failures, each a thrown `RangeError: Invalid time value`.

- [ ] **Step 3: Guard `formatEventWhen`**

In `lib/events.ts`, replace the body of `formatEventWhen`:

```ts
export function formatEventWhen(
  startsAt: string,
  timezone: string,
  locale?: string,
): string {
  const when = new Date(startsAt);
  // Intl.DateTimeFormat.format throws RangeError on an Invalid Date. Every
  // caller is rendering a list, so one malformed row used to blank the whole
  // list — and the dashboard, the club screen and the event screen all call
  // this. Degrading the one row is the proportionate failure.
  if (Number.isNaN(when.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(locale ?? 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(when);
}
```

- [ ] **Step 4: Guard `eventStartTimeInZone`**

In `lib/events.ts`, replace the body of `eventStartTimeInZone`, keeping its existing docstring above:

```ts
export function eventStartTimeInZone(startsAt: string, timezone: string): string {
  const when = new Date(startsAt);
  // Same RangeError guard as formatEventWhen. Empty rather than a
  // plausible-looking "00:00": this fills a TimeField on the edit screen,
  // and a midnight the member never chose is a wrong answer they might save
  // over the real one. An empty field says "unknown" honestly.
  if (Number.isNaN(when.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(when);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}
```

- [ ] **Step 5: Guard `DateTile`**

In `components/DateTile.tsx`, replace the three `const` declarations at the top of the component body:

```tsx
  const when = new Date(startsAt);
  // Same RangeError guard as lib/events.ts's formatEventWhen — and this tile
  // sits inside a row whose meta line calls exactly that function, so the
  // two degrade together rather than one throwing past the other's fallback.
  const readable = !Number.isNaN(when.getTime());
  const day = readable
    ? new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        timeZone: timezone,
      })
        .format(when)
        .toUpperCase()
    : '--';
  const date = readable
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        timeZone: timezone,
      }).format(when)
    : '--';
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- lib/events.test.ts components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run the whole suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add lib/events.ts lib/events.test.ts components/DateTile.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "fix: degrade one row, not the screen, on an unreadable date

formatEventWhen, eventStartTimeInZone and DateTile all handed an Invalid
Date straight to Intl.DateTimeFormat, which throws RangeError. A single
malformed starts_at from the server therefore blanked every screen that
lists games rather than the one row carrying it.

eventStartTimeInZone returns '' rather than a plausible '00:00': it
fills a TimeField, and a midnight the member never chose is a wrong
answer they might save over the real one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard component nits (spec items 12, 13a, 14)

**Files:**
- Modify: `components/Skeleton.tsx`
- Modify: `components/ClubChips.tsx:50-56`
- Test: `components/__tests__/dashboard-parts.test.tsx` (the existing `Skeleton` describe)

**Interfaces:**
- Consumes: nothing.
- Produces: no API change. `<Skeleton delay?: number>` and `<ClubChips chips selected onSelect>` keep their signatures.

`Animated.delay` is spy-able through the `react-native` → `react-native-web` alias; this was verified before writing the plan.

- [ ] **Step 1: Write the failing test**

In `components/__tests__/dashboard-parts.test.tsx`, add the `Animated` import to the existing `react-native`-free import block at the top of the file:

```ts
import { Animated } from 'react-native';
```

Then add to the existing `describe('Skeleton', ...)`:

```tsx
  // The `delay` prop is passed by three call sites on the dashboard and was
  // asserted by none, so the stagger could have silently collapsed to three
  // blocks pulsing in unison. Spying the Animated call is the only handle:
  // the phase shift is not observable in the rendered DOM.
  it('staggers each block by the delay it was given', () => {
    const delay = vi.spyOn(Animated, 'delay');
    render(
      <>
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </>,
    );
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([0, 150, 300]);
    delay.mockRestore();
  });
```

- [ ] **Step 2: Run the test to verify it passes for the right reason**

```bash
npm test -- components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS. This one is a characterization test — the stagger already works, and the test exists so a regression cannot pass unnoticed. Confirm it is genuinely wired by temporarily changing `Animated.delay(delay)` to `Animated.delay(0)` in `components/Skeleton.tsx`, re-running, seeing `[0, 0, 0]` fail the assertion, then reverting.

- [ ] **Step 3: Drop the native driver on web**

In `components/Skeleton.tsx`, change the import line:

```tsx
import { Animated, Platform, StyleSheet } from 'react-native';
```

and set `useNativeDriver` on **both** `Animated.timing` calls (the `toValue: 0.9` one and the `toValue: 0.5` one) to:

```tsx
            // No native driver exists on the web target, where
            // react-native-web logs a fallback warning on every mount —
            // three per dashboard load, since the dashboard stacks three of
            // these. Opacity animates fine on the JS driver there.
            useNativeDriver: Platform.OS !== 'web',
```

- [ ] **Step 4: Name ClubChips' scroll gutter**

In `components/ClubChips.tsx`, add above the `StyleSheet.create` call:

```tsx
/**
 * The artboard's chip row is `overflow-x: auto` with `padding-bottom: 2px`,
 * a literal 2 rather than a step on the spacing scale — whose smallest step,
 * space[1], is 4.4. Named here so the number is not a mystery, and NOT added
 * to lib/theme.ts: a value with one call site is a literal, not a token.
 */
const SCROLL_GUTTER = 2;
```

and change the `row` style's `paddingBottom`:

```tsx
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingBottom: SCROLL_GUTTER,
  },
```

- [ ] **Step 5: Run the suite and the typechecker**

```bash
npm test
```

Expected: all passing, including the existing `ClubChips` tests.

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add components/Skeleton.tsx components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "fix: quiet Skeleton's web driver warning, pin its stagger

Skeleton animated opacity with useNativeDriver: true, which does not
exist on the web target — react-native-web logged a fallback warning on
every mount, three per dashboard load.

The delay prop was passed by three call sites and asserted by none, so
the stagger could have collapsed to three blocks pulsing in unison
without a test noticing. The phase shift is not observable in the DOM,
so the test spies Animated.delay.

ClubChips' bare paddingBottom: 2 is the artboard's literal 2px gutter.
Named as a module constant rather than added to lib/theme.ts — a value
with one call site is a literal, not a token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Split the bundled exclusion test, cover the zero-alert two-table case (spec items 9, 13b)

**Files:**
- Test: `lib/dashboard.test.ts:186-206` (replace), `lib/dashboard.test.ts:296-350` (add)

**Interfaces:**
- Consumes: the file's existing `event()`, `booking()`, `CLUBS`, `NOW` and `threeSeated` helpers.
- Produces: nothing. Tests only — no source change in this task.

- [ ] **Step 1: Split the three-in-one exclusion test**

In `lib/dashboard.test.ts`, delete the whole `it('drops a full event, a cancelled one, and one already started', ...)` block and put these three in its place:

```ts
  // One assertion per exclusion path. These were a single test asserting
  // `rows).toEqual([])` over all three events at once, which any two of them
  // could regress under without the assertion changing.
  it('drops an event with no free seat', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'full',
          bookings: [
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-1' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops a cancelled event', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event({ id: 'cancelled', status: 'cancelled' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops an event that has already started', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event({ id: 'past', starts_at: '2026-08-01T23:00:00Z' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });
```

- [ ] **Step 2: Add the zero-alert two-table case**

In `lib/dashboard.test.ts`, inside `describe('needAFourthAlerts', ...)`, add after the existing `raises one alert per table when both are one seat short` test:

```ts
  // The negative of the pair above. The two-table cases covered "one short"
  // and "both short" but never "neither short", so a `needsAFourth` that had
  // come to return true for a table with two free seats would have passed
  // every multi-table test in this file.
  it('stays silent when neither table is short', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          event_tables: twoTables,
          table_count: 2,
          bookings: [
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-2' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
npm test -- lib/dashboard.test.ts
```

Expected: PASS. Three tests replace one, one is added — net +3 in this file.

- [ ] **Step 4: Prove the new test can fail**

Temporarily change `if (!short) continue;` to `if (false) continue;` in `needAFourthAlerts` (`lib/dashboard.ts`), re-run `npm test -- lib/dashboard.test.ts`, confirm `stays silent when neither table is short` now fails with two alerts, then revert.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.test.ts
git commit -m "test: separate the exclusion paths, cover the zero-alert two tables

buildDashboardRows asserted three independent exclusion paths — full,
cancelled, already started — through one toEqual([]) over all three
events at once, so any two could regress silently. Now one test each.

needAFourthAlerts covered one-short and both-short across two tables but
never neither-short, so a rule that had come to alert on a table with
two free seats would have passed every multi-table test here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `Button` gains a destructive variant (spec item 3, part 1)

**Files:**
- Modify: `components/Button.tsx:14`, `:110-115`, `:189-206`, `:210-218`
- Test: `components/__tests__/Button.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ButtonVariant` becomes `'primary' | 'secondary' | 'ghost' | 'dark' | 'destructive'`. Task 7 renders `<Button variant="destructive" block>`.

- [ ] **Step 1: Write the failing test**

In `components/__tests__/Button.test.tsx`, add a new describe after the existing `describe('Button', ...)` block:

```tsx
describe('Button: the destructive variant', () => {
  // Not in the design system, which draws sign-out as a ghost link. The one
  // control on the profile screen that ends the session needs more weight
  // than a text link, and the pairing is the one Tag's `accent` variant
  // already uses: accent-200 ground, accent-800 text, 8.37:1.
  it('renders accent-800 on accent-200', () => {
    render(
      <Button onPress={() => {}} variant="destructive" accessibilityLabel="Sign out">
        Sign out
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sign out' });
    // Plain getAttribute/style reads, matching the rest of this file: the
    // repo has no jest-dom, and react-native-web flattens StyleSheet styles
    // onto the DOM node's inline style.
    expect(button.style.backgroundColor).toBe('rgb(255, 225, 208)');
    expect(screen.getByText('Sign out').style.color).toBe('rgb(100, 51, 18)');
  });

  it('is still a button that reports its disabled state', () => {
    render(
      <Button onPress={() => {}} variant="destructive" disabled accessibilityLabel="Sign out">
        Sign out
      </Button>,
    );
    expect(
      screen.getByRole('button', { name: 'Sign out' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- components/__tests__/Button.test.tsx
```

Expected: FAIL — `variant="destructive"` is not assignable to `ButtonVariant`, and at runtime `variantStyles['destructive']` is `undefined`, so `button.style.backgroundColor` is `''`.

- [ ] **Step 3: Add the variant**

In `components/Button.tsx`, widen the type:

```ts
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'dark'
  // Not in the design system, which draws its one destructive action
  // (sign out) as a ghost link. A bare link is the wrong weight for the
  // control that ends the session, and it read as a stray link rather than
  // a button. Lives here rather than as inline style at the call site so
  // the next destructive action inherits one treatment.
  | 'destructive';
```

Add to `variantStyles`:

```ts
  destructive: {
    // The same pairing Tag's `accent` variant uses, at 8.37:1.
    backgroundColor: colors.accent[200],
  },
```

Add to `variantTextStyles`:

```ts
  destructive: { color: colors.accent[800] },
```

- [ ] **Step 4: Replace the spinner-colour ternary with a lookup**

Still in `components/Button.tsx`, the loading spinner picks its colour with a two-arm ternary that has no answer for a fifth variant — `accentColor` on `accent[200]` would be the wrong tint. Add above the component:

```tsx
/**
 * The loading spinner's tint per variant. A lookup rather than the ternary
 * this replaced (`variant === 'primary' || variant === 'dark' ? bg : accent`),
 * which silently gave every new variant the accent tint whether or not it
 * read on that variant's ground.
 */
const spinnerColor: Record<ButtonVariant, string> = {
  primary: colors.bg,
  dark: colors.bg,
  secondary: colors.accentColor,
  ghost: colors.accentColor,
  destructive: colors.accent[800],
};
```

and replace the `ActivityIndicator`'s `color` prop:

```tsx
        <ActivityIndicator
          color={spinnerColor[variant]}
          accessibilityLabel={accessibilityLabel}
        />
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- components/__tests__/Button.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 7: Commit**

```bash
git add components/Button.tsx components/__tests__/Button.test.tsx
git commit -m "feat: add Button's destructive variant

accent-200 ground with accent-800 text, 8.37:1 — the same pairing Tag's
accent variant uses. Not in the design system, which draws sign-out as a
ghost link; a bare link is the wrong weight for the control that ends
the session.

The spinner's colour becomes a per-variant lookup. The ternary it
replaces (primary/dark get bg, everything else gets accent) would have
given this variant the accent tint on an accent-200 ground without
anyone choosing that.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Profile drops its back link and gets a real sign-out button (spec items 3, 4)

**Files:**
- Modify: `app/profile.tsx` — imports, `router`, the back `Button`, the sign-out `Button`, `styles.backButton`, `styles.signOut`
- Test: `app/__tests__/profile.test.tsx`

**Interfaces:**
- Consumes: `variant="destructive"` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

In `app/__tests__/profile.test.tsx`, add inside `describe('profile screen', ...)`:

```tsx
  // Profile was reachable only by pushing onto a stack when this link was
  // added. The tab bar now sits under every tab screen and its Club tab is
  // the same destination, so the link was a second way to do one thing.
  it('has no back link now the tab bar carries that job', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(await screen.findByText('Save')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to your clubs' })).toBeNull();
  });

  // Sign out was a left-aligned ghost text button — the design system's own
  // treatment, and it read as a stray link rather than the control that ends
  // the session.
  it('renders sign out as a full-width destructive button', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // `getComputedStyle`, not `.style`: this repo's react-native-web emits
    // atomic CSS classes into an injected stylesheet rather than flattening
    // StyleSheet values onto the node's inline style, so `.style.*` reads
    // empty for every variant — an assertion that would pass whether or not
    // the variant were applied. Task 6 established this.
    expect(getComputedStyle(signOut).backgroundColor).toBe('rgb(255, 225, 208)');
    // `block` sets `width: '100%'` via StyleSheet, so it atomizes the same
    // way — assert the resolved value, not merely that something is set.
    expect(getComputedStyle(signOut).width).toBe('100%');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/profile.test.tsx
```

Expected: FAIL, 2 failures — the back button is still found, and the sign-out button computes as `rgba(0, 0, 0, 0)` (ghost is transparent) rather than the destructive ground.

If `getComputedStyle` does not resolve the atomic class in jsdom for this screen the way it did in Task 6, say so rather than relaxing the assertion until it passes — a test that asserts whatever the code happens to do is worthless. Asserting the button is `block` may need a different handle; if so, report what you found.

- [ ] **Step 3: Remove the back link**

In `app/profile.tsx`:

Change the expo-router import to drop `useRouter`:

```tsx
import { Link, Redirect } from 'expo-router';
```

Delete the `ChevronLeftIcon` import line entirely:

```tsx
import { ChevronLeftIcon } from '../components/icons';
```

Delete the `const router = useRouter();` line.

Delete the whole back-link block from the main render — the `{/* Profile is no longer the landing screen ... */}` comment and the `<Button variant="ghost" ... >Clubs</Button>` element it introduces — so the render now opens on `<Text style={styles.heading}>Your profile</Text>`.

Delete the `backButton` style from `StyleSheet.create`.

- [ ] **Step 4: Make sign out a destructive block button**

Still in `app/profile.tsx`, replace the sign-out `Button`:

```tsx
      <Button
        variant="destructive"
        block
        onPress={onSignOut}
        disabled={signingOut}
        loading={signingOut}
        accessibilityLabel="Sign out"
        style={styles.signOut}
      >
        Sign out
      </Button>
```

and replace the `signOut` style — `alignSelf: 'flex-start'` goes with the left-aligned link it existed for:

```tsx
  signOut: {
    marginTop: space[2],
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/profile.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output — in particular no unused-import or unused-variable error for `useRouter` or `ChevronLeftIcon`. All tests passing.

- [ ] **Step 7: Commit**

```bash
git add app/profile.tsx app/__tests__/profile.test.tsx
git commit -m "feat: give profile a real sign-out button, drop its back link

Sign out was a left-aligned ghost text button — the design system's own
treatment for it, and it read as a stray link rather than the one
control on this screen that ends the session. Now a full-width
destructive button.

The back link went with it. It was added when profile was reachable
only by pushing onto a stack; the tab bar now sits under every tab
screen and its Club tab is the same destination.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `useViewerInitials` (spec item 5, groundwork)

**Files:**
- Create: `lib/use-viewer.ts`, `lib/use-viewer.test.tsx`
- Modify: `app/clubs/index.tsx` — drop `profileName` state and its fetch, call the hook

**Interfaces:**
- Consumes: `initialsFrom` from `lib/dashboard.ts` (Task 2), `fetchProfile` from `lib/profile.ts`, `useSession` from `lib/session.tsx`.
- Produces: `useViewerInitials(): string` — exported from `lib/use-viewer.ts`. Tasks 9 and 10 call it.

- [ ] **Step 1: Write the failing test**

Create `lib/use-viewer.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const fetchProfile = vi.fn();

vi.mock('./profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('./session', () => ({ useSession: () => useSessionMock() }));

import { useViewerInitials } from './use-viewer';

/**
 * A probe rather than renderHook: this repo has no
 * @testing-library/react-hooks, and the hook's whole contract is one string,
 * which a one-line component reports perfectly well.
 */
function Probe() {
  return <span data-testid="initials">{useViewerInitials()}</span>;
}

function initials() {
  return screen.getByTestId('initials').textContent;
}

describe('useViewerInitials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({
      session: { user: { id: 'test-user' } },
      loading: false,
    });
  });

  it('reports the signed-in member initials once the profile arrives', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: 'Pat Chen',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<Probe />);
    await waitFor(() => expect(initials()).toBe('PC'));
    expect(fetchProfile).toHaveBeenCalledWith('test-user');
  });

  // A magic-link signup starts with display_name = '' and nothing forces
  // one. Empty is a real answer here, not a failure: DashboardHeader draws a
  // person glyph for it rather than inventing a letter the member never
  // chose.
  it('reports empty for a member who never set a name', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: '',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<Probe />);
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    expect(initials()).toBe('');
  });

  // fetchProfile resolves null on any failure rather than rejecting, so this
  // is the same shape as the case above and must not throw or hang.
  it('reports empty when the profile cannot be read', async () => {
    fetchProfile.mockResolvedValue(null);
    render(<Probe />);
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    expect(initials()).toBe('');
  });

  it('does not read a profile when nobody is signed in', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<Probe />);
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(initials()).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- lib/use-viewer.test.tsx
```

Expected: FAIL — `Failed to resolve import "./use-viewer"`.

- [ ] **Step 3: Write the hook**

Create `lib/use-viewer.ts`:

```ts
import { useEffect, useState } from 'react';
import { initialsFrom } from './dashboard';
import { fetchProfile } from './profile';
import { useSession } from './session';

/**
 * The signed-in member's initials, for the avatar every header draws.
 *
 * Three screens want this — the dashboard, the club screen and the venue
 * screen — and the dashboard was deriving it from its own state and its own
 * fetch inside a mount effect that already had four other jobs. One hook
 * instead of three copies of the same effect.
 *
 * Keyed on `session?.user.id`, NOT on `session`: lib/session.tsx hands out a
 * fresh Session object on every onAuthStateChange, TOKEN_REFRESHED included,
 * which fires within the hour and on web tab focus. Depending on the object
 * would refetch every time for a value that only changes on a real account
 * switch. The same reasoning app/profile.tsx already records for its own
 * fetch.
 *
 * `''` is a real answer rather than an error state, and it is what all three
 * failure-ish paths produce: no session, a member who never set a display
 * name (a magic-link signup starts with `display_name = ''` and nothing
 * forces one), and a failed read — `fetchProfile` resolves null on any
 * failure rather than rejecting. DashboardHeader draws a person glyph for
 * the empty string rather than inventing a letter the member never chose, so
 * all three degrade to the same honest thing.
 */
export function useViewerInitials(): string {
  const { session } = useSession();
  const userId = session?.user.id;
  const [initials, setInitials] = useState('');

  useEffect(() => {
    if (!userId) {
      setInitials('');
      return;
    }
    let cancelled = false;
    fetchProfile(userId).then((profile) => {
      if (cancelled) return;
      setInitials(initialsFrom(profile?.display_name ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return initials;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- lib/use-viewer.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Have the dashboard use it**

In `app/clubs/index.tsx`:

Add the import beside the other `lib` imports:

```tsx
import { useViewerInitials } from '../../lib/use-viewer';
```

Delete the `profileName` state declaration:

```tsx
  const [profileName, setProfileName] = useState('');
```

Delete the `fetchProfile` call and its `.then` from the mount effect:

```tsx
    fetchProfile(userId).then((profile) => {
      if (cancelled) return;
      setProfileName(profile?.display_name ?? '');
    });
```

Delete the now-unused import:

```tsx
import { fetchProfile } from '../../lib/profile';
```

Remove `initialsFrom` from the `lib/dashboard` import list — the hook owns that call now. The import becomes:

```tsx
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  inScope,
  needAFourthAlerts,
} from '../../lib/dashboard';
```

Add the hook call beside the other hooks at the top of the component:

```tsx
  const initials = useViewerInitials();
```

and change `DashboardHeader`'s prop:

```tsx
        initials={initials}
```

- [ ] **Step 6: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output. All tests passing — `app/__tests__/clubs.test.tsx` already mocks `lib/profile`, so the hook's fetch resolves through the same stub the screen's own fetch used to, and the existing initials assertions still hold.

- [ ] **Step 7: Commit**

```bash
git add lib/use-viewer.ts lib/use-viewer.test.tsx app/clubs/index.tsx
git commit -m "refactor: one hook for the viewer's avatar initials

The club and venue screens are about to draw the same header the
dashboard does, and the dashboard derived its initials from its own
state inside a mount effect that already had four other jobs. Three
copies of that effect is two too many.

Keyed on session?.user.id rather than session: lib/session.tsx hands out
a fresh object on every onAuthStateChange, TOKEN_REFRESHED included, so
depending on the object would refetch within the hour for a value that
changes only on a real account switch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Club detail gets the header and the tab bar (spec item 5)

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Test: `app/__tests__/clubs.test.tsx` (the existing `describe('club detail screen', ...)`)

**Interfaces:**
- Consumes: `useViewerInitials()` from Task 8; `DashboardHeader` and `TabBar` as they stand.
- Produces: nothing.

`TabBar` goes on every state, `DashboardHeader` only on the ready one — the header's kicker, name and meta all read from the fetched club, which has not arrived while loading and never arrives on failure.

- [ ] **Step 1: Write the failing tests**

In `app/__tests__/clubs.test.tsx`, add inside `describe('club detail screen', ...)`:

```tsx
  // TabBar navigates with router.replace off an entry route that is itself a
  // Redirect, so the history stack is typically one deep. A club screen with
  // no bar and (below) no back button would be a dead end on native.
  it('carries the tab bar', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  it('carries the tab bar while the club is still loading', () => {
    // A promise that never settles: the screen stays in its !ready state for
    // the life of the test.
    fetchClub.mockReturnValueOnce(new Promise(() => {}));
    fetchRoster.mockReturnValueOnce(new Promise(() => {}));
    render(<ClubDetailScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('carries the tab bar when the club cannot be loaded', async () => {
    fetchClub.mockResolvedValueOnce(null);
    render(<ClubDetailScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('names the club in the dashboard header, with the avatar to profile', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: 'Pat Chen',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Your club')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
    expect(await screen.findByText('PC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  // Removed with the tab bar's arrival: the Club tab is the same
  // destination, so the chevron was a second way to do one thing.
  it('no longer draws its own back link', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to your clubs' })).toBeNull();
  });
```

`ClubDetailScreen` is already imported at `app/__tests__/clubs.test.tsx:731`, immediately above the `club detail screen` describe. No new import is needed.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: FAIL, 5 failures — no tab-bar buttons anywhere, no `Your club` kicker, and the back link is still found.

- [ ] **Step 3: Add the imports**

In `app/clubs/[id]/index.tsx`, add beside the other component imports:

```tsx
import DashboardHeader from '../../../components/DashboardHeader';
import TabBar from '../../../components/TabBar';
```

and beside the other `lib` imports:

```tsx
import { useViewerInitials } from '../../../lib/use-viewer';
```

Add the hook call beside the other hooks at the top of the component, above the `useState` block:

```tsx
  const initials = useViewerInitials();
```

- [ ] **Step 4: Put the tab bar on every state**

In `app/clubs/[id]/index.tsx`, add `tabBar={<TabBar active="club" />}` to all four `<Screen>` elements — the `loading` spinner, the `!ready` spinner, the `loadFailed` error, and the main render. For example the first becomes:

```tsx
    return (
      <Screen
        center
        contentStyle={styles.centered}
        tabBar={<TabBar active="club" />}
      >
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
```

Leave `if (!session) return <Redirect href="/sign-in" />;` alone — it renders nothing, and a signed-out member belongs at sign-in rather than in a tab bar.

- [ ] **Step 5: Swap the back link and heading for the header**

In `app/clubs/[id]/index.tsx`'s main render, delete the back `<Button variant="ghost" ...>Clubs</Button>` block, the `<Text style={styles.heading}>{club.name}</Text>` line, and the `{club.rhythm.length > 0 ? <Text style={styles.help}>{club.rhythm}</Text> : null}` line, and put this in their place as the first child of `<Screen>`:

```tsx
      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        initials={initials}
        onPressAvatar={() => router.push('/profile')}
      />
```

Delete the `backButton` and `heading` styles from `StyleSheet.create`. The back button was `ChevronLeftIcon`'s only use in this file, so delete its import too:

```tsx
import { ChevronLeftIcon } from '../../../components/icons';
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 8: Commit**

```bash
git add "app/clubs/[id]/index.tsx" app/__tests__/clubs.test.tsx
git commit -m "feat: give the club screen the app header and tab bar

One of the two screens reached most often from the dashboard, and it
carried neither. The bar goes on every state including the loading and
error early returns — TabBar navigates with router.replace off an entry
route that is itself a Redirect, so a barless error state is a dead end
on native.

The header goes on the ready state only: its kicker, name and meta all
read from the fetched club, which has not arrived while loading and
never arrives on failure.

Its back link goes with it. The Club tab is the same destination.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Venues gets the header and the tab bar (spec item 5)

**Files:**
- Modify: `app/clubs/[id]/venues.tsx`
- Test: `app/__tests__/venues.test.tsx`

**Interfaces:**
- Consumes: `useViewerInitials()` from Task 8.
- Produces: nothing.

The venue screen's back button **stays**: no tab reaches a specific club, so the Club tab would strand a member at the dashboard rather than returning them to the club they came from.

- [ ] **Step 1: Mock `lib/profile` in the venue tests**

`app/__tests__/venues.test.tsx` does not mock `lib/profile`, so once the hook lands the screen would call the real `fetchProfile` against the placeholder Supabase env. Add beside the other module mocks near the top of the file, above the `import VenuesScreen from '../clubs/[id]/venues';` line:

```tsx
const fetchProfile = vi.fn();

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});
```

and give it a default in the file's existing `beforeEach`:

```tsx
  fetchProfile.mockResolvedValue(null);
```

- [ ] **Step 2: Write the failing tests**

In `app/__tests__/venues.test.tsx`, add a new describe at the end of the file:

```tsx
describe('screen chrome', () => {
  it('carries the tab bar', async () => {
    render(<VenuesScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alerts' })).toBeTruthy();
  });

  it('carries the tab bar when the club cannot be loaded', async () => {
    fetchClub.mockResolvedValueOnce(null);
    render(<VenuesScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('heads the screen with the club as kicker and Venues as the name', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: 'Pat Chen',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<VenuesScreen />);
    expect(await screen.findByText('Venues')).toBeTruthy();
    expect(await screen.findByText('PC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  // Kept, unlike the club screen's: no tab reaches a specific club, so the
  // Club tab would strand a member at the dashboard rather than returning
  // them to the club they came from.
  it('keeps its back link to the club', async () => {
    render(<VenuesScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the club' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });
});
```

`fireEvent` is already in the file's `@testing-library/react` import (line 2), so no import change is needed.

`TabBar` navigates with `router.replace`, which this file's `useRouter` mock does not provide. Add it so a pressed tab does not throw:

```tsx
  useRouter: () => ({ push, replace }),
```

and declare it beside the existing `push` at the top of the file:

```tsx
const replace = vi.fn();
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/venues.test.tsx
```

Expected: FAIL — three of the four fail (no tab bar, no avatar). `keeps its back link to the club` passes already; it is there to pin behaviour this task must not break.

- [ ] **Step 4: Add the imports and the hook**

In `app/clubs/[id]/venues.tsx`, add beside the other component imports:

```tsx
import DashboardHeader from '../../../components/DashboardHeader';
import TabBar from '../../../components/TabBar';
```

and beside the other `lib` imports:

```tsx
import { useViewerInitials } from '../../../lib/use-viewer';
```

Add the hook call beside the other hooks at the top of the component:

```tsx
  const initials = useViewerInitials();
```

- [ ] **Step 5: Put the tab bar on every state**

Add `tabBar={<TabBar active="club" />}` to all four `<Screen>` elements in `app/clubs/[id]/venues.tsx` — the `loading` spinner, the `!ready` spinner, the `loadFailed` error, and the main render. Leave the `<Redirect href="/sign-in" />` return alone.

- [ ] **Step 6: Swap the heading for the header**

In the main render, replace the `<Text style={styles.heading}>Venues</Text>` line with:

```tsx
      <DashboardHeader
        kicker={club.name}
        name="Venues"
        meta=""
        initials={initials}
        onPressAvatar={() => router.push('/profile')}
      />
```

The back button above it stays exactly as it is. Delete the `heading` style from `StyleSheet.create`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/venues.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 9: Commit**

```bash
git add "app/clubs/[id]/venues.tsx" app/__tests__/venues.test.tsx
git commit -m "feat: give the venue screen the app header and tab bar

Same chrome as the club screen, with the club as the kicker and Venues
as the name. The bar goes on every state; the header on the ready one,
where the club it names has actually loaded.

The back link stays here, unlike on the club screen: no tab reaches a
specific club, so the Club tab would strand a member at the dashboard
rather than returning them to the club they came from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Game rows open the game (spec items 2, 13c)

**Files:**
- Modify: `app/clubs/index.tsx` — `GameRow`'s row, `styles.gameOpen`
- Test: `app/__tests__/clubs.test.tsx` — the `expo-router` mock, a new test, and the pre-assertion

**Interfaces:**
- Consumes: `DashboardRow`'s existing `clubId` and `eventId` fields.
- Produces: nothing.

The press target covers the date tile and the title block only. A row can also carry a Join button, a Seated tag, offer accept/decline buttons, a leave-waitlist button and a check-in control; a card-wide pressable would put two competing targets on the same pixels.

- [ ] **Step 1: Teach the test mock to carry hrefs**

`app/__tests__/clubs.test.tsx`'s `expo-router` mock renders `Link` as its children and drops `href` entirely, so no test in the file can see where a link points. Replace the `Link` line in that mock:

```tsx
  // Renders as a real anchor carrying the href, so a test can assert where a
  // link points. It used to render its children and drop `href` on the
  // floor, which made every `Link` in these screens untestable. The club
  // cards below nest a Pressable inside via `asChild`; a div inside an
  // anchor is valid, and the existing role-based queries still find it.
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-href={href}>{children}</a>
  ),
```

- [ ] **Step 2: Write the failing test**

In `app/__tests__/clubs.test.tsx`, add inside `describe('dashboard artboard', ...)`:

```tsx
  // The rows were inert: the one thing a member wants from a game they can
  // see is to open it.
  it('opens the game when a row is tapped', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValueOnce([BOOKING]);
    render(<ClubsScreen />);
    const row = await screen.findByRole('button', { name: 'Open Sunday social' });
    expect(row.closest('a')?.getAttribute('data-href')).toBe(
      '/clubs/club-1/events/event-9',
    );
  });

  // The row's own controls must stay outside that press target, or a Join
  // tap would land on two competing targets at once.
  it('keeps the Join button outside the row press target', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchUpcomingEvents.mockResolvedValueOnce([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    render(<ClubsScreen />);
    const join = await screen.findByRole('button', { name: /Join Open game/ });
    expect(join.closest('a')).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Open Sunday social"`. `keeps the Join button outside the row press target` passes already; it pins the boundary this task must respect.

- [ ] **Step 4: Wrap the row's date and title in a Link**

In `app/clubs/index.tsx`'s `GameRow`, replace the `<DateTile ...>` element and the `<View style={styles.gameBody}>` block that follows it with a single `Link`-wrapped `Pressable` containing both, leaving the trailing `booking === null ? ... : ...` ternary exactly where it is:

```tsx
      <View style={styles.gameRow}>
        {/*
          Pressable rather than the Card itself, and the trailing controls
          left outside it: a row can carry a Join button, a Seated tag, offer
          accept/decline, leave-waitlist and a check-in control, and a
          card-wide press target would sit under all of them. Pressable
          rather than Card for the `asChild` reason this file documents at
          length for the club cards below — Card neither declares
          accessibility props nor spreads unrecognised ones onto its View, so
          cloning onto it drops the handler Link injects.
        */}
        <Link href={`/clubs/${row.clubId}/events/${row.eventId}`} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.title}`}
            style={styles.gameOpen}
          >
            <DateTile startsAt={row.startsAt} timezone={row.timezone} />
            <View style={styles.gameBody}>
              <Text style={styles.gameKicker}>{row.clubName}</Text>
              <Text style={styles.gameTitle}>{row.title}</Text>
              <Text style={styles.help}>
                {formatEventWhen(row.startsAt, row.timezone)}
                {' · '}
                {row.venueName}
              </Text>
            </View>
          </Pressable>
        </Link>
        {booking === null ? (
```

- [ ] **Step 5: Add the press target's style**

In `app/clubs/index.tsx`'s `StyleSheet.create`, add beside `gameBody`:

```tsx
  // Takes over `gameRow`'s row layout for the part of the row that is now
  // one press target, so the tile and the text still sit side by side and
  // the trailing control still gets whatever width it needs.
  gameOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
```

- [ ] **Step 6: Add the missing pre-assertion**

In `app/__tests__/clubs.test.tsx`'s `it('drops the need-a-fourth card once the same game has been joined', ...)`, insert between `render(<ClubsScreen />);` and the `fireEvent.click(...)`:

```tsx
    // The card has to be on screen before the join, or this test would pass
    // just as well against a screen that never rendered one — which is what
    // it asserted before.
    expect(await screen.findByRole('button', { name: /I'm in/ })).toBeTruthy();
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 9: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat: open the game from its dashboard row

The rows were inert, and opening the game is the one thing a member
wants from one they can see.

The press target covers the date tile and the title block only. A row
can also carry a Join button, a Seated tag, offer accept/decline,
leave-waitlist and a check-in control; a card-wide pressable would put
two competing targets on the same pixels.

The expo-router mock now renders Link as a real anchor carrying its
href. It rendered children and dropped href, which made every Link in
these screens untestable.

Also adds the pre-assertion the need-a-fourth join test never had: it
asserted the card was gone afterwards, which a screen that never drew
one would satisfy just as well.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The waitlist notice names the game (spec item 15)

**Files:**
- Modify: `app/clubs/index.tsx` — `waitlistNotice`, `takeSeat`, `joinGame`
- Test: `app/__tests__/clubs.test.tsx:388-447`, `:620-641`

**Interfaces:**
- Consumes: `formatEventWhen` from Task 3.
- Produces: `waitlistNotice(result: BookingOutcome | null, description: string): string | null`.

A seated take says `You're in — Fri 5 Sep, 7:00 pm — Club Night`. The waitlisted half of the same outcome says only `2nd on the waitlist`, naming nothing — and a member with several games on screen cannot tell which one it is about.

- [ ] **Step 1: Update the two tests that assert the bare notice**

Both of these render with `fetchMyUpcomingBookings` returning `[]`, so the string they find is the banner and nothing else — they must move with it.

In `it('reports the waitlist outcome, not "You\'re in", when the advertised seat has gone', ...)`, replace the two assertions at the end:

```tsx
    // The banner names the game, exactly as the seated half does. Matched by
    // prefix: the rest is the formatted date, which moves with the clock.
    expect(await screen.findByText(/^2nd on the waitlist — /)).toBeTruthy();
    expect(screen.queryByText(/You're in/)).toBeNull();
```

In `it('reports the waitlist outcome when a Join lands on the waitlist', ...)`, replace the final assertion:

```tsx
    expect(await screen.findByText(/^1st on the waitlist — .*Open game$/)).toBeTruthy();
```

- [ ] **Step 2: Sharpen the third test, whose match count changes**

In `it('clears the standing notice when the member leaves that waitlist', ...)`, the banner and the row's own seat status used to read identically. Replace the comment and assertion block after the `fireEvent.click(... Join Open game ...)` line:

```tsx
    // Two different strings now: the banner names the game, the row's own
    // seat status does not. Asserted separately — the previous
    // `findAllByText(...).length > 0` would have been satisfied by either
    // one alone, which is exactly the ambiguity naming the game removes.
    expect(await screen.findByText(/^1st on the waitlist — .*Open game$/)).toBeTruthy();
    expect(screen.getByText('1st on the waitlist')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Leave the waitlist for Open game'));

    await waitFor(() =>
      expect(screen.queryAllByText(/1st on the waitlist/)).toHaveLength(0),
    );
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: FAIL, 3 failures — the notices are still bare, so none of the `— <game>` patterns match.

- [ ] **Step 4: Give `waitlistNotice` the game**

In `app/clubs/index.tsx`, replace the `waitlistNotice` function and its docstring:

```tsx
/**
 * The waitlist half of a `commit_booking` outcome, worded as the event screen
 * words it (`waitlistLabel`) and naming the game it is about. A waitlisted
 * outcome can carry a null `waitlist_position` — the same "waiting, position
 * unknown" case the row's own seat status already words as "Waiting for a
 * seat".
 *
 * `description` is not optional. The seated notice has always named its game
 * ("You're in — Thu 4 Sep, 7:00 pm — Club Night") while this one said only
 * "2nd on the waitlist", which on a dashboard listing several games named
 * none of them. Requiring the argument is what stops the two halves drifting
 * apart again.
 */
function waitlistNotice(
  result: BookingOutcome | null,
  description: string,
): string | null {
  if (!result || result.outcome !== 'waitlisted') return null;
  const position =
    result.waitlist_position !== null
      ? waitlistLabel(result.waitlist_position)
      : 'Waiting for a seat';
  return `${position} — ${description}`;
}
```

- [ ] **Step 5: Update the two call sites**

In `takeSeat`, replace the `setNotice` line:

```tsx
    setNotice(waitlistNotice(result, alert.text) ?? `You're in — ${alert.text}.`);
```

In `joinGame`, replace the `setNotice` line with these two:

```tsx
    // Built the way the alert builds its own `text`, so both notices read
    // alike whichever button raised them.
    const description = `${formatEventWhen(row.startsAt, row.timezone)} — ${row.title}`;
    setNotice(waitlistNotice(result, description));
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 8: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "fix: name the game in the waitlist notice

A seated take said \"You're in — Thu 4 Sep, 7:00 pm — Club Night\". The
waitlisted half of the same outcome said only \"2nd on the waitlist\",
which on a dashboard listing several games named none of them.

waitlistNotice now takes the description as a required argument rather
than an optional one — that is what stops the two halves drifting apart
again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: One busy flag, and a mounted guard (spec items 16, 17)

**Files:**
- Modify: `app/clubs/index.tsx` — state, `reloadBookings`, `runBookingAction`, `setCheckInState`, `reloadAfterBooking`, `takeSeat`, `joinGame`, `GameRow`'s props, the `NeedAFourthCard` and `GameRow` call sites
- Test: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `GameRow` loses its `takeBusy` prop; `busy` alone gates every booking write.

`takeBusy` (take/join) and `actionBusy` (decline / accept-offer / decline-offer / leave-waitlist) are independent, so a member can start a decline while a join is still in flight and the two `reloadAfterBooking` calls race. `checkInBusy` stays separate by design: the check-in control is optimistic, single-person, and deliberately does not wait on the server.

- [ ] **Step 1: Write the failing test**

In `app/__tests__/clubs.test.tsx`, add inside `describe('dashboard artboard', ...)`:

```tsx
  // takeBusy gated take/join and actionBusy gated decline/offer/waitlist,
  // with nothing between them — so a member could start a decline while a
  // join was still in flight and have the two reloadAfterBooking calls race
  // to set `events` and `bookings`.
  it('locks the other booking actions while one is in flight', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    // A waitlisted booking on one game (a Leave the waitlist button) and a
    // separate open game (a Join button) — one of each family of action.
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...BOOKING,
        event_id: 'held',
        starts_at: soon,
        event_title: 'Held game',
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        waitlist_position: 2,
      },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        starts_at: soon,
        bookings: [
          { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
        ],
      },
    ]);
    // Never resolves while the assertion runs, so the first write stays in
    // flight for the whole test.
    let release: (value: { result: null; error: null }) => void = () => {};
    commitBooking.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Join Open game/ }));

    await waitFor(() =>
      expect(
        screen
          .getByLabelText('Leave the waitlist for Held game')
          .getAttribute('aria-disabled'),
      ).toBe('true'),
    );

    release({ result: null, error: null });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: FAIL — `expected null to be 'true'`. Leave the waitlist reads `actionBusy`, which the in-flight Join never set.

- [ ] **Step 3: Collapse the two flags into one**

In `app/clubs/index.tsx`, delete both state declarations:

```tsx
  const [actionBusy, setActionBusy] = useState(false);
  const [takeBusy, setTakeBusy] = useState(false);
```

and put one in their place, beside the other write-related state:

```tsx
  // One flag for every booking write — take, join, decline, accept-offer,
  // decline-offer, leave-waitlist. These used to be two independent flags
  // (`takeBusy` and `actionBusy`), so a decline could start while a join was
  // still in flight and the two reloadAfterBooking calls would race to set
  // `events` and `bookings`, with the loser's stale read winning.
  //
  // `checkInBusy` stays separate on purpose: the check-in control writes
  // optimistically, for one person, and deliberately does not wait on the
  // server — gating it on the same flag would make a two-state toggle feel
  // like a form submission.
  const [busy, setBusy] = useState(false);
```

Then replace every `setActionBusy(` and `setTakeBusy(` with `setBusy(` — there are six, two each in `runBookingAction`, `takeSeat` and `joinGame`.

- [ ] **Step 4: Refuse a second write while one is in flight**

Still in `app/clubs/index.tsx`, add a guard as the first statement of `runBookingAction`, `takeSeat` and `joinGame`. In `runBookingAction`:

```tsx
  async function runBookingAction(action: () => Promise<{ error: string | null }>) {
    // The buttons are all disabled while `busy`, but a queued tap, a screen
    // reader activation, or a native double-tap can still arrive between the
    // state change and the re-render.
    if (busy) return;
    setBusy(true);
```

In `takeSeat`:

```tsx
  async function takeSeat(alert: FourthAlert) {
    if (busy) return;
    setBusy(true);
```

In `joinGame`:

```tsx
  async function joinGame(row: DashboardRow) {
    if (busy) return;
    setBusy(true);
```

- [ ] **Step 5: Add the mounted guard**

In `app/clubs/index.tsx`, add `useRef` to the React import:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Add below the state declarations:

```tsx
  // Every write below awaits the network and then calls setState. Nothing
  // checked the screen was still mounted, so navigating away mid-write —
  // now a single tap, since the rows opened up — set state on an unmounted
  // component. Set to true on mount rather than relying on the initial
  // value: under StrictMode the effect runs, cleans up, and runs again, and
  // a ref initialised once would stay false through the second mount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
```

Guard `reloadBookings`:

```tsx
  async function reloadBookings() {
    const result = await fetchMyUpcomingBookings();
    if (!mounted.current) return;
    if (result === null) setBookingsFailed(true);
    else {
      setBookings(result);
      setBookingsFailed(false);
    }
  }
```

Guard `reloadAfterBooking`:

```tsx
  async function reloadAfterBooking() {
    const [, freshEvents] = await Promise.all([
      reloadBookings(),
      fetchEventsForClubs(clubs ?? []),
    ]);
    if (!mounted.current) return;
    setEvents(freshEvents);
  }
```

Guard `runBookingAction` after its await:

```tsx
    const { error } = await action();
    if (!mounted.current) return;
    setBusy(false);
```

Guard `setCheckInState` after its await — the line after the `clearAttendance`/`recordAttendance` call:

```tsx
    if (!mounted.current) return;
    setCheckInBusy(false);
```

Guard `takeSeat` and `joinGame` after their `commitBooking` awaits, in both cases immediately before `setBusy(false)`:

```tsx
    if (!mounted.current) return;
    setBusy(false);
```

- [ ] **Step 6: Rewire the two consumers**

In `app/clubs/index.tsx`, the `NeedAFourthCard` call site:

```tsx
          busy={busy}
```

The `GameRow` call site — delete the `takeBusy={takeBusy}` line and change the other:

```tsx
            busy={busy}
```

In `GameRow`'s destructured parameters, delete `takeBusy,`. In `GameRow`'s prop type, delete `takeBusy: boolean;`. In `GameRow`'s Join button, change `disabled={takeBusy}` to:

```tsx
            disabled={busy}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/clubs.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 9: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "fix: one busy flag for booking writes, and a mounted guard

takeBusy gated take/join and actionBusy gated decline, accept-offer,
decline-offer and leave-waitlist, with nothing between them — so a
decline could start while a join was still in flight and the two
reloadAfterBooking calls would race to set events and bookings, with the
loser's stale read winning. One flag now covers every booking write.

checkInBusy stays separate on purpose: that control writes
optimistically, for one person, and deliberately does not wait on the
server.

Every write awaits the network and then calls setState, with nothing
checking the screen was still mounted — now a live path, since the rows
have become tappable. A ref cleared on unmount guards each one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: The signed-out welcome screen (spec item 6)

**Files:**
- Create: `app/welcome.tsx`, `app/__tests__/welcome.test.tsx`, `app/__tests__/sign-in.test.tsx`
- Modify: `app/index.tsx:27-32` and its docstring, `app/__tests__/index.test.ts:31-33`, `app/sign-in.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `Screen`, `Tag`, `ChevronLeftIcon`, `useSession`, the theme.
- Produces: the `/welcome` route. `resolveIndexRedirect(loading, hasSession, pendingInvite)` returns `'/welcome'` rather than `'/sign-in'` for a signed-out visitor.

The invitation card ships honest explainer copy. The artboard's mock — "Sara Lindqvist invited you to Riverside Mah Jongg · 42 members" — is a fabricated invitation naming a person who does not exist, and it would be a control a member taps.

- [ ] **Step 1: Write the failing tests**

Create `app/__tests__/welcome.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: null,
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({ useSession: () => useSessionMock() }));

import Welcome from '../welcome';

describe('welcome screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({ session: null, loading: false });
  });

  it('leads with the headline and the promise under it', () => {
    render(<Welcome />);
    expect(screen.getByText("Your club's table, always set.")).toBeTruthy();
    expect(screen.getByText(/Find a game, keep your seat/)).toBeTruthy();
  });

  // The artboard's card names a person and a club that do not exist. This
  // one explains what an invite link does and names nobody.
  it('explains invite links without inventing an invitation', () => {
    render(<Welcome />);
    expect(screen.getByText('Invites')).toBeTruthy();
    expect(screen.getByText('Got an invite link?')).toBeTruthy();
    expect(screen.queryByText(/Sara Lindqvist/)).toBeNull();
    expect(screen.queryByText(/Riverside/)).toBeNull();
  });

  it('sends both buttons to sign in', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
    push.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: 'I already have an account' }),
    );
    expect(push).toHaveBeenCalledWith('/sign-in');
  });

  // Redirects to "/" rather than a fixed destination: app/index.tsx is the
  // one place that knows whether a club invite is parked in storage and the
  // member must be sent to /join/<token> instead of /clubs.
  it('gets out of the way once a session appears', () => {
    useSessionMock.mockReturnValue({
      session: { user: { id: 'test-user' } },
      loading: false,
    });
    render(<Welcome />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/');
  });

  it('waits rather than redirecting while auth is still resolving', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    render(<Welcome />);
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.getByText("Your club's table, always set.")).toBeTruthy();
  });
});
```

In `app/__tests__/index.test.ts`, replace the first test:

```ts
  // /welcome, not /sign-in: the welcome screen is the app's front door, and
  // sign-in is a step inside it.
  it('sends a signed-out member to the welcome screen', () => {
    expect(resolveIndexRedirect(false, false, null)).toBe('/welcome');
  });
```

Create `app/__tests__/sign-in.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: null, loading: false }),
}));

// Mocked whole rather than partially: lib/auth pulls in expo-auth-session,
// expo-web-browser and expo-linking, none of which resolve under Vitest, and
// none of which this test exercises.
vi.mock('../../lib/auth', () => ({
  availableProviders: () => ['google'],
  isValidEmail: (value: string) => value.includes('@'),
  sendMagicLink: vi.fn(async () => ({ error: null })),
  signInWithProvider: vi.fn(async () => ({ error: null })),
}));

import SignIn from '../sign-in';

describe('sign-in screen', () => {
  beforeEach(() => vi.clearAllMocks());

  // Sign-in is now a step inside the welcome screen rather than the app's
  // front door, so it needs a way back to it.
  it('offers a way back to the welcome screen', () => {
    render(<SignIn />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the welcome screen' }),
    );
    expect(push).toHaveBeenCalledWith('/welcome');
  });

  it('still offers the magic-link form', () => {
    render(<SignIn />);
    expect(screen.getByText('Sign in to MahjHero')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- app/__tests__/welcome.test.tsx app/__tests__/index.test.ts app/__tests__/sign-in.test.tsx
```

Expected: FAIL — `Failed to resolve import "../welcome"`, `expected '/sign-in' to be '/welcome'`, and no back button on sign-in.

- [ ] **Step 3: Write the welcome screen**

Create `app/welcome.tsx`:

```tsx
import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Button from '../components/Button';
import Card from '../components/Card';
import Screen from '../components/Screen';
import Tag from '../components/Tag';
import { useSession } from '../lib/session';
import { colors, radius, shadow, space, type } from '../lib/theme';

/**
 * The artboard's three-tile hero: circles, bamboo, and the red dragon on an
 * accent tile, fanned by a few degrees each way.
 *
 * Hidden from assistive tech: it is decoration, and the headline beneath it
 * says what the app is. The design draws each tile's lip with an inset
 * box-shadow, which React Native has no equivalent for — a bottom border is
 * visually the same thing at this size, the way DateTile already does it.
 */
function TileHero() {
  return (
    <View
      style={styles.hero}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.tile, styles.tileLeft]}>
        <Svg
          width={26}
          height={40}
          viewBox="0 0 26 40"
          fill="none"
          stroke={colors.accentColor}
          strokeWidth={2.75}
        >
          <Circle cx={13} cy={8} r={4.5} />
          <Circle cx={13} cy={20} r={4.5} />
          <Circle cx={13} cy={32} r={4.5} />
        </Svg>
      </View>
      <View style={styles.tile}>
        <Svg
          width={26}
          height={40}
          viewBox="0 0 26 40"
          fill="none"
          stroke={colors.accent2[600]}
          strokeWidth={2.75}
          strokeLinecap="round"
        >
          <Path d="M7 6v28M13 6v28M19 6v28" />
          <Path d="M4 14h6M10 14h6M16 14h6M4 26h6M10 26h6M16 26h6" />
        </Svg>
      </View>
      <View style={[styles.tile, styles.tileAccent, styles.tileRight]}>
        <Text style={styles.tileGlyph}>中</Text>
      </View>
    </View>
  );
}

/**
 * The app's front door, for a visitor with no session. `app/index.tsx` sends
 * signed-out visitors here rather than straight to `/sign-in`, which was a
 * form with no explanation of what it signs you in to.
 */
export default function Welcome() {
  const { session, loading } = useSession();
  const router = useRouter();

  // The same guard app/sign-in.tsx carries, for the same reason:
  // app/index.tsx has already unmounted by the time anyone is standing here,
  // so nothing else is watching for a session to appear.
  //
  // Redirects to "/" rather than a fixed destination: index is the one place
  // that knows whether a club invite is parked in storage (PENDING_INVITE_KEY)
  // and the member must be sent to `/join/<token>` instead of `/clubs`.
  // Hard-coding a destination here would either strand that invite or
  // duplicate index's decision.
  if (!loading && session) return <Redirect href="/" />;

  return (
    <Screen scroll contentStyle={styles.content}>
      <TileHero />

      <View>
        <Text style={styles.heading}>Your club&apos;s table, always set.</Text>
        <Text style={styles.body}>
          Find a game, keep your seat, and let the club know when you&apos;re in.
        </Text>
      </View>

      {/* The artboard fills this slot with a worked example — "Sara Lindqvist
          invited you to Riverside Mah Jongg · 42 members". Shipped literally
          that is a fabricated invitation, naming a person who does not
          exist, that a member would tap. This says the same useful thing
          about invite links and names nobody. */}
      <Card background={colors.accent2[100]} style={styles.inviteCard}>
        <Tag variant="accent2">Invites</Tag>
        <Text style={styles.inviteLead}>Got an invite link?</Text>
        <Text style={styles.inviteBody}>
          Open it on this device and you&apos;ll land straight in your club —
          no code to type.
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button
          block
          onPress={() => router.push('/sign-in')}
          accessibilityLabel="Get started"
        >
          Get started
        </Button>
        <Button
          variant="secondary"
          block
          onPress={() => router.push('/sign-in')}
          accessibilityLabel="I already have an account"
        >
          I already have an account
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space[6],
    gap: space[6],
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  tile: {
    width: 52,
    height: 70,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderBottomWidth: 5,
    borderBottomColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  tileLeft: {
    transform: [{ rotate: '-6deg' }],
  },
  tileRight: {
    transform: [{ rotate: '5deg' }],
  },
  tileAccent: {
    backgroundColor: colors.accentColor,
    borderBottomColor: colors.accent[700],
  },
  tileGlyph: {
    fontSize: 30,
    lineHeight: 34,
    color: colors.bg,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.display,
    lineHeight: 54,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    lineHeight: 28,
    color: colors.textMuted,
    marginTop: space[4],
  },
  inviteCard: {
    padding: space[4],
    gap: space[2],
    borderRadius: radius.card,
  },
  inviteLead: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  inviteBody: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    // accent2-800 on the card's accent2-100 ground. textMuted is measured
    // against bg and surface (lib/theme.test.ts), not against this one.
    color: colors.accent2[800],
  },
  actions: {
    gap: space[3],
  },
});
```

- [ ] **Step 4: Send signed-out visitors there**

In `app/index.tsx`, change the last line of `resolveIndexRedirect`:

```ts
  return '/welcome';
```

and in the same function's docstring, replace the opening sentence so it describes what it now does:

```ts
/**
 * Decides where a visit to "/" should land, given the three pieces of state
 * that matter: a signed-out visitor gets the welcome screen, a signed-in one
 * gets their clubs — or a parked club invite, if they have one. Extracted as
 * a pure function — rather than inlined in the component below — so the
 * branching, especially the async race between a session appearing and the
 * pending-invite storage read finishing, is directly testable without
 * rendering, mocking the router, or racing real timers. See
 * `app/__tests__/index.test.ts`.
```

- [ ] **Step 5: Give sign-in a way back**

In `app/sign-in.tsx`, change the expo-router import:

```tsx
import { Redirect, useRouter } from 'expo-router';
```

Add the icon to the existing icons import:

```tsx
import { ChevronLeftIcon, MailIcon } from '../components/icons';
```

Add the router beside the other hooks at the top of the component:

```tsx
  const router = useRouter();
```

Add the back button as the first child of the main render's `<Screen center contentStyle={styles.content}>`, above `<Text style={styles.heading}>Sign in to MahjHero</Text>`:

```tsx
      {/* Sign-in is a step inside the welcome screen now, not the app's
          front door, so it needs a way back to it. The artboard draws this
          same chevron. */}
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push('/welcome')}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the welcome screen"
        style={styles.backButton}
      >
        Back
      </Button>
```

Add the style to `StyleSheet.create`:

```tsx
  backButton: {
    alignSelf: 'flex-start',
  },
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- app/__tests__/welcome.test.tsx app/__tests__/index.test.ts app/__tests__/sign-in.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Confirm the route resolves**

```bash
npm test -- app/__tests__/redirect-routes.test.ts
```

Expected: PASS. That suite reads redirect targets out of `lib/` and asserts each resolves to a route file; `app/welcome.tsx` is what makes `/welcome` a real route.

- [ ] **Step 8: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no tsc output; all tests passing.

- [ ] **Step 9: See it in a browser**

Start the preview with the `mahjhero-web` configuration already in
`.claude/launch.json` (`preview_start` with `{name: "mahjhero-web"}`; never run a
dev server through Bash). Open the app signed out and confirm: the three tiles fan left/upright/right, the headline wraps to two or three lines without clipping, the invite card reads as an explainer, and both buttons reach sign-in — whose Back button returns here.

- [ ] **Step 10: Commit**

```bash
git add app/welcome.tsx app/index.tsx app/sign-in.tsx app/__tests__/welcome.test.tsx app/__tests__/sign-in.test.tsx app/__tests__/index.test.ts
git commit -m "feat: build the signed-out welcome screen

The artboard's front door was never built — a signed-out visitor went
straight to /sign-in, a form with no explanation of what it signs you in
to. Tile hero, headline, and both of the artboard's buttons, with
sign-in gaining the Back chevron that makes it a step inside this screen
rather than the entry point.

The invitation card ships an explainer rather than the artboard's worked
example. \"Sara Lindqvist invited you to Riverside Mah Jongg · 42
members\" shipped literally is a fabricated invitation naming a person
who does not exist, and it would be a control a member taps.

Welcome redirects to / rather than a fixed destination once a session
appears: app/index.tsx is the one place that knows whether a club invite
is parked in storage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Correct the artboard spec's tab-bar paragraph (spec item 19)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md:172-176`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Documentation only.

- [ ] **Step 1: Replace the paragraph**

In `docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md`, find:

```markdown
The artboard's four-tab bottom bar, on `colors.surface`, active tab in
`colors.accentColor`. Introduced as an expo-router layout so it persists
across the tabbed screens.
```

and replace it with:

```markdown
The artboard's four-tab bottom bar, on `colors.surface`, active tab in
`colors.accent[700]` — not the artboard's `accentColor`, which measures
2.69:1 on that ground and made the selected tab less legible than the
unselected ones.

It is a plain component (`components/TabBar.tsx`) that each tab screen renders
through `Screen`'s `tabBar` prop, **not** an expo-router layout. A `(tabs)`
route group would put `app/(tabs)/clubs/index.tsx` in the same URL namespace as
the existing `app/clubs/[id]/` tree and would move files that several test
files import by relative path. Migrating to expo-router's own `Tabs` is a
follow-up, not a prerequisite; see the component's own docstring.
```

- [ ] **Step 2: Verify no other paragraph makes the same claim**

```bash
grep -rn "expo-router layout" docs/
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md
git commit -m "docs: the tab bar is a component, not an expo-router layout

The dashboard artboard spec described a design that was considered and
rejected. TabBar is rendered by each screen through Screen's tabBar
prop; a (tabs) group would collide with the existing app/clubs/[id]/
tree. Also records the accent[700] contrast fix the same paragraph got
wrong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Whole-branch verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: all files passing. Task 1 adds 5 tests, Task 2 adds 1, Task 3 adds 3, Task 4 adds 1, Task 5 nets +3, Task 6 adds 2, Task 7 adds 2, Task 8 adds 4, Task 9 adds 5, Task 10 adds 4, Task 11 adds 2, Task 13 adds 1 — 800 tests across 51 files, up from 767 across 48.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Visual suite**

```bash
npm run test:visual
```

Expected: passing. If the snapshots move, read the diff before accepting: Task 1 darkens muted text on every screen, which is an intended change, while anything else moving is not.

- [ ] **Step 4: Walk the app**

Start the preview with the `mahjhero-web` configuration in `.claude/launch.json`
(`preview_start` with `{name: "mahjhero-web"}`).

Signed out: the welcome screen, then sign-in and back. Signed in: the dashboard's rows open their games, the club and venue screens carry the header and bar, profile has no back link and a full-width Sign out.

- [ ] **Step 5: Confirm the branch state**

```bash
git status --short && git log --oneline main..HEAD
```

Expected: a clean tree, and the task commits above sitting on `feat/dashboard-artboard`.
