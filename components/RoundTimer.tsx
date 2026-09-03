import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
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
 * takes no props but `tableLabel`, used only to build the duration-picker
 * buttons' accessibility labels.
 *
 * Picking a duration goes straight to a full-screen countdown -- there is
 * no smaller inline state once started, only the picker (nothing running)
 * or the overlay (something running, paused, or expired). Pause simply
 * stops the interval from running; `secondsLeft` itself is left untouched,
 * so Resume picks the countdown back up from exactly where it left off,
 * not from a stored snapshot. Stop clears everything and returns to the
 * duration picker -- the timer goes away, it doesn't just hide. Escape/the
 * hardware back button (`onRequestClose`) does the same thing as Stop:
 * once full-screen is the only way to see or control the timer at all,
 * "close" can only sensibly mean "stop" -- there's no smaller view left to
 * fall back to.
 */
export default function RoundTimer({ tableLabel }: { tableLabel: string }) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  // One interval per (duration change, pause toggle), not one per tick --
  // decrementing via the functional setState form below means this effect
  // does not need `secondsLeft` in its own dependency array.
  useEffect(() => {
    if (durationMinutes === null || paused) return;
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
  }, [durationMinutes, paused]);

  function start(minutes: number) {
    setDurationMinutes(minutes);
    setSecondsLeft(minutes * 60);
    setPaused(false);
  }

  function stop() {
    setDurationMinutes(null);
    setSecondsLeft(null);
    setPaused(false);
  }

  function togglePause() {
    setPaused((current) => !current);
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
    <Modal visible animationType="fade" onRequestClose={stop}>
      <View style={styles.overlay} testID="timer-overlay">
        <Text style={[styles.overlayClock, expired ? styles.expired : null]}>
          {expired ? "Time's up" : formatClock(secondsLeft)}
        </Text>
        <View style={styles.overlayButtons}>
          {expired ? null : (
            <Button variant="secondary" onPress={togglePause} accessibilityLabel={paused ? 'Resume' : 'Pause'}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="ghost" onPress={stop} accessibilityLabel="Stop">
            Stop
          </Button>
        </View>
      </View>
    </Modal>
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
  overlayButtons: {
    flexDirection: 'row',
    gap: space[3],
  },
});
