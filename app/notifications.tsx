import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import TimeField from '../components/TimeField';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchPreferences, updatePreferences } from '../lib/profile';
import type { NotificationPreferences, NotifyChannel } from '../lib/profile';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';

const CHANNELS: NotifyChannel[] = ['push', 'email', 'both'];
const CHANNEL_LABEL: Record<NotifyChannel, string> = {
  both: 'Push and email',
  push: 'Push only',
  email: 'Email only',
};

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
              accessibilityState={{ selected }}
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
          <Switch
            value={prefs.quiet_hours_enabled}
            onValueChange={(value) => change({ quiet_hours_enabled: value })}
            accessibilityLabel="Enable quiet hours"
            trackColor={{ false: colors.neutral[400], true: colors.accentColor }}
            thumbColor={colors.bg}
          />
        </View>
        <Text style={styles.help}>
          Held in your own time zone. Reminders for games you've booked still come through.
        </Text>

        {prefs.quiet_hours_enabled ? (
          <View style={styles.timeRow}>
            <TimeField
              value={prefs.quiet_hours_start}
              onChange={(value) => change({ quiet_hours_start: value })}
              label="Quiet hours start"
            />
            <Text style={styles.toText}>to</Text>
            <TimeField
              value={prefs.quiet_hours_end}
              onChange={(value) => change({ quiet_hours_end: value })}
              label="Quiet hours end"
            />
          </View>
        ) : null}
      </Card>

      <Card row style={[styles.muteCard, styles.rowBetween]}>
        <Text style={[styles.cardLabel, styles.muteLabel]}>Mute "need a 4th" alerts</Text>
        <Switch
          value={prefs.mute_need_a_fourth}
          onValueChange={(value) => change({ mute_need_a_fourth: value })}
          accessibilityLabel="Mute need a fourth alerts"
          trackColor={{ false: colors.neutral[400], true: colors.accentColor }}
          thumbColor={colors.bg}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[3],
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
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
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  toText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    color: colors.textMuted,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.accent[800],
  },
});
