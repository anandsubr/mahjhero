import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Composer from '../../components/messages/Composer';
import ConversationHeader from '../../components/messages/ConversationHeader';
import ConversationMessages from '../../components/messages/ConversationMessages';
import ErrorBanner from '../../components/ErrorBanner';
import MembersPanel from '../../components/messages/MembersPanel';
import Screen from '../../components/Screen';
import { getSignedUrls } from '../../lib/attachments';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  fetchThread,
  fetchThreadMessages,
  markThreadRead,
  postMessage,
  threadKindFor,
  threadTitleFor,
  type MessageAttachmentInput,
  type ThreadDetail,
  type ThreadMessage,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';
import { useThreadRealtime } from '../../lib/use-thread-realtime';

/**
 * The `1C thread` artboard.
 *
 * This screen subscribes to Realtime through `lib/use-thread-realtime.ts`,
 * the same hook the board and post screens call — three subscribers now, not
 * one. `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what `can_read_thread` allows — there is no
 * second authorization surface. Subscribing across every thread would keep
 * badges live at the cost of a connection held for the whole session and the
 * hardest thing in the plan to test; the list refetches on focus instead.
 *
 * Laid out to the Messages 2a handoff: a compact one-row header
 * (components/messages/ConversationHeader.tsx), runs of messages grouped by
 * sender (components/messages/ConversationMessages.tsx), and a pill
 * composer. The tab bar is hidden while inside a conversation, on the
 * handoff's call -- the header's back chevron is the way out.
 *
 * The composer's "Also email everyone" toggle and its two-step Send/Confirm
 * arming are gone too, on the owner's call: they intend to redesign how
 * announcing works and found the toggle's treatment unpleasant. Only
 * COMPOSING an announcement goes — an announcement already posted (a
 * migration backfilled every historical broadcast into its thread) still
 * renders in full below, and `postMessage`'s `announce` parameter,
 * `post_message`, `broadcast_recipients`, and the outbox fan-out are all
 * untouched underneath this screen, for the redesign to reattach a UI to.
 * `countBroadcastRecipients` (lib/broadcasts.ts) loses its caller here — it
 * is called from `app/messages/club/new.tsx` now, for the same recipient
 * count shown before an announcement is sent.
 */
