import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { TrophyIcon } from './icons';
import { colors, layout, radius, shadow, type } from '../lib/theme';

/** The plan's hard rule: these seven values, everywhere, no others. */
export const POINT_VALUES = [25, 30, 35, 40, 45, 50, 75] as const;

type Props = {
  /** Heading name. Null only for an invited seat the viewer may not name. */
  name: string | null;
  /** The accessible name used in every action label ("Remove X from this game"). */
  labelName: string;
  avatarColor: string;
  /** "25 pts · Table 1" -- built by the caller, which knows whether points apply. */
  detail: string;
  busy: boolean;
  onClose: () => void;
  /** Present only while this viewer may record a win for this seat. */
  record?: { roundNumber: number; onRecord: (points: number) => void };
  /** Organizer: one "Move to …" per other table. */
  moves?: { id: string; label: string; onPress: () => void }[];
  /** Organizer: take this person out of the game. */
  onRemove?: () => void;
  /** The viewer's own seat, when they are not organizing. */
  onLeave?: () => void;
  /** An invited seat's one action. */
  onWithdraw?: () => void;
};

/**
 * The player action sheet from the game-screen 2a handoff: tapping a filled
 * seat opens this over a scrim instead of expanding the seat in place. It
 * carries exactly the actions the old in-place panel did -- record a win,
 * move to another table, remove from the game, leave this game, withdraw an
 * invite -- each still gated by its caller (components/SeatGrid.tsx), which
 * passes a handler only when that action is allowed.
 *
 * Recording is now two taps, per the design: pick a value, then confirm with
 * "Record N pts for round R". The primary button stays disabled, reading
 * "Choose points", until a value is picked.
 */
export default function SeatSheet({
  name,
  labelName,
  avatarColor,
  detail,
  busy,
  onClose,
  record,
  moves,
  onRemove,
  onLeave,
  onWithdraw,
}: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="seat-sheet-scrim"
        />
        <View style={styles.sheet} testID="seat-sheet">
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {name ?? 'Invited'}
              </Text>
              {detail ? <Text style={styles.detail}>{detail}</Text> : null}
            </View>
          </View>

          {record ? (
            <>
              <Text style={styles.section}>{`Winner of round ${record.roundNumber}`}</Text>
              <View style={styles.pointsGrid}>
                {POINT_VALUES.map((value) => {
                  const selected = picked === value;
                  return (
                    <View key={value} style={styles.chipCell}>
                      <Pressable
                        onPress={() => setPicked(value)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${value} points`}
                        aria-selected={selected}
                        style={[styles.chip, selected ? styles.chipSelected : null]}
                      >
                        <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                          {value}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              <Pressable
                onPress={picked === null ? undefined : () => record.onRecord(picked)}
                disabled={busy || picked === null}
                accessibilityRole="button"
                accessibilityLabel={
                  picked === null
                    ? 'Choose points'
                    : `Record ${labelName}'s win for ${picked} points`
                }
                style={[styles.primary, picked === null ? styles.primaryDisabled : null]}
              >
                {picked !== null ? <TrophyIcon size={18} color="#ffffff" /> : null}
                <Text style={styles.primaryText}>
                  {picked === null
                    ? 'Choose points'
                    : `Record ${picked} pts for round ${record.roundNumber}`}
                </Text>
              </Pressable>
            </>
          ) : null}

          {moves?.map((move) => (
            <SecondaryAction
              key={move.id}
              label={`Move to ${move.label}`}
              accessibilityLabel={`Move ${labelName} to ${move.label}`}
              busy={busy}
              onPress={move.onPress}
            />
          ))}
          {onRemove ? (
            <SecondaryAction
              label="Remove from game"
              accessibilityLabel={`Remove ${labelName} from this game`}
              busy={busy}
              onPress={onRemove}
            />
          ) : null}
          {onLeave ? (
            <SecondaryAction
              label="Leave this game"
              accessibilityLabel="Leave this game"
              busy={busy}
              onPress={onLeave}
            />
          ) : null}
          {onWithdraw ? (
            <SecondaryAction
              label="Withdraw invite"
              accessibilityLabel={`Withdraw the invite to ${labelName}`}
              busy={busy}
              onPress={onWithdraw}
            />
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SecondaryAction({
  label,
  accessibilityLabel,
  busy,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.secondary,
        pressed && !busy ? styles.secondaryPressed : null,
        busy ? styles.dimmed : null,
      ]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // neutral-900 at 40%.
    backgroundColor: 'rgba(46, 43, 37, 0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 10,
    ...shadow.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral[400],
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.bodyBold, fontSize: 19, color: '#ffffff' },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontFamily: type.heading, fontSize: 22, lineHeight: 26, color: colors.text },
  detail: {
    fontFamily: type.bodyRegular,
    fontSize: 14,
    color: colors.neutral[700],
    marginTop: 2,
  },
  section: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  // Four fixed columns: each cell is a quarter of the row, with half the
  // 8pt gap as padding on either side (the grid's negative margin takes the
  // outer halves back), so a short last row keeps the same column widths.
  pointsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 8 },
  chipCell: { width: '25%', paddingHorizontal: 4 },
  chip: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.accent[700] },
  chipText: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  chipTextSelected: { color: '#ffffff' },
  primary: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  primaryDisabled: { backgroundColor: colors.neutral[400] },
  primaryText: { fontFamily: type.bodyBold, fontSize: 16, color: '#ffffff' },
  secondary: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryPressed: { backgroundColor: colors.neutral[300] },
  dimmed: { opacity: 0.5 },
  secondaryText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
  cancel: { height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.neutral[700] },
});
