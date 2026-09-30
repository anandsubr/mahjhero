# Club hub + Games (club-hub redesign, phase 2)

Date: 2026-09-29
Design source: `docs/design/club-hub-v3/` — `Club Hub.dc.html` (hub header and all sections), README
"Club hub (1b–1e)" and "Shared game row". Screenshot: `assets/2026-09-29-club-hub-screens.png`
(frames 1b–1e). Phase 1 spec: `2026-09-29-home-club-hub-design.md`.

## Context

Phase 1 shipped Home and removed the dashboard and tab bar. The club page (`app/clubs/[id]/index.tsx`)
is still the old single screen and has no games list, so members cannot discover games in-app.
Phase 2 replaces it with the club hub: a header with labelled section buttons and a Games section.
Board and Members are re-homed as they are (redesigned in phases 4 and 3); Photos is a placeholder
(phase 5).

## Decisions

- **Five section buttons:** Board · Games · Photos · Members · **Ranks** (the leaderboard, label
  "Ranks" so all five fit at phone width; trophy icon). Games is the default.
- **Existing features re-homed, nothing lost:** club board → Board; roster, search, invites →
  Members; leaderboard → Ranks; club code edit, invite-only default, venues, import → Settings.
- **Cover:** hosts may upload a photo; without one the header uses a host-chosen colour from five
  dark palette tokens, default dark green (`accent2_800`).
- **Add to calendar:** a personal subscription feed (webcal) of the member's own games across all
  clubs — joined, invited (unanswered), waitlisted, created. Not open games they haven't joined.
- **Pull to refresh** on Home and every data-loading hub section (native only; web keeps
  refetch-on-focus).

## 1. Routes and header

### Routes

- `app/clubs/[id]/_layout.tsx` — a Stack for the club.
- `app/clubs/[id]/(hub)/_layout.tsx` — renders `ClubHubHeader` above the active section.
- `app/clubs/[id]/(hub)/games.tsx`, `board.tsx`, `photos.tsx`, `members.tsx`, `ranks.tsx`.
- `app/clubs/[id]/index.tsx` becomes a redirect to `/clubs/[id]/games`.
- `app/clubs/[id]/leaderboard.tsx` becomes a redirect to `/clubs/[id]/ranks`.
- Outside the `(hub)` group, unchanged headers: `events/…`, `venues`, `import`, `broadcast(s)`, and
  the new `settings.tsx`.
- Home's club cards and join-by-code land on `/clubs/[id]/games`.

### `ClubHubHeader`

- **Background:** cover photo full-bleed with a `neutral[900]` @ 55% scrim; else the club's
  `cover_color`. White text throughout. If the photo fails to load, the colour shows.
- **Top row:** back (44pt) → `/home`; club name (Caprasimo 26, one line, ellipsis); settings gear
  (44pt) → `/clubs/[id]/settings`, shown to hosts and co-organizers only.
- **Code row:** "Club code: XXXX" (14px 600) + **Share** pill (white @ 16%). Share opens the native
  share sheet with "Join {Club name} on MahjHero with code XXXX"; on web it copies that text and
  shows "Copied" for 2 seconds.
- **Section buttons:** 5-column grid, each 60pt tall, radius 18, 22pt icon over a 13px 700 label.
  Active: `bg` fill, `accent[800]` text/icon. Inactive: transparent, white. Tapping navigates with
  `router.replace` to the section route.
- The header stays fixed; section content scrolls beneath it.

### Club settings (`app/clubs/[id]/settings.tsx`, organizers only; others are redirected to the hub)

- **Cover:** preview; "Upload photo" / "Replace photo" / "Remove photo"; a row of five colour
  swatches (selected one ringed) that saves immediately.
- **Club code:** the Change → New club code → Save code flow moved from the old club page
  (uses `ClubCodeField` and `setClubCode`; taken → "That code is taken.").
- **"New games default to invite-only"** toggle (moved from the old club page).
- Links: **Venues** → `/clubs/[id]/venues`, **Import a roster** → `/clubs/[id]/import`.

## 2. Games section

### Data: `club_games(target_club uuid, from_ts timestamptz, to_ts timestamptz)`

Security definer; caller must be an active member (`is_club_member`). Returns the `my_games` column
set plus `notes text`, for published events of that club with `starts_at` in `[from_ts, to_ts)` and
visible to the caller: `game_mode = 'open_play' or is_club_organizer(club) or
event_has_my_active_booking(event)`. `my_status`:

- `hosting` — caller created the event
- `going` — caller has a confirmed booking
- `waitlisted` — caller has a waitlisted booking (with `waitlist_position`)
- `invited` — caller has an unanswered invited booking
- `not` — otherwise

Client: `fetchClubGames(clubId, from, to)` in `lib/my-games.ts` returning `MyGame[]` with a new
optional `notes` field; `MyStatus` gains `'invited'`.

### Screen

- Segmented control **All · Upcoming · Past** (default Upcoming, not persisted).
  - Upcoming: `[now, now + 120 days)`, ascending.
  - Past: `[now − 180 days, now)`, descending, rows at 60% opacity.
  - All: past then upcoming, one list ascending by date, past rows at 60%.
