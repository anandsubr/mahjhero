import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import Button from '../components/Button';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import Skeleton from '../components/Skeleton';
import ClubCard from '../components/home/ClubCard';
import HomeGuides from '../components/home/HomeGuides';
import HomeHeader from '../components/home/HomeHeader';
import HomeSwitch, { type HomeView } from '../components/home/HomeSwitch';
import JoinClubCard from '../components/home/JoinClubCard';
import MyGamesCalendar from '../components/home/MyGamesCalendar';
import MyGamesList from '../components/home/MyGamesList';
import MyGamesModeToggle, { type MyGamesMode } from '../components/home/MyGamesModeToggle';
import NeedsYouStack from '../components/home/NeedsYouStack';
import { fetchMyClubs, fetchMyRoles, type Club, type ClubRole } from '../lib/clubs';
import { GENERIC_ERROR } from '../lib/constants';
import {
  fetchHostChecklistCounts,
  hostChecklistKey,
  type HostChecklistCounts,
} from '../lib/guides';
import { gameDateKey, homeDefault, localDateKey, upcomingSummary } from '../lib/home';
import { fetchClubsNextGame, fetchMyGames, type MyGame } from '../lib/my-games';
import { fetchProfile } from '../lib/profile';
import { useSession } from '../lib/session';
import { colors, type } from '../lib/theme';
import { useGuides } from '../lib/use-guides';
import { useNeedsYou } from '../lib/use-needs-you';
import { useNotificationsUnread } from '../lib/use-notifications-unread';
import { useUnreadCounts } from '../lib/use-unread';

const LIST_WINDOW_DAYS = 120;
type Mode = MyGamesMode;
type Roles = { club_id: string; role: ClubRole }[];

const modeKey = (userId: string) => `home:myGamesMode:${userId}`;

/**
 * Home (Design V3 2a): header, "Needs you", then My games (list or
 * calendar) or Clubs. Replaces the old dashboard (app/clubs/index.tsx) and
 * the global tab bar.
 */
