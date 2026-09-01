import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import MessageBubble from '../../components/messages/MessageBubble';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import ThreadAvatar from '../../components/ThreadAvatar';
import { ChevronLeftIcon, ChevronRightIcon, SendIcon } from '../../components/icons';
import { GENERIC_ERROR } from '../../lib/constants';
import { fetchAddablePeople, fetchFriends } from '../../lib/friends';
import {
  addToGroupThread,
  fetchThread,
  fetchThreadMessages,
  groupSeparatorLabel,
  leaveGroupThread,
  markThreadRead,
  postMessage,
  quoteStub,
  startsNewGroup,
  threadKindFor,
  threadTitleFor,
  type ThreadDetail,
  type ThreadMessage,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { supabase } from '../../lib/supabase';
import { colors, radius, space, type } from '../../lib/theme';

/** A candidate for Add people -- the same shape app/messages/new.tsx's own
 *  People picker uses for its candidate list. */
type Candidate = { profile_id: string; display_name: string; meta: string };

/**
 * The `1C thread` artboard.
 *
 * This is the app's only Realtime subscriber, and deliberately the only one.
 * `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what `can_read_thread` allows — there is no
 * second authorization surface. Subscribing across every thread would keep
 * badges live at the cost of a connection held for the whole session and the
 * hardest thing in the plan to test; the list refetches on focus instead.
 *
 * Carries the tab bar with `active="messages"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `thread` included — it is not gated to the four tabs
 * themselves. Its own "← Messages" text back link, drawn above the heading,
 * was removed once the Messages tab reached the identical `/messages` route
 * — the same call already made once for the club detail screen
 * (`app/clubs/[id]/index.tsx`'s own docstring). The header below now carries
 * a COMPACT chevron control of its own again, on the owner's explicit call:
 * the iOS Messages convention this header is rebuilt to puts a back chevron
 * in the header itself, and a small icon-only control there reads nothing
 * like the loud text link that was removed for duplicating the tab bar — it
 * is not that regression coming back.
 *
 * The composer's "Also email everyone" toggle and its two-step Send/Confirm
 * arming are gone too, on the owner's call: they intend to redesign how
 * announcing works and found the toggle's treatment unpleasant. Only
 * COMPOSING an announcement goes — an announcement already posted (a
 * migration backfilled every historical broadcast into its thread) still
 * renders in full below, and `postMessage`'s `announce` parameter,
 * `post_message`, `broadcast_recipients`, and the outbox fan-out are all
 * untouched underneath this screen, for the redesign to reattach a UI to.
 * `countBroadcastRecipients` (lib/broadcasts.ts) loses its only caller here
 * and goes back to being test-only.
 */
// Monotonic, not `Date.now()`/`Math.random()`: incremented once per Realtime
// subscription below so a topic can never be handed back to a still-live
// channel, no matter how the clock or a PRNG behave. See the effect's own
// comment for why a unique topic (not just the dependency-array fix beside
// it) is required.
let subscriptionSeq = 0;

// The artboard's `.bigin` height (`min-height: 58px`), and this screen's own
// Send button -- a 58x58 circle beside a 58-tall input, matched heights, one
// shape. Named once so the input's resting/grown heights and the button's
// own size are visibly the same number rather than two literals that could
// drift apart.
const COMPOSER_HEIGHT = 58;
// How tall a long draft may grow the input before it scrolls internally
// instead. Unchanged from the pre-existing behaviour this screen already
// had; only how it's enforced changes (see `handleDraftSize` below).
const DRAFT_MAX_HEIGHT = 140;

export default function ThreadScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const viewerId = session?.user.id ?? '';

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  // The composer input's own rendered height, MEASURED rather than trusted
  // from `minHeight` -- trusting `minHeight` is exactly what let a
  // react-native-web multiline `TextInput` (a `<textarea>` under the hood,
  // with its own intrinsic row height) render taller than the 58px Send
  // button beside it. `onContentSizeChange` below reports the textarea's
  // real `scrollHeight` on every keystroke (react-native-web's own
  // implementation reads it directly off the host node), which already
  // includes this input's padding — so clamping THAT number, not a CSS
  // hint, is what keeps the box between the resting 58px height and
  // `DRAFT_MAX_HEIGHT` for a long draft.
  const [inputHeight, setInputHeight] = useState(COMPOSER_HEIGHT);
  // The message being answered, held whole rather than as an id so the
  // composer can show its stub without hunting back through `messages`.
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // `sending` above is read from the render closure, so a guard written as
  // `if (sending) return` is blind to a second activation landing in the
  // same tick as an earlier `setSending(true)` -- a queued tap, a
  // screen-reader activation, a native double-tap -- since the closure still
  // holds the old value in that window. For an ordinary message that is a
  // duplicate line; for an announcement it is a duplicate email to the
  // entire club, which cannot be unsent. This ref is written synchronously
  // alongside `setSending`, so it is what actually makes the guard sound;
  // `sending` itself keeps doing its own job of re-rendering the Send button
  // into its disabled look. See the identical comment on `busyRef` in
  // app/clubs/index.tsx, app/friends.tsx, and app/messages/index.tsx's
  // `openingRef` for the same bug class.
  const sendingRef = useRef(false);
  const scroller = useRef<ScrollView>(null);

  // Members panel: GROUP and DIRECT threads only (thread.club_id === null).
  // A club or game thread's membership is derived from club_members/
  // bookings, not stored, so there is nothing to list and nobody to add.
  const [membersOpen, setMembersOpen] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pickedToAdd, setPickedToAdd] = useState<string[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Guards the add_to_group_thread RPC itself, the same shape as
  // sendingRef above: `addBusy` state is read from the render closure, so a
  // second activation landing before React re-renders with the disabled
  // button would otherwise double the call.
  const addBusyRef = useRef(false);

  // Leaving a group is irreversible -- the last member out deletes the
  // thread and its messages (leave_group_thread's own comment). Asks once,
  // the same two-step shape this file's own `leave()` button below uses.
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const leaveBusyRef = useRef(false);
  // Set alongside `thread`/`error`, not derived from them: the realtime
  // effect below subscribes regardless of whether the initial load
  // succeeded, and its INSERT handler needs to know -- at the moment an
  // event actually arrives -- whether the screen ever loaded, not what some
  // earlier render's closure happened to capture.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!threadId) return;
    const [detail, rows] = await Promise.all([
      fetchThread(threadId),
      fetchThreadMessages(threadId),
    ]);
    setThread(detail);
    setMessages(rows ?? []);
    setError(detail === null || rows === null ? GENERIC_ERROR : null);
    setReady(true);
    loadedRef.current = detail !== null;
    // Opening a thread is reading it. Without this the badge outlives the
    // act it exists to prompt.
    if (detail) void markThreadRead(threadId);
  }, [threadId]);

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  useEffect(() => {
    if (!session || !threadId) return;

    // `supabase.channel(topic)` REUSES an existing channel by topic
    // (RealtimeClient.channel), and `removeChannel` is async -- it awaits
    // `channel.unsubscribe()` before deregistering the topic. A React
    // cleanup cannot await, so if this effect re-runs with the same topic,
    // `channel()` can hand back the OLD, still-subscribed channel, and
    // `.on()` throws on it. `subscriptionSeq` makes every subscription's
    // topic unique so that can never happen, regardless of how slow the
    // teardown is: it is a monotonic counter incremented once per
    // subscription, not `Date.now()`/`Math.random()`, so within one JS
    // process it can never repeat and hand back a live channel -- not even
    // under React's dev double-mount or a `threadId` change racing the old
    // channel's teardown. `threadId` stays in the topic so a live channel
    // is still identifiable when debugging.
    const topic = `thread:${threadId}:${++subscriptionSeq}`;

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          // Refetch rather than appending the payload row: the payload
          // carries author_id but not the joined display_name, and a bubble
          // that renders anonymously and then re-renders with a name is
          // worse than one that arrives a beat later complete.
          void fetchThreadMessages(threadId).then((rows) => {
            if (rows) setMessages(rows);
          });
          // A conversation you are watching must never accumulate a badge --
          // but only once it has actually loaded. A screen whose initial
          // fetchThread failed never showed anything to read, and marking it
          // read anyway would clear a badge for a thread the member never
          // saw, the same way the initial load already gates this call.
          if (loadedRef.current) void markThreadRead(threadId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Keyed on `session?.user.id`, NOT `session`: lib/session.tsx hands out
    // a fresh Session object on every onAuthStateChange, TOKEN_REFRESHED
    // included, which fires within the hour and on web tab focus. Depending
    // on the object would re-subscribe on every refresh for a value that
    // only changes on a real account switch -- the same reasoning
    // lib/use-viewer.ts and app/profile.tsx already record for their own
    // effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, threadId]);

  const send = useCallback(async () => {
    if (sendingRef.current || !threadId) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    // `false` -- composing an announcement is gone from this screen (see
    // the component's own docstring), so this never posts one any more.
    // `postMessage`'s `announce` parameter itself is untouched, for the
    // redesign to reattach a UI to.
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      false,
      replyTo?.id ?? null,
    );
    if (refusal) {
      // Neither the draft NOR the quote is cleared. Losing what somebody
      // typed because the network failed is the worst possible response to a
      // failed send, and making them re-pick what they were answering is the
      // second worst. Cleared on this exit path too -- a ref set and never
      // cleared makes the composer permanently dead, which is worse than the
      // bug it guards against.
      sendingRef.current = false;
      setSending(false);
      setError(refusal);
      return;
    }
    setDraft('');
    setReplyTo(null);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, draft, replyTo, load]);

  // Friends first, then people from your clubs -- the identical shape and
  // ordering app/messages/new.tsx's own People picker uses (see that
  // screen's docstring on why: a friend acquired in a club one of you has
  // since left appears in neither club list). Reused here rather than a
  // second way of gathering who is addable to a conversation.
  const openAdding = useCallback(async () => {
    setAddError(null);
    setAddBusy(true);
    const [friends, people] = await Promise.all([
      fetchFriends(),
      fetchAddablePeople(),
    ]);
    setAddBusy(false);
    if (friends === null || people === null) {
      setAddError(GENERIC_ERROR);
      return;
    }
    // Already-in-the-thread people have nothing to be added to twice.
    const already = new Set(thread?.thread_members.map((m) => m.profile_id) ?? []);
    setCandidates([
      ...friends
        .filter((f) => !already.has(f.profile_id))
        .map((f) => ({ profile_id: f.profile_id, display_name: f.display_name, meta: 'Friend' })),
      ...people
        .filter((p) => !already.has(p.profile_id))
        .map((p) => ({ profile_id: p.profile_id, display_name: p.display_name, meta: p.club_name })),
    ]);
    setAddingOpen(true);
  }, [thread]);

  const addPicked = useCallback(async () => {
    if (addBusyRef.current || !threadId || pickedToAdd.length === 0) return;
    addBusyRef.current = true;
    setAddBusy(true);
    setAddError(null);
    const { error: refusal } = await addToGroupThread(threadId, pickedToAdd);
    addBusyRef.current = false;
    setAddBusy(false);
    if (refusal) {
      setAddError(refusal);
      return;
    }
    setPickedToAdd([]);
    setAddingOpen(false);
    // The roster shown has to include who was just added.
    await load();
  }, [threadId, pickedToAdd, load]);

  const leave = useCallback(async () => {
    if (leaveBusyRef.current || !threadId) return;
    leaveBusyRef.current = true;
    setLeaveBusy(true);
    setError(null);
    const { error: refusal } = await leaveGroupThread(threadId);
    leaveBusyRef.current = false;
    setLeaveBusy(false);
    if (refusal) {
      setLeaveConfirming(false);
      setError(refusal);
      return;
    }
    // Nothing left here to come back to -- the last member out takes the
    // thread with them, and even short of that, staying would show a
    // conversation this screen no longer has a roster row for.
    router.replace('/messages');
  }, [threadId, router]);

  // `contentSize.height` is react-native-web's own name for the textarea's
  // `scrollHeight` -- the real rendered height of the padding + text inside
  // it, not a guess. Clamped to [COMPOSER_HEIGHT, DRAFT_MAX_HEIGHT] so an
  // empty or one-line draft rests at the Send button's own height and a long
  // one grows only up to the existing cap, same as before.
  const handleDraftSize = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      setInputHeight(
        Math.min(DRAFT_MAX_HEIGHT, Math.max(COMPOSER_HEIGHT, e.nativeEvent.contentSize.height)),
      );
    },
    [],
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const title = thread ? threadTitleFor(thread, viewerId) : '';
  // Only a GROUP or DIRECT thread has members to list, add to, or leave —
  // a club or game thread's membership is derived (club_members / bookings),
  // never stored in thread_members, so there is nothing here to manage.
  const canManageMembers = thread !== null && thread.club_id === null;
  // A CLUB thread specifically (not a game, which also carries club_id) --
  // the one kind the empty state below can cheaply say something specific
  // about ("post the first one"). Every other kind gets the generic copy
  // rather than bespoke text per kind, which is not cheap: a game thread
  // would need its own event-aware line, a group/direct its own.
  const isClubThread = Boolean(thread?.club_id) && !thread?.event_id;
  // The header avatar's kind -- the same club_id/event_id/other-member-count
  // branches threadTitleFor above already reads, exported as threadKindFor
  // so this doesn't carry a second copy of that branching.
  const kind = thread ? threadKindFor(thread, viewerId) : null;
  const memberCount = thread?.thread_members.length ?? 0;
  const membersLabel = `${title}, ${memberCount} ${
    memberCount === 1 ? 'member' : 'members'
  }, view members`;

  return (
    <Screen contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      {/*
        The iOS Messages convention the owner asked for: a compact back
        chevron top-left, a circular avatar for the conversation centred
        beneath it, and the conversation's name in a rounded pill under
        that. The chevron always renders (it doesn't need `thread` to
        navigate away); the avatar and pill need a loaded thread to know
        what to show, so they wait for one.
      */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push('/messages')}
          accessibilityRole="button"
          accessibilityLabel="Back to Messages"
          style={styles.backButton}
        >
          <ChevronLeftIcon color={colors.text} size={22} />
        </Pressable>

        {thread && kind ? (
          <View style={styles.headerCenter}>
            <ThreadAvatar
              kind={kind}
              name={title}
              size={72}
              testID={`thread-header-avatar-${kind}`}
            />

            {/*
              The pill replaces the old pressable heading as the way into
              the members view. Its accessibilityLabel composes the title,
              the member count, and what pressing it does -- react-native-web's
              aria-label REPLACES the accessible name computed from a
              Pressable's children rather than merging with it, and this is
              the only place the thread's title reaches assistive tech at
              all now that the plain heading is gone, so the label has to
              carry it explicitly instead of leaning on the visible text.

              A club or game thread has no members view to open -- offering
              the identical pill as a Pressable with a trailing chevron
              anyway would be a control that LOOKS tappable and does
              nothing, worse than one that plainly isn't interactive at
              all. It renders as a plain, non-interactive label instead,
              with no chevron and no button role.
            */}
            {canManageMembers ? (
              <Pressable
                onPress={() => setMembersOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={membersLabel}
                style={styles.namePill}
              >
                <Text numberOfLines={1} style={styles.namePillText}>
                  {title}
                </Text>
                <ChevronRightIcon color={colors.text} size={14} />
              </Pressable>
            ) : (
              <View style={styles.namePill}>
                <Text numberOfLines={1} style={styles.namePillText}>
                  {title}
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          {canManageMembers && membersOpen && thread ? (
            <View style={styles.membersPanel}>
              {thread.thread_members.map((m) => (
                <Text key={m.profile_id} style={styles.memberName}>
                  {m.profiles?.display_name ?? 'Member'}
                </Text>
              ))}

              {addError ? <ErrorBanner message={addError} /> : null}

              {addingOpen ? (
                <>
                  {candidates.length === 0 ? (
                    <Text style={styles.membersHint}>Nobody else to add.</Text>
                  ) : (
                    candidates.map((c) => {
                      const picked = pickedToAdd.includes(c.profile_id);
                      return (
                        <Pressable
                          key={c.profile_id}
                          onPress={() =>
                            setPickedToAdd((cur) =>
                              cur.includes(c.profile_id)
                                ? cur.filter((x) => x !== c.profile_id)
                                : [...cur, c.profile_id],
                            )
                          }
                          accessibilityRole="button"
                          accessibilityLabel={c.display_name}
                          aria-selected={picked}
                          style={[
                            styles.candidateRow,
                            picked ? styles.candidateRowOn : null,
                          ]}
                        >
                          <Text style={styles.candidateName}>{c.display_name}</Text>
                          <Text style={styles.candidateMeta}>{c.meta}</Text>
                        </Pressable>
                      );
                    })
                  )}
                  <Button
                    big={false}
                    accessibilityLabel="Add"
                    disabled={addBusy || pickedToAdd.length === 0}
                    loading={addBusy}
                    onPress={() => void addPicked()}
                  >
                    Add
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  big={false}
                  accessibilityLabel="Add people"
                  disabled={addBusy}
                  loading={addBusy}
                  onPress={() => void openAdding()}
                >
                  Add people
                </Button>
              )}

              {/*
                Irreversible: the last member out deletes the thread and its
                messages (leave_group_thread's own comment). Same two-step
                confirmation Send already uses on this screen for an
                announcement -- the other action here that cannot be undone.
              */}
              <Button
                variant="destructive"
                big={false}
                accessibilityLabel={leaveConfirming ? 'Confirm leave' : 'Leave'}
                disabled={leaveBusy}
                loading={leaveBusy}
                onPress={() => {
                  if (!leaveConfirming) {
                    setLeaveConfirming(true);
                    return;
                  }
                  void leave();
                }}
              >
                {leaveConfirming ? 'Confirm' : 'Leave'}
              </Button>
            </View>
          ) : null}

          <ScrollView
            ref={scroller}
            // The same test-only handle components/Screen.tsx's own
            // `scroll` ScrollView carries — see its docstring. This screen
            // never passes `scroll` to <Screen> (the message list needs its
            // OWN independent scroller, not the page's), so nothing else on
            // this screen renders that testID; e2e/visual.spec.ts's
            // `captureScreen` finds THIS ScrollView instead and grows the
            // viewport to fit every message rather than screenshotting
            // whatever `scrollToEnd` below left on screen.
            testID="screen-scroll"
            style={styles.scroller}
            onContentSizeChange={() =>
              scroller.current?.scrollToEnd({ animated: false })
            }
          >
            {/*
              A club or group thread with nothing posted yet used to render
              as an enormous blank region between the title and the composer
              -- the same dashed-border empty card app/messages/index.tsx and
              app/friends.tsx already use for "nothing here yet", rather than
              silence. Only the club case gets bespoke copy (`isClubThread`
              above); every other kind gets the generic line, since writing a
              correct bespoke line for a game thread (which would want its
              own date-aware copy) or a group/direct is not cheap the way the
              club one is.
            */}
            {messages.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  {isClubThread
                    ? 'No messages yet. Post the first one below.'
                    : 'No messages yet. Say hello to start the conversation.'}
                </Text>
              </View>
            ) : null}

            {messages.map((m, i) => {
              const mine = m.author_id === viewerId;
              // iOS Messages carries no time inside a bubble at all -- time
              // lives here instead, in a centred separator above the first
              // message of a new group (lib/messages.ts's `startsNewGroup`),
              // not repeated on every bubble the way this screen used to.
              const previous = i > 0 ? messages[i - 1] : null;
              const newGroup = startsNewGroup(m.created_at, previous?.created_at ?? null);
              return (
                <Fragment key={m.id}>
                  {newGroup ? (
                    <Text style={styles.separator}>
                      {groupSeparatorLabel(m.created_at)}
                    </Text>
                  ) : null}
                  <MessageBubble message={m} mine={mine} onReply={setReplyTo} />
                </Fragment>
              );
            })}
          </ScrollView>

          {replyTo ? (
            <View style={styles.replyingRow}>
              <Text numberOfLines={1} style={styles.replyingText}>
                {quoteStub(replyTo)}
              </Text>
              <Pressable
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Text style={styles.replyingCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.composer}>
            <TextInput
              style={[styles.input, { height: inputHeight }]}
              value={draft}
              onChangeText={setDraft}
              onContentSizeChange={handleDraftSize}
              placeholder="Message"
              accessibilityLabel="Message"
              multiline
              // Without this, react-native-web's own default (no `rows`/
              // `numberOfLines` given) leaves the underlying `<textarea>`'s
              // `rows` attribute unset, and an unset `<textarea rows>`
              // renders 2 browser-default rows -- taller than the 58px
              // resting height this screen needs to match the Send button,
              // before a single character has even been typed.
              // `numberOfLines`, not the newer `rows` prop react-native-web
              // also accepts: `rows` is not in @types/react-native's
              // `TextInputProps` at all, and `numberOfLines` is the same
              // prop TextField.tsx already uses for this exact job.
              // `handleDraftSize` still grows the box from here for a long
              // draft.
              numberOfLines={1}
            />
            <Pressable
              // A single tap posts an ordinary message. Composing an
              // announcement -- and the two-step Send/Confirm arming that
              // existed only for it -- is gone from this screen (see the
              // component's own docstring).
              onPress={() => void send()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={sending}
              style={styles.send}
            >
              <SendIcon />
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3], flex: 1 },
  centered: { alignItems: 'center' },
  // The iOS Messages header: back chevron pinned top-left via absolute
  // positioning against this `relative` container, avatar + name pill
  // centred beneath it. Absolute positioning (rather than a mirrored spacer
  // View the same width as the chevron) keeps the centred column exactly
  // centred on the screen's own width regardless of the chevron's size.
  header: {
    position: 'relative',
    alignItems: 'center',
    paddingBottom: space[2],
  },
  // 44x44: below this screen's usual 58px "big" targets (this is a compact
  // header control, not a primary action), but still at the common minimum
  // touch-target size rather than a bare icon-sized hit area.
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center', gap: space[2] },
  // colors.surface, the same pill/panel ground this file already uses for
  // `replyingRow` and `membersPanel` below -- reused rather than a fresh
  // token. Capped so `namePillText`'s `numberOfLines={1}` has a width to
  // actually truncate against for a long thread name.
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    maxWidth: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  // colors.text on colors.surface reads 12.40:1 -- comfortably past AA's
  // 4.5:1 for this 16px text, and the same pairing this file's own
  // `memberName`/`candidateName` below already use on this exact ground, so
  // this is not a new pairing.
  namePillText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  scroller: { flex: 1 },
  // The same dashed-border empty card app/messages/index.tsx and
  // app/friends.tsx already use, reused rather than a third near-identical
  // pair of styles.
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
  membersPanel: {
    gap: space[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space[4],
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  membersHint: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: space[3],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // accent[700], not the artboard's accentColor: colors.bg on accentColor
  // measures 3.030:1, a 0.03 margin over the 3:1 non-text bar that
  // lib/theme.test.ts had no pin for. Selection is also conveyed by
  // aria-selected, so this was never a correctness bug, but a margin that
  // thin is exactly what the existing pins exist to prevent. accent[700] on
  // colors.bg reads 5.72:1 and is already pinned there (the same pairing
  // this file's `mine` bubble and `send` button use), so this reuses
  // headroom that exists rather than adding a new pin for a fresh pairing.
  candidateRowOn: { borderColor: colors.accent[700] },
  candidateName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  candidateMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  // The iOS Messages convention this screen now follows: no time inside any
  // bubble (the three `timestamp*` styles this replaced each put it in a
  // bubble's own corner, on that bubble's own ground -- gone along with the
  // per-bubble render). Instead, a single centred line sits between groups
  // of messages, small (`type.size.helper`, this app's one sanctioned
  // exception below its 18pt body minimum) and muted so it recedes rather
  // than competing with the bubbles either side of it. It always sits on
  // `colors.bg` -- the screen's own page background, never a bubble's --
  // so one colour suffices where the old per-bubble version needed three:
  // `colors.textMuted` reads 5.15:1 there, already pinned in
  // lib/theme.test.ts for exactly this ground.
  separator: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: space[3],
    marginBottom: space[2],
  },
  replyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
  },
  replyingText: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  replyingCancel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  // Height is NOT set here -- it's driven by `inputHeight` state at the call
  // site (see `handleDraftSize`'s own comment), because `minHeight` alone is
  // exactly what let this box render taller than the 58px Send button beside
  // it: react-native-web's multiline `TextInput` is a `<textarea>`, which
  // has its own intrinsic row height independent of `minHeight`.
  //
  // `paddingVertical: 17` and `lineHeight: 24` are deliberately literal, not
  // pulled from the `space`/`type` scales: their SUM has to land on exactly
  // `COMPOSER_HEIGHT` (58) for the placeholder/first line to sit centred at
  // rest. A `<textarea>` does not centre its own content vertically the way
  // a plain `<input>` does (this is the artboard's `<input class="input
  // bigin">`, singular-line, not a growing textarea) — the only way to get
  // that centred look out of one is to leave no slack: equal top/bottom
  // padding plus a line-height that together exactly fill the box, so there
  // is no extra space left over for the text to be top-aligned within.
  input: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    paddingVertical: 17,
    lineHeight: 24,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  // The artboard's 58x58 circular icon button -- accent[700], not
  // accentColor: colors.bg on accentColor measures 3.03:1 and fails AA at
  // this size; accent[700] reads 5.72:1 (already pinned in
  // lib/theme.test.ts for this exact bubble/button pairing).
  send: {
    width: COMPOSER_HEIGHT,
    height: COMPOSER_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
