# Home redesign (club-hub navigation, phase 1)

Date: 2026-09-29
Design source: `docs/design/club-hub-v3/` (handoff README + HTML references; target Home is **2a** in
`Club Hub Paradigm.dc.html`). Screenshot: `assets/2026-09-29-club-hub-screens.png`.

## Context

Design V3 reworks every signed-in screen around a **club hub**: Home → a club → four labelled
sections (Board, Games, Photos, Members). Colours and fonts are unchanged; layout and navigation
change completely, and the global bottom tab bar goes away.

## Roadmap (one spec + one PR per phase)

1. **Home + navigation shell** — this spec.
2. Club hub shell (cover-photo header, 4 section buttons, club code + Share, settings) + Games section.
3. Members (hosts first, Message button → DM; absorbs Friends).
4. Board (posts, comments, hearts; builds on announcement boards).
5. Photos / Files (new storage + tables).
6. Re-home the remaining screens (Game detail, Check-in, New/Edit game, Profile, Notifications,
   Messages) and the "Updated" tag.

## Decisions

- **Delivery:** each phase PRs straight into `main`. Prod may show in-between states. No effort is
  spent keeping other screens working or reachable between phases; no feature flags, no redirect
  shims kept for old tests.
- **Join a club by code:** built in this phase. Joining is instant (no host approval).
- **Club codes are editable** by hosts/co-organizers; all members may see and share them. Editing
  the code is the "reset" — the old code stops working. Uniqueness enforced by the database.
- **"Needs you" stack** on Home for actionable items only; check-in and "Can't make it" live only
  on Game detail. First-run tips stay (Clubs view only). The daily greeting is dropped from Home.
- **"Updated" tag** deferred to phase 6.
- **Tab bar** removed from every screen in this phase.

## 1. Data layer

### Club codes (migration)

- `clubs.code text not null`, unique index on `code`, check `code ~ '^[A-Z0-9]{4,16}$'`.
- Backfill: every existing club gets `<up to 8 uppercase letters/digits from the name><3 random
  digits>`, retrying on collision. A name with fewer than 1 usable character falls back to `CLUB`.
- `create_club` gains an optional `code` argument; when null, the database generates one with the
  same rule as the backfill.
- `join_club_by_code(code text)` — security definer, `authenticated` only:
  - normalizes: uppercase, strip whitespace;
  - records the attempt in `club_code_attempts(profile_id, attempted_at)`; raises
    `rate_limited` when the caller has more than 10 attempts in the past hour (counted before the
    new one is inserted);
  - on match, inserts a `member` row; a removed member is refused (`removed_member`); only an
    invite brings them back;
  - returns `{club_id, already_member}`, or null when no club has that code.
- `set_club_code(club_id uuid, code text)` — hosts and co-organizers only; normalizes as above;
  raises `42501` for a non-organizer, `invalid_code` on format failure, `rate_limited` once the
  shared 10/hour attempt budget is spent; returns null (not an exception) when the normalized code
  belongs to another club, so a taken-code probe still costs an attempt. There is no availability
  RPC (it would be an oracle around the same rate limit).
- Direct client UPDATE of `clubs.code` is frozen (`clubs_freeze_identity`, alongside `slug` and
  `created_by`); only `create_club` and `set_club_code` may write it.

### My games feed

`my_games(from_ts timestamptz, to_ts timestamptz)` — one round trip replacing the per-club N+1
fetch. Returns every game with `starts_at` in `[from_ts, to_ts)` where the caller has a confirmed
or waitlisted booking or created the game (`events.created_by`). Columns:

`event_id, club_id, club_name, title, game_mode, starts_at, ends_at, timezone, venue_name,
seats_taken, capacity, my_status ('going' | 'waitlisted' | 'hosting'), waitlist_position,
table_label`

- A creator who is also booked gets `my_status = 'hosting'`.
- Invited (not yet accepted) bookings are excluded — they appear in "Needs you".
- Cancelled events are excluded.
- `seats_taken` counts the same holds `capacity` logic already counts (confirmed + held invites).
- List view requests `[now, now + 120 days)`; the calendar requests the visible month.

### Club cards

`my_clubs_next_game()` returns `{club_id, next_starts_at, timezone}` for each of the caller's
clubs that has an upcoming, non-cancelled game. Role comes from `fetchMyRoles`; unread from
`useUnreadCounts().byClub`.

### "Needs you" sources (existing)

`fetchMyPendingInvites` (club invites), game invites and waitlist seat offers from
`my_upcoming_bookings`, `needAFourthAlerts`. `fetchHostChecklistCounts` stays, loaded only when
the Clubs view is shown.

### Removed

`buildDashboardRows`, `buildChips`, `ALL_CLUBS`/`headerScope`/`inScope` and other scope helpers in
`lib/dashboard.ts` that only the old dashboard used; the greeting fetch on Home. (The admin
greetings screen and table stay untouched.)

## 2. Screen and components

### Routing

- New `app/home.tsx`. `resolveIndexRedirect` sends signed-in users to `/home`.
- `app/clubs/index.tsx` and its tests are deleted. Every link that went to `/clubs` as "the
  dashboard" (back links, post-action `router.replace`) goes to `/home`.
- `components/TabBar.tsx`, its tests and the `Screen` `tabBar` prop are removed everywhere.

### Home, top to bottom

1. **`HomeHeader`** (padding 8 16 12): app icon 40pt radius 11; "MahjHero" Caprasimo 26; right:
   Alerts button (44pt `surface` circle, bell, `accent-600` unread dot from
   `useNotificationsUnread`) → `/alerts`; Profile avatar (44pt `accent-2-700` circle, Caprasimo
   initial) → `/profile`.
