import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import Tag from '../../../components/Tag';
import { ChevronLeftIcon } from '../../../components/icons';
import { canInvite, createInvite, fetchClub, fetchRoster } from '../../../lib/clubs';
import type { Club, ClubMember } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;
    Promise.all([fetchClub(id), fetchRoster(id)]).then(([c, r]) => {
      if (cancelled) return;
      if (c === null || r === null) setLoadFailed(true);
      else {
        setClub(c);
        setRoster(r);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, id]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (loadFailed || !club) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const me = roster.find((m) => m.profile_id === userId);
  const mayInvite = me ? canInvite(me.role) : false;

  async function onInvite() {
    if (!session || !id) return;
    setError(null);
    if (Platform.OS !== 'web') {
      // `window.location` does not exist off web: React Native's core only
      // aliases the `window` global to `global`, it never adds a `location`
      // property, so reading `.origin` throws. Building the URL unconditionally
      // would turn a tap into an uncaught crash on iOS/Android — and only after
      // createInvite had already written a token to the database that this
      // screen could never show, wasting it. Guarding before that call avoids
      // both: no crash, and no orphaned invite. Invite links are a web-only
      // flow for now; a native-safe origin or deep link is Task 8's concern.
      setError('Invite links can only be created from the web app for now.');
      return;
    }
    const { token, error: inviteError } = await createInvite(id, session.user.id);
    if (inviteError || !token) {
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    setInviteUrl(`${window.location.origin}/join/${token}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
        style={styles.backButton}
      >
        Clubs
      </Button>

      <Text style={styles.heading}>{club.name}</Text>
      {club.rhythm.length > 0 ? (
        <Text style={styles.help}>{club.rhythm}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>
        {roster.length} {roster.length === 1 ? 'member' : 'members'}
      </Text>

      {roster.map((member) => (
        <Card key={member.profile_id}>
          <View style={styles.row}>
            <Text style={styles.memberName}>
              {member.display_name.trim().length > 0
                ? member.display_name
                : 'Invited — not signed in yet'}
            </Text>
            {member.role !== 'member' ? (
              <Tag>{member.role === 'host' ? 'Host' : 'Co-organizer'}</Tag>
            ) : null}
          </View>
          {member.skill_level ? (
            <Text style={styles.help}>
              {member.skill_level.charAt(0).toUpperCase() +
                member.skill_level.slice(1)}
            </Text>
          ) : null}
        </Card>
      ))}

      {mayInvite ? (
        <>
          <Button
            variant="secondary"
            onPress={onInvite}
            accessibilityLabel="Create an invite link"
          >
            Create an invite link
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/import`)}
            accessibilityLabel="Import a roster from a spreadsheet"
          >
            Import a roster
          </Button>
          {inviteUrl ? (
            <Card>
              <Text style={styles.help}>
                Share this link. It works for 30 days.
              </Text>
              <Text style={styles.inviteUrl} selectable>
                {inviteUrl}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[4],
  },
  centered: {
    alignItems: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  inviteUrl: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
});
