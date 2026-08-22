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
per-event tables with skill tiers and capacity, a venue master with typeahead
select-or-create, venues that vary per occurrence, cancellation, and a read-only
event view for members.

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
| Venue storage | A `venues` master row referenced by id, not free text | The same community centre hosting three clubs should be one thing, not three spellings |
| Venue scope | Global rows; `visibility` defaults to `club` | A member's home must never land in a directory built for public discovery |
| Venue ownership | `owner_club_id`; only that club's organizers may edit | Answers "Club A renames the hall Club B plays in" structurally rather than in a policy written later |
| Writes | No client writes to any of the four tables; `security definer` functions only | The lesson of `club_members_insert_self` (see plan 2) |

---

## Data model

Four tables and four enums. Three of the tables are club-scoped; `venues`
deliberately is not.

```
event_status     : draft | published | cancelled
skill_tier       : beginner | intermediate | advanced | mixed
series_frequency : weekly | biweekly | monthly_nth_weekday
venue_visibility : club | public
```

`skill_tier` is a new type rather than a reuse of `skill_level`, because a table
can be `mixed` and a person cannot.

### `venues` — the only table here that crosses clubs

| Column | Notes |
|---|---|
| `name` | `not null`, non-empty by check |
| `address_line`, `locality`, `region`, `postal_code` | all nullable text |
| `visibility` | `venue_visibility not null default 'club'` |
| `owner_club_id` | `not null → clubs(id)` — the club that created it |
| `archived_at` | `timestamptz null` — hidden from typeahead, still resolves on past events |
| `created_by`, `created_at` | |

**`visibility` defaults to `club`.** A venue is private to the club that added it
until someone deliberately shares it. This is not a nicety: a great deal of mahjong
is played in members' homes, and a venue master built with future public discovery
in mind must not quietly publish "Marie's place, 42 Elm Street" as a side effect of
scheduling Tuesday's game.

**`owner_club_id` is the edit boundary.** Only organizers of the owning club may
edit or archive a venue, including a public one. Without it, the first host to
misspell a shared community centre's name gets to rename it for every other club
using it, and there is no principled way to say who wins.

**Venues are never deleted, only archived.** Past events point at them, and a club's
history should not develop holes because a hall closed.

**Duplicate control:** a unique index over `(lower(trim(name)), coalesce(lower(trim(locality)), ''))`
**restricted to `visibility = 'public'`**. Private club venues are free to collide —
two clubs each having their own "Community Hall" is correct — while the shared set
stays merge-free without a merge tool existing.

**Not built now, and not precluded:** `claimed_by`, `claimed_at`, and anything to do
with venue-side accounts or paid placement. Adding them is an additive migration
against a stable venue id. The roadmap parks billing explicitly, and the typeahead
earns its place on product grounds without it.

### `event_series` — the rule, never an instant

| Column | Notes |
|---|---|
| `club_id` | `→ clubs(id) on delete cascade` |
| `title` | `not null`, non-empty by check constraint |
| `venue_id` | `not null → venues(id)` — the default venue for the series |
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
no series), `title`, `venue_id` (`not null → venues(id)`), `notes`, `starts_at` and
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
  `{title, venue_id, notes, starts_at}`. The `starts_at` key means "this
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

Editable: `title`, `venue_id`, `notes`, `start_time`, `duration_minutes`,
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

**Authenticated clients hold `select` on all four tables and nothing else.**
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
`update_event_table`, `remove_event_table`, `materialize_event_series`,
`create_venue`, `update_venue`, `archive_venue`, `search_venues`.

**`venues` is the exception to the uniform club-scoped policy, and the one to read
twice.** Its select policy is `visibility = 'public' or is_club_member(owner_club_id)`
— the first cross-club read in this schema. Its write functions check
`is_club_organizer(owner_club_id)`, *not* merely that the caller organizes some
club. Every RLS bug this project has had has been a tenancy bug, and this is the
table where the next one would live.

