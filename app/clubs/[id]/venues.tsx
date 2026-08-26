import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import DashboardHeader from '../../../components/DashboardHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import Tag from '../../../components/Tag';
import TabBar from '../../../components/TabBar';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../lib/clubs';
import type { Club } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  archiveVenue,
  fetchClubVenues,
  updateVenue,
  type Venue,
} from '../../../lib/venues';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';
import { useViewerInitials } from '../../../lib/use-viewer';

/**
 * The fix for a typeahead that can only create: a host who fat-fingers a
 * venue name at 11pm has no way to correct it here, and the misspelling
 * then rides on every event that venue is ever used for. Lists this club's
 * OWN venues via `fetchClubVenues` — deliberately not `searchVenues` with an
 * empty query, which also returns public venues other clubs added. This
 * club cannot edit those, and offering edit controls the database will
 * refuse (`update_venue`/`archive_venue` both assert organizer-of-the-
 * venue's-own-club) is worse than not offering them.
 */
export default function VenuesScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const initials = useViewerInitials();

  const [club, setClub] = useState<Club | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Kept separate from `loadFailed`, the same way the club detail screen
  // keeps its "upcoming events" fetch separate from the club/roster one: a
  // failed venue fetch is not "no venues" (the empty-state copy below would
  // be a false statement), and it must not blank a screen whose club name
  // and back link loaded just fine.
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesFailed, setVenuesFailed] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadVenues() {
    const result = await fetchClubVenues(clubId);
    if (result === null) {
      setVenuesFailed(true);
      return;
    }
    setVenuesFailed(false);
    setVenues(result);
  }

  useEffect(() => {
    if (!userId || !clubId) return;
    let cancelled = false;
    Promise.all([fetchClub(clubId), fetchRoster(clubId)]).then(([c, r]) => {
      if (cancelled) return;
      if (c === null || r === null) {
        setLoadFailed(true);
      } else {
        setClub(c);
        const myRole = r.find((m) => m.profile_id === userId)?.role;
        setIsOrganizer(myRole ? canInvite(myRole) : false);
      }
      setReady(true);
    });
    loadVenues();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, clubId]);

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

  // Checked before the `!ready` guard below, deliberately: `ready` is only
  // ever set inside the effect above, which returns immediately when there
  // is no session, so a signed-out visitor can never make it true. Checking
  // `!ready` first would strand them on the spinner instead of sending them
  // to sign in -- the guard-ordering defect this branch has already fixed
  // on the club detail screen, on app/index.tsx's storage race, and on the
  // new-event screen.
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

  function startEditing(venue: Venue) {
    setError(null);
    setEditing(venue.id);
    setDraftName(venue.name);
    setDraftAddress(venue.address_line ?? '');
  }

  function cancelEditing() {
    setError(null);
    setEditing(null);
  }

  async function save(venueId: string) {
    const name = draftName.trim();
    if (name.length === 0) {
      setError('Give the venue a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await updateVenue(venueId, {
      name,
      addressLine: draftAddress,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(null);
    await loadVenues();
  }

  async function archive(venueId: string) {
    setBusy(true);
    setError(null);
    const result = await archiveVenue(venueId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (editing === venueId) setEditing(null);
    await loadVenues();
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        {club.name}
      </Button>

      <DashboardHeader
        kicker={club.name}
        name="Venues"
        meta=""
        initials={initials}
        onPressAvatar={() => router.push('/profile')}
      />
      <Text style={styles.help}>
        Places this club plays. Add a new one while creating a game — this
        is where you fix a name or retire a venue you no longer use.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      {venuesFailed ? (
        <ErrorBanner message="Venues could not be loaded. Pull to refresh or try again shortly." />
      ) : venues.length === 0 ? (
        <Text style={styles.help}>
          No venues yet. The first one is added when you create a game.
        </Text>
      ) : (
        venues.map((venue) => (
          <Card key={venue.id}>
            {editing === venue.id ? (
              <>
                <TextField
                  label="Name"
                  value={draftName}
                  onChangeText={setDraftName}
                  accessibilityLabel={`Name of ${venue.name}`}
                />
                <TextField
                  label="Address (optional)"
                  value={draftAddress}
                  onChangeText={setDraftAddress}
                  accessibilityLabel={`Address of ${venue.name}`}
                />
                <View style={styles.chips}>
                  <Button
                    onPress={() => save(venue.id)}
                    loading={busy}
                    accessibilityLabel={`Save ${venue.name}`}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onPress={cancelEditing}
                    accessibilityLabel="Cancel editing"
                  >
                    Cancel
                  </Button>
                </View>
              </>
            ) : (
              <>
                <View style={styles.row}>
                  <Text style={styles.name}>{venue.name}</Text>
                  {venue.visibility === 'public' ? <Tag>Shared</Tag> : null}
                </View>
                {venue.address_line ? (
                  <Text style={styles.help}>{venue.address_line}</Text>
                ) : null}
                {venue.visibility === 'public' ? (
                  <Text style={styles.help}>
                    Other clubs can use this venue. It cannot be made private
                    again — their games point at it.
                  </Text>
                ) : null}

                {isOrganizer ? (
                  <View style={styles.chips}>
                    <Button
                      variant="secondary"
                      big={false}
                      disabled={busy}
                      onPress={() => startEditing(venue)}
                      accessibilityLabel={`Edit ${venue.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      big={false}
                      disabled={busy}
                      onPress={() => archive(venue.id)}
                      accessibilityLabel={`Retire ${venue.name}`}
                    >
                      Retire
                    </Button>
                  </View>
                ) : null}
              </>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
