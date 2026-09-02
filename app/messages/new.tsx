import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import { GENERIC_ERROR } from '../../lib/constants';
import { initialsFrom } from '../../lib/dashboard';
import {
  fetchAddablePeople,
  fetchFriends,
  type AddablePerson,
  type Friend,
} from '../../lib/friends';
import { createGroupThread, postMessage } from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

type Candidate = { profile_id: string; display_name: string; meta: string };

/**
 * Start a conversation with one or more people.
 *
 * Carries the tab bar with `active="messages"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `compose` included — it is not gated to the four tabs
 * themselves. Its own "Messages" ghost back link, drawn above the heading
 * until the bar arrived, is gone now that the Messages tab reaches the
 * identical `/messages` route — the same call already made once for the
 * club detail screen (`app/clubs/[id]/index.tsx`'s own docstring).
 *
 * One step, not two: the message box and Send live on THIS screen, not on
 * a thread screen reached after picking who to message. The old two-step
 * flow was never a design decision -- it fell out of fetch_my_threads
 * listing a group thread from the moment it is created, with no message
 * required. Pick somebody, tap Start, close the app, and they had an empty
 * conversation from you reading "No messages yet." One step makes that
 * unrepresentable: the thread does not exist until there is something to
 * say, so a message is always required below.
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
  const [draft, setDraft] = useState('');
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
  // The thread id from a create/open that SUCCEEDED, kept only across a
  // subsequent post that failed. create_group_thread is a creation-time
  // convenience with no dedup (see
  // supabase/migrations/20260829030000_group_threads.sql) -- it makes a new
  // thread every call. Without remembering the id here, tapping the button
  // again after a failed post would create a second, near-duplicate group
  // thread for the same people instead of retrying the post into the one
  // that already exists. Cleared whenever the picked selection changes
  // underneath it, since at that point the remembered thread no longer
  // matches what the member is asking to send.
  const createdThreadRef = useRef<string | null>(null);

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
    createdThreadRef.current = null;
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

    const trimmed = draft.trim();
    // Creating the thread in someone else's list for the first time always
    // needs something to say -- refused here, before any RPC call, the same
    // way the empty-picked case above is refused, and with postMessage's
    // own wording for an empty body, since that is the refusal this would
    // otherwise get one round trip later.
    if (trimmed.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Write something first.');
      return;
    }

    let threadId = createdThreadRef.current;
    if (!threadId) {
      const result = await createGroupThread('', picked);

      if (result.error || !result.id) {
        // Cleared on this exit path too — a ref set and never cleared makes
        // the picker permanently dead, which is worse than the double-submit
        // bug it guards against.
        busyRef.current = false;
        setBusy(false);
        setError(result.error ?? GENERIC_ERROR);
        return;
      }
      threadId = result.id;
      createdThreadRef.current = threadId;
    }

    // `p_root` null: this is a member starting a new post, not replying
    // inside one -- the same call app/messages/club/new.tsx makes for the
    // identical reason. The guard above guarantees `trimmed` is non-empty
    // by the time this runs, so the post always happens.
    const { error: refusal } = await postMessage(threadId, trimmed, false, null);
    if (refusal) {
      // The thread now exists whether or not this post succeeds --
      // create_group_thread has already run, and undoing that isn't a call
      // this module exposes. What stays in this screen's control: not
      // losing what they typed (draft and picked are untouched) and not
      // swallowing the refusal (relayed verbatim below) -- the same "keep
      // the text, show the error" contract [threadId].tsx's own `send`
      // keeps on a failed post. createdThreadRef keeps the id so the next
      // tap retries the post into this same thread instead of creating
      // another one.
      busyRef.current = false;
      setBusy(false);
      setError(refusal);
      return;
    }

    busyRef.current = false;
    setBusy(false);
    createdThreadRef.current = null;
    // `replace`, not `push`: the compose screen has served its purpose and
    // backing out of a thread should land on the list, not on a picker with
    // stale selections.
    router.replace(`/messages/${threadId}`);
  }, [picked, draft, router]);

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

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            accessibilityLabel="Message"
            multiline
          />

          {/*
            Always "Send" now -- People always requires a message (guarded
            in `start` above), so there is no "Open a thread with nothing
            typed" case left to label for. That case belonged to the
            removed Everyone target; see this screen's own docstring.
          */}
          <Button
            block
            accessibilityLabel="Send"
            disabled={busy}
            loading={busy}
            onPress={() => void start()}
          >
            Send
          </Button>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
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
  // Same input treatment as [threadId].tsx's composer, minus that screen's
  // `flex: 1` -- there it shares a row with an inline Send control, here the
  // primary action is its own full-width Button below.
  input: {
    minHeight: 58,
    maxHeight: 140,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
});
