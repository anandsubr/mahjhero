# One club list on the clubs dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop listing a member's clubs twice on `/clubs` — fold the bottom `Your clubs` cards into the existing chip row, and move "open this club" onto the dashboard header.

**Architecture:** Four small changes, each behind its own test cycle. `headerScope` (a pure function) learns that a one-club member's scope is their one club. `DashboardHeader` gains an optional press target on the scope block. `ClubChips` gains an optional trailing action chip that is visibly not a filter. The screen then deletes its `Your clubs` section and wires the two new props. A fifth task re-baselines the visual snapshots.

**Spec:** [docs/superpowers/specs/2026-09-01-clubs-single-list-design.md](../specs/2026-09-01-clubs-single-list-design.md)

**Tech Stack:** Expo Router + React Native Web, TypeScript, Vitest + @testing-library/react for unit tests, Playwright for visual snapshots.

## Global Constraints

- **No `@testing-library/jest-dom`.** This repo does not depend on it, and `vitest.setup.ts` keeps `globals: false` deliberately so no matcher package can auto-extend `expect`. Assert with plain `getAttribute(...)` and `toBe(...)`, never `toHaveAttribute`.
- **`accessibilityLabel` on a `Pressable` REPLACES the accessible name computed from its children** under react-native-web — it does not merge. Anything assistive tech must hear has to be composed into that one string.
- **Unit tests:** `npm test` (runs `TZ=America/New_York vitest run`). Target one file with `npx vitest run <path>`.
- **Visual tests:** `npm run test:visual`. Re-baseline with `npx playwright test --update-snapshots`.
- **Spacing and colour come from `lib/theme.ts`.** Use `space[n]` / `colors.*`; a raw number is acceptable only with a comment saying why it is not a token (see `SCROLL_GUTTER` in `components/ClubChips.tsx` for the house style).
- **Comment style:** this codebase's comments explain *why*, and are revised rather than deleted when their premise changes. Several steps below hand you exact replacement comment text — use it verbatim.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `lib/dashboard.ts` | `headerScope` resolves a one-club list to that club. No other change. |
| `components/DashboardHeader.tsx` | Optional `onPressScope` makes the scope block a button and draws a chevron. |
| `components/ClubChips.tsx` | Optional trailing `action` chip, styled as an action rather than a filter. |
| `app/clubs/index.tsx` | Renders one club list (the row), an early-return empty state, and passes the two new props. `Your clubs` section deleted. |
| `lib/dashboard.test.ts`, `components/__tests__/dashboard-parts.test.tsx`, `app/__tests__/clubs.test.tsx`, `e2e/visual.spec.ts` | Tests for the above. |

---

### Task 1: `headerScope` resolves a lone club

**Files:**
- Modify: `lib/dashboard.ts:39-52`
- Test: `lib/dashboard.test.ts:96-121`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `headerScope(clubs: Club[], selected: string): HeaderScope` — unchanged signature, changed behaviour. When `clubs.length === 1`, the result is always that club's scope (`kicker: 'Your club'`, `name: club.name`, `meta: club.rhythm`), whatever `selected` is. Task 4 relies on this.

- [ ] **Step 1: Replace the lone-club test with the new expectation**

In `lib/dashboard.test.ts`, inside `describe('headerScope', …)`, delete this test:

```ts
  it('singularises a lone club', () => {
    expect(headerScope([CLUBS[0]], ALL_CLUBS).meta).toBe('1 club');
  });
```

and put these two in its place:

```ts
  // A one-club member never picks a chip — the row that would set `selected`
  // is not drawn for them — so their scope would otherwise read "All your
  // clubs · 1 club" forever, and the header would have no club to open.
  it('resolves a lone club to that club whatever the selection', () => {
    expect(headerScope([CLUBS[0]], ALL_CLUBS)).toEqual({
      kicker: 'Your club',
      name: 'Riverside Mah Jongg',
      meta: 'Thursdays, 7pm',
    });
  });

  it('still counts an empty list rather than resolving to nothing', () => {
    expect(headerScope([], ALL_CLUBS)).toEqual({
      kicker: 'Your clubs',
      name: 'All your clubs',
      meta: '0 clubs',
    });
  });
```

Also change the unknown-id test, which now has a one-club answer worth stating:

