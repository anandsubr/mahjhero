import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { StarIcon } from './icons';
import { seatsRemaining } from '../lib/bookings';
import { colors, radius, space, type } from '../lib/theme';

/** The plan's hard rule: these seven values, everywhere, no others. */
const POINT_VALUES = [25, 30, 35, 40, 45, 50, 75] as const;

export type Seat = {
  bookingId: string;
  /** Needed for `onRecordRound` (Task 4) -- record_round takes a winner's
   *  profile id, not a booking id. */
  profileId: string;
  name: string;
  isYou: boolean;
  /** This seat's running point total at this table, or null/omitted if
   *  they have never won a round here -- no badge renders in that case.
   *  Optional (not just nullable) so every existing test fixture that
   *  predates scoring keeps compiling unchanged -- TableCard's own
   *  mapping (Step 6 below) always sets this explicitly. */
  points?: number | null;
  /** True if tied for (or alone in) the current lead among this table's
   *  occupants who have won at least one round. Ties: everyone tied for
   *  the lead gets the star, not just whoever reached it first. Optional,
   *  same reasoning as `points` -- defaults to false when omitted. */
  isLeader?: boolean;
};

function SeatBadge({ seat }: { seat: Seat }) {
  const points = seat.points ?? null;
  if (points === null) return null;
  if (seat.isLeader) {
    return (
      <View style={styles.badge} testID={`badge-star-${seat.bookingId}`}>
        <StarIcon size={40} color={colors.accent[400]} style={styles.badgeStarIcon} />
        <Text style={[styles.badgeText, styles.badgeTextStar]}>{points}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeRound]} testID={`badge-round-${seat.bookingId}`}>
      <Text style={styles.badgeText}>{points}</Text>
    </View>
  );
}

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
   * Organizer-only seat management: Move-to-another-table plus Remove. These
   * three (plus the shared `openBookingId`/`onToggleManage` below) are
   * supplied together by an organizer caller and omitted together by a
   * member one — see `organizerManageable` below, which is the ONE gate an
   * organizer's occupied-seat tap passes through. There is deliberately no
   * separate `isOrganizer` boolean: a caller that forgot one of these three
   * would otherwise produce a half-wired control (a tappable seat with
   * nothing to move to, say) rather than cleanly falling back to the
   * read-only render. `otherTables` in particular only ever makes sense
   * alongside `onMove` — a Move-to list with no move handler behind it is
   * exactly the shape this gate exists to prevent.
   */
  otherTables?: SeatableTable[];
  onMove?: (bookingId: string, tableId: string) => void;
  onRemove?: (bookingId: string) => void;
  /**
   * The member's own give-up-this-seat action. Unlike the organizer bundle
   * above, this is a SINGLE prop guarding a SINGLE action — there is no
   * second prop it could disagree with, so there is no "half-wired" shape
   * for it to fall into: either a caller supplies it (that seat's own
   * occupant may open the panel and leave) or it doesn't (nothing renders).
   * A boolean flag alongside it would only restate what its own presence
   * already says, so there isn't one.
   *
   * Gated per-seat on `seat.isYou`, not on any role — an organizer's own
   * seat still goes through `organizerManageable` instead (see below),
   * since Move/Remove already cover "give up your own seat" for them via
   * Remove; this prop only ever ends up driving render for a NON-organizer
   * caller's occupied seat. `onLeaveSeat` and the organizer bundle may both
   * be supplied on the same call (the event screen does, since the same
   * person can be an organizer on one game and not another) — precedence
   * between them is resolved once, per seat, by `organizerManageable ||
   * selfManageable` below.
   */
  onLeaveSeat?: (bookingId: string) => void;
  /**
   * Shared open/close plumbing for BOTH the organizer panel and the
   * member's own give-up panel above — not part of either bundle, because
   * both features need exactly the same "which one panel is open" toggle
   * and there is nothing to half-wire about sharing it: a caller missing
   * either of these gets no panel of any kind (both `organizerManageable`
   * and `selfManageable` require it), never a half-open one.
   *
   * `openBookingId` is NOT local state in this component. Only one person's
   * panel may be open across the WHOLE screen, and a screen can render many
   * tables — each its own SeatGrid instance — so that exclusivity has to be
   * owned one level up (the event screen) and handed down as a controlled
   * value, the same way `busy` already is. If this component tracked its
   * own "which seat is open" state, two different tables' SeatGrids could
   * each have a panel open at once.
   */
  openBookingId?: string | null;
  onToggleManage?: (bookingId: string) => void;
  /** Eligibility to record a round -- computed once per table by the
   *  caller (the same `canRecordRound` the event screen already computes:
   *  `gameLive && (isOrganizer || iAmSeatedHere)`), not per-seat: whichever
   *  panel a caller can already open (their own, or -- for an organizer --
   *  anyone's) is exactly who they may record a win for. */
  canRecordRound?: boolean;
  onRecordRound?: (profileId: string, points: number) => void;
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
 * `onRemove`/`otherTables` are all supplied (see `organizerManageable`
 * below) — a plain member gets back exactly the read-only `<View>` this
 * component always rendered for an occupied seat, with no Pressable, no
 * aria-* attributes, and no visible hint. That last part matters as much as
 * the access control itself: a chevron or any other affordance rendered
 * unconditionally would tell a member "this is tappable" about a seat that
 * refuses their tap, which is worse than no hint at all.
 *
 * ## A member's own seat: giving it up
 *
 * A member who holds a confirmed seat has to be able to give it up without
 * a host's help — `cancel_booking` has always accepted the seat's own
 * occupant, the database was never the gap, only the UI was (see
 * .superpowers/sdd/member-leave-seat.md). So a SECOND, narrower kind of
 * "manageable" exists alongside the organizer one: `selfManageable`, true
 * only for the one seat where `seat.isYou` and the caller supplied
 * `onLeaveSeat` (plus the shared `onToggleManage`/`openBookingId` above).
 * It opens the exact same panel shape as the organizer one — same closed
 * Pressable, same header, same `aria-expanded` — with a single action,
 * "Leave this game", instead of Move-to-… plus Remove. Wording deliberately
 * NOT "Leave the club" (WaitlistPanel's "Leave the waitlist" and this
 * screen's own "Cancel this game" are both already-established, and
 * DIFFERENT, pieces of vocabulary this needed to stay clearly apart from):
 * `cancel_booking` ends this one booking, for this one game, nothing more.
 *
 * `organizerManageable || selfManageable` is checked in that order — an
 * organizer looking at their OWN seat gets the organizer panel (Move +
 * Remove), never the member one, matching the standing decision that an
 * organizer's own seat behaves exactly like anybody else's from their seat
 * (.superpowers/sdd/seat-tap-host-controls.md, Decision 2). `onLeaveSeat`
 * being supplied on the same call as the organizer bundle is expected, not
 * a conflict: the event screen passes it whenever this member could leave
 * (mirroring `onTakeSeat`'s own `canBook` gate) regardless of whether they
 * also happen to organize; it simply never wins the branch for someone who
 * does.
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
  onMove,
  onRemove,
  onLeaveSeat,
  openBookingId,
  onToggleManage,
  canRecordRound,
  onRecordRound,
}: Props) {
  const [recordingBookingId, setRecordingBookingId] = useState<string | null>(null);
  const empties = seatsRemaining(capacity, seats.length);
  const lastSeatCall = needsFourth && empties === 1;
  const organizerManageable = Boolean(
    onToggleManage && onMove && onRemove && otherTables,
  );

  return (
    <View style={styles.grid}>
      {seats.map((seat) => {
        const displayName = seat.isYou ? 'You' : seat.name;
        // See the "A member's own seat" section of this component's
        // docstring for why these two are separate booleans rather than one
        // shared flag, and why the organizer one wins when both are true.
        const selfManageable = Boolean(
          !organizerManageable && seat.isYou && onToggleManage && onLeaveSeat,
        );
        const manageable = organizerManageable || selfManageable;

        if (!manageable) {
          return (
            <View
              key={seat.bookingId}
              style={[styles.seat, seat.isYou && styles.seatYou, styles.seatRow]}
            >
              <Text
                style={[styles.name, seat.isYou && styles.nameYou]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {displayName}
              </Text>
              <SeatBadge seat={seat} />
            </View>
          );
        }

        const isOpen = seat.bookingId === openBookingId;
        const toggle = () => {
          onToggleManage!(seat.bookingId);
          setRecordingBookingId(null);
        };
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
                <Text
                  style={[styles.name, seat.isYou && styles.nameYou]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {displayName}
                </Text>
                {/* Decorative only — the Pressable's own accessibilityLabel
                    and aria-expanded already say everything a screen reader
                    needs; this glyph is purely the sighted hint. */}
                <Text aria-hidden style={[styles.chevron, seat.isYou && styles.chevronYou]}>▾</Text>
                <SeatBadge seat={seat} />
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
                <Text
                  style={[styles.name, seat.isYou && styles.nameYou]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {displayName}
                </Text>
                <Text aria-hidden style={[styles.chevron, seat.isYou && styles.chevronYou]}>▴</Text>
                <SeatBadge seat={seat} />
              </View>
            </Pressable>

            <View style={styles.manageActions}>
              {organizerManageable ? (
                <>
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
                </>
              ) : (
                // The member's own single action — see the "A member's own
                // seat" section of this component's docstring. "Leave this
                // game" and NOT "Leave the club" or "Cancel this game":
                // this ends one booking, for this one game, nothing wider.
                <Button
                  variant="ghost"
                  big={false}
                  disabled={busy}
                  onPress={() => onLeaveSeat!(seat.bookingId)}
                  accessibilityLabel="Leave this game"
                >
                  Leave this game
                </Button>
              )}

              {canRecordRound && onRecordRound ? (
                recordingBookingId === seat.bookingId ? (
                  <View style={styles.pointsRow}>
                    {POINT_VALUES.map((value) => (
                      <Pressable
                        key={value}
                        onPress={() => {
                          onRecordRound(seat.profileId, value);
                          setRecordingBookingId(null);
                        }}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Record ${seat.name}'s win for ${value} points`}
                        style={styles.pointChip}
                      >
                        <Text style={styles.pointChipText}>{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Button
                    variant="secondary"
                    big={false}
                    disabled={busy}
                    onPress={() => setRecordingBookingId(seat.bookingId)}
                    accessibilityLabel={`Record a win for ${seat.name}`}
                  >
                    Record a win
                  </Button>
                )
              ) : null}
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
  // Read-only occupied seats have no nameRow of their own (that wrapper is
  // only used by the manageable Pressable/open-panel branches) -- this puts
  // the name and the trailing badge on the same row for that plain case.
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRound: {
    backgroundColor: colors.accentColor,
  },
  badgeStarIcon: {
    position: 'absolute',
  },
  badgeText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.bg,
  },
  badgeTextStar: {
    color: colors.accent[900],
  },
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
  // flexShrink: 1 (Yoga's own default is 0, unlike CSS flexbox) so a long
  // name shrinks to make room for the fixed-size badge/chevron that share
  // its row (nameRow, seatRow) instead of pushing them past the seat's
  // rounded background. Paired with numberOfLines/ellipsizeMode at every
  // render site below so the shrunk name truncates rather than wrapping or
  // clipping mid-glyph.
  name: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
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
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space[2],
  },
  pointsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pointChip: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
  },
  pointChipText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.bg,
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
