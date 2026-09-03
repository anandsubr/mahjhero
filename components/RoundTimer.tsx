import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { colors, space, type } from '../lib/theme';

const DURATIONS_MINUTES = [10, 15, 20, 30];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * A personal, per-table pacing clock -- confirmed during brainstorming to
 * be a countdown from a chosen duration, not a synced table-wide clock.
 * Purely local `useState`/`setInterval`: nothing here is persisted, and
 * nothing outside this component ever learns it exists. Resets on its own
 * whenever the component unmounts (a table's card leaving the screen), and
 * takes no props but `tableLabel`, used only to build each duration
 * option's accessibility label.
 */
export default function RoundTimer({ tableLabel }: { tableLabel: string }) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // One interval per `durationMinutes` change (start or reset), not one
  // per tick -- decrementing via the functional setState form below means
  // this effect does not need `secondsLeft` in its own dependency array.
  useEffect(() => {
    if (durationMinutes === null) return;
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
  }, [durationMinutes]);

  function start(minutes: number) {
    setDurationMinutes(minutes);
    setSecondsLeft(minutes * 60);
  }

  function reset() {
    setDurationMinutes(null);
    setSecondsLeft(null);
  }

  if (secondsLeft === null) {
    return (
      <View style={styles.row}>
        {DURATIONS_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            variant="secondary"
            big={false}
            onPress={() => start(minutes)}
            accessibilityLabel={`Start a ${minutes}-minute timer for ${tableLabel}`}
          >
            {`${minutes} min`}
          </Button>
        ))}
      </View>
    );
  }

  const expired = secondsLeft === 0;

  return (
    <>
      <View style={styles.row}>
        <Pressable
          onPress={expired ? undefined : () => setOverlayOpen(true)}
          accessibilityRole={expired ? undefined : 'button'}
          accessibilityLabel={expired ? undefined : 'Show the timer full-screen'}
        >
          <Text style={[styles.clock, expired ? styles.expired : null]}>
            {expired ? "Time's up" : formatClock(secondsLeft)}
          </Text>
        </Pressable>
        <Button
          variant="ghost"
          big={false}
          onPress={reset}
          accessibilityLabel={expired ? 'Reset timer' : 'Stop timer'}
        >
          {expired ? 'Reset timer' : 'Stop timer'}
        </Button>
      </View>
      {overlayOpen ? (
        <Modal
          visible
          animationType="fade"
          onRequestClose={() => setOverlayOpen(false)}
        >
          <View style={styles.overlay} testID="timer-overlay">
            <Text style={[styles.overlayClock, expired ? styles.expired : null]}>
              {expired ? "Time's up" : formatClock(secondsLeft)}
            </Text>
            <Button
              variant="secondary"
              onPress={() => setOverlayOpen(false)}
              accessibilityLabel="Close"
            >
              Close
            </Button>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  clock: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  expired: {
    color: colors.accent[700],
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[6],
  },
  overlayClock: {
    fontFamily: type.heading,
    // 96 is intentionally hardcoded, not a lib/theme.ts token -- the
    // largest token, type.size.display, tops out at 50, and this codebase
    // already has an established, accepted pattern of hardcoding one-off
    // large display sizes beyond that ceiling (see DateTile.tsx,
    // DashboardHeader.tsx) rather than growing the shared scale for a
    // single full-screen use.
    fontSize: 96,
    color: colors.text,
  },
});
