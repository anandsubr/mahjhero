import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Card from './Card';
import SeatGrid from './SeatGrid';
import SkillTierPips from './SkillTierPips';
import Tag from './Tag';
import type { SeatOccupant, SkillTier } from '../lib/bookings';
import { seatsFreeLabel, seatsRemaining } from '../lib/bookings';
import { colors, space, type } from '../lib/theme';

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
}: Props) {
  const seated = occupants.filter((o) => o.status === 'confirmed');
  const free = seatsRemaining(table.capacity, seated.length);
  const bookedForYou = seated.find(
    (o) => o.profile_id === youId && o.booked_by !== youId,
  );

  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.label}>{table.label}</Text>
        {needsFourth ? <Tag>Needs a 4th</Tag> : null}
      </View>
      {/*
        Pips plus the word, deliberately -- the human's design left this
        choice to judgement, and the safe default was kept: this is a
        member's read-only view of a table's tier, not the host's four-row
        control that pips exist to compact, so there is no height pressure
        here to justify dropping the word. `SkillTierPips` itself is
        `aria-hidden` (see its docstring), so the word is what actually
        carries the meaning for a screen reader.
      */}
      <View style={styles.tierRow}>
        <SkillTierPips tier={table.skill_tier} />
        <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>
      </View>

      <SeatGrid
        tableLabel={table.label}
        capacity={table.capacity}
        seats={seated.map((o) => ({
          bookingId: o.booking_id,
          name: o.display_name,
          isYou: o.profile_id === youId,
        }))}
        onTakeSeat={onTakeSeat}
        busy={busy}
        needsFourth={needsFourth}
      />

      <Text style={styles.free}>{seatsFreeLabel(free)}</Text>

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
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  // 16 is the ONLY sanctioned size below 18, and only for helper text.
  tier: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  free: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accent2Color,
    marginTop: space[2],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[1],
  },
});
