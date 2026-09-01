import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Composer from '../../components/messages/Composer';
import ErrorBanner from '../../components/ErrorBanner';
import MembersPanel from '../../components/messages/MembersPanel';
import MessageBubble from '../../components/messages/MessageBubble';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import ThreadAvatar from '../../components/ThreadAvatar';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  fetchThread,
  fetchThreadMessages,
  groupSeparatorLabel,
  markThreadRead,
  postMessage,
  startsNewGroup,
  threadKindFor,
  threadTitleFor,
  type ThreadDetail,
  type ThreadMessage,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';
import { useThreadRealtime } from '../../lib/use-thread-realtime';

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
export default function ThreadScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const viewerId = session?.user.id ?? '';

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
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
  // Only the mount switch stays here -- MembersPanel owns everything else
  // about opening Add people and leaving.
  const [membersOpen, setMembersOpen] = useState(false);
  // Set alongside `thread`/`error`, not derived from them: useThreadRealtime
  // below subscribes regardless of whether the initial load succeeded, and
  // its onInsert callback needs to know -- at the moment an event actually
  // arrives -- whether the screen ever loaded, not what some earlier
  // render's closure happened to capture.
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

  useThreadRealtime(
    threadId,
    session?.user.id,
    useCallback(() => {
      // Refetch rather than appending the payload row: the payload carries
      // author_id but not the joined display_name, and a bubble that
      // renders anonymously and then re-renders with a name is worse than
      // one that arrives a beat later complete.
      void fetchThreadMessages(threadId).then((rows) => {
        if (rows) setMessages(rows);
      });
      // A conversation you are watching must never accumulate a badge --
      // but only once it has actually loaded. A screen whose initial
      // fetchThread failed never showed anything to read, and marking it
      // read anyway would clear a badge for a thread the member never saw,
      // the same way the initial load already gates this call.
      if (loadedRef.current) void markThreadRead(threadId);
    }, [threadId]),
  );

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
            <MembersPanel thread={thread} onChanged={load} onLeaveError={setError} />
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

          <Composer
            draft={draft}
            onDraftChange={setDraft}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={() => void send()}
            sending={sending}
          />
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
  // colors.surface, the same pill/panel ground Composer's `replyingRow` and
  // MembersPanel's own `membersPanel` reuse -- not a fresh token. Capped so
  // `namePillText`'s `numberOfLines={1}` has a width to actually truncate
  // against for a long thread name.
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
  // 4.5:1 for this 16px text, and the same pairing MembersPanel's own
  // `memberName`/`candidateName` already use on this exact ground, so this
  // is not a new pairing.
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
});
