# The clubs header carries the actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both club actions — start a club, manage a club — out of the horizontally scrolling chip row and into the dashboard header, which does not scroll.

**Architecture:** Five tasks in an order that keeps `npm test` green at every commit. `DashboardHeader` gains the two controls first (a pencil in place of the chevron, a ⊕ beside the avatar); `headerScope` then shortens the all-clubs title and drops its now-duplicate kicker; the screen wires the ⊕ up and stops passing the chip row an action, and `ClubChips` loses that prop entirely; the visual baselines regenerate last.

**Spec:** [docs/superpowers/specs/2026-09-01-clubs-header-actions-design.md](../specs/2026-09-01-clubs-header-actions-design.md)

**Tech Stack:** Expo Router + React Native Web, TypeScript, `react-native-svg` for icons, Vitest + @testing-library/react, Playwright for visual snapshots.

## Global Constraints

- **No `@testing-library/jest-dom`.** This repo does not depend on it, and `vitest.setup.ts` keeps `globals: false` deliberately so no matcher package can auto-extend `expect`. Assert with plain `getAttribute(...)` and `toBe(...)`, never `toHaveAttribute`.
- **`accessibilityLabel` on a `Pressable` REPLACES the accessible name computed from its children** under react-native-web — it does not merge. Anything assistive tech must hear has to be composed into that one string. This is why the scope block's label carries both the club name and its rhythm.
- **`npm test` must be green at the end of every task.** Several tasks change a shared accessible name, which breaks assertions in files the task does not otherwise touch — each task below names those files and fixes them. This ordering is deliberate: the previous plan on this screen left three commits red and had to be squash-merged.
- **Playwright is deliberately stale until Task 5.** Do not run `npm run test:visual` or touch a snapshot PNG before then.
- **Unit tests:** `npm test` (runs `TZ=America/New_York vitest run`). Target one file with `npx vitest run <path>`.
- **Spacing and colour come from `lib/theme.ts`.** Use `space[n]` / `colors.*` / `radius.*`; a raw number is acceptable only with a comment saying why it is not a token.
- **Icons live in `components/icons.tsx`**, all with the signature `({ size = N, color = colors.X }: { size?: number; color?: string })`, all rendering an `Svg` with `viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round"`, each with a one-line doc comment saying where it is used.
- **Comment style:** comments explain *why*, and are revised rather than deleted when their premise changes. Two tasks below revise comments whose premise this plan changes; use the replacement text given.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `components/icons.tsx` | Gains `PencilIcon` and `PlusIcon`. |
| `components/DashboardHeader.tsx` | Kicker guarded on length; scope block draws a pencil and is labelled `Manage …`; optional `onPressNew` draws a ⊕ beside the avatar. |
| `components/ClubChips.tsx` | Filters only. The `action` prop and its styling are gone. |
| `lib/dashboard.ts` | `headerScope`'s all-clubs branch returns `kicker: ''`, `name: 'Your clubs'`. |
| `app/clubs/index.tsx` | Passes `onPressNew` on the populated render; passes `ClubChips` no action. |
| `lib/dashboard.test.ts`, `components/__tests__/dashboard-parts.test.tsx`, `app/__tests__/clubs.test.tsx`, `app/__tests__/your-games.test.tsx`, `e2e/visual.spec.ts` | Tests for the above. |

---

### Task 1: The scope block becomes a manage control

**Files:**
- Modify: `components/icons.tsx` (add `PencilIcon`)
- Modify: `components/DashboardHeader.tsx`
- Test: `components/__tests__/dashboard-parts.test.tsx`
- Also fix (shared accessible name changes): `app/__tests__/clubs.test.tsx:935`, `app/__tests__/clubs.test.tsx:953`, `app/__tests__/your-games.test.tsx:357`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DashboardHeader` renders no kicker when `kicker` is `''`. When `onPressScope` is supplied the scope block is a button whose accessible name is `Manage ${name}, ${meta}` (or `Manage ${name}` when `meta` is empty), and it draws a `PencilIcon` inside `<View testID="scope-glyph">` (renamed from `scope-chevron`, which no longer describes what it wraps). Tasks 3 and 4 rely on the empty-kicker guard.

- [ ] **Step 1: Write the failing tests**

In `components/__tests__/dashboard-parts.test.tsx`, inside `describe('DashboardHeader', …)`, add:

```ts
  // headerScope's all-clubs scope shortens its name to "Your clubs", which
  // makes a "YOUR CLUBS" kicker above it the same words twice — so that
  // scope passes no kicker at all. An empty string must draw nothing rather
  // than an empty line, the same way `meta` already does.
  it('draws no kicker when it is given none', () => {
    render(
      <DashboardHeader
        kicker=""
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.queryByTestId('scope-kicker')).toBeNull();
  });

  it('still draws a kicker when it is given one', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByTestId('scope-kicker')).toBeTruthy();
  });
