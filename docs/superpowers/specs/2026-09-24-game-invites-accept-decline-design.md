# Game invites with accept / decline — Design

**Date:** 2026-09-24
**Status:** Approved (design); pending implementation plan

**Supersedes:** the "Inviting an existing club member to a game" section of
`docs/superpowers/specs/2026-09-05-invite-only-games-design.md` ("commits a
booking immediately"), and the "Bring someone" booking-on-behalf behavior in
`docs/superpowers/specs/2026-08-23-seating-and-booking-design.md`.

## Problem

The game screen's **Invite** button (`BringSomeoneSheet`, via
`propose_booking` / `commit_booking`) books the chosen club members into
seats immediately. The only say the invitee gets is an after-the-fact
**Decline** under "Your games" (`decline_booking`). That is opt-out, not an
invitation.

The intended workflow, in both game modes: a sender invites 3–4 members;
each accepts or declines; if someone declines, the sender invites another
member, until the tables are filled. Seats must be held for pending invitees
so the sender can't over-fill a table and an accepting invitee always gets
the seat they were offered.

## Decisions

1. **Opt-in for both game modes.** Every invite of *another* existing member
   to a game — open play or invite-only — is pending until they accept.
2. **Pending invites hold seats.** A pending invite counts against table
   capacity.
3. **No automatic expiry.** A pending invite holds its seat until the invitee
   responds, the sender or a host withdraws it, or the game starts.
4. **Inviting into a full game is allowed.** The invite carries no table;
   accepting it joins the waitlist.
5. **Withdraw:** the sender, or any host/co-organizer of the club.
6. **Notifications both ways** (email via the existing outbox). The only new
   dashboard surface is the invitee's Accept / Decline card.
7. **Guest invites are unchanged.** `create_club_invite` with an `event_id`
   (non-members, by email) keeps its current behavior and does not hold a
   seat — there is no profile to hold it for until they sign up.
8. **Implementation approach:** a new `invited` value on `booking_status`,
   not a separate invites table. Bookings already carry a table, a group,
   `booked_by`, the decline path, sender notifications, and the "Your games"
   listing; seat-holding falls out of rows already counted per table.

## Data model

- `booking_status` gains `invited`:
  `confirmed | waitlisted | invited | cancelled | declined`.
- No new tables. An invite is a `bookings` row with `status = 'invited'`,
  `booked_by` = the sender, `group_id` = the sender's booking group, and
  `event_table_id` set if a seat at a specific table was held.
- New column `bookings.invite_holds_seat boolean`, null on every non-invited
  row. For an `invited` row: `true` = the invite holds a seat (at its table,
  or an "any table" seat counted at event level when the table is null —
  the same way a confirmed any-table booking counts today); `false` = the
  game was full when it was sent, and accepting joins the waitlist. A null
  table alone can't say which, because "any table" bookings are already
  confirmed-with-no-table today; group status can't either, because a
  waitlisted group becomes confirmed when promoted.
