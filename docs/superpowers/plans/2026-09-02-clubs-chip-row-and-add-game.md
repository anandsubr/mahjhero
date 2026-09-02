# The chip row's New club tile and the header's Add a game + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the redesign in [docs/superpowers/specs/2026-09-02-clubs-chip-row-and-add-game-design.md](../specs/2026-09-02-clubs-chip-row-and-add-game-design.md) on branch `UI-tweaks`: the club chip row drops "All clubs" and gains a trailing "New club" tile (always visible, even for one club), and `DashboardHeader`'s ⊕ drops "start a club" entirely in favor of "add a game to the club currently in view".

**Architecture:** Two tasks. Task 1 is the component layer — `lib/dashboard.ts`, `components/ClubChips.tsx`, `components/DashboardHeader.tsx` — each independently unit-tested. Task 2 wires them into `app/clubs/index.tsx` and reworks that screen's own tests plus a stale e2e assertion.

**Tech Stack:** React Native (Expo Router) + TypeScript, Vitest + Testing Library.

## Global Constraints

- Run scoped tests with `npm test -- <path>` (`TZ=America/New_York vitest run`).
- Every color/spacing/radius/font value comes from `lib/theme.ts` — never a hardcoded hex or px number where a token exists.
- Every pressable needs `accessibilityRole="button"` and an `accessibilityLabel` — the label REPLACES the accessible name react-native-web would otherwise compute from children.
- Never use `router.back()`.
- `scopeClubId` (`app/clubs/index.tsx`) is the one existing derivation that already resolves "the club currently in view" for both an explicit chip selection and a one-club member's implicit scope — reuse it, don't re-derive the same fact a second way.

---

### Task 1: Component layer — `buildChips`, `ClubChips`'s New club tile, `DashboardHeader`'s Add a game +

**Files:**
- Modify: `lib/dashboard.ts:21-25` (`buildChips`), `lib/dashboard.ts:48-52` (a stale comment)
- Modify: `lib/dashboard.test.ts:86-94` (`buildChips` test)
- Modify: `components/ClubChips.tsx` (full rewrite)
- Modify: `components/DashboardHeader.tsx` (full rewrite)
- Modify: `components/__tests__/dashboard-parts.test.tsx:64-260` (`ClubChips` and `DashboardHeader` describe blocks)

**Interfaces:**
- Produces: `ClubChips({ chips, selected, onSelect, onPressNewClub?, unreadByClub? })` — `onPressNewClub` is new; everything else unchanged. `chips` never contains an `ALL_CLUBS` entry anymore.
- Produces: `DashboardHeader({ kicker, name, meta, onPressScope?, onPressAddGame?, onPressBack? })` — `onPressNew` is deleted; `onPressAddGame` is new, rendered only in the `kicker === 'Your club'` branch, in the exact top-row slot `onPressNew` used to occupy there.
- Consumes (Task 2): both of the above, wired from `app/clubs/index.tsx`.

- [ ] **Step 1: Update `buildChips` and its test first**

In `lib/dashboard.test.ts`, change:

```tsx
describe('buildChips', () => {
  it('puts All clubs first, then one chip per club', () => {
    expect(buildChips(CLUBS)).toEqual([
      { id: ALL_CLUBS, label: 'All clubs' },
      { id: 'club-1', label: 'Riverside Mah Jongg' },
      { id: 'club-2', label: 'Harbour Tiles' },
    ]);
  });
});
```

to:

```tsx
describe('buildChips', () => {
  it('makes one chip per club, in order, with no "All clubs" entry', () => {
    expect(buildChips(CLUBS)).toEqual([
      { id: 'club-1', label: 'Riverside Mah Jongg' },
      { id: 'club-2', label: 'Harbour Tiles' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/dashboard.test.ts -t buildChips`
Expected: FAIL — `buildChips` still prepends the `ALL_CLUBS` entry

- [ ] **Step 3: Update `buildChips` and the stale `headerScope` comment**

In `lib/dashboard.ts`, change:

