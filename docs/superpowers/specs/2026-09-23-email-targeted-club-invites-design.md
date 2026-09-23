# Email-targeted club invites — Design

**Date:** 2026-09-23
**Status:** Approved (design); pending implementation plan

## Problem

Club invites are currently a pure bearer credential. `club_invites.token`
(server-generated, `supabase/migrations/20260822043449_server_generated_invite_tokens.sql`)
is the only thing `accept_club_invite` checks before adding the caller to a
club — whoever holds the token string gets in, regardless of who it was
"addressed" to. The table has an `email` column
(`supabase/migrations/20260822033527_create_clubs.sql:29-41`), but it is
optional, unenforced, and never read at redemption time. An organizer shares
a link (copy-paste, text, verbal); anyone who opens it while signed in is
silently added.

Separately, nothing about invite creation sends an email at all today —
`createInvite` (`lib/clubs.ts:457-484`) is a plain insert, and there is no
trigger, edge function, or outbox row wired to it. The organizer is entirely
responsible for getting the link to the right person, out of band.

## Decisions

1. **The invite becomes email-targeted, full stop — the anonymous
   shareable-link flow is removed, not kept alongside the new one.** Keeping
   both would leave the exact bug this redesign fixes reachable through the
   old path. `app/join/[token].tsx` (the link-redemption screen) and the
   "Create an invite link" button (`app/clubs/[id]/index.tsx:433-456`, and
   its event-scoped sibling in `app/clubs/[id]/events/[eventId]/index.tsx`)
   are deleted, not deprecated-in-place.
2. **The `token` column is dropped, not just unused.** Under the old model
   the token was the security boundary; under the new model, security comes
   from "authenticated, and your account's email matches the invite's
   email." A token that no longer protects anything is a future
   source of confusion, not a harmless leftover.
3. **Creating an invite sends an email automatically**, via a new, dedicated
   edge function (`send-club-invite`) that calls Resend directly — not by
   extending the existing `notification_outbox` / `deliver-notifications`
   pipeline. That pipeline resolves recipients through `auth.users`
   (`supabase/functions/deliver-notifications/render.ts:33,72`), which does
   not exist yet for someone who has never signed up — adapting it to
   support an arbitrary target email would mean changing how a shared
   system resolves recipients. A small, isolated function sending straight
   to the target address, whether or not they have an account, is simpler
   and does not touch that shared system. The trade-off, accepted
   deliberately: if the function call fails right after the invite row is
   inserted (e.g. a dropped connection), the invite exists but the email
   never went out. Mitigated with a per-row "Resend invite email" action in
   the organizer's invite list, rather than building outbox-style
   durability for this.
4. **The invite email carries a plain navigation link, not an auth
   link.** It points at `app.mahjhero.com/sign-in` with no token, no session
   data, nothing in the URL — signing in from there is the exact same
   OTP-code flow as any other sign-in
   (`docs/superpowers/specs/2026-09-23-otp-sign-in-design.md`), whether the
   address is brand new or already registered. This carries none of the
   in-app-browser fragility a magic link had, because it isn't a credential
   at all.
5. **Acceptance happens from a dashboard banner, not a link.** Once signed
   in, `fetch_my_pending_invites()` surfaces any pending invite addressed to
   the caller's own email, on every dashboard load — no client-side storage
   or hand-off between screens is needed (a real simplification over the
   old `PENDING_INVITE_KEY`/`AsyncStorage` parking dance, which existed
   purely to survive a link click landing in a different browser context;
   with no link, there's no context to survive).
6. **"Import a roster"** (`importRoster`, `lib/clubs.ts:584-630`, which
   already collects one email per row) calls the same `send-club-invite`
   function once per imported row, so a bulk import now actually notifies
   people instead of silently creating invites nobody is told about.

## Architecture

### Data model

`club_invites` changes:
- Drop `token` and its server-side default generation.
- `email` becomes `not null` (every invite is targeted now).
- Add `declined_at timestamptz`, mirroring the existing `accepted_at`, so an
  invite's status is pending / accepted / declined rather than just
  accepted-or-not.

`display_name`, `skill_level`, `invited_by`, `expires_at`, `accepted_at`,
`accepted_by`, `event_id`, and the event-matches-club trigger
(`20260905120000_club_invites_event_id.sql:19-37`) are unchanged.

Any existing invite row with a null `email` (created under the old
anonymous-link flow, on mahjhero-dev or any other environment this has
already run against) is unredeemable under the new model regardless — there
is no email to match against. The migration deletes those rows before
adding the `not null` constraint, rather than leaving the constraint to
fail against pre-existing data.

### RPCs

Three RPCs replace today's single `accept_club_invite`:

- **`fetch_my_pending_invites()`** — new, `security definer`. Reads the
  caller's own email (joining `auth.users` on `auth.uid()`) and returns
  pending invites (not accepted, not declined, not expired) addressed to
  it, each with the club name and (if tied to one) the event. Has to be
  `security definer` rather than a new RLS policy for the same reason
  today's `accept_club_invite` already is: the caller is by definition not
  yet a member of the club the invite is for, so every membership-scoped
  policy on `club_invites` excludes them. This codebase has no existing
  precedent for an email-matching RLS policy (`auth.email()`/`auth.jwt()`
  appear nowhere in the migrations), so an RPC — consistent with the
  pattern already established for this exact "caller isn't a member yet"
  problem — is the smaller change over introducing new RLS surface area.
- **`accept_club_invite(invite_id uuid)`** — same body as today's version
  (creates the profile row if missing, inserts `club_members`, best-effort
  seats the caller if the invite carries an `event_id`, per
  `supabase/migrations/20260905170000_accept_invite_seating_log_warning.sql:14-114`),
  minus the token lookup: takes the invite's `id` directly (known from what
  `fetch_my_pending_invites` returned) and additionally checks that the
  invite's `email` matches the caller's authenticated email before doing
  anything else. That check is the actual fix for the bug this design
  exists to close.
