import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import Screen from '../../../components/Screen';
import { ChevronLeftIcon } from '../../../components/icons';
import { fetchBroadcasts, type Broadcast } from '../../../lib/broadcasts';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function BroadcastHistory() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const clubId = id ?? '';

  const [sent, setSent] = useState<Broadcast[] | null>(null);
  // Distinguished from `sent === null` on purpose: "not loaded yet" and
  // "loaded and failed" look identical otherwise, and the screen would say
  // "you haven't sent anything" to a host whose read was denied.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setReady(false);
    fetchBroadcasts(clubId).then((rows) => {
      if (cancelled) return;
      setSent(rows);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

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

      <Text style={styles.heading}>Sent messages</Text>

      {!ready ? (
        <ActivityIndicator />
      ) : sent === null ? (
        <Card>
          <Text style={styles.help}>We couldn't load what you've sent.</Text>
        </Card>
      ) : sent.length === 0 ? (
        <Card>
          <Text style={styles.help}>
            You haven't sent anything to this club yet.
          </Text>
        </Card>
      ) : (
        sent.map((message) => (
          <Card key={message.id} style={styles.item}>
            <Text style={styles.subject}>{message.subject}</Text>
            <Text style={styles.body}>{message.body}</Text>
            <Text style={styles.meta}>
              {message.recipient_count === 1
                ? 'Sent to 1 member'
                : `Sent to ${message.recipient_count} members`}
              {message.event_id ? ' booked into one game' : ''}
            </Text>
          </Card>
        ))
      )}

      <Button
        variant="secondary"
        onPress={() => router.push(`/clubs/${clubId}/broadcast`)}
        accessibilityLabel="Write another message"
      >
        Write another
      </Button>
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
  item: { gap: space[2] },
  subject: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.text,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
});