```tsx
export function buildChips(clubs: Club[]): Chip[] {
  return [{ id: ALL_CLUBS, label: 'All clubs' }].concat(
    clubs.map((club) => ({ id: club.id, label: club.name })),
  );
}
```

to:

```tsx
export function buildChips(clubs: Club[]): Chip[] {
  return clubs.map((club) => ({ id: club.id, label: club.name }));
}
```

And change the comment above `headerScope`'s single-club resolution (the row's own visibility no longer depends on club count, so a one-club member's chip row now exists and could, in principle, be tapped):

```tsx
  // A one-club member's scope is never ambiguous, and their `selected` never
  // moves off ALL_CLUBS — the chip row that would change it is not drawn
  // below two clubs. Resolving the lone club here is what lets the header
  // name it and be pressed into it. Same derivation, for the same reason, as
  // the screen's own `scopeClubId`.
```

to:

```tsx
  // A one-club member's scope is never ambiguous even if they tap their own
  // chip: `selected` would carry that club's own id instead of ALL_CLUBS,
  // but `picked` resolves to the identical club either way, so this branch
  // returns the same result regardless of which one drew it. Resolving the
  // lone club here is what lets the header name it and be pressed into it.
  // Same derivation, for the same reason, as the screen's own `scopeClubId`.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- lib/dashboard.test.ts`
Expected: PASS (whole file)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts
git commit -m "fix(clubs): buildChips drops the All clubs entry"
```

- [ ] **Step 6: Rewrite the `ClubChips` test block first**

In `components/__tests__/dashboard-parts.test.tsx`, replace the `CHIPS` fixture and the entire `describe('ClubChips', ...)` block with:

```tsx
const CHIPS = [
  { id: 'club-1', label: 'Riverside Mah Jongg' },
  { id: 'club-2', label: 'Harbour Tiles' },
];

describe('ClubChips', () => {
  it('marks the selected chip and only that one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(
      screen
        .getByRole('button', { name: 'Riverside Mah Jongg' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Harbour Tiles' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('reports the chip that was pressed', () => {
    const onSelect = vi.fn();
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Harbour Tiles' }));
    expect(onSelect).toHaveBeenCalledWith('club-2');
  });

  // UnreadBadge's own <Text> never reaches assistive tech: this Pressable's
  // accessibilityLabel emits aria-label on react-native-web, which REPLACES
  // the accessible name computed from children (the badge included) rather
  // than merging with it. The count has to be composed into the chip's own
  // label for a screen-reader user to ever hear it.
  it('composes the unread count into the chip’s accessible name', () => {
    render(
      <ClubChips
        chips={CHIPS}
        selected="club-1"
        onSelect={() => {}}
        unreadByClub={{ 'club-1': 4 }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Riverside Mah Jongg, 4 unread' }),
    ).toBeTruthy();
  });

  it('shows each club’s initials in its tile', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(screen.getByText('RM')).toBeTruthy();
    expect(screen.getByText('HT')).toBeTruthy();
  });

  it('draws a trailing New club tile when given a way to start one', () => {
    const onPressNewClub = vi.fn();
    render(
      <ClubChips
        chips={CHIPS}
        selected="club-1"
        onSelect={() => {}}
        onPressNewClub={onPressNewClub}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(onPressNewClub).toHaveBeenCalled();
    expect(screen.getByText('New club')).toBeTruthy();
  });

  it('draws no New club tile unless it is given a way to start one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    expect(screen.queryByText('New club')).toBeNull();
  });
});
```

(This removes the old `ALL_CLUBS`-glyph test — there is no `ALL_CLUBS` chip to glyph anymore. Also delete the now-dead `import { ALL_CLUBS } from '../../lib/dashboard';` at the top of this file — confirmed via `grep -n "ALL_CLUBS" components/__tests__/dashboard-parts.test.tsx` that its only uses were in the `CHIPS` fixture and the `ClubChips` tests just replaced; the `DashboardHeader`, `NoticeBanner`, and `NeedAFourthCard` describe blocks never reference it.)

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx -t ClubChips`
Expected: FAIL — `ClubChips` still renders the `ALL_CLUBS` glyph tile and has no `onPressNewClub` prop

- [ ] **Step 8: Rewrite `ClubChips`**

Replace the entire contents of `components/ClubChips.tsx` with:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon } from './icons';
import UnreadBadge from './UnreadBadge';
import { initialsFrom } from '../lib/dashboard';
import type { Chip } from '../lib/dashboard';
import { unreadSuffix } from '../lib/messages';
import { colors, control, space, type } from '../lib/theme';

