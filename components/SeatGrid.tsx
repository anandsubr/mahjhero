import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { seatsRemaining } from '../lib/bookings';
import { colors, radius, space, type } from '../lib/theme';

export type Seat = {
  bookingId: string;
  name: string;
  isYou: boolean;
};

/** Only what a "Move to {table}" button needs — not the full EventTable. */
type SeatableTable = { id: string; label: string };

type Props = {
  tableLabel: string;
  capacity: number;
  seats: Seat[];
  /** Omitted for a read-only render — a cancelled game, or somebody else's. */
  onTakeSeat?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
  /**
   * Organizer-only seat management. All five of these are supplied together
   * by an organizer caller and omitted together by a member one — see the
   * `manageable` derivation below, which is the ONE gate every occupied
   * seat's tap behaviour passes through. There is deliberately no separate
   * `isOrganizer` boolean: a caller that forgot one of these five props
   * would otherwise produce a half-wired control (a tappable seat with
   * nothing to move to, say) rather than cleanly falling back to the
   * read-only member render.
   *
   * `openBookingId` is NOT local state in this component. Only one person's
   * panel may be open across the WHOLE screen, and a screen can render many
   * tables — each its own SeatGrid instance — so that exclusivity has to be
   * owned one level up (the event screen) and handed down as a controlled
   * value, the same way `busy` already is. If this component tracked its
   * own "which seat is open" state, two different tables' SeatGrids could
   * each have a panel open at once.
   */
  otherTables?: SeatableTable[];
  openBookingId?: string | null;
  onToggleManage?: (bookingId: string) => void;
  onMove?: (bookingId: string, tableId: string) => void;
  onRemove?: (bookingId: string) => void;
};

/**
 * One table's seats.
 *
 * Occupied seats are drawn in the order they are given, then the remainder
 * are drawn empty. Nothing here numbers a seat, and nothing may: the schema
 * COUNTS seats, and a UI that implies Table 2 seat 3 is a durable place
 * teaches members to expect something the data cannot promise.
 *
 * Empty count floors at zero (via lib/bookings' `seatsRemaining`, the same
 * helper TableCard uses for its own count). A table can hold more people
 * than it seats after a host removes another table, and rendering a
 * negative number of empty chairs is not a state anybody needs to see.
 *
 * ## Organizer seat management (formerly HostSeating's per-person list)
 *
 * This used to be exactly what it still is today for a plain member: a grid
 * that names who is seated and lets an empty seat be tapped. An organizer
 * additionally got a whole separate component, `HostSeating`, rendered
 * BELOW this grid — one row per occupant, each row carrying a "Move to
 * Table N" button per OTHER table plus "Remove from game". This grid
 * already named everyone; that list was a second copy of the same people
 * with buttons attached, and on a multi-table game with several people it
 * ran to more rows than the grid itself. `HostSeating` is now deleted
 * entirely (see .superpowers/sdd/seat-tap-host-controls.md) and its
 * capability lives here instead: an organizer taps an occupied seat to
 * reveal that ONE person's actions, in place, instead of everyone's at
 * once.
 *
 * A seat is only ever tappable this way when `onToggleManage`/`onMove`/
 * `onRemove`/`otherTables` are all supplied (see `manageable` below) — a
 * plain member gets back exactly the read-only `<View>` this component
 * always rendered for an occupied seat, with no Pressable, no aria-*
 * attributes, and no visible hint. That last part matters as much as the
 * access control itself: a chevron or any other affordance rendered
 * unconditionally would tell a member "this is tappable" about a seat that
 * refuses their tap, which is worse than no hint at all.
 *
 * For the organizer case, the closed and open renders are deliberately
 * different shapes rather than one Pressable that grows:
 * - Closed: the WHOLE seat cell is the Pressable (matching the empty seat's
 *   own pattern below), so the touch target is the entire card, comfortably
 *   over the 44px floor.
 * - Open: the cell becomes a plain `View` containing a smaller "header"
 *   Pressable (name + collapse chevron, widened with `hitSlop` rather than
 *   padding so the touch target still clears 44px without growing the
 *   visible header) plus the action buttons as ITS SIBLINGS, not its
 *   children. Nesting a `Button` (itself a `Pressable`) inside another
 *   `Pressable` would let a tap on "Move to Table 2" bubble up and also
 *   fire the outer seat's own onPress, toggling the panel shut on the same
 *   tap that was supposed to act on it. Keeping the header and the actions
 *   as siblings under one shared `View` avoids that entirely.
 *
 * `aria-expanded`, not `accessibilityState={{ expanded }}` — matching every
 * other flat `aria-*` prop already in this codebase. See Toggle.tsx's
 * docstring for why in general: react-native-web's `createDOMProps` has no
 * handling for `accessibilityState` at all. Unlike `aria-disabled`
 * (SeatGrid's own empty-seat Pressable, see the note further down),
 * react-native-web's `Pressable` does NOT compute or override
 * `aria-expanded` itself — it is one of the many aria-* props
 * `createDOMProps` simply passes through — so the flat prop here is
 * actually load-bearing on its own, with no `disabled`-prop-shaped
 * workaround needed.
 *
 * The empty seat's disabled state is sent as the flat `aria-disabled` prop,
 * not `accessibilityState={{ disabled }}` (which this used to send). See
 * components/Toggle.tsx's docstring for why in general: react-native-web's
 * createDOMProps has no handling for `accessibilityState` at all.
 *
 * One wrinkle specific to `Pressable` (unlike Toggle's plain `aria-checked`
 * case): RN Web's own `Pressable` computes `aria-disabled` itself from its
 * `disabled` prop and unconditionally overwrites whatever `aria-disabled` a
 * caller passes in (node_modules/react-native-web/dist/exports/Pressable/
 * index.js, ~line 125 — the trailing `{"aria-disabled": disabled}` in its
 * object spread wins over anything already in `rest`). So on THIS control it
 * is the `disabled` prop below, not the explicit `aria-disabled` prop, that
 * is actually load-bearing for the DOM attribute; `aria-disabled` is kept
 * here to match the flat-prop pattern this codebase now standardizes on, but
 * a caller relying on it alone (e.g. a plain `View`, or if this ever became
 * a bare `Pressable`-less element) would need it to do real work.
 * components/__tests__/SeatGrid.test.tsx asserts the rendered attribute;
 * neutralizing the `disabled` prop turns it red. (Reverting only to
 * `accessibilityState` does NOT turn it red here — the `disabled` prop's
 * own effect on `Pressable` already covers it, which is the mutation-tested
 * evidence for this note.)
 */