```ts
  it('falls back to the all-clubs scope for an unknown id', () => {
    expect(headerScope(CLUBS, 'club-gone').name).toBe('All your clubs');
    // …unless there is only one club it could have meant.
    expect(headerScope([CLUBS[0]], 'club-gone').name).toBe('Riverside Mah Jongg');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/dashboard.test.ts -t headerScope
```

Expected: FAIL — `resolves a lone club to that club` reports `name: 'All your clubs'` where `'Riverside Mah Jongg'` was expected.

- [ ] **Step 3: Make `headerScope` resolve the lone club**

In `lib/dashboard.ts`, replace the body of `headerScope` (leave the existing doc comment above it in place, then extend it as Step 4 says):

```ts
export function headerScope(clubs: Club[], selected: string): HeaderScope {
  const picked =
    selected === ALL_CLUBS
      ? null
      : (clubs.find((candidate) => candidate.id === selected) ?? null);
  // A one-club member's scope is never ambiguous, and their `selected` never
  // moves off ALL_CLUBS — the chip row that would change it is not drawn
  // below two clubs. Resolving the lone club here is what lets the header
  // name it and be pressed into it. Same derivation, for the same reason, as
  // the screen's own `scopeClubId`.
  const club = picked ?? (clubs.length === 1 ? clubs[0] : null);
  if (!club) {
    return {
      kicker: 'Your clubs',
      name: 'All your clubs',
      // Always plural: this branch is reached only by an empty list ("0
      // clubs") or by two or more. The singular that used to live here
      // could no longer fire — a one-club list resolves above.
      meta: `${clubs.length} clubs`,
    };
  }
  return { kicker: 'Your club', name: club.name, meta: club.rhythm };
}
```

- [ ] **Step 4: Extend the doc comment above `headerScope`**

Append this paragraph to the existing comment block, after the sentence about an unknown id resolving to the all-clubs scope:

```ts
 * One club is the exception to both fallbacks. There is nothing to disambiguate
 * and no chip row to pick with, so a single-club list resolves to that club
 * whatever `selected` says.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run lib/dashboard.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts
git commit -m "feat(dashboard): resolve a lone club to that club's scope"
```

---

### Task 2: `DashboardHeader` can be pressed into the club