/**
 * The artboard's club switcher, icon-over-label — the same shape
 * components/TabBar.tsx uses for every tab. Each club gets a small avatar
 * carrying its initials (the same fill/initials treatment DashboardHeader's
 * and ThreadAvatar's own club avatars use).
 *
 * No "All clubs" chip: it never represented a real club, and the row's own
 * visibility already carries that meaning (app/clubs/index.tsx draws it
 * exactly when nothing is filtered in). A trailing "New club" tile takes
 * its place at the end of the row — the outlined ⊕ treatment PlusButton
 * uses, not a club's solid initials fill, so it reads as an action rather
 * than a fourth club. `onPressNewClub` is optional so this component stays
 * usable without it, but every real caller passes it.
 *
 * Selection reads as a ring around the avatar rather than a leading dot,
 * which had nowhere clean to sit on a tile.
 *
 * Still wraps onto as many lines as it needs rather than scrolling
 * horizontally — selecting a chip is the only way to arm the header's
 * Manage control, so a chip clipped or scrolled off-screen would hide a
 * member's only route into that club. Wrapping means nothing is ever
 * hidden, at any club count — the New club tile included, which was tried
 * as a trailing chip once before and removed specifically because the row
 * used to scroll and clip it; that reason no longer applies.
 */
export default function ClubChips({
  chips,
  selected,
  onSelect,
  onPressNewClub,
  unreadByClub,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
  onPressNewClub?: () => void;
  unreadByClub?: Record<string, number>;
}) {
  return (
    <View style={styles.row}>
      {chips.map((chip) => {
        const active = chip.id === selected;
        const count = unreadByClub?.[chip.id] ?? 0;
        return (
          <Pressable
            key={chip.id}
            onPress={() => onSelect(chip.id)}
            accessibilityRole="button"
            // The count is composed in here rather than left on
            // UnreadBadge's own <Text>: react-native-web's aria-label
            // REPLACES the accessible name computed from a Pressable's
            // children, it does not merge with it, so the badge nested
            // below would otherwise never reach assistive tech.
            accessibilityLabel={`${chip.label}${unreadSuffix(count)}`}
            aria-selected={active}
            style={styles.tile}
          >
            <View style={styles.avatarWrap}>
              <View
                style={[styles.avatar, styles.avatarClub, active ? styles.avatarActive : null]}
              >
                <Text style={styles.avatarInitials}>{initialsFrom(chip.label)}</Text>
              </View>
              <View style={styles.badgeWrap}>
                <UnreadBadge count={count} />
              </View>
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
      {onPressNewClub ? (
        <Pressable
          onPress={onPressNewClub}
          accessibilityRole="button"
          accessibilityLabel="Start a club"
          style={styles.tile}
        >
          <View style={[styles.avatar, styles.avatarNewClub]}>
            <PlusIcon size={16} color={colors.text} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            New club
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  tile: {
    alignItems: 'center',
    gap: space[1],
    width: 72,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarActive: { borderColor: colors.accentColor },
  // Outlined rather than filled — the same treatment PlusButton uses — so
  // this tile reads as an action, not as a fourth club.
  avatarNewClub: {
    backgroundColor: 'transparent',
    borderWidth: control.hairline,
    borderColor: colors.textMuted,
  },
  avatarInitials: {
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: colors.bg,
  },
  badgeWrap: {
    position: 'absolute',
    top: -6,
    right: -8,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
    textAlign: 'center',
  },
  labelActive: { color: colors.accentColor },
});
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx -t ClubChips`
Expected: PASS (6 tests)

- [ ] **Step 10: Commit**

```bash
git add components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(clubs): drop the All clubs chip, add a trailing New club tile"
```

- [ ] **Step 11: Rewrite the `DashboardHeader` test block**

Replace the entire `describe('DashboardHeader', ...)` block in `components/__tests__/dashboard-parts.test.tsx` with:

```tsx
describe('DashboardHeader', () => {
  it('draws no kicker when it is given none', () => {
    render(<DashboardHeader kicker="" name="Your clubs" meta="2 clubs" />);
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.queryByTestId('scope-kicker')).toBeNull();
  });

  // A kicker the flat layout can actually be given in production --
  // app/clubs/[id]/venues.tsx passes the club's own name here. "Your club"
  // is the one value that instead takes the variant below.
  it('still draws a kicker when it is given one', () => {
    render(<DashboardHeader kicker="Riverside Mah Jongg" name="Venues" meta="" />);
    expect(screen.getByTestId('scope-kicker')).toBeTruthy();
    expect(screen.getByText('Venues')).toBeTruthy();
  });

  it('shows the scope name and meta with no kicker', () => {
    render(<DashboardHeader kicker="" name="Your clubs" meta="2 clubs" />);
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
  });

  describe('the "Your club" variant', () => {
    it('shows the club’s avatar, name and rhythm instead of a kicker', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.getByTestId('thread-avatar-club')).toBeTruthy();
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
      expect(screen.getByText('Thursdays, 7pm')).toBeTruthy();
      expect(screen.queryByTestId('scope-kicker')).toBeNull();
      expect(screen.queryByText('Your club')).toBeNull();
    });

    it('draws no rhythm line when there is none to show', () => {
      render(<DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="" />);
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
      expect(screen.queryByText('Thursdays, 7pm')).toBeNull();
    });

    it('opens the club’s management screen when the name pill is pressed', () => {
      const onPressScope = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressScope={onPressScope}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Manage Riverside Mah Jongg, Thursdays, 7pm' }),
      );
      expect(onPressScope).toHaveBeenCalled();
    });

    it('folds the rhythm into the manage label, and drops it when there is none', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta=""
          onPressScope={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Manage Riverside Mah Jongg' }),
      ).toBeTruthy();
    });

    it('draws no manage button unless it is given a way to manage', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    });

    it('clears the club filter when the back chevron is pressed', () => {
      const onPressBack = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressBack={onPressBack}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear club filter' }));
      expect(onPressBack).toHaveBeenCalled();
    });

    it('draws no chevron unless it is given one', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
    });

    it('adds a game for this club when the + is pressed', () => {
      const onPressAddGame = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressAddGame={onPressAddGame}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
      expect(onPressAddGame).toHaveBeenCalled();
    });

    it('draws no way to add a game unless it is given one', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressBack={() => {}}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
    });

    it('draws no top row at all when given neither a chevron nor a way to add a game', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
    });
  });
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx -t DashboardHeader`
Expected: FAIL — `DashboardHeader` still has `onPressNew`, not `onPressAddGame`, and the flat branch still renders a "Start a club" ⊕

- [ ] **Step 13: Rewrite `DashboardHeader`**

Replace the entire contents of `components/DashboardHeader.tsx` with:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeftIcon, PencilIcon } from './icons';
import PlusButton from './PlusButton';
import ThreadAvatar from './ThreadAvatar';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header.
 *
 * Two shapes. The all-clubs scope and app/clubs/[id]/venues.tsx's "Venues"
 * scope draw a flat kicker/name/meta block, with no ⊕ of any kind —
 * starting a club lives in the chip row now (components/ClubChips.tsx's own
 * trailing "New club" tile), not here. The single-club scope —
 * `kicker === 'Your club'`, the one value lib/dashboard.ts's `headerScope`
 * and app/clubs/[id]/index.tsx ever pass for it — instead centres the
 * club's own identity: an avatar and a name pill, the same treatment the
 * messages board header uses for a club thread (app/messages/club/new.tsx).
 * venues.tsx passes the club's own name as its kicker, never the literal
 * string 'Your club', so it always draws the flat shape.
 *
 * `onPressScope`, only meaningful in the "Your club" shape, draws a pencil
 * beside the name and opens the club's roster, invites, venues and import —
 * management, not a form, hence "Manage", not "Edit". Omitted wherever there
 * is no destination for it: the all-clubs scope, and the two screens that
 * already render this same header for one particular club
 * (app/clubs/[id]/index.tsx, venues.tsx), where the scope IS the
 * destination. The flat branch below never reads it, so passing it there
 * has no effect — no error, no control drawn.
 *
 * `onPressAddGame`, also only meaningful in the "Your club" shape, draws the
 * top row's ⊕ — "add a game to the club currently in view", not "start a
 * new club" (that action lives in the chip row now, not here). Only
 * app/clubs/index.tsx ever passes it, gated on the same `scopeClubId` that
 * drives `onPressScope`, so a one-club member gets it too without any
 * special-casing — their header always shows this shape.
 *
 * `onPressBack`, also only meaningful in the "Your club" shape, draws a
 * chevron and is app/clubs/index.tsx's way to clear its club filter back to
 * "All clubs" — client state, not navigation. app/clubs/[id]/index.tsx
 * renders this same shape but never passes it: that screen's way back is
 * the separate ghost Button above this header
 * (2026-09-01-back-links-design.md), a real navigation rather than a filter
 * clear, so the two were kept apart rather than overloading one chevron
 * with both meanings.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  onPressScope,
  onPressAddGame,
  onPressBack,
}: {
  kicker: string;
  name: string;
  meta: string;
  onPressScope?: () => void;
  onPressAddGame?: () => void;
  onPressBack?: () => void;
}) {
  if (kicker === 'Your club') {
    return (
      <View style={styles.clubHeader}>
        {onPressBack || onPressAddGame ? (
          <View style={styles.clubTopRow}>
            {/* Fixed 44x44 footprint whether or not the chevron itself
                draws, so the ⊕ beside it stays in the same place either
                way — app/clubs/index.tsx passes both together except for a
                one-club member, who gets the ⊕ alone. */}
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
            {onPressAddGame ? (
              <PlusButton onPress={onPressAddGame} accessibilityLabel="Add a game" />
            ) : null}
          </View>
        ) : null}
        <View style={styles.clubCenter}>
          <ThreadAvatar kind="club" name={name} size={72} />
          {onPressScope ? (
            <Pressable
              onPress={onPressScope}
              accessibilityRole="button"
              // See this file's header comment for why the label composes
              // `meta` -- accessibilityLabel replaces the accessible name
              // react-native-web would otherwise compute from this
              // Pressable's children, so the rhythm visible in the meta
              // line below goes unheard unless it rides along here too.
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

  return (
    <>
      {kicker.length > 0 ? (
        <Text testID="scope-kicker" style={styles.kicker}>
          {kicker}
        </Text>
      ) : null}
      <Text style={styles.name}>{name}</Text>
      {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accentColor,
  },
  name: {
    fontFamily: type.heading,
    fontSize: 30,
    lineHeight: 35,
    color: colors.text,
    marginTop: 3,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 3,
  },
  clubHeader: { gap: space[3] },
  clubTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clubBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubCenter: { alignItems: 'center', gap: space[2] },
  // Same pill treatment as the messages board header's own name pill
  // (app/messages/club/new.tsx) — maxWidth, radius and padding copied
  // rather than re-derived.
  clubNamePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    maxWidth: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  clubNamePillText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  clubMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
```

