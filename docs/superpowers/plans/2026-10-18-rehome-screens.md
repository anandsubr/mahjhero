# Re-home Screens + "Updated" Tag (Club-Hub Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every remaining signed-in screen a consistent header with a working back control, collapse the duplicate club board into the hub Board, and add the "Updated" pill to game rows.

**Architecture:** A small `goBack(router, fallback)` helper in `lib/navigation.ts` replaces every hand-rolled or `push`-based back. Profile/Alerts/Messages/New message/Check-in move to `CompactHeader`. One migration adds `events.details_changed_at`, `event_views`, `mark_event_seen`, and an `updated` column on `my_games` / `club_games`; `GameRow` renders the pill and Game detail marks the game seen.

**Tech Stack:** Expo Router 57 / React Native / react-native-web, Supabase (Postgres, pgTAP), vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-rehome-screens-design.md`

## Global Constraints

- Text/TextInput from `components/Text`; colours from `lib/theme.ts`; 44pt targets.
- Back is always `canGoBack() ? back() : replace(fallback)` — never `push` to go back. Fallbacks per the spec's Navigation rules.
- Back labels: "Back to Home", "Back to Profile", "Back to the game" where the destination is fixed; otherwise "Back". Game detail's "Back to your clubs" → "Back".
- Loading and error states show the header with the back control.
- Header titles (exact): "Profile", "Alerts", "Messages", "New message", "Check-in".
- Updated pill: label "Updated", background `colors.accent[200]`, text `colors.accent[800]`, after the other tags; never on past games.
- Updated rule: not past AND `details_changed_at` within 14 days AND `details_changed_at > created_at + interval '1 hour'` AND no `event_views` row for the caller with `seen_at >= details_changed_at`.
- "Details" = starts_at, ends_at, venue, title, notes. A save that changes none of them leaves `details_changed_at` untouched.
- Migrations forward-only; security definer + `search_path = public` + `auth.uid()` guard; revoke `public, anon`; new client RPCs in both `grants.test.sql` allowlists; new raise messages in `lib/bookings.test.ts` exemptions.
- Local Supabase only in tasks; dev/prod pushes by the controller. Never `config push`.
- Git: explicit paths; never `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`, `.claude/launch.json`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Deep link / fresh tab straight into a screen (no history)** → back goes to the spec's fallback, never a blank or the same screen. Tests in Tasks 1–3 (mock `canGoBack` false).
2. **A game edit that changes only capacity, or a save with identical values** → no Updated pill. pgTAP in Task 4.
3. **Series edit** (`update_event_series`) changing the time of future occurrences → each changed occurrence flags Updated; unchanged/past ones don't. pgTAP in Task 4.
4. **Viewing Game detail on one device** → the pill is gone on the next My games / club Games load on any device; a later edit brings it back. pgTAP (Task 4) + component test (Task 5).
5. **A board link from an old email/push** (`/messages/club/{thread}`, `/clubs/{id}/broadcasts`) → lands on the hub Board, or Home if the thread can't be read. Tests in Task 3.

---

### Task 1: Back helper + game screens

**Files:** create `lib/navigation.ts`, `lib/navigation.test.ts`; modify `app/clubs/[id]/events/[eventId]/index.tsx`, `.../check-in.tsx`, `.../edit.tsx`, `app/clubs/[id]/events/new.tsx`, `components/GameForm.tsx` if needed; tests next to the existing screen tests in `app/__tests__/`.

**Produces:** `goBack(router: Pick<Router,'canGoBack'|'back'|'replace'>, fallback: Href): void`.

- [ ] **Step 1: Failing tests:** `goBack` calls `back()` when `canGoBack()` is true and `replace(fallback)` otherwise. Game detail: back label "Back"; with no history → `replace('/clubs/c1/games')`; the error state ("That game could not be loaded") renders a back control. Check-in: header title "Check-in", back label "Back to the game", with history → `back()` (not `push`), without → `replace('/clubs/c1/events/e1')`; loading/error states have the back control. New/Edit: loading/error states have the close/back control with the existing fallbacks.
- [ ] **Step 2:** FAIL. **Step 3:** implement (Check-in swaps its bespoke chevron for `CompactHeader`, keeping the sticky search row). **Step 4:** focused + full `npm test` + `npx tsc --noEmit`. **Step 5: Commit** `feat(nav): consistent back on game screens`.

---

### Task 2: Profile, Alerts, Messages headers + settings back

**Files:** modify `app/profile.tsx`, `app/alerts.tsx`, `app/messages/index.tsx`, `app/messages/new.tsx`, `app/notifications.tsx`, `app/friends.tsx`, `app/how-it-works.tsx`, `app/admin/greetings.tsx`, `components/CompactHeader.tsx` (title-only use if needed); tests in `app/__tests__/`.

**Consumes:** `goBack` (Task 1).

- [ ] **Step 1: Failing tests:** Profile/Alerts/Messages render `CompactHeader` titled "Profile"/"Alerts"/"Messages" with back label "Back to Home" → `back()` with history, `replace('/home')` without; the old MahjongTile title block and the ghost "Home" button are gone; Messages keeps its + (New message) action. New message: title "New message", back → `back()` / `replace('/messages')`. Notifications/Friends/How it works/Admin greetings: their BackRow ("Profile") calls `back()` with history and `replace('/profile')` without — never `push('/profile')`. Alerts still marks read on focus.
- [ ] **Step 2–4:** FAIL → implement → pass + full suite + tsc. **Step 5: Commit** `feat(nav): Profile, Alerts and Messages headers`.

---

### Task 3: One club board

**Files:** modify `app/messages/club/[threadId]/index.tsx` (becomes a redirect), `app/messages/club/[threadId]/[postId].tsx` (fallback), `app/messages/[threadId].tsx` (club-thread redirect target), `app/clubs/[id]/broadcasts.tsx`; tests (`app/__tests__/redirect-routes.test.ts` and the board-post test).

- [ ] **Step 1: Failing tests:** `/messages/club/{t}` resolves the thread's club and `replace`s `/clubs/{club}/board`; unreadable thread → `/home`. A club thread opened via `/messages/{t}` → `/clubs/{club}/board`. `broadcasts` → `/clubs/{id}/board`. Board post back with no history → `replace('/clubs/{club}/board')`; with history → `back()`.
- [ ] **Step 2–4:** FAIL → implement (remove now-unused imports; leave `ClubBoard` as the hub Board's component) → pass + full suite + tsc. **Step 5: Commit** `feat(nav): one club board`.

---

### Task 4: Event change tracking (DB)

**Files:** create `supabase/migrations/20261018100000_event_updated_tag.sql`, `supabase/tests/database/fixtures/event_updated_tag.test.sql`; modify `grants.test.sql`, `lib/bookings.test.ts` (if new raise messages).

**Produces:** `events.details_changed_at timestamptz null`; table `event_views(profile_id, event_id, seen_at)` PK `(profile_id, event_id)`, RLS on, no grants; `mark_event_seen(target_event uuid) returns void` (caller must be able to read the event — reuse the predicate Game detail's reads use; else 42501); `update_event` and `update_event_series` redefined (`create or replace`, same signatures, same behaviour) to set `details_changed_at = now()` on each occurrence whose details actually change; `my_games` and `club_games` recreated with an extra trailing column `updated boolean` per the Global Constraints rule (drop + create if the return shape requires; re-grant).

- [ ] **Step 1: Failing pgTAP:** edit time → `details_changed_at` set; capacity-only edit and identical-values save → stays null (Review Focus 2); series time edit flags changed future occurrences only (Review Focus 3); event created and edited within the hour → `updated` false; edited after an hour → `my_games`/`club_games` `updated` true for a member; after `mark_event_seen` → false; a later edit → true again (Review Focus 4); past game → false; change older than 14 days → false; non-member `mark_event_seen` → 42501; anon can't execute. Backdate `created_at`/`details_changed_at` directly in fixtures.
- [ ] **Step 2:** `npx supabase db reset --local && npm run test:db` → FAIL. **Step 3:** migration (copy the latest definitions of `update_event` / `update_event_series` — `20260906160000_capacity_guard_on_update.sql` — and the latest `my_games` / `club_games`, then add only the change tracking). **Step 4:** allowlists/exemptions; full `test:db` + `npm test -- lib/bookings.test.ts` pass. **Step 5: Commit** `feat(db): track game detail changes for the Updated tag`.

---

### Task 5: Updated pill + mark seen (client)

**Files:** modify `lib/my-games.ts` (+ test), `components/GameRow.tsx` (+ `components/__tests__/game-row.test.tsx`), `app/clubs/[id]/events/[eventId]/index.tsx` (+ its test), a `markEventSeen` in an existing events lib file (`lib/events.ts` or wherever Game detail's reads live).

**Consumes:** Task 4's `updated` column and `mark_event_seen`.

- [ ] **Step 1: Failing tests:** `MyGame.updated: boolean` mapped from both fetchers (missing → false). `GameRow` shows an "Updated" pill (accent-200 / accent-800) after the other tags when `game.updated` and not `past`; hidden when `past` or false. Game detail calls `markEventSeen(eventId)` once after a successful load, not on error, and ignores its failure.
- [ ] **Step 2–4:** FAIL → implement → pass + full suite + tsc.
- [ ] **Step 5: QA Pass:** read live; add steps (new data-ids) for back controls on Profile/Alerts/Messages/Check-in and the Updated pill (host edits a game's time from another account after an hour → member sees "Updated" on My games and club Games → opens it → pill gone); update counts; republish in place.
- [ ] **Step 6: Commit** `feat(games): Updated pill on game rows`.

---

### Task 6: Baselines, dev push, browser check, PR (controller)

- [ ] Re-record Playwright baselines for Profile, Alerts, Messages inbox, New message, Check-in, Game detail; add a game-row-with-Updated baseline (seed `details_changed_at`); eye-check every PNG; reset DB; `npm run test:db`.
- [ ] Push the migration to hosted dev (dry-run first).
- [ ] Browser check at 375×812 on a local build: back from each re-homed screen (with and without history), old board link lands on the hub Board, Updated pill appears and clears.
- [ ] Final whole-branch review; push branch; open PR (prod push before merge).
