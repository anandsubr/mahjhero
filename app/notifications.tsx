import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchPreferences, updatePreferences } from '../lib/profile';
import type { NotificationPreferences, NotifyChannel } from '../lib/profile';
import { useSession } from '../lib/session';

const CHANNELS: NotifyChannel[] = ['push', 'email', 'both'];

export default function NotificationSettings() {
  const { session, loading } = useSession();
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{GENERIC_ERROR}</Text>
      </View>
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Notifications</Text>

      <Text style={styles.label}>How should we reach you?</Text>
      {CHANNELS.map((channel) => (
        <Pressable
          key={channel}
          style={[
            styles.option,
            prefs.notify_channel === channel ? styles.optionSelected : null,
          ]}
          onPress={() => change({ notify_channel: channel })}
          accessibilityRole="radio"
          accessibilityState={{ selected: prefs.notify_channel === channel }}
        >
          <Text style={styles.optionText}>
            {channel === 'both' ? 'Push and email' : channel === 'push' ? 'Push only' : 'Email only'}
          </Text>
        </Pressable>
      ))}

      <View style={styles.row}>
        <Text style={styles.label}>Quiet hours</Text>
        <Switch
          value={prefs.quiet_hours_enabled}
          onValueChange={(value) => change({ quiet_hours_enabled: value })}
          accessibilityLabel="Enable quiet hours"
        />
      </View>
      <Text style={styles.help}>
        We hold non-urgent notifications during these hours, in your own time zone.
        Reminders for games you have booked still come through.
      </Text>

      {prefs.quiet_hours_enabled ? (
        <View style={styles.row}>
          <TextInput
            style={styles.timeInput}
            value={prefs.quiet_hours_start}
            onChangeText={(value) => change({ quiet_hours_start: value })}
            placeholder="21:00"
            accessibilityLabel="Quiet hours start"
          />
          <Text style={styles.optionText}>to</Text>
          <TextInput
            style={styles.timeInput}
            value={prefs.quiet_hours_end}
            onChangeText={(value) => change({ quiet_hours_end: value })}
            placeholder="08:00"
            accessibilityLabel="Quiet hours end"
          />
        </View>
      ) : null}

      <View style={styles.row}>
        <Text style={styles.label}>Mute "need a 4th" alerts</Text>
        <Switch
          value={prefs.mute_need_a_fourth}
          onValueChange={(value) => change({ mute_need_a_fourth: value })}
          accessibilityLabel="Mute need a fourth alerts"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, saving ? styles.buttonDisabled : null]}
        onPress={onSave}
        // Disabled while the write is in flight: a second tap would start a
        // second overlapping update whose result races the first.
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving, busy: saving }}
      >
        {saving ? (
          <ActivityIndicator
            color="white"
            accessibilityLabel="Saving your notification settings"
          />
        ) : (
          <Text style={styles.buttonText}>{saved ? 'Saved' : 'Save'}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  label: { fontSize: 18, fontWeight: '600' },
  help: { fontSize: 16, color: '#666', lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  option: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 18 },
  optionSelected: { borderColor: '#1f6feb', borderWidth: 3 },
  optionText: { fontSize: 18 },
  timeInput: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    flex: 1,
  },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { backgroundColor: '#9db8e8' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  // 18pt is the app-wide minimum body text size (this player base skews
  // older); the brief's 16pt here was raised to match app/profile.tsx's
  // precedent for error text, which the member must be able to read.
  error: { color: '#b3261e', fontSize: 18 },
});
