import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import AttachmentPicker from '../messages/AttachmentPicker';
import { MegaphoneIcon } from '../icons';
import { countBroadcastRecipients } from '../../lib/broadcasts';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  BODY_MAX,
  deriveSubject,
  postMessage,
  type MessageAttachmentInput,
} from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

const FIELD_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 112;

type Props = {
  threadId: string;
  /** Called with the new post's id after a successful post. */
  onPosted: (postId: string) => void;
  /**
   * Hosts and co-organizers (`canAnnounce` in lib/clubs.ts) get the
   * megaphone toggle: posting with it on sends an announcement, which also
   * emails everyone in the club. Members never see it.
   */
  canAnnounce?: boolean;
  /** The club the board belongs to -- for the announcement recipient count. */
  clubId?: string;
};

type KeyEvent = {
  nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean };
  preventDefault?: () => void;
};

/**
 * The composer pinned to the bottom of the club Board: photo button, pill
 * input, Post. Organizers also get a megaphone toggle ("Email everyone in
 * the club") beside the photo button. With it on, a line above the row says
 * how many people will be emailed (`countBroadcastRecipients`, the same
 * count `send_broadcast` resolves its recipients through) and the email's
 * subject (`deriveSubject`, mirroring post_message); the button still reads
 * "Post" (screen readers hear "Post and email everyone"), and the post goes
 * out as an announcement. An announcement needs text, so a photo-only draft
 * can't post while the toggle is on. The toggle turns off after a successful
 * post. This is the app's only way to email a whole club.
 *
 * Photos reuse AttachmentPicker (pick -> compress -> upload), shown as
 * removable thumbnails above the row, up to MAX_ATTACHMENTS.
 *
 * Enter posts on web (Shift+Enter breaks the line); on phones Enter inserts
 * a newline and the Post button posts. While announcing, Enter never posts
 * on any platform -- an accidental Enter would email the whole club
 * mid-sentence -- so only the Post button sends.
 */