export default function SeatGrid({
  tableLabel,
  capacity,
  seats,
  onTakeSeat,
  busy = false,
  needsFourth = false,
  otherTables,
  openBookingId,
  onToggleManage,
  onMove,
  onRemove,
}: Props) {
  const empties = seatsRemaining(capacity, seats.length);
  const lastSeatCall = needsFourth && empties === 1;
  const manageable = Boolean(onToggleManage && onMove && onRemove && otherTables);

  return (
    <View style={styles.grid}>
      {seats.map((seat) => {
        const displayName = seat.isYou ? 'You' : seat.name;

        if (!manageable) {
          return (
            <View
              key={seat.bookingId}
              style={[styles.seat, seat.isYou && styles.seatYou]}
            >
              <Text style={[styles.name, seat.isYou && styles.nameYou]}>
                {displayName}
              </Text>
            </View>
          );
        }

        const isOpen = seat.bookingId === openBookingId;
        const toggle = () => onToggleManage!(seat.bookingId);
        const label = `Manage ${seat.name}'s seat`;

        if (!isOpen) {
          return (
            <Pressable
              key={seat.bookingId}
              style={[styles.seat, seat.isYou && styles.seatYou]}
              onPress={busy ? undefined : toggle}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={label}
              aria-expanded={false}
            >
              {/*
                The chevron is a SIBLING of the name Text, not nested inside
                it. Nesting it (`<Text>{name}<Text>▾</Text></Text>`) was
                tried first and reverted: react-native-web renders a nested
                Text as an inline element sharing the outer Text's own DOM
                node's text content, which makes that node's full text read
                "You ▾" instead of "You" — breaking
                `getByText('You', { exact: true })` in
                e2e/visual.spec.ts (a real, caught regression, not a
                hypothetical one) and any other exact-text query against a
                manageable seat's name. Keeping them as siblings under one
                row means the NAME element's own text is still exactly the
                name, with the decorative glyph entirely outside it.
              */}
              <View style={styles.nameRow}>
                <Text style={[styles.name, seat.isYou && styles.nameYou]}>
                  {displayName}
                </Text>
                {/* Decorative only — the Pressable's own accessibilityLabel
                    and aria-expanded already say everything a screen reader
                    needs; this glyph is purely the sighted hint. */}
                <Text aria-hidden style={[styles.chevron, seat.isYou && styles.chevronYou]}>▾</Text>
              </View>
            </Pressable>
          );
        }

        return (
          <View
            key={seat.bookingId}
            style={[styles.seat, styles.seatOpen, seat.isYou && styles.seatYou]}
          >
            <Pressable
              onPress={busy ? undefined : toggle}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={label}
              aria-expanded
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.nameRow}>
                <Text style={[styles.name, seat.isYou && styles.nameYou]}>
                  {displayName}
                </Text>
                <Text aria-hidden style={[styles.chevron, seat.isYou && styles.chevronYou]}>▴</Text>
              </View>
            </Pressable>

            <View style={styles.manageActions}>
              {otherTables!.map((t) => (
                <Button
                  key={t.id}
                  variant="secondary"
                  big={false}
                  disabled={busy}
                  onPress={() => onMove!(seat.bookingId, t.id)}
                  accessibilityLabel={`Move ${seat.name} to ${t.label}`}
                >
                  {`Move to ${t.label}`}
                </Button>
              ))}
              <Button
                variant="ghost"
                big={false}
                disabled={busy}
                onPress={() => onRemove!(seat.bookingId)}
                accessibilityLabel={`Remove ${seat.name} from this game`}
              >
                Remove from game
              </Button>
            </View>
          </View>
        );
      })}

      {Array.from({ length: empties }, (_, index) => (
        <Pressable
          key={`empty-${index}`}
          style={[styles.seat, styles.empty, lastSeatCall && styles.calling]}
          onPress={busy ? undefined : onTakeSeat}
          disabled={busy || !onTakeSeat}
          accessibilityRole="button"
          accessibilityLabel={
            lastSeatCall
              ? `Take the last seat at ${tableLabel}`
              : `Take a seat at ${tableLabel}`
          }
          aria-disabled={busy || !onTakeSeat}
        >
          {/*
           * Deliberately NOT the string "Needs a 4th" — TableCard already
           * shows that exact text once, as a Tag next to the table label.
           * Repeating it here would give `screen.getByText('Needs a 4th')`
           * two matches and throw, and a screen reader two elements with
           * identical text and no way to tell them apart. This cell's own
           * accessibilityLabel ("Take the last seat at …") is what actually
           * distinguishes it; the visible word here just echoes that call.
           */}
          <Text style={[styles.emptyText, lastSeatCall && styles.callingText]}>
            {lastSeatCall ? 'Last seat' : 'Empty'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  seat: {
    flexGrow: 1,
    flexBasis: '44%',
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    backgroundColor: colors.neutral[300],
    justifyContent: 'center',
  },
  // An open panel needs room for a row of "Move to …" buttons plus
  // "Remove from game" — the 44%-ish column an occupied seat normally gets
  // is nowhere near enough, so the open cell claims the full row width
  // instead of sharing it. flexWrap on the parent `grid` handles the rest:
  // whatever else was going to share this row simply drops to the next one.
  seatOpen: {
    flexBasis: '100%',
    gap: space[2],
  },
  seatYou: { backgroundColor: colors.accent2Color },
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    alignItems: 'center',
  },
  calling: { borderColor: colors.accentColor },
  // lib/theme's `type` is a token bag — font FAMILIES plus a `size` map —
  // not a set of ready-made style objects. There is no `type.body` to
  // spread; every text style is written out from the tokens.
  // Wraps a manageable seat's name and its decorative chevron as SIBLINGS
  // (not one nested inside the other's Text) — see the long comment at the
  // chevron's render site for why that distinction is load-bearing.
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  name: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  nameYou: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.neutral[100],
  },
  // Same size as the name it trails — this is a sighted-only disclosure
  // hint (aria-hidden), not helper text, so the 16pt "helper only" floor
  // doesn't apply, but there's no reason to shrink it below the name either.
  chevron: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
  },
  // seatYou's background is the darker accent2Color, where textMuted's
  // low-contrast brown would be nearly unreadable — matches nameYou's own
  // switch to a light neutral for the same reason.
  chevronYou: {
    color: colors.neutral[100],
  },
  manageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
  },
  callingText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accent[700],
  },
});