**Files:**
- Modify: `components/DashboardHeader.tsx`
- Test: `components/__tests__/dashboard-parts.test.tsx` (the `describe('DashboardHeader', …)` block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DashboardHeader` accepts an optional `onPressScope?: () => void`. When supplied, the scope block renders as a `Pressable` with `accessibilityRole="button"` and `accessibilityLabel={`Open ${name}`}`, and a `ChevronRightIcon` is drawn beside the kicker. When omitted, the rendered output is unchanged from today. Task 4 passes this prop.

- [ ] **Step 1: Write the failing tests**

Add these three tests inside `describe('DashboardHeader', …)` in `components/__tests__/dashboard-parts.test.tsx`:

```ts
  it('leaves the scope inert when there is nothing to open', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="All your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    // The avatar is still a button; the scope is not.
    expect(screen.getByRole('button', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.queryByTestId('scope-chevron')).toBeNull();
  });

  it('opens the club in scope when the scope is pressed', () => {
    const onPressScope = vi.fn();
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={onPressScope}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Riverside Mah Jongg' }),
    );
    expect(onPressScope).toHaveBeenCalled();
    expect(screen.getByTestId('scope-chevron')).toBeTruthy();
  });

  // The scope text has to stay reachable by content, not only by label:
  // the screen's own tests read the club name and rhythm straight off the
  // header now that the club cards below are gone.
  it('still shows the scope text when it is pressable', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={() => {}}
      />,
    );
    expect(screen.getByText('Your club')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursdays, 7pm')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx -t DashboardHeader
```

Expected: FAIL — `opens the club in scope when the scope is pressed` cannot find a button named `Open Riverside Mah Jongg`.

- [ ] **Step 3: Rewrite the component's doc comment**

In `components/DashboardHeader.tsx`, replace the whole existing doc comment above `export default function DashboardHeader` with:

```tsx
/**
 * The artboard's dashboard header: scope on the left, the member on the
 * right.
 *
 * The artboard draws a chevron beside the kicker, tapping through to a
 * separate "Your clubs" screen. This screen used to keep that list on itself,
 * so the chevron had nowhere to go and was not drawn — an affordance that
 * does nothing is worse than none. The club list is now the chip row alone,
 * and the way into a club is this header, so the chevron has a destination
 * again: `onPressScope` opens the club currently in scope.
 *
 * It points right, not the artboard's up/down. Up/down promises a picker that
 * expands in place; this navigates away, and the chips do the picking.
 *
 * The prop is optional because the scope is not always a club — in the
 * all-clubs scope there is nothing single to open — and because the club
 * detail screen renders this same header with no destination beyond itself.
 */
```

- [ ] **Step 4: Add the prop, the press target and the chevron**

Replace the imports line and the component body in `components/DashboardHeader.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRightIcon, PersonIcon } from './icons';
import { colors, radius, space, type } from '../lib/theme';
```

```tsx
export default function DashboardHeader({
  kicker,
  name,
  meta,
  initials,
  onPressAvatar,
  onPressScope,
}: {
  kicker: string;
  name: string;
  meta: string;
  initials: string;
  onPressAvatar: () => void;
  onPressScope?: () => void;
}) {
  const scope = (
    <>
      <View style={styles.kickerRow}>
        <Text style={styles.kicker}>{kicker}</Text>
        {onPressScope ? (
          <View testID="scope-chevron">
            <ChevronRightIcon size={14} color={colors.accentColor} />
          </View>
        ) : null}
      </View>
      <Text style={styles.name}>{name}</Text>
      {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
    </>
  );

  return (
    <View style={styles.row}>
      {onPressScope ? (
        <Pressable
          onPress={onPressScope}
          accessibilityRole="button"
          // The name, not the kicker: "Open Riverside Mah Jongg" says where
          // this goes, where "Open Your club" says nothing. See this file's
          // header comment for why the label has to carry it — aria-label
          // replaces the name computed from the children below, so a screen
          // reader never hears the club name from the <Text> itself.
          accessibilityLabel={`Open ${name}`}
          style={styles.scope}
        >
          {scope}
        </Pressable>
      ) : (
        <View style={styles.scope}>{scope}</View>
      )}
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        style={styles.avatar}
      >
        {initials.length > 0 ? (
          <Text style={styles.initials}>{initials}</Text>
        ) : (
          <View testID="avatar-fallback">
            <PersonIcon size={26} color={colors.bg} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Add the kicker row style**

In the same file's `StyleSheet.create({…})`, add this entry directly above the existing `kicker` entry:

```tsx
  // The kicker and its chevron sit on one line. A plain <Text> cannot hold
  // the icon without the icon inheriting text layout, so the row is a View
  // and the kicker keeps its own type styles.
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS, whole file — including the three pre-existing `DashboardHeader` tests, which pass no `onPressScope` and must be unaffected.

- [ ] **Step 7: Commit**

```bash
git add components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(dashboard): let the header open the club in scope"
```

---

### Task 3: `ClubChips` carries a trailing action

**Files:**
- Modify: `components/ClubChips.tsx`
- Test: `components/__tests__/dashboard-parts.test.tsx` (the `describe('ClubChips', …)` block)

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `ClubChips` accepts an optional
  `action?: { label: string; accessibilityLabel: string; onPress: () => void }`.
  It renders after every filter chip, outlined rather than filled, with no
  leading dot, no unread badge, and **no `aria-selected`**. Task 4 passes
  `{ label: '+ New club', accessibilityLabel: 'Start another club', onPress }`.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside `describe('ClubChips', …)` in `components/__tests__/dashboard-parts.test.tsx`:

```ts
  it('draws no action chip unless one is given', () => {
    render(<ClubChips chips={CHIPS} selected={ALL_CLUBS} onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Start another club' })).toBeNull();
  });

  // The action shares a row with filters and must not read as one: no
  // aria-selected, so assistive tech never offers it as a state to toggle.
  it('reports the action press without claiming a selection', () => {
    const onPress = vi.fn();
    render(
      <ClubChips
        chips={CHIPS}
        selected="club-1"
        onSelect={() => {}}
        action={{
          label: '+ New club',
          accessibilityLabel: 'Start another club',
          onPress,
        }}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Start another club' });
    expect(chip.getAttribute('aria-selected')).toBeNull();
    fireEvent.click(chip);
    expect(onPress).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx -t ClubChips
```

Expected: FAIL — `reports the action press without claiming a selection` cannot find a button named `Start another club`.

- [ ] **Step 3: Add the prop and render the action chip**

In `components/ClubChips.tsx`, extend the props and add the chip after the `chips.map(…)` block, inside the same `ScrollView`:

```tsx
export default function ClubChips({
  chips,
  selected,
  onSelect,
  unreadByClub,
  action,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
  unreadByClub?: Record<string, number>;
  // Two label fields, deliberately. The row shows "+ New club" and a screen
  // reader must not hear "plus" — and "Start another club" is the copy this
  // action already had as a button, so keeping it as the accessible name
  // means the label did not silently change under anyone who had learned it.
  action?: { label: string; accessibilityLabel: string; onPress: () => void };
}) {
```

Then, immediately after the closing `})}` of the `chips.map(…)` expression and before `</ScrollView>`:

```tsx
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          // No aria-selected: this is not one of the filters, and reporting
          // a selection state for it would tell assistive tech otherwise.
          style={[styles.chip, styles.action]}
        >
          <Text style={styles.label}>{action.label}</Text>
        </Pressable>
      ) : null}
```

- [ ] **Step 4: Style it as an action, not a filter**

Add this entry to the same file's `StyleSheet.create({…})`, directly after the `chip` entry:

```tsx
  // Outlined where a filter is filled, so the one control in this row that
  // leaves the page does not look like one more thing to filter by.
  // textMuted rather than the divider hairline: this is a control boundary,
  // and #676158 on the page background measures 5.15:1 (lib/theme.ts records
  // the ratio), comfortably past the 3:1 a boundary needs.
  action: {
    backgroundColor: 'transparent',
    borderColor: colors.textMuted,
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS, whole file — the three pre-existing `ClubChips` tests pass no `action` and must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(dashboard): give the chip row a trailing new-club action"
```

---

### Task 4: One club list on the screen

**Files:**
- Modify: `app/clubs/index.tsx` (the main `return`, roughly lines 412–565, plus the `styles` block)
- Test: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `headerScope` from Task 1, `DashboardHeader`'s `onPressScope` from Task 2, `ClubChips`' `action` from Task 3.
- Produces: no exports; this is the screen.

- [ ] **Step 1: Write the failing tests**

In `app/__tests__/clubs.test.tsx`, add these four tests to the end of the `describe('dashboard artboard', …)` block:

```ts
  it('opens the club from the header when one club is in scope', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Riverside Mah Jongg' }),
    );
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });

  // "All clubs" is not a club. Offering a way in from the header there would
  // have to guess which one the member meant.
  it('offers no way in while every club is in scope', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('All your clubs')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open Riverside/ })).toBeNull();
  });

  it('opens the club the chips picked', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harbour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Harbour' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-2');
  });

  // The row is drawn for a one-club member even though it holds no filters,
  // because this action is the reason it is drawn at all.
  it('keeps a way to start another club at one club', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start another club' }),
    );
    expect(push).toHaveBeenCalledWith('/clubs/new');
  });
