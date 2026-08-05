import { GENERIC_ERROR } from './auth';
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
