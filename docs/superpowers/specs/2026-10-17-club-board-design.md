# Board redesign (club-hub redesign, phase 4)

Date: 2026-10-17
Design source: `docs/design/club-hub-v3/` — README "Board" and frame **1c** in `Club Hub.dc.html` /
`docs/superpowers/specs/assets/2026-09-29-club-hub-screens.png`.
The user opted out of questions and asked for the redesign as designed; every product choice
below that the design doesn't fix is marked *(call)* and was made by Claude.

## Intent

The Board is the club's own conversation (the user's phase-3 rule: inside a club live only the
club board and game chats). Today it is a list of one-line post titles that you open to read.
Design V3 turns it into a feed you read in place: whole posts with the author, hearts, a peek at
the comments, and a composer always at the bottom.

## Goals

- Feed of full posts per frame 1c, newest first, readable without opening each post.
- Hearts on posts: one tap to heart / un-heart, with a count.
- Comments shown under each post; tapping through opens the full conversation (existing post
  screen) to read everything and reply.
- A composer pinned to the bottom of the Board: photo, "Write to the club", Post.
- Everything that exists keeps working: images (≤4), announcements with the email fan-out for
  organizers, unread state, realtime refresh, the existing post screen.

## Non-goals

- No editing or deleting posts or comments (not in the app today; not in the design).
- No hearts on comments, no other reaction types.
- No profile photos (initials avatars only, as elsewhere).
- No changes to game chats or one-to-one/group chats.

## Feed (Board section)

- Caption at top: "Everyone in the club sees posts here" (13px `neutral[700]`).
- Sort control on the right: "Most recent ▾" opening two choices, **Most recent** (newest posts
  first, default) and **Latest activity** (posts with the newest comment first — today's order)
  *(call: the design only shows the default label)*. Choice remembered per device.
- **Post card** (no card chrome; posts separated by a 1px divider, per the frame):
  - 44pt initials avatar (`avatarColorFor(author_id)`, `memberInitials`), name 700 16
    `accent[700]`, a "Host" tag for hosts and co-organizers *(call: matches Members)*, time
    13px `neutral[700]` ("Today, 8:35 AM", "Yesterday, 7:59 PM", else "Tue 29 Sept, 7:59 PM").
  - "Announcement" tag when it's an announcement (kept from today).
  - Body 16/1.5, pre-wrap. Posts longer than 8 lines are clipped with a "More" link that opens
    the post screen *(call: keeps the feed scannable)*.
  - Images: the existing `AttachmentGrid` (1–4), tap opens the existing viewer.
  - Footer row: heart pill (outline heart + count; filled `accent[700]` when you hearted) on the
    left, "N comments" (or "Comment" when none) on the right → post screen.
  - A small unread dot beside the time when the post has activity you haven't seen
    *(call: today's unread badge, made quieter)*.
- **Comments peek:** below a post with comments, a `surface` radius-18 block with the **2 most
  recent** comments (30pt avatar, name 700 14 `accent[700]`, text 15, one or two lines), and
  "View all N comments" when there are more than 2 *(call: the frame shows all comments of a
  2-comment post; showing every comment of a busy post would bury the feed)*. Tapping the block
  opens the post screen.
- **Paging:** first 30 posts, then a "Show older posts" button loading 30 more.
- **Empty:** "Nothing here yet. Start the first post." above the composer.
- **Organizers:** an "Announcement" text button beside the sort control opens today's full
  composer screen (with "Also email everyone in the club") *(call: the pinned composer stays
  simple; announcements keep their existing screen)*.
- Pull to refresh; refetch on focus; realtime refetch on new messages (as today).

## Composer (pinned to the bottom of the Board)

- Row: 44pt `surface` photo button, a pill input "Write to the club" (1.5px `neutral[400]`
  border, grows to ~4 lines), a **Post** button disabled (`surface` / `neutral[600]`) until there
  is text or a photo.
- Enter posts on web (Shift+Enter for a new line); on phones Enter inserts a newline and the Post
  button posts *(call: Enter-to-post on phones swallows newlines)*.
- Photos: up to 4, shown as removable thumbnails above the row (existing attachment picker and
  upload flow).
- Posting creates a regular (non-announcement) post, clears the composer, and shows the new post at
  the top. On failure the draft stays and an inline error shows.

## Hearts

- One heart per member per post. Tapping toggles; the count and filled state update immediately
  and roll back on failure.
- Hearts are visible to everyone in the club (count only — no list of who hearted)
  *(call)*.
- Hearts refresh with the feed (focus, pull, realtime message refetch); there is no live
  heart-count push *(call: keeps realtime as it is)*.

## Data

- New table `post_hearts(message_id → messages, profile_id → profiles, created_at)`, primary key
  `(message_id, profile_id)`; RLS on, no direct writes; readable through the feed RPC only.
- `toggle_post_heart(p_post uuid) returns boolean` (new hearted state) — security definer; the
  caller must be able to read the post's thread (`can_read_thread`) and the post must be a root
  post (`root_id is null`) of a club board thread.
- `fetch_club_feed(target_thread uuid, p_limit int default 30, p_before timestamptz default null,
  p_order text default 'recent')` — like `fetch_club_posts` (same access rules, club board threads
  only, same unread computation) plus: `author_role` (the author's club role, for the Host tag),
  `heart_count`, `hearted_by_me`, `attachments` (jsonb array like `fetch_post_messages`), and
  `recent_comments` (jsonb array of up to the 2 latest replies: id, author_id, author_name, body,
  created_at, oldest first). `p_order` is `'recent'` (by `created_at`) or `'activity'` (by
  `last_activity_at`); `p_before` pages by the same key.
- `fetch_club_posts` stays for now (unused by the Board once this ships).
- Grants/allowlist/self-audit conventions as in earlier phases; migrations pushed to hosted dev
  before the user tests.

## Constraints

- Text/TextInput from `components/Text`; colours from `lib/theme.ts`; Figtree for the feed;
  44pt targets; Lucide-style icons at stroke 2.75 (new: heart, image already exists as
  `ImageIcon`).
- Keep the post screen (`app/messages/club/[threadId]/[postId].tsx`) and the announcement composer
  (`app/messages/club/new.tsx`) working; Back behaviour from phase 3 unchanged.
- QA Pass checklist updated per `CLAUDE.md`.

## Left to the builder

- Exact composer growth and keyboard handling on iOS/Android/web.
- Time-format helper placement.
- Test structure and baselines (club board, club hub board).