```

Then fix the two existing tests this task changes. In `describe('clubs list', …)`, replace `it('lists the clubs a member belongs to', …)` with:

```ts
  // The club and its rhythm are read off the header now: with one club there
  // is no chip row of filters and no card list, and the header is the club.
  it('names the one club a member belongs to', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
    expect(screen.getByText('Your club')).toBeTruthy();
  });
```

And in `describe('dashboard artboard', …)`, in `it('narrows the games list to the picked club', …)`, replace these three lines:

```ts
    // Two buttons answer to "Harbour": the club chip up top and the club's
    // own card down in "Your clubs". The chip is the first in document
    // order — `getByRole` would refuse the ambiguity rather than pick.
    fireEvent.click(screen.getAllByRole('button', { name: 'Harbour' })[0]);
```

with:

```ts
    // One "Harbour" button now: the chip. The club's own card in "Your
    // clubs" is gone — the chip row is the whole club list.
    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run app/__tests__/clubs.test.tsx
```

Expected: FAIL — `opens the club from the header when one club is in scope` cannot find a button named `Open Riverside Mah Jongg`, and `opens the club the chips picked` finds two `Harbour` buttons.

- [ ] **Step 3: Give the zero-club state its own return**

In `app/clubs/index.tsx`, directly after `const list = clubs ?? [];` and before `const chips = buildChips(list);`, insert:

```tsx
  // A member in no clubs has no clubs to filter, no games to list, and one
  // thing to do. Returning early says that, instead of walking them past an
  // empty "Your games" to reach it.
  if (list.length === 0) {
    const empty = headerScope(list, ALL_CLUBS);
    return (
      <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <DashboardHeader
          kicker={empty.kicker}
          name={empty.name}
          meta={empty.meta}
          initials={initials}
          onPressAvatar={() => router.push('/profile')}
        />
        <View style={styles.list}>
          <Text style={styles.help}>
            You are not in a club yet. Start one and invite the people you
            already play with.
          </Text>
          <Button
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start a club"
          >
            Start a club
          </Button>
        </View>
      </Screen>
    );
  }
