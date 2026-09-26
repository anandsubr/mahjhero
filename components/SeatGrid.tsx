import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import SeatSheet from './SeatSheet';
import { ChevronDownIcon, PlusIcon, TrophyIcon } from './icons';
import { seatsRemaining } from '../lib/bookings';
import { colors, radius, type } from '../lib/theme';

/**
 * Per-seat avatar colours from the game-screen 2a handoff, in seat order.
 * Exported so TableCard can colour a round's winner the same as their seat.
 */
export const SEAT_COLORS = [
  colors.accent2[700],
  colors.accent[700],
  colors.neutral[800],
  colors.accent2[800],
] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[((index % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

export type Seat = {
  bookingId: string;
  /** Needed for `onRecordRound` -- record_round takes a winner's profile
   *  id, not a booking id. */
  profileId: string;
  /** Null only for an invited seat the viewer may not see the name of
   *  (event_seating hides invite-only invitees from everyone but
   *  organizers, the sender and the invitee). */
  name: string | null;
  isYou: boolean;
  /** This seat's running point total at this table. `null`/omitted draws no
   *  points line at all (scoring not in play); 0 draws "0 pts". TableCard
   *  decides which. */
  points?: number | null;
  /** Won the table's most recent round: draws the trophy badge on the
   *  avatar. Optional, defaulting to false. */
  wonLastRound?: boolean;
  /** A pending game invite holding this seat ('invited' booking). Drawn
   *  dashed with an "Invited" tag; never offered Move / Remove / Leave /
   *  Record -- none of those apply until the invitee accepts, and
   *  place_booking refuses invited rows. */
  invited?: boolean;
  /** Invited seats only: this viewer may withdraw it (an organizer, or the
   *  sender). Computed by the caller (TableCard). */
  canWithdraw?: boolean;
};

/** Only what a "Move to {table}" action needs — not the full EventTable. */
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
   * read-only render.
   */
  otherTables?: SeatableTable[];
  onMove?: (bookingId: string, tableId: string) => void;
  onRemove?: (bookingId: string) => void;
  /**
   * The member's own give-up-this-seat action. A SINGLE prop guarding a
   * SINGLE action: either a caller supplies it (that seat's own occupant may
   * open the sheet and leave) or it doesn't (that action alone doesn't
   * render -- the sheet itself may still open via `canRecordRound`/
   * `onRecordRound`; see `selfManageable`).
   */
  onLeaveSeat?: (bookingId: string) => void;
  /**
   * Shared open/close plumbing for every kind of seat sheet. NOT local
   * state: only one person's sheet may be open across the WHOLE screen, and
   * a screen renders one SeatGrid per table, so that exclusivity is owned
   * one level up (the event screen) and handed down as a controlled value.
   */
  openBookingId?: string | null;
  onToggleManage?: (bookingId: string) => void;
  /** Eligibility to record a round -- computed once per table by the
   *  caller (`gameLive && (isOrganizer || iAmSeatedHere)`). `canBook`
   *  (which gates `onLeaveSeat`) and `gameLive` (which gates this) are
   *  mutually exclusive on the event screen, so the sheet has to open on
   *  either one alone. */
  canRecordRound?: boolean;
  onRecordRound?: (profileId: string, points: number) => void;
  /** The round a win recorded now would be -- "Winner of round 3". */
  nextRoundNumber?: number;
  /** Withdraw a held invite. An invited seat opens a sheet only when it
   *  has `canWithdraw`, this handler, and `onToggleManage`. */
  onWithdrawInvite?: (bookingId: string) => void;
};

/**
 * One table's seats, as the game-screen 2a handoff draws them: a two-column
 * grid of 56pt tiles, each a filled seat (avatar, name, points line) or an
 * empty dashed one.
 *
 * Occupied seats are drawn in the order they are given, then the remainder
 * are drawn empty. Nothing here numbers a seat, and nothing may -- the 2a
 * design's "+ Seat 4" included: the schema COUNTS seats, and a UI that
 * implies Table 2 seat 3 is a durable place teaches members to expect
 * something the data cannot promise. Empty seats keep their "Empty" / "Last
 * seat" wording.
 *
 * Empty count floors at zero (via lib/bookings' `seatsRemaining`). A table
 * can hold more people than it seats after a host removes another table.
 *
 * ## Tapping a seat
 *
 * A filled seat is tappable only when there is something the viewer can do
 * to it; it then opens components/SeatSheet.tsx, a bottom sheet, carrying
 * THAT person's actions. Two kinds of "manageable":
 *
 * - `organizerManageable`: the full organizer bundle was supplied. Any seat
 *   opens the sheet with Move to … per other table, Remove from game, and --
 *   during a live game -- the win recorder.
 * - `selfManageable`: the viewer's own seat, when the organizer bundle was
 *   not supplied, and either `onLeaveSeat` or `canRecordRound`+
 *   `onRecordRound` was. Leaving is legal only before kickoff and recording
 *   only during a live game, so the sheet opens on either alone and each
 *   action renders independently inside it. "Leave this game", never "Leave
 *   the club" or "Cancel this game": `cancel_booking` ends one booking, for
 *   one game.
 *
 * An organizer looking at their OWN seat gets the organizer sheet (Remove,
 * not Leave), matching the standing decision that an organizer's seat
 * behaves like anybody else's from their seat
 * (.superpowers/sdd/seat-tap-host-controls.md, Decision 2).
 *
 * A seat with nothing on offer renders as a plain View -- no Pressable, no
 * aria-*, no chevron. A chevron on a seat that refuses the tap would be
 * worse than no hint at all.
 *
 * `aria-expanded`/`aria-disabled` are sent as flat props, not via
 * `accessibilityState` -- react-native-web's createDOMProps ignores the
 * latter (see Toggle.tsx). On the empty seat's Pressable it is the
 * `disabled` prop that is actually load-bearing for `aria-disabled`: RN
 * Web's Pressable overwrites a caller's own value from it.
 *
 * ## Held seats (game invites)
 *
 * A seat with `invited: true` is a pending invite holding it. Its only
 * possible action is Withdraw invite, so it never reaches Move / Remove /
 * Leave / Record.
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
  nextRoundNumber = 1,
  onWithdrawInvite,
}: Props) {
  const empties = seatsRemaining(capacity, seats.length);
  const lastSeatCall = needsFourth && empties === 1;
  const organizerManageable = Boolean(
    onToggleManage && onMove && onRemove && otherTables,
  );

  let sheet: ReactNode = null;

  const tiles = seats.map((seat, index) => {
    const avatarColor = seatColor(index);
    const isOpen = seat.bookingId === openBookingId;
    const close = () => onToggleManage?.(seat.bookingId);

    if (seat.invited) {
      const manageable = Boolean(seat.canWithdraw && onWithdrawInvite && onToggleManage);
      if (manageable && isOpen) {
        sheet = (
          <SeatSheet
            name={seat.isYou ? seat.name ?? 'You' : seat.name}
            labelName={seat.name ?? 'this seat'}
            avatarColor={colors.neutral[600]}
            detail={`Invited · ${tableLabel}`}
            busy={busy}
            onClose={close}
            onWithdraw={() => onWithdrawInvite!(seat.bookingId)}
          />
        );
      }
      return (
        <InvitedSeat
          key={seat.bookingId}
          seat={seat}
          busy={busy}
          open={isOpen}
          onPress={manageable ? close : undefined}
        />
      );
    }

    const selfManageable = Boolean(
      !organizerManageable &&
        seat.isYou &&
        onToggleManage &&
        (onLeaveSeat || (canRecordRound && onRecordRound)),
    );
    const manageable = organizerManageable || selfManageable;

    if (manageable && isOpen) {
      const points = seat.points ?? null;
      sheet = (
        <SeatSheet
          name={seat.name}
          labelName={seat.name ?? 'this player'}
          avatarColor={avatarColor}
          detail={[points !== null ? `${points} pts` : null, tableLabel]
            .filter(Boolean)
            .join(' · ')}
          busy={busy}
          onClose={close}
          record={
            canRecordRound && onRecordRound
              ? {
                  roundNumber: nextRoundNumber,
                  onRecord: (value) => onRecordRound(seat.profileId, value),
                }
              : undefined
          }
          moves={
            organizerManageable
              ? otherTables!.map((t) => ({
                  id: t.id,
                  label: t.label,
                  onPress: () => onMove!(seat.bookingId, t.id),
                }))
              : undefined
          }
          onRemove={organizerManageable ? () => onRemove!(seat.bookingId) : undefined}
          onLeave={
            !organizerManageable && onLeaveSeat
              ? () => onLeaveSeat(seat.bookingId)
              : undefined
          }
        />
      );
    }

    const body = (
      <>
        <Avatar name={seat.name} color={avatarColor} trophy={seat.wonLastRound} bookingId={seat.bookingId} />
        <View style={styles.seatText}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {seat.name ?? (seat.isYou ? 'You' : '')}
          </Text>
          <SecondaryLine seat={seat} />
        </View>
      </>
    );

    if (!manageable) {
      return (
        <View key={seat.bookingId} style={[styles.seat, styles.filled]}>
          {body}
        </View>
      );
    }

    return (
      <Pressable
        key={seat.bookingId}
        style={[styles.seat, styles.filled, isOpen ? styles.selected : null]}
        onPress={busy ? undefined : () => onToggleManage!(seat.bookingId)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Manage ${seat.name}'s seat`}
        aria-expanded={isOpen}
      >
        {body}
        {/* Decorative -- the label and aria-expanded carry the meaning. */}
        <View aria-hidden>
          <ChevronDownIcon size={16} color={colors.neutral[600]} />
        </View>
      </Pressable>
    );
  });

  return (
    <View style={styles.grid}>
      {tiles}

      {Array.from({ length: empties }, (_, index) => (
        <Pressable
          key={`empty-${index}`}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.seat,
            styles.empty,
            lastSeatCall || ((hovered || pressed) && onTakeSeat && !busy) ? styles.calling : null,
          ]}
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
          {onTakeSeat ? (
            <PlusIcon size={14} color={lastSeatCall ? colors.accent[700] : colors.neutral[700]} />
          ) : null}
          {/*
           * Deliberately NOT the string "Needs a 4th" — TableCard already
           * shows that exact text once, as a Tag next to the table label.
           * Repeating it here would give `getByText('Needs a 4th')` two
           * matches, and a screen reader two identical elements.
           */}
          <Text style={[styles.emptyText, lastSeatCall && styles.callingText]}>
            {lastSeatCall ? 'Last seat' : 'Empty'}
          </Text>
        </Pressable>
      ))}

      {sheet}
    </View>
  );
}

