# Board Redesign (Club-Hub Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the club Board into the Design V3 frame-1c feed — full posts with avatars, hearts and a comments peek — with a composer pinned to the bottom.

**Architecture:** One migration adds `post_hearts`, `toggle_post_heart` and a richer `fetch_club_feed` RPC. `lib/board.ts` wraps them with pure formatting helpers. New presentational components (`PostCard`, `CommentsPeek`, `HeartPill`, `BoardComposer`) are composed by a rewritten `components/ClubBoard.tsx`, which both the hub Board section and the standalone board screen already mount.

**Tech Stack:** Expo Router 57 / React Native / react-native-web, Supabase (Postgres + pgTAP), vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-club-board-design.md`

## Global Constraints

- Import `Text`/`TextInput` from `components/Text`; colours from `lib/theme.ts` (`'#fff'` allowed); Figtree in the feed; 44pt targets; new icons Lucide-style, stroke 2.75.
- Copy (exact): "Everyone in the club sees posts here", "Most recent", "Latest activity", "Write to the club", "Post", "More", "Comment", "{N} comment(s)", "View all {N} comments", "Show older posts", "Announcement", "Nothing here yet. Start the first post.", "Host".
- Feed order: `'recent'` = newest `created_at` first (default); `'activity'` = newest `last_activity_at` first. Page size 30.
- Comments peek: 2 most recent replies, shown oldest-first; "View all N comments" when N > 2.
- Body clipped at 8 lines with "More" → post screen.
- One heart per member per root post; optimistic toggle with rollback.
- Migrations forward-only; security definer + `set search_path = public` + `auth.uid()` guard; revoke from `public, anon`; client RPCs in both allowlists of `supabase/tests/database/portable/grants.test.sql`; new raise messages in `lib/bookings.test.ts` exemptions.
- Local Supabase only in tasks; dev push happens in Task 6 by the controller. Never `config push`.
- Git: explicit paths; never `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Double-tapping a heart** → ends in the state the second tap implies, count never goes negative or double-counts (server toggle + client in-flight guard). Tests in Tasks 1 and 3.
2. **Heart toggle fails** → filled state and count roll back. Test in Task 5.
3. **Post with only a photo, or only whitespace text** → Post enabled for photo-only, disabled for whitespace-only; server accepts photo-only (existing rule). Test in Task 4.
4. **Paging with equal timestamps / after a new post arrives** → no duplicates or gaps when loading older posts (keyset on timestamp + id). Test in Task 1 (SQL) and Task 5 (client de-dupe by id).
5. **Very long post or comment, emoji, newlines** → body wraps, clips at 8 lines with "More"; comments peek truncates to two lines. Test in Task 3.

---

### Task 1: Hearts and feed RPCs

**Files:** Create `supabase/migrations/20261017100000_board_feed.sql`, `supabase/tests/database/fixtures/board_feed.test.sql`. Modify `supabase/tests/database/portable/grants.test.sql`, `lib/bookings.test.ts` (only if new raise messages).

**Interfaces — produces:**
- `post_hearts(message_id uuid references messages on delete cascade, profile_id uuid references profiles on delete cascade, created_at timestamptz default now(), primary key (message_id, profile_id))`; RLS on, all privileges revoked from `public, anon, authenticated`.
- `toggle_post_heart(p_post uuid) returns boolean` — new state (true = hearted). Raises 42501 when the caller can't read the post's thread; raises `not_a_post` (22023) when the message isn't a root post of a club board thread.
- `fetch_club_feed(target_thread uuid, p_limit int default 30, p_before timestamptz default null, p_before_id uuid default null, p_order text default 'recent')` returning `fetch_club_posts`'s columns plus `author_role public.club_role` (null if the author left), `heart_count int`, `hearted_by_me boolean`, `attachments jsonb` (array of `{storage_path,width,height,sort_order}` ordered by sort_order, `[]` if none), `recent_comments jsonb` (≤2 latest replies as `{id,author_id,author_name,body,created_at}`, oldest first, `[]` if none). Keyset paging on `(order_key, id)` descending where order_key is `created_at` or `last_activity_at`. Same access rule and club-board-only check as `fetch_club_posts` (read its definition in `20260830021000_board_posts_are_club_only.sql` and reuse its body for unread/last_activity).

