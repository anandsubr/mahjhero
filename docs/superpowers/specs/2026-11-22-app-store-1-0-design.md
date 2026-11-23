# App Store 1.0 readiness

Date: 2026-11-22

## Intent

MahjHero is about to be submitted to the App Store for the first time. An audit against the
App Review Guidelines found gaps that Apple routinely rejects apps for. This project closes
them and cuts version 1.0.0. The user made three decisions (2026-11-22): **email-only alerts for
1.0**, **a reviewer demo account that signs in with a password**, **iPhone only**. Everything else
marked *(call)* is Claude's.

## Goals

1. **Account deletion in the app** (Guideline 5.1.1(v)). Profile → Delete account deletes the
   account and the person's data, and revokes their Sign in with Apple token when they have one.
2. **Report and block** for user-generated content (Guideline 1.2): report any message, board
   post or reply, photo or file, or person; block a person; agree to terms with zero tolerance
   for objectionable content; the developer is emailed on every report and can remove content
   from an in-app admin screen.
3. **Privacy policy and terms** published on mahjhero.com and linked from the sign-in screen
   (as the terms agreement) and from Profile (Guideline 5.1.1(i)).
4. **No dead push options.** The server already sends every alert by email
   (`resolve_notify_channel` always returns 'email'); the app stops offering "Push only" /
   "Push and email".
5. **Native Sign in with Apple on iOS** *(call)*: today iOS opens Apple's web page in an auth
   session. Use `expo-apple-authentication` (already installed and configured) with
   `signInWithIdToken`, which reviewers expect and which yields the authorization code needed
   for token revocation.
6. **Reviewer access**: a "Use a password instead" path on sign-in, and a seed script that creates
   a review account with a populated demo club on prod.
7. **iPhone only** (`supportsTablet: false`) and **version 1.0.0**.

## Non-goals

- Push notifications (1.1).
- Profile photos (no upload UI exists).
- Moderation beyond remove/dismiss (no bans, no automatic filtering) *(call: Apple asks for a
  report mechanism, blocking, and timely action; keyword filtering is not required)*.
- Android release.

## Account deletion

**What is deleted** *(call)*: the auth user and profile; every message the person wrote (DMs,
group, game and club chat, announcements) with its attachments; their board posts **and the
replies under them** (a root's `root_id` FK is `on delete set null`, so replies must be removed
explicitly or they would surface as orphans); their photos and files in club media; their
bookings; and everything already cascading from `profiles` (memberships, friendships, check-ins,
payments, reads, hearts, tokens, calendar feeds). Future active bookings are cancelled through the
normal cancel path first, so waitlists promote. Clubs: the existing `club_members_after_delete`
trigger promotes the longest-tenured member to host, or deletes the club if nobody is left.

**What survives, anonymised**: rows other people own that merely record the person as an actor
(`created_by`, `booked_by`, `cancelled_by`, `recorded_by`, `marked_by`, `added_by`,
`winner_profile_id`, venues, events, series, threads, booking groups, rounds). These FKs become
`on delete set null` (dropping `not null` where needed). Screens already render a missing name;
any that don't must show "Former member".

**Flow**: Profile → "Delete account" row (destructive styling, last in Settings above Sign out)
→ `app/delete-account.tsx` explains what is deleted and that it cannot be undone → button
"Delete my account" → ConfirmSheet → on iOS, if the user has an `apple` identity, run
`AppleAuthentication.signInAsync` to get a fresh `authorizationCode` (cancelling it aborts
nothing: deletion proceeds without revocation) → call edge function `delete-account` →
sign out → `/welcome` with a "Your account was deleted." notice.

**Edge function `delete-account`** (POST, user JWT required): resolves the caller from the JWT;
if `apple_authorization_code` is given, exchanges it at `https://appleid.apple.com/auth/token`
with a client-secret JWT (ES256, from secrets `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` = `app.mahjhero.client`) and posts the refresh token to
`/auth/revoke`; revocation failure is logged, never blocks deletion. Then calls RPC
`delete_account_data(target)` (service role only), removes the storage objects it returns
(`club-media`, `message-images` buckets), and finally `auth.admin.deleteUser`.

