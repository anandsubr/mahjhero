import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import BackRow from '../components/BackRow';
import ErrorBanner from '../components/ErrorBanner';
import { FormCard, FormTitle, formStyles } from '../components/GameForm';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { PeopleIcon, PlusIcon, SearchIcon, UserMinusIcon } from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
import { initialsFrom } from '../lib/dashboard';
import {
  addFriend,
  avatarColorFor,
  fetchAddablePeople,
  fetchFriends,
  removeFriend,
  sharedClubsLabel,
  type AddablePerson,
  type Friend,
} from '../lib/friends';
import { useSession } from '../lib/session';
import { colors, radius, type } from '../lib/theme';

/**
 * The `1C friends` artboard.
 *
 * Not one of the four tabs itself, but `appScreens` in the design still
 * renders the bar as a sibling of every signed-in screen, this one included
 * — the design source has no per-screen gate. It carries `active="profile"`:
 * this screen hangs off Profile.
 *
 * Also carries an explicit back link to Profile
 * (2026-09-02-edit-game-pencil-and-friends-back-link-design.md),
 * reinstating the artboard's own one — an earlier version of this screen
 * dropped it on the premise that the Profile tab reaches the identical
 * route, but that tab renders as already-active here, which reads as "you
 * are here" rather than "go back", the same correction
 * 2026-09-01-back-links-design.md already made for the club detail,
 * new-club, new-message and check-in screens — that document itself still
 * lists this screen among ones that should NOT get a back link, a call
 * this one revises.
 *
 * The "+ Invite someone by email" ghost button the artboard draws is
 * deliberately absent — it would need its own token, an acceptance path and
 * account linking, a second invite system beside club_invites, which already
 * covers inviting somebody who is not in the app. Recorded in the spec's
 * Part 1 so it is not later mistaken for an oversight.
 */
