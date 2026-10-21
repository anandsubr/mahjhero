# Handoff: Linen & Jade theme (visual refresh, no layout changes)

## What this is
A re-theme of MahjHero in response to design feedback. The old palette read "rustic autumn lodge": brown on cream, dark olive header, a chunky retro display serif, and muddy avatars. **Layouts, components and behaviour stay exactly as in `design_handoff_club_hub`.** Only colour tokens, the display font, and a few polish details change.

## Files
- `theme-linen-jade.css`: **the source of truth.** It overrides the Organic `:root` tokens; load it after the base stylesheet. Port these values into the app's theme/tokens.
- `Club Hub Paradigm v2.dc.html` and `Club Hub v2.dc.html`: HTML references showing the theme applied. Rebuild in the codebase; don't ship them.
- `screenshots/screens.png`: Home (My games), then club Games, Board, Photos and Members.

## 1. Token changes
| Token | Old | New | Note |
|---|---|---|---|
| bg | #f5ead8 | **#faf5ee** | lighter ivory |
| surface | #ebddc5 | **#f1e8dc** | less brown |
| text | #201e1d | **#2a2321** | |
| accent (terracotta) | #c67139 | **#df7a55** | a notch brighter |
| accent-200 | #ffe1d0 | **#ffe0d4** | blush, used for Host/hosting tags |
| accent-700 | #8c491a | **#9e4626** | accent text / primary buttons |
| accent-800 | #643312 | **#72311a** | |
| accent-2 | olive #7a8a5e | **jade #3b876c** | |
| accent-2-700 | #56633f | **#2a6a54** | |
| accent-2-800 | #3d472b | **#1d4d3d** | |
| divider | text @16% | **text @13%** | |
| shadows | ink 14/16/22% | **ink 10/12/18%** | |

The full 100–900 ramps for neutral, accent and accent-2 are in the CSS. Replace every step; don't mix old and new.

## 2. Type
- `--font-heading`: **DM Serif Display** 400, replacing Caprasimo. Use it for **titles only**: screen titles, the MahjHero wordmark, club name, calendar month, and big dates.
- Everything else, **buttons included**, uses Figtree 400/600/700. No display font inside buttons.

## 3. Avatars (new tokens)
Six soft tints, each with a deep initial. Pick one per person with a stable hash of their name or id.

| Token | Background | Initial |
|---|---|---|
| avatar-1 | #ffe0d4 | #72311a |
| avatar-2 | #d2ede2 | #1d4d3d |
| avatar-3 | #fbefc8 | #6b5312 |
| avatar-4 | #ece6f6 | #4d3f73 |
| avatar-5 | #e2eef6 | #2c4f66 |
| avatar-6 | #f6e1e6 | #7a3348 |

These replace the solid dark circles with white initials. The current user's profile button stays jade `accent-2-700` with a white initial.

## 4. Polish fixes
- **Focus ring**: 2px solid `accent`, offset 2, on every interactive element. Remove any browser-default blue ring, such as the one on the Club code field.
- **Club header scrim** over the cover photo: `accent-2-900` at 48%, replacing `neutral-900` at 55%. With no photo, fall back to `accent-2-800`.
- **Club code input**: normal case, no letter-spacing on the placeholder.
- **Tile glyph** in club tiles: set `line-height: 1` so the character is centred in its square.
- **Skill level in Members**: a chip (12px 700, pill, padding 2 9).
  - Beginner: `accent-2-200` / `accent-2-800`
  - Intermediate: `avatar-3`
  - Advanced: `accent-200` / `accent-800`
- **Empty Games state**: "No games yet. Pick a night and invite your table."
- **Only one "New game" action per screen**: the pinned footer button. Remove the duplicate from the empty state.
- **Tip card**: replace its lime fill with `accent-100` (blush) or `surface`.

## 5. Apply everywhere
Swap the tokens globally, then check these screens from the earlier handoffs:
- Messages
- Game screen
- Check-in
- New/Edit game
- Profile & Start a club
- Notifications & Friends

Any hard-coded olive, brown or white-on-dark avatar there should move to the new tokens above.
