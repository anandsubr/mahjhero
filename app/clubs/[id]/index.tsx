import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import DashboardHeader from '../../../components/DashboardHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import SkillLevelPips from '../../../components/SkillLevelPips';
import Tag from '../../../components/Tag';
import TabBar from '../../../components/TabBar';
import {
  canInvite,
  createInvite,
  fetchClub,
  fetchPendingInvites,
  fetchRoster,
} from '../../../lib/clubs';
import type { Club, ClubInvite, ClubMember } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import { openThreadForClub } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function ClubDetailScreen() {
  const { id, imported } = useLocalSearchParams<{
    id: string;
    imported?: string;
  }>();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Written synchronously and cleared on every exit path, the same shape
  // app/clubs/index.tsx uses for runBookingAction: `busy` state alone is
  // read from the render closure, so a guard written as `if (busy) return`
  // is blind to a second tap landing before React has re-rendered with the
  // disabled button -- this repo has shipped that exact bug five times.
  const messageBusyRef = useRef(false);

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;
    Promise.all([fetchClub(id), fetchRoster(id), fetchPendingInvites(id)]).then(
      ([c, r, i]) => {
        if (cancelled) return;
        // `i` is null only on a real failure. A plain member gets `[]` —
        // `club_invites_select_organizer` filters them out — which is the
        // right answer, not an error.
        if (c === null || r === null || i === null) setLoadFailed(true);
        else {
          setClub(c);
          setRoster(r);
          setInvites(i);
        }
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, id]);

  if (loading) {
    return (
      <Screen
        center
        contentStyle={styles.centered}
        tabBar={<TabBar active="club" />}
      >
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen
        center
        contentStyle={styles.centered}
        tabBar={<TabBar active="club" />}
      >
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (loadFailed || !club) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const me = roster.find((m) => m.profile_id === userId);
  // The roster is already loaded for the member list, so the viewer's role
  // costs nothing extra. `canInvite` is exactly the host-or-co-organizer
  // test the event functions enforce in SQL, so the UI and the database
  // agree about who may invite and manage venues rather than each deciding
  // separately. Gates "Open the club thread", "Create an invite link",
  // "Import a roster" and "Venues" below.
  const mayInvite = me ? canInvite(me.role) : false;

  // `app/clubs/[id]/import.tsx` redirects here with `?imported=<n>` after a
  // successful import. This screen ignored the parameter entirely, so a host
  // who pasted forty people landed on a page that still said "1 member" and
  // showed no trace of the import — no visible effect at all for the whole
  // feature. Parsed defensively because it arrives from a URL.
  const parsedImported = Number.parseInt(imported ?? '', 10);
  const importedCount =
    Number.isFinite(parsedImported) && parsedImported > 0 ? parsedImported : null;

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
    const { token, error: inviteError } = await createInvite(id);
    if (inviteError || !token) {
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    setInviteUrl(`${window.location.origin}/join/${token}`);
  }

  async function onMessageMembers() {
    if (!id || messageBusyRef.current) return;
    messageBusyRef.current = true;
    setError(null);
    const { id: threadId, error: threadError } = await openThreadForClub(id);
    messageBusyRef.current = false;
    if (threadError || !threadId) {
      setError(threadError ?? GENERIC_ERROR);
      return;
    }
    // The BOARD, not the flat thread screen. `open_thread_for_club` only
    // ever returns a club thread, and a club's conversation is a board of
    // posts now -- the flat screen would give an organizer a composer that
    // silently starts a new post per line and a badge that never clears.
    router.push(`/messages/club/${threadId}`);
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <DashboardHeader
        kicker="Your club"
        name={club.name}
        meta={club.rhythm}
        clubId={club.id}
        onPressBack={() => router.push('/clubs')}
        backLabel="Back to your clubs"
      />

      {mayInvite ? (
        // "Message members" -- this button's label before it stopped
        // pushing to a compose screen that emailed the roster -- is
        // muscle-memory copy for an action that no longer emails anybody.
        // Ordinary messages never email; only the thread screen's own
        // "Also email everyone" toggle does, and it defaults off. Naming
        // the destination rather than the old verb keeps the label honest.
        <Button
          variant="secondary"
          onPress={onMessageMembers}
          accessibilityLabel="Open the club thread"
        >
          Open the club thread
        </Button>
      ) : null}

      {importedCount !== null ? (
        <Card>
          <Text style={styles.confirmation}>
            {importedCount === 1
              ? '1 invitation sent.'
              : `${importedCount} invitations sent.`}{' '}
            They appear under Invited until each person joins.
          </Text>
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>
        {roster.length} {roster.length === 1 ? 'member' : 'members'}
      </Text>

      {/*
        Every row here is somebody who has signed in. `club_members` rows are
        written only by `create_club` and `accept_club_invite`, both of which
        require `auth.uid()`, so there is no such thing as a roster row for a
        person who has not. This used to render "Invited — not signed in yet"
        for an empty display_name, which could never mean what it said — and
        since a magic-link signup starts with `display_name = ''` and nothing
        forces a member to set one, it had begun labelling real, present
        members as absent. Genuinely-invited people are the separate section
        below, read from `club_invites`.
      */}
      {roster.map((member) => (
        <Card key={member.profile_id}>
          <View style={styles.row}>
            <Text style={styles.memberName}>
              {member.display_name.trim().length > 0
                ? member.display_name
                : 'Member'}
            </Text>
            {member.role !== 'member' ? (
              <Tag>{member.role === 'host' ? 'Host' : 'Co-organizer'}</Tag>
            ) : null}
          </View>
          {/*
            The pip glyph beside the word, not instead of it -- the word is
            what carries the meaning (SkillLevelPips is aria-hidden, same as
            SkillTierPips it wraps; see that component's own docstring).
            Nothing renders at all for a member with no skill_level: null
            means "not set", which is not a fourth level and must never draw
            as a dash (that reads as a table's "any level welcome", which no
            person can be -- see SkillLevelPips's own docstring).
          */}
          {member.skill_level ? (
            <View style={styles.skillRow}>
              <SkillLevelPips level={member.skill_level} />
              <Text style={styles.help}>
                {member.skill_level.charAt(0).toUpperCase() +
                  member.skill_level.slice(1)}
              </Text>
            </View>
          ) : null}
        </Card>
      ))}

      {/*
        Keyed on invite id, not email: `club_invites.email` is nullable (a
        plain "create an invite link" invite has none) and nothing stops a
        host inviting the same address twice.
      */}
      {invites.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>
            {invites.length} invited
          </Text>
          {invites.map((invite) => (
            <Card key={invite.id}>
              <View style={styles.row}>
                <Text style={styles.memberName}>
                  {invite.display_name && invite.display_name.trim().length > 0
                    ? invite.display_name
                    : (invite.email ?? 'Invite link')}
                </Text>
                <Tag>Invited</Tag>
              </View>
              <Text style={styles.help}>
                {invite.display_name &&
                invite.display_name.trim().length > 0 &&
                invite.email
                  ? invite.email
                  : 'Has not joined yet'}
              </Text>
            </Card>
          ))}
        </>
      ) : null}

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
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/venues`)}
            accessibilityLabel="Venues"
          >
            Venues
          </Button>
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
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  confirmation: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    lineHeight: 24,
  },
  inviteUrl: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
});
