# MahjHero Events & Scheduling — Design

**Date:** 2026-08-22
**Plan:** V1 plan 3 of 6, following [foundation & identity](2026-08-01-mahjhero-v1-design.md)
(plan 1) and clubs & membership (plan 2).
**Parent spec:** [2026-08-01-mahjhero-v1-design.md](2026-08-01-mahjhero-v1-design.md) —
sections 5 (Events and seating), 8 (Permissions), 9 (Error handling), 10 (Testing).

---

## Goal

A club stops being a roster and starts having a calendar. A host creates a game —
one-off or recurring — says where it is and how many tables it seats, and every
member sees it. Seat booking is plan 4; this plan builds the thing seats will
attach to.

## Scope

**In.** Event creation, recurring series with a club-local rule that survives DST,
per-event tables with skill tiers and capacity, venues that vary per occurrence,
cancellation, and a read-only event view for members.

**Out, and deliberately so.** Booking, RSVP, waitlist, "need a 4th", check-in,
reminders, and broadcasts. Every one of them belongs to a later plan and none of
them is prefigured here with placeholder state.

### The plan 3 / plan 4 boundary

A member can see an event and cannot take a seat in it. The event screen lists the
tables with their tiers and seat counts and offers no booking affordance and no
"coming soon" badge — badges like that age badly and plan 4 is next.

The alternative — hiding events from members until booking exists — was rejected.
It would leave the schema, the RLS, and the DST arithmetic unexercised by real
people right up until the moment booking depends on all three. A "going" toggle as
a stopgap was also rejected: the parent spec is explicit that booking a seat *is*
the RSVP, so a second attendance concept would create member data plan 4 has to
migrate or throw away.

---

## Decisions locked during brainstorming

| Decision | Choice | Why |
|---|---|---|
| Member visibility | Events read-only to members from day one | Exercises the subsystem before booking depends on it |
| Recurrence format | Narrow structured columns, not RFC 5545 RRULE | Postgres has no RRULE expander; the alternative is plpgsql or an Edge Function with a JS library, bought for expressiveness a mahjong club will not use |
| Horizon filling | `pg_cron` calling a plpgsql function | No Edge Function, no secrets, no HTTP; pgTAP tests it by calling it. Establishes the scheduled-work pattern reminders and the waitlist sweep both need |
| Table setup | Host enters a number of tables; every table seats 4 | Headcount is the pain; the tiered model stays real underneath and tiers are editable per table afterwards |
| Occurrence edits | Per-field overrides, not whole-row detach | A host who moves one week to a different hall changed the address, not the schedule |
| Series edits vs. overrides | Skip overridden fields by default; one opt-in toggle applies anyway | The host decides, and the default is the safe one |
| Recurrence shape | Immutable — changing it ends the series and starts a new one | See "Why the rhythm cannot be edited" below |
| Venue | Required on every event; defaulted from the series | A club may play in several places, and which place is not optional information |
| Writes | No client writes to any of the three tables; `security definer` functions only | The lesson of `club_members_insert_self` (see plan 2) |

---

## Data model

Three tables and three enums, all club-scoped.

```
event_status     : draft | published | cancelled
skill_tier       : beginner | intermediate | advanced | mixed
series_frequency : weekly | biweekly | monthly_nth_weekday
```

`skill_tier` is a new type rather than a reuse of `skill_level`, because a table
can be `mixed` and a person cannot.

### `event_series` — the rule, never an instant

| Column | Notes |
|---|---|
| `club_id` | `→ clubs(id) on delete cascade` |
| `title`, `venue` | both `not null`, both non-empty by check constraint |
| `notes` | `not null default ''` |
| `frequency` | `series_frequency` |
| `weekday` | `smallint`, 0–6, Sunday = 0 — matches both `extract(dow …)` and JS `getDay()` |
| `nth_week` | `smallint`, 1–5 or −1 for last. Non-null exactly when `frequency = 'monthly_nth_weekday'`, enforced by check |
| `start_time` | `time` — club-local wall clock |
| `duration_minutes` | `int not null default 180` |
| `table_count` | `int not null default 1` — the default table config |
| `starts_on` | `date` — also the anchor for `biweekly` |
| `ends_on` | `date null`; null means open-ended |
| `materialized_through` | `date null` — how far the horizon is filled |
| `created_by`, `created_at` | |

**The series does not store a timezone.** It reads `clubs.timezone`. Copying it
here would mean a club that corrects its timezone has to correct it again in every
series, and would eventually disagree with itself.

### `events` — the concrete, bookable row

