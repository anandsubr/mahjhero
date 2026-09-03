import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import TimeField from '../components/TimeField';
import Toggle from '../components/Toggle';
import { ChevronLeftIcon } from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchPreferences, updatePreferences } from '../lib/profile';
import type { NotificationPreferences, NotifyChannel } from '../lib/profile';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';

// Display order matches the design (default channel first, then the two
// single-channel options), which also happens to read naturally. This is a
// presentation-only ordering — NotifyChannel and everything stored is
// untouched.
const CHANNELS: NotifyChannel[] = ['both', 'push', 'email'];
const CHANNEL_LABEL: Record<NotifyChannel, string> = {
  both: 'Push and email',
  push: 'Push only',
  email: 'Email only',
};

export default function NotificationSettings() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keyed on the user id, NOT on `session`. lib/session.tsx hands out a fresh
  // Session object on every onAuthStateChange — including TOKEN_REFRESHED,
  // which fires within the hour, and web tab focus. Depending on the object
  // would re-run this fetch and silently discard the quiet hours the member
  // was mid-way through editing.
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Reset per-account load state before fetching, so an account switch
    // cannot leave the previous member's error screen (or preferences) up
    // with `ready` already true.
    setReady(false);
    setPrefs(null);
    setSaved(false);
    setError(null);
    fetchPreferences(userId).then((fetched) => {
      if (cancelled) return;
      // fetchPreferences never rejects — it resolves null on any failure
      // (network error, RLS denial, ...). Setting `ready` regardless of the
      // outcome is what lets the screen fall through to the "could not
      // load" message below instead of spinning forever.
      setPrefs(fetched);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Every early return below carries the tab bar, exactly as
  // app/clubs/index.tsx does in all of its states. The back chevron that
  // rescues this screen lives in the main render, far below these guards, and
  // TabBar navigates with `router.replace` off an entry route that is itself
  // a `<Redirect>` — so the history stack is typically one deep. A member
  // whose `fetchPreferences` failed would otherwise be left staring at
  // "Something went wrong" with no bar, no back link, and on native no way
  // out short of relaunching the app — the same dead end this screen's back
  // chevron was added to close in the first place.
  //
  // The `<Redirect>` below is the deliberate exception: it renders nothing
  // and a signed-out member belongs at sign-in, not in a tab bar.
  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!prefs) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <Text style={styles.error}>{GENERIC_ERROR}</Text>
      </Screen>
    );
  }

  function change(patch: Partial<NotificationPreferences>) {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
    setError(null);
  }

  async function onSave() {
    if (!session || !prefs || saving) return;
    setError(null);
    // Also clear a prior "Saved" state before this attempt resolves — a
    // retry (or double-tap) that fails after a previous success must not
    // leave the screen showing both the new error and a stale "Saved"
    // button label, which would look like the failed write persisted.
    setSaved(false);
    // When quiet hours are off, the start/end inputs are not even rendered
    // (see below), so their values are stale and unverified — possibly not
    // valid HH:MM at all. Submitting them anyway would make updatePreferences
    // run pair validation against fields the member can no longer see or
    // fix, failing every future save (e.g. a channel-only change) with an
    // error that points at a field that isn't on screen. Omitting both
    // together keeps the pair check satisfied and leaves the stored values
    // untouched, which is harmless since they're unused while disabled.
    const payload: Partial<NotificationPreferences> = prefs.quiet_hours_enabled
      ? prefs
      : {
          notify_channel: prefs.notify_channel,
          mute_need_a_fourth: prefs.mute_need_a_fourth,
          quiet_hours_enabled: prefs.quiet_hours_enabled,
        };
    setSaving(true);
    try {
      // updatePreferences reports failure through `error` rather than
      // throwing, so the caller MUST read it. Setting `saved` unconditionally
      // would show "Saved" after a failed write and leave the member
      // believing their quiet hours persisted when they did not.
      const { error: saveError } = await updatePreferences(
        session.user.id,
        payload,
      );
      if (saveError) {
        setError(saveError);
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      {/* Without this the screen was a dead end on native: nothing else on
          it navigates away, so a member who opened it had no way off short
          of the OS back gesture (web) or force-quitting (there is no
          equivalent on a phone). */}
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push('/profile')}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to profile"
        style={styles.backButton}
      >
        Profile
      </Button>
      <Text style={styles.heading}>Notifications</Text>

      <Text style={styles.sectionLabel}>How should we reach you?</Text>
      <View style={styles.channelGroup}>
        {CHANNELS.map((channel) => {
          const selected = prefs.notify_channel === channel;
          return (
            <Pressable
              key={channel}
              style={[styles.channelOption, selected ? styles.channelOptionSelected : null]}
              onPress={() => change({ notify_channel: channel })}
              accessibilityRole="radio"
              // Flat `aria-selected`, not `accessibilityState={{ selected }}`
              // (which this used to send): react-native-web's createDOMProps
              // has no handling for `accessibilityState` at all, so every
              // channel row rendered `role="radio"` with no state a screen
              // reader could read. See components/Toggle.tsx's docstring for
              // the full account; React Native's own Pressable resolves
              // `selected: ariaSelected ?? accessibilityState?.selected`, so
              // this one prop still reaches the native accessibility tree
              // too. app/__tests__/notifications.test.tsx asserts the
              // rendered attribute.
              aria-selected={selected}
            >
              <Text style={styles.channelOptionText}>{CHANNEL_LABEL[channel]}</Text>
              <View style={styles.radioOuter}>
                {selected ? <View style={styles.radioInner} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Card style={styles.quietCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardLabel}>Quiet hours</Text>
          <Toggle
            value={prefs.quiet_hours_enabled}
            onValueChange={(value) => change({ quiet_hours_enabled: value })}
            accessibilityLabel="Enable quiet hours"
          />
        </View>
        <Text style={styles.help}>
          Held in your own time zone. Reminders for games you've booked still come through.
        </Text>

        {prefs.quiet_hours_enabled ? (
          // Stacked, not the design's side-by-side row with a "to" between
          // the two fields: the design assumed narrow free-text inputs, but
          // this app keeps native time pickers (a deliberate, required
          // deviation — see components/TimeField.tsx), and a picker renders
          // wider than a text field always has room for at any of this
          // app's supported widths. Stacking removes the width pressure
          // entirely rather than shrinking below the 18pt floor to force a
          // fit. The accessibilityLabel on each TimeField is unchanged
          // ("Quiet hours start"/"Quiet hours end"), so a screen reader
          // still announces the full context even though the visible
          // "Starts"/"Ends" labels here are shorter.
          <View style={styles.timeStack}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Starts</Text>
              <TimeField
                value={prefs.quiet_hours_start}
                onChange={(value) => change({ quiet_hours_start: value })}
                label="Quiet hours start"
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Ends</Text>
              <TimeField
                value={prefs.quiet_hours_end}
                onChange={(value) => change({ quiet_hours_end: value })}
                label="Quiet hours end"
              />
            </View>
          </View>
        ) : null}
      </Card>

      <Card row style={[styles.muteCard, styles.rowBetween]}>
        <Text style={[styles.cardLabel, styles.muteLabel]}>Mute "need a 4th" alerts</Text>
        <Toggle
          value={prefs.mute_need_a_fourth}
          onValueChange={(value) => change({ mute_need_a_fourth: value })}
          accessibilityLabel="Mute need a fourth alerts"
        />
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      <Button
        variant="primary"
        block
        onPress={onSave}
        // Disabled while the write is in flight: a second tap would start a
        // second overlapping update whose result races the first.
        disabled={saving}
        loading={saving}
        accessibilityLabel={saved ? 'Saved' : 'Save'}
      >
        {saved ? 'Saved' : 'Save'}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[3],
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
  sectionLabel: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[2],
  },
  channelGroup: {
    gap: space[2],
  },
  channelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  channelOptionSelected: {
    borderColor: colors.accentColor,
    backgroundColor: colors.accent[100],
  },
  channelOptionText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: colors.accentColor,
  },
  quietCard: {
    // Design: `padding: var(--space-4); gap: var(--space-2);` — overrides
    // Card's base-.card default (space-3 all sides).
    marginTop: space[2],
    padding: space[4],
  },
  muteCard: {
    // Design: `padding: var(--space-4);` on this card.
    padding: space[4],
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  cardLabel: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  muteLabel: {
    flex: 1,
    maxWidth: 220,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
  timeStack: {
    gap: space[3],
  },
  timeField: {
    gap: space[2],
  },
  timeLabel: {
    // Matches components/TextField.tsx's label treatment exactly, so this
    // reads as the same input pattern.
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.accent[800],
  },
});