function Avatar({
  name,
  color,
  trophy,
  bookingId,
}: {
  name: string | null;
  color: string;
  trophy?: boolean;
  bookingId: string;
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.avatar, { backgroundColor: color }]}>
      <Text style={styles.avatarText}>{initial}</Text>
      {trophy ? (
        <View
          style={styles.trophyBadge}
          testID={`badge-winner-${bookingId}`}
          accessibilityLabel="Won the last round"
        >
          <TrophyIcon size={10} color="#ffffff" />
        </View>
      ) : null}
    </View>
  );
}

function SecondaryLine({ seat }: { seat: Seat }) {
  const points = seat.points ?? null;
  const parts = [seat.isYou ? 'You' : null, points !== null ? `${points} pts` : null].filter(
    Boolean,
  );
  if (parts.length === 0) return null;
  return (
    <Text style={styles.secondary} numberOfLines={1}>
      {parts.join(' · ')}
    </Text>
  );
}

/**
 * A seat held for a pending game invite: taken (it counts toward the grid's
 * filled seats), but not by someone who has said yes. Dashed, the invitee's
 * name plus an "Invited" tag -- or, when the viewer may not see who, the
 * single word "Invited".
 */
function InvitedSeat({
  seat,
  busy,
  open,
  onPress,
}: {
  seat: Seat;
  busy: boolean;
  open: boolean;
  onPress?: () => void;
}) {
  const shownName = seat.isYou ? 'You' : seat.name;
  const content = (
    <>
      <View style={styles.seatText}>
        <Text style={[styles.name, styles.nameInvited]} numberOfLines={1} ellipsizeMode="tail">
          {shownName ?? 'Invited'}
        </Text>
        {/* A named held seat carries its own tag; an anonymous one already
            reads "Invited" as its name, so no second copy. */}
        {shownName !== null ? <Text style={styles.secondary}>Invited</Text> : null}
      </View>
      {onPress ? (
        <View aria-hidden>
          <ChevronDownIcon size={16} color={colors.neutral[600]} />
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.seat, styles.invited]}>{content}</View>;
  }
  return (
    <Pressable
      style={[styles.seat, styles.invited, open ? styles.selected : null]}
      onPress={busy ? undefined : onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Manage the invite for ${seat.name ?? 'this seat'}`}
      aria-expanded={open}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  seat: {
    flexGrow: 1,
    flexBasis: '44%',
    // Two to a row: never let one long name widen its column.
    maxWidth: '50%',
    minWidth: 0,
    height: 56,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filled: {
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingRight: 10,
  },
  selected: {
    borderWidth: 2,
    borderColor: colors.accent[500],
  },
  invited: {
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[600],
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.bodyBold, fontSize: 13, color: '#ffffff' },
  trophyBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[500],
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexShrink/minWidth so a long name ellipsizes instead of pushing the
  // chevron past the tile's rounded edge (Yoga's flexShrink defaults to 0).
  seatText: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: 15,
    lineHeight: 19,
    color: colors.text,
  },
  nameInvited: { color: colors.textMuted, fontStyle: 'italic' },
  secondary: {
    fontFamily: type.bodyRegular,
    fontSize: 12,
    lineHeight: 15,
    color: colors.neutral[700],
  },
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    justifyContent: 'center',
    gap: 6,
  },
  calling: { borderColor: colors.accent[500] },
  emptyText: {
    fontFamily: type.bodySemiBold,
    fontSize: 14,
    color: colors.neutral[700],
  },
  callingText: { color: colors.accent[700] },
});