Carries `club_id`, a nullable `series_id` (a one-off event is simply an event with
no series), `title`, `venue` (`not null`, non-empty), `notes`, `starts_at` and
`ends_at` as `timestamptz`, `status`, `created_by`, and two columns the recurrence
rule needs:

- **`occurrence_date`** — the club-local date this row was generated for. A partial
  unique index on `(series_id, occurrence_date) where series_id is not null` makes
  materialization idempotent: running it twice inserts nothing the second time, and
  a cancelled week is never resurrected, because its row still occupies the slot.
  A check constraint keeps `series_id` and `occurrence_date` null or non-null
  together.
- **`overrides text[] not null default '{}'`** — which fields a host has changed on
  this occurrence specifically. Constrained by check to
  `{title, venue, notes, starts_at}`. The `starts_at` key means "this
  occurrence's time was set by hand" and guards **both** instants, so a series
  edit to `duration_minutes` skips it too — otherwise a hand-set 6:30–9:30 week
  would keep its start and silently take the series' new length.

`unique (id, club_id)` exists solely as the target of the composite foreign key
below.

### `event_tables`

`label`, `skill_tier` (default `mixed`), `capacity` (`int not null default 4`,
checked 1–8), and `position` (`unique (event_id, position)`, used for ordering and
for generating "Table 1…n").

It carries `club_id`, per the parent spec's rule that every club-scoped table does,
and the consistency is enforced structurally rather than by trigger:

```sql
foreign key (event_id, club_id) references public.events (id, club_id)
  on delete cascade
```

A table row whose `club_id` disagrees with its event's is not merely unlikely, it
is unrepresentable.

---

## Time, timezones, and DST

Every occurrence instant is derived, never stored by the client:

```sql
starts_at := (occurrence_date + start_time) at time zone club_timezone
ends_at   := starts_at + make_interval(mins => duration_minutes)
```

Because the wall clock is resolved against the zone *at that date*, "Tuesdays at
7pm" stays 7pm across both shifts. A fixed UTC offset would put a whole club at the
venue an hour early, twice a year.

Two pathological cases get documented behaviour and tests rather than discovery in
production:

- **Spring-forward gap.** A start time inside the skipped hour does not exist.
  Postgres resolves it forward. Tested against real 2027 shift dates.
- **Fall-back repeat.** A start time inside the repeated hour is ambiguous.
  Postgres picks the first (still-DST) instance. Tested likewise.

Neither is reachable by a club that plays in the evening, which is why the correct
response is a test that pins the behaviour, not a feature that resolves it.

**Club timezone changes rewrite future occurrences.** A trigger on
`clubs.timezone` recomputes `starts_at`/`ends_at` for every future, non-cancelled
occurrence that has not overridden `starts_at`. A club correcting New York to
Chicago must not end up with new events right and every existing one an hour wrong.

---

## Materialization

`public.materialize_event_series(horizon_days int default 42)` — plpgsql,
`security definer`, pinned `search_path`, the same shape as `create_club` and
`accept_club_invite`.

For each series that has not ended, it generates occurrence dates from
`greatest(starts_on, materialized_through + 1)` through `current_date +
horizon_days`, inserts events `on conflict do nothing`, creates `table_count`
tables of 4 at tier `mixed` for each inserted event, and advances
`materialized_through` to `least(horizon_end, ends_on)`.

Occurrence dates by frequency:

- **weekly** — every date matching `weekday`.
- **biweekly** — the first matching date on or after `starts_on`, then every 14
  days. Anchored on the series, so it cannot drift.
- **monthly_nth_weekday** — the *n*th `weekday` of each month; `-1` means the last.
  A month with no 5th Tuesday produces nothing that month rather than falling back
  to the 4th, which is what "the 5th Tuesday" means.

It is called two ways:

1. **Nightly by `pg_cron`**, keeping roughly six weeks bookable.
2. **Synchronously, in the same transaction as series creation and series edits.**
   A host who creates a series and sees no games has watched the feature fail,
   whatever happens at 3am.

Idempotency comes from the partial unique index, so two overlapping runs cannot
duplicate an occurrence — the concurrency question is answered by a constraint
rather than by locking discipline.

### The `pg_cron` risk

`pg_cron` has never been used in this repository. It requires
`shared_preload_libraries` support that may differ between the local stack and the
hosted project, and the failure mode is a migration that works in one place and not
the other.

This gets the treatment the component-test-harness plan gave RNTL: **a spike task
that proves it on both before anything depends on it.** The function ships either
way — it is ordinary SQL and can be invoked by hand or by a later Edge Function —
so only the schedule is at risk, and only the schedule waits.

---

