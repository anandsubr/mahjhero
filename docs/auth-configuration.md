# Auth configuration

MahjHero treats **verified email as the identity key**. One verified address maps to
exactly one profile, regardless of how many providers the person uses.

## Required settings on the hosted Supabase project

These are not captured by migrations and must be set in the dashboard for each
environment (Authentication → Providers / Sign In).

| Setting | Value | Why |
|---|---|---|
| Email provider | Enabled, **magic link only** | The spec forbids passwords |
| Phone provider | Enabled (OTP) | Second passwordless route |
| Google provider | Enabled | Requested sign-in method |
| Apple provider | Enabled | Mandatory on iOS once Google is offered — App Store Review Guideline 4.8 |
| Confirm email | Enabled | Linking depends on the address being verified |
| Manual linking | Disabled | Leaves automatic linking on verified email in place |

## Why this matters

If two providers produce two profiles for one person, they appear twice on a club
roster, their bookings split across both, and a host cannot tell which to remove.
`supabase/tests/database/identity_linking.test.sql` asserts this cannot happen; run
it against any environment whose auth settings change.
