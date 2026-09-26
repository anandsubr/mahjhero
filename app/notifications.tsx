import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import BackRow from '../components/BackRow';
import ErrorBanner from '../components/ErrorBanner';
import {
  ActionBar,
  FormCard,
  FormSection,
  FormTitle,
  ToggleRow,
  formStyles,
} from '../components/GameForm';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import TimeField from '../components/TimeField';
import {
  BellIcon,
  CheckIcon,
  MailIcon,
  MoonIcon,
  SmartphoneIcon,
  UserPlusIcon,
} from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchPreferences, updatePreferences } from '../lib/profile';
import type { NotificationPreferences, NotifyChannel } from '../lib/profile';
import { useSession } from '../lib/session';
import { colors, radius, type } from '../lib/theme';

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
const CHANNEL_SUBTITLE: Record<NotifyChannel, string> = {
  both: 'Everything, both ways',
  push: 'Alerts on this phone',
  email: 'Nothing on your phone',
};
const CHANNEL_ICON: Record<NotifyChannel, (color: string) => ReactNode> = {
  both: (color) => <BellIcon size={18} color={color} />,
  push: (color) => <SmartphoneIcon size={18} color={color} />,
  email: (color) => <MailIcon size={18} color={color} />,
};

function samePreferences(a: NotificationPreferences, b: NotificationPreferences): boolean {
  return (
    a.notify_channel === b.notify_channel &&
    a.mute_need_a_fourth === b.mute_need_a_fourth &&
    a.quiet_hours_enabled === b.quiet_hours_enabled &&
    a.quiet_hours_start === b.quiet_hours_start &&
    a.quiet_hours_end === b.quiet_hours_end
  );
}

export default function NotificationSettings() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  // What the server last confirmed, so the save bar shows only while the
  // form differs from it and Discard can put it back.
  const [savedPrefs, setSavedPrefs] = useState<NotificationPreferences | null>(null);
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
    setSavedPrefs(null);
    setSaved(false);
    setError(null);
    fetchPreferences(userId).then((fetched) => {
      if (cancelled) return;
      // fetchPreferences never rejects — it resolves null on any failure
      // (network error, RLS denial, ...). Setting `ready` regardless of the
      // outcome is what lets the screen fall through to the "could not
      // load" message below instead of spinning forever.
      setPrefs(fetched);
      setSavedPrefs(fetched);
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

  if (!prefs || !savedPrefs) {
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

  function onDiscard() {
    setPrefs(savedPrefs);
    setSaved(false);
    setError(null);
  }

  async function onSave() {
    if (!session || !prefs || !savedPrefs || saving) return;
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
      // With quiet hours off the times were not sent, so the stored ones are
      // still the last saved pair -- keep the form on those too.
      const stored = prefs.quiet_hours_enabled
        ? prefs
        : {
            ...prefs,
            quiet_hours_start: savedPrefs.quiet_hours_start,
            quiet_hours_end: savedPrefs.quiet_hours_end,
          };
      setPrefs(stored);
      setSavedPrefs(stored);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const dirty = !samePreferences(prefs, savedPrefs);

  return (
    <Screen
      scroll
      contentStyle={[formStyles.body, styles.body]}
      tabBar={
        <>
          {dirty ? (
            <ActionBar
              aboveTabBar
              onCancel={onDiscard}
              cancelLabel="Discard"
              primaryLabel="Save changes"
              primaryAccessibilityLabel="Save changes"
              onPrimary={onSave}
              // Busy while the write is in flight: a second tap would start
              // a second overlapping update whose result races the first.
              busy={saving}
            />
          ) : null}
          <TabBar active="profile" />
        </>
      }
    >
      {/* Without this the screen was a dead end on native: nothing else on
          it navigates away, so a member who opened it had no way off short
          of the OS back gesture (web) or force-quitting (there is no
          equivalent on a phone). */}
      <View style={styles.top}>
        <BackRow
          label="Profile"
          onPress={() => router.push('/profile')}
          accessibilityLabel="Back to profile"
        />
        <FormTitle>Notifications</FormTitle>
      </View>

      <FormSection label="How should we reach you?">
        <FormCard>
          {CHANNELS.map((channel) => {
            const selected = prefs.notify_channel === channel;
            return (
              <Pressable
                key={channel}
                style={({ pressed }) => [styles.channelRow, pressed && styles.pressed]}
                onPress={() => change({ notify_channel: channel })}
                accessibilityRole="radio"
                // The label alone, not label + subtitle, so a screen reader
                // announces the choice itself.
                accessibilityLabel={CHANNEL_LABEL[channel]}
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
                <View style={styles.channelIcon}>{CHANNEL_ICON[channel](colors.accent[700])}</View>
                <View style={styles.channelText}>
                  <Text style={styles.channelLabel}>{CHANNEL_LABEL[channel]}</Text>
                  <Text style={styles.channelSubtitle}>{CHANNEL_SUBTITLE[channel]}</Text>
                </View>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
              </Pressable>
            );
          })}
        </FormCard>
      </FormSection>

      <FormSection label="Quiet hours">
        <FormCard>
          <View>
            <ToggleRow
              icon={<MoonIcon size={18} color={colors.accent2[700]} />}
              title="Pause notifications overnight"
              helper="Held in your own time zone. Reminders for games you've booked still come through."
              value={prefs.quiet_hours_enabled}
              onValueChange={(value) => change({ quiet_hours_enabled: value })}
              accessibilityLabel="Enable quiet hours"
            />
            {prefs.quiet_hours_enabled ? (
              // The accessibilityLabel on each TimeField is unchanged ("Quiet
              // hours start"/"Quiet hours end"), so a screen reader still
              // announces the full context behind the shorter From/Until.
              <View style={styles.timeGrid}>
                <TimeField
                  tileLabel="From"
                  value={prefs.quiet_hours_start}
                  onChange={(value) => change({ quiet_hours_start: value })}
                  label="Quiet hours start"
                />
                <TimeField
                  tileLabel="Until"
                  value={prefs.quiet_hours_end}
                  onChange={(value) => change({ quiet_hours_end: value })}
                  label="Quiet hours end"
                />
              </View>
            ) : null}
          </View>
        </FormCard>
      </FormSection>

      <FormSection label="Alerts">
        <FormCard>
          <ToggleRow
            icon={<UserPlusIcon size={18} color={colors.accent[700]} />}
            title={'Mute "need a 4th" alerts'}
            helper={
              prefs.mute_need_a_fourth
                ? "You won't hear when a table is one player short."
                : 'Get a nudge when a table is one player short.'
            }
            value={prefs.mute_need_a_fourth}
            onValueChange={(value) => change({ mute_need_a_fourth: value })}
            accessibilityLabel="Mute need a fourth alerts"
          />
        </FormCard>
      </FormSection>

      {error ? <ErrorBanner message={error} /> : null}
      {saved && !dirty ? (
        <View style={styles.saved} accessibilityLiveRegion="polite">
          <CheckIcon size={14} color={colors.accent2[700]} />
          <Text style={styles.savedText}>Saved</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 6, paddingBottom: 24 },
  centered: {
    alignItems: 'center',
  },
  top: { gap: 4 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 16,
  },
  pressed: { opacity: 0.85 },
  channelIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelText: { flex: 1, minWidth: 0 },
  channelLabel: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
  channelSubtitle: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.neutral[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.accentColor },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
  },
  timeGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  savedText: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.accent2[700] },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.accent[800],
  },
});