- [ ] **Step 1: Failing pgTAP** (`board_feed.test.sql`, model fixtures on `club_board_post.test.sql`/`club_board_reads.test.sql`): member toggles heart → true, count 1, `hearted_by_me` true; toggles again → false, count 0; two members → count 2; non-member `toggle_post_heart` → 42501; a reply id → `not_a_post`; feed returns attachments for a post with an attachment and `[]` otherwise; `recent_comments` holds the 2 latest of 3 replies, oldest first; `author_role` = 'host' for a host author; `p_order='recent'` vs `'activity'` ordering differs when an older post has a newer reply; paging: with 3 posts sharing one `created_at`, limit 2 then `p_before/p_before_id` of the last row returns the third with no duplicate; anon can't execute either function.
- [ ] **Step 2:** `npx supabase db reset --local && npm run test:db` → new file FAILS.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Add both functions to both allowlists; exemptions for new raise messages. `npm run test:db` passes in full; `npm test -- lib/bookings.test.ts` passes.
- [ ] **Step 5: Commit** `feat(db): post hearts and club feed RPC`.

---

### Task 2: Board client library

**Files:** Create `lib/board.ts`, `lib/board.test.ts`.

**Interfaces — produces:**
- `type FeedOrder = 'recent' | 'activity'`
- `type FeedComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string }`
- `type FeedPost = { id; authorId; authorName; authorRole: ClubRole | null; body; subject: string | null; isAnnouncement: boolean; createdAt; lastActivityAt; replyCount: number; unread: boolean; heartCount: number; heartedByMe: boolean; attachments: MessageAttachment[]; recentComments: FeedComment[] }` (use the existing attachment type from `lib/messages.ts`).
- `fetchClubFeed(threadId: string, order: FeedOrder, before?: { at: string; id: string }): Promise<FeedPost[] | null>`
- `togglePostHeart(postId: string): Promise<{ hearted: boolean | null; error: string | null }>`
- Pure: `postTimeLabel(iso: string, now?: Date): string` → "Today, 8:35 AM" / "Yesterday, 7:59 PM" / "Tue 29 Sept, 7:59 PM" (device-local time; month names from `MONTHS` in `lib/home.ts`); `commentCountLabel(n)` → "Comment" / "1 comment" / "N comments"; `mergeFeedPages(existing: FeedPost[], page: FeedPost[]): FeedPost[]` (append, de-dupe by id, keep first occurrence).
- Order preference: `loadFeedOrder(): Promise<FeedOrder>` / `saveFeedOrder(o)` via AsyncStorage key `board:order`, try/catch-safe.

- [ ] **Step 1: Failing tests** for each function (mock `./supabase` like `lib/my-games.test.ts`): rpc name/params (`fetch_club_feed` with `target_thread, p_order, p_before, p_before_id`), row mapping incl. jsonb arrays, null on error; toggle maps `data` → `hearted`; time labels at fixed `now` across midnight (TZ is America/New_York in tests); count labels; merge de-dupes.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** pass + tsc. **Step 5: Commit** `feat(lib): board feed client and formatting`.

---

### Task 3: Feed components

**Files:** Modify `components/icons.tsx` (+ `HeartIcon({ size, color, filled })`). Create `components/board/HeartPill.tsx`, `components/board/CommentsPeek.tsx`, `components/board/PostCard.tsx`, `components/__tests__/board-parts.test.tsx`.

**Interfaces — produces:**
- `HeartPill({ count, hearted, busy, onPress })` — pill, 44pt tall target, label `Heart this post` / `Remove your heart`, shows count.
- `CommentsPeek({ comments: FeedComment[], total: number, onPress })` — surface radius-18 block; each comment 30pt avatar + name 700 14 `accent[700]` + text 15 clipped to 2 lines; "View all {N} comments" when total > comments.length.
- `PostCard({ post: FeedPost, attachmentUrls: Record<string,string>, onOpen, onToggleHeart, hearting })` — avatar 44, name, Host tag when `authorRole` is host/co_organizer, time via `postTimeLabel`, unread dot, Announcement tag, body clipped at 8 lines with "More" (use `onTextLayout` line count on native; on web clip with `numberOfLines={8}` and show "More" when body has > 8 lines or > 600 chars), `AttachmentGrid`, footer HeartPill + comment link (`commentCountLabel`), CommentsPeek when replyCount > 0.