export default function FriendsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [people, setPeople] = useState<AddablePerson[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  // `busy` above is read from the render closure, so a guard written as
  // `if (busy) return` is blind to a tap landing in the same tick as an
  // earlier `setBusy(true)` — a queued tap, a screen reader activation, a
  // native double-tap — since the closure still holds the old value in that
  // window. This ref is written synchronously alongside `setBusy`, so it is
  // what actually makes the guard sound; `busy` itself keeps doing its own
  // job of driving the disabled look of the Add/Remove controls. See
  // app/clubs/index.tsx's identical comment for the same bug class.
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const [f, p] = await Promise.all([fetchFriends(), fetchAddablePeople()]);
    setFriends(f);
    setPeople(p);
    // Only the read failure sets this. An action's own refusal is set by the
    // action, and clearing it here would erase the message a member is
    // reading before they have read it.
    if (f === null || p === null) setError(GENERIC_ERROR);
    setReady(true);
  }, []);

  // Keyed on the user id, NOT on `session` — see app/profile.tsx's identical
  // comment. lib/session.tsx hands out a fresh Session object on every
  // onAuthStateChange (including TOKEN_REFRESHED and web tab focus);
  // depending on the object itself would re-run this load on every one of
  // those, discarding an in-flight add/remove for no reason.
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  const act = useCallback(
    async (run: () => Promise<{ error: string | null }>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const { error: refusal } = await run();
      if (refusal) {
        busyRef.current = false;
        setError(refusal);
        setBusy(false);
        return;
      }
      await load();
      busyRef.current = false;
      setBusy(false);
    },
    [load],
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const q = query.trim().toLowerCase();
  const allPeople = people ?? [];
  const shownPeople = q
    ? allPeople.filter((p) => p.display_name.toLowerCase().includes(q))
    : allPeople;
  const friendCount = friends?.length ?? 0;
  // With nobody to add and no friends either, there is nothing to say about
  // club-mates -- the section stays hidden, as it always has.
  const showPeople = allPeople.length > 0 || friendCount > 0;

  return (
    <Screen
      scroll
      contentStyle={[formStyles.body, styles.body]}
      tabBar={<TabBar active="profile" />}
    >
      <View style={styles.top}>
        <BackRow
          label="Profile"
          onPress={() => router.push('/profile')}
          accessibilityLabel="Back to profile"
        />
        <FormTitle>Friends</FormTitle>
        <Text style={styles.intro}>
          These are the people you can hold seats with when you join a table.
        </Text>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          {friends !== null ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderLabel}>Your friends</Text>
                {friendCount > 0 ? (
                  <Text style={styles.sectionCount}>{friendCount}</Text>
                ) : null}
              </View>
              {friendCount === 0 ? (
                <View style={styles.emptyCard}>
                  <View style={styles.emptyIcon}>
                    <PeopleIcon size={20} color={colors.accent2[800]} />
                  </View>
                  <Text style={styles.emptyText}>
                    No friends yet. Add someone from your clubs below.
                  </Text>
                </View>
              ) : (
                <FormCard>
                  {friends.map((f) => (
                    <View key={f.profile_id} style={styles.personRow}>
                      <Avatar id={f.profile_id} name={f.display_name} />
                      <View style={styles.rowBody}>
                        <Text style={styles.name}>{f.display_name}</Text>
                        <Text style={styles.meta}>{sharedClubsLabel(f.club_names)}</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${f.display_name}`}
                        disabled={busy}
                        onPress={() => void act(() => removeFriend(f.profile_id))}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.removeButton,
                          (pressed || hovered) && styles.removeButtonActive,
                          busy && styles.dimmed,
                        ]}
                      >
                        <UserMinusIcon size={18} color={colors.neutral[700]} />
                      </Pressable>
                    </View>
                  ))}
                </FormCard>
              )}
            </View>
          ) : null}

          {people !== null && showPeople ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>People in your clubs</Text>
              {allPeople.length > 0 ? (
                <View style={styles.search}>
                  <SearchIcon size={18} color={colors.neutral[700]} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search people"
                    placeholderTextColor={colors.neutral[600]}
                    accessibilityLabel="Search people"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.searchInput}
                  />
                </View>
              ) : null}
              {shownPeople.length > 0 ? (
                <FormCard>
                  {shownPeople.map((p) => (
                    <View key={p.profile_id} style={styles.personRow}>
                      <Avatar id={p.profile_id} name={p.display_name} />
                      <View style={styles.rowBody}>
                        <Text style={styles.name}>{p.display_name}</Text>
                        <Text style={styles.meta}>{p.club_name}</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${p.display_name}`}
                        disabled={busy}
                        onPress={() => void act(() => addFriend(p.profile_id))}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.addButton,
                          (pressed || hovered) && styles.addButtonActive,
                          busy && styles.dimmed,
                        ]}
                      >
                        <PlusIcon size={14} color="#ffffff" />
                        <Text style={styles.addText}>Add</Text>
                      </Pressable>
                    </View>
                  ))}
                </FormCard>
              ) : (
                <Text style={styles.peopleEmpty}>
                  {allPeople.length > 0
                    ? `No one matches \u201c${query.trim()}\u201d.`
                    : "You've added everyone in your clubs."}
                </Text>
              )}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: avatarColorFor(id) }]}>
      <Text style={styles.avatarText}>{initialsFrom(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 6, paddingBottom: 24 },
  centered: { alignItems: 'center' },
  top: { gap: 4 },
  intro: {
    fontFamily: type.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[700],
    paddingHorizontal: 4,
    marginTop: 4,
  },
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  sectionLabel: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text, paddingHorizontal: 6 },
  sectionHeaderLabel: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  sectionCount: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent2[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[700],
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.bodyBold, fontSize: 15, color: '#ffffff' },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  removeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonActive: { backgroundColor: colors.bg },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
  },
  addButtonActive: { backgroundColor: colors.accent[800] },
  addText: { fontFamily: type.bodyBold, fontSize: 14, color: '#ffffff' },
  dimmed: { opacity: 0.5 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
    outlineStyle: 'none' as never,
  },
  peopleEmpty: {
    fontFamily: type.bodyRegular,
    fontSize: 14,
    color: colors.neutral[700],
    paddingHorizontal: 6,
  },
});
