import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RoundLog, { type DisplayRound } from './RoundLog';
import SeatGrid, { seatColor } from './SeatGrid';
import Tag from './Tag';
import type { SeatOccupant, SkillTier } from '../lib/bookings';
import { roundTotals } from '../lib/rounds';
import { colors, type } from '../lib/theme';

/** Only what SeatGrid's "Move to {table}" buttons need — not the full EventTable. */
type SeatableTable = { id: string; label: string };

const TIER_LABELS: Record<SkillTier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Any level',
};

type Props = {
  table: { id: string; label: string; skill_tier: SkillTier; capacity: number };
  occupants: SeatOccupant[];
  youId: string;
  onTakeSeat?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
  /** Organizer controls, injected by the event screen. */
  children?: ReactNode;
  /**
   * Seat management, forwarded straight through to SeatGrid — see that
   * component's own docstring for the full contract. `otherTables`/`onMove`/
   * `onRemove` are the organizer bundle, supplied together by an organizer
   * caller (the event screen) and omitted together for a member, exactly
   * like `onTakeSeat` above. `onLeaveSeat` is the separate, single-prop
   * member capability (give up YOUR OWN seat) — independent of the
   * organizer bundle, and may be supplied alongside it. `openBookingId`/
   * `onToggleManage` are the shared open/close plumbing both features use.
   */
  otherTables?: SeatableTable[];
  onMove?: (bookingId: string, tableId: string) => void;
  onRemove?: (bookingId: string) => void;
  onLeaveSeat?: (bookingId: string) => void;
  openBookingId?: string | null;
  onToggleManage?: (bookingId: string) => void;
  /** Organizer on this game -- may withdraw any held invite here. */
  isOrganizer?: boolean;
  /** Supplied while invites can still be withdrawn (the event screen's
   *  canBook). A held seat offers it to an organizer, or to the seat's
   *  own sender (`booked_by`). */
  onWithdrawInvite?: (bookingId: string) => void;
  /**
   * Round recording -- omitted entirely (not merely gated false) hides the
   * whole section, matching `otherTables`/`onMove`/`onRemove`'s own
   * all-or-nothing bundle above. Supplied by the event screen with rounds
   * already joined against the roster for display names (see RoundLog's
   * own docstring for why TableCard never resolves ids to names itself).
   */
  rounds?: DisplayRound[];
  canRecordRound?: boolean;
  canDeleteRound?: boolean;
  onRecordRound?: (winnerProfileId: string, points: number) => void;
  onDeleteRound?: (roundId: string) => void;
  /** Gates the round log (and the seats' points lines) to the game's
   *  actual start/end window — gone before kickoff and after the game
   *  ends. Defaults to `true` so every caller that doesn't pass it (in
   *  particular this component's own existing tests) keeps today's
   *  behavior unchanged. The round timer no longer lives on the card: it
   *  is the event screen's pinned round bar (components/RoundTimer.tsx). */
  gameLive?: boolean;
};

/**
 * One table: who is at it, how many seats are left, and the one way in --
 * drawn as the game-screen 2a handoff's table card: "Table 1" with its level
 * tag and "3/4 seated", the two-column seat grid, and the table's rounds
 * under a hairline.
 *
 * Tapping an empty seat books YOU, immediately — the common case is one
 * tap. Everything else on this card is read-only.
 *
 * This card used to also carry its own "Bring someone" button, opening
 * BringSomeoneSheet pre-selected to this table. The human removed it: the
 * sheet already asks "Where?" with every table plus "Any table", so the
 * per-table button only pre-selected a chip the member could change in the
 * next breath — and it vanished once a table had one seat or fewer free,
 * disappearing one by one on a busy game with no explanation. The
 * screen-level "Bring someone" (app/clubs/[id]/events/[eventId]/index.tsx)
 * is the only entry point now.
 */
