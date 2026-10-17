# Members + personal messages (club-hub redesign, phase 3)

Date: 2026-10-17
Design source: `docs/design/club-hub-v3/` — README "Members" and frame **1e** in
`Club Hub.dc.html` / `docs/superpowers/specs/assets/2026-09-29-club-hub-screens.png`.
Earlier phases: `2026-09-29-home-club-hub-design.md` (Home), `2026-09-29-club-hub-games-design.md`
(club hub + Games; Members was re-homed there unchanged).

## Intent

Members is where you find people in a club and get in touch with them. Phase 2 moved the old
roster into the hub as-is; phase 3 redesigns it to the Design V3 frame and gives every member a
**Message** button.

Phase 1 removed the tab bar, which left the conversation list unreachable. This phase also settles
where conversations live, with one rule from the user: **inside a club** there is only the club
chat (the Board) and each game's chat; **one-to-one and group chats live outside clubs**, in a
single inbox reached from Home. The user chose this to avoid the confusion of the same chat
appearing under several clubs.

## Goals

- Members matches frame 1e: search, invite button, a Hosts filter, hosts first then by name,
  rows with avatar, name, Host tag, skill level and a Message button.
- Message on a member opens your one-to-one chat with them (reusing an existing one).
- A member's row lets you add them as a friend.
- Home gets a Messages button that opens the inbox of one-to-one and group chats.
- Friends stay as a personal shortlist across clubs for messaging (Profile → Friends unchanged).

## Non-goals

- No first/last name split. Sorting is by display name only (the user dropped the design's
  "Sort: First/Last name" toggle).
- No club-scoped one-to-one or group chats.
- No Board redesign (phase 4), no Photos (phase 5), no changes to game chat or the post screens
  beyond what the inbox change requires.
- No change to who may invite (hosts and co-organizers) or to "Bring someone" seat holding, which
  already uses the club roster, not friends.

## Anti-goals

- A conversation must never appear in two places with different unread states.
- Members must not lose anything organizers rely on today: invite by email, pending invites with
  resend/delete, the "Bringing people in" tip, and the post-import confirmation.

## What the user decided

- Friends stay; they are a cross-club shortlist used when starting a message or adding people to a
  group chat. Members does not replace them.
- Sort by name only.
- Inside a club: club chat (Board) + game chats. Outside: one-to-one and group chats, one inbox.
- The inbox is reached from a Messages button in Home's header beside Alerts, with an unread dot.
- Starting a chat: from the inbox's "New message" (friends first, then people from your clubs, as
  today) or from Message on a member; both reuse an existing one-to-one chat.
- Members rows include a way to add the person as a friend.
- Invite button for organizers opening the existing invite-by-email form, and pending invites kept
  at the bottom of Members for organizers (accepted as proposed).

## Members section

Built on the phase-2 `components/ClubMembers.tsx` (keep its data loading, invite and pending-invite
logic; replace the roster rendering).

- **Top row:** search field "Search {N} members" (pill, 1.5px `neutral[400]` border) filtering by
  name as you type, and, for organizers only, a 48pt round `accent[700]` invite button
  (user-plus icon) that reveals the existing invite-by-email form below the top row. Members don't
  see the button.
- **Filter:** "Show: Everyone" text button (`accent[700]`) toggling to "Show: Hosts". "Hosts" means
  role `host` or `co_organizer`. No sort control.
- **Order:** hosts and co-organizers first, then everyone else; each group sorted by display name
  (case-insensitive, locale compare). An empty display name sorts last as "Member".
- **Row (min 68pt):**
  - 46pt round avatar with up to two initials from the display name, background from
    `avatarColorFor(profile_id)` (`lib/friends.ts`), white Figtree 700 text.
  - Name (Figtree 600 16) with a tag: "Host" for host, "Co-organizer" for co-organizer
    (`Tag size="small"`).
  - Skill level (13px `neutral[700]`), e.g. "Intermediate"; omitted if not set. Text only, per
    frame 1e — the current rows' skill pips are dropped (*controller's call*).
  - A 1px `divider` under the text block (not under the avatar), per the design.
  - Right side, 44pt icon buttons:
    - **Add friend** (user-plus) when the person isn't your friend; after adding, it is replaced
      by a small "Friend" tag. *Builder's call:* exact icon/tag treatment; keep it secondary to
      Message.
    - **Message** (message-circle) → opens the one-to-one chat (see below).
  - Your own row reads "{name} (you)" and has neither button.
