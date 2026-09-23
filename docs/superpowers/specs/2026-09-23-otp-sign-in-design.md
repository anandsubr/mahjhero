# Email sign-in: magic link → OTP code — Design

**Date:** 2026-09-23
**Status:** Approved (design); pending implementation plan

## Problem

Email sign-in (`sendMagicLink` in `lib/auth.ts`, backed by
`supabase.auth.signInWithOtp`) currently emails a clickable link. On the web
app this breaks in a specific, confirmed way: a club invite
(`app/join/[token].tsx`) parks its token in `AsyncStorage` (browser
`localStorage` on web) and redirects a signed-out visitor to `/sign-in`. That
tab is one browser context. The sign-in *email*, when opened, is very often
tapped from a **different** browser context — many email/social apps
(Instagram, TikTok, Facebook, and confirmed by hand for Yahoo Mail's iOS app)
open links in their own embedded browser, which may not share storage with
whatever tab or app the invite link was originally opened in. The magic
link's redirect lands there, signs the visitor in, but `app/index.tsx`'s
pending-invite check reads an `AsyncStorage`/`localStorage` that never saw
the parked token — the invite is silently lost.

Confirmed root cause via a real device test: Yahoo Mail's iOS in-app browser
reports a user-agent byte-for-byte identical to real Safari
(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) ... Safari/604.1`),
meaning it is Apple's `SFSafariViewController` — a sanctioned, well-behaved
in-app browser Apple deliberately makes indistinguishable from Safari by
user-agent. There is no reliable client-side signal to detect or work around
this case. The only structural fix is removing the second browser context
from the flow entirely.

On native (iOS/Android), this bug cannot occur: tapping the magic link opens
`mahjhero://auth/callback` directly, which the OS hands to the
already-installed app, bypassing any browser. Native's one-tap sign-in
already works reliably. This project is choosing to unify on one method
across platforms anyway, trading that one-tap convenience for a single,
simpler code path — see Decision 1.

## Decisions

1. **OTP applies to both web and native**, not just web. Native isn't
   affected by the underlying bug, but a single unified flow is simpler to
   build, test, and reason about than branching sign-in's UI on
   `Platform.OS`. Native users type a 6-digit code instead of tapping a
   link — a minor step back in convenience, accepted for that simplicity.
2. **The code is the only way to sign in by email** — no clickable
   button/link ships alongside it. Keeping both would leave the broken path
   reachable for anyone who still taps the link instead of typing the code.
   Google/Apple OAuth (`signInWithProvider`, `app/auth/callback.tsx`) are
   unaffected by any of this and keep working exactly as they do today.
3. **The invite-parking mechanism does not change.** `app/join/[token].tsx`,
   `PENDING_INVITE_KEY`, and `app/index.tsx`'s redirect logic are untouched.
   This works because OTP verification never leaves the tab/app instance
   that parked the invite token — `supabase.auth.verifyOtp()` sets the
   session in the same JS context via the existing `onAuthStateChange`
   subscription (`lib/session.ts`), and `app/sign-in.tsx`'s existing
   `if (!loading && session) return <Redirect href="/" />` fires in place.
   The second-browser-context problem is structurally eliminated, not
   mitigated.
4. **Code length drops from 8 digits to 6** (`auth.email.otp_length` in
   Supabase's project config, currently 8 on mahjhero-dev). Six is the
   common standard and meaningfully less typing, with no real security
   loss for this use case.

## Architecture & data flow

- **`lib/auth.ts`**: `sendMagicLink` is renamed `sendSignInCode` (same
  `supabase.auth.signInWithOtp({ email })` call it makes today, minus the
  now-irrelevant `emailRedirectTo` — there is no link to redirect from). A
  new `verifySignInCode(email, code)` wraps
  `supabase.auth.verifyOtp({ email, token: code, type: 'email' })`,
  returning `{ error: string | null }` in the same never-rejects style as
  the rest of this file (see its existing docstrings for why).
- **`app/sign-in.tsx`**: the `status` state machine gains a step —
  `idle → sending → code-entry` — replacing today's terminal `sent` state.
  `code-entry` renders a code `TextField` and a "Verify" button in place of
  the current "Check your email" copy. "Use a different email" still works,
  resetting back to `idle`. A "Resend code" control is disabled for 60
  seconds after each send, matching mahjhero-dev's
  `auth.email.max_frequency: 1m0s`, with a visible countdown rather than a
  silent no-op or a confusing rate-limit error.
- **Nothing else changes.** `app/join/[token].tsx`, `app/index.tsx`,
  `app/auth/callback.tsx` (still needed for OAuth), and `lib/session.ts` are
  untouched.

## UI details

- The code field uses `textContentType="oneTimeCode"` (iOS) and
  `autoComplete="one-time-code"` (web/Android), so the OS can offer to
  autofill it from the Mail notification/QuickType bar — a genuine
  improvement over the tap-a-link flow for most people, not just a
  fallback for the broken case.
- **Errors**: `verifyOtp` cannot reliably distinguish a wrong code from an
  expired one (Supabase returns one generic invalid/expired error either
  way), so both map to a single message via the existing `ErrorBanner`:
  "That code didn't work — check it or request a new one."
- No separate route/screen is introduced for code entry; it is a state
  change within the existing `/sign-in` screen, avoiding an unnecessary
  navigation and keeping the email address in local component state rather
  than passing it across a route.

## Email template changes

Both customized templates (Magic Link, Confirm signup — maintained directly
in the Supabase dashboard, not tracked in this repo) drop the button and
`{{ .ConfirmationURL }}` entirely, replaced with `{{ .Token }}` shown large
and centered. The existing expiry ("expires shortly, can only be used once")
and ignore-if-not-you copy stays as-is; only the call-to-action changes from
"tap this button" to "enter this code in the app."

## Testing

Mirrors the existing `app/__tests__/sign-in.test.tsx` pattern (mocks
`lib/auth` and `expo-router` the same way that file already does):

- Submitting a valid email transitions to the code-entry step.
- Entering a code and pressing "Verify" calls `verifySignInCode` and, on
  success, relies on the existing session-redirect path (mocked the same
  way the current tests mock `Redirect`).
- A wrong/expired code shows the shared error message.
- "Resend code" is disabled for 60 seconds after a send and re-enables
  after the countdown.
- "Use a different email" returns to the email step.

Plus unit tests for `verifySignInCode` in `lib/auth.ts`, matching
`sendMagicLink`'s existing test style (mocking `supabase.auth.verifyOtp`).

## Out of scope

- Any change to `app/join/[token].tsx`, `PENDING_INVITE_KEY`, or
  `app/index.tsx` — confirmed unnecessary by the architecture above.
- The separate, still-pending email-targeted club invite redesign
  (organizer invites a specific email; accept/reject banner on login) that
  was being brainstormed before this bug took priority. That work resumes
  separately once this ships.
- OAuth (Google/Apple) sign-in — unaffected, unchanged.