```

Then change the three existing assertions that name the scope button. Replace `'Open Riverside Mah Jongg, Thursdays, 7pm'` with `'Manage Riverside Mah Jongg, Thursdays, 7pm'` at both `dashboard-parts.test.tsx:217` and `:241`, and replace `'Open Riverside Mah Jongg'` with `'Manage Riverside Mah Jongg'` at `:257`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx -t DashboardHeader
```

Expected: FAIL — `draws no kicker when it is given none` finds a `scope-kicker` testID that does not exist yet, and the three renamed assertions cannot find a button named `Manage …`.

- [ ] **Step 3: Add `PencilIcon`**

In `components/icons.tsx`, add this directly after `ChevronRightIcon`:

```tsx
/** Pencil for the clubs dashboard header (components/DashboardHeader.tsx),
 *  where pressing the club in scope opens that club's roster, invites,
 *  venues and import — management, not a form. */
export function PencilIcon({ size = 16, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}
```

- [ ] **Step 4: Swap the chevron for the pencil and relabel**

In `components/DashboardHeader.tsx`, change the icons import:

```tsx
import { PencilIcon, PersonIcon } from './icons';
```

Guard the kicker and swap the glyph — replace the `scope` fragment's `kickerRow` block with:

```tsx
      <View style={styles.kickerRow}>
        {kicker.length > 0 ? (
          <Text testID="scope-kicker" style={styles.kicker}>
            {kicker}
          </Text>
        ) : null}
        {onPressScope ? (
          <View testID="scope-glyph">
            <PencilIcon size={14} color={colors.accentColor} />
          </View>
        ) : null}
      </View>
```

Then change the label on the `Pressable` from `Open` to `Manage`:

```tsx
          accessibilityLabel={
            meta.length > 0 ? `Manage ${name}, ${meta}` : `Manage ${name}`
          }
```

- [ ] **Step 5: Revise the two comments whose premise changed**

The component's doc comment currently argues for a right-pointing chevron. Replace its second and third paragraphs (from "The artboard draws a chevron…" through "…the chips do the picking.") with:

```tsx
 * The artboard draws a chevron beside the kicker, tapping through to a
 * separate "Your clubs" screen. This screen used to keep that list on itself,
 * so the chevron had nowhere to go and was not drawn — an affordance that
 * does nothing is worse than none. The club list is now the chip row alone,
 * and the way into a club is this header, so the glyph has a destination
 * again: `onPressScope` opens the club currently in scope.
 *
 * It is a pencil, not the artboard's chevron. The destination is the club's
 * roster, invites, venues and import — management — and a chevron says only
 * "somewhere else". "Manage", not "Edit", for the same reason: there is no
 * single form behind it.
```

In the `accessibilityLabel` comment just below, replace the opening sentence — `The name, not the kicker: "Open Riverside Mah Jongg" says where this goes, where "Open Your club" says nothing.` — with:

```tsx
          // The name, not the kicker: "Manage Riverside Mah Jongg" says what
          // this acts on, where "Manage Your club" says nothing.
```

Leave the rest of that comment, about `meta` being swallowed, exactly as it is — its reasoning is unchanged.

- [ ] **Step 6: Rename the glyph's testID at its two existing usages**

`scope-chevron` no longer describes what it wraps. In `components/__tests__/dashboard-parts.test.tsx`, replace `screen.queryByTestId('scope-chevron')` with `screen.queryByTestId('scope-glyph')` at line 201, and `screen.getByTestId('scope-chevron')` with `screen.getByTestId('scope-glyph')` at line 220.

- [ ] **Step 7: Fix the three assertions in files this task does not otherwise touch**

