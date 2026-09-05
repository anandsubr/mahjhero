import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import { ChevronLeftIcon } from '../../components/icons';
import { GENERIC_ERROR } from '../../lib/constants';
import { initialsFrom } from '../../lib/dashboard';
import {
  fetchAddablePeople,
  fetchFriends,
  type AddablePerson,
  type Friend,
} from '../../lib/friends';
import { createGroupThread } from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

type Candidate = { profile_id: string; display_name: string; meta: string };

/**
 * Start a conversation with one or more people.
 *
 * Carries the tab bar with `active="messages"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `compose` included — it is not gated to the four tabs
 * themselves. Also carries an explicit "Messages" ghost back link again
 * (2026-09-01-back-links-design.md): the Messages tab reaches the identical
 * `/messages` route, but renders as *already active* here, which reads as
 * "you are here" rather than a way out.
 *
 * Two visible steps, on purpose: picking people and tapping Start
 * conversation only creates (or opens) the thread and navigates straight to
 * it. The message itself -- text, images, or both -- is composed on that
 * thread screen, through the same Composer every other thread already uses
 * (attachments included, since Task 10). No thread exists yet while people
 * are still being picked here, so there is nowhere to upload an image to
 * until the thread does; rather than build a second, cut-down attach flow
 * just for this screen, the first message is handled on the thread screen
 * like any other message. That does mean a still-empty group thread is
 * representable again -- pick somebody, tap Start, and "No messages yet."
 * is a real state, same as any other conversation nobody has written in
 * yet -- accepted here as the smaller cost next to a duplicated composer.
 *
 * There is no separate "group" choice, either. That would mean a NAMED
 * per-club list -- "Tuesday table", "Hosts" -- that somebody maintains.
 * This app's groups are ad-hoc member sets that cut across clubs, created
 * by picking people below, so a dedicated group target would be a
 * distinction without a difference.
 *
 * The original `1C compose` artboard offered a second target here, Everyone
 * -- the club thread, opened without writing if there was nothing typed,
 * posted to if there was. It is gone, on purpose, and should not come
 * back:
 *
 * - Its own docstring used to call the two targets "deliberately NOT
 *   symmetric" -- People always required a message; Everyone alone could
 *   open a thread with nothing typed. That asymmetry was a tell: the
 *   open-with-nothing-typed case is a shortcut to a destination the
 *   Messages list already shows, one screen back, as a club row.
 * - The post-with-text case was a strictly worse version of the club
 *   board's own composer (`app/messages/club/new.tsx`): no subject
 *   preview, no Announcement toggle, no header naming which club. Anything
 *   a member could do here, they could do better one tap away.
 * - Removing it also deletes the last navigation path that had to be
 *   specially taught a club thread belongs on `/messages/club/<id>`, never
 *   the flat `/messages/[threadId]` screen (docs/messaging.md decision #7)
 *   -- this screen's own `Everyone` branch was one of the four sites that
 *   invariant had to be re-learned at, the thirteen-review history that
 *   decision records.
 *
 * If Everyone-equivalent reach is wanted again, it belongs as a route into
 * the board's own composer, not as a second target rebuilt here.
 */