export default function ThreadScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const viewerId = session?.user.id ?? '';

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  // `storage_path` -> signed URL, for every attachment across every message
  // currently loaded -- resolved in ONE `getSignedUrls` call per load (the
  // effect below), not one call per message. See AttachmentGrid's own
  // `urls` prop docstring for the batching bug this replaced.
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  // The message being answered, held whole rather than as an id so the
  // composer can show its stub without hunting back through `messages`.
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachmentInput[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [attachmentsResetKey, setAttachmentsResetKey] = useState(0);
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

  // Keyed on the viewer's id, not the `session` OBJECT: lib/session.tsx hands
  // out a fresh `Session` on every onAuthStateChange, TOKEN_REFRESHED
  // included -- within the hour, and on web tab focus -- and none of that
  // changes who is asking. The realtime effect below already learned this
  // (see its own regression test); this one refetched the whole conversation
  // on every refresh.
  useEffect(() => {
    if (!session?.user.id) return;
    void load();
  }, [session?.user.id, load]);

  // The one `getSignedUrls` call per screen load: every attachment path
  // across every message currently in `messages`, gathered here rather than
  // inside AttachmentGrid (which is mounted once PER MESSAGE via
  // MessageBubble, and would otherwise fire one request per bubble). Runs
  // again whenever `messages` changes -- a send, a realtime insert -- but
  // getSignedUrls' own module-level cache means a path already signed this
  // session is never re-requested, only genuinely new ones are.
  useEffect(() => {
    const paths = Array.from(
      new Set(messages.flatMap((m) => m.attachments.map((a) => a.storage_path))),
    );
    if (paths.length === 0) return;
    let cancelled = false;
    void getSignedUrls(paths).then((resolved) => {
      if (!cancelled) setAttachmentUrls((prev) => ({ ...prev, ...resolved }));
    });
    return () => {
      cancelled = true;
    };
  }, [messages]);

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
    if (sendingRef.current || attachmentsPending || !threadId) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    // `false` -- composing an announcement is gone from this screen (see
    // the component's own docstring), so this never posts one any more.
    // `postMessage`'s `announce` parameter itself is untouched, for the
    // redesign to reattach a UI to. `null` for `rootId` -- this screen never
    // replies inside a club post.
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      false,
      replyTo?.id ?? null,
      null,
      attachments,
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
    setAttachments([]);
    setAttachmentsResetKey((k) => k + 1);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, draft, replyTo, attachments, attachmentsPending, load]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  /*
   * A club's conversation is a BOARD of root posts now, not a flat chat, and
   * this screen cannot serve one: its composer writes a message with no
   * `root_id`, which on a club thread silently creates a new junk POST per
   * line; it has no Announcement control (that lives on the compose screen);
   * long-pressing to quote is refused outright by `post_message`; and the
   * read marker it writes is `thread_reads`, which `fetch_my_threads`' club
   * branch stopped consulting, so the badge never clears.
   *
   * Every route that led here was repointed at the board, but a history
   * entry, a bookmark, or a link shared before the change still names this
   * URL. Catching it here is what makes the flat screen unreachable for a
   * club thread however it was reached, rather than only from the call sites
   * anybody remembered to change.
   *
   * Placed after the thread has LOADED, deliberately: `club_id` is what
   * decides this and it arrives with `fetchThread`. Until then the screen is
   * still rendering its own spinner (`ready` is false), so nothing of the
   * flat conversation is ever painted on the way past.
   */
  if (thread && thread.club_id && !thread.event_id) {
    return <Redirect href={`/messages/club/${thread.id}`} />;
  }

  const title = thread ? threadTitleFor(thread, viewerId) : '';
  // Only a GROUP or DIRECT thread has members to list, add to, or leave —
  // a club or game thread's membership is derived (club_members / bookings),
  // never stored in thread_members, so there is nothing here to manage.
  const canManageMembers = thread !== null && thread.club_id === null;
  // The header avatar's kind -- the same club_id/event_id/other-member-count
  // branches threadTitleFor above already reads, exported as threadKindFor
  // so this doesn't carry a second copy of that branching.
  const kind = thread ? threadKindFor(thread, viewerId) : null;
  const memberCount = thread?.thread_members.length ?? 0;
  const memberCountText = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`;
  const membersLabel = `${title}, ${memberCountText}, view members`;

  return (
    <Screen contentStyle={styles.container}>
      {/*
        The back chevron always renders (it doesn't need `thread` to
        navigate away); the avatar and name wait for a loaded thread.

        Only a group or direct thread has a members view to open, so only
        those get a tappable name and the overflow button -- a club or game
        thread's header is plain. The member count goes under a group's
        name in place of the handoff's "Active now", which needs presence
        data the app doesn't have; a direct thread's count is always two
        and says nothing.
      */}
      <ConversationHeader
        onBack={() => router.push('/messages')}
        backLabel="Back to Messages"
        kind={thread ? kind : null}
        title={title}
        subtitle={kind === 'group' ? memberCountText : null}
        onOpenDetails={canManageMembers ? () => setMembersOpen((v) => !v) : undefined}
        detailsLabel={membersLabel}
      />

      {error ? (
        <View style={styles.inset}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} style={styles.spinner} />
      ) : (
        <>
          {canManageMembers && membersOpen && thread ? (
            <View style={styles.inset}>
              <MembersPanel thread={thread} onChanged={load} onLeaveError={setError} />
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
            contentContainerStyle={styles.list}
            onContentSizeChange={() =>
              scroller.current?.scrollToEnd({ animated: false })
            }
          >
            {/*
              A thread with nothing posted yet used to render as an enormous
              blank region between the title and the composer -- the same
              dashed-border empty card app/messages/index.tsx and
              app/friends.tsx already use for "nothing here yet", rather than
              silence. One line for every kind this screen still serves: the
              club case that once earned bespoke copy is redirected to the
              board above and can no longer reach here, and writing a correct
              bespoke line for a game thread (which would want its own
              date-aware copy) or a group/direct is not cheap the way the
              club one was.
            */}
            {messages.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  No messages yet. Say hello to start the conversation.
                </Text>
              </View>
            ) : null}

            <ConversationMessages
              messages={messages}
              viewerId={viewerId}
              onReply={setReplyTo}
              attachmentUrls={attachmentUrls}
            />
          </ScrollView>

          <Composer
            draft={draft}
            onDraftChange={setDraft}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={() => void send()}
            sending={sending || attachmentsPending}
            threadId={threadId ?? ''}
            onAttachmentsChange={(ready, pending) => {
              setAttachments(ready);
              setAttachmentsPending(pending);
            }}
            attachmentsResetKey={attachmentsResetKey}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Edge to edge: the header's divider and the message list run the full
  // column width, each setting its own side padding per the handoff.
  container: { flex: 1 },
  centered: { alignItems: 'center' },
  inset: { paddingHorizontal: 14, paddingTop: 8 },
  spinner: { marginTop: 16 },
  scroller: { flex: 1 },
  list: { gap: 18, paddingTop: 8, paddingBottom: 12 },
  // The same dashed-border empty card app/messages/index.tsx and
  // app/friends.tsx already use.
  emptyCard: {
    marginHorizontal: 14,
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
});