Note: the flat branch drops its wrapping `row`/`scope` `View`s and the `Pressable` layer entirely — it never has a second (⊕) child anymore, so the two-child flex row those styles existed for is gone. It returns a bare `<>` fragment of up to three `Text` siblings.

- [ ] **Step 14: Run it to verify it passes**

Run: `npm test -- components/__tests__/dashboard-parts.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 15: Run the full suite**

Run: `npm test`
Expected: FAIL — `app/clubs/index.tsx` (Task 2's file) still passes the now-deleted `onPressNew` prop and still gates the chip row on `list.length`. This is expected; Task 2 fixes it. Confirm the failures are confined to `app/__tests__/clubs.test.tsx` and not `lib/` or `components/__tests__/`.

- [ ] **Step 16: Commit**

```bash
git add components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat(clubs): DashboardHeader drops start-a-club, gains add-a-game"
```

---

### Task 2: Wire it into `app/clubs/index.tsx`

**Files:**
- Modify: `app/clubs/index.tsx:454-519` (the `DashboardHeader` call, the `scopeClubId` comment, the `ClubChips` call)
- Modify: `app/__tests__/clubs.test.tsx` (multiple tests in the `'dashboard artboard'` describe block)
- Modify: `e2e/visual.spec.ts:317-325` (a stale assertion; unverifiable locally per Task 8 of the prior plan — no Docker in this environment)

**Interfaces:**
- Consumes: `DashboardHeader`'s `onPressAddGame`/`onPressBack` and `ClubChips`'s `onPressNewClub`, both from Task 1.

- [ ] **Step 1: Rewrite the failing screen-level tests first**

In `app/__tests__/clubs.test.tsx`, inside `describe('dashboard artboard', ...)`:

Change the comment and test at `'draws no chevron for a one-club member'`:

```tsx
  // A one-club member's `selected` never leaves ALL_CLUBS — the chip row
  // that would move it off is not drawn below two clubs (see the "draws no
  // chip row" test below) — so there is nothing for a chevron to clear.
  // app/clubs/index.tsx gates onPressBack on `list.length > 1` for exactly
  // this reason, and this is what proves the gate actually holds in the
  // screen, not just in DashboardHeader's own unit tests.
  it('draws no chevron for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
  });