## Series edits and per-field overrides

### Editing one occurrence

An organizer edits a single event's title, venue, notes, or time. Each field they
actually change is added to that row's `overrides`. Nothing else about the row
changes and the series is untouched.

Cancelling an occurrence sets `status = 'cancelled'` and is **not** an override.
It is a different kind of statement and is treated as one everywhere below.

### Editing the series

Editable: `title`, `venue`, `notes`, `start_time`, `duration_minutes`,
`table_count`, `ends_on`.

For each field changed, the edit propagates to every **future, non-cancelled**
occurrence whose `overrides` does not contain that field. Past occurrences are
history and are never rewritten.

If any future occurrence does hold an override, the edit screen shows one toggle:

> ☐ Also apply to the 2 events you've changed — *Marie's on 9 Sep, 6:30pm on 23 Sep*

Naming them where there are three or fewer; a count alone beyond that. Ticking it
applies the edit to those occurrences too **and removes the edited fields from
their `overrides`**. Fields not touched by this edit keep their overrides. So a
host who overrode both venue and time on one week, then edits the series' time with
the toggle on, gets the new time and keeps the venue.

Cancelled occurrences are never touched, with or without the toggle. Un-cancelling
a week by ticking a box would be a nasty surprise.

**`table_count` is the exception:** changing it affects only occurrences
materialized *after* the edit. Existing events' tables will carry bookings from
plan 4 onward, and silently adding or removing tables under live bookings is a
plan 4 problem that cannot be designed correctly while bookings do not exist.

### Why the rhythm cannot be edited

`frequency`, `weekday`, `nth_week`, and `starts_on` are immutable. Changing the
rhythm means ending the series and starting a new one; the UI offers this as
"Change the schedule" and states how many future occurrences it cancels.

Editing a rule in place requires cancelling occurrences on dates the old rule
produced, generating occurrences on dates the new one produces, and then deciding
what happens to a customised week stranded on a date that no longer exists in
either. That is a class of bug, bought for an action a club takes approximately
never. If hosts report friction, this is a cheap decision to revisit.

---

## Permissions

A new `public.is_club_organizer(club uuid)` mirrors `is_club_member` —
`security definer`, `stable`, pinned `search_path` — returning true for an active
`host` or `co_organizer`. It exists for the same reason `is_club_member` does: a
policy that asked the question directly would recurse.

**Authenticated clients hold `select` on these three tables and nothing else.**
Every mutation goes through a `security definer` function whose first statement
checks `is_club_organizer`. This is the parent spec's "known footgun" taken
seriously, and it is the shape plan 2 arrived at the hard way after
`club_members_insert_self` proved that a `with check` constraining *who* a row is
about says nothing about *which club* it belongs to.

Read policies:

- `events` — `is_club_member(club_id)` and (`status <> 'draft'` or
  `is_club_organizer(club_id)`).
- `event_series`, `event_tables` — `is_club_member(club_id)`.

Functions: `create_event`, `update_event`, `cancel_event`, `create_event_series`,
`update_event_series`, `end_event_series`, `add_event_table`,
`update_event_table`, `remove_event_table`, `materialize_event_series`.

Table operations are granular rather than a single wholesale "replace the table
list", because plan 4 attaches bookings to `event_tables.id` and a replace would
orphan them.

Two pieces of hard-won hygiene from plan 2 apply to every object created here:

- `alter default privileges` now grants new tables **nothing** to `authenticated`
  and full DML to `service_role`. Each table's grants must therefore be written
  out verb-for-verb against its policies — `grant select … to authenticated`,
  `grant select, insert, update, delete … to service_role` — and never `all`,
  which includes `TRUNCATE`, which RLS does not filter.
- Every function gets `revoke execute … from public, anon` before its `grant`. A
  null `proacl` means EXECUTE to PUBLIC, and "harmless because the body checks" is
  one refactor from exploitable.

---

## Screens

Four routes, built from the existing primitives (`Screen`, `Card`, `Button`,
`TextField`, `TimeField`, `Tag`, `SkillLevelPicker`).

**`app/clubs/[id]/index.tsx`** — gains an **Upcoming** section above the roster:
date, time, venue, table count, one card per event, all future
events soonest first. A club runs a handful at a time, so there is no paging and no
all-events route to build. Organizers get "New event".
Members with no upcoming events see a plain line, not an error.

*This screen also carries the spacing bug logged in `todo.md`* — club cards and the
secondary button render as adjacent siblings with no gap. Fixed here, in the layout
rather than as a one-off margin, using `space[…]` from `lib/theme`, with the clubs
visual baselines regenerated in the same PR.