The scope button's accessible name is shared. In `app/__tests__/clubs.test.tsx`, replace `'Open Riverside Mah Jongg, Thursday evenings'` with `'Manage Riverside Mah Jongg, Thursday evenings'` at line 935, and `'Open Harbour, Thursday evenings'` with `'Manage Harbour, Thursday evenings'` at line 953. In `app/__tests__/your-games.test.tsx:357`, replace `` `Open ${CLUB.name}, ${CLUB.rhythm}` `` with `` `Manage ${CLUB.name}, ${CLUB.rhythm}` ``.

Do not change `app/__tests__/clubs.test.tsx:350` or `:1145` — `Open Sunday social` and `Open the club thread` are different controls that keep their names.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx app/__tests__/clubs.test.tsx app/__tests__/your-games.test.tsx
```

Expected: PASS, all three files.

- [ ] **Step 9: Run the whole unit suite and the type check**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS with zero failures, and no type errors. Do NOT run Playwright.

- [ ] **Step 10: Commit**

```bash
git add components/icons.tsx components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx app/__tests__/clubs.test.tsx app/__tests__/your-games.test.tsx
git commit -m "feat(dashboard): the header's club scope reads as a manage control"
```

---

### Task 2: A ⊕ beside the avatar

**Files:**
- Modify: `components/icons.tsx` (add `PlusIcon`)
- Modify: `components/DashboardHeader.tsx`
- Test: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `DashboardHeader` from Task 1.
- Produces: `DashboardHeader` accepts `onPressNew?: () => void`. When supplied it renders a circular outlined button holding a `PlusIcon`, immediately left of the avatar, with `accessibilityRole="button"` and `accessibilityLabel="Start a club"`. When omitted nothing is drawn. Task 4 passes it.

- [ ] **Step 1: Write the failing tests**

Add to `describe('DashboardHeader', …)` in `components/__tests__/dashboard-parts.test.tsx`:

```ts
  // The chip row scrolls and this does not. "+ New club" used to trail the
  // row and was already off-screen at two clubs, which made it invisible to
  // exactly the member most likely to start another.
  it('starts a club from the header when it is given a way to', () => {
    const onPressNew = vi.fn();
    render(
      <DashboardHeader
        kicker=""
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
        onPressNew={onPressNew}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(onPressNew).toHaveBeenCalled();
  });

  it('draws no way to start a club unless it is given one', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    // The avatar is untouched by the new control beside it.
    expect(screen.getByRole('button', { name: 'Your profile' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx -t DashboardHeader
```

Expected: FAIL — `starts a club from the header when it is given a way to` cannot find a button named `Start a club`.

- [ ] **Step 3: Add `PlusIcon`**

In `components/icons.tsx`, add directly after `PencilIcon`:

```tsx
/** Plus for the clubs dashboard header's "start a club" control
 *  (components/DashboardHeader.tsx). */
export function PlusIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14" />
      <Path d="M5 12h14" />
    </Svg>
  );
}
```

- [ ] **Step 4: Add the prop and the button**

In `components/DashboardHeader.tsx`, extend the import:

```tsx
import { PencilIcon, PersonIcon, PlusIcon } from './icons';
```

Add the prop to the signature, after `onPressAvatar`:

```tsx
  onPressNew,
```

and to its type, after `onPressAvatar: () => void;`:

```tsx
  /** Draws the "start a club" control. Omitted where there is no club list
   *  to add to — the club detail and venues screens render this same header. */
  onPressNew?: () => void;
```

Then wrap the avatar in a right-hand cluster. Replace the avatar `Pressable` (and nothing above it) with:

```tsx
      <View style={styles.actions}>
        {onPressNew ? (
          <Pressable
            onPress={onPressNew}
            accessibilityRole="button"
            accessibilityLabel="Start a club"
            style={styles.newClub}
          >
            <PlusIcon size={24} color={colors.text} />
          </Pressable>
        ) : null}
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
```

- [ ] **Step 5: Style the cluster and the button**

Add these two entries to the same file's `StyleSheet.create({…})`, directly above `avatar`:

```tsx
  // The header's right-hand controls. `flexShrink: 0` so a long club name in
  // the scope block on the left cannot squeeze them — `scope` is the flexible
  // half, these are fixed.
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 0,
    gap: space[2],
  },
  // The avatar's shape, outlined rather than filled: it sits beside the
  // avatar and must not read as a second member. textMuted for the boundary
  // — #676158 on the page background measures 5.15:1 (lib/theme.ts records
  // the ratio), past the 3:1 a control boundary needs.
  newClub: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS, whole file — including every pre-existing `DashboardHeader` test, which passes no `onPressNew`.

- [ ] **Step 7: Run the whole unit suite and the type check**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS with zero failures, no type errors. Do NOT run Playwright.

- [ ] **Step 8: Commit**

```bash
git add components/icons.tsx components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(dashboard): start a club from the header, not the scrolling row"
```

---

### Task 3: The all-clubs scope shortens and drops its kicker

**Files:**
- Modify: `lib/dashboard.ts` (the `!club` branch of `headerScope`)
- Test: `lib/dashboard.test.ts`
- Also fix (the rendered title changes): `app/__tests__/clubs.test.tsx:930`, `app/__tests__/clubs.test.tsx:944`

**Interfaces:**
- Consumes: the empty-kicker guard from Task 1.
- Produces: `headerScope(clubs, selected)` returns `{ kicker: '', name: 'Your clubs', meta: '${clubs.length} clubs' }` for the all-clubs scope. The single-club scope is unchanged (`kicker: 'Your club'`, club name, club rhythm).

- [ ] **Step 1: Write the failing tests**

In `lib/dashboard.test.ts`, inside `describe('headerScope', …)`, replace the body of `counts clubs when the scope is all`:

```ts
  // No kicker: the name is "Your clubs" now, and a "YOUR CLUBS" kicker above
  // it is the same words twice. DashboardHeader guards on length, so an
  // empty string draws nothing. The single-club scope below keeps its
  // kicker — there "Your club" and the club's own name say different things.
  it('names the whole list without repeating itself when the scope is all', () => {
    expect(headerScope(CLUBS, ALL_CLUBS)).toEqual({
      kicker: '',
      name: 'Your clubs',
      meta: '2 clubs',
    });
  });
```

Replace the body of `still counts an empty list rather than resolving to nothing`:

```ts
  it('still counts an empty list rather than resolving to nothing', () => {
    expect(headerScope([], ALL_CLUBS)).toEqual({
      kicker: '',
      name: 'Your clubs',
      meta: '0 clubs',
    });
  });
```

And in `falls back to the all-clubs scope for an unknown id`, replace `toBe('All your clubs')` with `toBe('Your clubs')`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/dashboard.test.ts -t headerScope
```

Expected: FAIL — the returned object still has `kicker: 'Your clubs'` and `name: 'All your clubs'`.

- [ ] **Step 3: Shorten the title and drop the kicker**

In `lib/dashboard.ts`, replace the `if (!club)` return inside `headerScope` with:

```ts
  if (!club) {
    return {
      // No kicker, and a shorter name. "YOUR CLUBS" above "All your clubs"
      // was the same words twice, and the width it cost is what the header's
      // "start a club" control now uses. The single-club scope below keeps
      // its kicker: there "Your club" and the club's own name differ.
      kicker: '',
      name: 'Your clubs',
      // Always plural: this branch is reached only by an empty list ("0
      // clubs") or by two or more. A one-club list resolves above.
      meta: `${clubs.length} clubs`,
    };
  }
```

- [ ] **Step 4: Fix the two assertions on the rendered title**

In `app/__tests__/clubs.test.tsx`, replace `screen.findByText('All your clubs')` with `screen.findByText('Your clubs')` at line 930 (inside `heads the page with the club count and the profile avatar`) and at line 944 (inside `offers no way in while every club is in scope`).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run lib/dashboard.test.ts app/__tests__/clubs.test.tsx
```

Expected: PASS, both files.

- [ ] **Step 6: Run the whole unit suite and the type check**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS with zero failures, no type errors. Do NOT run Playwright.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts app/__tests__/clubs.test.tsx
git commit -m "feat(dashboard): shorten the all-clubs title and drop its duplicate kicker"
```

---

### Task 4: The row goes back to filters only

**Files:**
- Modify: `app/clubs/index.tsx` (the `DashboardHeader` and `ClubChips` calls on the populated render)
- Modify: `components/ClubChips.tsx` (delete the `action` prop, its render block, and `styles.action`)
- Test: `components/__tests__/dashboard-parts.test.tsx` (delete the two `ClubChips` action tests), `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: `onPressNew` from Task 2.
- Produces: `ClubChips`'s props are `{ chips, selected, onSelect, unreadByClub? }` — no `action`. Task 5 relies on `+ New club` no longer rendering anywhere.

- [ ] **Step 1: Update the screen's tests**

In `app/__tests__/clubs.test.tsx`, replace `keeps a way to start another club at one club` (around line 958) with:

```ts
  // The row is drawn for a one-club member but holds no filters, so the way
  // to start another club cannot live in it. It is the header's ⊕ now.
  it('keeps a way to start another club at one club', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a club' }));
    expect(push).toHaveBeenCalledWith('/clubs/new');
  });
```

Then fix the zero-club test, whose assertion would otherwise name a control that no longer exists anywhere and so prove nothing. Replace the comment and body of `shows a member in no clubs nothing but the way in` (around line 280) with:

```ts
  // The early return's whole point: a member in no clubs is shown the one
  // thing they can do, not walked past an empty games list and a chip row to
  // reach it. Exactly one way to start a club — the full-width button — and
  // not also the header's ⊕, which that screen deliberately does not draw.
  it('shows a member in no clubs nothing but the way in', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.queryByText('Your games')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Start a club' })).toHaveLength(1);
  });
```

In `components/__tests__/dashboard-parts.test.tsx`, delete both `ClubChips` action tests — `draws no action chip unless one is given` and `reports the action press without claiming a selection` (roughly lines 112–136). The prop they cover is being removed.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run app/__tests__/clubs.test.tsx -t "start another club"
```

Expected: FAIL — `keeps a way to start another club at one club` finds no button named `Start a club` (the header does not yet receive `onPressNew`, and the chip is still named `Start another club`).

- [ ] **Step 3: Wire the header and stop passing the row an action**

In `app/clubs/index.tsx`, on the **populated** render only (not the zero-club early return), add `onPressNew` to the `DashboardHeader` call so it reads:

```tsx
      <DashboardHeader
        kicker={scope.kicker}
        name={scope.name}
        meta={scope.meta}
        initials={initials}
        onPressAvatar={() => router.push('/profile')}
        onPressNew={() => router.push('/clubs/new')}
        onPressScope={
          scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
        }
      />
```

Leave the zero-club early return's `DashboardHeader` exactly as it is: that screen's full-width `Start a club` button is the same action stated more fully, and two of them would compete.

Then delete the whole `action={{ … }}` prop from the `ClubChips` call below it, leaving:

```tsx
      <ClubChips
        chips={chips}
        selected={selected}
        unreadByClub={unreadByClub}
        // A confirmation raised for a game at one club is not an answer to
        // "show me a different club" — the notice would otherwise sit above
        // content it has nothing to do with.
        onSelect={(id) => {
          setSelected(id);
          setNotice(null);
        }}
      />
```

- [ ] **Step 4: Delete the `action` prop from `ClubChips`**

In `components/ClubChips.tsx`, remove three things:

1. `action,` from the destructured parameters, and the whole `action?: { … }` entry from the prop type together with the comment above it explaining its two label fields.
2. The entire `{action ? ( … ) : null}` block inside the `ScrollView`.
3. The `action:` entry in `StyleSheet.create({…})` and its comment.

The component's doc comment still describes it as "the artboard's horizontal club switcher" and stays accurate — do not change it.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run app/__tests__/clubs.test.tsx components/__tests__/dashboard-parts.test.tsx
```

Expected: PASS, both files.

- [ ] **Step 6: Run the whole unit suite and the type check**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS with zero failures, and no type errors. A "declared but never read" error here means a now-unused import in `ClubChips.tsx` — check `Text` and `Pressable`, both of which the filter chips still use, before deleting anything. Do NOT run Playwright.

- [ ] **Step 7: Commit**

```bash
git add app/clubs/index.tsx components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx app/__tests__/clubs.test.tsx
git commit -m "feat(clubs): take the new-club action out of the scrolling chip row"
```

---

### Task 5: Re-baseline the visual snapshots

**Files:**
- Modify: `e2e/visual.spec.ts` (the `clubs at` test around line 229 and `clubs list with a club at` around line 296)
- Modify: `e2e/visual.spec.ts-snapshots/clubs-{mobile,desktop}-darwin.png`, `clubs-populated-{mobile,desktop}-darwin.png`, `messages-badge-{mobile,desktop}-darwin.png`

**Interfaces:**
- Consumes: the finished screen from Task 4.
- Produces: nothing later tasks use.

- [ ] **Step 1: Update the empty-state assertion's comment**

In `e2e/visual.spec.ts`, in `test(\`clubs at ${vp.name}\`, …)`, the assertion `await expect(page.getByText('Your clubs', { exact: true })).toBeVisible();` still passes but for a new reason — `Your clubs` is now the header's *name*, not its kicker. Replace the comment above it with:

```ts
      // `{ exact: true }` — "Your clubs" is the header's NAME now
      // (headerScope's all-clubs scope, lib/dashboard.ts), and that scope
      // draws no kicker: "YOUR CLUBS" above "All your clubs" was the same
      // words twice. Playwright's getByText does substring matching by
      // default, so the bare locator would still be worth avoiding if the
      // longer title ever comes back.
```

- [ ] **Step 2: Replace the populated test's action assertions**

In `test(\`clubs list with a club at ${vp.name}\`, …)`, replace the `Start another club` and `+ New club` assertions and the comment above them with:

```ts
        // The action moved out of the chip row and into the header: at two
        // clubs the trailing "+ New club" pill was scrolled off-screen
        // entirely, and it was the only route to /clubs/new for a member who
        // already had a club. The ⊕ beside the avatar does not scroll.
        await expect(
          page.getByRole('button', { name: 'Start a club' }),
        ).toBeVisible();
        await expect(page.getByText('+ New club')).toHaveCount(0);
```

- [ ] **Step 3: Confirm the snapshots fail before updating them**

```bash
npx playwright test -g "clubs"
```

Expected: FAIL on `clubs at` and `clubs list with a club at` with screenshot comparison diffs. If these tests PASS, stop and report BLOCKED — it would mean Tasks 1–4 did not change the screen.

- [ ] **Step 4: Re-baseline the clubs screens**

```bash
npx playwright test -g "clubs" --update-snapshots
```

- [ ] **Step 5: Re-baseline the two `messages-badge` screens**

`test(\`messages badge at ${vp.name}\`, …)` does `page.goto('/clubs')` (around line 621) and screenshots the same page, so its baselines go stale for the identical reason. Watch them fail first, then update:

```bash
npx playwright test -g "messages badge"
```

Expected: FAIL on screenshot diffs only — its two content assertions, on the club chip's and the Messages tab's unread badges, must still PASS. If either content assertion fails, stop and report it: that would be a real regression, not a stale baseline.

```bash
npx playwright test -g "messages badge" --update-snapshots
```

That test's comment at roughly line 628 explains why its `.first()` is a "defensive belt" and still reads correctly — leave it.

- [ ] **Step 6: Check the diff and look at the images**

```bash
git diff --stat e2e/visual.spec.ts-snapshots/
```

Expected: exactly six PNGs — `clubs-mobile`, `clubs-desktop`, `clubs-populated-mobile`, `clubs-populated-desktop`, `messages-badge-mobile`, `messages-badge-desktop`, all `-darwin.png`. Any other snapshot in the diff is a regression on a screen this plan does not touch: stop and find out why before committing.

Then open the six regenerated PNGs and confirm: the header reads `Your clubs` with no kicker above it in the all-clubs scope; a ⊕ sits immediately left of the avatar; the chip row holds only `All clubs` and the club chips, with no `+ New club` pill; and the empty-state screen still shows its full-width `Start a club` button and no ⊕. If anything looks wrong — a clipped ⊕, the two round controls crowding, a title colliding with them — say so rather than committing a bad baseline.

- [ ] **Step 7: Run both suites in full**

```bash
npm run test:visual && npm test
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add e2e/visual.spec.ts e2e/visual.spec.ts-snapshots/
git commit -m "test(visual): re-baseline the clubs screen for the header's actions"
```

---

## Done when

- `npm test` passes.
- `npm run test:visual` passes.
- `npx tsc --noEmit` is clean.
- The chip row holds only filters; the header carries both a ⊕ to start a club and a pencil to manage the one in scope.
