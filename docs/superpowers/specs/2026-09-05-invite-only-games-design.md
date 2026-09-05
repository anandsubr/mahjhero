# Invite-only games (club-default game visibility) — Design

## Problem

Today every game a club creates is implicitly "open play": any active club
member can see it and book a seat (or bring another existing member along)
with no organizer approval step. There is no way for a club to run a private
game — visible and joinable only to people the organizer specifically invites.

This design adds a per-club default (open play vs. invite-only), a per-game
override, and extends the existing "Bring someone" feature (renamed
"Invite") so it works for both modes — including inviting people who are not
yet club members, who become club members upon accepting.

Out of scope: this does not touch the existing `clubs.visibility`
(`public`/`private`) column. That column is reserved, per prior design docs,
for a separate not-yet-built feature (an invite *link* that either admits
instantly or raises a host-approved join request for **club membership**).
This design is entirely about **game-level** visibility and does not change
how club membership itself is granted via the normal invite-link flow.

## Data model

- **`game_mode` enum**: `'open_play' | 'invite_only'`.
- **`clubs.default_game_mode`** (`game_mode`, default `'open_play'`): the
  club-wide default applied to new games. Editable by host/co-organizer only.
- **`events.game_mode`** (`game_mode`, default `'open_play'`): the effective
  mode for one game. Seeded from the club's `default_game_mode` at creation
  time; editable per-event by the organizer on the create/edit form,
  independent of the club default.
- **`club_invites.event_id`** (nullable FK to `events(id)`,
  `on delete set null`): when set, accepting this invite both joins the club
  (existing behavior, unchanged) and seats the invitee at that one event.
  When null, behaves exactly as every `club_invites` row does today.
- No new tables. Every existing `club_invites` column (`token`, `email`,
  `display_name`, `skill_level`, `expires_at`, `accepted_at`, `accepted_by`)
  is reused unchanged.
- **Backfill:** every existing club and event gets `'open_play'`, matching
  current real-world behavior exactly — no behavior change for any club that
  never touches the new setting.

## Permissions & enforcement

### Visibility (who can see a game)

`events_select_member` gains a branch for `invite_only` events: visible to
the organizer, or to a profile holding an active (`confirmed`/`waitlisted`)
booking on that event. `open_play` events are unaffected (any club member
sees them, as today).

### Booking (who can add a player to a game)

`assert_players_bookable` gains a check: for `invite_only` events, the
**caller** (not the player being added) must be host/co-organizer of the
club. This blocks members from self-booking or bringing others onto a
private game through any existing booking path — the only way in is the
organizer's "Invite" action. Waitlist auto-promotion is unaffected, since it
reassigns an existing booking's table rather than adding a new player.

### Inviting an existing club member to a game

Mechanically unchanged from today's "Bring someone": the organizer picks a
roster member and table, and it commits a booking immediately. The only
change is who's allowed to do it:

| Action | Open play game | Invite-only game |
|---|---|---|
| Invite an existing member (books them immediately) | Any attendee (unchanged) | Organizer only |
| Invite a guest (non-member, via link) | Organizer only | Organizer only |

Guest invites are always organizer-only regardless of game mode, because
they also grant full club membership — matching the existing
`club_invites_insert_organizer` rule for club invites today.

### Accepting a game-tied invite

`accept_club_invite` is extended: after creating the `club_members` row
(unchanged), if `event_id` is set it also attempts to seat the guest at that
event — full seat if available, otherwise waitlisted, using the same seating
logic `commit_booking` uses. If the event has since been cancelled or ended,
membership is still created but the seating step is skipped rather than
failing the whole join.

### Attendee-list privacy for invite-only games

A non-organizer's visibility into *other* bookings on an `invite_only` event
is itself restricted:

- They always see their own booking/status.
- They see **all** bookings for the event (full table/roster view) only
  once they themselves have a booking with a table assigned — being seated
  unlocks the whole list, not just their own table.
- Until then (accepted but not yet placed, or still waitlisted), they see
  no other names and no table compositions — just an aggregate headcount via
  a small security-definer function (`event_accepted_count(event_id)`,
  counting active bookings) that anyone who can see the event may call.
- `open_play` events are unaffected — current full visibility stays as-is.
- Organizer always sees everything.

## UI/UX

- **Club setting**: in `app/clubs/[id]/index.tsx`'s existing organizer-only
  actions block (alongside "Create an invite link," "Import a roster,"
  "Venues"), a new control — "New games default to: Open play / Invite-only."
- **Per-game override**: on the create/edit event form, a toggle defaulting
  to the club's setting, editable by the organizer at creation or later.
  Switching an existing event's mode is always allowed; it never affects
  existing bookers (they keep their booking and thus their visibility) —
  it only changes who can newly see or join from that point on.
- **"Bring someone" → "Invite"**: same button/component
  (`BringSomeoneSheet`), relabeled. For an open-play game, behavior and
  visibility of the button are unchanged (any attendee sees it, roster-only
  picker). For an invite-only game, only the organizer sees the button at
  all, and the sheet also offers a guest-link option (generates a
  `club_invites` row with `event_id` set, 30-day expiry, same share-link UI
  pattern as today's club invites).
- **Not-yet-placed invitee view** (invite-only games only): instead of table
  cards, they see their own status plus a note, e.g. *"8 people have
  accepted. You won't see who else is playing until you're placed on a
  table."* Once seated, the view becomes identical to the normal event
  screen (full tables, full roster) — same as an open-play game.
- **Guest acceptance**: guest taps the link → existing join flow
  (`app/join/[token].tsx`) → becomes a club member (unchanged) → also
  auto-seated at the tied event (or waitlisted) → lands on that event's
  screen.

## Edge cases

- **Switching an event's mode after bookings exist**: allowed freely in
  both directions, no blocking, no data changes — the visibility/booking
  rules above handle both automatically (see per-game override above).
- **Un-inviting someone**: same as cancelling their booking today — they
  lose visibility immediately, since visibility is booking-based. No new
  mechanism needed.
- **Guest invite to a full private game**: falls onto the existing waitlist
  exactly like any other booking; auto-promotion later is unaffected (see
  booking enforcement above).
- **Guest invite accepted after the event was cancelled/ended**: membership
  is still created; seating step is skipped (see "Accepting a game-tied
  invite" above).
- **Draft events**: unaffected — "Invite" is already only reachable from a
  published event's screen, same as "Bring someone" today.

## Testing

- RLS: non-member, member-without-booking, member-with-unplaced-booking,
  member-with-table, and organizer, each queried against an `invite_only`
  event's `events` and `bookings` rows — confirm exactly the access matrix
  above.
- Booking RPCs: confirm a non-organizer member cannot `propose_booking`/
  `commit_booking` themselves or anyone else onto an `invite_only` event;
  confirm organizer can.
- `accept_club_invite`: confirm event-tied invite seats the guest (full
  seat and waitlist-fallback cases), confirm cancelled/ended event skips
  seating without failing membership creation, confirm existing
  event-id-null invites are unaffected.
- UI: settings toggle only visible/editable to host/co-organizer; per-game
  override defaults correctly and is independently editable; "Invite" button
  visibility matches the permission matrix; not-yet-placed invitee sees
  headcount-only note and no roster; placement unlocks full view.
