import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import TextField from '../TextField';
import Button from '../Button';
import { Segmented } from '../GameForm';
import { submitRsvp, type EventPage, type RsvpStatus } from '../../lib/mahj-nights';
import { colors, type } from '../../lib/theme';

const STATUS_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: "Can't go" },
];

const ANSWER: Record<RsvpStatus, string> = {
  going: "You're going",
  maybe: "You're a maybe",
  no: "You can't make it",
};

/**
 * RSVP with no account: name, email, an answer, and (when the host welcomes
 * beginners) "I'm new". Shows the guest's current answer when this browser
 * already RSVP'd, with Change to reopen the form.
 */
export default function RsvpForm({
  token,
  page,
  secret,
  onSaved,
}: {
  token: string;
  page: EventPage;
  secret: string | null;
  onSaved: (secret: string | null) => void;
}) {
  const mine = page.my_rsvp;
  const [editing, setEditing] = useState(!mine);
  const [name, setName] = useState(mine?.name ?? '');
  const [email, setEmail] = useState(mine?.email ?? '');
  const [status, setStatus] = useState<RsvpStatus>(mine?.status ?? 'going');
  const [isBeginner, setIsBeginner] = useState(mine?.is_beginner ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (mine && !editing) {
    return (
      <View style={styles.card} testID="rsvp-current">
        <Text style={styles.answer}>{ANSWER[mine.status]}</Text>
        <Text style={styles.body}>
          We emailed {mine.email} a link to this invite. Keep it to get back here from another
          device.
        </Text>
        <Button variant="secondary" big={false} onPress={() => setEditing(true)} accessibilityLabel="Change your RSVP">
          Change
        </Button>
      </View>
    );
  }

  const full = page.going_count >= page.seats && mine?.status !== 'going';
  const canSend = name.trim().length > 0 && email.trim().length > 0 && !busy;

  async function onSend() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await submitRsvp({
      token,
      name: name.trim(),
      email: email.trim(),
      status,
      isBeginner: page.beginners_welcome && isBeginner,
      secret,
    });
    setBusy(false);
    if (result.outcome === 'error') {
      setError(result.message);
      return;
    }
    if (result.outcome === 'exists') {
      setNotice(
        "You've already RSVP'd with that email. We've emailed you a link to see the night or change your answer.",
      );
      return;
    }
    setEditing(false);
    onSaved(result.secret);
  }

  return (
    <View style={styles.card} testID="rsvp-form">
      <Text style={styles.heading} accessibilityRole="header">
        Will you be there?
      </Text>
      <Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} on="bg" />
      {full && status === 'going' ? (
        <Text style={styles.error}>
          {"It's full. You can still say maybe, and the host will see it."}
        </Text>
      ) : null}
      <TextField label="Your name" value={name} onChangeText={setName} accessibilityLabel="Your name" autoComplete="name" />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        accessibilityLabel="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
      />
      {page.beginners_welcome && status !== 'no' ? (
        <Pressable
          onPress={() => setIsBeginner(!isBeginner)}
          accessibilityRole="checkbox"
          aria-checked={isBeginner}
          accessibilityLabel="I'm new, save me a learning-table seat"
          style={styles.check}
        >
          <View style={[styles.box, isBeginner && styles.boxOn]}>
            {isBeginner ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.checkLabel}>{"I'm new, save me a learning-table seat"}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.small}>
        No account needed. We'll email you a link to this invite, and only use your email for this
        night.
      </Text>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <Button
        block
        onPress={onSend}
        disabled={!canSend || (full && status === 'going')}
        loading={busy}
        accessibilityLabel="Send RSVP"
      >
        Send RSVP
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 12 },
  heading: { fontFamily: type.heading, fontSize: 22, color: colors.text },
  answer: { fontFamily: type.bodyBold, fontSize: 18, color: colors.accent2[700] },
  body: { fontFamily: type.bodyRegular, fontSize: 14, lineHeight: 20, color: colors.neutral[700] },
  small: { fontFamily: type.bodyRegular, fontSize: 13, lineHeight: 18, color: colors.neutral[700] },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, lineHeight: 20, color: colors.accent[700] },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.neutral[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent2[600], borderColor: colors.accent2[600] },
  tick: { color: colors.neutral[100], fontFamily: type.bodyBold, fontSize: 14, lineHeight: 16 },
  checkLabel: { flex: 1, fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
});
