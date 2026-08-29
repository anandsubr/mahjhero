import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { GENERIC_ERROR } from '../lib/constants';
import { initialsFrom } from '../lib/dashboard';
import {
  addFriend,
  fetchAddablePeople,
  fetchFriends,
  removeFriend,
  sharedClubsLabel,
  type AddablePerson,
  type Friend,
} from '../lib/friends';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The `1C friends` artboard.
 *
 * Not one of the four tabs itself, but `appScreens` in the design still
 * renders the bar as a sibling of every signed-in screen, this one included
 * — the design source has no per-screen gate. It carries `active="profile"`:
 * this screen hangs off Profile, which is where the artboard's own back link
 * (below) also points.
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

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <Button variant="ghost" onPress={() => router.push('/profile')} big={false}>
        Profile
      </Button>

      <Text style={styles.heading}>Friends</Text>
      <Text style={styles.intro}>
        These are the people you can hold seats with when you join a table.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          {friends !== null && friends.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No friends yet. Add someone from your clubs below.
              </Text>
            </View>
          ) : null}

          {(friends ?? []).map((f) => (
            <Card key={f.profile_id} row style={styles.row}>
              <View style={[styles.avatar, styles.avatarFriend]}>
                <Text style={styles.avatarText}>{initialsFrom(f.display_name)}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{f.display_name}</Text>
                <Text style={styles.meta}>{sharedClubsLabel(f.club_names)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${f.display_name}`}
                disabled={busy}
                onPress={() => void act(() => removeFriend(f.profile_id))}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </Card>
          ))}

          {(people ?? []).length > 0 ? (
            <Text style={styles.sectionHeading}>People in your clubs</Text>
          ) : null}

          {(people ?? []).map((p) => (
            <Card key={p.profile_id} row style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTextDark}>
                  {initialsFrom(p.display_name)}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{p.display_name}</Text>
                <Text style={styles.meta}>{p.club_name}</Text>
              </View>
              <Button
                variant="secondary"
                big={false}
                disabled={busy}
                accessibilityLabel={`Add ${p.display_name}`}
                onPress={() => void act(() => addFriend(p.profile_id))}
              >
                Add
              </Button>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h1,
    color: colors.text,
  },
  intro: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  sectionHeading: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[3],
  },
  emptyCard: {
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  row: { alignItems: 'center', gap: space[3] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFriend: { backgroundColor: colors.accent2[500] },
  avatarText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.bg,
  },
  avatarTextDark: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  rowBody: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  remove: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
});
