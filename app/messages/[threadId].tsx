import { useCallback, useEffect, useRef, useState } from 'react';
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
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import Tag from '../../components/Tag';
import Toggle from '../../components/Toggle';
import { ChevronLeftIcon } from '../../components/icons';
import { countBroadcastRecipients } from '../../lib/broadcasts';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  deriveSubject,
  fetchThread,
  fetchThreadMessages,
  markThreadRead,
  postMessage,
  quoteStub,
  threadTitleFor,
  type ThreadDetail,
  type ThreadMessage,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { supabase } from '../../lib/supabase';
import { colors, radius, space, type } from '../../lib/theme';

/**
 * The `1C thread` artboard.
 *
 * This is the app's only Realtime subscriber, and deliberately the only one.
 * `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what `can_read_thread` allows — there is no
 * second authorization surface. Subscribing across every thread would keep
 * badges live at the cost of a connection held for the whole session and the
 * hardest thing in the plan to test; the list refetches on focus instead.
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
  const [announce, setAnnounce] = useState(false);
  // The message being answered, held whole rather than as an id so the
  // composer can show its stub without hunting back through `messages`.
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  // Asked of the database when the toggle goes on, not counted from local
  // state: a count derived from a stale roster would make the confirmation
  // a lie. countBroadcastRecipients and the fan-out inside post_message
  // resolve their recipients through the same broadcast_recipients function,
  // so they cannot disagree. Null means "we could not ask" — the note then
  // omits the number rather than claiming zero.
  const [recipients, setRecipients] = useState<number | null>(null);
  // An announcement is irreversible and outward-facing. Send asks once.
  const [confirming, setConfirming] = useState(false);
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

    const channel = supabase
      .channel(`thread:${threadId}`)
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
  }, [session, threadId]);

  const send = useCallback(async () => {
    if (sendingRef.current || !threadId) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const { error: refusal } = await postMessage(
      threadId,
      draft,
      announce,
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
    setAnnounce(false);
    setReplyTo(null);
    setRecipients(null);
    setConfirming(false);
    await load();
    sendingRef.current = false;
    setSending(false);
  }, [threadId, draft, announce, replyTo, load]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const title = thread ? threadTitleFor(thread, viewerId) : '';
  // Only a club or game thread has a roster to announce to. Whether the
  // viewer is an organizer is the database's question — post_message calls
  // assert_club_organizer — so the toggle is offered on the right KIND of
  // thread and the refusal, if any, is surfaced as words.
  const canAnnounce = Boolean(thread?.club_id);

  return (
    <Screen contentStyle={styles.container}>
      <Pressable
        onPress={() => router.push('/messages')}
        accessibilityRole="button"
        accessibilityLabel="Messages"
        style={styles.back}
      >
        <ChevronLeftIcon color={colors.text} />
        <Text style={styles.backText}>Messages</Text>
      </Pressable>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          <Text style={styles.heading}>{title}</Text>

          <ScrollView
            ref={scroller}
            style={styles.scroller}
            onContentSizeChange={() =>
              scroller.current?.scrollToEnd({ animated: false })
            }
          >
            {messages.map((m) => {
              const mine = m.author_id === viewerId;
              return (
                <View
                  key={m.id}
                  style={[
                    styles.bubble,
                    mine ? styles.mine : styles.theirs,
                    m.is_announcement ? styles.announcement : null,
                  ]}
                >
                  {!mine && !m.is_announcement ? (
                    <Text style={styles.author}>
                      {m.profiles?.display_name ?? ''}
                    </Text>
                  ) : null}
                  {m.is_announcement ? (
                    <View style={styles.announcementHead}>
                      <Tag variant="accent2">Announcement</Tag>
                      {m.subject ? (
                        <Text style={styles.subject}>{m.subject}</Text>
                      ) : null}
                    </View>
                  ) : null}

                  {/*
                    Rendered from `reply_to`, not from `reply_to_id`. The key
                    is `on delete set null`, so a reply can outlive what it
                    answered — and an empty quote box is worse than none.
                  */}
                  {m.reply_to ? (
                    <Text
                      testID="quote-stub"
                      numberOfLines={1}
                      style={[
                        styles.stub,
                        m.is_announcement
                          ? styles.stubAnnouncement
                          : mine
                            ? styles.stubMine
                            : null,
                      ]}
                    >
                      {quoteStub(m.reply_to)}
                    </Text>
                  ) : null}

                  <Text
                    style={
                      m.is_announcement
                        ? styles.bodyAnnouncement
                        : mine
                          ? styles.bodyMine
                          : styles.body
                    }
                  >
                    {m.body}
                  </Text>

                  <Pressable
                    onPress={() => setReplyTo(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Reply to ${m.profiles?.display_name ?? 'this message'}`}
                    style={styles.replyAction}
                  >
                    <Text
                      style={[
                        styles.replyText,
                        m.is_announcement
                          ? styles.stubAnnouncement
                          : mine
                            ? styles.stubMine
                            : null,
                      ]}
                    >
                      Reply
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          {canAnnounce ? (
            <View style={styles.announceRow}>
              <Toggle
                value={announce}
                onValueChange={(next) => {
                  setAnnounce(next);
                  setConfirming(false);
                  if (!next || !thread?.club_id) {
                    setRecipients(null);
                    return;
                  }
                  void countBroadcastRecipients(
                    thread.club_id,
                    thread.event_id,
                  ).then(setRecipients);
                }}
                accessibilityLabel="Also email everyone"
              />
              <Text style={styles.announceLabel}>Also email everyone</Text>
            </View>
          ) : null}

          {announce && draft.trim() ? (
            <Text style={styles.announceNote}>
              {recipients === null
                ? `Emails the club with the subject: ${deriveSubject(draft)}`
                : `Emails ${recipients} ${recipients === 1 ? 'member' : 'members'}, subject: ${deriveSubject(draft)}`}
            </Text>
          ) : null}

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
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              accessibilityLabel="Message"
              multiline
            />
            <Pressable
              onPress={() => {
                // An ordinary message sends on one tap. An announcement mails
                // people and cannot be unsent, so it asks first — the same
                // second tap the deleted broadcast compose screen required.
                if (announce && !confirming) {
                  setConfirming(true);
                  return;
                }
                void send();
              }}
              accessibilityRole="button"
              accessibilityLabel={announce && confirming ? 'Confirm send' : 'Send'}
              disabled={sending}
              style={styles.send}
            >
              <Text style={styles.sendText}>
                {announce && confirming ? 'Confirm' : 'Send'}
              </Text>
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
  back: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  backText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h3,
    color: colors.text,
  },
  scroller: { flex: 1 },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[2],
  },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  // accent[700], not the artboard's accentColor: colors.bg on accentColor
  // measures 3.03:1, and this bubble's body text is 18px regular — needing
  // AA's 4.5:1, not the 3:1 large-text allowance (which needs 24px regular
  // or 18.66px actual-bold, neither of which this is). It fails. accent[700]
  // reads 5.72:1 against colors.bg and clears AA — same failure, same fix,
  // as components/UnreadBadge.tsx's pill.
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent[700] },
  announcement: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    backgroundColor: colors.accent2[100],
  },
  announcementHead: { gap: space[2], marginBottom: space[2] },
  subject: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.accent2[800],
  },
  author: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.accent2[700],
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.text,
  },
  bodyMine: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.bg,
  },
  // The announcement background (accent2[100]) always wins over `mine`'s in
  // the bubble's own style array above, regardless of who sent it -- an
  // organizer's own announcement reloads with is_announcement=true AND
  // author_id===viewerId every single time, so `mine` cannot be what decides
  // this text's colour. accent2[800] on accent2[100] measures 9.12:1, well
  // past AA's 4.5:1 for this 18px regular body text -- the same token the
  // subject line below already uses on this ground. lib/theme.test.ts pins
  // the ratio.
  bodyAnnouncement: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.accent2[800],
  },
  stub: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent2[500],
    paddingLeft: space[2],
    marginBottom: space[2],
  },
  // On the accent bubble the muted tone is unreadable; bg at this size is
  // the same choice the bubble body already makes.
  stubMine: { color: colors.bg, borderLeftColor: colors.bg },
  // Same reasoning as bodyAnnouncement just above: an announcement's quote
  // stub and its Reply label need the dark tone whenever is_announcement is
  // true, not only when the viewer didn't send it. Reused rather than a
  // third near-duplicate style, since both call sites want the same colour.
  stubAnnouncement: { color: colors.accent2[800], borderLeftColor: colors.accent2[500] },
  replyAction: { alignSelf: 'flex-start', marginTop: space[1] },
  replyText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accent[700],
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
  announceRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  announceLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  announceNote: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  input: {
    flex: 1,
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
  // Same accent[700] fix as the `mine` bubble above: this button's label is
  // colors.bg on what was accentColor (3.03:1, fails AA at 18px regular).
  send: {
    minHeight: 58,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontFamily: type.heading,
    fontSize: type.size.body,
    color: colors.bg,
  },
});