- [ ] **Step 1: Failing tests:** HeartPill labels/count/press/busy disabled; CommentsPeek renders 2 comments and "View all 5 comments" for total 5, not for total 2; PostCard shows name, Host tag only for host/co_organizer, "Announcement" tag, time label, "3 comments" link calling onOpen, "Comment" when 0, "More" shown for a 12-line body and not for a 2-line body, attachment grid rendered when attachments exist.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass + tsc. **Step 5: Commit** `feat(board): post card, hearts and comments peek`.

---

### Task 4: Pinned composer

**Files:** Create `components/board/BoardComposer.tsx`, tests in `components/__tests__/board-composer.test.tsx`.

**Interfaces — consumes:** `pickImages`, `compressImage`, `uploadAttachment`, `MAX_ATTACHMENTS` (`lib/attachments.ts`); `postMessage(threadId, body, announce, replyToId, rootId, attachments)` (`lib/messages.ts`). **Produces:** `BoardComposer({ threadId, onPosted: (postId: string) => void })`.

- [ ] **Step 1: Failing tests:** Post disabled when empty or whitespace-only, enabled with text, enabled with a photo and no text (Review Focus 3); Post calls `postMessage(threadId, body.trim(), false, null, null, attachments)` once even on double tap, clears the input and calls `onPosted(id)`; failure keeps the draft and shows the error; on web Enter posts and Shift+Enter doesn't; photo button opens the picker and thumbnails can be removed; at most 4 photos.
- [ ] **Step 2:** FAIL. **Step 3:** implement (reuse the upload sequence from `app/messages/club/new.tsx`; ref-guard submit). **Step 4:** pass + tsc. **Step 5: Commit** `feat(board): pinned composer`.

---

### Task 5: Board feed screen

**Files:** Rewrite `components/ClubBoard.tsx` (keep its props `threadId`, `clubId`, `showNewPost` → rename to `canAnnounce?: boolean` if cleaner, and its `reload()` handle); modify `app/clubs/[id]/(hub)/board.tsx` (pin `BoardComposer` via `HubSection footer`; pass role-based announce flag) and `app/messages/club/[threadId]/index.tsx` (pin the composer via `Screen footer`); tests `app/__tests__/club-board.test.tsx`, `app/__tests__/club-board-section.test.tsx` (update), `components/messages/__tests__/PostRow.test.tsx` (delete with `PostRow` if unused afterwards).

- [ ] **Step 1: Failing tests:** caption copy; sort control shows "Most recent" and switching to "Latest activity" refetches with `'activity'` and saves the choice; posts render as PostCards; heart tap is optimistic and rolls back on failure (Review Focus 2) and ignores a second tap while in flight (Review Focus 1); "Show older posts" fetches with the last post's `{at,id}` and appends without duplicates (Review Focus 4); empty state copy; organizers see an "Announcement" button that pushes `/messages/club/new?threadId=…&clubId=…`, members don't; tapping a post's comments or "More" pushes `/messages/club/{threadId}/{postId}`; after `onPosted`, the feed reloads and the new post is first; attachment URLs are signed in one batch via `getSignedUrls`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (keep focus refetch, realtime refetch and `reload()`; sign attachment paths across loaded posts with `getSignedUrls`).
- [ ] **Step 4:** focused + full `npm test` + tsc.
- [ ] **Step 5: QA Pass:** read live, update board steps (feed, hearts, comments peek, pinned composer, organizer Announcement button) with exact copy; new data-ids for new steps; update totals; republish in place.
- [ ] **Step 6: Commit** `feat(board): Design V3 feed with hearts, comments peek and pinned composer`.

---

### Task 6: Baselines, dev push, browser check, PR (controller)

- [ ] Playwright: re-baseline `club board`, `club hub board` (and `club post` only if it changed); update their text anchors; eye-check PNGs; end with `npx supabase db reset --local && npm run test:db`.
- [ ] Push the migration to hosted dev (dry-run first).
- [ ] Browser check at 375×812 on a local build: feed, heart toggle, comments peek → post screen → Back, composer post with text and with a photo, sort switch, older posts.
- [ ] Hand the user `localhost:8090`; push branch; open PR (prod `db push` before merge noted).
