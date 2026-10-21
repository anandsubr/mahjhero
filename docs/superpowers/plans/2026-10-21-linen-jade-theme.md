# Linen & Jade Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the app to Claude Design's "Linen & Jade" palette and type, with the handoff's polish fixes — no layout or behaviour changes.

**Architecture:** Port `theme-linen-jade.css` into `lib/theme.ts` (every ramp step, base colours, divider, shadows, new avatar palette), swap the heading font to DM Serif Display, make every avatar use the tint/initial pairs, then apply the polish list and sweep hardcoded colours.

**Tech Stack:** Expo Router / React Native / react-native-web, `@expo-google-fonts/*`, vitest, Playwright.

**Spec:** `docs/design/linen-jade/README.md` (source of truth for values: `docs/design/linen-jade/theme-linen-jade.css`; references `Club Hub v2.dc.html`, `Club Hub Paradigm v2.dc.html`, `screenshots/screens.png`). User instruction (2026-10-21): "no layout or functional changes just look and feel and some cleanup".

## Global Constraints

- Values come verbatim from `theme-linen-jade.css`. Replace every ramp step (neutral, accent, accent2 100–900); never mix old and new.
- Base: bg `#faf5ee`, surface `#f1e8dc`, text `#2a2321`, accent `#df7a55`, accent-2 `#3b876c`, divider = text at 13% (`rgba(42, 35, 33, 0.13)`), shadows ink (`#302b27`) at 10/12/18%.
- Derived tokens (`textMuted`, `textLabel`, any flattened mixes) are recomputed against the new bg/surface/text with the same method their comments describe, and must still clear WCAG AA 4.5:1 on both bg and surface (`lib/theme.test.ts`).
- Heading font: DM Serif Display 400 (`@expo-google-fonts/dm-serif-display`), for titles only (screen titles, wordmark, club name, calendar month, big dates). Buttons and everything else use Figtree. Remove Caprasimo entirely (package, font load, comments).
- Avatars: six pairs (avatar-1..6 bg/fg from the CSS), chosen by a stable hash of the person's id; the current user's profile button stays `accent2[700]` with a white initial.
- No layout, spacing, size, copy or behaviour changes except the README §4 items.
- Text/TextInput from `components/Text`; colours only from `lib/theme.ts` (`'#fff'` allowed); 44pt targets.
- Git: explicit paths; never `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`, `.claude/launch.json`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Contrast** — muted/label text and every coloured tag (Host, hosting, going, Updated, skill chips, avatars) on both bg and surface still reads at AA. Test in Task 1 for the text tokens; reviewer spot-checks tags.
2. **Leftover old colours** — any hardcoded olive/brown/white-on-dark avatar outside `lib/theme.ts`. Grep in Task 3.
3. **Font fallback** — the app must not render a blank/system title before DM Serif Display loads (splash gate already holds for fonts; keep it).
4. **Avatar consistency** — the same person gets the same tint on every screen (one helper, one hash).
5. **Focus ring** — keyboard focus visible on web on every Pressable/input, no browser blue ring.

---

### Task 1: Tokens, heading font, avatars

**Files:** `lib/theme.ts` (+ `lib/theme.test.ts`), `app/_layout.tsx`, `package.json`/lock (`npx expo install @expo-google-fonts/dm-serif-display`, remove `@expo-google-fonts/caprasimo`), `components/Button.tsx` (Figtree, not the heading face), `lib/friends.ts` `avatarColorFor` (+ test) and every avatar renderer that uses it (grep `avatarColorFor`, white initials on coloured circles).

**Produces:** `colors.avatar: readonly { bg: string; fg: string }[]` (6 entries) and `avatarColorsFor(id: string): { bg: string; fg: string }` (stable hash; keep `avatarColorFor` only if something still needs a single colour, otherwise remove it).

- [ ] **Step 1: Failing tests:** theme token values equal the CSS; recomputed `textMuted`/`textLabel` ≥ 4.5:1 on bg and surface; `avatarColorsFor` stable and within the 6 pairs; Button label uses Figtree bold; an avatar renders the pair's bg and fg (not white).
- [ ] **Step 2–4:** FAIL → implement → focused + full `npm test` + `npx tsc --noEmit`. **Step 5: Commit** `feat(theme): Linen & Jade tokens, DM Serif Display, soft avatars`.

---

### Task 2: Polish fixes (README §4)

**Files:** as found — focus styling (a shared web focus style for Pressable/TextInput), `components/hub/ClubHubHeader.tsx` (scrim `accent2[900]` @48%, no-photo fallback `accent2[800]`), Home "Join a club" code input (normal case placeholder, no letter-spacing on placeholder), club tile glyph (`lineHeight` = font size so it centres), `components/ClubMembers.tsx` skill-level chip (12px 700, pill, padding 2/9; Beginner `accent2[200]`/`accent2[800]`, Intermediate avatar-3 pair, Advanced `accent[200]`/`accent[800]`), `app/clubs/[id]/(hub)/games.tsx` empty state copy "No games yet. Pick a night and invite your table." and remove its duplicate New game button (the pinned footer stays), `TipCard` fill → `accent[100]`.

- [ ] **Step 1: Failing tests** for each item (exact copy, single New game button, chip colours per level, scrim colour, tip card bg, focus style present on web).
- [ ] **Step 2–4:** FAIL → implement → pass + full suite + tsc.
- [ ] **Step 5: QA Pass:** read live; update any step quoting the old empty-Games copy or the empty-state New game button; add none unless a step is missing; update counts; republish in place.
- [ ] **Step 6: Commit** `feat(theme): Linen & Jade polish fixes`.

---

### Task 3: Sweep hardcoded colours

**Files:** every `app/` / `components/` file with a hex literal or white-on-dark avatar (today: friends.tsx, profile.tsx, check-in.tsx, SeatSheet, GameForm, RoundLog, RoundTimer, SeatGrid, DoorStatusControl, ClubLeaderboard, BringSomeoneSheet), plus the README §5 screens (Messages, Game screen, Check-in, New/Edit game, Profile & Start a club, Notifications & Friends).

- [ ] **Step 1:** Grep `#[0-9a-fA-F]{3,6}`, `rgba(`, `'white'` outside `lib/theme.ts`; map each to the nearest new token (or add a named token to `lib/theme.ts` if none fits); tests where a colour is asserted.
- [ ] **Step 2:** full suite + tsc; grep shows only `'#fff'` / theme-derived values left. **Step 3: Commit** `refactor(theme): no hardcoded colours outside the theme`.

---

### Task 4: Baselines, browser check, PR (controller)

- [ ] Re-record every Playwright visual baseline (the whole look changes); eye-check a representative set against `screenshots/screens.png`; stability runs; reset DB.
- [ ] Browser check at 375×812: Home, club hub sections, Game detail, Check-in, New game, Profile, Messages; keyboard Tab shows the accent focus ring.
- [ ] Final review; push; PR (no migrations).
