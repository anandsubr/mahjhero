import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Composer from '../../../../components/messages/Composer';
import CompactHeader from '../../../../components/CompactHeader';
import ConversationMessages from '../../../../components/messages/ConversationMessages';
import ErrorBanner from '../../../../components/ErrorBanner';
import Screen from '../../../../components/Screen';
import { getSignedUrls } from '../../../../lib/attachments';
import { GENERIC_ERROR } from '../../../../lib/constants';
import {
  fetchPostMessages,
  fetchThread,
  markPostRead,
  postMessage,
  threadKindFor,
  threadTitleFor,
  type MessageAttachmentInput,
  type ThreadDetail,
  type ThreadMessage,
} from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { colors } from '../../../../lib/theme';
import { useThreadRealtime } from '../../../../lib/use-thread-realtime';

/**
 * One post: its root, its replies, and a composer that always writes INTO
 * this post -- `rootId` (the URL's `postId`) never changes while this
 * screen is mounted.
 *
 * `replyTo` is a different thing and still works: it names which MESSAGE a
 * reply quotes (`reply_to_id`), not which POST it belongs to (`root_id`).
 * Quoting an earlier reply from inside the same post is normal, so `send`
 * below passes both independently -- `postId` as the fifth argument on every
 * call, `replyTo?.id` as the fourth only when one is picked.
 *
 * Read-marking lives here, gated by `load()`'s own early return, rather
 * than on the board: opening the board is not reading any post on it (the
 * board screen's own docstring), and a screen whose initial fetch failed
 * never showed anything to read -- `markPostRead` sits after the only
 * `return` in `load()`, so a failed fetch can never reach it, whether that
 * fetch runs on the initial mount or on a later refetch the realtime
 * subscription below triggers (it re-enters `load()` from the top, not a
 * lower-level fetch that bypasses the guard).
 *
 * The realtime subscription (lib/use-thread-realtime.ts) is thread-wide, not
 * per-post -- there is one channel per open thread, not one per post, the
 * same channel the board itself would subscribe on if it stayed open. A
 * message posted into ANOTHER post on this board fires the same `onInsert`
 * and refetches this post for nothing; that refetch is cheap
 * (`fetch_post_messages` returns only this root and its replies) and there
 * is no payload field to filter on that would make skipping it worthwhile.
 *
 * Carries the club's name and avatar in its header, not just a bare
 * chevron -- the compact conversation header (Messages 2a handoff), the
 * same one the thread screen uses, with no tab bar under the composer. A post can be reached directly (a
 * deep link, a notification, a bookmark) without ever passing through the
 * board, and a member arriving that way has exactly the same "which club is
 * this" problem the board itself shipped with. The chevron still returns to
 * the board rather than to `/messages` -- one level up, not two -- and a
 * fresh best-effort `fetchThread` supplies the name and avatar the board's
 * own read already would have if this screen had been reached through it.
 */
