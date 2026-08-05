import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export type Profile = {
  id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  avatar_url: string | null;
  timezone: string;
};

export function isCompleteProfile(profile: {
  display_name: string;
  skill_level: SkillLevel | null;
}): boolean {
  return profile.display_name.trim().length > 0 && profile.skill_level !== null;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, skill_level, avatar_url, timezone')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('fetchProfile failed', error);
      return null;
    }
    return data as Profile;
  } catch (cause) {
    console.error('fetchProfile failed', cause);
    return null;
  }
}

/**
 * Never rejects, for the same reason as sendMagicLink in lib/auth.ts: the
 * profile screen awaits this directly and an escaping rejection would
 * strand the user mid-save with no message explaining why.
 */
export async function updateProfile(
  userId: string,
  changes: Partial<Pick<Profile, 'display_name' | 'skill_level' | 'timezone'>>,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', userId);

    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('updateProfile failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export type NotifyChannel = 'push' | 'email' | 'both';

export type NotificationPreferences = {
  notify_channel: NotifyChannel;
  mute_need_a_fourth: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `quiet_hours_start` / `quiet_hours_end` are Postgres `time` columns, which
 * PostgREST serializes as `"21:00:00"` — seconds included. The client's whole
 * surface is HH:MM: the text inputs, their `21:00` placeholder, TIME_PATTERN,
 * and every value a member can type.
 *
 * Normalizing here, on the way in, is what keeps a single canonical shape in
 * circulation. Widening TIME_PATTERN instead would leave two shapes alive and
 * push the difference into every future comparison.
 *
 * Left alone if it is already HH:MM, so this is safe to apply twice.
 */
export function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

/**
 * Quiet windows normally cross midnight (the default is 21:00–08:00), so any
 * distinct pair of valid times is a legal window. Only equal times are rejected,
 * because a zero-length window silently disables the feature.
 */
export function isValidQuietWindow(start: string, end: string): boolean {
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) return false;
  return start !== end;
}

/**
 * Never rejects, for the same reason as fetchProfile above: the notification
 * settings screen awaits this directly and an escaping rejection would leave
 * it stuck on a spinner with no way to explain why.
 */
export async function fetchPreferences(
  userId: string,
): Promise<NotificationPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'notify_channel, mute_need_a_fourth, quiet_hours_enabled, quiet_hours_start, quiet_hours_end',
      )
      .eq('id', userId)
      .single();

    if (error) {
      console.error('fetchPreferences failed', error);
      return null;
    }
    const row = data as NotificationPreferences;
    return {
      ...row,
      quiet_hours_start: normalizeTime(row.quiet_hours_start),
      quiet_hours_end: normalizeTime(row.quiet_hours_end),
    };
  } catch (cause) {
    console.error('fetchPreferences failed', cause);
    return null;
  }
}

/**
 * Never rejects, for the same reason as updateProfile above: the notification
 * settings screen awaits this directly and an escaping rejection would strand
 * the user mid-save with no message explaining why.
 */
export async function updatePreferences(
  userId: string,
  changes: Partial<NotificationPreferences>,
): Promise<{ error: string | null }> {
  const touchesStart = changes.quiet_hours_start !== undefined;
  const touchesEnd = changes.quiet_hours_end !== undefined;

  // Both bounds must travel together. Accepting one alone would let a caller
  // slip past validation and store a window this module considers invalid.
  if (touchesStart !== touchesEnd) {
    return { error: 'Quiet hours must be changed as a pair.' };
  }

  if (
    touchesStart &&
    touchesEnd &&
    !isValidQuietWindow(changes.quiet_hours_start!, changes.quiet_hours_end!)
  ) {
    return { error: 'Those quiet hours do not make sense.' };
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', userId);

    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('updatePreferences failed', cause);
    return { error: GENERIC_ERROR };
  }
}
