import { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import { SendIcon } from '../icons';
import { quoteStub, type MessageAttachmentInput, type ThreadMessage } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';
import AttachmentPicker from './AttachmentPicker';

// The Messages 2a handoff's composer: a 46pt pill beside a 46pt Send
// circle. The pill has 3pt of padding top and bottom, so the text field
// inside it rests at 40 -- the same as the camera button beside it.
const SEND_SIZE = 46;
const FIELD_HEIGHT = 40;
// How tall a long draft may grow the field before it scrolls internally
// instead.
const DRAFT_MAX_HEIGHT = 140;

type Props = {
  draft: string;
  onDraftChange: (next: string) => void;
  /** The message being answered, held whole rather than as an id so this
   *  can show its stub without hunting back through the caller's messages. */
  replyTo: ThreadMessage | null;
  onClearReply: () => void;
  onSend: () => void;
  sending: boolean;
  threadId: string;
  // No `attachments: MessageAttachmentInput[]` prop here, deliberately: an
  // earlier round added one that was never read anywhere in this
  // component's body -- AttachmentPicker below owns and reports the ready
  // list itself, through `onAttachmentsChange`, which is this component's
  // only real link to attachment state. Both callers (app/messages/
  // [threadId].tsx, app/messages/club/[threadId]/[postId].tsx) still hold
  // their own `attachments` state for `postMessage`; they just no longer
  // pass it down here too.
  onAttachmentsChange: (ready: MessageAttachmentInput[], pending: boolean) => void;
  /** Bumped by the caller after a successful send to clear AttachmentPicker's images. */
  attachmentsResetKey: number;
};

/**
 * The conversation composer (Messages 2a handoff): the quoted-reply row, any
 * picked images, then one pill holding the message field and a camera
 * button, beside a round Send button. The bottom padding is the device's
 * home-indicator inset, since the tab bar no longer sits under it.
 *
 * `draft`, `replyTo`,
 * and `sending` stay owned by the caller and arrive as props here -- the
 * caller still owns `sending` because it still owns `sendingRef`, the
 * synchronous guard against a second send landing in the same tick a
 * render-state boolean alone can't catch (see that screen's own comment on
 * `sendingRef`). This component is presentation only: `sending` disables the
 * control, it does not re-implement the guard. `error` is not a prop here --
 * the caller's top-level error banner sits above this component entirely,
 * not inside it.
 */
export default function Composer({
  draft,
  onDraftChange,
  replyTo,
  onClearReply,
  onSend,
  sending,
  threadId,
  onAttachmentsChange,
  attachmentsResetKey,
}: Props) {
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
  const [inputHeight, setInputHeight] = useState(FIELD_HEIGHT);
  const [focused, setFocused] = useState(false);
  const insets = useSafeAreaInsets();
  // While the keyboard is up it covers the home indicator, so the inset
  // padding would only float the composer a gap above the keys.
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // A sent (cleared) draft fires no content-size change on web, which left
  // the empty field at the last message's height.
  useEffect(() => {
    if (draft === '') setInputHeight(FIELD_HEIGHT);
  }, [draft]);

  // Return sends from the keyboard (the phone's key reads "Send"). A blank
  // draft is left alone rather than answered with "Write something first."
  // -- an image-only message still goes through the Send button.
  const submitFromKeyboard = useCallback(() => {
    if (draft.trim().length === 0) return;
    onSend();
  }, [draft, onSend]);

  // Web: Enter sends, Shift+Enter still breaks the line. Handled here rather
  // than through onSubmitEditing, which react-native-web only fires for a
  // multiline field that also blurs -- dropping focus after every message.
  // Preventing the default is what stops react-native-web's own Enter
  // handling from running as well.
  const handleKeyPress = useCallback(
    (e: { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault?: () => void }) => {
      if (Platform.OS !== 'web') return;
      const { key, shiftKey, isComposing } = e.nativeEvent;
      if (key !== 'Enter' || shiftKey || isComposing) return;
      e.preventDefault?.();
      submitFromKeyboard();
    },
    [submitFromKeyboard],
  );

  // `contentSize.height` is react-native-web's own name for the textarea's
  // `scrollHeight` -- the real rendered height of the padding + text inside
  // it, not a guess. Clamped to [COMPOSER_HEIGHT, DRAFT_MAX_HEIGHT] so an
  // empty or one-line draft rests at the Send button's own height and a long
  // one grows only up to the existing cap, same as before.
  const handleDraftSize = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      setInputHeight(
        Math.min(DRAFT_MAX_HEIGHT, Math.max(FIELD_HEIGHT, e.nativeEvent.contentSize.height)),
      );
    },
    [],
  );

  return (
    <View style={[styles.wrap, { paddingBottom: keyboardUp ? 8 : Math.max(insets.bottom, 12) }]}>
      {replyTo ? (
        <View style={styles.replyingRow}>
          <Text numberOfLines={1} style={styles.replyingText}>
            {quoteStub(replyTo)}
          </Text>
          <Pressable
            onPress={onClearReply}
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
          >
            <Text style={styles.replyingCancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      <AttachmentPicker
        resetKey={attachmentsResetKey}
        threadId={threadId}
        onAttachmentsChange={onAttachmentsChange}
        layout={({ strip, trigger }) => (
          <>
            {strip}
            <View style={styles.composer}>
              <View style={[styles.field, focused ? styles.fieldFocused : null]}>
                <TextInput
                  style={[styles.input, { height: inputHeight }]}
                  value={draft}
                  onChangeText={onDraftChange}
                  onContentSizeChange={handleDraftSize}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="Message"
                  placeholderTextColor={colors.neutral[600]}
                  accessibilityLabel="Message"
                  multiline
                  // Without this, react-native-web leaves the underlying
                  // `<textarea>`'s `rows` unset, which renders 2 browser-
                  // default rows -- taller than the field's resting height
                  // before a single character is typed. `handleDraftSize`
                  // still grows the box from here for a long draft.
                  numberOfLines={1}
                  returnKeyType="send"
                  // "submit", not "blurAndSubmit": the keyboard stays up for
                  // the next message.
                  submitBehavior="submit"
                  onSubmitEditing={submitFromKeyboard}
                  onKeyPress={handleKeyPress}
                />
                {trigger}
              </View>
              <Pressable
                // A single tap posts an ordinary message. Composing an
                // announcement is not offered here (see
                // app/messages/[threadId].tsx's own docstring).
                onPress={() => void onSend()}
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={sending}
                style={({ pressed }) => [styles.send, pressed ? styles.sendPressed : null]}
              >
                <SendIcon size={21} color={colors.bg} />
              </Pressable>
            </View>
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingHorizontal: 12, gap: 8 },
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
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  // `flex-end` so the camera stays on the bottom line while a long draft
  // grows the field upward.
  field: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    minHeight: SEND_SIZE,
    backgroundColor: colors.surface,
    // Half the resting height rather than radius.pill: identical on one
    // line, but a long draft grows into a rounded rectangle instead of an
    // ellipse.
    borderRadius: SEND_SIZE / 2,
    paddingTop: 3,
    paddingRight: 4,
    paddingBottom: 3,
    paddingLeft: 3,
  },
  // The handoff's keyboard focus ring, drawn on the pill rather than the
  // bare textarea inside it.
  fieldFocused: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: colors.accentColor,
    outlineOffset: 2,
  },
  // Height is driven by `inputHeight` (see `handleDraftSize`), not
  // `minHeight`: react-native-web's multiline TextInput is a `<textarea>`
  // with its own intrinsic row height. Vertical padding plus line height
  // (9 + 22 + 9) land exactly on FIELD_HEIGHT so one line sits centred at
  // rest -- a textarea does not centre its own content.
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 9,
    lineHeight: 22,
    fontFamily: type.bodyRegular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: 'transparent',
    outlineStyle: 'none' as never,
  },
  // accent[700], not accentColor: colors.bg on accentColor measures 3.03:1;
  // accent[700] reads 5.72:1 (pinned in lib/theme.test.ts).
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: { backgroundColor: colors.accent[800] },
});