```

to:

```tsx
  // A one-club member's `selected` defaults to ALL_CLUBS and nothing here
  // moves it, so there is nothing for a chevron to clear yet.
  // app/clubs/index.tsx gates onPressBack on `selected !== ALL_CLUBS`, and
  // this is what proves the gate actually holds in the screen, not just in
  // DashboardHeader's own unit tests. See "shows the chip row, with a New
  // club tile, for a one-club member" below for what the row itself does in
  // this same state.
  it('draws no chevron for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
  });
```

Replace `'draws no chip row for a one-club member'` entirely:

```tsx
  // A lone "All clubs" pill beside a lone club pill filters nothing, so the
  // row is not drawn at all for a one-club member — not drawn empty, not
  // drawn at all. "All clubs" is the one chip that only ever exists when the
  // row does, which is what makes it a fair stand-in for "is the row there".
  it('draws no chip row for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All clubs' })).toBeNull();
  });
```

with:

```tsx
  // The row now draws for a one-club member too — their own club's tile
  // plus a trailing New club tile, so starting a second club has a route
  // that isn't the header (which no longer offers one at all).
  it('shows the chip row, with a New club tile, for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a club' })).toBeTruthy();
    expect(screen.getByText('New club')).toBeTruthy();
  });
```

Replace `'draws the chip row at two clubs'`:

```tsx
  it('draws the chip row at two clubs', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'All clubs' })).toBeTruthy();
  });