export default function TableCard({
  table,
  occupants,
  youId,
  onTakeSeat,
  busy = false,
  needsFourth = false,
  children,
  otherTables,
  onMove,
  onRemove,
  onLeaveSeat,
  openBookingId,
  onToggleManage,
  isOrganizer = false,
  onWithdrawInvite,
  rounds,
  canRecordRound = false,
  canDeleteRound = false,
  onRecordRound,
  onDeleteRound,
  gameLive = true,
}: Props) {
  const seated = occupants.filter((o) => o.status === 'confirmed');
  // Held seats draw on the grid too, after the confirmed ones: taken, but
  // the invitee has not said yes yet. An invite that holds no seat never
  // has a table, so it never reaches this card.
  const held = occupants.filter((o) => o.status === 'invited');
  const bookedForYou = seated.find(
    (o) => o.profile_id === youId && o.booked_by !== youId,
  );

  const totals = rounds ? roundTotals(rounds) : [];
  const totalsByProfile = new Map(totals.map((t) => [t.profileId, t.points]));
  // Rounds arrive newest first, so the head is the last round played.
  const lastWinner = rounds && rounds.length > 0 ? rounds[0].winner_profile_id : null;
  // Points lines only while scoring is in play, the same window RoundLog
  // itself renders in.
  const showPoints = Boolean(rounds) && gameLive;
  const seatedCount = seated.length + held.length;

  // The seat's own colour follows its position in the grid (confirmed
  // first, as SeatGrid draws them), so a round's winner is drawn in the
  // same colour in the log below.
  const colorByProfile = new Map(
    seated.map((o, index) => [o.profile_id ?? '', seatColor(index)]),
  );

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{table.label}</Text>
          {/*
            The tier as a tag -- the word alone, which is what a screen
            reader has always read here (SkillTierPips was aria-hidden).
          */}
          <Tag variant="accent2" size="small">{TIER_LABELS[table.skill_tier]}</Tag>
          {needsFourth ? <Tag size="small">Needs a 4th</Tag> : null}
        </View>
        <Text style={styles.count}>{`${seatedCount}/${table.capacity} seated`}</Text>
      </View>

      <SeatGrid
        tableLabel={table.label}
        capacity={table.capacity}
        seats={[
          ...seated.map((o) => ({
            bookingId: o.booking_id,
            profileId: o.profile_id ?? '',
            name: o.display_name,
            isYou: o.profile_id === youId,
            points: showPoints
              ? (o.profile_id ? (totalsByProfile.get(o.profile_id) ?? 0) : 0)
              : null,
            wonLastRound:
              showPoints && lastWinner !== null && o.profile_id === lastWinner,
          })),
          ...held.map((o) => ({
            bookingId: o.booking_id,
            profileId: o.profile_id ?? '',
            // null for an invitee this viewer may not see: "Invited".
            name: o.display_name,
            isYou: o.profile_id !== null && o.profile_id === youId,
            invited: true,
            canWithdraw:
              Boolean(onWithdrawInvite) && (isOrganizer || o.booked_by === youId),
          })),
        ]}
        onTakeSeat={onTakeSeat}
        busy={busy}
        needsFourth={needsFourth}
        otherTables={otherTables}
        onMove={onMove}
        onRemove={onRemove}
        onLeaveSeat={onLeaveSeat}
        openBookingId={openBookingId}
        onToggleManage={onToggleManage}
        canRecordRound={canRecordRound}
        onRecordRound={onRecordRound}
        nextRoundNumber={(rounds?.length ?? 0) + 1}
        onWithdrawInvite={onWithdrawInvite}
      />

      {rounds && gameLive ? (
        <>
          <View style={styles.divider} />
          <RoundLog
            rounds={rounds}
            colorFor={(profileId) => colorByProfile.get(profileId) ?? colors.neutral[800]}
            canDelete={canDeleteRound}
            busy={busy}
            onDelete={(roundId) => onDeleteRound?.(roundId)}
          />
        </>
      ) : null}

      {bookedForYou ? (
        <Text style={styles.help}>
          {bookedForYou.booked_by_name} booked this for you
        </Text>
      ) : null}

      {children ? <View style={styles.children}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 16,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  label: {
    fontFamily: type.heading,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  },
  count: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    color: colors.neutral[700],
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: 14,
    color: colors.textMuted,
  },
  children: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