- `outbox_kind` gains `booking_invited`, `booking_invite_accepted`,
  `booking_invite_withdrawn`, `booking_cancelled_by_member`. (Each
  `add value` in its own migration, per
  `20260826000000_outbox_kinds_reminder_and_broadcast.sql`'s note.)

## Rules

### Sending (`propose_booking` / `commit_booking`)

Entry point and permissions are unchanged: open play — any member who can
book; invite-only — organizer only (`20260905090000_invite_only_booking_gate.sql`).

- The **sender themselves**, if included, is booked `confirmed` /
  `waitlisted` immediately, exactly as today.
- **Every other player** gets a row with `status = 'invited'` in the same
  group. The seating planner places them as today (so a group still sits
  together) and those seats are then held.
- If no seat is available for an invitee, their row is `invited` with
  `table_id = null`.
- The `booked_by_friend` outbox row is replaced, on this path, by
  `booking_invited` to each invitee.

### Accept (new `accept_booking_invite(target_booking uuid)`)

- Caller must be the row's `profile_id`; row must be `invited`; game must
  not have started (same guards and null-caller binding pattern as
  `decline_booking`).
- Holding a seat → `confirmed`, keeping its table (or none, for an
  any-table hold). Not holding a seat → the row moves into a new solo
  booking group (`created_by` = the invitee, any table, `waitlisted_at` =
  now) and becomes `waitlisted` — the waitlist is queued by group, so this
  is what puts them at the back as of accepting rather than at the
  sender's group's place in line. The old group is closed if now empty,
  and waitlist promotion runs.
- Outbox: `booking_invite_accepted` to `booked_by`.
- Does **not** re-check organizer status for invite-only games — the invite
  was organizer-authorized when sent (same reasoning as guest invites).

### Decline (existing `decline_booking`)

- Now also accepts rows in `invited` (in addition to `confirmed` /
  `waitlisted` booked by someone else).
- → `declined`; frees the held seat; `booking_declined` to `booked_by`;
  `close_group_if_empty`; `promote_waitlist` — all existing behavior.

### Withdraw (new `withdraw_booking_invite(target_booking uuid)`)

- Caller must be `booked_by` or a club organizer (`is_club_organizer`); row
  must be `invited`; game must not have started.
- → `cancelled`; frees the seat; `booking_invite_withdrawn` to the invitee;
  `close_group_if_empty`; `promote_waitlist`.

### Game start

Any row still `invited` when the game starts is closed as `cancelled`, with
no notification, by a new sweep function registered alongside the existing
`sweep-promotion-offers` cron job
(`20260825060000_schedule_booking_jobs.sql`, every 5 minutes). Accept,
decline, and withdraw already refuse once the game has started, so the few
minutes before the sweep runs cannot change any outcome.

### Leaving after accepting (existing `cancel_booking`)

Unchanged permissions: the member can cancel their own booking ("Leave this
game" seat panel, "Your games"); a host can remove anyone ("Remove from
game"). **New:** when the caller is the booking's own `profile_id` and
`booked_by` is someone else, write `booking_cancelled_by_member` to
`booked_by`. A host removing someone still writes
`booking_cancelled_by_host` to the member, as today.

### One active row per person per game

Wherever that is enforced today (the partial unique index on bookings,
`assert_players_bookable`), `invited` counts as active: a member already
booked, waitlisted, or invited cannot be invited again.

### What `invited` counts toward

Every function, policy, and app query that treats
`('confirmed', 'waitlisted')` as "active" is audited individually (≈21
migrations define such checks; the plan lists each). The rule:

| Concern | Counts `invited`? |
|---|---|
| Seat capacity / held seats (seating planner, `gameFull`) | Yes |
| One-active-row guard | Yes |
| Invite-only event visibility (`events_select_member`) | Yes |
| Headcount, "who's playing", `event_accepted_count` | No |
| Waitlist promotion candidates | No |
| "Need a fourth" — is the seat free? | Yes (a held seat is not free; no call goes out over it) |
| "Need a fourth" recipients, event reminders, check-in / door list | No |
| Removing a table | Held invites at it are unseated like confirmed rows (table → null) and keep holding at event level |
| `close_group_if_empty` (group still live?) | Yes — a group with only pending invitees stays open |

### Who sees pending invitees (revised 2026-09-24)

- **Open play:** pending invitees are shown by name to every member who can
  see the game, the same as confirmed players. (This also lets the Invite
  sheet grey out people someone else already invited.)
- **Invite-only:** a pending invite is visible, with its name, only to the
  club's organizers, its sender, and the invitee — enforced in the
  `bookings` RLS policy, not just the UI. Other viewers see the held seat as
  an anonymous "Invited" seat.
- **Invite-only roster unlock** changes from "seated at a specific table" to
  "accepted and holding a seat" (`confirmed`, with or without a table). A
  pending invitee, or someone on the waitlist, sees only the headcount.

## UI

### Game screen — sender / host

- Held seats render the invitee's name with an **Invited** tag (distinct,
  dimmed seat state in `SeatGrid`).
- Tapping a held seat opens the usual seat panel with **Withdraw invite** in
  place of Move / Remove. Shown to any organizer on every held seat, and to
  a non-organizer sender on seats they sent.
- Table-less invites appear in the waitlist area as
  **"Invited — would join the waitlist"**, with the same Withdraw action.
- The **Invite** button and `BringSomeoneSheet` stay; the sheet's final
  confirm becomes **Send invites**.

### Game screen — other members

- Open play: a held seat shows the invitee's name with the **Invited** tag.
  Invite-only: an anonymous **Invited** seat (see "Who sees pending
  invitees").
- When there are pending invites, a line reads e.g. "5 playing · 2 invited".

### Game screen — the invitee

- Banner at the top: "*Sender* invited you to this game — *Table 2*" (or
  "— you'd join the waitlist") with **Accept** / **Decline**.

### Dashboard (`app/clubs/index.tsx`)

- Pending game invites appear in the same invites area as the existing
  club-invite card, each naming the club, game, and date, with **Accept** /
  **Decline**. This is the only new dashboard surface.

### "Your games"

- Accepted games list as today. For a booking someone else made for you, the
  leave control is **Can't make it** (calls `cancel_booking`, which now
  notifies the sender), replacing today's **Decline** there.

## Notifications

Email via `notification_outbox` → `deliver-notifications`
(`templates/bodies.ts`). "Sender" = the row's `booked_by`; a
co-organizer's invites notify only that co-organizer.

| Event | Recipient | Kind | Copy (subject) |
|---|---|---|---|
| Invite sent | Invitee | `booking_invited` (new) | "*Sender* invited you to *game*" |
| Accepted | Sender | `booking_invite_accepted` (new) | "*Invitee* is in for *game*" |
| Declined | Sender | `booking_declined` (existing, body reworded to "declined your invite") | "*Invitee* can't make *game*" |
| Withdrawn | Invitee | `booking_invite_withdrawn` (new) | "Your invite to *game* was withdrawn" |
| Accepted member cancels | Sender | `booking_cancelled_by_member` (new) | "*Invitee* can't make it anymore — their seat is open" |
| Host removes member | Member | `booking_cancelled_by_host` (existing) | unchanged |
| Game starts with pending invites | — | none | — |

The host checklist's "Invite your players" step (`lib/guides.ts`) is
unaffected — game invites go to existing members.

## Edge cases

- **Sender is also invited-and-seated?** Not possible — the sender is
  booked directly, never `invited`.
- **Sender cancels their own booking** while their invitees are pending:
  pending invites stay (the group stays open because of them); the sender
  can withdraw them individually.
- **Game cancelled** with pending invites: closed along with every other
  booking by the existing cancel path (audit that it includes `invited`).
- **Game mode switched** after invites exist: pending invites stay; the new
  mode's rules apply only to new invites (same principle as the 2026-09-05
  spec).