export default function PostScreen() {
  const { session, loading } = useSession();
  const { threadId, postId } = useLocalSearchParams<{
    threadId: string;
    postId: string;
  }>();
  const router = useRouter();
  const viewerId = session?.user.id ?? '';

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  // `storage_path` -> signed URL, for every attachment across every message
  // currently loaded -- resolved in ONE `getSignedUrls` call per load (the
  // effect below), not one call per message. See AttachmentGrid's own
  // `urls` prop docstring for the batching bug this replaced, and
  // app/messages/[threadId].tsx's identical effect for the flat thread
  // screen's own copy of this.
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  // A best-effort read for the header alone -- see this screen's own
  // docstring on why it duplicates the board's `fetchThread` call rather
  // than trusting a value handed down from it. Its own success or failure
  // is independent of `messages`/`loadError` below: a member reading a
  // post that loaded fine must not lose it because this second, unrelated
  // read failed, and the header degrades to its bare chevron in exactly
  // that case (see the render below).
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  /*
   * Two slots, the same split app/messages/index.tsx keeps between
   * `loadError` and `actionError`, and here it is load-bearing rather than
   * tidy: `load()` clears the error it owns, and the realtime subscription
   * below calls `load()` on EVERY insert anywhere in this thread. With one
   * shared slot, somebody else posting into an unrelated post on this board
   * erased the refusal a member's own failed send had just produced, while
   * their unsent draft still sat in the composer with no explanation of why
   * it had not gone.
   *
   * A refusal is relayed verbatim, so `actionError` is whatever post_message
   * said; `loadError` is only ever GENERIC_ERROR.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachmentInput[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [attachmentsResetKey, setAttachmentsResetKey] = useState(0);
  // Written SYNCHRONOUSLY alongside `setSending`, the same pattern
  // app/messages/[threadId].tsx's own `sendingRef` records: `sending` read
  // from the render closure is blind to a second activation landing before
  // that render commits. Cleared on every exit path below -- a ref set and
  // never cleared makes the composer permanently dead, worse than the bug
  // it guards against.
  const sendingRef = useRef(false);

  const load = useCallback(async () => {
    if (!postId) return;
    const rows = await fetchPostMessages(postId);
    // fetchPostMessages never rejects: null means "we could not ask". `[]`
    // is not a real state here -- a post always contains at least its own
    // root row -- so it is folded into the same failure the null case
    // already handles rather than rendered as a blank, memberless post.
    if (rows === null || rows.length === 0) {
      setLoadError(GENERIC_ERROR);
      setReady(true);
      return;
    }
    // Only this screen's own load failure is cleared here. A send refusal
    // belongs to `actionError` and survives every refetch -- see the two
    // slots' own comment above.
    setLoadError(null);
    setMessages(rows);
    setReady(true);
    // The only call site, and it is unreachable from a failed fetch: the
    // branch above already returned. No ref is needed to remember that
    // across a later refetch either -- the realtime subscription below
    // re-enters `load()` from the top, so its own fetch hits the same
    // early return on its own failure.
    void markPostRead(postId);
  }, [postId]);

  // Keyed on the viewer's id, not the `session` OBJECT: lib/session.tsx hands
  // out a fresh `Session` on every onAuthStateChange, TOKEN_REFRESHED
  // included -- hourly, and on web tab focus -- and none of that changes who
  // is asking. `load` is already stable on `postId`.
  useEffect(() => {
    if (!session?.user.id) return;
    void load();
  }, [session?.user.id, load]);

  // Kept out of `load()` above on purpose: `load()` re-enters on every
  // realtime insert anywhere in this thread (see the subscription below),
  // and refetching the thread's name/avatar on every message posted
  // anywhere on the board would be a lot of asking for a value that never
  // changes while this screen is mounted. Runs once per thread instead,
  // the same shape the board's own `fetchThread` effect uses.
  useEffect(() => {
    if (!session?.user.id || !threadId) return;
    let cancelled = false;
    void fetchThread(threadId).then((detail) => {
      if (!cancelled) setThread(detail);
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the viewer's id, not the `session` object -- see
    // lib/session.tsx's docstring: a token refresh hands out a fresh
    // `Session` that changes nothing about who is asking.
  }, [session?.user.id, threadId]);

  // The one `getSignedUrls` call per screen load: every attachment path
  // across every message currently in `messages`, gathered here rather than
  // inside AttachmentGrid (which is mounted once PER MESSAGE via
  // MessageBubble, and would otherwise fire one request per bubble). Runs
  // again whenever `messages` changes -- a send, a realtime-triggered
  // reload -- but getSignedUrls' own module-level cache means a path
  // already signed this session is never re-requested, only genuinely new
  // ones are.
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
      void load();
    }, [load]),
  );

  const send = useCallback(async () => {
    if (sendingRef.current || attachmentsPending || !threadId || !postId) return;
    sendingRef.current = true;
    setSending(true);
    setActionError(null);
    // `false` -- an announcement is always a NEW post, never a reply;
    // post_message refuses the combination outright ('only a new post can
    // be an announcement').
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      false,
      replyTo?.id ?? null,
      postId,
      attachments,
    );
    if (refusal) {
      // Neither the draft NOR the quote is cleared. Losing what somebody
      // typed because the network failed is the worst possible response to
      // a failed send, and making them re-pick what they were answering is
      // the second worst.
      sendingRef.current = false;
      setSending(false);
      setActionError(refusal);
      return;
    }
    setDraft('');
    setReplyTo(null);
    setAttachments([]);
    setAttachmentsResetKey((k) => k + 1);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, postId, draft, replyTo, attachments, attachmentsPending, load]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  // actionError first: it names what the member just tried to send, which is
  // more useful in the moment than a standing load failure -- the same
  // precedence app/messages/index.tsx applies to its own two slots.
  const error = actionError ?? loadError;

  const title = thread ? threadTitleFor(thread, viewerId) : '';
  const kind = thread ? threadKindFor(thread, viewerId) : null;

  return (
    <Screen contentStyle={styles.container}>
      {/*
        The chevron goes to the board, not `/messages`: this screen is one
        level below the board, not two below the list. A post has no members
        view, so the name is plain and there is no overflow button.
      */}
      <CompactHeader
        onBack={() => router.push(`/messages/club/${threadId}`)}
        backLabel="Back to board"
        kind={thread ? kind : null}
        title={title}
        clubId={thread?.club_id}
      />

      {/* The alert role lives inside ErrorBanner now -- see its docstring. */}
      {error ? (
        <View style={styles.inset}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} style={styles.spinner} />
      ) : (
        <>
          <ScrollView
            testID="screen-scroll"
            style={styles.scroller}
            contentContainerStyle={styles.list}
          >
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
  // Edge to edge, the same as app/messages/[threadId].tsx: the header and
  // the message list set their own side padding.
  container: { flex: 1 },
  centered: { alignItems: 'center' },
  inset: { paddingHorizontal: 14, paddingTop: 8 },
  spinner: { marginTop: 16 },
  scroller: { flex: 1 },
  list: { gap: 18, paddingTop: 8, paddingBottom: 12 },
});
