# MahjHero Check-In — Design

**Date:** 2026-08-24
**Status:** Approved for implementation planning
**Plan:** V1 plan 5 of 6 — the last unbuilt V1 area
**Parent spec:** [2026-08-01-mahjhero-v1-design.md](2026-08-01-mahjhero-v1-design.md)

---

## Goal

Give a club organizer, standing at the door with a phone in one hand, the answer to
the only question that matters at 7:02pm: **who is here, who is definitely not
coming, and who is still unaccounted for** — broken down by table, because that is
what decides whether they collapse table 3 or go hunting for a substitute.

Give a member a one-tap way to say "I'm here" or "I can't make it" without navigating
anywhere, because plan 4 refuses every seat mutation once a game has started and a
member who cannot make it currently has literally nothing to tap.

## Scope

### In

- A per-event `check_in_required` flag, inherited from the series, defaulting off.
- An attendance record per person per event: `arrived`, `no_show`, or no record at all.
- An organizer door screen, grouped by table, with a summary line.
- Organizer-recorded walk-ins for anyone on the club roster.
- Member self check-in and self-reported no-show, on both the landing screen's
  "Your games" row and the event screen.
- One notification: a member's self-reported no-show tells the club's organizers.

### Out

| Item | Why |
|---|---|
| **Offline queue-and-sync** | Deferred to its own plan. See [Deferred: offline](#deferred-offline) — this is a change to the parent V1 spec and is recorded there too. |
| **A home screen** | Follow-up. Check-in lands on the existing landing screen; a real home screen wants more than check-in on it and designing it around check-in alone would produce the wrong screen. |
| **Members seeing each other's arrival state** | Deliberate. Turns an operational record into a published judgment about who was late. Wants a host asking for it first. |
| **Attendance driving seating** | Permanently refused, not deferred. See below. |
| **Guest / non-member attendance, standalone attendance stats** | Already deferred indefinitely on the roadmap. Nothing here changes that. |

### The plan 4 boundary

Every booking mutation plan 4 built — `book`, `cancel`, host place, host move, host
remove, `promote_waitlist`, `accept_promotion_offer` — raises `event already started`
(errcode `23514`) once `starts_at <= now()`. At the door, **seating is frozen**.

Check-in does not punch through that, and this is a rule rather than a limitation.
A seat freed mid-game frees nothing: the waitlisted member who might have taken it
left home an hour ago. A no-show marked at 7:02 that auto-released a seat would be
worse than the spreadsheet it replaces.

So **recording attendance and allocating seats are different jobs.** A walk-in
occupying a chair is a physical fact, not a booking. The host still arranges chairs
the way they always have; check-in records what happened.

## Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | Check-in is a **live door tool and a durable record**, but never mutates seating | The pain research identified is live; the seating freeze is plan 4's rule |
| 2 | **Both** host-recorded and member self check-in ship in plan 5 | Both are named in the parent spec's role table |
| 3 | Check-in is **opt-in per event**, inherited from the series | A two-table game of eight does not need an app to track attendance |
| 4 | **Explicit `no_show`**, not merely absence | "Hasn't walked in yet" and "phoned to say they're not coming" drive opposite decisions |
| 5 | The door list is **confirmed bookings plus organizer-recorded walk-ins** | Covers the waitlisted hopeful and the unbooked member with one mechanism |
| 6 | Writes open at `starts_at - 1h`; close at `ends_at` for members, **`ends_at + 24h` for organizers** | A host who cannot fix Tuesday's list on Wednesday stops believing the record |
| 7 | The door list is **grouped by table** | The host's decision is per-table; alphabetical order corresponds to nothing in the room |
| 8 | A member's self-reported no-show **notifies the organizers** | Otherwise the member reasonably believes they have told someone, and they have not |
| 9 | Arrival state is **organizer-visible only** | A member sees their own state and nobody else's |

## Data model

### `attendance_state`

```sql
create type public.attendance_state as enum ('arrived', 'no_show');
```

Two states, not three. A "running late" state was considered and rejected: it changes
nothing the host does differently from "not here yet", and it decays into a lie the
moment the player arrives or doesn't.

### `check_ins`

```sql
create table public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  club_id     uuid not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  state       public.attendance_state not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),

  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  unique (event_id, profile_id)
);
```

Four shapes carry the design:

1. **No `booking_id`.** The row is keyed on `(event_id, profile_id)`. A walk-in has no
   booking to hang a record off, and keying on the person makes the walk-in the same
   row shape as everyone else rather than a special case. It also means the record
   survives a booking being cancelled out from under it before the start.

2. **`unique (event_id, profile_id)` makes the write idempotent by construction.** A
   replayed write cannot duplicate because there is nowhere for a second row to go.
   This is the one piece of the parent spec's offline commitment kept in plan 5.

3. **`recorded_at` is caller-supplied, defaulting to `now()`,** and the upsert applies
   only when it is *newer* than the stored value. Online this is invisible. It is
   precisely what a later offline queue needs: a write that sat in a phone's queue for
   ten minutes must not clobber a decision the host has made since. One comparison,
   and the difference between adding a queue later and redoing plan 5 later.

4. **Absence of a row means "not determined."** It is never backfilled to `no_show`. A
   host who tried check-in for twenty minutes and gave up would otherwise generate a
   night of fabricated no-shows. Absence of a judgment is not a judgment.

Every club-scoped table carries `club_id`, and the composite foreign key to
`events (id, club_id)` makes a row whose club disagrees with its event's
unrepresentable rather than merely unlikely — the same shape plan 4 uses throughout.

### The opt-in flag

`check_in_required boolean not null default false` on **both** `event_series` and
`events`, and `'check_in_required'` added to the `events_overrides_known_keys` check
constraint.

This follows plan 3's established pattern exactly: series are templates that
materialize into events, and `overrides` marks which fields a host hand-edited on one
occurrence so a later series edit skips them. A weekly club ticks the box once on the
series; every occurrence inherits it; a host turning it off for one quiet week is not
stomped the next time they edit the series.

Per-event-only was rejected because it makes a weekly host re-tick a box forever,
which they will not do. A club-level default was rejected because it adds a third
inheritance source when the series already *is* the recurring-intent object, and the
only games it would govern are one-offs — exactly the games small enough not to need
check-in.

### RLS and grants

`check_ins` gets a **self-only `select` policy**: a member reads their own row and
nothing else. That is the entire member read path — no function needed.

`authenticated` gets **no DML on `check_ins` at all**. Every write goes through a
`security definer` function, matching every other table in this repo.

> Supabase grants ALL on every table in `public` to `authenticated` by default, and
> ALL includes TRUNCATE, which is **not subject to RLS**.
> `supabase/tests/database/portable/grants.test.sql` is what stands between a new
> table and that hole reopening. `check_ins` must be added to it.

## Write path

Two `security definer` functions, granted to `authenticated`, are the only things that
write `check_ins`.

```
record_attendance(target_event uuid,
                  target_profile uuid,
                  new_state public.attendance_state,
                  occurred_at timestamptz default now())

clear_attendance(target_event uuid, target_profile uuid)
```

`record_attendance` upserts on `(event_id, profile_id)`, applying only when
`occurred_at` is newer than the stored `recorded_at`. `clear_attendance` deletes the
row, returning that person to "not determined" — the undo for both roles.

### The guard ladder

**Both functions run the same ladder.** `clear_attendance` is a write like any other:
it refuses outside the window, refuses on an event that never asked for check-in, and
refuses a member clearing somebody else's row.

In order. The first guard is the tenancy check, and its position is load-bearing:

1. **The caller is an active member of the event's club.** RLS does not protect a
   `security definer` function. The parent spec names this as the most likely site of
   a tenancy bug; plan 4's booking function is the precedent. It fails first, before
   anything about the event is revealed.
2. **The event exists and its status is `published`.** A cancelled game has no
   attendance to record.
3. **`check_in_required` is true.** If the host did not ask for check-in, these
   functions refuse. The feature does not exist for that event.
4. **The role split**, below.

| | Organizer (`is_club_organizer`) | Member (self) |
|---|---|---|
| **Whom** | any active club member | only themselves |
| **Window** | `starts_at - 1h` → `ends_at + 24h` | `starts_at - 1h` → `ends_at` |
| **Requires a booking** | no — this is the walk-in path | yes, a **confirmed** booking |
| **States** | `arrived`, `no_show`, clear | `arrived`, `no_show`, clear |

Failures raise with errcode `23514`, matching plan 4's `event already started`, so
client error handling stays uniform.

Two rules worth stating plainly:

- **Self check-in requires a confirmed booking; walk-ins are organizer-recorded only.**
  Otherwise any member of the club could mark themselves present at a game they never
  booked, and the walk-in path — a host observing a physical fact — becomes
  self-service.
- **The 24-hour tail is organizer-only.** A member's "I'm here" is an assertion about
  the present moment. Retroactive correction is record-keeping, and that is the host's
  job.

There is no geofencing and none is planned, so the time window is the only guard there
is on self check-in. This is accepted: the cost of a member checking in from their sofa
is a wrong row in one club's attendance record, and the host can correct it.

### The one notification

When a **member** self-reports `no_show`, `record_attendance` queues
`notification_outbox` rows to the club's organizers.

- New `outbox_kind` value: `attendance_declined`.
- Dedupe key: `attendance_declined:<event_id>:<profile_id>:<recipient_id>`, so an
  undo-and-redo does not tell the host twice.
- Nothing else notifies. Not ordinary arrivals — that is a stream of noise on a busy
  night — and not a host's own marking, which the host already knows about.
- **`clear_attendance` sends nothing.** A member who declines and then undoes has
  already had "Jane can't make it" delivered; there is no recalling it, and a second
  message saying she can after all is worth less than the confusion it causes. The
  host sees the live truth on the door screen, which is the surface that matters.

`mute_need_a_fourth` is the only mutable kind in the system and this is not it, so
there is no preferences work.

> **Migration constraint.** `alter type ... add value` cannot be used by any statement
> in the same transaction that adds it, and each migration file is one transaction.
> The new enum value needs **its own migration file that does nothing else**, exactly
> as `20260826000000` does for plan 6's two kinds.

Delivery needs the same four touchpoints every plan 6 kind has: the enum, the
`OutboxKind` union in `supabase/functions/deliver-notifications/types.ts`, a body in
`templates/bodies.ts`, and a render-context entry.

## Read path

### `event_attendance(target_event uuid)`

`security definer`, organizer-gated, one row per person: the union of confirmed
bookings and `check_ins` rows. A caller who is not an organizer of the event's club
**raises**, rather than receiving an empty set — an empty set is indistinguishable
from "nobody has arrived yet" and would read as a working screen.

Returns `profile_id`, `display_name`, `skill_level`, the table (`event_table_id`,
label, position), `booking_status` (null identifies a walk-in), and `state` /
`recorded_by` / `recorded_at` (null `state` = not determined).

It re-asks the organizer question itself for the same reason `event_seating` does:
the `profiles` policy has been self-only since `20260822180000`, so a client-side
join to `profiles` returns the caller's own name and NULL for everybody else —
silently, with no error. Names are published deliberately, by a function whose return
type is the exposure surface.

**Reads are not window-bound; only writes are.** An organizer can open the list months
later and see what happened; the controls are simply disabled once the tail closes. A
record you cannot look at afterwards is not a record.

### `my_upcoming_bookings()` grows four OUT columns

`check_in_required`, `check_in_state`, `check_in_opens_at`, `check_in_closes_at`.

Returning the window as explicit timestamps, rather than letting the client compute
`starts_at - 1h`, keeps that constant in SQL only — the client just compares. The
server still enforces the window authoritatively; the client's copy decides only
whether to draw the control.

> **Migration constraint.** Adding OUT columns to a `returns table` function requires
> drop-and-recreate, not `create or replace` (Postgres raises 42P13: "cannot change
> return type of existing function"). `20260825080000` hit exactly this and left the
> note, including that a dropped function's ACL does not survive recreation so the
> grant must be restated, and that `grants.test.sql` checks the *signature string* —
> unchanged here — so its allowlist needs no edit for this function.

## Screens

### `app/clubs/[id]/events/[eventId]/check-in.tsx` — new route, the door screen

Organizer-only. Top to bottom:

- **A summary line**: "12 of 16 here · 1 not coming · 3 unaccounted · 2 walk-ins".
  The one number the host wants at a glance, above the detail.
- **A `TableCard` per table**, rendered exactly as the event screen renders them, each
  row carrying a three-way control: here / not coming / clear.
- **An "any table" group** for confirmed bookings never placed at a table.
- **A walk-ins group**, and an add-walk-in picker over the club roster, excluding
  anyone already on the list — a confirmed booking or an existing `check_ins` row —
  so the same person cannot be added twice and hit the unique constraint.

Grouped by table because the host's actual question is per-table. A status-grouped
list answers "how many are missing" but not "missing *from where*", leaving the host
to hold the table assignments in their head while standing in the room.

This is a separate route rather than another section on the event screen because
`app/clubs/[id]/events/[eventId]/index.tsx` is already 1015 lines. The door list lives
in its own file precisely so that file does not become 1400.

### `app/clubs/index.tsx` — "Your games"

The landing screen. `app/index.tsx` is a 103-line redirect resolver with no UI; it
sends a signed-in member to `/clubs`, which shows "Your clubs" and "Your games".

The "Your games" row for a game whose check-in window is open grows the same
`CheckInControl` — **for confirmed bookings only.** `my_upcoming_bookings()` returns
waitlisted rows too, and a waitlisted member has no seat and no self check-in right;
their row shows its waitlist position exactly as it does today. **A member opens the app and taps once, with no navigation** — which
is the point. When a real home screen is built, it reuses this component and these
columns unchanged.

### `app/clubs/[id]/events/[eventId]/index.tsx`

Two small additions and no more: an organizer entry point to the door screen, and the
member's own check-in control.

### `components/CheckInControl.tsx`

The three-way control, used by the door rows, the "Your games" row, and the event
screen, so the paths cannot drift.

### Event forms

The create-event, edit-event, and series forms each get a "Require check-in" `Toggle`.
That is the only place `check_in_required` is set.

### `lib/attendance.ts`

Typed wrappers over the three RPCs, with unit tests, mirroring `lib/bookings.ts`.

## Error handling

- **Out-of-window writes** are refused by the database, not merely hidden by the
  client. The client's window copy governs whether a control is drawn; the server's
  governs whether a write lands.
- **A stale write** — one carrying an older `recorded_at` than the stored row — is
  silently a no-op rather than an error. It represents a decision that has since been
  superseded, and surfacing it as a failure would be a lie.
- **A failed attendance fetch degrades only its own section.** The door screen's
  summary and rows fail independently of the event's seating data, following the
  pattern `app/clubs/index.tsx` already uses to keep a failed bookings fetch from
  taking down "Your clubs".

## Testing

Weighted to where a mistake actually costs something. The `fixtures/` vs `portable/`
split is not a style choice: `fixtures/` tests create signed-in members by inserting
into `auth.users`, which the hosted CLI role cannot do.

| Suite | Covers |
|---|---|
| `fixtures/check_in.test.sql` | The full guard ladder. Tenancy refusal first (a member of club A holding club B's event uuid gets nothing), both window boundaries for each role, the role split (a member cannot touch another profile; a member gets no 24h tail; a member without a confirmed booking is refused), the walk-in path, `check_in_required = false` refuses everything, a cancelled event refuses, and the staleness rule. |
| `fixtures/check_in_rls.test.sql` | Adversarial, both directions. A member reads their own row and no one else's. `authenticated` has no DML and no TRUNCATE on `check_ins`. |
| `portable/grants.test.sql` | The three new functions added to the hardcoded allowlist, asserted in both directions, or the suite fails. |
| `fixtures/check_in_notifies.test.sql` | A member's self-reported no-show queues to organizers only; a host's own marking queues nothing; undo-and-redo does not double-notify. |
| `fixtures/event_series_edits.test.sql` (extended) | `check_in_required` inherits series → occurrence, and a hand-set occurrence survives a later series edit. |
| `lib/schema-contract.test.ts` | The new RPCs crossed for real against the local stack. The `attendance_state` enum and the two window timestamps are exactly the serialization drift this test exists to catch. |
| Vitest + component tests | `lib/attendance.test.ts`; the door screen's grouping and summary counts; `CheckInControl`; additions to `your-games.test.tsx` for the inline control and its window gating. |
| `e2e/visual.spec.ts` | Baselines for the new door screen at both widths. |

## Deferred: offline

The parent V1 spec commits to offline-tolerant check-in in writing:

> Check-in cannot assume a live connection: the roster is cached on arrival, writes
> queue locally and sync when the network returns, and check-in is idempotent so a
> replayed queue cannot duplicate. This is the one place optimistic local writes are
> accepted — a host at the door watching a spinner will abandon the app.

**Plan 5 ships online-only.** This was decided during brainstorming and is a
deliberate change to the parent spec, recorded here and in the roadmap rather than
left to be discovered later. The stated risk — clubs meeting in community centres and
clubhouses with unreliable wifi — is real and unaddressed until the follow-up plan
lands.

Two things in this design exist to make that follow-up additive rather than a rewrite:

- `unique (event_id, profile_id)` makes a replayed write idempotent by construction.
- Caller-supplied `recorded_at` with a newest-wins upsert means a queued write cannot
  clobber a newer decision.

No new infrastructure exists for offline anywhere in the app today — AsyncStorage is
present only for auth persistence — so the follow-up plan owns the cache, the queue,
and the sync loop in full.

## Risks and open items

1. **Self check-in is unverifiable.** No geofencing, none planned. The time window is
   the only guard. Accepted; the host can correct the record.
2. **Adoption is the real risk, not correctness.** A host who does not tap produces a
   night of "not determined", which is honest but useless. This is why absence is never
   backfilled — a record that fabricates no-shows would be worse than an empty one.
3. **`ends_at + 24h` is a guess.** It is long enough for "the next morning" and short
   enough that the record settles. Cheap to change; it lives in one place in SQL.
4. **The new outbox kind adds a fifth reason to touch `deliver-notifications`.** Plan 6
   left that surface well-tested; this plan must not erode it.