- **Host moves a held seat:** not offered — held seats have only Withdraw.
  The invitee can be moved once they accept.
- **Invitee accepts a table-less invite and a seat is free by then:** they
  still join the waitlist and are promoted by the normal waitlist flow; no
  special-casing.

## Testing

**Database (pgTAP, alongside existing booking tests)**

- Send: sender booked, others `invited` with held tables; held seats block
  other bookings and waitlist promotion; full game → `invited` with null
  table; duplicate invite refused; invite-only still organizer-only.
- Accept: with table → `confirmed`; without → `waitlisted` at back as of
  accept; only the invitee; refused after start.
- Decline / withdraw: seat freed, promotion runs, correct outbox rows;
  withdraw by sender and organizer, refused for another member; game start
  closes pending invites silently.
- Status audit: headcount, need-a-fourth, reminders, promotion ignore
  `invited`; invite-only visibility includes the invitee.
- Leaving after accept: member-cancel of a seat booked by someone else
  notifies the booker; self-booked cancel notifies nobody.

**App (Vitest)**

- Game screen: Invited chip (named for sender/host, anonymous for others),
  Withdraw invite, invitee Accept/Decline banner, "Send invites".
- Dashboard game-invite card and its Accept/Decline calls.
- "Your games" shows **Can't make it** for booked-by-someone-else seats.

**Notifications:** snapshot tests for the four new templates and the
reworded `booking_declined` body.

**Visual baselines:** refresh only the screens this change touches.

**QA Pass artifact:** update the scenarios covering Invite / Bring someone /
the dashboard invite card, per `CLAUDE.md`.
