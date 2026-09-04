import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import TextField from '../../../components/TextField';
import ThreadAvatar from '../../../components/ThreadAvatar';
import Toggle from '../../../components/Toggle';
import { ChevronLeftIcon } from '../../../components/icons';
import AttachmentPicker from '../../../components/messages/AttachmentPicker';
import { countBroadcastRecipients } from '../../../lib/broadcasts';
import { canAnnounce, fetchClub, fetchRoster } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  BODY_MAX,
  deriveSubject,
  postMessage,
  type MessageAttachmentInput,
} from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors, radius, space, type } from '../../../lib/theme';

/**
 * Start a post on a club's board.
 *
 * The Announcement toggle here reopens a capability the old flat thread
 * screen closed: its organizer toggle was removed pending a friendlier
 * design, and until this screen existed there was no way to email a club
 * from the app at all, where before the messaging branch there was.
 *
 * An announcement is a FLAG on a root, not a separate kind of object — one
 * posting path, one permission model, one fan-out. `post_message` refuses
 * `p_announce` on a reply outright ('only a new post can be an
 * announcement'), which is why this toggle exists only here and nowhere
 * else a post can originate.
 *
 * The subject is DERIVED from the body's first line and shown back before
 * sending: an email needs a subject and this screen has one input, so the
 * derivation is disclosed rather than invented silently. `deriveSubject`
 * must keep agreeing with `post_message`'s SQL character for character —
 * this screen shows the organizer the same value the RPC will actually
 * store, or the confirmation would be a lie.
 *
 * There is no `organizer` prop. Whether the toggle renders at all is
 * derived from the club role, read through the same `fetchRoster` +
 * `canAnnounce` boundary app/clubs/[id]/index.tsx, venues.tsx and
 * events/[eventId]/index.tsx already use for their own `isOrganizer` — one
 * way to ask this question, not a second one invented for this screen.
 * `canAnnounce` is a distinct export from `canInvite`, even though both
 * compute host-or-co-organizer today: inviting and announcing are
 * different permissions that happen to coincide right now, and reusing one
 * predicate for the other would silently break whichever diverges first.
 *
 * Carries a back control, unlike app/messages/new.tsx, whose own docstring
 * explains why it carries none: that screen's "Messages" ghost link was
 * removed because the Messages tab already reaches the identical /messages
 * route it was reached from, so the tab bar itself is the way back. That
 * reasoning does not transfer here. This screen is reached from a club's
 * board at /messages/club/<threadId> -- one level BELOW where the Messages
 * tab lands -- so a member who taps the tab bar to escape lands on the
 * board list, not the specific board they came from. The chevron below
 * returns to that exact board, the same destination and the same control
 * commit 2e39173 gave the board and post screens (app/messages/club/
 * [threadId]/index.tsx, .../[postId].tsx) -- and now sits inside the same
 * header those two screens use, rather than alone.
 *
 * That header -- a centred ThreadAvatar plus a name pill beneath the
 * chevron -- is the exact treatment commit 2e39173 gave the board and post
 * screens, its style entries (`header`, `backButton`, `headerCenter`,
 * `namePill`, `namePillText`) copied from app/messages/club/[threadId]/
 * index.tsx rather than re-derived. Which club a member is posting to is
 * true of the whole screen, not just of the announcement decision -- a
 * member should not have to arm the Announce toggle to find out where they
 * are, which is what the previous design asked of them (the name lived only
 * in the recipient notice below). `kind` is the literal `'club'`, not
 * something derived through `threadKindFor` the way the board does: that
 * screen fetches a full `ThreadDetail` (via `fetchThread`) because it has
 * two questions to answer -- the name AND which avatar kind to draw. This
 * route only ever composes onto a club's board, so there is only the one
 * question, and `fetchClub`'s plain name already answers it.
 *
 * The pill here does NOT navigate, unlike the board's tappable one.
 * app/messages/[threadId].tsx's own inert pill (drawn for a club/game
 * thread there, which has no members view to open) already made this call
 * and left the reasoning in its own comment: a control that LOOKS tappable
 * and does nothing is worse than one that plainly isn't interactive at all.
 * The reasoning is sharper here than "does nothing": tapping through to the
 * club mid-draft would ABANDON whatever has been typed, and this screen
 * already goes out of its way (`confirmingCancel` below) to ask before
 * discarding a draft on the way OUT. A tap that discarded one on the way
 * sideways, with no confirmation at all, would undercut that entirely. So
 * the pill renders as a plain, non-interactive `View` -- no `Pressable`, no
 * button role, no chevron, nothing that promises a tap will go anywhere.
 *
 * `clubName` keeps the null-safety it always had: `fetchClub` never rejects
 * -- null covers both "still loading" and "could not be asked" -- and the
 * header renders no pill at all, rather than an empty one, when it's null.
 * That must never block composing or announcing: the toggle, the count, and
 * posting itself all still work with no club name in hand.
 *
 * `clubName` is fetched alongside the roster (below), through `fetchClub` --
 * the same "one function, always right" tradeoff `fetchThread` makes for the
 * board screen's own header, over a route param the board screen could have
 * passed instead. A param is free and already in hand (the board has
 * `title` computed before it navigates here), but it can go stale against a
 * rename between the two screens and needs URL-encoding a name that may
 * carry spaces or punctuation the route string cannot carry verbatim. One
 * more read on a screen that already makes two (fetchRoster, and
 * countBroadcastRecipients once armed) buys a name that is never wrong.
 *
 * The recipient notice (`noticeText` below) no longer names the club. Now
 * that the header says so persistently, restating it in the sentence an
 * organizer reads right before sending would be the same fact twice, not
 * extra safety -- and it is exactly the fact the header exists to answer
 * without requiring the toggle. What the notice still carries is specific
 * to arming Announce: the recipient count and the subject the email will
 * actually carry, neither of which is true of this screen until the toggle
 * is on.
 *
 * Backing out with a typed, non-empty draft asks once before discarding it
 * -- the same arm-then-confirm shape MembersPanel's `leaveConfirming` uses
 * for Leave, chosen over a modal (this codebase has no modal convention) and
 * over guarding silently (a typed draft is exactly what postMessage's own
 * refusal-path comment calls the worst thing to lose). It departs from that
 * shape in one way: `updateBody` below clears the arm on every keystroke,
 * where `leaveConfirming` has nothing that could change between the two
 * taps. Without that, arming while a draft read one thing and committing
 * after editing it to read another would discard text the member never
 * actually confirmed away. An EMPTY draft skips the confirm entirely and
 * backs out on the first tap -- there is nothing there to protect, and
 * making a member confirm discarding nothing is its own defect.
 */
