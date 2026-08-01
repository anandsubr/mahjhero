# MahjHero V1 — Design Specification

**Date:** 2026-08-01
**Status:** Approved for implementation planning
**Scope:** V1 only. Later phases are recorded in [../../roadmap.md](../../roadmap.md).

---

## 1. What MahjHero is

A multi-club community platform for **American Mahjong** players. Club organizers run
their events through it; members find games, book seats — including alongside specific
friends — and turn up.

The competitive position is documented in [../../research/market-analysis.md](../../research/market-analysis.md).
In short: the incumbent (Bam Good Time / Mahjic) handles club logistics competently.
MahjHero's wedge is the social layer nobody has shipped — booking seats *with named
friends* — plus a native Android presence, which no competitor currently offers.

## 2. V1 scope

### In

| Area | Features |
|---|---|
| **Identity** | Account, profile, self-reported skill level. One profile, travels across clubs. |
| **Club** | Roster, invite link, CSV import, host + co-organizer roles, public/private flag |
| **Events** | Create, recurring series, skill-tiered tables, per-table capacity |
| **Seating** | RSVP-as-booking, seat selection, book-with-friends, waitlist with auto-promotion, "need a 4th", cancellations |
| **Check-in** | On-arrival check-in, offline-tolerant |
| **Comms** | Event reminders, host broadcast to all members or event attendees; push + email |

### Explicitly out of V1

Scoring, leaderboards, and the content library (V2). In-club chat, public club
directory, and SMS (V3). Billing in either direction, tournament brackets, cross-club
global rating, automatic table assignment by skill, guest/non-member attendance,
standalone attendance statistics, and online gameplay — all deferred indefinitely
pending evidence they're needed.

### Rationale for this line

The research identified scheduling as the pain that makes organizers quit: headcount,
the collapsed table, the weekly substitute hunt. Nobody described scoring as painful,
and in-club chat is already well served by the WhatsApp groups clubs currently use.
V1 is therefore the smallest build that could make a club abandon its spreadsheet,
and it centres on the one feature no competitor offers.

## 3. Product decisions

| Decision | Choice | Reasoning |
|---|---|---|
| **Tenancy** | Multi-club platform | Any organizer creates a club; players may belong to several |
| **Cross-club identity** | Shared profile, club-local records | One account and skill level follow the player; leaderboards and history stay per-club. A global competitive rating is a separate product bet, and an established open rating system already occupies that ground. |
| **Joining a club** | Both private and public, per-club flag | Public: the invite link admits instantly. Private: the link raises a join request the host approves. |
| **Content** | Original + host-authored only | The NMJL card is copyrighted; the app never reproduces it. MahjHero seeds original beginner and strategy material, hosts add club-specific content, and members are pointed to NMJL to buy their own card. |
| **Money** | None in V1 | Neither platform fees nor club dues. The club is the tenant boundary, so billing attaches later without migration. |
| **Platform** | Expo/React Native — iOS, Android, web | Android is the clearest unclaimed position; the web target removes install friction for less technical members. |

## 4. Architecture

**Client.** One Expo/React Native codebase targeting iOS, Android, and web. The web
build serves `mahjhero.app`, so an invite link opens a working app in a browser —
installing is an upgrade, never a prerequisite.

**Backend.** Supabase:

- **Postgres** — all relational data. Clubs, events, tables, and seats have genuine
  referential structure and hard capacity limits.
- **Auth** — email magic link, phone OTP, Google, and Sign in with Apple. No passwords.
- **Row-Level Security** — the tenant boundary, enforced in the database rather than
  in application code.
- **Realtime** — live seat availability, so concurrent viewers aren't working from
  stale counts.
- **Edge Functions** — CSV parsing, broadcast fan-out, scheduled jobs.

**Scheduled work.** `pg_cron` firing Edge Functions.

**Delivery.** Expo push service (wrapping APNs and FCM) for push; Resend for email.

