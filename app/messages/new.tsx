import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Card from '../../components/Card';
import ClubChips from '../../components/ClubChips';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import { GENERIC_ERROR } from '../../lib/constants';
import { fetchMyClubs, type Club } from '../../lib/clubs';
import { initialsFrom } from '../../lib/dashboard';
import { fetchAddablePeople, fetchFriends } from '../../lib/friends';
import { createGroupThread, openThreadForClub, postMessage } from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

type Candidate = { profile_id: string; display_name: string; meta: string };

/**
 * The `1C compose` artboard, with one deliberate deviation.
 *
 * Carries the tab bar with `active="messages"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `compose` included — it is not gated to the four tabs
 * themselves. Its own "Messages" ghost back link, drawn above the heading
 * until the bar arrived, is gone now that the Messages tab reaches the
 * identical `/messages` route — the same call already made once for the
 * club detail screen (`app/clubs/[id]/index.tsx`'s own docstring).
 *
 * The artboard offers Everyone / A group / People, where "a group" is a
 * NAMED per-club list — "Tuesday table", "Hosts" — that somebody maintains.
 * This app's groups are ad-hoc member sets that cut across clubs, so People
 * covers the same ground and a third choice would be a distinction without
 * a difference. Recorded in the spec so it is not later read as an
 * oversight.
 *
 * One step, not two: the artboard puts the message box and Send on THIS
 * screen, not on a thread screen reached after picking a target. The old
 * two-step flow was never a design decision -- it fell out of
 * fetch_my_threads listing a group thread from the moment it is created,
 * with no message required. Pick somebody, tap Start, close the app, and
 * they had an empty conversation from you reading "No messages yet." One
 * step makes that unrepresentable for People, because the thread does not
 * exist until there is something to say.
 *
 * The two targets are deliberately NOT symmetric. People is creating a
 * thread in someone else's list for the first time, so a message is
 * required. Everyone's club thread conceptually always exists and is
 * already in everyone's list, so opening it to read without writing is
 * legitimate -- Everyone posts if there is text and just opens if there
 * is not.
 */
export default function NewMessageScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [target, setTarget] = useState<'everyone' | 'people'>('everyone');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
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
  // that already exists. Cleared whenever the target/club/picked selection
  // changes underneath it, since at that point the remembered thread no
  // longer matches what the member is asking to send.
  const createdThreadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    void (async () => {
      const [myClubs, friends, people] = await Promise.all([
        fetchMyClubs(),
        fetchFriends(),
        fetchAddablePeople(),
      ]);
      if (cancelled) return;

      setClubs(myClubs ?? []);
      setClubId(myClubs?.[0]?.id ?? null);

      /*
       * Friends first, then people from your clubs.
       *
       * Not merely a nicety: a friend acquired in a club one of you has
       * since left appears in NEITHER club list, so ordering by club alone
       * would bury exactly the person the friends feature exists to keep
       * reachable.
       */
      setCandidates([
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
      ]);

      if (myClubs === null || friends === null || people === null) {
        setError(GENERIC_ERROR);
      }
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const toggle = useCallback((id: string) => {
    createdThreadRef.current = null;
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const selectTarget = useCallback((option: 'everyone' | 'people') => {
    createdThreadRef.current = null;
    setTarget(option);
  }, []);

  const selectClub = useCallback((id: string) => {
    createdThreadRef.current = null;
    setClubId(id);
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
    if (target === 'people' && picked.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Pick somebody to message.');
      return;
    }

    const trimmed = draft.trim();
    // People is creating the thread in someone else's list for the first
    // time -- unlike Everyone's club thread, which already exists and is
    // legitimate to open and just read. Refused here, before any RPC call,
    // the same way the empty-picked case above is refused -- and with
    // postMessage's own wording for an empty body, since that is the
    // refusal this would otherwise get one round trip later.
    if (target === 'people' && trimmed.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Write something first.');
      return;
    }

    let threadId = createdThreadRef.current;
    if (!threadId) {
      const result =
        target === 'everyone'
          ? clubId
            ? await openThreadForClub(clubId)
            : { id: null, error: 'Pick a club first.' }
          : await createGroupThread('', picked);

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

    // Everyone with nothing typed just opens the thread -- no post call at
    // all, since it is legitimate to open a club thread to read without
    // writing. People always has a body here, having refused above if not.
    if (trimmed.length > 0) {
      const { error: refusal } = await postMessage(threadId, trimmed, false, null);
      if (refusal) {
        // The thread now exists whether or not this post succeeds --
        // create_group_thread and open_thread_for_club have already run,
        // and undoing that isn't a call this module exposes. What stays in
        // this screen's control: not losing what they typed (draft and
        // picked are untouched) and not swallowing the refusal (relayed
        // verbatim below) -- the same "keep the text, show the error"
        // contract [threadId].tsx's own `send` keeps on a failed post.
        // createdThreadRef keeps the id so the next tap retries the post
        // into this same thread instead of creating another one.
        busyRef.current = false;
        setBusy(false);
        setError(refusal);
        return;
      }
    }

    busyRef.current = false;
    setBusy(false);
    createdThreadRef.current = null;
    // `replace`, not `push`: the compose screen has served its purpose and
    // backing out of a thread should land on the list, not on a picker with
    // stale selections.
    router.replace(`/messages/${threadId}`);
  }, [target, clubId, picked, draft, router]);

  // "Send" when the tap is about to post (People always requires a body;
  // Everyone posts when there is one), "Open" when Everyone has nothing
  // typed and the tap will just open the club thread to read. A button
  // labelled for the wrong one of those is worse than no label at all.
  const actionLabel = target === 'people' || draft.trim() ? 'Send' : 'Open';

  const clubName = useMemo(
    () => clubs.find((c) => c.id === clubId)?.name ?? '',
    [clubs, clubId],
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      <Text style={styles.heading}>New message</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          {clubs.length > 1 ? (
            <>
              <Text style={styles.label}>In which club</Text>
              <ClubChips
                chips={clubs.map((c) => ({ id: c.id, label: c.name }))}
                selected={clubId ?? ''}
                onSelect={selectClub}
              />
            </>
          ) : null}

          <Text style={styles.label}>Send to</Text>
          <View style={styles.targets}>
            {(['everyone', 'people'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => selectTarget(option)}
                accessibilityRole="button"
                aria-selected={target === option}
                style={[
                  styles.target,
                  target === option ? styles.targetOn : null,
                ]}
              >
                <Text style={styles.targetText}>
                  {option === 'everyone' ? 'Everyone' : 'People'}
                </Text>
              </Pressable>
            ))}
          </View>

          {target === 'everyone' ? (
            <Card background={colors.accent2[100]}>
              <Text style={styles.note}>
                {/*
                  Ordinary messages never email -- only the thread screen's
                  "Also email everyone" toggle does, and it defaults off.
                  This used to say "as a club announcement", which read as a
                  promise that picking Everyone reaches the outbox. It does
                  not: Send here posts in the app only.
                */}
                Goes to everyone at {clubName}, in the app. Email is a
                separate opt-in on the thread.
              </Text>
            </Card>
          ) : (
            candidates.map((c) => {
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
            })
          )}

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            accessibilityLabel="Message"
            multiline
          />

          <Button
            block
            accessibilityLabel={actionLabel}
            disabled={busy}
            loading={busy}
            onPress={() => void start()}
          >
            {actionLabel}
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
  targets: { flexDirection: 'row', gap: space[2] },
  target: {
    flex: 1,
    minHeight: 78,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: 'transparent',
  },
  targetOn: { borderBottomColor: colors.accentColor },
  targetText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  note: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.accent2[800],
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