export default function NewPostScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const { threadId, clubId } = useLocalSearchParams<{
    threadId: string;
    clubId?: string;
  }>();
  const router = useRouter();

  const [body, setBody] = useState('');
  // Arms on the first tap of the back chevron while `body` is non-empty,
  // commits on the second -- see this screen's own docstring for why that
  // shape (borrowed from MembersPanel's `leaveConfirming`) needs one thing
  // that pattern doesn't: cleared on every keystroke, not just on exit, so
  // an edited draft can't be discarded on the strength of an arm a
  // now-stale version of it earned.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [mayAnnounce, setMayAnnounce] = useState(false);
  // null covers "still loading" and "fetchClub could not ask" alike -- see
  // this screen's own docstring for why the notice below omits the club
  // clause entirely rather than rendering either as a blank or "null".
  const [clubName, setClubName] = useState<string | null>(null);
  // null covers two different things on purpose: "have not asked yet" and
  // "asked and could not find out" both render nothing rather than a
  // number -- see the recipient preview below, which never prints "null".
  const [recipients, setRecipients] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // No reset key here, unlike the club post's reply composer
  // (app/messages/club/[threadId]/[postId].tsx): that screen stays mounted
  // after a successful send and needs AttachmentPicker remounted clean for
  // the next one. `submit` below `router.replace`s away on success, so this
  // screen unmounts instead -- there is no second submission for a stale
  // AttachmentPicker to leak into.
  const [attachments, setAttachments] = useState<MessageAttachmentInput[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  // Written synchronously alongside the async call it guards, the same
  // pattern app/messages/club/[threadId]/[postId].tsx's `sendingRef`
  // records: `busy` read from the render closure is blind to a second tap
  // landing before that render commits. Cleared on every exit path below --
  // a ref set and never cleared makes the button permanently dead, worse
  // than the double-post it guards against.
  const busyRef = useRef(false);

  useEffect(() => {
    if (!userId || !clubId) return;
    let cancelled = false;
    void fetchRoster(clubId).then((roster) => {
      if (cancelled) return;
      const me = roster?.find((m) => m.profile_id === userId);
      setMayAnnounce(me ? canAnnounce(me.role) : false);
    });
    // Fetched here rather than gated behind the toggle: firing it alongside
    // the roster read means the name is already in hand by the time an
    // organizer flips Announce on, so the notice's first paint already
    // names the club instead of filling that clause in a beat later.
    void fetchClub(clubId).then((club) => {
      if (!cancelled) setClubName(club?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the viewer's id, not the `session` object -- `lib/session.tsx`
    // hands out a fresh `Session` on every `onAuthStateChange`, including a
    // token refresh that changes nothing about who is asking.
  }, [userId, clubId]);

  useEffect(() => {
    if (!announce || !mayAnnounce || !clubId) return;
    let cancelled = false;
    // The count previewed here and the set `send_broadcast` actually mails
    // both resolve through `broadcast_recipient_count` / `broadcast_recipients`
    // -- ONE function, on purpose. A club announcement has no event, so the
    // second argument is always null here, unlike the event-scoped broadcast
    // this same lib function also serves.
    void countBroadcastRecipients(clubId, null).then((n) => {
      if (!cancelled) setRecipients(n);
    });
    return () => {
      cancelled = true;
    };
  }, [announce, mayAnnounce, clubId]);

  const updateBody = useCallback((text: string) => {
    setBody(text);
    setConfirmingCancel(false);
  }, []);

  const handleBack = useCallback(() => {
    // An empty draft costs nothing to lose -- checked first, and
    // unconditionally, so it also covers a member who armed the confirm
    // and then deleted everything they'd typed rather than tapping back
    // again: the second tap should just leave, not discard nothing.
    if (!body.trim()) {
      router.push(`/messages/club/${threadId}`);
      return;
    }
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    router.push(`/messages/club/${threadId}`);
  }, [body, confirmingCancel, threadId, router]);

  const submit = useCallback(async () => {
    if (busyRef.current || attachmentsPending || !threadId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { id, error: refusal } = await postMessage(
      threadId,
      body,
      announce && mayAnnounce,
      // A reply pointer -- always null. A new post is never answering
      // another message.
      null,
      // The post's own root -- always null. A new post IS the root.
      null,
      attachments,
    );
    if (refusal || !id) {
      // The draft survives a refusal, same contract every composer in this
      // app keeps: losing what somebody typed because the network failed
      // is the worst possible response to a failed send.
      busyRef.current = false;
      setBusy(false);
      setError(refusal ?? GENERIC_ERROR);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    router.replace(`/messages/club/${threadId}/${id}`);
  }, [threadId, body, announce, mayAnnounce, attachments, attachmentsPending, router]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  // `deriveSubject` takes the TRIMMED body, not the raw draft: its own
  // docstring records that `post_message` computes `trim(coalesce(p_body,
  // ''))` first and only then splits the first line, so a draft starting
  // with a blank line loses that blank line before the split, not after.
  // Passing the untrimmed draft here previewed a blank subject for a post
  // about to mail a real one -- the exact bug that docstring names.
  const subject = deriveSubject(body.trim());
  // Built as one plain string, not a `<Text>` with interpolated `{}`
  // children -- react-native-web renders each JSX expression as its own
  // child element rather than flattening them into one text node, which
  // left "Doors at seven" and the recipient count as sibling nodes neither
  // testing-library nor a screen reader read as one sentence.
  //
  // A null count means "could not be asked", not "goes to nobody" --
  // rendering it as a number here would tell an organizer something the
  // app does not actually know, so the count clause is simply omitted. No
  // club clause here at all -- this screen's docstring records why: the
  // header above already names the club persistently, so the notice only
  // carries what's specific to arming Announce, the count and the subject.
  const noticeText =
    `Subject: ${subject || '(the first line of your post)'}` +
    (recipients !== null
      ? ` · ${recipients} ${recipients === 1 ? 'person' : 'people'} will be emailed`
      : '');

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      {/*
        The same header the board and post screens use (commit 2e39173,
        app/messages/club/[threadId]/index.tsx): chevron top-left, the
        club's avatar and name pill centred beneath it. Style entries
        (header/backButton/headerCenter/namePill/namePillText) copied from
        that screen rather than re-derived -- see this screen's own
        docstring for why. `kind` is the literal 'club', not derived
        through threadKindFor -- this route only ever composes onto a
        club's board, so there is no second kind to distinguish.
      */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={confirmingCancel ? 'Discard post and go back to board' : 'Back to board'}
          style={styles.backButton}
        >
          <ChevronLeftIcon color={colors.text} size={22} />
        </Pressable>

        {clubName ? (
          <View style={styles.headerCenter}>
            <ThreadAvatar
              kind="club"
              name={clubName}
              size={72}
              testID="thread-header-avatar-club"
              asTile
              clubId={clubId}
            />

            {/*
              A plain View, not a Pressable -- see this screen's own
              docstring for why the pill here must not look tappable the
              way the board's own pill does. No button role, no chevron.
            */}
            <View style={styles.namePill}>
              <Text numberOfLines={1} style={styles.namePillText}>
                {clubName}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <Text style={styles.heading}>New post</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {confirmingCancel ? (
        // Same accent2[800]-on-accent2[100] Card the Announcement notice
        // below already uses on this screen -- not a new pairing, and not a
        // modal this codebase has no convention for.
        <Card background={colors.accent2[100]}>
          <Text style={styles.note}>Tap back again to discard this draft.</Text>
        </Card>
      ) : null}

      <TextField
        label="Post"
        value={body}
        onChangeText={updateBody}
        placeholder="What's this about?"
        accessibilityLabel="Post"
        rows={6}
        maxLength={BODY_MAX}
      />

      {/*
        `threadId` is a route param, already in hand at mount -- unlike
        app/messages/new.tsx (no thread exists until submission), this
        screen always composes onto an EXISTING club board, so the picker
        can render immediately rather than waiting on anything.
      */}
      <AttachmentPicker
        threadId={threadId}
        onAttachmentsChange={(ready, pending) => {
          setAttachments(ready);
          setAttachmentsPending(pending);
        }}
      />

      {mayAnnounce ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Also email everyone in the club</Text>
          <Toggle
            value={announce}
            onValueChange={setAnnounce}
            accessibilityLabel="Also email everyone in the club"
          />
        </View>
      ) : null}

      {mayAnnounce && announce ? (
        <Card background={colors.accent2[100]}>
          <Text style={styles.note}>{noticeText}</Text>
        </Card>
      ) : null}

      <Button
        onPress={() => void submit()}
        disabled={busy || attachmentsPending || body.trim().length === 0}
        accessibilityLabel="Post it"
      >
        {busy ? 'Posting…' : 'Post it'}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  // Copied from the board and post screens' own `header`/`backButton`
  // (app/messages/club/[threadId]/index.tsx, .../[postId].tsx), themselves
  // copied from app/messages/[threadId].tsx -- see any of those for the
  // reasoning behind the absolute positioning and the 44x44 target.
  header: {
    position: 'relative',
    alignItems: 'center',
    paddingBottom: space[2],
  },
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Also copied from the board screen's own `headerCenter`/`namePill`/
  // `namePillText` -- see this screen's own docstring for why the pill
  // itself is a plain View here rather than that screen's Pressable.
  headerCenter: { alignItems: 'center', gap: space[2] },
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
  namePillText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  toggleLabel: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  // The same accent2[800]-on-accent2[100] pairing app/messages/new.tsx's
  // own "goes to everyone" note already uses -- pinned in lib/theme.test.ts
  // ("announcement text clears AA on the announcement background"), not a
  // new pairing this screen introduces.
  note: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.accent2[800],
  },
});
