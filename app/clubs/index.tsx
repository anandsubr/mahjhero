import { Link, Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { fetchMyClubs } from '../../lib/clubs';
import type { Club } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

export default function ClubsScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyClubs().then((result) => {
      if (cancelled) return;
      if (result === null) setLoadFailed(true);
      else setClubs(result);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen>
        <Text style={styles.heading}>Your clubs</Text>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const list = clubs ?? [];

  return (
    <Screen>
      <Text style={styles.heading}>Your clubs</Text>

      {list.length === 0 ? (
        <>
          <Text style={styles.help}>
            You are not in a club yet. Start one and invite the people you
            already play with.
          </Text>
          <Button
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start a club"
          >
            Start a club
          </Button>
        </>
      ) : (
        <>
          {list.map((club) => (
            // Card is a plain function component that neither declares
            // accessibilityRole/accessibilityLabel in its prop type nor
            // spreads unrecognised props onto its underlying View, and it
            // isn't wrapped in forwardRef — so `Link asChild` cloning
            // straight onto <Card> fails to typecheck (excess props) and,
            // even past that, would silently drop the onPress/onClick Link
            // injects, leaving the card inert. Pressable is what actually
            // receives Link's injected handler and accessibility props;
            // Card nests inside purely for its visual styling. See the
            // Task 4 report for the full writeup of this deviation from the
            // brief's literal composition.
            <Link key={club.id} href={`/clubs/${club.id}`} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel={club.name}>
                <Card>
                  <Text style={styles.clubName}>{club.name}</Text>
                  {club.rhythm.length > 0 ? (
                    <Text style={styles.help}>{club.rhythm}</Text>
                  ) : null}
                </Card>
              </Pressable>
            </Link>
          ))}
          <Button
            variant="secondary"
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start another club"
          >
            Start another club
          </Button>
        </>
      )}

      <Link href="/profile" style={styles.linkRow}>
        <Text style={styles.link}>Your profile</Text>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  clubName: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  linkRow: { marginTop: space[6] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
