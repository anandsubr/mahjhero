import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import ErrorBanner from '../components/ErrorBanner';
import { FormCard, FormSection, FormTitle, TextRow } from '../components/GameForm';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import {
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  LogOutIcon,
  MessageCircleIcon,
  PeopleIcon,
} from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchProfile, isCompleteProfile, updateProfile } from '../lib/profile';
import type { SkillLevel } from '../lib/profile';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { colors, radius, type } from '../lib/theme';

export default function ProfileScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(null);
  // What the server last confirmed -- the identity row shows these, and the
  // form is "dirty" (Save changes appears) only while it differs from them.
  const [savedName, setSavedName] = useState('');
  const [savedLevel, setSavedLevel] = useState<SkillLevel | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
        setSavedName(profile.display_name);
        setSavedLevel(profile.skill_level);
        setIsAdmin(profile.is_admin ?? false);
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

  // Every early return below carries the tab bar, exactly as
  // app/clubs/index.tsx does in all of its states — its Club tab is the way
  // back out. A member whose `fetchProfile` failed would otherwise be left
  // staring at "Something went wrong" with no bar and, on native, no way out
  // short of relaunching the app.
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

  if (loadFailed) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <Text style={styles.error}>{GENERIC_ERROR}</Text>
      </Screen>
    );
  }

  async function onSave() {
    if (!session || saving) return;
    setError(null);
    // Also clear a prior "Saved" state before this attempt resolves — a
    // retry (or double-tap) that fails after a previous success must not
    // leave the screen showing both the new error and a stale "Saved"
    // confirmation, which would look like the failed write persisted.
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
      setSavedName(displayName);
      setSavedLevel(skillLevel);
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
  // "Save changes" only exists while the form differs from what was last
  // loaded or saved; it stays disabled (not hidden) if that difference is
  // an incomplete profile, so the hint below explains why.
  const dirty = displayName !== savedName || skillLevel !== savedLevel;
  const canSave = complete && !saving;
  const shownName = savedName.trim() || 'Your name';

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <FormTitle>Profile</FormTitle>

      <View style={styles.identity} testID="profile-identity">
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{(savedName.trim()[0] ?? '?').toUpperCase()}</Text>
        </View>
        <View style={styles.identityText}>
          <Text numberOfLines={1} style={styles.identityName}>
            {shownName}
          </Text>
          {savedLevel ? (
            <View style={styles.levelTag}>
              <Text style={styles.levelTagText}>{LEVEL_LABELS[savedLevel]}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <FormSection label="About you">
        <FormCard>
          <TextRow
            label="Name"
            value={displayName}
            onChangeText={(value) => {
              setDisplayName(value);
              setSaved(false);
              setError(null);
            }}
            placeholder="Your name"
            accessibilityLabel="Display name"
          />
          {/*
            Read-only: changing the account's email is a full
            re-verification flow this app does not have yet.
          */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.email}>{session.user.email ?? 'Not on file'}</Text>
          </View>
          <View style={styles.skillField}>
            <View>
              <Text style={styles.fieldLabel}>Skill level</Text>
              <Text style={styles.help}>Hosts use this to seat you at the right table.</Text>
            </View>
            <SkillSegmented
              value={skillLevel}
              onChange={(level) => {
                setSkillLevel(level);
                setSaved(false);
                setError(null);
              }}
            />
          </View>
        </FormCard>

        {complete ? null : (
          <Text style={styles.hint}>
            Add your name and skill level so hosts can seat you at the right table.
          </Text>
        )}
        {error ? <ErrorBanner message={error} /> : null}
        {dirty ? (
          <Pressable
            onPress={onSave}
            // Disabled while the write is in flight: a second tap would start
            // a second overlapping update whose result races the first.
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
            aria-disabled={!canSave}
            aria-busy={saving}
            style={({ pressed }) => [
              styles.save,
              pressed && canSave && styles.savePressed,
              !canSave && !saving && styles.saveDisabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>
                Save changes
              </Text>
            )}
          </Pressable>
        ) : saved ? (
          <View style={styles.saved} accessibilityLiveRegion="polite">
            <CheckIcon size={16} color={colors.accent2[700]} />
            <Text style={styles.savedText}>Saved</Text>
          </View>
        ) : null}
      </FormSection>

      <FormSection label="Settings">
        <FormCard>
          <SettingsRow
            icon={<BellIcon size={18} color={colors.accent[700]} />}
            title="Notifications"
            subtitle="Push and email, plus quiet hours"
            onPress={() => router.push('/notifications')}
          />
          <SettingsRow
            icon={<PeopleIcon size={18} color={colors.accent[700]} />}
            title="Friends"
            subtitle="The people you can hold seats with"
            onPress={() => router.push('/friends')}
          />
          <SettingsRow
            icon={<CircleHelpIcon size={18} color={colors.accent[700]} />}
            title="How it works"
            subtitle="Getting started, and tips you've hidden"
            onPress={() => router.push('/how-it-works')}
          />
          {isAdmin ? (
            <SettingsRow
              icon={<MessageCircleIcon size={18} color={colors.accent[700]} />}
              title="Greetings"
              subtitle="The dashboard's daily greeting"
              onPress={() => router.push('/admin/greetings')}
            />
          ) : null}
        </FormCard>
      </FormSection>

      <Pressable
        onPress={onSignOut}
        disabled={signingOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        aria-busy={signingOut}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.signOut,
          (pressed || hovered) && styles.signOutActive,
        ]}
      >
        {signingOut ? (
          <ActivityIndicator color={colors.accent[700]} />
        ) : (
          <>
            <LogOutIcon size={18} color={colors.accent[700]} />
            <Text style={styles.signOutText}>Sign out</Text>
          </>
        )}
      </Pressable>
    </Screen>
  );
}

