import { Link, Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import SkillLevelPicker from '../components/SkillLevelPicker';
import TextField from '../components/TextField';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchProfile, isCompleteProfile, updateProfile } from '../lib/profile';
import type { SkillLevel } from '../lib/profile';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { colors, space, type } from '../lib/theme';

export default function ProfileScreen() {
  const { session, loading } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the user id, NOT on `session`. lib/session.tsx hands out a fresh
  // Session object on every onAuthStateChange — including TOKEN_REFRESHED,
  // which fires within the hour, and web tab focus. Depending on the object
  // would re-run this fetch and overwrite whatever the member was mid-way
  // through typing. The id only changes on a real account switch, which is
  // the one case where a refetch is correct.
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Reset per-account load state before fetching. Without this an account
    // switch after a failed load leaves the previous member's error screen up
    // over the new member's profile, with `ready` already true so the spinner
    // never reappears.
    setReady(false);
    setLoadFailed(false);
    setSaved(false);
    setError(null);
    fetchProfile(userId).then((profile) => {
      if (cancelled) return;
      if (profile) {
        setDisplayName(profile.display_name);
        setSkillLevel(profile.skill_level);
      } else {
        // fetchProfile never rejects — it resolves null on any failure
        // (network error, RLS denial, missing row). Falling through to a
        // blank but editable form here is a data-loss path: the member
        // re-types their name over a profile that loaded fine on the server
        // and saves it, destroying the real one. app/notifications.tsx
        // already refuses to render its form in this case; mirror that.
        setLoadFailed(true);
      }
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

  if (loadFailed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{GENERIC_ERROR}</Text>
      </View>
    );
  }

  async function onSave() {
    if (!session || saving) return;
    setError(null);
    // Also clear a prior "Saved" state before this attempt resolves — a
    // retry (or double-tap) that fails after a previous success must not
    // leave the screen showing both the new error and a stale "Saved"
    // button label, which would look like the failed write persisted.
    setSaved(false);
    setSaving(true);
    try {
      // updateProfile reports failure through `error` rather than throwing, so
      // the caller MUST read it. Setting `saved` unconditionally would show
      // "Saved" after a failed write and leave the member believing their
      // skill level persisted when it did not.
      const { error: saveError } = await updateProfile(session.user.id, {
        display_name: displayName,
        skill_level: skillLevel,
      });
      if (saveError) {
        setError(saveError);
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function onSignOut() {
    if (signingOut) return;
    setError(null);
    setSigningOut(true);
    try {
      // Fire-and-forget here left an unhandled rejection on failure and the
      // member still signed in with nothing on screen to say so.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError(signOutError.message);
    } catch (cause) {
      console.error('signOut failed', cause);
      setError(GENERIC_ERROR);
    } finally {
      setSigningOut(false);
    }
  }

  const complete = isCompleteProfile({
    display_name: displayName,
    skill_level: skillLevel,
  });
  const canSave = complete && !saving;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Your profile</Text>
      <Text style={styles.subheading}>Two things and you're ready to sit down at a table.</Text>

      <TextField
        label="Name"
        value={displayName}
        onChangeText={(value) => {
          setDisplayName(value);
          setSaved(false);
          setError(null);
        }}
        placeholder="How your club knows you"
        accessibilityLabel="Display name"
      />

      <View style={styles.skillSection}>
        <Text style={styles.help}>Skill level — hosts use this to seat you at the right table.</Text>
        <SkillLevelPicker
          value={skillLevel}
          onChange={(level) => {
            setSkillLevel(level);
            setSaved(false);
            setError(null);
          }}
        />
      </View>

      {complete ? null : (
        <Text style={styles.help}>
          Add your name and skill level so hosts can seat you at the right table.
        </Text>
      )}
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        variant="primary"
        block
        onPress={onSave}
        // Disabled while the write is in flight: a second tap would start a
        // second overlapping update whose result races the first.
        disabled={!canSave}
        loading={saving}
        accessibilityLabel={saved ? 'Saved' : 'Save'}
      >
        {saved ? 'Saved' : 'Save'}
      </Button>

      {/* The design also shows a "Friends" card here, but that feature does
          not exist yet — omitted rather than linking somewhere with nothing
          behind it. */}
      <Card style={styles.settingsCard}>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>Notifications</Text>
          <Link href="/notifications" style={styles.editLink}>
            <Text style={styles.editLinkText}>Edit</Text>
          </Link>
        </View>
        <Text style={styles.help}>Push and email, plus quiet hours</Text>
      </Card>

      <Button
        variant="ghost"
        big={false}
        onPress={onSignOut}
        disabled={signingOut}
        loading={signingOut}
        accessibilityLabel="Sign out"
        style={styles.signOut}
      >
        Sign out
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[4],
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
  subheading: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
    marginTop: -space[2],
  },
  skillSection: {
    gap: space[2],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.accent[800],
  },
  settingsCard: {
    marginTop: space[2],
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsLabel: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  editLink: {
    padding: space[1],
  },
  editLinkText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
  signOut: {
    alignSelf: 'flex-start',
    marginTop: space[2],
  },
});
