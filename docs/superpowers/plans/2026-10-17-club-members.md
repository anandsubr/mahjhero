# Members + Personal Messages (Club-Hub Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the club hub's Members section to Design V3 frame 1e (search, Hosts filter, rows with Message and Add friend), and give one-to-one/group chats a single inbox reached from Home, with club and game chats living only inside the club.

**Architecture:** Client-only — no migrations. A pure `lib/members.ts` does ordering/filtering/initials; `components/ClubMembers.tsx` keeps its loading and invite logic but renders new `MemberRow`s; `lib/use-unread.ts` exposes the direct+group unread count (the `club_id = null` row of `my_unread_counts`) for a Messages button on Home; `/messages` filters to `direct`/`group` and chat screens' back links follow the inside/outside rule.

**Tech Stack:** Expo Router 57 / React Native / react-native-web, Supabase client, vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-club-members-design.md`

## Global Constraints

- Import `Text`/`TextInput` from `components/Text`, never from `react-native`.
- Colours only from `lib/theme.ts` (`'#fff'` allowed for white text); Figtree for this section; hit targets ≥ 44pt; new icons Lucide-style in `components/icons.tsx`, stroke 2.75.
- Sort by display name only (case-insensitive, `localeCompare`); hosts and co-organizers first. No sort toggle.
- "Hosts" filter = role `host` or `co_organizer`. Tags: "Host" (host), "Co-organizer" (co_organizer).
- Copy (exact): "Search {N} members", "Show: Everyone", "Show: Hosts", "No members match “{query}”.", "{name} (you)", "Friend", "Member" (empty display name), "No hosts in this club yet." (Hosts filter, empty query, nobody matches), "Invite someone by email" (invite button label).
- Inside a club: club board + game chats only. Outside: direct + group chats, one inbox at `/messages`.
- No database change. Never `db push`/`config push`/`--linked`.
- Git: stage by explicit path; never `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npm test`, `npx tsc --noEmit`. QA Pass artifact updated per `CLAUDE.md` in the task that changes the behaviour it describes.

## Review Focus

1. **Tapping Message twice quickly** → exactly one `createGroupThread` call and one navigation (ref guard). Test in Task 2.
2. **Members list where nobody has a display name / names differ only by case or accents** → stable, sensible order; blank names shown and sorted as "Member", last in their group. Test in Task 1.
3. **Search with surrounding spaces or mixed case, or a Hosts filter with no hosts matching** → trims and matches case-insensitively; the "No members match" line shows rather than an empty list. Test in Task 1 (pure) and Task 2 (render).
4. **Add friend fails** (e.g. "you can only add someone from one of your clubs") → button returns to its idle state and the refusal is shown; no "Friend" tag. Test in Task 2.
5. **Opening a club board or game chat with no navigation history** (deep link / cold reload) → Back lands on the club's Board or the game page, not the inbox and not a dead end. Test in Task 4.

---

### Task 1: Pure member-list helpers

**Files:** Create `lib/members.ts`, `lib/members.test.ts`.

**Interfaces:**
- Consumes: `ClubMember` (`{ profile_id, role, display_name, skill_level }`) from `lib/clubs.ts`.
- Produces:
  - `memberName(m: ClubMember): string` — trimmed display name, or `'Member'` when blank.
  - `memberInitials(name: string): string` — up to two uppercase initials from the first and last words (`'Priya Shah'` → `'PS'`, `'Admin'` → `'A'`, `'  '` → `'?'`).
  - `isHostRole(role: ClubRole): boolean` — host or co_organizer.
  - `orderMembers(members: ClubMember[]): ClubMember[]` — hosts/co-organizers first, then everyone; within each group by `memberName` with `localeCompare(…, undefined, { sensitivity: 'base' })`; blank names last within their group; ties broken by `profile_id` for stability.
  - `filterMembers(members: ClubMember[], query: string, hostsOnly: boolean): ClubMember[]` — trimmed, case-insensitive substring on `memberName`; `hostsOnly` keeps `isHostRole`.
  - `skillLabel(level: SkillLevel | null): string | null` — `'Beginner' | 'Intermediate' | 'Advanced'` or null.

- [ ] **Step 1: Failing tests** in `lib/members.test.ts`:
  - `orderMembers` puts `host` and `co_organizer` before `member`s, each group A→Z: input `[Wei(member), anand(member), Zoe(host), bea(co_organizer)]` → names `['bea','Zoe','anand','Wei']`.
  - Blank names: `[{name:''}, {name:'Ann'}]` (both members) → `['Ann', '']`; `memberName` of the blank one is `'Member'`.
  - Accents/case: `['émile', 'Eli', 'eve']` orders `['Eli', 'émile', 'eve']` (base sensitivity).
  - `filterMembers(all, '  pri ', false)` matches `'Priya Shah'`; `filterMembers(all, '', true)` returns only host/co-organizer rows; `filterMembers(onlyMembers, '', true)` → `[]`.
  - `memberInitials`: `'Priya Shah'`→`'PS'`, `'Admin'`→`'A'`, `'mary ann lee'`→`'ML'`, `''`→`'?'`.
  - `skillLabel('intermediate')`→`'Intermediate'`, `skillLabel(null)`→`null`.
- [ ] **Step 2:** `npx vitest run lib/members.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the signatures above in `lib/members.ts`.
- [ ] **Step 4:** Tests pass; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(lib): member ordering, filtering and initials`.

---

### Task 2: Members section redesign

**Files:** Modify `components/ClubMembers.tsx`, `components/icons.tsx` (only if `UserPlusIcon`/`MessageCircleIcon` sizes need a 22pt default — both exist). Create `components/hub/MemberRow.tsx`. Tests: `components/__tests__/club-members.test.tsx` (extend), new `components/__tests__/member-row.test.tsx`.

**Interfaces:**
- Consumes: Task 1 helpers; `fetchRoster`, `canInvite`, `ClubMember` (`lib/clubs.ts`); `fetchFriends`, `addFriend`, `avatarColorFor` (`lib/friends.ts`); `createGroupThread(title, memberIds)` → `{ id, error }` (`lib/messages.ts` — check its return shape); `useSession`; `useRouter`.
- Produces: `MemberRow({ member, isSelf, isFriend, onMessage, onAddFriend, messaging, adding }: …)` — presentational; `ClubMembers` keeps its existing props and `ClubMembersHandle.reload()` (now also reloads friends).

- [ ] **Step 1: Failing tests.**
  - `member-row.test.tsx`:
    - renders initials avatar, name, "Host"/"Co-organizer" tag, skill text; no skill pips (`SkillLevelPips` not rendered);
    - self row renders `"{name} (you)"` and neither button;
    - non-friend shows button labelled `Add {name} as a friend`; friend shows text "Friend" and no add button;
    - Message button labelled `Message {name}` calls `onMessage`; `messaging` true → disabled (`aria-disabled`).
  - `club-members.test.tsx` (mock `lib/clubs`, `lib/friends`, `lib/messages`, router):
    - search placeholder `Search 3 members`; typing `pri` shows only Priya;
    - "Show: Everyone" toggles to "Show: Hosts" and shows only host/co-organizer rows; with a query and no match shows `No members match “{query}”.`; with an empty query, Hosts filter and nobody matching shows `No hosts in this club yet.`;
    - organizers see a 48pt invite button labelled `Invite someone by email` that reveals the existing invite form; members don't see the button or form;
    - Message → `createGroupThread('', [profileId])` then `router.push('/messages/{id}')`; **double tap → one call** (Review Focus 1);
    - Add friend success → row shows "Friend"; failure → refusal text shown and button idle again (Review Focus 4);
    - pending invites, tip and imported confirmation still render for organizers (existing tests keep passing).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
  - `MemberRow`: min height 68; 46pt avatar (`avatarColorFor(profile_id)`, `memberInitials`, Figtree 700, `'#fff'`); name Figtree 600 16 + `Tag size="small"`; skill 13 `neutral[700]`; 1px `colors.divider` under the text block only; right-side 44pt icon buttons (Add friend before Message); "Friend" as `Tag size="small" variant="accent2"`.
  - `ClubMembers`: load `fetchFriends()` alongside roster/invites (friend ids in a `Set`); replace the roster card list with: top row (search pill, 1.5px `neutral[400]` border + organizer invite button toggling `showInvite`), filter text button, `filterMembers(orderMembers(roster), query, hostsOnly)` rendered as `MemberRow`s; move the existing invite form behind `showInvite`; keep pending invites, tip, imported card, `reload()`.
  - Message: `messagingId` state + ref guard; on error show `GENERIC_ERROR` via the existing error banner.
  - Remove the now-unused `SkillLevelPips` import if nothing else in the file uses it.
- [ ] **Step 4:** Focused tests pass; full `npm test`; `npx tsc --noEmit`.
- [ ] **Step 5: QA Pass** (`https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB`): read live; update Members steps (search, Show filter, invite button revealing the form) and add steps (new data-ids) for Message → opens chat (reuses an existing one) and Add friend → "Friend"; exact copy from source; update fractions/total; republish in place.
- [ ] **Step 6: Commit** `feat(hub): Members redesign with Message and Add friend`.

---

### Task 3: Inbox — Home Messages button and personal-only list

**Files:** Modify `lib/use-unread.ts` (+ `lib/use-unread.test.tsx`), `components/home/HomeHeader.tsx`, `app/home.tsx` (+ `app/__tests__/home.test.tsx`), `app/messages/index.tsx` (+ `app/__tests__/messages.test.tsx`), `lib/messages.ts` (+ `lib/messages.test.ts`).

**Interfaces:**
- Produces: `UnreadCounts` gains `personal: number` — the `unread` of the row whose `club_id` is null (0 if absent). `total` and `byClub` unchanged.
- `HomeHeader` gains `messagesUnread: boolean` and `onMessages: () => void`.

- [ ] **Step 1: Failing tests.**
  - `use-unread.test.tsx`: rows `[{club_id:null, unread:3}, {club_id:'c1', unread:2}]` → `{ total: 5, byClub: { c1: 2 }, personal: 3 }`; no null row → `personal: 0`.
  - `home.test.tsx`: header shows a button labelled `Messages` (or `Messages, unread` when `personal > 0`) placed before Alerts; tap → `router.push('/messages')`.
  - `messages.test.tsx`: a thread list containing `club`, `game`, `direct` and `group` rows renders only the direct and group rows; no pinned club rows; "New message" still pushes `/messages/new`; the screen's back control goes to `/home`.
  - `lib/messages.test.ts`: remove/adjust tests for helpers you delete (below).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
  - `useUnreadCounts`: compute `personal` from the null-`club_id` row.
  - `HomeHeader`: 44pt `surface` circle with `MessageCircleIcon`, `accent[600]` dot when `messagesUnread`, before the Alerts button; label as above.
  - `/messages`: filter rows to `kind === 'direct' || kind === 'group'`; delete the pinned-club-row path (the `openThreadForClub` tap branch, `/messages/club/…` push) and simplify ordering to `sortThreads`. In `lib/messages.ts`, delete `orderThreadsForList` and the club/game branches of `rowSubtitle` only if no other caller uses them (grep first); keep `kindLabel` if used elsewhere. Back control → `router.replace('/home')`.
- [ ] **Step 4:** Focused tests; full `npm test`; tsc.
- [ ] **Step 5: QA Pass:** add/adjust steps for the Home Messages button and the inbox showing only one-to-one/group chats; republish.
- [ ] **Step 6: Commit** `feat(messages): personal inbox from Home; club and game chats stay in the club`.

---

### Task 4: Chat screens' back links

**Files:** Modify `app/messages/club/[threadId]/index.tsx`, `app/messages/[threadId].tsx`, `app/messages/new.tsx`; tests `app/__tests__/club-board.test.tsx`, `app/__tests__/thread.test.tsx`, `app/__tests__/messages-new.test.tsx`.

**Interfaces:** Consumes `fetchThread(threadId)` → `ThreadDetail` with `club_id`, `event_id` (already loaded on both screens).

- [ ] **Step 1: Failing tests.**
  - Club board screen back: with history → `router.back()`; without (`canGoBack() === false`) → `router.replace('/clubs/{club_id}/board')` (Review Focus 5).
  - Thread screen back:
    - game thread (has `event_id`) without history → `router.replace('/clubs/{club_id}/events/{event_id}')`;
    - direct/group thread without history → `router.replace('/messages')`;
    - with history → `router.back()` in all cases;
    - thread not loaded yet (no detail) without history → `router.replace('/messages')`.
  - New message screen back: with history → `back()`; without → `replace('/messages')`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `router.canGoBack() ? router.back() : router.replace(target)`; update stale comments that say these screens return to the inbox.
- [ ] **Step 4:** Focused tests; full `npm test`; tsc.
- [ ] **Step 5: Commit** `fix(messages): club and game chats go back to the club, not the inbox`.

---

### Task 5: Visual baselines, real-browser check, PR (controller)

- [ ] Playwright (phase-2 procedure; local stack; export the three env vars): re-baseline `club members` (organizer view), add `club members as member`, `messages` (inbox), and Home baselines affected by the new header button. Eye-check every changed PNG; anything else changing → stop and investigate. End with `npx supabase db reset --local && npm run test:db`.
- [ ] Real-browser check at 375×812 against a local static export (seeded data): Members search/filter/order, Message opens a chat and Back returns to Members, Add friend, Home Messages button and dot, inbox shows only personal chats, board/game chat Back.
- [ ] Hand the user `localhost:8090` (hosted dev; no migrations this phase).
- [ ] Push branch, open PR, bind it, report CI.
