import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import TextField from '../TextField';
import Button from '../Button';
import { Segmented } from '../GameForm';
import {
  submitRsvp,
  type EventPage,
  type RsvpStatus,
  type StoredRsvpStatus,
} from '../../lib/mahj-nights';
import { colors, type } from '../../lib/theme';

const STATUS_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: "Can't go" },
];

type Experience = 'new' | 'played' | 'teach';
const EXPERIENCE_OPTIONS: { value: Experience; label: string }[] = [
  { value: 'new', label: "I'm new" },
  { value: 'played', label: "I've played" },
  { value: 'teach', label: 'I can teach' },
];

const ANSWER: Record<StoredRsvpStatus, string> = {
  going: "You're going",
  maybe: "You're a maybe",
  no: "You can't make it",
  waitlist: "You're on the waitlist",
};

function experienceOf(r: { is_beginner: boolean; can_teach: boolean } | null): Experience {
  if (!r) return 'played';
  if (r.can_teach) return 'teach';
  if (r.is_beginner) return 'new';
  return 'played';
}

/**
 * RSVP with no account (pivot batch 2, 2b): name, email, an answer, how much
 * they've played (it shapes the seating plan), and whether they'll bring a
 * set or have this year's card. A yes on a full night joins the waitlist.
 *
 * Once this browser has RSVP'd it shows the answer with Change; a maybe or
 * waitlisted guest also gets Count me in while a seat is open, first come.
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
  const [status, setStatus] = useState<RsvpStatus>(
    !mine || mine.status === 'waitlist' ? 'going' : mine.status,
  );
  const [experience, setExperience] = useState<Experience>(experienceOf(mine));
  const [bringsSet, setBringsSet] = useState(mine?.brings_set ?? false);
  const [hasCard, setHasCard] = useState(mine?.has_card ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const seatOpen = page.going_count < page.seats;
  const full = !seatOpen && mine?.status !== 'going';

  async function send(next: {
    name: string;
    email: string;
    status: RsvpStatus;
    experience: Experience;
    bringsSet: boolean;
    hasCard: boolean;
  }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await submitRsvp({
      token,
      name: next.name.trim(),
      email: next.email.trim(),
      status: next.status,
      isBeginner: next.experience === 'new',
      isTeacher: next.experience === 'teach',
      bringsSet: next.status !== 'no' && next.bringsSet,
      hasCard: next.status !== 'no' && next.hasCard,
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

  if (mine && !editing) {
    const canClaim = (mine.status === 'maybe' || mine.status === 'waitlist') && seatOpen;
    return (
      <View style={styles.card} testID="rsvp-current">
        <Text style={styles.answer}>{ANSWER[mine.status]}</Text>
        {mine.status === 'going' && page.my_table ? (
          <Text style={styles.table}>{`You're at Table ${page.my_table}`}</Text>
        ) : null}
        {mine.status === 'waitlist' && !seatOpen ? (
          <Text style={styles.body}>
            Every seat is taken for now. If one opens, a Count me in button appears here: the first
            to tap it gets the seat.
          </Text>
        ) : null}
        {canClaim ? (
          <>
            <Text style={styles.body}>A seat is open. The first to tap gets it.</Text>
            <Button
              block
              onPress={() =>
                send({
                  name: mine.name,
                  email: mine.email,
                  status: 'going',
                  experience: experienceOf(mine),
                  bringsSet: mine.brings_set,
                  hasCard: mine.has_card,
                })
              }
              loading={busy}
              accessibilityLabel="Count me in"
            >
              Count me in
            </Button>
          </>
        ) : null}
        <Text style={styles.body}>
          We emailed {mine.email} a link to this invite. Keep it to get back here from another
          device.
        </Text>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button variant="secondary" big={false} onPress={() => setEditing(true)} accessibilityLabel="Change your RSVP">
          Change
        </Button>
      </View>
    );
  }

  const canSend = name.trim().length > 0 && email.trim().length > 0 && !busy;
  const joiningWaitlist = full && status === 'going';

  return (
    <View style={styles.card} testID="rsvp-form">
      <Text style={styles.heading} accessibilityRole="header">
        Will you be there?
      </Text>
      <Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} on="bg" />
      {joiningWaitlist ? (
        <Text style={styles.error}>
          Every seat is taken. Say yes to join the waitlist: if a seat opens, you can claim it.
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
      {status !== 'no' ? (
        <>
          <Text style={styles.label}>How much have you played?</Text>
          <Segmented options={EXPERIENCE_OPTIONS} value={experience} onChange={setExperience} on="bg" />
          <Check label="I can bring a set (with racks)" value={bringsSet} onChange={setBringsSet} />
          <Check label="I have this year's card" value={hasCard} onChange={setHasCard} />
        </>
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
        onPress={() => canSend && send({ name, email, status, experience, bringsSet, hasCard })}
        disabled={!canSend}
        loading={busy}
        accessibilityLabel={joiningWaitlist ? 'Join the waitlist' : 'Send RSVP'}
      >
        {joiningWaitlist ? 'Join the waitlist' : 'Send RSVP'}
      </Button>
    </View>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="checkbox"
      aria-checked={value}
      accessibilityLabel={label}
      style={styles.check}
    >
      <View style={[styles.box, value && styles.boxOn]}>
        {value ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 12 },
  heading: { fontFamily: type.heading, fontSize: 22, color: colors.text },
  answer: { fontFamily: type.bodyBold, fontSize: 18, color: colors.accent2[700] },
  table: { fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
  label: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
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