export default function NewMessageScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  // Kept apart, as `Friend[] | null` and `AddablePerson[] | null` -- not
  // merged straight into one `Candidate[]` -- so `null` ("could not ask")
  // stays tellable from `[]` ("genuinely nobody") for EACH source. Merging
  // early into a single `candidates` list the way this screen used to would
  // erase exactly that distinction: a failed fetchAddablePeople alongside an
  // empty fetchFriends would come out looking identical to two fetches that
  // both genuinely found nobody, and the screen would tell a member with a
  // dead network that she has no friends. Same contract friends.tsx keeps
  // for its own `friends`/`people` state.
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [people, setPeople] = useState<AddablePerson[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Written synchronously and cleared on every exit path, read from a ref
  // rather than `busy` state: a second tap in the same tick reads `busy`
  // from that render's closure, which is still `false` because the first
  // tap's `setBusy(true)` has not re-rendered yet. Same bug class as
  // `busyRef`/`openingRef`/`sendingRef` in app/clubs/index.tsx,
  // app/friends.tsx, app/messages/index.tsx and app/messages/[threadId].tsx.
  const busyRef = useRef(false);

  // Keyed on the user id, NOT on `session` itself -- lib/session.tsx hands
  // out a fresh Session object on every onAuthStateChange (TOKEN_REFRESHED
  // included, hourly, and on web tab focus), and none of that changes who
  // is asking. Depending on the object would refetch and discard `picked`'s
  // sibling state for no reason on every one of those. Same guard
  // app/friends.tsx and app/messages/index.tsx keep on their own loads.
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const [f, p] = await Promise.all([fetchFriends(), fetchAddablePeople()]);
      if (cancelled) return;

      setFriends(f);
      setPeople(p);
      // Only the read failure sets this -- an action's own refusal (`start`
      // below) is set by the action, and clearing it here would erase a
      // message the member is reading before they have read it. Same split
      // app/friends.tsx's own `load` keeps.
      if (f === null || p === null) setError(GENERIC_ERROR);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggle = useCallback((id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    // Guarded here rather than left to createGroupThread's own empty-list
    // refusal: that check exists to stop a bad network call, not to be the
    // first place a member hears their tap did nothing. Matching its
    // wording keeps the message the same either way.
    if (picked.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Pick somebody to message.');
      return;
    }

    const result = await createGroupThread('', picked);
    if (result.error || !result.id) {
      busyRef.current = false;
      setBusy(false);
      setError(result.error ?? GENERIC_ERROR);
      return;
    }

    busyRef.current = false;
    setBusy(false);
    // `replace`, not `push`: the picker has served its purpose, and backing
    // out of the new thread should land on the list, not on a picker with
    // stale selections. The first message -- text, images, or both -- is
    // composed on the thread screen itself now, through the same Composer
    // every other thread already uses (Task 10), not here.
    router.replace(`/messages/${result.id}`);
  }, [picked, router]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  /*
   * Friends first, then people from your clubs.
   *
   * Not merely a nicety: a friend acquired in a club one of you has since
   * left appears in NEITHER club list, so ordering by club alone would
   * bury exactly the person the friends feature exists to keep reachable.
   *
   * `friends ?? []` / `people ?? []` here is safe precisely because
   * everything below that treats "nobody" as a fact -- the empty-state card
   * -- checks `friends !== null && people !== null` first, the same guard
   * app/friends.tsx puts on its own `emptyCard`. This list itself is allowed
   * to render whatever came back, including a partial list from the one
   * fetch that succeeded while the other failed.
   */
  const candidates: Candidate[] = [
    ...(friends ?? []).map((f) => ({
      profile_id: f.profile_id,
      display_name: f.display_name,
      meta: 'Friend',
    })),
    ...(people ?? []).map((p) => ({
      profile_id: p.profile_id,
      display_name: p.display_name,
      meta: p.club_name,
    })),
  ];
  const genuinelyEmpty = friends !== null && people !== null && candidates.length === 0;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/messages')}
        accessibilityLabel="Back to messages"
        style={styles.backButton}
      >
        Messages
      </Button>

      <Text style={styles.heading}>New message</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          <Text style={styles.label}>Send to</Text>
          {genuinelyEmpty ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Nobody to message yet. Add a friend or join a club to find
                people to message.
              </Text>
            </View>
          ) : null}
          {candidates.map((c) => {
            const on = picked.includes(c.profile_id);
            return (
              <Pressable
                key={c.profile_id}
                onPress={() => toggle(c.profile_id)}
                accessibilityRole="button"
                accessibilityLabel={c.display_name}
                aria-selected={on}
                style={[styles.person, on ? styles.personOn : null]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {initialsFrom(c.display_name)}
                  </Text>
                </View>
                <View style={styles.personBody}>
                  <Text style={styles.personName}>{c.display_name}</Text>
                  <Text style={styles.personMeta}>{c.meta}</Text>
                </View>
              </Pressable>
            );
          })}

          <Button
            block
            accessibilityLabel="Start conversation"
            disabled={busy}
            loading={busy}
            onPress={() => void start()}
          >
            Start conversation
          </Button>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h3,
    color: colors.text,
  },
  label: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  // Same dashed-card treatment as app/friends.tsx's and
  // app/messages/index.tsx's own `emptyCard`/`emptyText` -- reused rather
  // than invented again, the third place this exact "nothing here, and
  // here is why" card has appeared.
  emptyCard: {
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  personOn: { borderColor: colors.accentColor },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  personBody: { flex: 1, minWidth: 0 },
  personName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  personMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
