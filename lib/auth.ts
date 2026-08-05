import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
// expo-auth-session does not re-export QueryParams from its package root;
// this deep import is the path documented in Supabase's own Expo guide.
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { Platform } from 'react-native';
import { GENERIC_ERROR } from './constants';
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
      options: {
        // Without this, GoTrue redirects to the project Site URL, which is a
        // web address. On iOS/Android that opens a browser and the app never
        // sees the session, so the "Check your email" screen is a dead end.
        // The deep link is caught by lib/auth-deep-link.ts at app root.
        emailRedirectTo: Linking.createURL('auth/callback'),
      },
    });
    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('sendMagicLink failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export type AuthRedirectResult = {
  /**
   * `false` means the URL carried nothing for auth (an ordinary deep link, or
   * one this module has already consumed) and the caller should leave the
   * session alone. `true` means it was an auth redirect; read `error`.
   */
  handled: boolean;
  error: string | null;
};

/**
 * Auth redirects can reach this module twice for one sign-in: on Android,
 * `WebBrowser.openAuthSessionAsync` resolves with the redirect URL *and* the
 * OS may deliver the same URL to `Linking`'s listener. Replaying it would call
 * `setSession` a second time with an already-rotated refresh token, which
 * GoTrue rejects — turning a successful sign-in into a spurious error. Keyed
 * on the full URL because the tokens in it are what make it single-use.
 */
const consumedRedirectUrls = new Set<string>();
const CONSUMED_URL_LIMIT = 20;

/**
 * Test-only. The dedupe set is module state that outlives an individual test,
 * so a suite reusing a redirect URL across cases must clear it between them.
 */
export function __resetConsumedRedirectUrls(): void {
  consumedRedirectUrls.clear();
}

/**
 * The single place a Supabase auth redirect URL is turned into a session.
 *
 * Both routes home land here: the OAuth flow (where
 * `WebBrowser.openAuthSessionAsync` hands back the redirect in-process) and
 * the magic-link flow (where the OS delivers it as a deep link, cold or warm).
 * They must not drift apart, hence one function rather than two copies.
 *
 * The client runs GoTrue's implicit flow (auth-js's default `flowType`), so a
 * successful redirect carries `access_token`/`refresh_token` in the URL
 * fragment. `getQueryParams` reads the fragment and the query string alike.
 * A PKCE `?code=` redirect would need `exchangeCodeForSession` instead; it
 * cannot occur unless the client's `flowType` is changed.
 *
 * Never rejects, for the same reason as sendMagicLink.
 */
export async function completeAuthRedirect(
  url: string,
): Promise<AuthRedirectResult> {
  try {
    if (consumedRedirectUrls.has(url)) {
      return { handled: false, error: null };
    }

    const { params, errorCode } = QueryParams.getQueryParams(url);
    // `errorCode` is expo-auth-session's own convention (a literal
    // `errorCode` param). Supabase/GoTrue's redirect-with-error instead
    // uses `error` / `error_code` / `error_description`, so both are
    // checked — this path is unverified against a real GoTrue error
    // redirect, see task report.
    const failureCode = errorCode ?? params.error_code ?? params.error;
    const { access_token: accessToken, refresh_token: refreshToken } = params;
    const hasTokens = Boolean(accessToken && refreshToken);

    if (!failureCode && !hasTokens) {
      // Not an auth redirect. Deep links are a shared channel — a future
      // `mahjhero://game/123` must fall through here untouched.
      return { handled: false, error: null };
    }

    if (consumedRedirectUrls.size >= CONSUMED_URL_LIMIT) {
      // Only the most recent redirect can plausibly be replayed; an unbounded
      // set would leak access tokens for the life of the process.
      consumedRedirectUrls.clear();
    }
    consumedRedirectUrls.add(url);

    if (failureCode) {
      return { handled: true, error: params.error_description ?? GENERIC_ERROR };
    }

    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error('completeAuthRedirect failed', error);
      return { handled: true, error: error.message };
    }
    return { handled: true, error: null };
  } catch (cause) {
    console.error('completeAuthRedirect failed', cause);
    return { handled: true, error: GENERIC_ERROR };
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
 *
 * `supabase.auth.signInWithOAuth` only navigates the browser itself when
 * `isBrowser()` is true inside @supabase/auth-js (window and document both
 * defined) — see GoTrueClient's `_handleProviderSignIn`. React Native has
 * neither, so on iOS/Android the call is a silent no-op unless we drive the
 * redirect ourselves: open the returned authorize URL in a native auth
 * session, and when it comes back with tokens, hand them to `setSession`
 * explicitly.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<{ error: string | null }> {
  try {
    const isNative = Platform.OS !== 'web';
    const redirectTo = Linking.createURL('auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        // On web, leaving this false lets supabase-js navigate the page
        // itself (its own isBrowser() branch). On native there is no
        // browser for it to navigate, so we skip that and drive the
        // redirect through WebBrowser below instead.
        skipBrowserRedirect: isNative,
      },
    });
    if (error) {
      return { error: error.message };
    }

    if (!isNative) {
      // Web already navigated (or is about to, via the browser's own
      // location change) — nothing left for us to do here.
      return { error: null };
    }

    if (!data.url) {
      return { error: GENERIC_ERROR };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') {
      // The user backed out of the auth session (closed the tab, tapped
      // Cancel). That's a normal outcome, not a failure worth alarming
      // them about — resolve quietly with no error.
      return { error: null };
    }

    const { handled, error: redirectError } = await completeAuthRedirect(
      result.url,
    );
    if (!handled) {
      // The auth session reported success but the URL carried neither tokens
      // nor an error code. Nothing to recover from, and nothing to explain.
      return { error: GENERIC_ERROR };
    }
    return { error: redirectError };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('signInWithProvider failed', cause);
    return { error: GENERIC_ERROR };
  }
}