**`app/clubs/[id]/events/new.tsx`** — title, date, start time, duration (default
3h), venue, notes, number of tables, and Repeats: never / weekly / every 2 weeks /
monthly on the *n*th weekday, with an optional end date.

Two details that matter:

- Choosing a repeat previews **the next three dates** — "Tue 25 Aug, Tue 1 Sep,
  Tue 8 Sep" — computed client-side in `lib/events.ts` from the same rule the SQL
  implements. A host should see what they are committing to before committing.
- The venue field offers the club's **recent distinct venues** as tap-to-fill
  suggestions, from a `distinct venue` query over that club's events. No locations
  table; a club rotating between three halls gets what it needs from the data it
  already has.

**`app/clubs/[id]/events/[eventId].tsx`** — when, where, notes, and the tables with
tiers and seat counts. Organizers additionally get edit, cancel, per-table tier
editing, and add/remove table. **Capacity is not editable in this plan** —
`update_event_table` sets label and tier only. Every table seats 4; the column and
its 1–8 check exist for the club that eventually turns up with a five-player
table. A series-linked event shows that it belongs to one,
and shows a quiet marker on any field it has overridden.

**`app/clubs/[id]/events/[eventId]/edit.tsx`** — the scope choice ("this event" /
"the whole series") appears only when the event belongs to a series. The
overridden-occurrences toggle appears only when there is something for it to apply
to.

`lib/events.ts` follows the `lib/clubs.ts` conventions exactly: explicit column
lists, exported row types, and the never-rejects convention returning `null` on
failure so screens render an `ErrorBanner` rather than crashing.

---

## Error handling

- **A series with no occurrences is unreachable.** Creation materializes in the
  same transaction; if materialization fails, the series is not created.
- **Double materialization** is prevented by constraint, not by scheduling
  discipline.
- **Cancelling an event** sets status only. Booking cascades, promotion-offer
  voiding, and attendee notification are plan 4 and plan 6 respectively, and are
  named here so their absence is a documented boundary rather than an oversight.
- **A club timezone change** rewrites future non-overridden occurrences by trigger.
- **A deleted series** (`on delete set null` on `events.series_id`) leaves its
  occurrences standing as ordinary one-off events. Cancelling a club's games
  because a rule was tidied up would be worse than an orphan.

---

## Testing

Weighted to where this can actually be wrong.

**pgTAP `fixtures/` (local — needs `auth.users` writes):**

- Cross-club adversarial reads and writes on all three tables, including through
  every `security definer` function.
- Organizer-only enforcement: a plain member calling each mutation function is
  refused.
- Materialization idempotency — run twice, assert one row.
- A cancelled occurrence is not resurrected by a subsequent run.
- Per-field override propagation: skipped by default, applied with the toggle,
  other overrides preserved, cancelled occurrences untouched in both modes.
- **DST against real 2027 shift dates**, including the spring-forward gap and the
  fall-back repeat.
- The club-timezone-change trigger, including that it skips overridden occurrences.
- `monthly_nth_weekday` in a month with no 5th Tuesday.

**pgTAP `portable/` (local and hosted):** grants and function ACLs asserted
directly. These drift on the hosted project with no migration to review — which is
exactly how plan 2's `TRUNCATE` hole survived a full green suite.

**Vitest:** `lib/events.test.ts` for the pure recurrence preview, including the
missing-5th-weekday case and the biweekly anchor; schema-contract coverage for the
new columns and JSON shape.

**Component + Playwright:** the four screens, with visual baselines at 375 and
1440, plus the regenerated clubs baselines from the spacing fix.

---

## Risks and open items

1. **`pg_cron` availability** on the local stack versus the hosted project. Spiked
   before anything depends on it; the function ships regardless.
2. **No Edge Function infrastructure exists yet.** This design deliberately needs
   none. Reminders and broadcasts will, and this is where that bill comes due.
3. **`event_tables` semantics under bookings.** Add and remove are granular so plan
   4 can add the "what happens to the people sitting there" rules without
   restructuring.
4. **Immutable recurrence shape** may frustrate a host who wants to change the
   rhythm without ending the series. Cheap to revisit; expensive to get wrong now.
5. **Calendar export (ICS/RRULE)** is not built. The structured columns can
   generate an RRULE on demand whenever it is wanted.
6. **Nothing here has run on a physical device**, consistent with every plan so far.

## Not in this plan

Booking, seat selection, book-with-friends, the waitlist, "need a 4th",
cancellation cascades onto bookings, check-in, event reminders, host broadcasts,
guest attendance, a drafts UI, and calendar export.