**Governing principle.** The database owns authorization and capacity, not the app.
With RLS plus a transactional booking function, a stale or hostile client cannot
double-book a seat or read another club's roster. This matters because one codebase
ships to three platforms and not every client will be current.

### Authentication and identity linking

Verified email is the identity key. Any provider that verifies the same address
resolves to the existing profile. Duplicate identities are unusually damaging here —
a member would appear twice on the roster with bookings split across both profiles,
and the host would have no way to tell which to remove.

Offering Google sign-in on iOS triggers App Store Review Guideline 4.8, which requires
an equivalent privacy-preserving option. Sign in with Apple is therefore a V1
requirement, not an optional extra.

## 5. Data model

### People and clubs

| Table | Key fields |
|---|---|
| `profiles` | id (= auth user id), display_name, skill_level, avatar_url, timezone, notify_channel (push/email/both), mute_need_a_fourth, quiet_hours_enabled (default true), quiet_hours_start (default 21:00), quiet_hours_end (default 08:00) |
| `clubs` | id, name, slug, visibility (public/private), timezone, reminder_offsets (default `[24h, 2h]`), created_by |
| `club_members` | club_id, profile_id, role (host/co_organizer/member), status — unique per (club_id, profile_id) |
| `club_invites` | club_id, token, email, phone, display_name, skill_level, invited_by, expires_at, accepted_at, accepted_by |

`club_invites` carries `display_name` and `skill_level` deliberately. A CSV import
creates invite rows, so the host sees a populated roster with names and tiers before
anyone accepts. Importing forty members into an apparently empty club reads as failure.

### Events and seating

| Table | Key fields |
|---|---|
| `event_series` | club_id, title, venue, recurrence rule, default table config, materialized_through |
| `events` | club_id, series_id (nullable), title, starts_at, ends_at, venue, notes, status (draft/published/cancelled), created_by |
| `event_tables` | event_id, label, skill_tier (beginner/intermediate/advanced/mixed), capacity (default 4) |
| `booking_groups` | created_by, size, preferred_table_id, allow_split, status (confirmed/waitlisted/cancelled), waitlist_position |
| `bookings` | group_id, event_id, event_table_id (**nullable** — see "any table" below), profile_id, status |
| `promotion_offers` | group_id, event_table_id, offered_seat_count, expires_at, responded_at |
| `checkins` | event_id, profile_id, checked_in_at, checked_in_by |
| `broadcasts` | club_id, event_id (nullable), author_id, body, audience, sent_at |
| `notification_log` | recipient_id, notification_type, subject_key, sent_at |

Notes on the shape:

- **Groups do not reference a table; bookings do.** A split group spans several tables,
  so the table belongs on the individual booking. The group remains the social unit —
  who booked together and what they wanted — while each booking records where that
  person actually sits.
- **Every booking belongs to a group, including solo bookings** (a group of one). One
  code path rather than two.
- **Recurring events materialize** into concrete `events` rows roughly six weeks ahead
  rather than being computed on read; bookings need something real to attach to.
- **One confirmed booking per person per event**, enforced by constraint.
- **`bookings.event_table_id` is nullable.** A null means "any table" — the member is
  confirmed for the event but not yet placed. Such bookings consume no table capacity
  until a host assigns them, and are excluded from "need a 4th" detection.
- **`club_invites.skill_level` is the host's suggestion, not authoritative.** On
  acceptance it seeds the profile only if that profile has no skill level set. A
  member's own setting always wins thereafter.

## 6. Seating and booking mechanics

### RSVP is seat booking

There is no separate RSVP step. Booking a seat *is* the RSVP. Members who don't care
where they sit book an "any table" slot that the host places later. Two separate
concepts would double the state space for negligible benefit.

### Booking with friends: propose → confirm → commit

Togetherness is a **preference, not a constraint**. `allow_split` defaults to **on**,
presented as a plainly-worded toggle ("Split us up if we can't sit together"), so the
common case is a single tap.

1. `propose_booking(event, players[], preferred_table, allow_split)` returns a plan:
   all seats at one table, a specific split across tables, or no fit → waitlist.
