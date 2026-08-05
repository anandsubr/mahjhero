import { Link, Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchProfile, isCompleteProfile, updateProfile } from '../lib/profile';
import type { SkillLevel } from '../lib/profile';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

export default function ProfileScreen() {
  const { session, loading } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetchProfile(session.user.id).then((profile) => {
      if (profile) {
        setDisplayName(profile.display_name);
        setSkillLevel(profile.skill_level);
      }
      setReady(true);
    });
  }, [session]);

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

  async function onSave() {
    if (!session) return;
    setError(null);
    // Also clear a prior "Saved" state before this attempt resolves — a
    // retry (or double-tap) that fails after a previous success must not
    // leave the screen showing both the new error and a stale "Saved"
    // button label, which would look like the failed write persisted.
    setSaved(false);
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
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Your profile</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={(value) => {
          setDisplayName(value);
          setSaved(false);
          setError(null);
        }}
        placeholder="How your club knows you"
        accessibilityLabel="Display name"
      />

      <Text style={styles.label}>Skill level</Text>
      <Text style={styles.help}>
        Hosts use this to seat you at the right table.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.radioGroup}>
        {LEVELS.map((level) => (
          <Pressable
            key={level}
            style={[
              styles.option,
              skillLevel === level ? styles.optionSelected : null,
            ]}
            onPress={() => {
              setSkillLevel(level);
              setSaved(false);
              setError(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: skillLevel === level }}
          >
            <Text style={styles.optionText}>
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {isCompleteProfile({ display_name: displayName, skill_level: skillLevel }) ? null : (
        <Text style={styles.help}>
          Add your name and skill level so hosts can seat you at the right table.
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[
          styles.button,
          isCompleteProfile({ display_name: displayName, skill_level: skillLevel })
            ? null
            : styles.buttonDisabled,
        ]}
        onPress={onSave}
        disabled={
          !isCompleteProfile({ display_name: displayName, skill_level: skillLevel })
        }
        accessibilityRole="button"
        accessibilityState={{
          disabled: !isCompleteProfile({
            display_name: displayName,
            skill_level: skillLevel,
          }),
        }}
      >
        <Text style={styles.buttonText}>{saved ? 'Saved' : 'Save'}</Text>
      </Pressable>

      <Link href="/notifications" style={styles.linkRow}>
        <Text style={styles.link}>Notification settings</Text>
      </Link>

      <Pressable
        style={styles.signOut}
        onPress={() => supabase.auth.signOut()}
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  label: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  help: { fontSize: 16, color: '#666' },
  error: { color: '#b3261e', fontSize: 18 },
  // Wrapping the radio options in an accessibilityRole="radiogroup" View
  // (so screen readers announce one grouped choice, not three unrelated
  // radios) removes them from the container's own `gap: 12` between direct
  // children — reapply it here so the visual spacing is unchanged.
  radioGroup: { gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
  },
  option: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 18,
  },
  optionSelected: { borderColor: '#1f6feb', borderWidth: 3 },
  optionText: { fontSize: 18 },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { backgroundColor: '#9db8e8' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  linkRow: { marginTop: 24 },
  link: { fontSize: 18, color: '#1f6feb' },
  signOut: { marginTop: 32, alignItems: 'center' },
  signOutText: { fontSize: 18, color: '#b3261e' },
});