export default function HomeScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const email = session?.user.email;
  const router = useRouter();
  const guides = useGuides();
  const { byClub: unreadByClub } = useUnreadCounts();
  const alertsUnread = useNotificationsUnread();

  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [clubsFailed, setClubsFailed] = useState(false);
  const [roles, setRoles] = useState<Roles | null>(null);
  const [nextGames, setNextGames] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState('');
  const [upcoming, setUpcoming] = useState<MyGame[] | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [view, setView] = useState<HomeView | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  // Set once the member picks List/Calendar themselves, so a slow
  // AsyncStorage read resolving afterwards cannot overwrite their choice.
  const modeChosen = useRef(false);
  const todayKey = localDateKey(new Date());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [monthGames, setMonthGames] = useState<MyGame[]>([]);
  const [monthFailed, setMonthFailed] = useState(false);
  // Bumped by the calendar's Retry to refetch the month on screen.
  const [monthRetry, setMonthRetry] = useState(0);
  const [checklist, setChecklist] = useState<Record<string, HostChecklistCounts | null>>({});

  // Only the newest feed read may write state: a focus reload and a Retry
  // (or a seat change) can overlap, and an older one resolving last would
  // otherwise put a stale snapshot back on screen.
  const feedSeq = useRef(0);
  const loadFeed = useCallback(async () => {
    const seq = ++feedSeq.current;
    const now = new Date();
    const result = await fetchMyGames(
      now,
      new Date(now.getTime() + LIST_WINDOW_DAYS * 86_400_000),
    );
    if (seq !== feedSeq.current) return;
    setFeedFailed(result === null);
    // A failed read keeps whatever is on screen; only the first load
    // resolves to [] so the switch default can still be decided.
    setUpcoming((prev) => result ?? prev ?? []);
  }, []);

  const loadClubs = useCallback(async () => {
    if (!userId) return;
    const [list, myRoles, next] = await Promise.all([
      fetchMyClubs(),
      fetchMyRoles(userId),
      fetchClubsNextGame(),
    ]);
    setClubsFailed(list === null);
    // Failed reads keep what is already on screen rather than blanking it.
    setClubs((prev) => list ?? prev ?? []);
    if (myRoles) setRoles(myRoles);
    if (next) setNextGames(next);
  }, [userId]);

  const needs = useNeedsYou(userId, clubs, () => void loadFeed());
  // Read through a ref: `needs.reload` changes identity whenever the club
  // set does, and putting it in the focus callback's deps would re-run the
  // whole focus load (and refetch clubs) each time clubs arrive.
  const reloadNeeds = useRef(needs.reload);
  reloadNeeds.current = needs.reload;
  // useNeedsYou already loads on mount; only later focuses need a reload.
  const focusedOnce = useRef(false);

  // Refetch whenever Home regains focus (coming back from a game after
  // booking or cancelling), like the old dashboard.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void loadFeed();
      void loadClubs();
      if (focusedOnce.current) void reloadNeeds.current();
      focusedOnce.current = true;
    }, [userId, loadFeed, loadClubs]),
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchProfile(userId).then((p) => {
      if (cancelled) return;
      const name = p?.display_name?.trim() || email || '?';
      setInitial(name.charAt(0).toUpperCase());
    });
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(modeKey(userId));
        if (cancelled || modeChosen.current) return;
        if (saved === 'list' || saved === 'calendar') setMode(saved);
      } catch {
        // Storage unavailable: List is a fine default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, email]);

  // Upcoming = from today on. The same array drives the switch default, the
  // My games count and the list, so they can never disagree.
  const upcomingGames = useMemo(
    () =>
      upcoming === null
        ? null
        : upcoming.filter((g) => gameDateKey(g.startsAt, g.timezone) >= todayKey),
    [upcoming, todayKey],
  );

  // The switch default is decided once, when the feed first lands, so it
  // never flickers from one view to the other.
  useEffect(() => {
    if (view === null && upcomingGames !== null) setView(homeDefault(upcomingGames.length));
  }, [upcomingGames, view]);

  // Calendar months fetch only while the calendar is actually on screen, on
  // navigation, on Retry, and whenever the feed reloads (so a booking made
  // elsewhere shows up). The previous month stays on screen until the new
  // one arrives; a failed month shows its own error and Retry.
  const calendarShown = view === 'myGames' && mode === 'calendar';
  useEffect(() => {
    if (!calendarShown || !userId) return;
    let cancelled = false;
    const from = new Date(month.year, month.monthIndex, 1);
    const to = new Date(month.year, month.monthIndex + 1, 1);
    fetchMyGames(from, to).then((r) => {
      if (cancelled) return;
      setMonthFailed(r === null);
      if (r) setMonthGames(r);
    });
    return () => {
      cancelled = true;
    };
  }, [calendarShown, month, userId, upcoming, monthRetry]);

  // Host checklist counts, loaded only while the Clubs view is shown. Keyed
  // on a sorted string, not the array: `guides` and `roles` produce a fresh
  // array every render, and depending on it would refetch forever.
  const hostedIds = (roles ?? [])
    .filter((r) => r.role === 'host')
    .map((r) => r.club_id)
    .filter((id) => guides.isVisible(hostChecklistKey(id)));
  const hostedKey = [...hostedIds].sort().join(',');
  useEffect(() => {
    if (view !== 'clubs' || hostedKey === '') return;
    let cancelled = false;
    const ids = hostedKey.split(',');
    Promise.all(ids.map(async (id) => [id, await fetchHostChecklistCounts(id)] as const)).then(
      (entries) => {
        if (!cancelled) setChecklist(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [view, hostedKey]);

  function chooseMode(next: Mode) {
    modeChosen.current = true;
    setMode(next);
    if (!userId) return;
    try {
      AsyncStorage.setItem(modeKey(userId), next).catch(() => {});
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
  }

  function shiftMonth(delta: number) {
    const d = new Date(month.year, month.monthIndex + delta, 1);
    const next = { year: d.getFullYear(), monthIndex: d.getMonth() };
    setMonth(next);
    const prefix = `${next.year}-${String(next.monthIndex + 1).padStart(2, '0')}`;
    setSelectedKey(todayKey.startsWith(prefix) ? todayKey : localDateKey(d));
  }

  const openGame = (g: MyGame) => router.push(`/clubs/${g.clubId}/events/${g.eventId}`);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const header = (
    <HomeHeader
      // The email's first letter until the profile's display name arrives.
      initial={initial || (email ?? '').charAt(0).toUpperCase()}
      unread={alertsUnread > 0}
      onAlerts={() => router.push('/alerts')}
      onProfile={() => router.push('/profile')}
    />
  );

  if (view === null) {
    return (
      <Screen scroll contentStyle={styles.container}>
        {header}
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </Screen>
    );
  }

  const roleFor = (clubId: string): ClubRole =>
    roles?.find((r) => r.club_id === clubId)?.role ?? 'member';
  const games = upcomingGames ?? [];
  const failed = mode === 'list' ? feedFailed : monthFailed;
  const retry = mode === 'list' ? () => void loadFeed() : () => setMonthRetry((n) => n + 1);

  return (
    <Screen
      scroll
      contentStyle={styles.container}
      onRefresh={async () => {
        await Promise.all([loadFeed(), loadClubs(), reloadNeeds.current()]);
      }}
    >
      {header}
      <NeedsYouStack needs={needs} />
      <HomeSwitch value={view} upcomingCount={games.length} onChange={setView} />

      {view === 'myGames' ? (
        <View style={styles.section}>
          <View style={styles.subRow}>
            <Text style={styles.sub}>{upcomingSummary(games)}</Text>
            <MyGamesModeToggle mode={mode} onChange={chooseMode} />
          </View>

          {failed ? (
            <View style={styles.errorBlock}>
              <Text style={styles.sub}>Could not load your games.</Text>
              <Button
                variant="secondary"
                big={false}
                onPress={retry}
                accessibilityLabel="Retry"
              >
                Retry
              </Button>
            </View>
          ) : mode === 'list' ? (
            games.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.sub}>No games yet. Join one from a club.</Text>
                <Button
                  variant="secondary"
                  big={false}
                  onPress={() => setView('clubs')}
                  accessibilityLabel="Show my clubs"
                >
                  Clubs
                </Button>
              </View>
            ) : (
              <MyGamesList games={games} todayKey={todayKey} onOpen={openGame} />
            )
          ) : (
            <MyGamesCalendar
              year={month.year}
              monthIndex={month.monthIndex}
              todayKey={todayKey}
              games={monthGames}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
              onOpen={openGame}
            />
          )}
        </View>
      ) : (
        <View style={styles.section}>
          <JoinClubCard onJoined={(clubId) => router.push(`/clubs/${clubId}`)} />
          <HomeGuides
            clubs={clubs}
            roles={roles}
            checklist={checklist}
            email={email}
            guides={guides}
            router={router}
          />
          {clubsFailed ? <ErrorBanner message={GENERIC_ERROR} /> : null}
          {(clubs ?? []).map((club) => (
            <ClubCard
              key={club.id}
              club={club}
              role={roleFor(club.id)}
              nextStartsAt={nextGames[club.id] ?? null}
              unread={unreadByClub[club.id] ?? 0}
              onPress={() => router.push(`/clubs/${club.id}`)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a club"
            onPress={() => router.push('/clubs/new')}
            style={styles.startClub}
          >
            <Text style={styles.startClubText}>+ Start a club</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen already caps and centres the content column; this only adds the
  // design's 16pt side margins and the section rhythm.
  container: { gap: 16, paddingHorizontal: 16, paddingBottom: 32 },
  centered: { alignItems: 'center' },
  section: { gap: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sub: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700], flexShrink: 1 },
  errorBlock: { gap: 8, alignItems: 'flex-start' },
  emptyCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    borderRadius: 20,
    padding: 20,
    gap: 10,
    alignItems: 'center',
  },
  startClub: {
    minHeight: 56,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  startClubText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
});