2. If the plan is a split, the app shows exactly who sits where and asks for
   confirmation.
3. `commit_booking(plan)` executes atomically.

Commit **re-validates inside the transaction** rather than trusting the proposal —
seats can disappear between the two calls. It succeeds entirely or fails entirely;
there is no partial write. On failure the app re-proposes against fresh state and
shows what changed.

All seat allocation runs through this Postgres function via RPC. The client never
writes to `bookings` directly. This makes the race condition impossible rather than
unlikely.

### Booking on behalf of friends

Seats are **secured immediately**, and each named friend is notified ("Jane booked you
at Table 2 on Tuesday") with a one-tap decline that frees the seat. Securing the seats
is the entire point of the feature; the notification gives the person actually
attending an exit that doesn't require texting the booker.

Only existing club members can be added to a group. Guests are out of V1 scope.

### Waitlist

Waitlisted groups hold a `waitlist_position` and are promoted FIFO, with these rules:

- **Whole group fits** → auto-promote and notify. No consent needed; they get what
  they asked for.
- **Partial fit, `allow_split` = true** → send a timed offer to the group's booker
  ("2 of your 3 seats are available"). Offered seats are held for **2 hours, or until
  event start, whichever comes first**, then pass to the next eligible group.
- **Partial fit, `allow_split` = false** → skip, and the group keeps its position.

A group skipped for not fitting retains its place rather than being pushed back.
Without the offer expiry, one unresponsive member would freeze a seat indefinitely
while the club plays a player short — precisely the failure this product exists to
prevent.

### "Need a 4th"

Fires when a table holds 3 confirmed seats and 1 empty, within **48 hours** of start.
Notifies club members who match that table's skill tier, are not already booked for
that event, and have not muted these alerts. First to claim takes the seat; the alert
resolves for everyone else immediately.

If still unfilled inside **12 hours**, it widens to adjacent skill tiers — an
intermediate player at a beginner table beats a collapsed table. The host may promote
it manually at any time.

## 7. Notifications and scheduled work

| Job | Frequency | Purpose |
|---|---|---|
| Reminders | every 15 min | Events crossing a reminder threshold; fan out to booked members |
| Waitlist sweep | every 5 min | Expire stale promotion offers, promote next eligible group |
| Need-a-4th | every 15 min | Detect tables at 3 of 4 inside the alert window |
| Materialize series | nightly | Keep ~6 weeks of recurring events bookable |

**Reminder cadence.** Default 24 hours before (leaving time to cancel and free the
seat) and 2 hours before (the leaving-the-house nudge). Overridable per club, since
a morning club and an evening club want different timing.

**Broadcasts.** The host writes once; a fan-out job delivers to the full roster or to
that event's booked members. Long messages go by email; short ones go push-first with
email fallback.

**Cross-cutting rules:**

1. **Every send is logged and deduped** on (recipient, type, subject). A job retry or
   restart cannot double-send. The same reminder arriving twice reads as broken.
2. **Quiet hours are a personal setting, not a club one.** Each member controls whether
   they apply and over what window, in **their own** timezone — defaulting to on,
   9pm–8am. A club has no business imposing one member's schedule on another.

   **Exemption:** a reminder for an event starting *during* the member's quiet window,
   or within two hours after it ends, is sent regardless. Otherwise a club that plays
   at 9am would have its 2-hour reminder held until 8am and delivered after it stopped
   being useful. Suppressible sends (need-a-4th alerts, broadcasts) queue until the
   window closes.
3. **Per-member preferences** — channel choice (push / email / both) and a separate
   mute for need-a-4th alerts, which are the highest-frequency, lowest-urgency class.
   Reminders for events you have booked are not mutable.

`reminder_offsets` stays on the club: the host decides how far ahead their events
remind. When that send actually lands is the member's business.

## 8. Permissions and tenancy

| Role | Capabilities |
|---|---|
| **host** | Everything below, plus club settings, promoting and demoting co-organizers, deleting the club |
| **co_organizer** | Create/edit/cancel events, broadcast, CSV import, check members in, move bookings between tables, manage the waitlist. Cannot change roles or delete the club. |
| **member** | Book and cancel own seats, book a group with friends, self check-in, view roster and events |

Every club-scoped table carries `club_id`. The RLS policy is uniform: rows are visible
only to active members of that club, and writable only by the roles above. A profile
is global but club data is not — a member of two clubs sees both rosters and no others.

**Known footgun.** The booking function runs `SECURITY DEFINER` because it needs
elevated rights for the atomic capacity check, which means **RLS does not protect it**.
The function must verify club membership as its first statement. This is the most
likely site of a tenancy bug and is covered by explicit tests.

## 9. Error handling

**Booking commit conflicts.** Re-validate in-transaction; succeed or fail entirely,
never partially. On failure, re-propose against fresh state and show what changed.

**Venue connectivity.** Clubs meet in community centres and clubhouses with unreliable
wifi. Check-in cannot assume a live connection: the roster is cached on arrival, writes
queue locally and sync when the network returns, and check-in is idempotent so a
replayed queue cannot duplicate. This is the one place optimistic local writes are
accepted — a host at the door watching a spinner will abandon the app.

**CSV import.** Validate the whole file before writing anything, then show a preview:
row count, per-row errors, and which addresses already belong to members. Import only
on confirmation. Never partially import and never silently skip — a host who imports
40 and receives 34 has no way to find the missing 6.

**Time zones and DST.** Recurring events are stored as a club-local rule plus the
club's timezone, never as fixed UTC offsets. "Tuesdays at 7pm" stays 7pm local across
both shifts. Failure here puts an entire club at the venue an hour early, twice a year.

**Cascades.** Cancelling an event cancels its bookings, voids outstanding promotion
offers, and notifies everyone booked. Removing a member cancels their future bookings
and frees those seats. If a group's booker cancels, only their own seat is released —
the group and the other members' seats survive.

**Push failures.** Expired or revoked tokens mark the device stale and fall back to
email, so a member who reinstalls without re-granting permission still gets reminders.

## 10. Testing

Weighted toward risk rather than uniform coverage.

- **Booking function — concurrency tests at the database level.** Parallel transactions
  competing for the last seat; a group of three racing a solo booking; cancel-and-promote
  firing mid-commit. This is the one component where a race yields a wrong answer rather
  than an error.
- **RLS — adversarial tests.** Explicit assertions that a member of Club A cannot read
  or write Club B's roster, events, or bookings, including through the `SECURITY DEFINER`
  booking function.
- **Waitlist promotion — scenario tests.** Full fit; partial fit with split allowed;
  partial fit refused; offer expiry; skip-and-hold-position.
- **DST transition tests** against real shift dates.
- **One end-to-end journey:** host creates an event → imports a roster → member books
  with two friends → one declines → waitlist promotes → all check in.

UI unit tests beyond this are low value at this stage; the logic worth protecting lives
in the database.

## 11. Known risks and open items

These are real and unresolved. None blocks implementation planning, but each should be
tracked.

1. **Demand evidence is thin.** The market research rests substantially on the
   incumbent's own content marketing, and the direct competitor has only 6 App Store
   ratings. That is either an opening or a signal the market is small. Talking to
   practising club organizers before building far would materially de-risk this.
2. **Trademark is unverified.** "MahjHero" was cleared by web search only. A proper
   USPTO search is outstanding, and an active 2024 filing for "THE MAHJ CLUB" shows the
   niche is beginning to be defended.
3. **Sign in with Apple is mandatory** on iOS given Google sign-in (Guideline 4.8).
   Budget for it.
4. **The NMJL card cannot be reproduced.** The content area must be original or
   host-authored. A licensing conversation with the League is a possible later path,
   not a V1 dependency.
5. **Notification tolerance is assumed, not measured.** Need-a-4th alerts are opt-out
   on the assumption that this audience welcomes game-related notifications. Quiet
   hours and the per-category mute are the safeguards if that proves wrong.
