import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import SkillLevelPips from '../../../components/SkillLevelPips';
import Tag from '../../../components/Tag';
import { ChevronLeftIcon } from '../../../components/icons';
import {
  canInvite,
  createInvite,
  fetchClub,
  fetchPendingInvites,
  fetchRoster,
} from '../../../lib/clubs';
import type { Club, ClubInvite, ClubMember } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  eventStatusLine,
  fetchUpcomingEvents,
  formatEventWhen,
} from '../../../lib/events';
import type { ClubEvent } from '../../../lib/events';
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
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Kept separate from `loadFailed`: that flag blanks the whole screen, which
  // is right when the club/roster/invites fetch fails (there is nothing to
  // show). A failed events fetch is different — the club name, roster and
  // invites all still loaded fine, so only the Upcoming section should
  // degrade, not the entire page.
  const [eventsFailed, setEventsFailed] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    fetchUpcomingEvents(id).then((result) => {
      if (cancelled) return;
      if (result === null) setEventsFailed(true);
      else setEvents(result);
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
  // The roster is already loaded for the member list, so the viewer's role
  // costs nothing extra. `canInvite` is exactly the host-or-co-organizer
  // test the event functions enforce in SQL, so the UI and the database
  // agree about who may invite, create games, and manage venues rather than
  // each deciding separately. The brief for this task named a second,
  // identically-computed `isOrganizer` for gating the events UI — same
  // roster, same role, same `canInvite` call — so this reuses `mayInvite`
  // instead of duplicating the lookup.
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

      <Text style={styles.sectionTitle}>Upcoming</Text>

      {eventsFailed ? (
        <Text style={styles.help}>Could not load upcoming games.</Text>
      ) : events.length === 0 ? (
        <Text style={styles.help}>
          {mayInvite
            ? 'No games scheduled yet. Add one and everyone in the club will see it.'
            : 'No games scheduled yet.'}
        </Text>
      ) : (
        events.map((event) => (
          <Link
            key={event.id}
            href={`/clubs/${id}/events/${event.id}`}
            asChild
          >
            {/*
              Pressable rather than Card, for the reason app/clubs/index.tsx
              documents at length: Card is a plain function component that
              neither declares accessibility props nor spreads unrecognised
              ones onto its View, so `Link asChild` cloning onto it drops the
              handler and leaves the card inert.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${event.title}, ${formatEventWhen(
                event.starts_at,
                club.timezone,
              )}`}
            >
              <Card>
                <View style={styles.row}>
                  <Text style={styles.memberName}>{event.title}</Text>
                  {event.status === 'cancelled' ? (
                    <Tag>Cancelled</Tag>
                  ) : null}
                </View>
                <Text style={styles.help}>
                  {formatEventWhen(event.starts_at, club.timezone)}
                  {' · '}
                  {event.venue_name}
                </Text>
                <Text style={styles.help}>
                  {event.table_count}{' '}
                  {event.table_count === 1 ? 'table' : 'tables'}
                </Text>
                {/*
                  Task 14: where the viewer stands on THIS game — their own
                  seat/waitlist place first, then a call for a fourth aimed
                  at everybody who is not already in, then the plain seat
                  count. Your own state always wins (see eventStatusLine's
                  doc comment in lib/events.ts) — a member already seated is
                  never told the table needs a fourth.
                */}
                <Text style={styles.help}>
                  {eventStatusLine(
                    {
                      starts_at: event.starts_at,
                      event_tables: event.event_tables,
                      bookings: event.bookings,
                      tables_labels: Object.fromEntries(
                        event.event_tables.map((t) => [t.id, t.label]),
                      ),
                    },
                    userId ?? '',
                  )}
                </Text>
              </Card>
            </Pressable>
          </Link>
        ))
      )}

      {mayInvite ? (
        <Button
          variant="secondary"
          onPress={() => router.push(`/clubs/${id}/events/new`)}
          accessibilityLabel="Add a game"
        >
          Add a game
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
          <Link href={`/clubs/${id}/venues`} style={styles.linkRow}>
            <Text style={styles.link}>Venues</Text>
          </Link>
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
  linkRow: { marginTop: space[6] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