```

with:

```tsx
  it('draws the chip row at two clubs, with a New club tile', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Harbour' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a club' })).toBeTruthy();
  });
```

Replace `'keeps a way to start another club at one club'`'s comment (the test body itself is unchanged — same accessible name, same destination, just now drawn by the chip row instead of the header):

```tsx
  // The chip row isn't even drawn for a one-club member (it would hold no
  // filters), so the way to start another club cannot live in it. It is the
  // header's ⊕ now.
  it('keeps a way to start another club at one club', async () => {
```

to:

```tsx
  // The header no longer offers a way to start a club at all — that's the
  // chip row's New club tile now, which draws even for a one-club member.
  it('keeps a way to start another club at one club, via the New club tile', async () => {
```

Add four new tests to the same `describe('dashboard artboard', ...)` block (placed near the existing chevron/chip tests is fine):

```tsx
  it('adds a game for the club in view from the header +', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harbour' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-2/events/new');
  });

  it('adds a game for a one-club member’s own club from the header +, with no click needed', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith(`/clubs/${CLUB.id}/events/new`);
  });

  it('offers no + at all while every club is in scope', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Your clubs')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
  });

  it('hides the chip row once a club is filtered in, and shows it again via the chevron', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));
    expect(screen.queryByRole('button', { name: 'Harbour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear club filter' }));
    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- app/__tests__/clubs.test.tsx -t "dashboard artboard"`
Expected: FAIL — several assertions (`'Riverside Mah Jongg'`/`'Start a club'`/`'New club'` chip-row tests, `'Add a game'` header tests) don't yet match the screen's current wiring

- [ ] **Step 3: Wire `DashboardHeader` and `ClubChips`**

In `app/clubs/index.tsx`, change the `scopeClubId` comment:

```tsx
  // The club in scope — what "Host a table" creates in, and what the header
  // opens. Derived from the clubs themselves, NOT from the chip state: the
  // chip row carries no filters below two clubs, so a one-club member's
  // `selected` stays ALL_CLUBS forever, and gating on `selected !== ALL_CLUBS`
  // would hide both affordances from exactly the member most likely to want
  // them. With several clubs and no chip picked the scope genuinely is
  // ambiguous, so neither is offered rather than one that guesses.
  // `headerScope` resolves the lone club the same way, for the same reason.
  // The lookup below also guards against a `selected` that no longer names a
  // club in `list` — the same "left, removed, or the list reloaded" case
  // `headerScope` (lib/dashboard.ts) validates against, for the same reason:
  // trusting `selected` blindly would let the header read the all-clubs
  // scope while still pushing a route built from a stale, non-existent id.
