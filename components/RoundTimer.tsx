import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayIcon } from './icons';
import { colors, radius, type } from '../lib/theme';

const DURATIONS_MINUTES = [10, 15, 20, 30];
const DEFAULT_MINUTES = 15;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type Props = {
  /** The round this timer would pace -- "Start round 3". Omitted (e.g. a
   *  viewer not seated at any one table of a multi-table game), the copy
   *  drops the number: "Start round". */
  roundNumber?: number;
  /** Show "Tap the winner's seat to record the win." while running -- only
   *  for a viewer who can actually record one. */
  showRecordHint?: boolean;
};

/**
 * The game screen's pinned round bar, from the game-screen 2a handoff: a
 * personal pacing clock -- a countdown from a chosen duration, not a synced
 * table-wide clock. Purely local `useState`/`setInterval`: nothing here is
 * persisted, and nothing outside this component learns it exists. It resets
 * whenever the component unmounts.
 *
 * Idle: a segmented 10 / 15 / 20 / 30 min control (15 preselected) and
 * "Start round N · 15 min". Running: "Round N in progress" over the
 * countdown, Pause/Resume and "End round", and a progress bar. Pause simply
 * stops the interval; `secondsLeft` is left untouched, so Resume carries on
 * from exactly where it stopped. End round clears everything and returns to
 * the idle bar. At zero it reads "Time's up", never a negative number.
 *
 * This used to be a row of duration buttons on every table card, each
 * opening a full-screen countdown. The design moves it to one bar pinned
 * above the tab bar, with the countdown inline, so the seats stay in view
 * while a round runs.
 */
export default function RoundTimer({ roundNumber, showRecordHint = false }: Props) {
  const [selectedMinutes, setSelectedMinutes] = useState(DEFAULT_MINUTES);
  const [runningMinutes, setRunningMinutes] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  // One interval per (start, pause toggle), not one per tick -- decrementing
  // via the functional setState form keeps `secondsLeft` out of the deps.
  useEffect(() => {
    if (runningMinutes === null || paused) return;
    const id = setInterval(() => {
      setSecondsLeft((current) => {
        if (current === null || current <= 1) {
          clearInterval(id);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [runningMinutes, paused]);

  const roundLabel = roundNumber !== undefined ? `round ${roundNumber}` : 'round';
  const roundHeading = roundNumber !== undefined ? `Round ${roundNumber}` : 'Round';

  function start() {
    setRunningMinutes(selectedMinutes);
    setSecondsLeft(selectedMinutes * 60);
    setPaused(false);
  }

  function stop() {
    setRunningMinutes(null);
    setSecondsLeft(null);
    setPaused(false);
  }

  if (secondsLeft === null || runningMinutes === null) {
    return (
      <View style={styles.bar} testID="round-bar">
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {DURATIONS_MINUTES.map((minutes) => {
            const selected = minutes === selectedMinutes;
            return (
              <Pressable
                key={minutes}
                onPress={() => setSelectedMinutes(minutes)}
                accessibilityRole="radio"
                accessibilityLabel={`${minutes} minutes`}
                aria-checked={selected}
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                  {`${minutes} min`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={start}
          accessibilityRole="button"
          accessibilityLabel={`Start ${roundLabel}, ${selectedMinutes}-minute timer`}
          style={({ pressed }) => [styles.primary, pressed ? styles.primaryPressed : null]}
        >
          <PlayIcon size={14} color="#ffffff" />
          <Text style={styles.primaryText}>
            {`Start ${roundLabel} · ${selectedMinutes} min`}
          </Text>
        </Pressable>
      </View>
    );
  }

  const expired = secondsLeft === 0;
  const total = runningMinutes * 60;
  const progress = total > 0 ? (total - secondsLeft) / total : 1;

  return (
    <View style={styles.bar} testID="round-bar">
      <View style={styles.runningRow}>
        <View style={styles.runningText}>
          <Text style={styles.status}>
            {expired ? `${roundHeading} · time's up` : paused ? `${roundHeading} paused` : `${roundHeading} in progress`}
          </Text>
          <Text
            style={[styles.clock, expired ? styles.expired : null]}
            accessibilityRole="timer"
          >
            {expired ? "Time's up" : formatClock(secondsLeft)}
          </Text>
        </View>
        {expired ? null : (
          <Pressable
            onPress={() => setPaused((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume' : 'Pause'}
            style={({ pressed }) => [styles.pill, pressed ? styles.pillPressed : null]}
          >
            <Text style={styles.pillText}>{paused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel="End round"
          style={({ pressed }) => [styles.pill, pressed ? styles.pillPressed : null]}
        >
          <Text style={styles.pillText}>End round</Text>
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, progress * 100)}%` }]} />
      </View>
      {showRecordHint ? (
        <Text style={styles.hint}>Tap the winner's seat to record the win.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
    gap: 10,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
  },
  option: {
    flex: 1,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: { backgroundColor: colors.accent[700] },
  optionText: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  optionTextSelected: { color: '#ffffff' },
  primary: {
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryPressed: { backgroundColor: colors.accent[800] },
  primaryText: { fontFamily: type.bodyBold, fontSize: 16, color: '#ffffff' },
  runningRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runningText: { flex: 1, minWidth: 0 },
  status: { fontFamily: type.bodyBold, fontSize: 13, color: colors.accent2[700] },
  clock: { fontFamily: type.heading, fontSize: 30, lineHeight: 36, color: colors.text },
  expired: { color: colors.accent[700] },
  pill: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: { backgroundColor: colors.neutral[300] },
  pillText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700] },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent2[600] },
  hint: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
});