```

- [ ] **Step 4: Build the chips only when there is something to filter**

Replace this line:

```tsx
  const chips = buildChips(list);
```

with:

```tsx
  // Empty below two clubs: a lone "All clubs" pill beside a lone club pill
  // filters nothing. The row itself is still drawn — the "+ New club" action
  // lives in it — see the ClubChips call below.
  const chips = list.length > 1 ? buildChips(list) : [];
```

- [ ] **Step 5: Rename `hostClubId` to `scopeClubId` and reuse it**

Replace the `hostClubId` declaration and its comment with:

```tsx
  // The club in scope — what "Host a table" creates in, and what the header
  // opens. Derived from the clubs themselves, NOT from the chip state: the
  // chip row carries no filters below two clubs, so a one-club member's
  // `selected` stays ALL_CLUBS forever, and gating on `selected !== ALL_CLUBS`
  // would hide both affordances from exactly the member most likely to want
  // them. With several clubs and no chip picked the scope genuinely is
  // ambiguous, so neither is offered rather than one that guesses.
  // `headerScope` resolves the lone club the same way, for the same reason.
  const scopeClubId =
    selected !== ALL_CLUBS ? selected : list.length === 1 ? list[0].id : null;
```

Then update the one existing use, in the empty-games card:

```tsx
          {scopeClubId ? (
            <Button
              variant="secondary"
              big={false}
              onPress={() => router.push(`/clubs/${scopeClubId}/events/new`)}
              accessibilityLabel="Host a table"
            >
              Host a table
            </Button>
          ) : null}
```

- [ ] **Step 6: Wire the header and the chip row**

Replace the `<DashboardHeader … />` call with:

```tsx
      <DashboardHeader
        kicker={scope.kicker}
        name={scope.name}
        meta={scope.meta}
        initials={initials}
        onPressAvatar={() => router.push('/profile')}
        onPressScope={
          scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
        }
      />
```

Replace the `{list.length > 1 ? <ClubChips … /> : null}` block with:

```tsx
      <ClubChips
        chips={chips}
        selected={selected}
        unreadByClub={unreadByClub}
        action={{
          label: '+ New club',
          accessibilityLabel: 'Start another club',
          onPress: () => router.push('/clubs/new'),
        }}
        // A confirmation raised for a game at one club is not an answer to
        // "show me a different club" — the notice would otherwise sit above
        // content it has nothing to do with.
        onSelect={(id) => {
          setSelected(id);
          setNotice(null);
        }}
      />
```

No `list.length` guard: this branch only runs with at least one club, and `chips` is already empty below two.

- [ ] **Step 7: Delete the `Your clubs` section**

Delete the block that begins with this line:

```tsx
      <Text style={styles.sectionTitle}>Your clubs</Text>
```

and ends with the closing `)}` of the `list.length === 0 ? … : …` ternary immediately below it — the last lines of which are:

```tsx
          <Button
            variant="secondary"
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start another club"
          >
            Start another club
          </Button>
        </View>
      )}
```

That removes the heading, the empty state (now in Step 3's early return), the `Link`-wrapped club cards, and the `Start another club` button. The main `return` now ends with the `Your games` block and its closing `</Screen>`.

- [ ] **Step 8: Drop the styles nothing uses**

`clubName` is now unreferenced — delete it. Check `heading` too: it is still used by the `loadFailed` branch, so it stays. Replace the `list` style's comment, whose reasoning no longer describes a club list:

```tsx
  // The empty state's own gap: what puts space between the "not in a club
  // yet" help text and the "Start a club" button below it, instead of them
  // rendering as adjacent siblings with nothing between them. The skeleton
  // stack uses it too. It was the club list's gap before that list folded
  // into the chip row — see the "no space between the last club and the
  // button" item in todo.md for what it originally fixed.
  list: {
    gap: space[3],
  },
