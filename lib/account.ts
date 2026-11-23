import { Platform } from 'react-native';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

/**
 * Apple requires revoking a Sign in with Apple token when the account is
 * deleted. That needs a fresh authorization code, which only a new Apple
 * sheet can produce. Cancelling it must not block deletion.
 */
async function appleAuthorizationCode(): Promise<string | undefined> {
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Deletes the signed-in account through the `delete-account` edge function,
 * then signs out locally. Never rejects.
 */
export async function deleteAccount(): Promise<{ error: string | null }> {
  try {
    const { data } = await supabase.auth.getUser();
    const hasApple = data?.user?.identities?.some((i) => i.provider === 'apple') ?? false;
    const code =
      hasApple && Platform.OS === 'ios' ? await appleAuthorizationCode() : undefined;

    const { error } = await supabase.functions.invoke('delete-account', {
      body: code ? { apple_authorization_code: code } : {},
    });
    if (error) {
      console.error('deleteAccount failed', error);
      return { error: GENERIC_ERROR };
    }

    // The user row is gone, so the server-side sign-out may fail; the local
    // session still has to be cleared.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return { error: null };
  } catch (cause) {
    console.error('deleteAccount failed', cause);
    return { error: GENERIC_ERROR };
  }
}
