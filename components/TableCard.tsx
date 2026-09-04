import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Card from './Card';
import RoundLog, { type DisplayRound } from './RoundLog';
import RoundTimer from './RoundTimer';
import SeatGrid from './SeatGrid';
import SkillTierPips from './SkillTierPips';
import Tag from './Tag';
import type { SeatOccupant, SkillTier } from '../lib/bookings';
import { roundTotals } from '../lib/rounds';
import { colors, space, type } from '../lib/theme';

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
  /** Gates the round log and the round timer to the game's actual
   *  start/end window — both disappear entirely before kickoff and after
   *  the game ends, rather than staying visible the whole time. Defaults
   *  to `true` so every caller that doesn't pass it (in particular this
   *  component's own existing tests) keeps today's behavior unchanged. */
  gameLive?: boolean;
};

/**
 * One table: who is at it, how many seats are left, and the one way in.
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
  rounds,
  canRecordRound = false,
  canDeleteRound = false,
  onRecordRound,
  onDeleteRound,
  gameLive = true,
}: Props) {
  const seated = occupants.filter((o) => o.status === 'confirmed');
  const bookedForYou = seated.find(
    (o) => o.profile_id === youId && o.booked_by !== youId,
  );

  const totals = rounds ? roundTotals(rounds) : [];
  const totalsByProfile = new Map(totals.map((t) => [t.profileId, t.points]));
  const maxPoints = totals.length > 0 ? Math.max(...totals.map((t) => t.points)) : null;

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{table.label}</Text>
          {/*
            Pips plus the word, deliberately -- the human's design left this
            choice to judgement, and the safe default was kept: this is a
            member's read-only view of a table's tier, not the host's four-row
            control that pips exist to compact, so there is no height pressure
            here to justify dropping the word. `SkillTierPips` itself is
            `aria-hidden` (see its docstring), so the word is what actually
            carries the meaning for a screen reader.
          */}
          <SkillTierPips tier={table.skill_tier} />
          <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>
        </View>
        {needsFourth ? <Tag>Needs a 4th</Tag> : null}
      </View>

      <SeatGrid
        tableLabel={table.label}
        capacity={table.capacity}
        seats={seated.map((o) => {
          const points = totalsByProfile.get(o.profile_id) ?? null;
          return {
            bookingId: o.booking_id,
            profileId: o.profile_id,
            name: o.display_name,
            isYou: o.profile_id === youId,
            points,
            isLeader: points !== null && points === maxPoints,
          };
        })}
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
      />

      {rounds && gameLive ? (
        <RoundLog
          rounds={rounds}
          canDelete={canDeleteRound}
          busy={busy}
          onDelete={(roundId) => onDeleteRound?.(roundId)}
        />
      ) : null}

      {/*
        RoundTimer is pure local UI state with no dependence on whether the
        rounds fetch succeeded -- it stays available even when `rounds` is
        undefined (a transient fetch failure), unlike RoundLog above which
        genuinely needs `rounds` data to render. It IS gated on `gameLive`
        though -- a pacing clock has no reason to exist before the game
        starts or after it ends.
      */}
      {gameLive ? <RoundTimer tableLabel={table.label} /> : null}

      {bookedForYou ? (
        <Text style={styles.help}>
          {bookedForYou.booked_by_name} booked this for you
        </Text>
      ) : null}

      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexShrink: 1,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  // 16 is the ONLY sanctioned size below 18, and only for helper text.
  tier: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[1],
  },
});