export default function BoardComposer({
  threadId,
  onPosted,
  canAnnounce = false,
  clubId,
}: Props) {
  const [body, setBody] = useState('');
  const [announceOn, setAnnounceOn] = useState(false);
  // null covers "still counting" and "could not count" alike: both read
  // "everyone in the club" rather than a number the app doesn't know.
  const [recipients, setRecipients] = useState<number | null>(null);
  const announce = canAnnounce && announceOn;
  const [attachments, setAttachments] = useState<MessageAttachmentInput[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Written synchronously with the call it guards: `busy` from the render
  // closure cannot see a second tap landing before the next render.
  const busyRef = useRef(false);
  // Grows with the draft up to ~4 lines. react-native-web leaves a multiline
  // textarea at its row height, so the height is driven from the measured
  // content size, clamped like messages/Composer.
  const [inputHeight, setInputHeight] = useState(FIELD_HEIGHT);
  const insets = useSafeAreaInsets();
  // The keyboard covers the home indicator, so the inset padding would only
  // float the composer a gap above the keys.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (body === '') setInputHeight(FIELD_HEIGHT);
  }, [body]);
  const handleSize = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      setInputHeight(
        Math.min(INPUT_MAX_HEIGHT, Math.max(FIELD_HEIGHT, e.nativeEvent.contentSize.height)),
      );
    },
    [],
  );
  // Counted each time the toggle is armed, so the number is never stale
  // against a roster that changed since the last announcement.
  useEffect(() => {
    if (!announce || !clubId) return;
    let cancelled = false;
    setRecipients(null);
    // A club announcement has no event, so the second argument is null.
    void countBroadcastRecipients(clubId, null).then((n) => {
      if (!cancelled) setRecipients(n);
    });
    return () => {
      cancelled = true;
    };
  }, [announce, clubId]);

  // Latest values for the keyboard handler / submit, which must not act on a
  // stale closure.
  const latest = useRef({ body, attachments, attachmentsPending, announce });
  latest.current = { body, attachments, attachmentsPending, announce };

  const hasText = body.trim().length > 0;
  // post_message refuses an announcement with no text: its first line is
  // the email subject. So a photo-only draft can't post while announcing.
  const needsText = announce && !hasText;
  const canPost =
    !busy && !attachmentsPending && !needsText && (hasText || attachments.length > 0);

  const submit = useCallback(async () => {
    const cur = latest.current;
    if (busyRef.current || cur.attachmentsPending) return;
    if (cur.body.trim().length === 0 && (cur.attachments.length === 0 || cur.announce)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { id, error: refusal } = await postMessage(
      threadId,
      cur.body.trim(),
      cur.announce,
      null,
      null,
      cur.attachments,
    );
    busyRef.current = false;
    setBusy(false);
    if (refusal || !id) {
      // The draft survives a refusal.
      setError(refusal ?? GENERIC_ERROR);
      return;
    }
    setBody('');
    setAnnounceOn(false);
    setAttachments([]);
    setResetKey((k) => k + 1);
    onPosted(id);
  }, [threadId, onPosted]);

  const handleKeyPress = useCallback(
    (e: KeyEvent) => {
      if (Platform.OS !== 'web') return;
      const { key, shiftKey, isComposing } = e.nativeEvent;
      if (key !== 'Enter' || shiftKey || isComposing) return;
      // Announcing: let Enter insert a newline; only the button sends.
      if (latest.current.announce) return;
      e.preventDefault?.();
      void submit();
    },
    [submit],
  );

  return (
    <View style={[styles.wrap, { paddingBottom: keyboardUp ? 8 : Math.max(insets.bottom, 8) }]}>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <AttachmentPicker
        threadId={threadId}
        resetKey={resetKey}
        triggerVariant="photo"
        onAttachmentsChange={(ready, pending) => {
          setAttachments(ready);
          setAttachmentsPending(pending);
        }}
        layout={({ strip, trigger }) => (
          <>
            {strip}
            {announce ? (
              <Text style={styles.announceNote}>
                {(recipients !== null
                  ? `Will also email ${recipients} ${recipients === 1 ? 'person' : 'people'} in the club`
                  : 'Will also email everyone in the club') +
                  (hasText ? ` · Subject: ${deriveSubject(body.trim())}` : '')}
              </Text>
            ) : null}
            {needsText ? (
              <Text style={styles.announceHint}>
                Add a line of text — it becomes the email subject.
              </Text>
            ) : null}
            <View style={styles.row}>
              {trigger}
              {canAnnounce ? (
                <Pressable
                  onPress={() => setAnnounceOn((on) => !on)}
                  accessibilityRole="switch"
                  accessibilityLabel="Email everyone in the club"
                  // aria-*, not accessibilityState: react-native-web drops
                  // accessibilityState entirely (see components/Toggle.tsx),
                  // and RN's Pressable reads aria-checked natively too.
                  aria-checked={announce}
                  style={[styles.announce, announce ? styles.announceOnBg : null]}
                >
                  <MegaphoneIcon size={22} color={announce ? colors.bg : colors.text} />
                </Pressable>
              ) : null}
              <TextInput
                style={[styles.input, { height: inputHeight }]}
                value={body}
                onChangeText={setBody}
                onContentSizeChange={handleSize}
                placeholder="Write to the club"
                placeholderTextColor={colors.neutral[600]}
                accessibilityLabel="Write to the club"
                multiline
                numberOfLines={1}
                maxLength={BODY_MAX}
                onKeyPress={handleKeyPress}
              />
              <Pressable
                onPress={() => void submit()}
                disabled={!canPost}
                accessibilityRole="button"
                // The visible label stays "Post" (the line above already
                // says it will email); a screen reader hears the difference.
                accessibilityLabel={announce ? 'Post and email everyone' : 'Post'}
                accessibilityState={{ disabled: !canPost, busy }}
                style={[styles.post, canPost ? styles.postOn : null]}
              >
                <Text style={[styles.postText, canPost ? styles.postTextOn : null]}>Post</Text>
              </Pressable>
            </View>
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    gap: space[2],
    backgroundColor: colors.bg,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: FIELD_HEIGHT,
    maxHeight: INPUT_MAX_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.neutral[400],
    backgroundColor: colors.bg,
    fontFamily: type.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  post: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  postOn: { backgroundColor: colors.accent[700] },
  postText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.neutral[600] },
  postTextOn: { color: '#fff' },
  announce: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  announceOnBg: { backgroundColor: colors.accent[700] },
  announceHint: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.neutral[700],
  },
  announceNote: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.accent[700],
  },
  error: { fontFamily: type.bodyRegular, fontSize: type.size.helper, color: colors.accent[800] },
});