```

to:

```tsx
  // The club in scope — what "Host a table" and the header's own "Add a
  // game" create in, and what the header's pencil opens. Derived from the
  // clubs themselves, NOT from the chip state: a one-club member's
  // `selected` stays ALL_CLUBS unless they redundantly tap their own tile,
  // and gating on `selected !== ALL_CLUBS` alone would hide every one of
  // these affordances from exactly the member most likely to want them.
  // With several clubs and no chip picked the scope genuinely is ambiguous,
  // so none of them is offered rather than one that guesses. `headerScope`
  // resolves the lone club the same way, for the same reason. The lookup
  // below also guards against a `selected` that no longer names a club in
  // `list` — the same "left, removed, or the list reloaded" case
  // `headerScope` (lib/dashboard.ts) validates against, for the same reason:
  // trusting `selected` blindly would let the header read the all-clubs
  // scope while still pushing a route built from a stale, non-existent id.
```

Replace the `DashboardHeader` call:

```tsx
      <DashboardHeader
        kicker={scope.kicker}
        name={scope.name}
        meta={scope.meta}
        onPressNew={() => router.push('/clubs/new')}
        onPressScope={
          scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
        }
        // Only when the chip row itself is drawn (list.length > 1) — a
        // one-club member's `selected` never leaves ALL_CLUBS (the chip row
        // that would change it is not drawn below two clubs, per
        // ClubChips's own docstring), so there is nothing to clear for them.
        onPressBack={
          list.length > 1
            ? () => {
                setSelected(ALL_CLUBS);
                setNotice(null);
              }
            : undefined
        }
      />