```

Confirm nothing else broke:

```bash
npx tsc --noEmit
```

Expected: no errors. An "is declared but its value is never read" error here means a style or import (`Link`, `Card`) is now unused — delete it.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx vitest run app/__tests__/clubs.test.tsx
```

Expected: PASS, whole file.

- [ ] **Step 10: Run the whole unit suite**

```bash
npm test
```

Expected: PASS. Nothing outside these files should be touched; a failure elsewhere means a shared component changed behaviour it should not have.

- [ ] **Step 11: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(clubs): list your clubs once, in the chip row"
```

---

### Task 5: Re-baseline the visual snapshots

**Files:**
- Modify: `e2e/visual.spec.ts` (the `clubs at ${vp.name}` test around line 229, and `clubs list with a club at ${vp.name}` around line 296)
- Modify: `e2e/visual.spec.ts-snapshots/clubs-{mobile,desktop}-darwin.png`, `clubs-populated-{mobile,desktop}-darwin.png`

**Interfaces:**
- Consumes: the finished screen from Task 4.
- Produces: nothing later tasks use.

- [ ] **Step 1: Drop the `.first()` workaround from the empty-state test**

In `e2e/visual.spec.ts`, in `test(\`clubs at ${vp.name}\`, …)`, replace the comment and the assertion:

```ts
      // `.first()` — "Your clubs" now renders TWICE on this screen: once as
      // DashboardHeader's kicker (headerScope's all-clubs scope, lib/dashboard.ts)
      // and once as the club-list section title. Both are real, and Playwright's
      // strict mode turns the bare locator into a hard failure rather than a
      // stale baseline. The unit suite had to switch to `findAllByText` for
      // exactly this reason; this line only needs to know the screen painted.
      await expect(page.getByText('Your clubs').first()).toBeVisible();
```

with:

```ts
      // No `.first()` any more: "Your clubs" renders once, as DashboardHeader's
      // kicker in the all-clubs scope. The club-list section title that used to
      // collide with it is gone — the chip row is the whole club list now.
      await expect(page.getByText('Your clubs')).toBeVisible();
```

- [ ] **Step 2: Anchor the populated test on the chip, not the button**

In `test(\`clubs list with a club at ${vp.name}\`, …)`, the `Start another club` assertion still holds — that is the action chip's accessible name — but add the visible label beside it so a silent revert to a bottom button would be caught. Replace:

```ts
        await expect(
          page.getByRole('button', { name: 'Start another club' }),
        ).toBeVisible();
```

with:

```ts
        // Same accessible name the bottom button had, now on the chip row's
        // trailing action — the name was kept precisely so it did not change
        // under anyone who had learned it. The visible label is asserted too,
        // since that is the half that actually moved.
        await expect(
          page.getByRole('button', { name: 'Start another club' }),
        ).toBeVisible();
        await expect(page.getByText('+ New club')).toBeVisible();
```

- [ ] **Step 3: Confirm the snapshots fail before updating them**

```bash
npx playwright test -g "clubs"
```

Expected: FAIL on `clubs at` and `clubs list with a club at` with screenshot comparison diffs. This step exists so the re-baseline is a deliberate act — if these tests *pass*, the screen did not change and something in Task 4 did not land.

- [ ] **Step 4: Re-baseline and review the diff by eye**

```bash
npx playwright test -g "clubs" --update-snapshots
```

Then open the four regenerated PNGs and confirm: one club list, at the top; no `Your clubs` heading or cards below the games; a chevron beside the header kicker only when a single club is in scope; the `+ New club` pill trailing the row.

```bash
git diff --stat e2e/visual.spec.ts-snapshots/
```

Expected: four files changed — `clubs-mobile-darwin.png`, `clubs-desktop-darwin.png`, `clubs-populated-mobile-darwin.png`, `clubs-populated-desktop-darwin.png`. Any other snapshot in the diff is a regression on a screen this plan does not touch: stop and find out why before committing.

- [ ] **Step 5: Run the whole visual suite**

```bash
npm run test:visual
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/visual.spec.ts e2e/visual.spec.ts-snapshots/
git commit -m "test(visual): re-baseline the clubs screen for one club list"
```

---

## Done when

- `npm test` passes.
- `npm run test:visual` passes.
- `npx tsc --noEmit` is clean.
- `/clubs` shows a member's clubs exactly once, in the chip row, and the header opens the club in scope.