2. **`NeedsYouStack`**: club invites, game invites, waitlist seat offers, need-a-fourth — the
   existing card components moved out of the old dashboard file, not rewritten. Renders nothing
   when empty.
3. **`HomeSwitch`**: segmented pill, 42pt options — "My games {upcoming count}" | "Clubs".
   Default `hasUpcoming ? 'myGames' : 'clubs'`, decided once the feed has loaded; not persisted.
4. **My games**
   - Sub-line "N upcoming across M clubs" (13px `neutral-700`) + List | Calendar pill (selected:
     `bg` fill, `accent-800` text). Choice persisted per device in AsyncStorage.
   - **`MyGamesList`**: upcoming only, grouped This week / Next week / Later (weeks Monday–Sunday,
     device timezone). Group header 700 15 with "N game(s)" right-aligned.
   - **`MyGamesCalendar`**: month card (`surface`, radius 24), Caprasimo 20 month label, prev/next
     40pt buttons, M–S weekday row; 7-column day cells 46pt tall with a 34pt circle. Today: 2px
     `accent` inner ring. Selected: `accent-700` fill, white text. Past: `neutral-600`. Days with
     games: bold + up to 3 5pt dots coloured by club. Below: the selected day's games titled e.g.
     "Thursday 1 Oct", or a dashed card "Nothing on Thursday 1 Oct."
   - Empty My games: "No games yet. Join one from a club." with a button that switches to Clubs.
5. **Clubs**
   - **`JoinClubCard`** (`surface`, radius 24): code input (uppercase, letter-spaced, spaces
     stripped as typed) + Join pill, disabled (`neutral-300`) until non-empty. Success →
     `/clubs/[id]`.
   - First-run TipCards (welcome, host checklist, how-it-works) while not dismissed.
   - **`ClubCard`** list (`surface`, radius 20, min 80pt): 52pt glyph tile radius 16, name 700 17,
     sub-line, unread badge (`accent-700`, white 12 700), chevron → `/clubs/[id]` (the current club
     page until phase 2).
   - **Start a club**: dashed 1.5px `neutral-400`, 56pt → `/clubs/new`, which gains an optional
     code field (blank = generated).
   - The current club page gets a "Club code" line; hosts/co-organizers can edit it (bridge until
     the phase 2 header/settings).

### Shared `components/GameRow.tsx` (reused by phase 2)

Grid `56–60px | 1fr | 18px`, padding 12–14, 1px `divider` between rows, pressed/hover bg
`surface`. Props: game data, `showClub`, `description?`, `past`.

- Date column: month 12–13 700 uppercase `accent-700`; day Caprasimo 28–32; weekday 12 600
  `neutral-700`. Uses the game's own timezone.
- Optional club line: 20pt glyph tile + club name 12 700.
- Headline 700 17, one line: `title`, else "Private game" when `game_mode = 'invite_only'`, else
  "Open play".
- Always "time · venue" (14 `neutral-800`).
- Optional description, one line, 13 `neutral-700`.
- Tags (12 700 pills): seats "14/24" (users icon); "You're going" or the table label
  (`accent-2-200`/`accent-2-800`, check icon); "Waitlist #N"; "You're hosting"
  (`accent-200`/`accent-800`).
- Chevron → Game detail. `past` → 60% opacity.

### Pure helpers: `lib/home.ts`

`gameHeadline`, `weekBucket`, `buildMonthGrid`, `clubColor` (deterministic from club id, like
`glyphForClub`), `homeDefault`, `clubSubline` ("Host · Next game Tue 29 Sept, 11:30 AM",
"Member · No games scheduled").

## 3. Error handling and edge cases

- **Loading:** skeleton header, switch and three rows; the switch default waits for the feed.
- **Feed failure:** ErrorBanner "Could not load your games" + Retry; Clubs still works. The club
  list failing uses the same pattern.
- **Join by code:** no match → "No club with that code."; already a member → go to the club;
  `rate_limited` → "Too many tries. Try again in an hour."; network → generic error.
- **Code editing** (Start a club, club page): Uniqueness is checked on save; `23505` shows "That
  code is taken."
- **Calendar:** months fetch on navigation, the previous month stays visible until the new one
  loads; the selected day becomes today if in view, else the 1st of the month.
- **Stale data:** Home refetches on focus.
- **Signed out:** redirect to `/sign-in`.

## 4. Testing and wrap-up

- **pgTAP:** code format and uniqueness (case-insensitive clash), backfill, `join_club_by_code`
  (match, already member, removed member refused, no match, rate limit, anon refused),
  `set_club_code` (host ok, member refused, taken), `my_games` (status mapping, host-and-booked, invited
  excluded, window bounds, seat counts, no cross-club leakage), `my_clubs_next_game`.
- **vitest (`lib/home.ts`):** headline fallbacks; week buckets across Sunday/Monday and month
  boundaries; month grid Monday start incl. February, past/today flags; `homeDefault`;
  `clubSubline` variants.
- **Component tests:** GameRow tags; HomeSwitch default; Join card enabled/disabled; calendar day
  tap and empty day; NeedsYouStack hidden when empty. Old dashboard, tab-bar and nav-glyph-parity
  tests deleted.
- **Playwright visual:** new Home baselines (My games list, calendar, Clubs, Needs you; desktop +
  mobile). Removing the tab bar shifts almost every signed-in baseline — re-baseline in this PR
  only after diffing against `main`'s ~35 already-failing baselines. Reset the local DB after the
  visual run.
- **Real check:** Home in the in-app browser against local Supabase at phone width, compared to
  2a — not only jsdom.
- **QA Pass artifact:** update scenarios that start from the dashboard or use the tab bar; add
  join-by-code and code-editing steps.
- **Release:** `db push` the migration to prod before merging.