- Rows: `GameRow` with `showClub={false}` and `description={notes}` (one line).
- New tag for `invited`: "Invited" (`accent[200]` / `accent[800]`).
- Tap a row → `/clubs/[id]/events/[eventId]` (joining stays on Game detail).
- Empty: "No games here yet." (Upcoming/All), "No past games." (Past); hosts also get a
  "New game" button in the empty state.
- **Pinned footer** (`Screen` `footer`): **Add to calendar** (`surface`, everyone) and **New game**
  (`accent[700]`, hosts only — game creation stays host-only) → `/clubs/[id]/events/new`.
- Refetch on focus; pull to refresh.

## 3. Calendar feed

- **Table `calendar_feeds`** (`profile_id` pk → profiles, `token text unique not null`,
  `created_at`). RLS on, no policies; only definer functions touch it.
- **`my_calendar_feed_url()`** returns the caller's feed URL, creating a 32-byte random URL-safe
  token on first call. **`reset_calendar_feed()`** replaces the token and returns the new URL.
  The URL base comes from the Supabase functions URL of the project.
- **Edge function `supabase/functions/calendar-feed`**: `GET ?token=…`, no auth header required
  (`verify_jwt = false` for this function only). Looks up the token with the service role; unknown
  token → 404. Returns `text/calendar; charset=utf-8`, `Cache-Control: max-age=900`.
  - Events: the token owner's games from 30 days ago to 180 days ahead, all clubs, published only —
    confirmed, waitlisted and unanswered-invited bookings, plus games they created.
  - `SUMMARY`: "{headline} · {club name}", prefixed "Invited: " or "Waitlist: " for those statuses.
    Headline = title, else "Private game" (invite-only) / "Open play".
  - `DTSTART`/`DTEND` in UTC; `LOCATION` = venue name; `DESCRIPTION` = notes + app link to the
    game; `UID` = `{event_id}@mahjhero.com` (stable); `DTSTAMP`; calendar name "MahjHero".
  - Games the member left, declined, or that were cancelled simply stop appearing.
- **Button:** fetches the URL, opens it as `webcal://…` via `Linking.openURL`. On web, or if that
  fails, a sheet shows the `https://` link with **Copy link** and "Add it in your calendar app
  under ‘Subscribe to calendar’." Failure to get the link: "Could not get your calendar link."
- **Profile:** a "Reset calendar link" row, explaining that the old link stops working.

## 4. Other sections, cover storage, errors, testing

### Re-homed sections

- **Board:** the club board list is extracted from `app/messages/club/[threadId]/index.tsx` into
  `components/ClubBoard.tsx` (thread id from `open_thread_for_club`); the section renders it and
  the messages route keeps working. Post detail unchanged.
- **Members:** the old club page's roster + search and, for organizers, pending invites
  (resend/delete), the invite-by-email form and the "Bringing people in" tip.
- **Ranks:** the leaderboard content from `app/clubs/[id]/leaderboard.tsx` without its own header.
- **Photos:** centered note "Photos and files are coming soon."
- The old club page body is deleted.

### Cover storage

- Columns `clubs.cover_path text null`, `clubs.cover_color text not null default 'accent2_800'`
  with check `in ('accent2_800','accent2_700','accent_700','accent_800','neutral_800')`.
  Both frozen against direct UPDATE (extend `clubs_freeze_identity`).
- Private bucket `club-covers`, object path `{club_id}/{uuid}.jpg`; read: club members; insert/
  delete: club organizers.
- RPCs (organizers only): `set_club_cover(target_club, new_path text | null)` (path must start with
  `{club_id}/`), `set_club_cover_color(target_club, color)`.
- Client resizes to 1600px wide JPEG (reuse the message-attachment image helpers), uploads, calls
  `set_club_cover`, then deletes the previous object. Header loads it via a signed URL.

### Pull to refresh

`Screen` gains `onRefresh?: () => Promise<void>`; when set (and `scroll`), it renders a
`RefreshControl` in `colors.accentColor`. Used by Home and the Games, Board, Members and Ranks
sections.

### Errors

- Club fails to load: back link + "Could not load this club." + Retry.
- A section's data fails: inline "Could not load …" + Retry; header stays.
- Cover image fails: colour fallback. Upload fails: inline error in settings.

### Testing

- pgTAP: `club_games` (visibility rule, each `my_status`, windows, non-member refused), calendar
  token RPCs, cover RPCs + colour check + freeze, storage policies (member read, organizer write).
- Edge function: unit tests of the ICS builder (inclusion/exclusion, prefixes, UID, escaping).
- vitest: header (photo vs colour, gear visibility, Share), section buttons, Games segments/tags/
  footer by role, settings, `Screen` refresh prop.
- Playwright: baselines for each section and settings; remove old club-page/leaderboard baselines.
- Before handing over for testing: push migrations to hosted dev and deploy `calendar-feed` to dev;
  user tests on `localhost:8090`.
- QA Pass checklist updated per CLAUDE.md.
