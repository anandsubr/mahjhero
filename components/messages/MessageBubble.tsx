import { Pressable, StyleSheet, Text, View } from 'react-native';
import Tag from '../Tag';
import AttachmentGrid from './AttachmentGrid';
import { announcementBody, quoteStub, type ThreadMessage } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Props = {
  message: ThreadMessage;
  /** Rendered right-aligned, on the accent ground, when true. */
  mine: boolean;
  onReply: (message: ThreadMessage) => void;
  /**
   * `storage_path` -> signed URL for every attachment across the WHOLE
   * message list the caller is rendering, not just this one message's own
   * -- resolved once per screen load by the caller (app/messages/
   * [threadId].tsx, app/messages/club/[threadId]/[postId].tsx) and handed
   * down here so AttachmentGrid never has to ask for its own slice. See
   * AttachmentGrid's own `urls` prop docstring for why that One True batch
   * has to happen above this component, not inside it. Defaults to `{}` so
   * a caller with nothing to resolve (or a test rendering this in
   * isolation) doesn't have to pass an empty object explicitly.
   */
  attachmentUrls?: Record<string, string>;
};

/**
 * One message, in the four treatments this thread has: yours, somebody
 * else's, an announcement, and any of those carrying a quote stub.
 *
 * Extracted verbatim from app/messages/[threadId].tsx -- the grouped-time
 * separator above a run of messages (`startsNewGroup`/`groupSeparatorLabel`)
 * stays on that screen, since it needs the previous message for context this
 * component doesn't have; this is only the bubble itself.
 */
export default function MessageBubble({ message: m, mine, onReply, attachmentUrls = {} }: Props) {
  // An announcement's subject IS the body's first line (deriveSubject's own
  // contract) -- so printing `m.body` verbatim under a subject that already
  // said it once repeats it. The derivation stays untouched (post_message
  // must still store and mail the real subject); only what this bubble
  // prints drops the duplicate. A body whose first line genuinely differs
  // from the subject is untouched.
  const displayBody = m.is_announcement ? announcementBody(m.subject, m.body) : m.body;

  return (
    // A long press on the bubble picks it as the reply target -- the
    // iOS/WhatsApp convention the owner chose over a permanent "Reply" link
    // on every message (the loudest thing on the old screen). `onLongPress`
    // is the touch/mouse path; it is not reachable by assistive tech, which
    // cannot long-press meaningfully, so a second, always-present control
    // below carries the identical action for AT and keyboard users.
    // `tabIndex={-1}` and no `accessibilityRole` keep this outer wrapper out
    // of the tab order and off the accessibility tree as anything other than
    // a plain container -- the bubble's own text (author, body, quote) is
    // what a screen reader should read here, not a second "button" stop that
    // does nothing on a single activation. Time is no longer part of that
    // text at all -- see the separator above, the only place it appears now.
    <Pressable
      testID={`bubble-${m.id}`}
      onLongPress={() => onReply(m)}
      tabIndex={-1}
      style={[
        styles.bubble,
        mine ? styles.mine : styles.theirs,
        m.is_announcement ? styles.announcement : null,
      ]}
    >
      {!mine && !m.is_announcement ? (
        <Text style={styles.author}>{m.profiles?.display_name ?? ''}</Text>
      ) : null}
      {m.is_announcement ? (
        <View style={styles.announcementHead}>
          <Tag variant="accent2">Announcement</Tag>
          {m.subject ? <Text style={styles.subject}>{m.subject}</Text> : null}
        </View>
      ) : null}

      {/*
        Rendered from `reply_to`, not from `reply_to_id`. The key is `on
        delete set null`, so a reply can outlive what it answered -- and an
        empty quote box is worse than none.
      */}
      {m.reply_to ? (
        <Text
          testID="quote-stub"
          numberOfLines={1}
          style={[
            styles.stub,
            m.is_announcement ? styles.stubAnnouncement : mine ? styles.stubMine : null,
          ]}
        >
          {quoteStub(m.reply_to)}
        </Text>
      ) : null}

      <AttachmentGrid attachments={m.attachments} urls={attachmentUrls} />

      {displayBody ? (
        <Text
          style={m.is_announcement ? styles.bodyAnnouncement : mine ? styles.bodyMine : styles.body}
        >
          {displayBody}
        </Text>
      ) : null}

      {/*
        The accessible, always-reachable twin of the long press above: same
        action, same accessible name the visible "Reply" link used to carry,
        just no longer painted on screen. No children -- accessibilityLabel
        is this control's ONLY name, so there is nothing for it to compose
        with (the "compose, don't replace" rule that matters at the
        members-toggle heading above does not apply here, since there is no
        children-derived name to step on). Visually hidden via a true 1x1
        clip rather than opacity, which some accessibility trees exclude --
        this stays clipped, not transparent, so it still reads to screen
        readers and is still reachable by Tab.
      */}
      <Pressable
        onPress={() => onReply(m)}
        accessibilityRole="button"
        accessibilityLabel={`Reply to ${m.profiles?.display_name ?? 'this message'}`}
        style={styles.replyAction}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No `borderRadius` here any more -- a single uniform value on every
  // bubble is exactly what made the design's speech bubbles read as plain
  // rounded boxes. The design specifies asymmetric corners with one corner
  // clipped down to a tight radius to act as a tail, pointing toward
  // whichever edge the bubble is anchored to; `theirs`/`mine` below each set
  // all four corners individually (React Native has no border-radius
  // shorthand that takes four values) so the tail lands on the correct
  // corner for which side the bubble is on.
  bubble: {
    maxWidth: '78%',
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[2],
  },
  // Tail at bottom-left (radius.sm, 8px) -- the corner nearest the author's
  // name and the left edge this bubble is anchored to.
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    borderBottomLeftRadius: radius.sm,
  },
  // accent[700], not the artboard's accentColor: colors.bg on accentColor
  // measures 3.03:1, and this bubble's body text is 18px regular — needing
  // AA's 4.5:1, not the 3:1 large-text allowance (which needs 24px regular
  // or 18.66px actual-bold, neither of which this is). It fails. accent[700]
  // reads 5.72:1 against colors.bg and clears AA — same failure, same fix,
  // as components/UnreadBadge.tsx's pill.
  //
  // Tail at bottom-right (radius.sm) -- the mirror of `theirs`, anchored to
  // the right edge this bubble sits against.
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent[700],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    borderBottomLeftRadius: radius.lg,
  },
  // Deliberately NOT tailed, unlike `theirs`/`mine` above: a tail reads as
  // "this came from the person on this side," and an announcement is
  // full-width, addressed to everyone, with no side to point from -- more a
  // notice card than a person's speech. All four corners stay at the same
  // radius (overriding whichever of `theirs`/`mine` happened to combine with
  // this in the bubble's own style array, since this entry is always last)
  // so the announcement reads as its own, structurally different kind of
  // bubble rather than a mis-tailed chat bubble.
  announcement: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    backgroundColor: colors.accent2[100],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
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
  // The accessible twin of the long press above: a true 1x1, clipped (not
  // merely transparent) so it is never part of what a sighted user sees,
  // while staying in the accessibility tree and the Tab order -- the
  // standard visually-hidden-but-reachable shape, not `display: none` /
  // `visibility: hidden` / `aria-hidden`, all three of which would also
  // remove it from screen readers, defeating the reason it exists.
  replyAction: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
