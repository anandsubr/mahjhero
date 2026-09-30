import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../../components/Text';
import Button from '../../../../components/Button';
import GameRow from '../../../../components/GameRow';
import HubSection from '../../../../components/hub/HubSection';
import CalendarLinkSheet from '../../../../components/hub/CalendarLinkSheet';
import { useClubHub } from '../../../../components/hub/ClubHubContext';
import { CalendarIcon, PlusIcon } from '../../../../components/icons';
import { fetchClubGames, type MyGame } from '../../../../lib/my-games';
import { getMyCalendarFeedUrl, webcalUrl } from '../../../../lib/calendar-feed';
import { colors, radius, type } from '../../../../lib/theme';

type Segment = 'all' | 'upcoming' | 'past';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

const DAY_MS = 86_400_000;
const UPCOMING_DAYS = 120;
const PAST_DAYS = 180;

/** The fetch window for a segment, relative to `now`. */
function windowFor(segment: Segment, now: Date): { from: Date; to: Date } {
  const past = new Date(now.getTime() - PAST_DAYS * DAY_MS);
  const ahead = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  if (segment === 'upcoming') return { from: now, to: ahead };
  if (segment === 'past') return { from: past, to: now };
  return { from: past, to: ahead };
}

function byStart(a: MyGame, b: MyGame): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

/**
 * The club hub's default section: this club's games in an All / Upcoming /
 * Past list, with a pinned footer to subscribe to the member's calendar feed
 * and (hosts only) to create a game.
 */
export default function GamesSection() {
  const { club, role } = useClubHub();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isHost = role === 'host';

  const [segment, setSegment] = useState<Segment>('upcoming');
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [calBusy, setCalBusy] = useState(false);
  // A ref, not the state: two taps in one frame both see stale `calBusy`.
  const calInFlight = useRef(false);
  const [calFailed, setCalFailed] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only the newest read may write state: switching segments quickly, a
  // refocus and a pull-to-refresh can all overlap, and an older read
  // resolving last would put the wrong segment's rows on screen.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const at = new Date();
    const { from, to } = windowFor(segment, at);
    const result = await fetchClubGames(club.id, from, to);
    if (seq !== loadSeq.current || !mounted.current) return;
    setFailed(result === null);
    if (result === null) return; // keep whatever is on screen
    const sorted = [...result].sort(byStart);
    if (segment === 'past') sorted.reverse();
    setNow(at.getTime());
    setGames(sorted);
  }, [club.id, segment]);

  // Runs on focus and whenever `load` changes (a new segment).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function selectSegment(next: Segment) {
    if (next === segment) return;
    // The previous segment's rows would be wrong under the new label.
    setGames(null);
    setFailed(false);
    setSegment(next);
  }

  async function addToCalendar() {
    if (calInFlight.current) return;
    calInFlight.current = true;
    setCalFailed(false);
    setCalBusy(true);
    const url = await getMyCalendarFeedUrl();
    calInFlight.current = false;
    if (!mounted.current) return;
    setCalBusy(false);
    if (!url) {
      setCalFailed(true);
      return;
    }
    if (Platform.OS === 'web') {
      setSheetUrl(url);
      return;
    }
    try {
      await Linking.openURL(webcalUrl(url));
    } catch (cause) {
      console.error('webcal open failed', cause);
      if (mounted.current) setSheetUrl(url);
    }
  }

  const newGame = () => router.push(`/clubs/${club.id}/events/new`);

  const footer = (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
      {calFailed ? (
        <Text accessibilityRole="alert" style={styles.calError}>
          Could not get your calendar link.
        </Text>
      ) : null}
      <View style={styles.footerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add to calendar"
          aria-busy={calBusy}
          onPress={() => void addToCalendar()}
          style={({ pressed }) => [styles.pill, styles.calPill, pressed && styles.calPillPressed]}
        >
          {calBusy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <CalendarIcon size={18} color={colors.text} />
          )}
          <Text style={styles.calText}>Add to calendar</Text>
        </Pressable>
        {isHost ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New game"
            onPress={newGame}
            style={({ pressed }) => [styles.pill, styles.newPill, pressed && styles.newPillPressed]}
          >
            <PlusIcon size={18} color="#fff" />
            <Text style={styles.newText}>New game</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      <HubSection footer={footer} onRefresh={load}>
        <View style={styles.track} accessibilityRole="tablist">
          {SEGMENTS.map((s) => {
            const selected = s.key === segment;
            return (
              <Pressable
                key={s.key}
                accessibilityRole="tab"
                accessibilityLabel={s.label}
                accessibilityState={{ selected }}
                aria-selected={selected}
                onPress={() => selectSegment(s.key)}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {failed ? (
          <View accessibilityRole="alert" style={styles.failed}>
            <Text style={styles.failedText}>Could not load games.</Text>
            <Button variant="secondary" big={false} accessibilityLabel="Retry" onPress={() => void load()}>
              Retry
            </Button>
          </View>
        ) : null}

        {games === null ? (
          failed ? null : (
            <ActivityIndicator style={styles.loading} color={colors.accentColor} />
          )
        ) : games.length === 0 ? (
          failed ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {segment === 'past' ? 'No past games.' : 'No games here yet.'}
              </Text>
              {isHost ? (
                <Button big={false} onPress={newGame}>
                  New game
                </Button>
              ) : null}
            </View>
          )
        ) : (
          <View style={styles.list}>
            {games.map((g, i) => (
              <GameRow
                key={g.eventId}
                game={g}
                showClub={false}
                description={g.notes || null}
                past={Date.parse(g.startsAt) < now}
                last={i === games.length - 1}
                onPress={() => router.push(`/clubs/${club.id}/events/${g.eventId}`)}
              />
            ))}
          </View>
        )}
      </HubSection>
      <CalendarLinkSheet
        visible={sheetUrl !== null}
        url={sheetUrl ?? ''}
        onClose={() => setSheetUrl(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Home's HomeSwitch pill, a size down.
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
    marginBottom: 8,
  },
  option: {
    flex: 1,
    // The design's 42pt option; the app-wide hit-target floor is 44.
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: { backgroundColor: colors.accent[700] },
  optionLabel: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  optionLabelSelected: { color: '#fff' },
  list: { marginHorizontal: -12 },
  loading: { marginTop: 24 },
  empty: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  emptyText: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.textMuted },
  failed: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  failedText: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
  footer: {
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
  },
  calError: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[800], textAlign: 'center' },
  footerRow: { flexDirection: 'row', gap: 10 },
  pill: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  calPill: { backgroundColor: colors.surface },
  calPillPressed: { backgroundColor: colors.neutral[300] },
  calText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  newPill: { backgroundColor: colors.accent[700] },
  newPillPressed: { backgroundColor: colors.accent[800] },
  newText: { fontFamily: type.bodyBold, fontSize: 15, color: '#fff' },
});
