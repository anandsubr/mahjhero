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

/**
 * Four genuinely different outcomes, because two callers need to tell them
 * apart and a boolean cannot:
 *
 *  - `signed-in`      — tokens parsed, `setSession` succeeded.
 *  - `failed`         — it was an auth redirect and it went wrong; read `error`.
 *  - `already-signed-in` — this exact URL already produced a session, via the
 *    other arrival path. A *success*, not a no-op: see the Android note below.
 *  - `ignored`        — not an auth redirect at all. Leave the session alone.
 */
export type AuthRedirectStatus =
  | 'signed-in'
  | 'failed'
  | 'already-signed-in'
  | 'ignored';

export type AuthRedirectResult = {
  status: AuthRedirectStatus;
  error: string | null;
};

/**
 * Auth redirects reach this module twice for one sign-in on Android, and the
 * order is the opposite of what it looks like.
 *
 * `expo-web-browser` has no native auth session on Android: it opens a Custom
 * Tab and polyfills `openAuthSessionAsync` with its own `Linking` listener,
 * registered at tap time. `useAuthDeepLink`'s listener is registered at root
 * mount, so it is *first* in line — it consumes the redirect and establishes
 * the session before `openAuthSessionAsync` has even resolved. Only then does
 * `signInWithProvider` call in with the same URL.
 *
 * So the second arrival is the normal case, not the exception, and it must
 * report success. Reporting "not handled" would show the member
 * "Could not reach MahjHero" on every successful Android sign-in.
 *
 * Only URLs that actually produced a session are recorded, which is what makes
 * `already-signed-in` safe to treat as success. A redirect whose `setSession`
 * failed is deliberately left un-consumed so the other path can retry it —
 * burning it on a transient failure would strand the member permanently.
 *
 * Keyed on the full URL because the tokens in it are what make it single-use:
 * replaying one means presenting an already-rotated refresh token, which
 * GoTrue rejects.
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
      return { status: 'already-signed-in', error: null };
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
      return { status: 'ignored', error: null };
    }

    if (failureCode) {
      // Deliberately not recorded as consumed: nothing was spent, and if the
      // same error redirect arrives twice both callers should say so.
      return {
        status: 'failed',
        error: params.error_description ?? GENERIC_ERROR,
      };
    }

    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      // Left un-consumed on purpose. A transient setSession failure must not
      // burn the redirect — the other arrival path is the member's retry.
      console.error('completeAuthRedirect failed', error);
      return { status: 'failed', error: error.message };
    }

    if (consumedRedirectUrls.size >= CONSUMED_URL_LIMIT) {
      // Only the most recent redirect can plausibly be replayed; an unbounded
      // set would leak access tokens for the life of the process.
      consumedRedirectUrls.clear();
    }
    consumedRedirectUrls.add(url);

    return { status: 'signed-in', error: null };
  } catch (cause) {
    console.error('completeAuthRedirect failed', cause);
    return { status: 'failed', error: GENERIC_ERROR };
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

    const { status, error: redirectError } = await completeAuthRedirect(
      result.url,
    );
    if (status === 'ignored') {
      // The auth session reported success but the URL carried neither tokens
      // nor an error code. Nothing to recover from, and nothing to explain.
      return { error: GENERIC_ERROR };
    }
    // `already-signed-in` is the ordinary Android outcome, not a failure:
    // useAuthDeepLink's listener beat openAuthSessionAsync's polyfilled one to
    // the same URL and the session is already live. See completeAuthRedirect.
    return { error: redirectError };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('signInWithProvider failed', cause);
    return { error: GENERIC_ERROR };
  }
}
