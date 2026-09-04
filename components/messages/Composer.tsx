import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SendIcon } from '../icons';
import { quoteStub, type MessageAttachmentInput, type ThreadMessage } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';
import AttachmentPicker from './AttachmentPicker';

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
  /** Bumped by the caller after a successful send to remount AttachmentPicker clean. */
  attachmentsResetKey: number;
};

/**
 * The `1C thread` artboard's composer: the quoted-reply row, the message
 * input, and the Send button.
 *
 * Extracted verbatim from app/messages/[threadId].tsx. `draft`, `replyTo`,
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
  const [inputHeight, setInputHeight] = useState(COMPOSER_HEIGHT);

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

  return (
    <>
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
        key={attachmentsResetKey}
        threadId={threadId}
        onAttachmentsChange={onAttachmentsChange}
      />
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, { height: inputHeight }]}
          value={draft}
          onChangeText={onDraftChange}
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
          // existed only for it -- is gone from this screen (see
          // app/messages/[threadId].tsx's own docstring).
          onPress={() => void onSend()}
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={sending}
          style={styles.send}
        >
          <SendIcon />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
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
  // Height is NOT set here -- it's driven by `inputHeight` state above (see
  // `handleDraftSize`'s own comment), because `minHeight` alone is exactly
  // what let this box render taller than the 58px Send button beside it:
  // react-native-web's multiline `TextInput` is a `<textarea>`, which has
  // its own intrinsic row height independent of `minHeight`.
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