const LEVELS: { value: SkillLevel; label: string; filled: number }[] = [
  { value: 'beginner', label: 'Beginner', filled: 1 },
  { value: 'intermediate', label: 'Intermediate', filled: 2 },
  { value: 'advanced', label: 'Advanced', filled: 3 },
];

const LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/**
 * The handoff's 3-way skill control: dots (●○○ / ●●○ / ●●●) over each label
 * in a pill track. A radiogroup, so screen readers
 * announce one grouped choice.
 */
function SkillSegmented({
  value,
  onChange,
}: {
  value: SkillLevel | null;
  onChange: (level: SkillLevel) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.segmented}>
      {LEVELS.map((level) => {
        const selected = value === level.value;
        const tint = selected ? '#ffffff' : colors.text;
        return (
          <Pressable
            key={level.value}
            onPress={() => onChange(level.value)}
            accessibilityRole="radio"
            // Flat `aria-selected` -- see components/Toggle.tsx's docstring
            // for why not `accessibilityState`.
            aria-selected={selected}
            accessibilityLabel={level.label}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <View style={styles.dots}>
              {[0, 1, 2].map((dot) => (
                <View
                  key={dot}
                  style={[
                    styles.dot,
                    { borderColor: tint },
                    dot < level.filled && { backgroundColor: tint },
                  ]}
                />
              ))}
            </View>
            <Text numberOfLines={1} style={[styles.segmentText, { color: tint }]}>
              {level.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A whole-row button: icon, title over subtitle, and a chevron. */
function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      style={({ pressed }) => [styles.settingsRow, pressed && styles.settingsRowPressed]}
    >
      {icon}
      <View style={styles.settingsText}>
        <Text style={styles.settingsTitle}>{title}</Text>
        <Text style={styles.settingsSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRightIcon size={16} color={colors.neutral[600]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 24, gap: 22 },
  centered: {
    alignItems: 'center',
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.accent[800],
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.accent2[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: type.heading, fontSize: 28, color: '#ffffff' },
  identityText: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  identityName: { fontFamily: type.bodyBold, fontSize: 19, color: colors.text, alignSelf: 'stretch' },
  levelTag: {
    backgroundColor: colors.accent[200],
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  levelTagText: { fontFamily: type.bodyBold, fontSize: 12, color: colors.accent[800] },
  field: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 12, gap: 2 },
  fieldLabel: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  email: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.neutral[800], paddingVertical: 2 },
  skillField: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  help: { fontFamily: type.bodyRegular, fontSize: 13, lineHeight: 18, color: colors.neutral[700] },
  hint: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral[700],
    paddingHorizontal: 6,
  },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  segmentSelected: { backgroundColor: colors.accent[700] },
  segmentText: { fontFamily: type.bodyBold, fontSize: 13 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 7, height: 7, borderRadius: radius.pill, borderWidth: 2 },
  save: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePressed: { backgroundColor: colors.accent[800] },
  saveDisabled: { backgroundColor: colors.accent[300] },
  saveText: { fontFamily: type.bodyBold, fontSize: 16, color: '#ffffff' },
  saveTextDisabled: { color: colors.accent[100] },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  savedText: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.accent2[700] },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingLeft: 16,
    paddingRight: 14,
  },
  settingsRowPressed: { opacity: 0.85 },
  settingsText: { flex: 1, minWidth: 0, gap: 1 },
  settingsTitle: { fontFamily: type.bodySemiBold, fontSize: 15, lineHeight: 19, color: colors.text },
  settingsSubtitle: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 16,
    color: colors.neutral[700],
  },
  signOut: {
    height: 50,
    borderRadius: 20,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  signOutActive: { backgroundColor: colors.accent[100] },
  signOutText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700] },
});