`search_venues(club uuid, query text)` returns the caller's own club venues and
public venues matching `ilike '%query%'`, own club first, non-archived only,
limited to 20. Plain `ilike` rather than `pg_trgm`: the public set starts empty and
a club has a handful of venues, so an extension dependency would be bought for
nothing. A trigram index is the upgrade when the shared set is large enough to
need one.

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

Five routes and one new component, built from the existing primitives (`Screen`,
`Card`, `Button`, `TextField`, `TimeField`, `Tag`, `SkillLevelPicker`).

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
- The venue field is a **typeahead over the venue master** (see below): it
  searches as the host types, lists the club's own venues above public ones, and
  offers "Add <what you typed>" when nothing matches. A club rotating between three
  halls picks; a club playing somewhere new adds it in the same field.

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

**`components/VenuePicker.tsx`** — a new primitive, since two screens need it and
it is the only genuinely novel interaction in this plan. It wraps `TextField`,
debounces `search_venues`, lists results grouped "This club" then "Public", and
offers "Add <what you typed>" as the last row when nothing matches exactly. Adding
opens an inline form: name required, address fields optional, and a plainly-worded
"Other clubs can use this venue" switch that is **off by default** and captioned
with what turning it on means.

**`app/clubs/[id]/venues.tsx`** — a small management screen reachable from the club,
listing the club's venues with edit and archive. It exists because a typeahead that
can only create is a one-way ratchet: a host who fat-fingers a name at 11pm has no
way to fix it, and the misspelling then appears on every event forever.

`lib/events.ts` and `lib/venues.ts` follow the `lib/clubs.ts` conventions exactly:
explicit column lists, exported row types, and the never-rejects convention
returning `null` on failure so screens render an `ErrorBanner` rather than
crashing.

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
- **An archived venue** disappears from the typeahead but still resolves on every
  event that already references it. Archiving is not deletion and never orphans a
  past game.
- **A venue turned public cannot be turned private again** once another club has
  used it. Retracting it would break that club's events, so the screen says so
  before the switch is flipped rather than after.

---

## Testing

Weighted to where this can actually be wrong.

**pgTAP `fixtures/` (local — needs `auth.users` writes):**

- Cross-club adversarial reads and writes on all four tables, including through
  every `security definer` function.
- **Venue visibility, tested from both sides:** Club B cannot read Club A's
  `club`-visibility venues by any path, including `search_venues`; Club B *can*
  read Club A's public ones; and Club B cannot edit or archive a public venue Club
  A owns.
- The public-venue duplicate index rejects a second "St Mary's Hall, Newton" while
  two clubs each keeping a private "Community Hall" both succeed.
- An archived venue is absent from `search_venues` and still resolves on an event
  that references it.
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

**Component + Playwright:** the five screens plus `VenuePicker`, with visual
baselines at 375 and 1440, and the regenerated clubs baselines from the spacing
fix. The picker's component test covers the case that matters — typing a name that
partially matches offers both the match and "Add", and the sharing switch is off
when the inline form opens.

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
5. **Duplicate public venues will still accumulate.** The unique index catches
   identical names in the same locality and nothing else; "St Mary's Hall" and
   "St. Marys Parish Hall" are the same building to a human and two rows to
   Postgres. A merge tool is the answer and is not built here — but the damage is
   bounded, because nothing depends on venue identity yet.
6. **The venue master is the first cross-club read in this schema.** It is called
   out in the permissions section and covered from both sides in tests, and it is
   where I would look first if a tenancy bug appears.
7. **Venue claiming is a business model with no evidence behind it yet.** The
   entity shape keeps it available; committing engineering to it before a venue has
   ever asked would be building on a guess.
8. **Calendar export (ICS/RRULE)** is not built. The structured columns can
   generate an RRULE on demand whenever it is wanted.
9. **Nothing here has run on a physical device**, consistent with every plan so far.

## Not in this plan

Booking, seat selection, book-with-friends, the waitlist, "need a 4th",
cancellation cascades onto bookings, check-in, event reminders, host broadcasts,
guest attendance, a drafts UI, and calendar export.

On venues specifically: claiming, venue-side accounts, paid placement or any other
monetization, duplicate merging, geocoding, maps, and a public venue directory.
This plan builds the entity those would need and none of the mechanism.