- **`decline_club_invite(invite_id uuid)`** — new, same email-match check,
  sets `declined_at`. Mirrors `accept_promotion_offer`/
  `decline_promotion_offer` (`lib/bookings.ts:682-716`), the closest
  existing accept/decline RPC pair in this codebase.

### Invite creation

`createInvite(clubId, email, displayName?, eventId?)`
(`lib/clubs.ts:457-484`) becomes a plain insert as today, `email` now
required rather than optional, with a membership check first: if the
invited email already belongs to an active member of the club, return a
clear error ("They're already in this club") instead of creating a dead
invite. The "Create an invite link" UI
(`app/clubs/[id]/index.tsx:145-166,433-456`) is replaced with an "Invite
someone" form asking for an email (and optionally a display name, matching
what `importRoster` already collects per row).

After a successful insert, the client calls the new `send-club-invite` edge
function with the invite's club name, target email, and display name.

### The invite email

Sent by `send-club-invite` via Resend, on the same verified
`mail.mahjhero.com` domain and branded the same way as the OTP sign-in
emails already built this session (same fonts, colors, and card shell).
Subject: "You're invited to `<Club name>`". Body: a short line naming who
invited them (if available) and a plain link to
`https://app.mahjhero.com/sign-in` — no token, no query parameters. Signing
in from there is identical to any other sign-in, whether the address is new
or already registered (Supabase's OTP flow handles both through the same
`signInWithOtp` call, per the OTP design spec).

### Dashboard banner

`app/clubs/index.tsx`'s existing mount effect (`lines 157-196`, which
already fires `fetchMyClubs`, `fetchMyRoles`, `fetchProfile`, etc. in
parallel) gains one more call to `fetch_my_pending_invites()`. The result
renders as one card per pending invite, in the same slot as the existing
`NoticeBanner`/`ErrorBanner`/`NeedAFourthCard` (`lines 633-647`), styled
like `WaitlistPanel`'s existing seat-offer card
(`components/WaitlistPanel.tsx:69-96`) — the closest existing accept/reject
pattern in this app: "`<Club name>` invited you to join", a primary
`Button` ("Join") calling `accept_club_invite`, and a
`variant="ghost" big={false}` secondary ("No thanks") calling
`decline_club_invite`. Accepting removes the card and follows today's
existing post-accept redirect (into the club, or the tied event if there is
one); declining just removes the card.

No client-side storage is involved anywhere in this flow — the banner is
driven entirely by a fresh RPC call on every dashboard load.

### Organizer-facing invite list

The existing per-club invite list (already shown on the club screen, with a
delete/revoke action per the `club-invite-copy-and-revoke` work) gains a
per-row status derived from `accepted_at`/`declined_at`
(pending/accepted/declined) instead of just accepted-or-not, and a "Resend
invite email" action per pending row that re-invokes `send-club-invite` for
that row without creating a new invite.

## Error handling & edge cases

- **Re-inviting an existing member:** `createInvite` rejects with a clear
  error before any row is created (see above).
- **Multiple pending invites to the same email/club** (re-invited after an
  earlier one expired): both surface as separate cards on the dashboard.
  Simplest behavior; `expires_at` already bounds how long a stale one
  lingers.
- **Signed in as a different email than any pending invite:** never
  surfaces at all — `fetch_my_pending_invites` only ever returns rows
  matching the caller's own authenticated email, so there is no "wrong
  account" state to design for.
- **`send-club-invite` fails after the insert succeeds:** the invite row
  still exists, unemailed, recoverable via "Resend invite email" (see
  above) — no outbox durability is built for this.

## Testing

**Backend (pgTAP, following this codebase's one-test-file-per-migration
convention):** `fetch_my_pending_invites` returns only rows matching the
caller's own email (and excludes accepted/declined/expired ones);
`accept_club_invite` rejects a caller whose email doesn't match the
invite's; `decline_club_invite` sets `declined_at` and is safe against being
called twice; `createInvite`'s membership check rejects inviting an
existing active member.

**Frontend:** component tests for the new dashboard invite card (accept and
decline each call the correct RPC and the card disappears afterward,
matching the mocking/assertion style already used for `WaitlistPanel` and
`PaidControl`), and for the invite-creation form's email validation.

## Out of scope

- Any change to the OTP sign-in flow itself
  (`docs/superpowers/specs/2026-09-23-otp-sign-in-design.md`) — the invite
  email only links to the existing `/sign-in` screen, unmodified.
- Retrying `send-club-invite` automatically on failure (organizer-triggered
  resend only, per Decision 3).
- Any change to `notification_outbox` / `deliver-notifications` — that
  system is left exactly as it is for its existing use cases.
