# Handoff: Club-hub navigation redesign (MahjHero)

## Overview
Usability rework of the whole app around a **club hub** pattern:
**Home → a club → four labelled sections (Board, Games, Photos, Members)**.

Fonts, colours and features stay the same. The **global bottom tab bar is removed**:
- Alerts and Profile move to buttons on Home.
- Messages are reached from Members (message button on each person).
- Friends is covered by Members.

## About the design files
These are **design references built in HTML**. Rebuild them in the existing codebase using its framework and components; don't ship the HTML.

- `Club Hub Paradigm.dc.html`: the target Home is **2a** (top section). 1a is the earlier Clubs-only home, kept for reference; 1b–1e show the club hub.
- `Club Hub.dc.html`: the club hub screen with all four sections (props `tab`, `role`).
- `image-slot.js`: supports the image drop areas in the design files. Not needed in production.
- `screenshots/screens.png`: 2a, 1b, 1c, 1d, 1e, left to right.

## Fidelity
High-fidelity. Use the app's Organic tokens:

| Token | Value |
| --- | --- |
| bg | #f5ead8 |
| surface | #ebddc5 |
| text | #201e1d |
| divider | #201e1d @16% |
| accent | #c67139 |
| accent-200 | #ffe1d0 |
| accent-700 | #8c491a |
| accent-800 | #643312 |
| accent-2-200 | #dfe9cd |
| accent-2-700 | #56633f |
| accent-2-800 | #3c4629 |
| neutral-300/400/600/700/800 | from the ramp |

- Fonts: **Caprasimo** for display (titles, dates, wordmark) and **Figtree** 400/600/700 for everything else.
- Icons: Lucide, stroke 2.75.
- Focus ring: 2px `accent`, offset 2.
- Hit targets ≥ 44pt.

## Suggested build order
1. Navigation shell: Home, then club hub with 4 section buttons.
2. Games section and the shared **game row** component.
3. My games (list + calendar).
4. Board, Members, Photos.
5. Re-home the existing detail screens (Game, Check-in, Edit game, Profile, etc.) under this navigation. Their earlier handoffs still apply.

---

## Home (2a)
**Header** (padding 8 16 12):
- App icon: 40pt, radius 11.
- "MahjHero" wordmark: Caprasimo 26.
- Right side: Alerts button (44pt `surface` circle, bell icon, `accent-600` unread dot) and Profile avatar (44pt `accent-2-700` circle, Caprasimo initial).

**Switch** (segmented pill, 42pt options): **My games** (with upcoming count) | **Clubs**.
- Default: **My games** if the user has any upcoming game, otherwise **Clubs**.

### My games
- Sub-line: "N upcoming across M clubs" (13px `neutral-700`).
- Right side: **List / Calendar** toggle (small pill; selected option has `bg` fill and `accent-800` text).
- Shows games the user has **joined or is hosting**, across all clubs.

**List view**
- Upcoming games only, grouped **This week / Next week / Later**.
- Group header: 700 15, with the count on the right.

**Calendar view**
- Month card: `surface`, radius 24.
  - Header: Caprasimo 20 month label, prev/next 40pt buttons.
  - Weekday row: M–S.
- Day cells: 7 columns, 46pt tall, 34pt day circle.
  - Today: 2px `accent` inner ring.
  - Selected: `accent-700` fill, white text.
  - Past days: `neutral-600`.
  - Days with games: bold, with up to 3 5pt dots coloured **by club**.
- Tap a day to list that day's games below, titled "Thursday 1 Oct".
- Empty day: dashed card, "Nothing on {day}."

### Clubs
- **Join a club** card (`surface`, radius 24): club-code input (uppercase, letter-spaced) plus a Join pill. Join is disabled (`neutral-300`) until text is entered.
- **Club cards** (`surface`, radius 20, min 80pt):
  - 52pt glyph tile, radius 16.
  - Name 700 17.
  - Sub-line: "Host · Next game Tue 29 Sept, 11:30 AM" / "Member · 3 new posts".
  - Unread badge (`accent-700`, white 12px 700) and chevron.
