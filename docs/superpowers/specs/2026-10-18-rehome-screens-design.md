# Re-home remaining screens + "Updated" tag (club-hub redesign, phase 6)

Date: 2026-10-18
Design source: `docs/design/club-hub-v3/README.md` ("Suggested build order" step 5: re-home the existing
detail screens under the new navigation; "their earlier handoffs still apply"; the game row's
"Updated" pill). Survey of today's code: `.superpowers/phase6-survey.md` (not committed).
The user opted out of questions ("go ahead"); every choice the design doesn't fix is marked
*(call)* and was made by Claude.

## Intent

Phases 1–5 built Home and the club hub. The screens you reach from them — Game detail, Check-in,
New/Edit game, Profile, Alerts, notification settings, Messages — still carry pre-redesign
navigation: some have no way back, some push a duplicate copy of the screen they came from, some
headers use the old tile-and-title look, and the club board still exists twice. This phase makes
every one of them feel like part of the same app, and adds the design's "Updated" pill so members
notice when a game they care about changed.

## Goals

- Every signed-in screen has a visible back control (≥44pt) in a consistent header, including
  loading and error states, and back never stacks a duplicate screen.
- One club board: the hub Board. The standalone board route forwards there.
- Old-style headers (tile + big title, ghost "Home" button) move to the shared header pattern.
- Game rows show **Updated** when a game's details changed since you last looked at it.

## Non-goals

- No redesign of screen *content* (Game detail's sections, Check-in's door list, the game form,
  Profile's settings list, Alerts' cards). Their earlier handoffs still apply *(call: the design
  only asks for re-homing)*.
- No email/push when a game changes *(call: the tag is in-app only; notifications are their own
  feature)*.
- Club settings / venues / import sub-screens are untouched beyond what's needed for the shared
  header component (they already have back rows).
- No removal of the redirect shims that only serve old email/push links (`clubs/[id]/index`,
  `leaderboard`, `broadcast`, `broadcasts`) — they're retargeted, not deleted *(call)*.

## Navigation rules (all screens in scope)

- **Back** = `router.canGoBack() ? router.back() : router.replace(<fallback>)`. Never `push` to go
  back. Fallbacks:
  - Game detail → the club's Games section (`/clubs/{id}/games`).
  - Check-in → its Game detail.
  - New game → club Games; Edit game → its Game detail (as today).
  - Profile, Alerts, Messages inbox → `/home`.
  - Notification settings, Friends, How it works, Admin greetings → `/profile`.
  - New message → `/messages`; DM/group thread → `/messages`; game chat → its Game detail (as today).
  - Board post → the hub Board (`/clubs/{id}/board`).
- **Labels** *(call)*: the back control's accessibility label names the destination when it is
  fixed ("Back to Home", "Back to Profile", "Back to the game"); otherwise "Back". Game detail's
  stale "Back to your clubs" becomes "Back".
- **Loading and error states** render the same header with the back control, so a failed load is
  never a dead end.

## Headers

- Screens that already use `CompactHeader` (Game detail, threads, board post) keep it.
- **Profile, Alerts, Messages inbox, New message**: replace the tile + heading / ghost button with
  `CompactHeader` (back chevron + title "Profile" / "Alerts" / "Messages" / "New message"), keeping
  their existing right-side actions (Messages' + button) *(call: same header as the threads)*.
- **Check-in**: swap its bespoke chevron for `CompactHeader`'s back (title "Check-in"), keeping the
  sticky search row below it.
- **Notification settings, Friends, How it works, Admin greetings** keep `BackRow`; only their
  back behaviour changes.
- New/Edit game keep their modal-style X header (`FormHeader`) — a form you close, not a page you
  leave *(call)*; its close already follows the back rule.

## One club board

- `app/messages/club/[threadId]/index.tsx` becomes a redirect to `/clubs/{club_id}/board`
  (resolving the thread's club; `/home` if it can't be read).
- `app/messages/[threadId].tsx`'s club-thread redirect and `broadcasts.tsx` target the hub Board
  directly.
- The board post screen's fallback back target is the hub Board.

## "Updated" tag

**Meaning** *(call)*: a game's *details* — start time, end time, venue, name, or description —
were changed by a host after you last opened that game's detail screen, and the change was within
the last 14 days. Seat counts, bookings and chat don't count.

- Shown on game rows in **My games** (list and calendar day list) and the **club Games** section,
  as the design's pill: label "Updated", `accent-200` background / `accent-800` text, after the
  other tags *(call: the club-hub frame's colours; the Home frame's `surface` variant reads as
  disabled)*.
- Never shown on past games.
- Opening the game's detail screen clears it for you (on any device).
- You never see Updated for your own edit *(call)*: the edit marks the editor as having seen it.
- A game you have never opened shows Updated only if it changed after you first could see it
  *(call: approximated as changed ≥ 1 hour after the game was created, so a host's edits while
  setting the game up don't flag it for everyone)*.

**Data**
- `events.details_changed_at timestamptz` (null until a detail changes). `update_event` and
  `update_event_series` set it to `now()` on every occurrence whose starts_at, ends_at, venue,
  title or notes actually changes (compare old vs new; a save with no change doesn't touch it);
  `reset_event_to_series` does the same when the reset changes a detail. Each stamped occurrence
  also gets an `event_views` row for the editor at the same instant.
- Table `event_views(profile_id → profiles, event_id → events on delete cascade, seen_at
  timestamptz, primary key (profile_id, event_id))`, RLS on, no direct access.
- RPC `mark_event_seen(target_event uuid)` — security definer; caller must be able to read the
  event (same rule as Game detail's reads); upserts `seen_at = now()`. Called when Game detail
  loads successfully.
- `my_games` and `club_games` return a new boolean `updated` computed as: not past,
  `details_changed_at` within 14 days, `details_changed_at > created_at + 1 hour`, and no
  `event_views` row for the caller with `seen_at >= details_changed_at`.
- Grants/allowlist/self-audit conventions as before; migrations pushed to hosted dev before the
  user tests, and to prod before merge.

## Constraints

- Text/TextInput from `components/Text`; colours from `lib/theme.ts`; 44pt targets.
- Keep every existing flow working (bookings, check-in, edits, chats, alerts' mark-read on focus).
- Playwright baselines for screens whose header changes (Profile, Alerts, Messages inbox, New
  message, Check-in, Game detail) and a game row with the Updated pill, re-recorded deliberately.
- QA Pass checklist updated per `CLAUDE.md` (back controls, the Updated tag).

## Left to the builder

- Whether `CompactHeader` needs a small prop (e.g. a title-only variant without the club tile) and
  how a shared `goBack(fallback)` helper is shaped.
- Exact comparison of "changed" for venue (id vs name) and notes (trimmed text).
- Test structure.
