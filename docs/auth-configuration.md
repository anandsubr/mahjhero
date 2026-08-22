# Auth configuration

MahjHero treats **verified email as the identity key**. One verified address maps to
exactly one profile, regardless of how many providers the person uses.

## Required settings on the hosted Supabase project

These are not captured by migrations and must be set in the dashboard for each
environment (Authentication → Providers / Sign In).

| Setting | Value | Why |
|---|---|---|
| Email provider | Enabled, **magic link only** | The spec forbids passwords |
| Google provider | Enabled | Requested sign-in method |
| Apple provider | Enabled | Mandatory on iOS once Google is offered — App Store Review Guideline 4.8 |
| Confirm email | Enabled | Linking depends on the address being verified |
| Manual linking | Disabled | Leaves automatic linking on verified email in place |

Phone OTP was listed here as a required setting, but the app has no phone path:
nothing in `app/` or `lib/` collects a number or verifies an SMS code. Enabling a
provider no client can reach only widens the auth surface, so it is dropped until
a plan actually adds that route.

## Why this matters

If two providers produce two profiles for one person, they appear twice on a club
roster, their bookings split across both, and a host cannot tell which to remove.
`supabase/tests/database/identity_linking.test.sql` asserts this cannot happen; run
it against any environment whose auth settings change.

## Redirect URLs

Magic-link and OAuth redirects must be on the allow-list or GoTrue silently falls
back to the Site URL — which on iOS and Android means the link opens a browser and
the app never receives a session. Add `mahjhero://auth/callback` (what
`Linking.createURL('auth/callback')` produces in a standalone or dev-client build)
to **Authentication → URL Configuration → Redirect URLs** in every environment. The
local equivalent lives in `supabase/config.toml`'s `additional_redirect_urls`.

Expo Go instead produces a machine-specific `exp://<lan-ip>:8081/--/auth/callback`,
which each developer adds for their own address rather than committing.
