import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import SeatGrid from './SeatGrid';
import Tag from './Tag';
import type { SeatOccupant, SkillTier } from '../lib/bookings';
import { seatsRemaining } from '../lib/bookings';
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
  onBringSomeone?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
  /** Organizer controls, injected by the event screen. */
  children?: ReactNode;
};

/**
 * One table: who is at it, how many seats are left, and the two ways in.
 *
 * Tapping an empty seat books YOU, immediately — the common case is one
 * tap. "Bring someone" is the quieter control that opens the group sheet.
 * Everything else on this card is read-only.
 */
export default function TableCard({
  table,
  occupants,
  youId,
  onTakeSeat,
  onBringSomeone,
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
      <Text style={styles.tier}>{TIER_LABELS[table.skill_tier]}</Text>

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

      <Text style={styles.free}>
        {free} {free === 1 ? 'seat' : 'seats'} free
      </Text>

      {bookedForYou ? (
        <Text style={styles.help}>
          {bookedForYou.booked_by_name} booked this for you
        </Text>
      ) : null}

      {onBringSomeone && free > 1 ? (
        <Button
          variant="secondary"
          big={false}
          disabled={busy}
          onPress={onBringSomeone}
          accessibilityLabel={`Bring someone to ${table.label}`}
        >
          Bring someone
        </Button>
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