```

with:

```tsx
      <DashboardHeader
        kicker={scope.kicker}
        name={scope.name}
        meta={scope.meta}
        onPressScope={
          scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
        }
        // Same club the pencil opens — a member looking at one club's games
        // reaches for the header's + expecting "add a game here", not
        // "start an unrelated club". `scopeClubId` already resolves both the
        // ways a single club ends up in view: an explicit chip pick, and a
        // one-club member's own club, which `headerScope` shows regardless
        // of `selected` — so this covers both with no special-casing.
        onPressAddGame={
          scopeClubId ? () => router.push(`/clubs/${scopeClubId}/events/new`) : undefined
        }
        // Shown exactly when the chip row is hidden (see the row's own
        // guard below) — the chevron is the way back once a club is
        // filtered in, whether that happened at two clubs or a member
        // redundantly tapped their own single tile.
        onPressBack={
          selected !== ALL_CLUBS
            ? () => {
                setSelected(ALL_CLUBS);
                setNotice(null);
              }
            : undefined
        }
      />
```

Replace the `ClubChips` block:

```tsx
      {/*
        Empty below two clubs: a lone "All clubs" pill beside a lone club
        pill filters nothing, so a one-club member was shown a scrolling row
        with nothing in it — roughly 20px of unexplained whitespace above
        "Your games" and an empty overflow-x region in the DOM. It also no
        longer has to be drawn for the action's sake: "+ New club" used to
        live in this row, which is the only reason an earlier version of this
        guard drew the row unconditionally, but that action is the header's
        ⊕ now.
      */}
      {list.length > 1 ? (
        <ClubChips
          chips={buildChips(list)}
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
      ) : null}
```

with:

```tsx
      {/*
        Shown whenever nothing is filtered in — even for a member with just
        one club, so the row (and its trailing "New club" tile) is where
        starting another club lives now, not the header. Hidden the moment a
        club IS filtered in, at any club count: the header's back chevron is
        the way to see this row again, so there is no dead end even for a
        one-club member who taps their own tile.
      */}
      {selected === ALL_CLUBS ? (
        <ClubChips
          chips={buildChips(list)}
          selected={selected}
          unreadByClub={unreadByClub}
          // A confirmation raised for a game at one club is not an answer to
          // "show me a different club" — the notice would otherwise sit above
          // content it has nothing to do with.
          onSelect={(id) => {
            setSelected(id);
            setNotice(null);
          }}
          onPressNewClub={() => router.push('/clubs/new')}
        />
      ) : null}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/clubs.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Fix the stale e2e assertion (unverifiable locally — no Docker in this environment)**

In `e2e/visual.spec.ts`, change:

```ts
        await expect(page.getByText('Riverside Mah Jongg').first()).toBeVisible();
        // The action moved out of the chip row and into the header: at two
        // clubs the trailing "+ New club" pill was scrolled off-screen
        // entirely, and it was the only route to /clubs/new for a member who
        // already had a club. The ⊕ beside the avatar does not scroll.
        await expect(
          page.getByRole('button', { name: 'Start a club' }),
        ).toBeVisible();
        await expect(page.getByText('+ New club')).toHaveCount(0);
```

to:

```ts
        await expect(page.getByText('Riverside Mah Jongg').first()).toBeVisible();
        // The action lives in the chip row again as a trailing "New club"
        // tile — the row now wraps rather than scrolls, so unlike the pill
        // this replaced, it is never clipped off-screen. The header's own ⊕
        // is gone from this unfiltered view entirely; it only shows once a
        // specific club is in view, as "Add a game" for that club.
        await expect(
          page.getByRole('button', { name: 'Start a club' }),
        ).toBeVisible();
        await expect(page.getByText('New club')).toBeVisible();
```

- [ ] **Step 7: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx e2e/visual.spec.ts
git commit -m "feat(clubs): wire the New club tile and the header's Add a game +"
```

---

### Final verification (not a separate task)

- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] Visual baselines still cannot regenerate in this environment (no Docker) — same accepted gap as the prior plan's Task 8; the `clubs`/`clubs-populated` baselines will need regeneration whenever Docker is available.