- **Empty search:** "No members match “{query}”."
- **Pending invites** (organizers): the existing invited/declined list with resend and delete,
  below the member list, unchanged. The "Bringing people in" tip and the post-import confirmation
  stay as they are today.
- Pull to refresh and refetch on focus, as in phase 2.

## Message button

- Calls `createGroupThread('', [profileId])` (`lib/messages.ts`), which already returns an existing
  club-less two-person thread containing both people when there is one (dedupe in
  `20260829030000_group_threads.sql`; note it can also return a group that has shrunk to those two
  people — acceptable), then pushes `/messages/{threadId}`. It requires the two people to share a
  club or be friends, which always holds within Members.
- While it runs, the button shows a spinner and ignores further taps (ref guard). Failure: inline
  error on the row or a banner, `GENERIC_ERROR`.
- Coming back from the chat returns to Members (`router.back()`).

## Add friend

- Uses `addFriend(profileId)` from `lib/friends.ts`. Friend state comes from `fetchFriends()`
  loaded alongside the roster; after a successful add the row shows "Friend" without a full reload.
- Removing a friend stays on the Friends screen (not offered in Members).

## Inbox

- **Home header:** a 44pt Messages button (message-circle, `surface` circle like Alerts) placed
  before Alerts, with an `accent[600]` dot when any one-to-one or group chat has unread messages.
  Tapping opens `/messages`.
- **`/messages` list:** shows only `direct` and `group` threads. `fetch_my_threads` returns all
  four kinds (`club`, `game`, `direct`, `group`; a two-member group is reported as `direct`), so the
  list filters client-side on `kind in ('direct','group')`. Club boards and game chats are left out.
  Keeps "New message" as today. *Controller's call:* delete the now-dead club-row code in the inbox
  (pinned club rows, `orderThreadsForList`'s club partition, `rowSubtitle`'s club/game branches) and
  their tests rather than leaving it dormant.
- **Unread dot source:** `my_unread_counts()` already returns a row with `club_id = null` holding
  exactly the direct + group unread total (club boards and game chats carry a club id).
  `lib/use-unread.ts` receives it but only folds it into `total`; expose it (e.g. `personal`) and
  use that for the Messages dot. No migration needed.
- **Back links** (applying the user's inside/outside rule to every chat screen):
  - `/messages` back → `/home`.
  - A direct or group conversation → `router.back()`, fallback `/messages`.
  - The club board screen (`app/messages/club/[threadId]/index.tsx`) and a game chat (the shared
    `app/messages/[threadId].tsx` when the thread is a game thread) → `router.back()`, fallback to
    the club's Board (`/clubs/{clubId}/board`) or the game page (`/clubs/{clubId}/events/{eventId}`)
    respectively — never the inbox, which no longer lists them. *Controller's call;* update the
    tests that assert the old `/messages` targets.
  - `app/messages/new.tsx` after creating a chat stays as today (opens the new chat); its back →
    `router.back()`, fallback `/messages`.
- Club and game threads still open from the club Board and the game page, and their unread counts
  still feed the club card badge on Home as today.

## Constraints

- Same conventions as phases 1–2: Text/TextInput from `components/Text`; colours from
  `lib/theme.ts`; Figtree for this section; 44pt targets; Lucide-style icons at stroke 2.75.
- No database change is expected. New database objects (if any turn out to be needed) follow the grants/allowlist/self-audit rules in the phase-2 plan.
- User testing happens on `localhost:8090` against hosted dev; any migration is pushed to dev
  before handing over.
- The QA Pass checklist is updated per `CLAUDE.md`.

## Left to the builder

- Icon and tag styling for Add friend / Friend within the stated hierarchy.
- How the inbox unread dot is computed (see above).
- Test structure; visual baselines for Members (organizer and member views), the inbox and Home's
  header.