- **Start a club**: dashed 1.5px `neutral-400` button, 56pt.

---

## Shared game row (used in My games and the club Games section)
Layout: grid `56–60px | 1fr | 18px`, padding 12–14, rows split by 1px `divider`. Hover bg `surface`. Past rows at 60% opacity.

**Date column** (centred)
- Month: 12–13px 700, uppercase, `accent-700`.
- Day: Caprasimo 28–32.
- Weekday: 12px 600 `neutral-700`.

**Content**
1. *(My games only)* Club line: 20pt glyph tile plus club name (12px 700).
2. **Headline** (700 17, one line, ellipsis): the game name. **The name is optional.** If empty, show:
   - **"Private game"** when the game is **invite-only**
   - otherwise **"Open play"**
3. **Always** "time · venue" (14px `neutral-800`). **The time stays on this line whether or not the game has a name.**
4. *(Club Games only)* Description, one line, 13px `neutral-700`.
5. Tags (12px 700 pills):
   - Seats "14/24" (users icon)
   - **"You're going"** or the seat label (`accent-2-200` / `accent-2-800`, check icon)
   - **"Not going"** (`neutral-300`)
   - **"You're hosting"** (`accent-200` / `accent-800`)
   - **"Updated"**

**Chevron** on the right, which opens Game detail.

---

## Club hub (1b–1e)
### Header
- **Club cover photo** full-bleed, with a `neutral-900` @55% scrim. Fallback: `accent-2-800`. White text.
- Row: back (44pt), club name (Caprasimo 26, ellipsis), settings gear (44pt).
- "Club code: XXXX" (14px 600) plus a **Share** pill (white @16%).
- **4 section buttons** (grid, 60pt, radius 18, icon 22 over a 13px 700 label):
  - Board, Games, Photos, Members.
  - Active: `bg` fill, `accent-800` text.
  - Inactive: transparent, white.
  - **Keep the labels.** Unlabelled icons were a usability problem in the reference app.

### Games (default section)
- All / Upcoming / Past segmented control (default **Upcoming**), then game rows.
- Pinned footer:
  - "Add to calendar" (`surface`, adds all club games to the phone calendar).
  - **"New game"** (`accent-700`, **host only**), which opens New/Edit game.

### Board
- Group posts, visible to all members. "Most recent ▾" sort.
- **Post**:
  - 44pt avatar, name 700 16 `accent-700`, **Host** tag, time 13px.
  - Body 16 / 1.5, pre-wrap.
  - Heart reaction pill (toggle, shows count) and "N comments" on the right.
- **Comments**: inline in a `surface` radius-18 block. 30pt avatar, name 700 14 `accent-700`, text 15.
- **Composer** (pinned):
  - Photo button (44pt `surface`).
  - "Write to the club" input (pill, 1.5px `neutral-400`).
  - **Post** button, disabled (`surface`/`neutral-600`) until text is entered. Enter also posts.

### Photos
- Photos / Files segmented control plus a 48pt `accent-700` upload button.
- Photos: 3-column square grid, 3px gaps, outer top corners radius 14.
- Files: `surface` card rows (62pt) with a file icon tile, name, "PDF · 120 KB · uploader", and a download icon.

### Members
- Search "Search N members" plus a 48pt invite button.
- "Show: Everyone/Hosts" and "Sort: First/Last name" text buttons (`accent-700`).
- **Hosts first**, then alphabetical.
- Rows 68pt:
  - 46pt avatar with two-letter initials.
  - Name 600 16 plus **Host** tag.
  - Level 13px.
  - Divider under the text block.
  - **Message** button (44pt), which opens the DM thread (the Messages redesign).
  - The current user shows "(you)" and has no message button.

## State notes
- `inviteOnly` on game drives the "Private game" fallback name.
- The My games feed needs `{date, time, venue, clubId, title?, inviteOnly, myStatus: going|hosting|not, seatLabel, updated}` across all of the user's clubs.
- Home default = `hasUpcoming ? 'myGames' : 'clubs'`.
- Remember the List/Calendar choice per user.
