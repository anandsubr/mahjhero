import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ClubChips from '../../components/ClubChips';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { GENERIC_ERROR } from '../../lib/constants';
import { fetchMyClubs, type Club } from '../../lib/clubs';
import { initialsFrom } from '../../lib/dashboard';
import { fetchAddablePeople, fetchFriends } from '../../lib/friends';
import { createGroupThread, openThreadForClub } from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

type Candidate = { profile_id: string; display_name: string; meta: string };

/**
 * The `1C compose` artboard, with one deliberate deviation.
 *
 * The artboard offers Everyone / A group / People, where "a group" is a
 * NAMED per-club list — "Tuesday table", "Hosts" — that somebody maintains.
 * This app's groups are ad-hoc member sets that cut across clubs, so People
 * covers the same ground and a third choice would be a distinction without
 * a difference. Recorded in the spec so it is not later read as an
 * oversight.
 */
export default function NewMessageScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [target, setTarget] = useState<'everyone' | 'people'>('everyone');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Written synchronously and cleared on every exit path, read from a ref
  // rather than `busy` state: a second tap in the same tick reads `busy`
  // from that render's closure, which is still `false` because the first
  // tap's `setBusy(true)` has not re-rendered yet. Same bug class as
  // `busyRef`/`openingRef`/`sendingRef` in app/clubs/index.tsx,
  // app/friends.tsx, app/messages/index.tsx and app/messages/[threadId].tsx.
  const busyRef = useRef(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    void (async () => {
      const [myClubs, friends, people] = await Promise.all([
        fetchMyClubs(),
        fetchFriends(),
        fetchAddablePeople(),
      ]);
      if (cancelled) return;

      setClubs(myClubs ?? []);
      setClubId(myClubs?.[0]?.id ?? null);

      /*
       * Friends first, then people from your clubs.
       *
       * Not merely a nicety: a friend acquired in a club one of you has
       * since left appears in NEITHER club list, so ordering by club alone
       * would bury exactly the person the friends feature exists to keep
       * reachable.
       */
      setCandidates([
        ...(friends ?? []).map((f) => ({
          profile_id: f.profile_id,
          display_name: f.display_name,
          meta: 'Friend',
        })),
        ...(people ?? []).map((p) => ({
          profile_id: p.profile_id,
          display_name: p.display_name,
          meta: p.club_name,
        })),
      ]);

      if (myClubs === null || friends === null || people === null) {
        setError(GENERIC_ERROR);
      }
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const toggle = useCallback((id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    // Guarded here rather than left to createGroupThread's own empty-list
    // refusal: that check exists to stop a bad network call, not to be the
    // first place a member hears their tap did nothing. Matching its
    // wording keeps the message the same either way.
    if (target === 'people' && picked.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setError('Pick somebody to message.');
      return;
    }

    const result =
      target === 'everyone'
        ? clubId
          ? await openThreadForClub(clubId)
          : { id: null, error: 'Pick a club first.' }
        : await createGroupThread('', picked);

    if (result.error || !result.id) {
      // Cleared on this exit path too — a ref set and never cleared makes
      // the picker permanently dead, which is worse than the double-submit
      // bug it guards against.
      busyRef.current = false;
      setBusy(false);
      setError(result.error ?? GENERIC_ERROR);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    // `replace`, not `push`: the compose screen has served its purpose and
    // backing out of a thread should land on the list, not on a picker with
    // stale selections.
    router.replace(`/messages/${result.id}`);
  }, [target, clubId, picked, router]);

  const clubName = useMemo(
    () => clubs.find((c) => c.id === clubId)?.name ?? '',
    [clubs, clubId],
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button variant="ghost" big={false} onPress={() => router.push('/messages')}>
        Messages
      </Button>

      <Text style={styles.heading}>New message</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        <>
          {clubs.length > 1 ? (
            <>
              <Text style={styles.label}>In which club</Text>
              <ClubChips
                chips={clubs.map((c) => ({ id: c.id, label: c.name }))}
                selected={clubId ?? ''}
                onSelect={setClubId}
              />
            </>
          ) : null}

          <Text style={styles.label}>Send to</Text>
          <View style={styles.targets}>
            {(['everyone', 'people'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setTarget(option)}
                accessibilityRole="button"
                aria-selected={target === option}
                style={[
                  styles.target,
                  target === option ? styles.targetOn : null,
                ]}
              >
                <Text style={styles.targetText}>
                  {option === 'everyone' ? 'Everyone' : 'People'}
                </Text>
              </Pressable>
            ))}
          </View>

          {target === 'everyone' ? (
            <Card background={colors.accent2[100]}>
              <Text style={styles.note}>
                {/*
                  Ordinary messages never email -- only the thread screen's
                  "Also email everyone" toggle does, and it defaults off.
                  This used to say "as a club announcement", which read as a
                  promise that picking Everyone reaches the outbox. It does
                  not: Send here posts in the app only.
                */}
                Goes to everyone at {clubName}, in the app. Email is a
                separate opt-in on the thread.
              </Text>
            </Card>
          ) : (
            candidates.map((c) => {
              const on = picked.includes(c.profile_id);
              return (
                <Pressable
                  key={c.profile_id}
                  onPress={() => toggle(c.profile_id)}
                  accessibilityRole="button"
                  accessibilityLabel={c.display_name}
                  aria-selected={on}
                  style={[styles.person, on ? styles.personOn : null]}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {initialsFrom(c.display_name)}
                    </Text>
                  </View>
                  <View style={styles.personBody}>
                    <Text style={styles.personName}>{c.display_name}</Text>
                    <Text style={styles.personMeta}>{c.meta}</Text>
                  </View>
                </Pressable>
              );
            })
          )}

          <Button
            block
            accessibilityLabel="Start"
            disabled={busy}
            loading={busy}
            onPress={() => void start()}
          >
            Start
          </Button>
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
    fontSize: type.size.h3,
    color: colors.text,
  },
  label: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  targets: { flexDirection: 'row', gap: space[2] },
  target: {
    flex: 1,
    minHeight: 78,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: 'transparent',
  },
  targetOn: { borderBottomColor: colors.accentColor },
  targetText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  note: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.accent2[800],
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  personOn: { borderColor: colors.accentColor },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  personBody: { flex: 1, minWidth: 0 },
  personName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  personMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