## Report and block

**Data**
- `user_blocks(blocker_id, blocked_id, created_at)`, PK both, both FKs cascade, no self-block.
- `content_reports(id, reporter_id → profiles set null, kind ∈ message|club_media|profile,
  message_id → messages set null, media_id → club_media set null, reported_profile_id → profiles
  set null, club_id, reason ∈ spam|harassment|inappropriate|other, details ≤ 500 chars,
  status ∈ open|removed|dismissed, created_at, resolved_at, resolved_by)`.
- RLS on, no direct grants; definer RPCs: `report_content(kind, target_id, reason, details)`
  (caller must be able to read the target; returns the report id), `block_user(target)`,
  `unblock_user(target)`, `fetch_my_blocks()`; admin-only (`profiles.is_admin`):
  `fetch_reports(status)`, `resolve_report(report_id, action ∈ remove|dismiss)`. Remove deletes
  the message (and a root's replies) or the media row.

**Effect of a block** (symmetric for contact, one-way for visibility) *(call)*:
- The blocker no longer sees the blocked person's messages, board posts, replies, or media.
- Neither can start a DM with the other (`can_reach` false) or post in a two-person thread
  between them (`can_post_thread` false).
- Nothing tells the blocked person they were blocked.

**Admin email**: after `report_content` succeeds the client calls edge function
`notify-report` with the report id; it loads the report with the service role and emails
`ADMIN_EMAIL` (secret; hello@mahjhero.com) through the existing `SmtpSender`. A failed email
never fails the report.

**UI**
- Message bubble long-press (today: Reply) opens an action sheet: Reply, Report, Block {name}
  (Report/Block hidden on your own messages). Same on board PostCard ("…" button) and replies.
- Media viewer and FileRow menu gain Report (alongside Remove where allowed).
- MemberRow and the thread MembersPanel gain Block / Unblock.
- Report sheet: reason (Spam, Harassment or bullying, Inappropriate content, Something else),
  optional details, Submit → "Thanks. We'll review this within 24 hours."
- Profile → "Blocked people" (`app/blocked.tsx`) lists blocks with Unblock.
- Profile → "Reports" (admin only) → `app/admin/reports.tsx`: open reports with the content,
  reporter, reason; "Remove content" / "Dismiss".

## Legal

- `marketing/privacy/index.html` and `marketing/terms/index.html`, same look as the marketing
  page. Drafted by Claude from what the app actually collects; **the user approves the text
  before deploy**. Terms include the zero-tolerance clause, reporting, and removal.
- Sign-in screen: "By continuing, you agree to the Terms and Privacy Policy." with both links
  (opened with `expo-web-browser`).
- Profile: "Privacy policy" and "Terms" rows under a "Legal" group.

## Push options

`app/notifications.tsx` drops the channel picker; Profile's Notifications subtitle no longer
says "Push". Stored `notify_channel` values are left alone (the server ignores them).

## Reviewer access

- Sign-in gains a text link "Use a password instead" under the email form, showing email +
  password fields and "Sign in" (`supabase.auth.signInWithPassword`). Errors: "That email and
  password don't match." No sign-up or reset via password *(call)*.
- `scripts/seed-review-account.ts` (service-role key from env, target URL from env) creates or
  refreshes `review@mahjhero.com` with a password from env, a demo club with five demo members,
  upcoming games with bookings, a board post, and a group message, so a reviewer sees a lived-in
  app. Idempotent.

## Constraints

Project conventions throughout: Text/TextInput from `components/Text`, colours from
`lib/theme.ts`, 44pt targets; forward-only migrations, definer RPCs with `search_path = public`,
`auth.uid()` guard, revoke from public/anon, both `grants.test.sql` allowlists, raise-message
exemptions in `lib/bookings.test.ts`; pgTAP for every RPC; local Supabase only in tasks; QA Pass
updated per CLAUDE.md; Playwright baselines re-recorded deliberately.
