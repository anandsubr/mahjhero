import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import {
  BODY_MAX,
  SUBJECT_MAX,
  countBroadcastRecipients,
  isValidBroadcast,
  sendBroadcast,
} from '../../../lib/broadcasts';
import { canInvite, fetchRoster } from '../../../lib/clubs';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function Broadcast() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const { id, eventId } = useLocalSearchParams<{ id?: string; eventId?: string }>();
  const clubId = id ?? '';
  // The route parameter arrives as a string or not at all; the RPC wants
  // null for "the whole roster", and undefined would be sent as missing.
  const targetEvent = eventId ?? null;

  // The entry-point buttons that link here already check `canInvite`, but
  // the route itself is reachable by URL regardless. Without this, a plain
  // member landed on a screen that told them "Sending still works" (the
  // copy meant for an organizer whose recipient-count RPC failed) and then
  // showed them the database's raw `not an organizer of this club` refusal
  // after they typed a message and confirmed. Same derivation
  // app/clubs/[id]/index.tsx and .../events/[eventId]/index.tsx use, and
  // the same fail-closed posture on a roster-fetch failure: "not an
  // organizer" rather than opening the page anyway.
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [organizerReady, setOrganizerReady] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // `recipients` alone can't tell "still working it out" apart from "the
  // count failed" -- countBroadcastRecipients deliberately resolves null for
  // both a call that hasn't landed yet and one that errored out (see its
  // docstring in lib/broadcasts.ts). `recipientsReady` is the companion flag
  // that splits those two, the same way app/notifications.tsx's `ready` +
  // nullable `prefs` do, and app/clubs/[id]/venues.tsx's `loadFailed` does
  // for a second independently-loaded resource. Without it, a permanent
  // failure left the host staring at "Working out who this reaches…"
  // forever, with no error and no way to retry.
  const [recipients, setRecipients] = useState<number | null>(null);
  const [recipientsReady, setRecipientsReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setRecipientsReady(false);
    setRecipients(null);
    countBroadcastRecipients(clubId, targetEvent).then((count) => {
      if (cancelled) return;
      setRecipients(count);
      setRecipientsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, targetEvent]);

  useEffect(() => {
    if (!userId || !clubId) return;
    let cancelled = false;
    setOrganizerReady(false);
    fetchRoster(clubId).then((rows) => {
      if (cancelled) return;
      const me = (rows ?? []).find((m) => m.profile_id === userId);
      setIsOrganizer(me ? canInvite(me.role) : false);
      setOrganizerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, clubId]);

  // Bound to the "Try again" button in the failed-count card below. Flipping
  // `recipientsReady` back to false immediately swaps that card back to the
  // loading copy, which is also what removes the button from the tree -- so
  // there is no window in which a second tap could start an overlapping
  // retry while one is already in flight.
  async function retryRecipients() {
    setRecipientsReady(false);
    const count = await countBroadcastRecipients(clubId, targetEvent);
    setRecipients(count);
    setRecipientsReady(true);
  }

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!organizerReady) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!isOrganizer) {
    // An honest refusal, not a silent bounce back to the club: this screen
    // is reachable only by URL for a plain member (the entry-point buttons
    // already hide it), and a Redirect here would read as a broken link
    // rather than the true reason -- the same "say what actually happened"
    // posture the rest of this screen and its sibling history screen take
    // for a failed count or a failed load, rather than papering over it.
    return (
      <Screen scroll contentStyle={styles.container}>
        <Button
          variant="ghost"
          big={false}
          onPress={() => router.push(`/clubs/${clubId}`)}
          icon={<ChevronLeftIcon color={colors.accentColor} />}
          accessibilityLabel="Back to the club"
          style={styles.backButton}
        >
          Club
        </Button>
        <Text style={styles.heading}>Message members</Text>
        <Card>
          <Text style={styles.help}>
            Only a club's host or co-organizers can message the whole club.
          </Text>
        </Card>
      </Screen>
    );
  }

  const valid = isValidBroadcast(subject, body);

  async function onConfirmedSend() {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const { error: sendError } = await sendBroadcast(
        clubId, targetEvent, subject, body,
      );
      if (sendError) {
        // Back to the form with the words. A refusal that closed the
        // confirmation and did nothing else would read as success.
        setConfirming(false);
        setError(sendError);
        return;
      }
      // `replace`, not `push`, and the form state cleared with it -- the
      // same pattern app/clubs/new.tsx and app/clubs/[id]/events/new.tsx
      // use after their own creates. `push` left this screen mounted
      // underneath the history screen with `confirming` still true and the
      // typed message still in state, so Android back / iOS swipe-back /
      // browser back landed the host right back on a primed "Yes, send it"
      // -- one more tap wrote a second `broadcasts` row, with a fresh id
      // and therefore fresh dedupe keys, and mailed the whole club again.
      setConfirming(false);
      setSubject('');
      setBody('');
      router.replace(`/clubs/${clubId}/broadcasts`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push(`/clubs/${clubId}`)}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        Club
      </Button>

      <Text style={styles.heading}>
        {targetEvent ? 'Message everyone booked' : 'Message members'}
      </Text>

      <Card>
        {!recipientsReady ? (
          <Text style={styles.help}>Working out who this reaches…</Text>
        ) : recipients === null ? (
          // A failed count does not block sending -- send_broadcast counts
          // its own recipients server-side and never reads this number, so
          // there is nothing this screen would be protecting by refusing.
          // What it must not do is pretend to still be loading, which is
          // the bug this replaces.
          <>
            <Text style={styles.help}>
              Could not work out who this reaches. Sending still works -- it
              just won't show a count first.
            </Text>
            <Button
              variant="ghost"
              big={false}
              onPress={retryRecipients}
              accessibilityLabel="Try counting recipients again"
            >
              Try again
            </Button>
          </>
        ) : (
          <Text style={styles.help}>
            {recipients === 1
              ? 'This goes to 1 member, by email.'
              : `This goes to ${recipients} members, by email.`}
          </Text>
        )}
      </Card>

      <TextField
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        maxLength={SUBJECT_MAX}
        accessibilityLabel="Subject"
      />
      <TextField
        label="Message"
        value={body}
        onChangeText={setBody}
        maxLength={BODY_MAX}
        rows={6}
        accessibilityLabel="Message"
      />

      {error ? <ErrorBanner message={error} /> : null}

      {confirming ? (
        // A broadcast is irreversible and lands in other people's inboxes.
        // The second tap is the whole point of this block.
        <Card style={styles.confirmCard}>
          <Text style={styles.confirmText}>
            {recipients === 1
              ? 'Send this to 1 member?'
              : recipients !== null
                ? `Send this to ${recipients} members?`
                // recipients is null here whether the count is still
                // loading (the host confirmed fast) or failed outright --
                // either way there is no number to name, and this must not
                // paper over that the way `${recipients ?? 'the'}` used to.
                : 'Send this without a confirmed recipient count?'}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="primary"
              onPress={onConfirmedSend}
              disabled={sending}
              loading={sending}
              accessibilityLabel="Yes, send it"
            >
              Yes, send it
            </Button>
            <Button
              variant="secondary"
              onPress={() => setConfirming(false)}
              disabled={sending}
              accessibilityLabel="Keep editing"
            >
              Keep editing
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          variant="primary"
          block
          onPress={() => setConfirming(true)}
          disabled={!valid}
          accessibilityLabel="Send"
        >
          Send
        </Button>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
  confirmCard: { padding: space[4], gap: space[3] },
  confirmText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  confirmActions: { gap: space[2] },
});
