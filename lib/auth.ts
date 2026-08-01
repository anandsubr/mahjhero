import { supabase } from './supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Never rejects. A function declared as returning `{ error }` must report
 * failure through that channel, not by throwing — the sign-in screen sets
 * its status to "sending" before calling this, and an escaping rejection
 * would strand the user in a spinner with the submit button disabled and
 * no message explaining why.
 */
export async function sendMagicLink(
  email: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });
    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('sendMagicLink failed', cause);
    return {
      error: 'Could not reach MahjHero. Check your connection and try again.',
    };
  }
}

export type OAuthProvider = 'google' | 'apple';

/**
 * App Store Review Guideline 4.8: an iOS app offering third-party sign-in must
 * also offer an equivalent privacy-preserving option. Sign in with Apple is that
 * option, so it is not optional wherever Google is present on iOS.
 */
export function availableProviders(platform: string): OAuthProvider[] {
  if (platform === 'android') {
    return ['google'];
  }
  return ['google', 'apple'];
}

/**
 * Never rejects, for the same reason as sendMagicLink: the sign-in screen
 * awaits this directly and an escaping rejection would strand the user
 * mid-interaction with no message explaining why.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('signInWithProvider failed', cause);
    return {
      error: 'Could not reach MahjHero. Check your connection and try again.',
    };
  }
}
