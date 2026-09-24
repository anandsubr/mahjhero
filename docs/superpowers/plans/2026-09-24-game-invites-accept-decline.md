# Game Invites (Accept / Decline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Invite" on the game screen from book-on-behalf into a real invitation: every other member a sender adds to a game (open play or invite-only) gets a pending `invited` booking that holds a seat (or, in a full game, promises a waitlist place) until they Accept or Decline, the sender or a host withdraws it, or the game starts — with notifications both ways and an Accept / Decline card on the invitee's dashboard.

**Architecture:** No new table. `booking_status` gains `invited`; `bookings` gains `invite_holds_seat boolean` (null on every non-invited row; `true` = the invite holds a seat at `event_table_id`, or an "any table" seat when that is null; `false` = the game was full when sent). A seat is TAKEN by `status = 'confirmed' or (status = 'invited' and invite_holds_seat)` — `table_free_seats`, `event_free_seats`, `need_a_fourth_stage` are widened to say so, and every other capacity reader inherits it. `commit_booking` books the sender as today and inserts everyone else as `invited` in the same group. Two new RPCs (`accept_booking_invite`, `withdraw_booking_invite`), `decline_booking` now also accepts invited rows, and a cron sweep (`close_started_invites`) closes invites left pending at kickoff. Four new `outbox_kind` values carry the emails. Reads: `event_seating` and `my_upcoming_bookings` return invited rows (with `invite_holds_seat`); on invite-only games a pending invite's identity is visible only to organizers, its sender and its invitee — enforced in `bookings_select_member`, mirrored in `event_seating`; the invite-only roster now unlocks on "confirmed" (with or without a table). The app adds held/"Invited" seats, Withdraw, the invitee banner, a "N playing · M invited" line, "Send invites" on the sheet, a dashboard game-invite card, and "Can't make it" in "Your games".

**Tech Stack:** Postgres/pgTAP (Supabase, `pg_cron`), Deno Edge Function templates (`deliver-notifications`), Expo Router / React Native (web), Vitest + Testing Library, Playwright visual baselines.

**Spec:** `docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md` (read it first). Where this plan and the spec's prose disagree, this plan carries the user-confirmed decisions of 2026-09-24 (P1–P8), which are restated inline where they apply.

## Global Constraints

- Branch: `feat/game-invites-accept-decline` (already checked out). Every commit goes on it; the branch merges to `main` only through the PR opened in Task 11.
- Migrations are **forward-only**. Never edit an applied migration file; to change a function, write a NEW migration with `create or replace` copying the LATEST definition. (`grep -lE "create (or replace )?function public.NAME\("` — not a bare `function public.NAME(` grep, which also matches revoke-only files such as `20260825061000`.) New migration timestamps in this plan run `20260924100000` … `20260924105000`, in task order.
- **One `alter type ... add value` per migration file**, alone in that file, and never used by any statement in the same file (a new enum label cannot be used in the transaction that adds it, and each migration file is one transaction). Every file that references `'invited'` or a new outbox kind comes after the file that adds it.
- **Restate revoke/grant after every `create`, `create or replace`, or `drop`+`create`,** matching that function's existing ACL (internal helpers: `revoke ... from public, anon, authenticated` and no grant; client RPCs: `revoke ... from public, anon` + `grant ... to authenticated`).
- **Every exit from `invited` nulls `invite_holds_seat` in the same UPDATE** (the check constraint `(status = 'invited') = (invite_holds_seat is not null)` refuses anything else), and every exit other than accept-into-a-held-seat also nulls `event_table_id` (accept, decline, withdraw, the start-of-game sweep, `cancel_event`, `cancel_booking_group`).
- `invited` counts toward: seat capacity / held seats, the one-active-row guard, invite-only event visibility, "is this seat free" for need-a-fourth, and `close_group_if_empty`'s "group still live". It does **not** count toward: headcount / `event_accepted_count`, "who's playing", waitlist promotion candidates, need-a-fourth recipients, reminders, broadcasts, threads, check-in / door list, and it never unlocks the invite-only roster.
- `booked_by_friend` stays in the `outbox_kind` enum and in the templates (legacy rows); nothing new writes it.
- Stage files **by explicit path only** — never `git add -A`, `git add .`, or `git commit -a`. Never stage or commit `CLAUDE.md` or anything under `social media assets/` (both are untracked on purpose).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- DB tests: `npm run test:db` (= `npx supabase test db --local`) runs every file under `supabase/tests/database`; apply new migrations first with `npx supabase db reset --local`. App tests: `npm test` (`TZ=America/New_York vitest run`); a single file with `npm test -- <path>`. Contract tests: `npm run test:contract` (needs the local stack up).
- Do not push migrations to the hosted project from this plan (`npx supabase db push` is out of scope); the PR description says the migrations still need applying to mahjhero-dev.

---

### Task 1: Schema — `invited` status, `invite_holds_seat`, four outbox kinds

**Files:**
- Create: `supabase/tests/database/portable/game_invites_schema.test.sql`
- Create: `supabase/migrations/20260924100000_booking_status_invited.sql`
- Create: `supabase/migrations/20260924100100_bookings_invite_holds_seat.sql`
- Create: `supabase/migrations/20260924100200_outbox_kind_booking_invited.sql`
- Create: `supabase/migrations/20260924100300_outbox_kind_booking_invite_accepted.sql`
- Create: `supabase/migrations/20260924100400_outbox_kind_booking_invite_withdrawn.sql`
- Create: `supabase/migrations/20260924100500_outbox_kind_booking_cancelled_by_member.sql`

**Interfaces:**
- Produces: `public.booking_status` = `confirmed | waitlisted | invited | cancelled | declined` (in that sort order).
- Produces: `public.bookings.invite_holds_seat boolean` with checks `bookings_invite_holds_seat_iff_invited` (`(status = 'invited') = (invite_holds_seat is not null)`) and `bookings_unheld_invite_has_no_table` (`invite_holds_seat is not false or event_table_id is null`).
- Produces: `bookings_one_active_per_person_idx` on `(event_id, profile_id) where status in ('confirmed', 'waitlisted', 'invited')`.
- Produces: `public.outbox_kind` values `booking_invited`, `booking_invite_accepted`, `booking_invite_withdrawn`, `booking_cancelled_by_member`. Consumed by Tasks 2–6.

- [ ] **Step 1: Write the failing schema test**

Create `supabase/tests/database/portable/game_invites_schema.test.sql` (portable: catalog reads only, no fixture writes, so it also runs against the hosted project):

```sql
begin;
set local search_path to extensions, public;

select plan(9);

-- Game invites (2026-09-24): a booking can be pending the invitee's answer.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'booking_status'),
  array['confirmed', 'waitlisted', 'invited', 'cancelled', 'declined'],
  'booking_status has invited, between waitlisted and cancelled');

select has_column('public', 'bookings', 'invite_holds_seat',
  'bookings has invite_holds_seat');
select col_type_is('public', 'bookings', 'invite_holds_seat', 'boolean',
  'invite_holds_seat is a boolean');
select col_is_null('public', 'bookings', 'invite_holds_seat',
  'invite_holds_seat is nullable -- null on every non-invited row');

select is(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'bookings_invite_holds_seat_iff_invited'),
  'CHECK (((status = ''invited''::booking_status) = (invite_holds_seat IS NOT NULL)))',
  'an invited row, and only an invited row, says whether it holds a seat');

select is(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'bookings_unheld_invite_has_no_table'),
  'CHECK (((invite_holds_seat IS NOT FALSE) OR (event_table_id IS NULL)))',
  'an invite that holds no seat names no table');

select ok(
  (select pg_get_indexdef(i.indexrelid)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'bookings_one_active_per_person_idx')
  like '%''invited''%',
  'one active booking per person per game counts a pending invite');

select ok(
  (select i.indisunique
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'bookings_one_active_per_person_idx'),
  'and is still unique');

select ok(
  (select array_agg(e.enumlabel::text)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outbox_kind')
  @> array['booking_invited', 'booking_invite_accepted',
           'booking_invite_withdrawn', 'booking_cancelled_by_member'],
  'outbox_kind carries the four game-invite kinds');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `game_invites_schema.test.sql` fails (the enum has no `invited`, the column and constraints do not exist). Every other file still passes.

- [ ] **Step 3: Write `20260924100000_booking_status_invited.sql`**

```sql
/*
 * Game invites (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md):
 * a booking can be pending the invitee's answer.
 *
 * Alone in its own migration, like 20260826000000's outbox kinds:
 * `alter type ... add value` cannot be used by any statement in the same
 * transaction that adds it, and each migration file is one transaction.
 * The column, check constraints and index that reference 'invited' come in
 * the next file. `if not exists` because `db reset` replays everything.
 * `after 'waitlisted'` only so the enum reads in the spec's order; nothing
 * orders by booking_status.
 */
alter type public.booking_status add value if not exists 'invited' after 'waitlisted';
```

- [ ] **Step 4: Write `20260924100100_bookings_invite_holds_seat.sql`**

```sql
/*
 * Game invites, schema half. 'invited' arrived alone in 20260924100000.
 *
 * invite_holds_seat is NULL for every non-invited row. For an invited row:
 *   true  -- the invite holds a seat: at event_table_id when that is set, or
 *            an "any table" seat counted at event level when it is null
 *            (commit_booking with an any-table group, or a held table the
 *            host has since removed -- remove_event_table unseats rather
 *            than ejects, exactly as it does a confirmed booking);
 *   false -- the game was full when the invite was sent. It holds nothing
 *            and therefore can never name a table; accepting it joins the
 *            waitlist.
 *
 * A seat is TAKEN by status = 'confirmed' OR (status = 'invited' and
 * invite_holds_seat). table_free_seats, event_free_seats and
 * need_a_fourth_stage are redefined to say so in 20260924101000.
 *
 * Every path that moves a row OUT of 'invited' (accept, decline, withdraw,
 * the start-of-game sweep, cancel_event and friends) must set
 * invite_holds_seat = null in the same UPDATE, or the first check below
 * refuses it.
 */
alter table public.bookings
  add column invite_holds_seat boolean;

alter table public.bookings
  add constraint bookings_invite_holds_seat_iff_invited check (
    (status = 'invited') = (invite_holds_seat is not null)
  ),
  add constraint bookings_unheld_invite_has_no_table check (
    invite_holds_seat is not false or event_table_id is null
  );

/*
 * One active booking per person per event now includes a pending invite:
 * a member already booked, waitlisted OR invited cannot be invited (or
 * book) again. Recreated, not altered -- a partial index's predicate
 * cannot be changed in place. No 'invited' rows exist yet, so the rebuild
 * cannot fail on existing data.
 */
drop index public.bookings_one_active_per_person_idx;
create unique index bookings_one_active_per_person_idx
  on public.bookings (event_id, profile_id)
  where status in ('confirmed', 'waitlisted', 'invited');
```

- [ ] **Step 5: Write the four outbox-kind migrations, one value per file**

`supabase/migrations/20260924100200_outbox_kind_booking_invited.sql`:

```sql
/*
 * One new kind, alone in its own migration -- same shape as
 * 20260827040000. `alter type ... add value` cannot be used by any
 * statement in the same transaction that adds it, and each migration file
 * is one transaction. `if not exists` because db reset replays everything.
 * Written by commit_booking (20260924102000) to each invitee.
 */
alter type public.outbox_kind
  add value if not exists 'booking_invited';
```

`supabase/migrations/20260924100300_outbox_kind_booking_invite_accepted.sql`:

```sql
/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by accept_booking_invite (20260924103000) to the sender. */
alter type public.outbox_kind
  add value if not exists 'booking_invite_accepted';
```

`supabase/migrations/20260924100400_outbox_kind_booking_invite_withdrawn.sql`:

```sql
/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by withdraw_booking_invite (20260924103000) to the invitee. */
alter type public.outbox_kind
  add value if not exists 'booking_invite_withdrawn';
```

`supabase/migrations/20260924100500_outbox_kind_booking_cancelled_by_member.sql`:

```sql
/* One new kind, alone in its own migration -- see 20260924100200.
 * Written by cancel_booking (20260924103000) to the sender when an accepted
 * invitee leaves the seat the sender secured for them. */
alter type public.outbox_kind
  add value if not exists 'booking_cancelled_by_member';
```

- [ ] **Step 6: Run the suite and watch it pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: all files pass, including `game_invites_schema.test.sql` (9/9). If the two `pg_get_constraintdef` strings differ only in parenthesization/casts from what your Postgres prints, copy the printed form into the test (the meaning is what is being pinned) — do not loosen it to `like '%invited%'`.

- [ ] **Step 7: Commit**

```bash
git add supabase/tests/database/portable/game_invites_schema.test.sql \
  supabase/migrations/20260924100000_booking_status_invited.sql \
  supabase/migrations/20260924100100_bookings_invite_holds_seat.sql \
  supabase/migrations/20260924100200_outbox_kind_booking_invited.sql \
  supabase/migrations/20260924100300_outbox_kind_booking_invite_accepted.sql \
  supabase/migrations/20260924100400_outbox_kind_booking_invite_withdrawn.sql \
  supabase/migrations/20260924100500_outbox_kind_booking_cancelled_by_member.sql
git commit -m "$(cat <<'EOF'
feat(db): invited booking status, invite_holds_seat, game-invite outbox kinds

A pending game invite is a bookings row with status 'invited'.
invite_holds_seat says whether it holds a seat (true) or was sent into
a full game (false); the one-active-row index now counts it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Capacity — a held invite takes its seat

**Files:**
- Create: `supabase/tests/database/fixtures/invite_capacity.test.sql`
- Create: `supabase/migrations/20260924101000_capacity_counts_held_invites.sql`
- Modify: `supabase/tests/database/fixtures/event_reminders.test.sql` (status-audit pin: no reminder for a pending invitee)

**Interfaces:**
- Consumes: Task 1's `invited` status, `invite_holds_seat`, and the widened one-active index.
- Produces (signatures unchanged, bodies widened): `table_free_seats(target_table uuid) returns int`, `event_free_seats(target_event uuid) returns int`, `need_a_fourth_stage(target_table uuid) returns text` — all count `status = 'confirmed' or (status = 'invited' and invite_holds_seat)` as taken; `announce_table_fourth(target_table uuid, at_stage text) returns int` never notifies anyone holding a pending invite to that game. All four stay internal (revoked from `public, anon, authenticated`).
- Unchanged on purpose (they read occupancy through the functions above, or never read bookings): `event_held_seats` (promotion offers only), `event_confirmed_seats` (literally confirmed), `event_capacity`, `seat_assignments`, `plan_seating`, `confirm_group_seats`, `promote_waitlist` (counts only `waitlisted` rows, so invited rows are never promotion candidates), `accept_promotion_offer`, `place_booking` (already refuses non-confirmed rows with `'booking not confirmed'`, so held seats are not movable), `update_event` / `update_event_series` / `update_event_table` (none has a booking-count capacity guard — lowering capacity below occupancy is allowed by design and `event_free_seats` floors at zero), `add_event_table`, `remove_event_table` (its unseat UPDATE has no status filter, so a held invite is unseated to table-null and keeps holding at event level; its `unseated` notice stays confirmed-only), `tables_needing_a_fourth`, `call_for_a_fourth`, `reset_event_to_series`.
- Known, intended consequence: a waitlisted group that also holds unheld invites is promoted by its `waitlisted` rows alone; `confirm_group_seats` flips the group to `confirmed` and leaves the invited rows `invited` (they move to their own solo group when accepted — Task 4). Do not "fix" this.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/invite_capacity.test.sql` (38 assertions):

```sql
begin;
set local search_path to extensions, public;

select plan(38);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),
  ('99999999-0000-0000-0000-000000000007', 'gina@example.com'),
  ('88888888-0000-0000-0000-000000000008', 'hank@example.com'),
  ('77777777-0000-0000-0000-000000000009', 'ivy@example.com'),
  ('66666666-0000-0000-0000-000000000010', 'jack@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1: assigned tables, Table 1 and Table 2 of four each (capacity 8).
-- E2: open seating, capacity 4, no tables.
-- E3: one table of four, for "need a fourth".
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'assigned_tables', null, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Open night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_seating', 4, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'assigned_tables', null, 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'mixed', 4, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

-- Alice booked herself onto Table 1 and invited Bob, Carol and Dan, whose
-- seats there are held.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000004',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

-- ---------------------------------------------------------------------
-- A held tabled invite fills its table.
-- ---------------------------------------------------------------------
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 0,
  'one confirmed booking and three held invites fill a table of four');

select results_eq(
  $$select event_table_id, seats from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 1,
      '7ab1e000-0000-0000-0000-000000000001', false)$$,
  $$values ('7ab1e000-0000-0000-0000-000000000002'::uuid, 1)$$,
  'placement passes over a table filled by held invites, even the preferred one');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'held tabled invites are taken seats at event level too');

-- ---------------------------------------------------------------------
-- An unheld invite (the game was full when sent) takes nothing.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'eeeeeeee-0000-0000-0000-000000000005',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false);

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'an unheld invite does not reduce the event''s free seats');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'nor any table''s');

-- ---------------------------------------------------------------------
-- The new checks and the widened one-active-row index.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000002',
            '99999999-0000-0000-0000-000000000007',
            'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false)$$,
  '23514', null,
  'an unheld invite cannot name a table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            '99999999-0000-0000-0000-000000000007',
            'aaaaaaaa-0000-0000-0000-000000000001', 'invited', null)$$,
  '23514', null,
  'an invited row must say whether it holds a seat');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            '99999999-0000-0000-0000-000000000007',
            '99999999-0000-0000-0000-000000000007', 'confirmed', true)$$,
  '23514', null,
  'a non-invited row carries no invite_holds_seat');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            'eeeeeeee-0000-0000-0000-000000000005',
            'eeeeeeee-0000-0000-0000-000000000005', 'confirmed')$$,
  '23505', null,
  'a pending invite is an active row: the invitee cannot also be booked');

-- ---------------------------------------------------------------------
-- A held "any table" invite reduces event free seats, no table's.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000006',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'ffffffff-0000-0000-0000-000000000006',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'a held any-table invite takes one of the event''s free seats');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'but no particular table''s');

-- ---------------------------------------------------------------------
-- Held seats are not movable.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000002',
                                '7ab1e000-0000-0000-0000-000000000002')$$,
  '23514', 'booking not confirmed',
  'even an organizer cannot move a held invite');

reset role;

-- ---------------------------------------------------------------------
-- promote_waitlist ignores invited rows.
--
-- Ivy and Jack take two seats at Table 2, leaving the event exactly one
-- free seat. Gina waits for Table 2, keep-together, with Hank as her
-- unheld invitee in the same group. If Hank counted, the group would want
-- two, not fit, and (keep-together) be skipped.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-000000000009',
   '7ab1e000-0000-0000-0000-000000000002');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000007',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   '77777777-0000-0000-0000-000000000009',
   '77777777-0000-0000-0000-000000000009'),
  ('b00c0000-0000-0000-0000-000000000008',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   '66666666-0000-0000-0000-000000000010',
   '77777777-0000-0000-0000-000000000009');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 1,
  'the event has exactly one free seat');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000007',
   '7ab1e000-0000-0000-0000-000000000002', false,
   'waitlisted', now() - interval '1 hour');

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000009',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000007',
   '99999999-0000-0000-0000-000000000007', 'waitlisted', null),
  ('b00c0000-0000-0000-0000-000000000010',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '88888888-0000-0000-0000-000000000008',
   '99999999-0000-0000-0000-000000000007', 'invited', false);

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000009'),
  'confirmed',
  'the waiting member is seated: her pending invitee is not part of the group''s size');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  'invited',
  'the invitee is not promoted with her');
select is(
  (select invite_holds_seat from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  false,
  'and still holds nothing');
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000003'),
  'confirmed',
  'a group whose only non-invited member is seated stops waiting');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'waitlist_promoted'
      and recipient_id = '88888888-0000-0000-0000-000000000008'),
  0,
  'the invitee is never told they were promoted');
select is(
  (select count(*)::int from public.promotion_offers
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  0,
  'and no partial offer was minted around the invited row');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the game is now full, held invites included');

-- Ivy is confirmed at Table 2; Table 1 is full of held invites.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000007',
                                '7ab1e000-0000-0000-0000-000000000001')$$,
  '23514', 'table full',
  'a confirmed member cannot be moved onto seats held by invites');

-- ---------------------------------------------------------------------
-- remove_event_table unseats a held invite without failing.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000001')$$,
  'a table with held invites at it can be removed');

reset role;

select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  'invited',
  'the held invite survives the table''s removal');
select is(
  (select invite_holds_seat from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  true,
  'and still holds a seat');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  null,
  'now at event level, like an unseated confirmed booking');
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status = 'invited' and invite_holds_seat),
  4,
  'no held invite was dropped (Bob, Carol, Dan, Fred)');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'the invitee is not sent an "unseated" notice (confirmed rows only, unchanged)');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'while the confirmed member at that table still is');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the over-subscribed game, held invites included, floors at zero');

-- ---------------------------------------------------------------------
-- Capacity on an open-seating game counts held invites.
--
-- update_event has no "below current occupancy" guard (only "at least
-- one"), so what is asserted is that the admission arithmetic after the
-- edit counts the held invite.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', null);

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000011',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000012',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000013',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false);

select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004',
          'eeeeeeee-0000-0000-0000-000000000005',
          'ffffffff-0000-0000-0000-000000000006']::uuid[], null, true)->>'outcome',
  'waitlisted',
  'three do not fit in capacity 4 with one confirmed and one held (the unheld invite is ignored)');
select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004',
          'eeeeeeee-0000-0000-0000-000000000005']::uuid[], null, true)->>'outcome',
  'seated',
  'two do');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      target_event => 'e2e2e2e2-0000-0000-0000-000000000002'::uuid,
      new_capacity => 2)$$,
  'the host lowers capacity to confirmed + held');

reset role;

select is(public.event_free_seats('e2e2e2e2-0000-0000-0000-000000000002'), 0,
  'after the edit the held invite fills the last seat');
select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004']::uuid[], null, true)->>'outcome',
  'waitlisted',
  'so a new booking waits');

-- ---------------------------------------------------------------------
-- Need a fourth: a held seat is occupied; invitees are not fourths.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000003');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000014',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000015',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000016',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000017',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'ffffffff-0000-0000-0000-000000000006',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', false);

select is(public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  'tier',
  'two confirmed and one held seat of four: the table needs a fourth');

select public.announce_table_fourth('7ab1e000-0000-0000-0000-000000000003', 'tier');

select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and recipient_id in ('dddddddd-0000-0000-0000-000000000004',
                           'ffffffff-0000-0000-0000-000000000006')),
  0,
  'nobody with a pending invite to the game, held or not, is asked to be the fourth');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'while an uninvolved member is');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'eeeeeeee-0000-0000-0000-000000000005',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

select is(public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  null,
  'a held last seat is occupied: no call for a fourth over it');

select * from finish();
rollback;
```

Fixture notes: `plan_seating`, `event_free_seats`, `table_free_seats`, `seat_assignments`, `need_a_fourth_stage`, `announce_table_fourth` and `promote_waitlist` are revoked from `authenticated`, so the file calls them after `reset role`, as `waitlist_promotion.test.sql` does. `update_event` has only an "at least one" capacity guard, so the open-seating block asserts that admission AFTER lowering capacity counts the held invite, not that the edit is refused.

Also pin the reminder half of the status audit (the spec's "reminders ignore `invited`"). `queue_event_reminders` (20260826080000) already filters `b.status = 'confirmed'` and does not change; this proves it. In `supabase/tests/database/fixtures/event_reminders.test.sql`:

1. `select plan(10);` → `select plan(11);`
2. Directly after the existing `insert into public.bookings ... ;` statement (the one ending with the waitlisted row), add:

```sql
-- Game invites: Alice holds a pending invite to tonight's game, seat
-- held. She is not coming until she accepts, so she is not reminded.
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat)
  values
  ('9409409e-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);
```

3. Directly after the first assertion (`'each crossed threshold queues one reminder per confirmed booking'`, whose expected `3` is unchanged), add:

```sql
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'a pending invitee gets no reminder -- reminders are for confirmed seats');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `invite_capacity.test.sql` fails on the free-seat counts (`table_free_seats` still reads 3, not 0, for one confirmed + three held), on `seat_assignments` choosing the preferred table, on `need_a_fourth_stage` over a held last seat, and on the need-a-fourth recipients. The check-constraint and index assertions already pass (Task 1).

- [ ] **Step 3: Write `20260924101000_capacity_counts_held_invites.sql`**

Each body is copied from its latest definition (`table_free_seats`, `event_free_seats`: `20260825000000_create_bookings.sql`; `need_a_fourth_stage`: `20260825050000_need_a_fourth.sql`; `announce_table_fourth`: `20260905150000_need_a_fourth_privacy.sql`) with only the occupancy predicate widened:

```sql
/*
 * Game invites: a pending invite that holds a seat TAKES that seat.
 *
 * A seat is taken by status = 'confirmed' OR (status = 'invited' and
 * invite_holds_seat) -- see 20260924100100. Four readers of occupancy
 * change, each copied verbatim from its latest definition with only that
 * predicate widened:
 *
 *   - table_free_seats (20260825000000): a held invite at a table fills it.
 *     seat_assignments, plan_seating, confirm_group_seats and
 *     place_booking all read per-table room through this, so none of them
 *     change.
 *   - event_free_seats (20260825000000): every held invite, tabled or
 *     "any table", is subtracted at event level. event_confirmed_seats and
 *     event_held_seats (promotion offers) keep their literal meanings; the
 *     invite term is its own subtraction here. plan_seating,
 *     promote_waitlist and accept_promotion_offer read admission through
 *     this, so none of them change.
 *   - need_a_fourth_stage (20260825050000): a held seat is occupied; the
 *     club is never called for a fourth over it.
 *   - announce_table_fourth (20260905150000): somebody with a pending
 *     invite to this game is not a fourth either.
 *
 * An UNHELD invite (the game was full when sent) takes nothing anywhere.
 *
 * All four signatures are unchanged, so all are `create or replace`; each
 * ACL is restated per the house rule.
 */

-- ---------------------------------------------------------------------------
-- table_free_seats
-- ---------------------------------------------------------------------------
create or replace function public.table_free_seats(target_table uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, t.capacity - (
    select count(*)::int from public.bookings b
    where b.event_table_id = t.id
      -- A held invite sits at its table exactly like a confirmed booking
      -- (game invites, 20260924100100). An unheld one never has a table.
      and (b.status = 'confirmed'
           or (b.status = 'invited' and b.invite_holds_seat))
  ))
  from public.event_tables t where t.id = target_table;
$$;

-- Internal, granted to nobody (20260825000000, 20260825061000).
revoke execute on function public.table_free_seats(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- event_free_seats
-- ---------------------------------------------------------------------------
/*
 * Floors at zero on purpose. Removing a table lowers capacity without
 * ejecting anybody, so an event can legitimately hold more confirmed
 * bookings than seats until the host sorts it out. That state admits
 * nobody new; it must not read as negative free seats.
 */
create or replace function public.event_free_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0,
    public.event_capacity(target_event)
    - public.event_confirmed_seats(target_event)
    - public.event_held_seats(target_event)
    -- Held invites, tabled or "any table" (game invites, 20260924100100).
    -- Kept out of event_confirmed_seats so "confirmed" still means
    -- confirmed, and out of event_held_seats, which is promotion offers.
    - (select count(*)::int from public.bookings
        where event_id = target_event
          and status = 'invited' and invite_holds_seat));
$$;

-- Internal, granted to nobody (20260825000000, 20260825061000).
revoke execute on function public.event_free_seats(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- need_a_fourth_stage
-- ---------------------------------------------------------------------------
/*
 * null when the table is not calling for anybody. 'tier' or 'wide'
 * otherwise. Deliberately says nothing about the 48-hour announcement
 * window: that is the cron job's business, and a host calling early is
 * asking to skip exactly that window.
 */
create or replace function public.need_a_fourth_stage(target_table uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.id is null then null
    when e.status <> 'published' then null
    when e.starts_at <= now() then null
    when t.capacity < 2 then null
    -- A seat held for a pending invite is occupied: never call the club
    -- for a fourth over it (game invites, 20260924100100).
    when (select count(*) from public.bookings b
          where b.event_table_id = t.id
            and (b.status = 'confirmed'
                 or (b.status = 'invited' and b.invite_holds_seat)))
         <> t.capacity - 1 then null
    when e.starts_at <= now() + interval '12 hours' then 'wide'
    else 'tier'
  end
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;
$$;

-- Internal (20260825050000, 20260825061000).
revoke execute on function public.need_a_fourth_stage(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- announce_table_fourth
-- ---------------------------------------------------------------------------
create or replace function public.announce_table_fourth(target_table uuid, at_stage text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t     record;
  told  int;
begin
  if at_stage not in ('tier', 'wide') then
    raise exception 'unrecognized stage: %', at_stage using errcode = '23514';
  end if;

  select tt.id, tt.event_id, tt.club_id, tt.label, tt.skill_tier
  into t
  from public.event_tables tt where tt.id = target_table;

  -- Never fan out for a private game. Belt-and-braces alongside the
  -- game_mode filter above: this function has two callers
  -- (announce_need_a_fourth, which now only ever reaches an open_play table
  -- via tables_needing_a_fourth, and call_for_a_fourth, the host's manual
  -- "call for a 4th now" button, which calls this directly with no such
  -- filter upstream of it).
  if (select e.game_mode from public.events e where e.id = t.event_id)
       = 'invite_only' then
    return 0;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select cm.profile_id, t.club_id, t.event_id, 'need_a_fourth',
         jsonb_build_object('event_table_id', t.id,
                            'table_label', t.label,
                            'stage', at_stage),
         'need_a_fourth:' || t.id::text || ':' || at_stage
           || ':' || cm.profile_id::text
  from public.club_members cm
  join public.profiles p on p.id = cm.profile_id
  where cm.club_id = t.club_id
    and cm.status = 'active'
    and not p.mute_need_a_fourth
    and public.tier_matches(t.skill_tier, p.skill_level, at_stage = 'wide')
    -- Somebody already coming to this game is not a fourth. Nor is somebody
    -- with a pending invite to it: they already have their own ask, and the
    -- one-active-row index would refuse them booking again anyway (game
    -- invites, 20260924100100).
    and not exists (
      select 1 from public.bookings b
      where b.event_id = t.event_id and b.profile_id = cm.profile_id
        and b.status in ('confirmed', 'waitlisted', 'invited'))
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  return told;
end;
$$;

-- Internal: security definer with no membership check of its own
-- (20260825050000, 20260825061000). 20260905150000 replaced it without
-- restating this; restated here per the house rule.
revoke execute on function public.announce_table_fourth(uuid, text)
  from public, anon, authenticated;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: every file passes, `invite_capacity.test.sql` 38/38, `event_reminders.test.sql` 11/11. `need_a_fourth.test.sql`, `bookings_schema.test.sql`, `bookings_commit.test.sql`, `waitlist_promotion.test.sql` and `event_disruption.test.sql` hold no invited rows and must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/database/fixtures/invite_capacity.test.sql \
  supabase/tests/database/fixtures/event_reminders.test.sql \
  supabase/migrations/20260924101000_capacity_counts_held_invites.sql
git commit -m "$(cat <<'EOF'
feat(db): a held game invite takes its seat

table_free_seats, event_free_seats and need_a_fourth_stage count
status = 'invited' and invite_holds_seat as occupied; announce_table_fourth
never asks someone with a pending invite to be the fourth.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Commit path — the sender is booked, everyone else is invited

**Files:**
- Modify: `supabase/tests/database/fixtures/bookings_commit.test.sql`
- Modify: `supabase/tests/database/fixtures/invite_only_booking_gate.test.sql`
- Create: `supabase/migrations/20260924102000_invite_commit_path.sql`

**Interfaces:**
- Consumes: Tasks 1–2 (`invited`, `invite_holds_seat`, `booking_invited` kind, held-seat capacity).
- Produces (signatures unchanged):
  - `assert_players_bookable(target_club uuid, target_event uuid, players uuid[]) returns void` — internal. Raises `'already booked'` (23514, detail = profile id) for a confirmed/waitlisted row and the NEW `'already invited'` (23514, detail = profile id) for an invited row.
  - `close_group_if_empty(target_group uuid) returns void` — internal. An `invited` row keeps a group alive; a `waitlisted` group with no `waitlisted` row left (only invites) becomes `confirmed` (`waitlisted_at` null) and any open offer it held is resolved (P5).
  - `booking_result(target_group uuid) returns jsonb` — same top-level keys (`group_id, outcome, split, waitlist_position, offer, placements`); each placement gains `status`; placements include invited rows; `outcome` is `'waitlisted'` for a non-waitlisted group with nothing confirmed, nothing held, and at least one unheld invite (sender not playing, game full), with `waitlist_position` null.
  - `commit_booking(target_event uuid, players uuid[], preferred uuid default null, allow_split boolean default true) returns jsonb` — the caller (if in `players`) is booked `confirmed`/`waitlisted` as before; every other player is `invited` in the same group, `booked_by` = caller: planner outcome `seated` → `invite_holds_seat = true`, `event_table_id` = the planner's table (null = any-table hold); outcome `waitlisted` → `invite_holds_seat = false`, no table. The group is `waitlisted` only when the outcome is waitlisted AND the caller is among `players`; otherwise `confirmed` with `waitlisted_at` null. Writes one `booking_invited` outbox row per invitee (payload `{booking_id, booked_by, holds_seat, event_table_id}`, dedupe `booking_invited:<booking id>`) and no `booked_by_friend`. Also refuses a null caller up front (`'not a member of this club'`, 42501).
  - `propose_booking` is unchanged: it plans the whole group and inherits the `'already invited'` refusal through `assert_players_bookable`.
- Known consequence (accepted): because only the sender's own row is ever `waitlisted`, `promote_waitlist` sizes a new group as at most one seat. "Wait together" (`allow_split = false`) and partial promotion offers can no longer arise from `commit_booking`; the sheet keeps the control (P2) and `waitlist_promotion.test.sql` keeps covering partial offers with direct fixtures.
- `lib/bookings.test.ts`'s migration self-audit will report `'already invited'` as unmapped from this task until Task 7 maps it. That is expected; do not allowlist it.

- [ ] **Step 1: Update `bookings_commit.test.sql` for the new commit semantics**

Make these exact edits:

1. Line 4: `select plan(44);` → `select plan(51);`

2. Replace the commit-and-notify block (currently lines 342–369, from `select lives_ok(` through `'the game is now full');`) with:

```sql
select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'committing the split books the sender and invites the other two');

reset role;
select is(
  (select count(distinct event_table_id)::int from public.bookings
    where booked_by = 'eeeeeeee-0000-0000-0000-000000000005'),
  2,
  'across the two tables the proposal named -- the invitees'' seats are held there');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'),
  2,
  'the two friends are sent an invite, not told a seat was booked for them');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  0,
  'and the sender is not invited to her own game');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the game is now full -- the held seats count');
```

3. Replace the "group that will not split" assertions (currently lines 426–440, from `select is(` through `'and committing it promoted the member who was already waiting');`) with:

```sql
-- Under game invites only Ivy's own row waits; Jack is invited with no
-- seat held. The group therefore needs ONE seat, not a table for two, and
-- the promote_waitlist inside commit_booking seats her (and Hank) at once:
-- two single-seat groups, one free seat at each table.
select is(
  (select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['77777777-0000-0000-0000-000000000009',
            '66666666-0000-0000-0000-000000000010']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', false)->>'outcome'),
  'seated',
  'a pair that will not split no longer waits for a table for two: only the '
  'sender needs a seat, and she is promoted straight into one');

reset role;
select is(
  (select status::text from public.bookings
    where profile_id = '88888888-0000-0000-0000-000000000008'),
  'confirmed',
  'and committing it promoted the member who was already waiting');
select ok(
  (select status = 'invited' and invite_holds_seat = false
          and event_table_id is null
     from public.bookings
    where profile_id = '66666666-0000-0000-0000-000000000010'),
  'her partner is invited, holding no seat, because the game had no seat for him');
```

4. Replace the whole "One seat free, a splittable pair" section (currently lines 442–502: from the `-- One seat free, a splittable pair: an offer, immediately.` banner through the `'promotion_offers here would miss a rename inside the returned jsonb');` line) with:

```sql
-- ---------------------------------------------------------------------
-- A splittable pair into a full game: the sender waits, the partner is
-- invited with no seat held. Only the sender's row is in the queue, so no
-- partial offer is ever minted around an invitee (the partial-offer path
-- itself is covered with direct fixtures in waitlist_promotion.test.sql).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "55555555-0000-0000-0000-000000000011", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['55555555-0000-0000-0000-000000000011',
            '44444444-0000-0000-0000-000000000012']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a splittable pair into a full game is accepted onto the waitlist');

-- my_upcoming_bookings() -- what "Your games" reads -- must report the
-- same position booking_result does, computed with the identical
-- (waitlisted_at, created_at, id) ordering promote_waitlist walks.
select is(
  (select waitlist_position from public.my_upcoming_bookings()
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'my_upcoming_bookings reports the waitlist position -- 1st, the only '
  'group still waiting');

reset role;
select is(
  (select public.booking_result(bg.id)->>'waitlist_position'
     from public.booking_groups bg
    where bg.created_by = '55555555-0000-0000-0000-000000000011'),
  '1',
  'and booking_result agrees');
select ok(
  (select status = 'invited' and invite_holds_seat = false
          and event_table_id is null
     from public.bookings
    where profile_id = '44444444-0000-0000-0000-000000000012'),
  'the partner is invited, holding no seat');
select is(
  (select count(*)::int from public.promotion_offers po
     join public.booking_groups bg on bg.id = po.group_id
    where bg.created_by = '55555555-0000-0000-0000-000000000011'),
  0,
  'and no offer is minted: nothing is free');
```

5. Insert this block immediately BEFORE the `-- Tenancy.` banner (i.e. after the "A cancelled group reports itself as cancelled" assertion). It must stay after that block, whose subselect `where profile_id = 'cccccccc-...'` would otherwise see Carol's second booking:

```sql
-- ---------------------------------------------------------------------
-- A sender who is not playing, inviting into a full game: nobody in the
-- group is queued, so the group is not a waiting group (it would sit in
-- every waitlist_position count forever while promote_waitlist skipped
-- it), yet booking_result still reports the waitlisted outcome the
-- proposal showed.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

create temporary table carol_invite on commit drop as
  select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[],
      null, true) as result;

reset role;
select is(
  (select status::text from public.booking_groups
    where id = (select (result->>'group_id')::uuid from carol_invite)),
  'confirmed',
  'an invites-only group into a full game is not a waiting group');
select is(
  (select result->>'outcome' from carol_invite),
  'waitlisted',
  'but the sender is told the invite would join the waitlist');
select is(
  (select result->>'waitlist_position' from carol_invite),
  null,
  'with no queue position -- nobody in it is queued until they accept');

-- close_group_if_empty (P5): Kim leaves; her group now holds only Lee's
-- pending invite, and must stop counting as a waiting group.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "55555555-0000-0000-0000-000000000011", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where profile_id = '55555555-0000-0000-0000-000000000011'))$$,
  'the waiting sender leaves while her invite is still pending');

reset role;
select is(
  (select status::text from public.booking_groups
    where created_by = '55555555-0000-0000-0000-000000000011'),
  'confirmed',
  'a waitlisted group left holding only invites stops waiting (and stays '
  'open for the pending invite)');
```

Count: 44 − 2 − 4 + 3 + 5 (sections 3 and 4) + 5 (section 5) = 51. (Section 2 is a one-for-one swap.)

- [ ] **Step 2: Update `invite_only_booking_gate.test.sql`'s fifth assertion**

Replace (currently lines 81–88):

```sql
select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000ec01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ec02'
     and status = 'confirmed'),
  1,
  'the invited member is actually seated'
);
```

with:

```sql
select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000ec01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ec02'
     and status = 'invited'
     and invite_holds_seat
     and event_table_id = '44444444-0000-0000-0000-00000000ec01'),
  1,
  'the member is invited, with their seat at the table held -- not seated '
  'until they accept'
);
```

Also reword the preceding `lives_ok` description from `'the organizer can invite (book) a member onto an invite-only game'` to `'the organizer can invite a member onto an invite-only game'`. `plan(6)` is unchanged.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `bookings_commit.test.sql` fails (no `booking_invited` rows; Jack and Lee are `waitlisted`, not `invited`; Carol's invites-only group is `waitlisted`) and `invite_only_booking_gate.test.sql` fails assertion 5 (the member is `confirmed`).

- [ ] **Step 4: Write `20260924102000_invite_commit_path.sql`**

```sql
/*
 * Game invites, commit path: every member a sender adds to a game other
 * than themselves is INVITED, not booked
 * (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md).
 * The invite is a bookings row with status 'invited' in the sender's
 * group, booked_by = the sender.
 *
 *   invite_holds_seat = true   the planner seated them; the seat is held
 *                              (counted by the capacity family,
 *                              20260924101000) until they answer, the
 *                              sender or an organizer withdraws, or the
 *                              game starts.
 *   invite_holds_seat = false  the game was full when sent; accepting joins
 *                              the waitlist at the back, as of accepting.
 *
 * Every body below is the latest definition copied verbatim (source named
 * per function) with only the invite change applied. `create or replace`
 * keeps each ACL; it is restated anyway, per the house rule, matching the
 * latest ACL of each function (the internal helpers stay revoked from
 * authenticated, per 20260825061000).
 */

-- ---------------------------------------------------------------------
-- assert_players_bookable (from 20260825020000): an invited row is an
-- active row. A member already booked, waitlisted OR invited cannot be
-- invited again. Distinct message so the client can say "already
-- invited" rather than "already has a seat".
-- ---------------------------------------------------------------------
create or replace function public.assert_players_bookable(
  target_club  uuid,
  target_event uuid,
  players      uuid[]
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  p uuid;
begin
  if coalesce(array_length(players, 1), 0) = 0 then
    raise exception 'no players' using errcode = '23514';
  end if;

  if array_length(players, 1) <>
     (select count(distinct x)::int from unnest(players) x) then
    raise exception 'duplicate player' using errcode = '23514';
  end if;

  foreach p in array players loop
    if not exists (
      select 1 from public.club_members
      where club_id = target_club and profile_id = p and status = 'active')
    then
      raise exception 'not a member'
        using errcode = '23514', detail = p::text;
    end if;

    if exists (
      select 1 from public.bookings
      where event_id = target_event and profile_id = p
        and status in ('confirmed', 'waitlisted'))
    then
      raise exception 'already booked'
        using errcode = '23514', detail = p::text;
    end if;

    if exists (
      select 1 from public.bookings
      where event_id = target_event and profile_id = p
        and status = 'invited')
    then
      raise exception 'already invited'
        using errcode = '23514', detail = p::text;
    end if;
  end loop;
end;
$$;

revoke execute on function public.assert_players_bookable(uuid, uuid, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- close_group_if_empty (from 20260825030000). Two changes:
--   1. a pending invite keeps a group alive (rules.md, spec table);
--   2. a group left 'waitlisted' with NO waitlisted row (its only waiting
--      member -- typically the sender -- left, but invites are still
--      pending) is no longer a waiting group: promote_waitlist would skip
--      it forever (`continue when wanted = 0`) while it still occupies a
--      place in every waitlist_position count. It becomes 'confirmed'
--      (a container of invites), and any offer it held is resolved.
-- ---------------------------------------------------------------------
create or replace function public.close_group_if_empty(target_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where group_id = target_group
      and status in ('confirmed', 'waitlisted', 'invited'))
  then
    -- A group with no live bookings must not stay 'confirmed' or
    -- 'waitlisted': promote_waitlist would keep considering a group that
    -- no longer exists.
    update public.booking_groups
       set status = 'cancelled', waitlisted_at = null
     where id = target_group and status <> 'cancelled';

    update public.promotion_offers
       set responded_at = now(), outcome = 'declined'
     where group_id = target_group and responded_at is null;
  elsif not exists (
    select 1 from public.bookings
    where group_id = target_group and status = 'waitlisted')
  then
    update public.booking_groups
       set status = 'confirmed', waitlisted_at = null
     where id = target_group and status = 'waitlisted';

    if found then
      update public.promotion_offers
         set responded_at = now(), outcome = 'declined'
       where group_id = target_group and responded_at is null;
    end if;
  end if;
end;
$$;

revoke execute on function public.close_group_if_empty(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- booking_result (from 20260825020000). Top-level keys are UNCHANGED
-- (lib/schema-contract.test.ts asserts the exact key set). Changes:
--   - placements include invited rows, each placement gains a 'status'
--     key (additive; the contract test uses toMatchObject per element);
--   - 'split' counts held seats as seats;
--   - a non-waitlisted group with no seat at all (nothing confirmed,
--     nothing held) and a table-less invite reports 'waitlisted' -- the
--     sender-not-playing, game-full case, which is what propose_booking
--     showed them. waitlist_position stays null for it: nobody in it is
--     in the queue yet.
-- ---------------------------------------------------------------------
create or replace function public.booking_result(target_group uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id,
    'outcome', case
      when g.status = 'waitlisted' then 'waitlisted'
      when g.status = 'cancelled' then 'cancelled'
      when not exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and (b.status = 'confirmed'
                    or (b.status = 'invited' and b.invite_holds_seat)))
       and exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and b.status = 'invited' and not b.invite_holds_seat)
        then 'waitlisted'
      else 'seated' end,
    'split', (
      select count(distinct b.event_table_id) > 1
      from public.bookings b
      where b.group_id = g.id
        and (b.status = 'confirmed'
             or (b.status = 'invited' and b.invite_holds_seat))
        and b.event_table_id is not null),
    'waitlist_position', case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    'offer', (
      select jsonb_build_object('id', po.id, 'seats', po.offered_seat_count,
                                'expires_at', po.expires_at)
      from public.promotion_offers po
      where po.group_id = g.id and po.responded_at is null),
    'placements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', b.profile_id,
        'event_table_id', b.event_table_id,
        'table_label', t.label,
        'status', b.status) order by b.created_at, b.id)
      from public.bookings b
      left join public.event_tables t on t.id = b.event_table_id
      where b.group_id = g.id
        and b.status in ('confirmed', 'waitlisted', 'invited')
    ), '[]'::jsonb))
  from public.booking_groups g where g.id = target_group;
$$;

revoke execute on function public.booking_result(uuid) from public, anon;
grant execute on function public.booking_result(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- commit_booking (from 20260905090000). The sender (caller), if among
-- `players`, is booked exactly as before. Everyone else is INVITED in the
-- same group:
--   outcome 'seated'     -> invited, invite_holds_seat = true, at the
--                           planner's table (null = an "any table" hold).
--   outcome 'waitlisted' -> invited, invite_holds_seat = false, no table.
-- The group is 'waitlisted' only when the sender's own row is -- a group
-- of nothing but table-less invites waits for no one, and would otherwise
-- sit in the queue as a ghost promote_waitlist skips forever.
-- booking_invited replaces booked_by_friend on this path.
-- ---------------------------------------------------------------------
create or replace function public.commit_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  target_club  uuid;
  mode         public.game_mode;
  seating      jsonb;
  seated       boolean;
  sender_waits boolean;
  new_group    uuid;
  placement    jsonb;
  pid          uuid;
begin
  -- Bound and refused up front, as cancel_booking/decline_booking do.
  -- is_club_member below would refuse a null caller too, but only by
  -- accident of `profile_id = null` matching nothing.
  if caller is null then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  -- Everything after this line is inside the event's lock. Two members
  -- racing for the last seat serialize here, which is what makes the
  -- race impossible rather than unlikely.
  perform 1 from public.events where id = target_event for update;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  seating := public.plan_seating(target_event, players, preferred, allow_split);
  seated := seating->>'outcome' = 'seated';
  sender_waits := not seated and caller = any(players);

  insert into public.booking_groups
    (event_id, club_id, created_by, preferred_table_id, allow_split,
     status, waitlisted_at)
  values (
    target_event, target_club, caller, preferred, allow_split,
    case when sender_waits then 'waitlisted'::public.booking_group_status
         else 'confirmed'::public.booking_group_status end,
    case when sender_waits then now() else null end)
  returning id into new_group;

  if seated then
    for placement in select * from jsonb_array_elements(seating->'placements')
    loop
      pid := (placement->>'profile_id')::uuid;
      if pid = caller then
        insert into public.bookings
          (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
        values (new_group, target_event, target_club,
                (placement->>'event_table_id')::uuid, caller, caller);
      else
        insert into public.bookings
          (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
           status, invite_holds_seat)
        values (new_group, target_event, target_club,
                (placement->>'event_table_id')::uuid, pid, caller,
                'invited', true);
      end if;
    end loop;
  else
    insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by, status,
       invite_holds_seat)
    select new_group, target_event, target_club, p, caller,
           case when p = caller then 'waitlisted'::public.booking_status
                else 'invited'::public.booking_status end,
           case when p = caller then null else false end
    from unnest(players) p;
  end if;

  -- The invite is the message: nobody is committed to a game they have
  -- not said yes to, and this is how they find out there is a yes to say.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booking_invited',
         jsonb_build_object('booking_id', b.id,
                            'booked_by', caller,
                            'holds_seat', b.invite_holds_seat,
                            'event_table_id', b.event_table_id),
         'booking_invited:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.status = 'invited'
  on conflict (dedupe_key) do nothing;

  -- A group can be waitlisted with seats still free — it was simply too
  -- big for them, or asked to stay together. Walking the queue now is
  -- what turns that into an offer (or, for a sender now waiting alone, a
  -- seat) immediately instead of in five minutes.
  if not seated then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  from public, anon;
grant execute on function public.commit_booking(uuid, uuid[], uuid, boolean)
  to authenticated;
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: every file passes — `bookings_commit.test.sql` 51/51, `invite_only_booking_gate.test.sql` 6/6, `invite_capacity.test.sql` still 38/38. `bookings_cancellation.test.sql` needs no change (nothing there counts the kinds this task adds).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260924102000_invite_commit_path.sql \
  supabase/tests/database/fixtures/bookings_commit.test.sql \
  supabase/tests/database/fixtures/invite_only_booking_gate.test.sql
git commit -m "$(cat <<'EOF'
feat(db): commit_booking invites everyone but the sender

The sender is booked as before; every other player is an 'invited' row
in the same group, holding the seat the planner chose (or no seat in a
full game), and is sent booking_invited instead of booked_by_friend.
assert_players_bookable refuses a second invite ('already invited');
close_group_if_empty keeps a group of pending invites open but stops it
counting as a waiting group.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Invite lifecycle — accept, decline, withdraw, leave, cancel, sweep

**Files:**
- Create: `supabase/tests/database/fixtures/booking_invites.test.sql`
- Modify: `supabase/tests/database/fixtures/series_shortening_notifies.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Create: `supabase/migrations/20260924103000_booking_invite_lifecycle.sql`
- Create: `supabase/migrations/20260924103100_series_shortening_tells_the_invited.sql`
- Create: `supabase/migrations/20260924103200_schedule_close_started_invites.sql`
- Modify: `docs/testing.md` (the `pg_cron` jobs table)

**Interfaces:**
- Consumes: Tasks 1–3 (`close_group_if_empty`, `booking_result`, `promote_waitlist`, the new outbox kinds).
- Produces (new, client RPCs, `revoke ... from public, anon` + `grant ... to authenticated`):
  - `accept_booking_invite(target_booking uuid) returns jsonb` (a `booking_result`). Caller must be the row's `profile_id`, the row must still be `invited` (re-read under the event lock), the game published and not started, and the caller still an active club member (P8). Organizer status is NOT re-checked for invite-only games. Held → `confirmed`, keeps its table, `invite_holds_seat` null. Unheld → moved into a NEW solo group (`created_by` = invitee, `preferred_table_id` null, `allow_split` true, `waitlisted`, `waitlisted_at = now()`), row `waitlisted`, old group `close_group_if_empty`'d, then `promote_waitlist`. Outbox `booking_invite_accepted` to `booked_by`, payload `{booking_id, accepted_by, waitlisted}` (P3), dedupe `booking_invite_accepted:<id>`. Refusals: `'not your booking'` / `'no such booking'` (42501), `'invite already accepted'` (23514, NEW), `'booking already closed'`, `'event already started'`, `'event not bookable'` (23514), `'not a member of this club'` (42501).
  - `withdraw_booking_invite(target_booking uuid) returns jsonb`. Caller must be `booked_by` or `is_club_organizer`; row `invited` (re-read under lock); game not started. → `cancelled`, `cancelled_by` = caller, hold and table cleared; outbox `booking_invite_withdrawn` to the invitee (payload `{booking_id, cancelled_by}`), `close_group_if_empty`, `promote_waitlist`. Same refusal vocabulary as accept.
- Produces (new, internal, revoked from `public, anon, authenticated`): `close_started_invites() returns void` — every `invited` row of a started game → `cancelled` (hold and table cleared, `cancelled_by` null), no outbox, `close_group_if_empty` per touched group. Scheduled as cron job `close-started-invites`, `*/5 * * * *`.
- Changed (signatures and ACLs unchanged):
  - `decline_booking(target_booking uuid)` also accepts `invited` rows → `declined`, hold and table cleared; `booking_declined` to `booked_by` as before.
  - `cancel_booking(target_booking uuid)` still refuses `invited` rows (`'booking already closed'` — withdraw is that path); NEW: when the caller is the row's `profile_id` and `booked_by` is someone else, writes `booking_cancelled_by_member` to `booked_by` (payload `{booking_id, cancelled_by}`). A host removing someone still writes `booking_cancelled_by_host` to the member.
  - `cancel_booking_group(target_group uuid)` also closes the group's `invited` rows; an invitee gets `booking_invite_withdrawn`, not `booking_cancelled_by_host`.
  - `cancel_event(target_event uuid)` also closes `invited` rows and sends their invitees `event_cancelled` (they were told about the game, so they are told it is off). `end_event_series` reaches it per occurrence and needs no change.
  - `update_event_series(...)` — the series-shortening `event_cancelled` notice also goes to `invited` rows on dropped occurrences (the rows themselves cascade away with the occurrence).
- `lib/bookings.test.ts`'s self-audit also reports `'invite already accepted'` as unmapped until Task 7.

- [ ] **Step 1: Write the failing lifecycle test**

Create `supabase/tests/database/fixtures/booking_invites.test.sql` (68 assertions; all events are `open_play` except E3, so RLS lets any member read the rows the subselects look up):

```sql
begin;
set local search_path to extensions, public;

select plan(68);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),
  ('99999999-0000-0000-0000-000000000007', 'gina@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Alice hosts. Everyone else is an ordinary member.
insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1: the main game, Table 1 (4) + Table 2 (2).
-- E2: one table of 2, already full -- invites into it hold nothing.
-- E3: invite-only.
-- E4: started an hour ago, with a pending invite the sweep must close.
-- E5: a future game with a pending invite the sweep must NOT close, and
--     that cancel_event later closes.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, game_mode,
   created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Full game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Private game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'invite_only', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Right now',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next month',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '30 days', now() + interval '30 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 2, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000004',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000005',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000006',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

-- E2 is full: Fred booked himself and Gina.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000003');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   '99999999-0000-0000-0000-000000000007',
   'ffffffff-0000-0000-0000-000000000006');

-- E4 (started): Bob invited Carol, seat held, never answered.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000005');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000005',
   'cccccccc-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

-- E5 (next month): Alice invited Gina, seat held.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000006');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000006',
   '99999999-0000-0000-0000-000000000007',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

-- ---------------------------------------------------------------------
-- Sending: the sender is booked, everyone else is invited into a held
-- seat.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002',
            'cccccccc-0000-0000-0000-000000000003',
            'dddddddd-0000-0000-0000-000000000004']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a sender books themselves and invites two members');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'confirmed',
  'the sender is booked exactly as before');
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'invited',
  'another member is invited, not booked');
select ok(
  (select invite_holds_seat
          and event_table_id = '7ab1e000-0000-0000-0000-000000000001'
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'and the invite holds a seat at the table the planner chose');
select is(
  (select booked_by from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  'booked_by names the sender');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and recipient_id in ('cccccccc-0000-0000-0000-000000000003',
                           'dddddddd-0000-0000-0000-000000000004')),
  2,
  'each invitee gets a booking_invited row');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'the sender is not invited to their own game');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'),
  0,
  'booked_by_friend is no longer written on this path');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 1,
  'held seats count against the table');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'and against the game');

-- ---------------------------------------------------------------------
-- A member already invited cannot be invited again.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'cccccccc-0000-0000-0000-000000000003']::uuid[],
      null, true)$$,
  '23514',
  'already invited',
  'a member with a pending invite cannot be invited a second time');
select throws_ok(
  $$select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['dddddddd-0000-0000-0000-000000000004']::uuid[],
      null, true)$$,
  '23514',
  'already invited',
  'and propose_booking says so before anything is written');

-- ---------------------------------------------------------------------
-- Inviting into a full game: the invite holds nothing.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.commit_booking(
      'e2e2e2e2-0000-0000-0000-000000000002',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'dddddddd-0000-0000-0000-000000000004']::uuid[],
      '7ab1e000-0000-0000-0000-000000000003', true)$$,
  'inviting into a full game is allowed');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'waitlisted',
  'the sender waits, as before');
select ok(
  (select status = 'invited' and invite_holds_seat = false
          and event_table_id is null
     from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'the invitee is invited with no seat held and no table');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and recipient_id = 'dddddddd-0000-0000-0000-000000000004'),
  1,
  'and is still told about it');

-- ---------------------------------------------------------------------
-- Invite-only: still organizer-only to send.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot invite anyone onto an invite-only game');

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[],
      '7ab1e000-0000-0000-0000-000000000004', true)$$,
  'the organizer can invite onto an invite-only game');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'invited',
  'and the member is invited, not seated');

-- ---------------------------------------------------------------------
-- Accepting a held seat.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  null,
  'a caller with no sub claim cannot accept an invite');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  'not your booking',
  'another member cannot accept somebody else''s invite');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  'not your booking',
  'not even the sender can accept on the invitee''s behalf');

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  'the invitee accepts');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'confirmed',
  'a held invite becomes a confirmed seat');
select ok(
  (select event_table_id = '7ab1e000-0000-0000-0000-000000000001'
          and invite_holds_seat is null
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'at the table that was held, with the hold flag cleared');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_accepted'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 1,
  'accepting a held seat takes no second seat');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'invite already accepted',
  'an invite cannot be accepted twice');

-- ---------------------------------------------------------------------
-- Accepting a table-less invite: a new solo group at the back of the
-- queue as of accepting. Erin's group is backdated so "behind Erin" is
-- true unconditionally, not by the luck of two uuids (now() is pinned to
-- the transaction start -- see bookings_commit.test.sql).
-- ---------------------------------------------------------------------
reset role;
update public.booking_groups
   set waitlisted_at = waitlisted_at - interval '1 minute'
 where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
   and created_by = 'eeeeeeee-0000-0000-0000-000000000005';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
          and profile_id = 'dddddddd-0000-0000-0000-000000000004'))$$,
  'the invitee accepts an invite that holds no seat');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'waitlisted',
  'and joins the waitlist');
select ok(
  (select g.created_by = 'dddddddd-0000-0000-0000-000000000004'
          and g.status = 'waitlisted'
          and g.preferred_table_id is null
     from public.bookings b
     join public.booking_groups g on g.id = b.group_id
    where b.event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and b.profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'in a group of their own, not the sender''s');
select is(
  (select public.booking_result(group_id)->>'waitlist_position'
     from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  '2',
  'at the back of the queue, behind the sender who was already waiting');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_accepted'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the sender is told');
select is(
  (select status::text from public.booking_groups
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and created_by = 'eeeeeeee-0000-0000-0000-000000000005'),
  'waitlisted',
  'the sender''s own group keeps its place');

-- ---------------------------------------------------------------------
-- Once the game has started, nobody can answer or withdraw.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'an invite cannot be accepted once the game has started');
select throws_ok(
  $$select public.decline_booking(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'nor declined');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'nor withdrawn');

-- cancel_booking is not the way out of a pending invite.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
          and profile_id = '99999999-0000-0000-0000-000000000007'))$$,
  '23514',
  'booking already closed',
  'cancel_booking refuses a pending invite; withdraw_booking_invite is the path');

-- ---------------------------------------------------------------------
-- Declining an invite frees the held seat and tells the sender.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.decline_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'dddddddd-0000-0000-0000-000000000004'))$$,
  'the invitee declines');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'declined',
  'a declined invite is declined');
select ok(
  (select invite_holds_seat is null and event_table_id is null
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'and gives up its hold and its table');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_declined'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 2,
  'and the held seat is free again');

-- ---------------------------------------------------------------------
-- Withdrawing: the sender or an organizer; nobody else.
-- Bob invites two without booking himself.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'a sender may invite others without booking themselves');

reset role;
select is(
  (select public.booking_result(group_id)->>'outcome'
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'seated',
  'a group of held invites reports seated, as the proposal did');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "99999999-0000-0000-0000-000000000007", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  'not your booking',
  'another member cannot withdraw somebody else''s invite');

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  'not your booking',
  'the invitee does not withdraw -- they decline');

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  null,
  'a caller with no sub claim cannot withdraw an invite');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  'the sender withdraws an invite');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'cancelled',
  'a withdrawn invite is cancelled');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_withdrawn'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the invitee is told');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'ffffffff-0000-0000-0000-000000000006'))$$,
  'an organizer may withdraw an invite they did not send');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'cancelled',
  'and it is cancelled');
select is(
  (select g.status::text from public.bookings b
     join public.booking_groups g on g.id = b.group_id
    where b.event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and b.profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'cancelled',
  'a group whose last pending invite is withdrawn is closed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'ffffffff-0000-0000-0000-000000000006'))$$,
  '23514',
  'booking already closed',
  'a closed invite cannot be withdrawn again');

-- ---------------------------------------------------------------------
-- Leaving after accepting tells the sender; leaving your own seat tells
-- nobody.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  'a member leaves a seat somebody else booked for them');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_member'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told their invitee can''t make it anymore');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_host'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  0,
  'and the member is not told they were removed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'))$$,
  'the sender leaves a seat they booked themselves');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_member'),
  1,
  'which tells nobody');

-- ---------------------------------------------------------------------
-- Game start closes pending invites, silently.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.close_started_invites()$$,
  '42501',
  null,
  'a signed-in member cannot run the sweep');

reset role;
select lives_ok(
  $$select public.close_started_invites()$$,
  'the sweep runs');
select is(
  (select status::text from public.bookings
    where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'cancelled',
  'an invite still pending when its game started is closed');
select is(
  (select status::text from public.bookings
    where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
      and profile_id = '99999999-0000-0000-0000-000000000007'),
  'invited',
  'a future game''s invite is untouched');
select is(
  (select count(*)::int from public.notification_outbox
    where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'),
  0,
  'and nobody is told');

-- ---------------------------------------------------------------------
-- Cancelling the game closes its pending invites.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_event('e5e5e5e5-0000-0000-0000-000000000005')$$,
  'the host cancels a game with a pending invite');

reset role;
select ok(
  (select status = 'cancelled' and invite_holds_seat is null
     from public.bookings
    where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
      and profile_id = '99999999-0000-0000-0000-000000000007'),
  'the pending invite is closed with the game');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and recipient_id = '99999999-0000-0000-0000-000000000007'),
  1,
  'and the invitee is told the game is off');

select * from finish();
rollback;
```

- [ ] **Step 2: Extend `series_shortening_notifies.test.sql` with a pending invitee**

Exact edits:

1. `select plan(8);` → `select plan(9);`
2. Add Olive to the users insert — the values list becomes:

```sql
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('11110000-0000-0000-0000-000000000001', 'mallory@example.com'),
  ('11110000-0000-0000-0000-000000000002', 'ned@example.com'),
  ('11110000-0000-0000-0000-000000000003', 'carol@example.com'),
  ('11110000-0000-0000-0000-000000000004', 'olive@example.com');
```

3. Add her membership as a fifth row of the `club_members` insert:

```sql
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000004', 'member');
```

(the previous last row's `;` becomes `,`).

4. Immediately before `create temporary table doomed_occurrences as`, insert:

```sql
-- Olive holds a pending game invite (seat held, any table) on +38, which
-- the first shortening drops. She was told about that game, so she is told
-- it is gone (game invites, 20260924103100).
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('99990000-0000-0000-0000-000000000005',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 38),
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('99990000-0000-0000-0000-000000000005',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 38),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);
```

5. The `bag_eq` expected array and description become:

```sql
  ARRAY['11110000-0000-0000-0000-000000000001',
        '11110000-0000-0000-0000-000000000002',
        '11110000-0000-0000-0000-000000000004']::uuid[],
  'exactly the three members still booked or invited on a dropped week are told, once each'
```

6. After the `'Carol, whose occurrence was kept, hears nothing'` assertion, add:

```sql
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and recipient_id = '11110000-0000-0000-0000-000000000004'),
  1,
  'Olive, invited to a dropped week, is told it is gone');
```

7. The final assertion's expected count `2,` → `3,` (description unchanged). The "both outbox rows survive the delete" assertion stays at 2: `doomed_occurrences` only captures +17 and +24.

- [ ] **Step 3: Update `portable/grants.test.sql`**

1. `select plan(126);` → `select plan(127);`
2. Directly after the `'authenticated cannot execute announce_need_a_fourth'` assertion, add:

```sql
-- close_started_invites (20260924103000) runs as postgres from the
-- close-started-invites cron job and sweeps every event in the system.
select ok(
  not has_function_privilege(
    'authenticated', 'public.close_started_invites()', 'EXECUTE'),
  'authenticated cannot execute close_started_invites'
);
```

3. In the "Direction 1" allowlist array, directly after `'public.decline_booking(uuid)',` add:

```sql
       'public.accept_booking_invite(uuid)',
       'public.withdraw_booking_invite(uuid)',
```

4. In the "Direction 2" allowlist array, directly after `'public.decline_booking(uuid)',` add (nine-space indent there):

```sql
         'public.accept_booking_invite(uuid)',
         'public.withdraw_booking_invite(uuid)',
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `booking_invites.test.sql` fails (`accept_booking_invite` / `withdraw_booking_invite` / `close_started_invites` do not exist; `decline_booking` refuses an invited row), `series_shortening_notifies.test.sql` fails (Olive is not told), `grants.test.sql` fails on the missing functions in Direction 1 and on `close_started_invites()` (the `to_regprocedure` of a missing function is null — the `ok(not has_function_privilege(...))` errors until it exists).

- [ ] **Step 5: Write `20260924103000_booking_invite_lifecycle.sql`**

```sql
/*
 * Game invites, lifecycle: answering, withdrawing, leaving, and the game
 * ending or starting around a pending invite
 * (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md).
 *
 * New: accept_booking_invite, withdraw_booking_invite (client RPCs) and
 * close_started_invites (scheduled sweep, 20260924103200).
 * Changed: cancel_booking, decline_booking, cancel_booking_group,
 * cancel_event -- each copied verbatim from its latest definition
 * (20260825030000 for the first three, 20260825040000 for cancel_event)
 * with only the invite change applied.
 *
 * Every exit from 'invited' sets invite_holds_seat = null in the same
 * UPDATE (20260924100100's check constraint) and clears the table, except
 * accepting a held seat, which keeps it. accept, decline and withdraw race
 * on the same row, so each re-reads it after taking the event lock.
 *
 * ACLs restated per the house rule: client RPCs revoke public, anon and
 * grant authenticated; close_started_invites is revoked from everyone but
 * its owner.
 */

-- ---------------------------------------------------------------------
-- cancel_booking (from 20260825030000). Still refuses an invited row
-- ('booking already closed' -- withdraw_booking_invite is that path).
-- New: the member leaving a seat somebody else booked for them tells the
-- booker. A host removing someone still tells the member, unchanged.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  -- Bound and null-checked before anything else: with an OR-chain guard
  -- (`bk.profile_id = auth.uid() or ... or is_club_organizer(...)`), a
  -- session with no `sub` claim makes every `= auth.uid()` term NULL and
  -- is_club_organizer(...) a definite false, so `NULL or NULL or false` is
  -- NULL, `not NULL` is NULL, and plpgsql skips an `if` whose condition is
  -- NULL — the guard never fires. Binding `caller` and refusing a null
  -- caller up front, as decline_booking already does, closes that hole.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = caller
          or bk.booked_by = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = caller
   where id = target_booking;

  -- Somebody else ended this person's booking; they are owed the news.
  if bk.profile_id <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_cancelled_by_host',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_cancelled_by_host:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  -- The member walked away from a seat somebody else secured for them
  -- (an accepted invite). The sender is owed the news: the seat is open
  -- again, and they may want to invite someone else into it. A member
  -- leaving a seat they booked themselves tells nobody.
  if bk.profile_id = caller and bk.booked_by <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.booked_by, bk.club_id, bk.event_id,
            'booking_cancelled_by_member',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_cancelled_by_member:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- decline_booking (from 20260825030000). Now also takes an 'invited' row
-- (the invitee saying no). A declined invite gives up its hold and its
-- table. The status is re-read under the event lock: accept and decline
-- of the same invite can race, and the loser must be refused rather than
-- overwrite the winner.
-- ---------------------------------------------------------------------
create or replace function public.decline_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  -- Bound and null-checked rather than compared with `<>`: a null
  -- auth.uid() makes `bk.profile_id <> auth.uid()` evaluate to NULL, so
  -- the guard would not fire and a caller with no `sub` claim could
  -- decline anybody's seat.
  caller := auth.uid();
  if caller is null or bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  -- A seat you booked yourself is cancelled, never declined. Allowing both
  -- would make the booker's outbox row a coin flip.
  if bk.booked_by = caller then
    raise exception 'nothing to decline' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock.
  select * into bk from public.bookings where id = target_booking;
  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  update public.bookings
     set status = 'declined', cancelled_at = now(), cancelled_by = caller,
         invite_holds_seat = null,
         event_table_id = case when bk.status = 'invited' then null
                               else event_table_id end
   where id = target_booking;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  values (bk.booked_by, bk.club_id, bk.event_id, 'booking_declined',
          jsonb_build_object('booking_id', bk.id,
                             'declined_by', bk.profile_id),
          'booking_declined:' || bk.id::text)
  on conflict (dedupe_key) do nothing;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.decline_booking(uuid) from public, anon;
grant execute on function public.decline_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- cancel_booking_group (from 20260825030000). "We are not coming after
-- all" ends the group's pending invites too -- the group's creator is the
-- invites' sender, who could withdraw each one anyway. An invitee is told
-- their invite was withdrawn, not that a host cancelled a seat they never
-- had.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking_group(target_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g      record;
  ev     record;
  bk     record;
  caller uuid;
begin
  -- Same null-caller hole as cancel_booking's OR-chain guard, and the same
  -- fix: bind and refuse a null caller before the OR-chain ever runs.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    raise exception 'no such group' using errcode = '42501';
  end if;

  if not (g.created_by = caller or public.is_club_organizer(g.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select id, starts_at into ev from public.events where id = g.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = g.event_id for update;

  for bk in
    select * from public.bookings
    where group_id = target_group
      and status in ('confirmed', 'waitlisted', 'invited')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = caller,
           invite_holds_seat = null,
           event_table_id = case when bk.status = 'invited' then null
                                 else event_table_id end
     where id = bk.id;

    if bk.profile_id <> caller then
      if bk.status = 'invited' then
        insert into public.notification_outbox
          (recipient_id, club_id, event_id, kind, payload, dedupe_key)
        values (bk.profile_id, bk.club_id, bk.event_id,
                'booking_invite_withdrawn',
                jsonb_build_object('booking_id', bk.id,
                                   'cancelled_by', caller),
                'booking_invite_withdrawn:' || bk.id::text)
        on conflict (dedupe_key) do nothing;
      else
        insert into public.notification_outbox
          (recipient_id, club_id, event_id, kind, payload, dedupe_key)
        values (bk.profile_id, bk.club_id, bk.event_id,
                'booking_cancelled_by_host',
                jsonb_build_object('booking_id', bk.id,
                                   'cancelled_by', caller),
                'booking_cancelled_by_host:' || bk.id::text)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  end loop;

  -- Resolves the group AND any offer holding seats for it. A held seat
  -- must never outlive the group it was held for.
  perform public.close_group_if_empty(target_group);
  perform public.promote_waitlist(g.event_id);

  return public.booking_result(target_group);
end;
$$;

revoke execute on function public.cancel_booking_group(uuid) from public, anon;
grant execute on function public.cancel_booking_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- accept_booking_invite (new). Invitee only; invited row; game not
-- started. Organizer status is NOT re-checked for an invite-only game --
-- the invite was organizer-authorized when sent (same reasoning as guest
-- invites, 20260905090000). Club membership IS checked: nothing cancels a
-- removed member's pending invite, and accepting must not seat a
-- non-member.
--
--   holds a seat -> 'confirmed', keeping its table (or its "any table").
--   holds none   -> moved into a NEW solo waitlisted group (created_by the
--                   invitee, any table, waitlisted_at = now()), i.e. the
--                   back of the queue as of accepting; the sender's group
--                   is closed if that was its last live row, and the queue
--                   is walked so a seat that has come free since is used.
-- ---------------------------------------------------------------------
create function public.accept_booking_invite(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk        record;
  ev        record;
  caller    uuid;
  new_group uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock: a withdraw, a decline or the start-of-game
  -- sweep may have closed it in between.
  select * into bk from public.bookings where id = target_booking;
  if bk.status in ('confirmed', 'waitlisted') then
    raise exception 'invite already accepted' using errcode = '23514';
  end if;
  if bk.status <> 'invited' then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, status, starts_at into ev
  from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;
  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;

  if not public.is_club_member(bk.club_id) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  if bk.invite_holds_seat then
    update public.bookings
       set status = 'confirmed', invite_holds_seat = null
     where id = target_booking;
    new_group := bk.group_id;
  else
    insert into public.booking_groups
      (event_id, club_id, created_by, preferred_table_id, allow_split,
       status, waitlisted_at)
    values (bk.event_id, bk.club_id, caller, null, true,
            'waitlisted', now())
    returning id into new_group;

    update public.bookings
       set group_id = new_group, status = 'waitlisted',
           invite_holds_seat = null, event_table_id = null
     where id = target_booking;

    perform public.close_group_if_empty(bk.group_id);
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  values (bk.booked_by, bk.club_id, bk.event_id, 'booking_invite_accepted',
          jsonb_build_object('booking_id', bk.id,
                             'accepted_by', caller,
                             'waitlisted', not bk.invite_holds_seat),
          'booking_invite_accepted:' || bk.id::text)
  on conflict (dedupe_key) do nothing;

  -- Accepting a held seat frees nothing and takes nothing new. Joining
  -- the waitlist may be answerable at once.
  if not bk.invite_holds_seat then
    perform public.promote_waitlist(bk.event_id);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.accept_booking_invite(uuid)
  from public, anon;
grant execute on function public.accept_booking_invite(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- withdraw_booking_invite (new). The sender (booked_by) or any organizer
-- of the club; invited row; game not started. -> cancelled, the hold and
-- its table released, the invitee told, the group closed if that was its
-- last live row, and the queue walked for the freed seat.
-- ---------------------------------------------------------------------
create function public.withdraw_booking_invite(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  -- Same null-caller hole as cancel_booking's OR-chain guard, and the same
  -- fix: bind and refuse a null caller before the OR-chain ever runs.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.booked_by = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock: the invitee may have answered in between.
  select * into bk from public.bookings where id = target_booking;
  if bk.status in ('confirmed', 'waitlisted') then
    raise exception 'invite already accepted' using errcode = '23514';
  end if;
  if bk.status <> 'invited' then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = caller,
         invite_holds_seat = null, event_table_id = null
   where id = target_booking;

  if bk.profile_id <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_invite_withdrawn',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_invite_withdrawn:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.withdraw_booking_invite(uuid)
  from public, anon;
grant execute on function public.withdraw_booking_invite(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- close_started_invites (new, scheduled). An invite still pending when
-- its game starts is closed as 'cancelled', silently (spec: "Game starts
-- with pending invites -- none"). accept/decline/withdraw already refuse
-- once starts_at passes, so the few minutes before this runs change no
-- outcome; this only stops a dead invite holding a seat in the reads.
-- cancelled_by stays null: nobody did it. Per-event lock, same order as
-- every other writer. No promote_waitlist: a started game promotes nobody.
-- ---------------------------------------------------------------------
create function public.close_started_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  g  record;
begin
  for ev in
    select distinct b.event_id
    from public.bookings b
    join public.events e on e.id = b.event_id
    where b.status = 'invited' and e.starts_at <= now()
  loop
    perform 1 from public.events where id = ev.event_id for update;

    for g in
      update public.bookings
         set status = 'cancelled', cancelled_at = now(),
             invite_holds_seat = null, event_table_id = null
       where event_id = ev.event_id and status = 'invited'
      returning group_id
    loop
      perform public.close_group_if_empty(g.group_id);
    end loop;
  end loop;
end;
$$;

-- Maintenance across every event in the system, called only by the
-- schedule (as postgres). Revoked from authenticated explicitly -- the
-- hosted-bootstrap direct grant that 20260825060000 and 20260825061000
-- describe.
revoke execute on function public.close_started_invites()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- cancel_event (from 20260825040000). Pending invites are closed with
-- everything else, and their invitees get the same event_cancelled row:
-- they were told about this game, so they are told it is off.
-- (end_event_series reaches this per occurrence and needs no change.)
-- ---------------------------------------------------------------------
create or replace function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  bk          record;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  perform 1 from public.events where id = target_event for update;

  update public.events set status = 'cancelled' where id = target_event;

  for bk in
    select * from public.bookings
    where event_id = target_event
      and status in ('confirmed', 'waitlisted', 'invited')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = auth.uid(),
           invite_holds_seat = null,
           event_table_id = case when bk.status = 'invited' then null
                                 else event_table_id end
     where id = bk.id;

    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, target_event, 'event_cancelled',
            jsonb_build_object('booking_id', bk.id),
            'event_cancelled:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end loop;

  update public.promotion_offers
     set responded_at = now(), outcome = 'expired'
   where event_id = target_event and responded_at is null;

  update public.booking_groups
     set status = 'cancelled', waitlisted_at = null
   where event_id = target_event and status <> 'cancelled';

  -- No promote_waitlist call: a cancelled game has nobody to promote, and
  -- promote_waitlist returns immediately on a non-published event anyway.
  return true;
end;
$$;

revoke execute on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;
```

`cancel_event` needs no null-caller guard of its own: `assert_club_organizer` → `is_club_organizer` (`profile_id = auth.uid()`) already refuses a null caller, and `end_event_series` calls it in-session.

- [ ] **Step 6: Write `20260924103100_series_shortening_tells_the_invited.sql`**

The only change from `20260906160000_capacity_guard_on_update.sql`'s `update_event_series` is the status list in the shortening notice (marked `-- CHANGED`):

```sql
/*
 * Shortening a series deletes the occurrences it drops, and their
 * bookings go by cascade (20260825042000 explains the event_id = null
 * outbox trick this relies on). A pending game invite on one of those
 * occurrences is now a booking too; its invitee was told about the game,
 * so they are told it is gone, with the same event_cancelled row as a
 * confirmed or waitlisted member. The one-line change is the status list
 * in the INSERT; everything else is 20260906160000 unmodified.
 */
create or replace function public.update_event_series(
  target_series         uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_start_time        time default null,
  new_duration          int default null,
  new_table_count       int default null,
  new_ends_on           date default null,
  include_overridden    boolean default false,
  clear_ends_on         boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null,
  new_seating_mode      public.seating_mode default null,
  new_capacity          int default null,
  clear_capacity        boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se                  public.event_series;
  club_tz             text;
  eff_title           text;
  eff_venue           uuid;
  eff_notes           text;
  eff_start           time;
  eff_dur             int;
  eff_count           int;
  eff_ends            date;
  eff_check_in        boolean;
  eff_fee             int;
  eff_min_spend       int;
  eff_game_mode       public.game_mode;
  eff_seating_mode    public.seating_mode;
  eff_capacity        int;
  touched_title       boolean;
  touched_venue       boolean;
  touched_notes       boolean;
  touched_time        boolean;
  touched_check_in    boolean;
  touched_fee         boolean;
  touched_min_spend   boolean;
  touched_game_mode   boolean;
  touched_seating_mode boolean;
  touched_capacity    boolean;
begin
  select * into se from public.event_series where id = target_series for update;

  if se.id is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(se.club_id);

  select timezone into club_tz from public.clubs where id = se.club_id;

  eff_title := coalesce(new_title, se.title);
  eff_venue := coalesce(new_venue_id, se.venue_id);
  eff_notes := coalesce(new_notes, se.notes);
  eff_start := coalesce(new_start_time, se.start_time);
  eff_dur   := coalesce(new_duration, se.duration_minutes);
  eff_count := coalesce(new_table_count, se.table_count);
  eff_check_in := coalesce(new_check_in_required, se.check_in_required);
  eff_fee := coalesce(new_fee_cents, se.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, se.min_spend_cents);
  eff_game_mode := coalesce(new_game_mode, se.game_mode);
  eff_seating_mode := coalesce(new_seating_mode, se.seating_mode);
  -- Same clear_capacity-wins precedence as update_event; see the file-level
  -- comment on the capacity null-semantics trap.
  eff_capacity := case when clear_capacity then null
                       else coalesce(new_capacity, se.capacity) end;
  -- `clear_ends_on` wins over `new_ends_on` outright -- there is no reading
  -- of "clear it AND set it to this date" that makes sense, so precedence,
  -- not an error, is the simplest correct answer.
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  -- The new guard (this migration). Mirrors update_event's own, and
  -- create_event_series' sibling create_event's `capacity_limit < 1` check
  -- -- see the file-level comment above.
  if eff_capacity is not null and eff_capacity < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  -- The gate. Compared against `se`, the pre-edit snapshot, and computed
  -- before the UPDATE below overwrites the stored row.
  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;
  touched_check_in := eff_check_in is distinct from se.check_in_required;
  touched_fee := eff_fee is distinct from se.fee_cents;
  touched_min_spend := eff_min_spend is distinct from se.min_spend_cents;
  touched_game_mode := eff_game_mode is distinct from se.game_mode;
  touched_seating_mode := eff_seating_mode is distinct from se.seating_mode;
  touched_capacity := eff_capacity is distinct from se.capacity;

  if eff_venue is distinct from se.venue_id then
    perform public.assert_venue_available(se.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  update public.event_series set
    title            = trim(eff_title),
    venue_id         = eff_venue,
    notes            = eff_notes,
    start_time       = eff_start,
    duration_minutes = eff_dur,
    table_count      = eff_count,
    ends_on          = eff_ends,
    check_in_required = eff_check_in,
    fee_cents        = eff_fee,
    min_spend_cents  = eff_min_spend,
    game_mode        = eff_game_mode,
    seating_mode     = eff_seating_mode,
    capacity         = eff_capacity
  where id = target_series;

  if touched_title then
    update public.events e set title = trim(eff_title)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('notes' = any(e.overrides)));
  end if;

  if touched_check_in then
    update public.events e set check_in_required = eff_check_in
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('check_in_required' = any(e.overrides)));
  end if;

  if touched_fee then
    update public.events e set fee_cents = eff_fee
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('fee_cents' = any(e.overrides)));
  end if;

  if touched_min_spend then
    update public.events e set min_spend_cents = eff_min_spend
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('min_spend_cents' = any(e.overrides)));
  end if;

  if touched_game_mode then
    update public.events e set game_mode = eff_game_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('game_mode' = any(e.overrides)));
  end if;

  if touched_seating_mode then
    update public.events e set seating_mode = eff_seating_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('seating_mode' = any(e.overrides)));
  end if;

  if touched_capacity then
    update public.events e set capacity = eff_capacity
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('capacity' = any(e.overrides)));
  end if;

  -- One guard for both instants: a hand-set 6:30-9:30 week must not keep its
  -- start and silently take the series' new length.
  if touched_time then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  -- Clear only the keys this edit actually changed.
  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'      and touched_title)
        or (k = 'venue_id' and touched_venue)
        or (k = 'notes'    and touched_notes)
        or (k = 'starts_at' and touched_time)
        or (k = 'check_in_required' and touched_check_in)
        or (k = 'fee_cents' and touched_fee)
        or (k = 'min_spend_cents' and touched_min_spend)
        or (k = 'game_mode' and touched_game_mode)
        or (k = 'seating_mode' and touched_seating_mode)
        or (k = 'capacity' and touched_capacity)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run REMOVES what now falls outside it -- see
  -- 20260824000000's file-level comment for why deleting, not cancelling,
  -- is the correct verb and what it buys. `eff_ends is not null` is what
  -- keeps this branch from firing when the run is instead being UNCAPPED
  -- (clear_ends_on, or a plain widening new_ends_on): there is nothing
  -- outside a boundary at infinity. A widening new_ends_on does enter this
  -- branch and matches no rows, which is correct and costs one indexed
  -- delete (plus, now, one indexed select that also matches no rows).
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    -- Told, not just dropped. See the file-level comment above for the
    -- event_id-cascade trap this INSERT has to run ahead of the DELETE to
    -- avoid, and why it is one row per member rather than per booking.
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select distinct on (b.profile_id)
           b.profile_id, b.club_id, null::uuid, 'event_cancelled',
           jsonb_build_object(
             'booking_id', b.id,
             'series_id',  target_series,
             'event_id',   e.id,
             'starts_at',  e.starts_at),
           'series_shortened:' || b.id::text
    from public.bookings b
    join public.events e on e.id = b.event_id
    where e.series_id = target_series
      and e.occurrence_date > eff_ends
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and b.status in ('confirmed', 'waitlisted', 'invited')  -- CHANGED
    order by b.profile_id, e.occurrence_date, b.id
    on conflict (dedupe_key) do nothing;

    delete from public.events
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  -- Extending it, clearing it, or changing nothing, all want the horizon
  -- topped up -- for this series only. With the delete above, this is also
  -- what makes shortening reversible: the freed slots are refilled here the
  -- moment the end date moves back out or goes away.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated per the house
-- rule, with the full argument type list.
revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  to authenticated;
```

- [ ] **Step 7: Write `20260924103200_schedule_close_started_invites.sql`**

```sql
/*
 * Registered alongside sweep-promotion-offers (20260825060000), same
 * cadence and the same unschedule-first guard so re-running against a
 * project that already has the job is not an error. Runs as postgres, the
 * cron schema's owner; close_started_invites is revoked from
 * authenticated in 20260924103000. Job existence is checked with local
 * psql, not pgTAP -- see docs/testing.md, "Scheduled work".
 *
 * Accept, decline and withdraw already refuse once starts_at passes, so
 * the up-to-five minutes before this runs cannot change any outcome; it
 * only stops a dead invite holding a seat in the reads.
 */
do $$
begin
  perform cron.unschedule('close-started-invites');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'close-started-invites',
  '*/5 * * * *',
  $$select public.close_started_invites()$$
);
```

- [ ] **Step 8: Document the job in `docs/testing.md`**

In "Scheduled work", change `Five jobs now run on \`pg_cron\`:` to `Six jobs now run on \`pg_cron\`:` and add this row to the table directly after the `sweep-promotion-offers` row:

```markdown
| `close-started-invites` | `*/5 * * * *` | Closes game invites still pending when their game has started (`cancelled`, no notification) |
```

In the paragraph below the table, change `Four of these five are ordinary plpgsql` to `Five of these six are ordinary plpgsql` (the sweep is tested by calling it, in `booking_invites.test.sql`).

- [ ] **Step 9: Run the tests and watch them pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: every file passes — `booking_invites.test.sql` 68/68, `series_shortening_notifies.test.sql` 9/9, `grants.test.sql` 127/127, and `bookings_cancellation.test.sql` unchanged (Dan cancelling a Carol-booked seat now also writes `booking_cancelled_by_member`, which nothing there counts).

Then confirm the job is registered:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select jobname, schedule from cron.job order by jobname;"`
Expected: a `close-started-invites | */5 * * * *` row alongside the existing five.

- [ ] **Step 10: Commit**

```bash
git add supabase/tests/database/fixtures/booking_invites.test.sql \
  supabase/tests/database/fixtures/series_shortening_notifies.test.sql \
  supabase/tests/database/portable/grants.test.sql \
  supabase/migrations/20260924103000_booking_invite_lifecycle.sql \
  supabase/migrations/20260924103100_series_shortening_tells_the_invited.sql \
  supabase/migrations/20260924103200_schedule_close_started_invites.sql \
  docs/testing.md
git commit -m "$(cat <<'EOF'
feat(db): accept, decline, withdraw and sweep game invites

accept_booking_invite confirms a held seat or queues the invitee at the
back of the waitlist; withdraw_booking_invite lets the sender or an
organizer take an invite back; decline_booking takes invited rows;
cancel_booking tells the sender when an accepted invitee leaves;
cancel_event, cancel_booking_group and series shortening close pending
invites; close_started_invites (cron, every 5 min) closes the rest at
kickoff.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Reads and privacy — who sees a pending invite

**Files:**
- Create: `supabase/tests/database/fixtures/invite_privacy.test.sql`
- Create: `supabase/migrations/20260924104000_invite_reads_and_privacy.sql`
- Modify: `lib/schema-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Decision P1 (user-confirmed), implemented here:
  - **Open play:** pending invitees are visible by name to every member who can see the game (policy and `event_seating` both unmasked).
  - **Invite-only:** another person's `invited` row is readable only by club organizers, the row's `booked_by`, and the invitee — enforced in `bookings_select_member`. `event_seating` (security definer) mirrors it: a viewer who may see the roster but is none of those three gets the held seat as an anonymous row (`profile_id`, `display_name`, `skill_level` null; `status` `'invited'`), so the seat still draws as taken.
  - **Invite-only roster unlock** becomes "accepted and holding a seat": `event_has_my_placed_seat(uuid)` keeps its name (three policies call it) but now means "the caller has a `confirmed` booking on this event, with or without a table". Waitlisted and invited never unlock. A pending invitee sees the game and the headcount only.
- Produces (ACLs restated: `revoke ... from public, anon` + `grant ... to authenticated`; `event_seating` / `my_upcoming_bookings` also revoke `authenticated` before the grant, as their originals did):
  - `event_has_my_active_booking(target_event uuid) returns boolean` — `confirmed | waitlisted | invited`.
  - `event_has_my_placed_seat(target_event uuid) returns boolean` — `status = 'confirmed'` for the caller.
  - Policy `bookings_select_member` on `public.bookings` (recreated).
  - `event_seating(target_event uuid)` — drop + create; returns `invited` rows too and a new trailing column `invite_holds_seat boolean`; `waitlist_position` null on invited rows.
  - `event_accepted_count(target_event uuid) returns int` — visibility gate admits an invitee (via `event_has_my_active_booking`); the count stays `confirmed + waitlisted`.
  - `my_upcoming_bookings()` — drop + create; returns `invited` rows (until kickoff) and a new trailing column `invite_holds_seat boolean`; `offer_*` and `waitlist_position` null on invited rows (both describe the sender's group).
- Unchanged, deliberately: `events_select_member` (reaches bookings only through `event_has_my_active_booking`), `booking_groups_select_member` / `table_rounds` policies (they call `event_has_my_placed_seat` and so follow its new meaning), `event_attendance`, `queue_event_reminders`, `broadcast_recipients`, `can_read_thread`, `can_post_thread`, `open_thread_for_event`, `fetch_my_threads`, `record_attendance`, `record_round` — all filter on explicit statuses that exclude `invited`.
- Existing tests that keep passing unchanged: `event_visibility_and_privacy.test.sql` and `bookings_privacy.test.sql` (their "not-yet-placed" confirmed member is the only booking on the event at the moment each count is taken, so the new unlock rule changes no number).

- [ ] **Step 1: Write the failing privacy test**

Create `supabase/tests/database/fixtures/invite_privacy.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(21);

/*
 * Who sees a pending game invite (P1, 2026-09-24).
 *
 * E1 (invite-only, Table 1):
 *   Dan   confirmed at Table 1     (booked by Alice)
 *   Erin  confirmed, no table      (booked by Alice)
 *   Fred  waitlisted               (his own group)
 *   Carol INVITED, seat held at Table 1, sent by Bob -- a plain member,
 *         so "the sender" is tested apart from "an organizer"
 * E2 (open play, Table 2):
 *   Gina  INVITED, seat held at Table 2, sent by Alice
 * Hank is a member with no booking anywhere.
 */
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fd01', 'ip-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fd02', 'ip-bob@example.com'),
  ('cccccccc-0000-0000-0000-00000000fd03', 'ip-carol@example.com'),
  ('dddddddd-0000-0000-0000-00000000fd04', 'ip-dan@example.com'),
  ('eeeeeeee-0000-0000-0000-00000000fd05', 'ip-erin@example.com'),
  ('ffffffff-0000-0000-0000-00000000fd06', 'ip-fred@example.com'),
  ('99999999-0000-0000-0000-00000000fd07', 'ip-gina@example.com'),
  ('88888888-0000-0000-0000-00000000fd08', 'ip-hank@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fd01', 'Invite Privacy Club',
   'invite-privacy-club', 'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-00000000fd01', id,
       case when id = 'aaaaaaaa-0000-0000-0000-00000000fd01'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users
where email like 'ip-%';

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000fd01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, status, game_mode, created_by
) values
  ('22222222-0000-0000-0000-00000000fd01', 'c1c1c1c1-0000-0000-0000-00000000fd01',
   'Private Game', '11111111-0000-0000-0000-00000000fd01',
   now() + interval '1 day', now() + interval '1 day 3 hours', 'published',
   'invite_only', 'aaaaaaaa-0000-0000-0000-00000000fd01'),
  ('22222222-0000-0000-0000-00000000fd02', 'c1c1c1c1-0000-0000-0000-00000000fd01',
   'Open Game', '11111111-0000-0000-0000-00000000fd01',
   now() + interval '1 day', now() + interval '1 day 3 hours', 'published',
   'open_play', 'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', 'Table 1', 1),
  ('44444444-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01', 'Table 2', 1);

insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01', 'confirmed', null),
  ('55555555-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'bbbbbbbb-0000-0000-0000-00000000fd02', 'confirmed', null),
  ('55555555-0000-0000-0000-00000000fd03', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'ffffffff-0000-0000-0000-00000000fd06', 'waitlisted', now()),
  ('55555555-0000-0000-0000-00000000fd04', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01', 'confirmed', null);

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  -- Dan: confirmed at Table 1.
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd01',
   'dddddddd-0000-0000-0000-00000000fd04', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'confirmed', null),
  -- Erin: confirmed, any table.
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', null,
   'eeeeeeee-0000-0000-0000-00000000fd05', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'confirmed', null),
  -- Fred: waitlisted.
  ('55555555-0000-0000-0000-00000000fd03', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', null,
   'ffffffff-0000-0000-0000-00000000fd06', 'ffffffff-0000-0000-0000-00000000fd06',
   'waitlisted', null),
  -- Carol: invited by Bob, seat held at Table 1.
  ('55555555-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd01',
   'cccccccc-0000-0000-0000-00000000fd03', 'bbbbbbbb-0000-0000-0000-00000000fd02',
   'invited', true),
  -- Gina: invited by Alice to the open game, seat held at Table 2.
  ('55555555-0000-0000-0000-00000000fd04', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd02',
   '99999999-0000-0000-0000-00000000fd07', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'invited', true);

set local role authenticated;

-- ---------------------------------------------------------------------
-- Dan: seated on the invite-only game. Sees the roster; sees that a seat
-- is held; does not see for whom.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000fd04", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status = 'invited'),
  0,
  'invite-only: a seated member cannot read another member''s pending invite');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status in ('confirmed', 'waitlisted')),
  3,
  'but reads every accepted booking');
select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  4,
  'event_seating still returns the held seat, so it draws as taken');
select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status = 'invited' and profile_id is null
      and display_name is null and skill_level is null),
  1,
  'as an anonymous row');

-- ---------------------------------------------------------------------
-- Erin: confirmed with no table. "Accepted and holding a seat" unlocks.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-00000000fd05", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status <> 'invited'),
  3,
  'a confirmed booking with no table unlocks the invite-only roster');
select ok(
  public.event_has_my_placed_seat('22222222-0000-0000-0000-00000000fd01'),
  'event_has_my_placed_seat now means confirmed, table or not');

-- ---------------------------------------------------------------------
-- Fred: waitlisted. Does not unlock.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "ffffffff-0000-0000-0000-00000000fd06", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  1,
  'a waitlisted member sees only their own row in event_seating');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  1,
  'and reads only their own booking');

-- ---------------------------------------------------------------------
-- Carol: the invitee. Sees the game and the headcount, and her own row.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000fd03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
    where id = '22222222-0000-0000-0000-00000000fd01'),
  1,
  'a pending invitee can see the invite-only game');
select is(
  (select array_agg(profile_id) from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  array['cccccccc-0000-0000-0000-00000000fd03']::uuid[],
  'but sees only her own row, named');
select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000fd01'),
  3,
  'and the headcount, which leaves pending invites out');
select ok(
  not public.event_has_my_placed_seat('22222222-0000-0000-0000-00000000fd01'),
  'a pending invite never unlocks the roster');
select is(
  (select status::text || ':' || invite_holds_seat::text
     from public.my_upcoming_bookings()
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  'invited:true',
  'my_upcoming_bookings lists the pending invite and says a seat is held');
select ok(
  (select waitlist_position is null and offer_id is null
          and booked_by = 'bbbbbbbb-0000-0000-0000-00000000fd02'
     from public.my_upcoming_bookings()
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  'naming the sender, with no queue place or offer of the sender''s group');

-- ---------------------------------------------------------------------
-- Bob: the sender, not an organizer, not playing.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000fd02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and profile_id = 'cccccccc-0000-0000-0000-00000000fd03'),
  1,
  'the sender reads the invite he sent');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status <> 'invited'),
  0,
  'and nothing else on a game he is not in');

-- ---------------------------------------------------------------------
-- Alice: the organizer sees everything, named.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000fd01", "role": "authenticated"}';

select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status = 'invited'),
  'cccccccc-0000-0000-0000-00000000fd03'::uuid,
  'the organizer sees who is invited');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  4,
  'and reads every row');

-- ---------------------------------------------------------------------
-- Hank, open play: pending invitees are shown by name to everyone.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "88888888-0000-0000-0000-00000000fd08", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd02'
      and status = 'invited'),
  1,
  'open play: any member reads a pending invite');
select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000fd02')
    where status = 'invited'),
  '99999999-0000-0000-0000-00000000fd07'::uuid,
  'by name');
select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000fd02'),
  0,
  'and the headcount leaves the pending invite out');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `invite_privacy.test.sql` fails — among others, Dan reads Carol's invited row (the placed-seat branch still lets him), `event_seating` returns no invited rows, Erin's roster is locked (no table), Carol cannot see E1 and gets a null headcount, `my_upcoming_bookings` returns no invited row.

- [ ] **Step 3: Write `20260924104000_invite_reads_and_privacy.sql`**

Bodies are based on the latest definitions: `event_has_my_active_booking`, `event_has_my_placed_seat`, `bookings_select_member` from `20260905080000_bookings_privacy.sql`; `event_seating`, `event_accepted_count` from `20260905070000_event_visibility_and_privacy.sql`; `my_upcoming_bookings` from `20260903150000_my_upcoming_bookings_fees.sql`.

```sql
/*
 * Game invites, reads and privacy (user decision P1, 2026-09-24).
 *
 * Open play: a pending invitee is shown by name to every member who can
 * see the game, the same as a confirmed player.
 *
 * Invite-only: another person's pending invite is visible only to the
 * club's organizers, its sender (booked_by) and its invitee -- enforced in
 * bookings_select_member below, not just in the UI. event_seating mirrors
 * it for the roster: anybody else who may see the roster gets the held
 * seat as an anonymous 'invited' row, so it still draws as taken.
 *
 * The invite-only roster now unlocks on "accepted and holding a seat"
 * (confirmed, with or without a table) instead of "placed at a table".
 * event_has_my_placed_seat keeps its name -- bookings_select_member,
 * booking_groups_select_member and the table_rounds policy all call it --
 * and takes the new meaning. Waitlisted and invited never unlock.
 */

-- ---------------------------------------------------------------------
-- A pending invite makes an invite-only game visible to its invitee.
-- events_select_member reaches bookings only through this function, so
-- this one list is the whole visibility change.
-- ---------------------------------------------------------------------
create or replace function public.event_has_my_active_booking(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and status in ('confirmed', 'waitlisted', 'invited')
  );
$$;

revoke execute on function public.event_has_my_active_booking(uuid) from public, anon;
grant execute on function public.event_has_my_active_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- "Accepted and holding a seat": a confirmed booking, table or not.
-- Formerly "confirmed or waitlisted AND placed at a table" (20260905080000).
-- ---------------------------------------------------------------------
create or replace function public.event_has_my_placed_seat(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and status = 'confirmed'
  );
$$;

comment on function public.event_has_my_placed_seat(uuid) is
  'True when the caller holds a CONFIRMED booking on the event, with or '
  'without a table: "accepted and holding a seat". Unlocks the invite-only '
  'roster (bookings, booking_groups, table_rounds, event_seating). '
  'Waitlisted and invited bookings never unlock. Name kept from '
  '20260905080000, when it meant "placed at a table".';

revoke execute on function public.event_has_my_placed_seat(uuid) from public, anon;
grant execute on function public.event_has_my_placed_seat(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- bookings_select_member: in open play every member reads every row (as
-- before). Otherwise an 'invited' row is readable by an organizer, its
-- invitee, or its sender -- never through the roster unlock -- while
-- every other row keeps its 20260905080000 rule.
-- ---------------------------------------------------------------------
drop policy bookings_select_member on public.bookings;

create policy bookings_select_member on public.bookings
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = bookings.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      or profile_id = auth.uid()
      or (status = 'invited' and booked_by = auth.uid())
      or (status <> 'invited'
          and public.event_has_my_placed_seat(bookings.event_id))
    )
  );

-- ---------------------------------------------------------------------
-- event_seating: invited rows too, plus invite_holds_seat (the app needs
-- it to tell a held "any table" invite from one that would join the
-- waitlist -- both have a null table). Drop + create: a new OUT column
-- changes the return type (42P13). No SQL object references it.
--
-- Visibility: open play, an organizer, or any active booking of the
-- caller's (invited included -- the invitee sees the game).
-- Rows: open play and organizers get every row; otherwise the full list
-- only once the caller is confirmed (event_has_my_placed_seat), plus the
-- caller's own row and any invite the caller sent.
-- Names: an invited row names its invitee only in open play, or to an
-- organizer, its sender or its invitee; anybody else gets it anonymous.
-- Invited rows carry no waitlist_position: the group's queue place is not
-- theirs until they accept.
-- ---------------------------------------------------------------------
drop function if exists public.event_seating(uuid);

create function public.event_seating(target_event uuid)
returns table (
  booking_id        uuid,
  group_id          uuid,
  profile_id        uuid,
  display_name      text,
  skill_level       public.skill_level,
  event_table_id    uuid,
  status            public.booking_status,
  booked_by         uuid,
  booked_by_name    text,
  group_status      public.booking_group_status,
  waitlist_position int,
  created_at        timestamptz,
  invite_holds_seat boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with ev as (
    select id, club_id, game_mode from public.events where id = target_event
  )
  select
    b.id,
    b.group_id,
    case when v.named then b.profile_id end,
    case when v.named then p.display_name end,
    case when v.named then p.skill_level end,
    b.event_table_id,
    b.status,
    b.booked_by,
    bp.display_name,
    g.status,
    case when b.status = 'invited' or g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    b.created_at,
    b.invite_holds_seat
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.profiles p  on p.id = b.profile_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  cross join ev
  cross join lateral (
    select (
      ev.game_mode = 'open_play'
      or b.status <> 'invited'
      or b.profile_id = auth.uid()
      or b.booked_by  = auth.uid()
      or public.is_club_organizer(ev.club_id)
    ) as named
  ) v
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted', 'invited')
    and public.is_club_member(ev.club_id)
    -- Visibility: same test as events_select_member, re-asked here
    -- because this function bypasses RLS. An invitee passes.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or public.event_has_my_active_booking(target_event)
    )
    -- Roster privacy, invite-only: the full list once the caller is
    -- confirmed; otherwise their own row and the invites they sent.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or public.event_has_my_placed_seat(target_event)
      or b.profile_id = auth.uid()
      or b.booked_by = auth.uid()
    )
  order by t.position nulls last, b.created_at, b.id;
$$;

revoke execute on function public.event_seating(uuid) from public, anon, authenticated;
grant execute on function public.event_seating(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- event_accepted_count: an invitee on an invite-only game gets the
-- headcount (routed through event_has_my_active_booking). The COUNT is
-- unchanged -- a pending invite has not accepted anything.
-- ---------------------------------------------------------------------
create or replace function public.event_accepted_count(target_event uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case when exists (
    select 1 from public.events e
    where e.id = target_event
      and public.is_club_member(e.club_id)
      and (
        e.game_mode = 'open_play'
        or public.is_club_organizer(e.club_id)
        or public.event_has_my_active_booking(target_event)
      )
  )
  then (
    select count(*)::int from public.bookings b
    where b.event_id = target_event and b.status in ('confirmed', 'waitlisted')
  )
  else null end;
$$;

revoke execute on function public.event_accepted_count(uuid) from public, anon;
grant execute on function public.event_accepted_count(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- my_upcoming_bookings: pending invites are the source of the dashboard's
-- Accept / Decline card, so they come back too, with the sender
-- (booked_by / booked_by_name, already present) and invite_holds_seat.
-- For an invited row the offer and waitlist columns are null (both
-- describe the SENDER's group), and the row stops appearing at kickoff
-- rather than at ends_at -- nothing can be done with it once the game has
-- started. Drop + create: a new OUT column (42P13), same dance as
-- 20260827070000 and 20260903150000.
-- ---------------------------------------------------------------------
drop function if exists public.my_upcoming_bookings();

create function public.my_upcoming_bookings()
returns table (
  booking_id       uuid,
  group_id         uuid,
  event_id         uuid,
  club_id          uuid,
  club_name        text,
  event_title      text,
  starts_at        timestamptz,
  club_timezone    text,
  venue_name       text,
  event_table_id   uuid,
  table_label      text,
  status           public.booking_status,
  booked_by        uuid,
  booked_by_name   text,
  offer_id         uuid,
  offer_seats      int,
  offer_expires_at timestamptz,
  waitlist_position  int,
  check_in_required  boolean,
  check_in_state     public.attendance_state,
  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,
  fee_cents          int,
  min_spend_cents    int,
  invite_holds_seat  boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id, b.group_id, b.event_id, b.club_id, c.name, e.title, e.starts_at,
    c.timezone, v.name, b.event_table_id, t.label, b.status,
    b.booked_by, bp.display_name,
    po.id, po.offered_seat_count, po.expires_at,
    case when b.status = 'invited' or g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    e.check_in_required,
    ci.state,
    case when e.check_in_required
         then e.starts_at - interval '1 hour' end,
    case when e.check_in_required then e.ends_at end,
    e.fee_cents,
    e.min_spend_cents,
    b.invite_holds_seat
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
   and b.status <> 'invited'
  left join public.check_ins ci
    on ci.event_id = b.event_id and ci.profile_id = b.profile_id
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted', 'invited')
    and e.status = 'published'
    and e.ends_at > now()
    and (b.status <> 'invited' or e.starts_at > now())
  order by e.starts_at, c.name;
$$;

revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant execute on function public.my_upcoming_bookings() to authenticated;
```

- [ ] **Step 4: Run the DB suite and watch it pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: every file passes — `invite_privacy.test.sql` 21/21, and `event_visibility_and_privacy.test.sql` (10), `bookings_privacy.test.sql` (12), `grants.test.sql` (127) unchanged.

- [ ] **Step 5: Update the contract test**

In `lib/schema-contract.test.ts`, in `'returns event_seating rows with the column names SeatOccupant claims'`, replace the expected key list:

```ts
      expect(Object.keys(rows[0]!).sort()).toEqual(
        [
          'booked_by', 'booked_by_name', 'booking_id', 'created_at',
          'display_name', 'event_table_id', 'group_id', 'group_status',
          'invite_holds_seat', 'profile_id', 'skill_level', 'status',
          'waitlist_position',
        ].sort(),
      );
```

(The `expect(['confirmed', 'waitlisted']).toContain(rows[0]!.status)` line below it stays: that fixture's row is the caller's own confirmed seat.)

Then, directly after the `'serializes the check-in window as parseable timestamps checkInOpen agrees with'` test (same `describe`), add:

```ts
  it('returns invite_holds_seat on my_upcoming_bookings rows, null for an ordinary booking', async () => {
    const { data, error } = await supabase.rpc('my_upcoming_bookings');
    expect(error, `my_upcoming_bookings failed: ${error?.message}`).toBeNull();
    const rows = data as Record<string, unknown>[];
    const row = rows.find((r) => r.event_id === eventId);
    expect(row, 'my_upcoming_bookings did not return the seeded booking').toBeDefined();
    // Present as a key (MyBooking.invite_holds_seat), and null because this
    // seeded booking is confirmed, not a pending invite.
    expect(row).toHaveProperty('invite_holds_seat');
    expect(row!.invite_holds_seat).toBeNull();
  });
```

- [ ] **Step 6: Run the contract tests**

Run: `npm run test:contract`
Expected: pass (the local stack must be up — `npx supabase start` if it is not).

- [ ] **Step 7: Commit**

```bash
git add supabase/tests/database/fixtures/invite_privacy.test.sql \
  supabase/migrations/20260924104000_invite_reads_and_privacy.sql \
  lib/schema-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(db): read pending invites, private on invite-only games

event_seating and my_upcoming_bookings return invited rows with
invite_holds_seat. Open play shows invitees by name; on invite-only
games only organizers, the sender and the invitee see who is invited
(bookings_select_member, mirrored by event_seating's anonymous held
seat). The invite-only roster now unlocks on a confirmed booking, table
or not; an invitee sees the game and the headcount.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Notifications — four new emails, the declined email reworded, the Alerts feed

**Files:**
- Create: `supabase/tests/database/fixtures/invite_notifications.test.sql`
- Create: `supabase/migrations/20260924105000_outbox_render_context_accepted_by.sql`
- Modify: `supabase/functions/deliver-notifications/types.ts`
- Modify: `supabase/functions/deliver-notifications/templates/bodies.ts`
- Modify: `supabase/functions/deliver-notifications/__tests__/render.test.ts`
- Modify: `lib/notifications.ts`
- Modify: `lib/notifications.test.ts`

**Interfaces:**
- Consumes: the payloads written in Tasks 3–4:

| kind | recipient | payload | actor resolves from |
|---|---|---|---|
| `booking_invited` | invitee | `{booking_id, booked_by, holds_seat, event_table_id}` | `booked_by` (already in the coalesce) |
| `booking_invite_accepted` | sender | `{booking_id, accepted_by, waitlisted}` | `accepted_by` (NEW, P3) |
| `booking_invite_withdrawn` | invitee | `{booking_id, cancelled_by}` | `cancelled_by` (already) |
| `booking_cancelled_by_member` | sender | `{booking_id, cancelled_by}` | `cancelled_by` (already) |
| `booking_declined` (existing) | sender | `{booking_id, declined_by}` | `declined_by` (already) |

- Produces: `outbox_render_context(p_ids uuid[])` resolves `actor_name` from `payload->>'accepted_by'` too (between `declined_by` and `cancelled_by`). `claim_notification_batch` (`20260826060000`) and `fetch_my_notifications` (`20260830050000_alerts_feed.sql`) both `select ... from public.outbox_render_context(...)` and resolve no actor of their own, so they pick the change up without being redefined.
- Produces: `OutboxKind` (both `supabase/functions/deliver-notifications/types.ts` and `lib/notifications.ts`) gains `'booking_invited' | 'booking_invite_accepted' | 'booking_invite_withdrawn' | 'booking_cancelled_by_member'`; `bodyFor` and `describeNotification` handle all four (their `never` exhaustiveness guards make `tsc` fail otherwise).
- Copy (spec table): invited — subject "*Sender* invited you to *game*"; accepted — "*Invitee* is in for *game*"; declined — subject unchanged ("*Invitee* can't make *game*"), body now "declined your invite"; withdrawn — "Your invite to *game* was withdrawn"; member-cancel — subject "*Invitee* can't make *game* anymore", body "… can't make *game* anymore — their seat is open."
- `outbox_quiet_class` / `outbox_expires_at` need no change: their `else` branches give a new kind "never held" and "expires at kickoff", which is right for all four.

- [ ] **Step 1: Write the failing render-context test**

Create `supabase/tests/database/fixtures/invite_notifications.test.sql`:

```sql
begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fe01', 'rn-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fe02', 'rn-bob@example.com');

update public.profiles set display_name = 'Alice A.'
 where id = 'aaaaaaaa-0000-0000-0000-00000000fe01';
update public.profiles set display_name = 'Bob B.'
 where id = 'bbbbbbbb-0000-0000-0000-00000000fe02';

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fe01', 'Render Club', 'render-club',
   'aaaaaaaa-0000-0000-0000-00000000fe01');

-- Alice sent the invite; Bob is the invitee. Rows are shaped exactly as
-- commit_booking / accept_booking_invite / withdraw_booking_invite /
-- cancel_booking write them (20260924102000, 20260924103000).
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-00000000fe01',
   'aaaaaaaa-0000-0000-0000-00000000fe01',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invite_accepted',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'accepted_by', 'bbbbbbbb-0000-0000-0000-00000000fe02',
                      'waitlisted', false),
   'test:booking_invite_accepted'),
  ('0b0b0b0b-0000-0000-0000-00000000fe02',
   'bbbbbbbb-0000-0000-0000-00000000fe02',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invited',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'booked_by', 'aaaaaaaa-0000-0000-0000-00000000fe01',
                      'holds_seat', true),
   'test:booking_invited'),
  ('0b0b0b0b-0000-0000-0000-00000000fe03',
   'bbbbbbbb-0000-0000-0000-00000000fe02',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invite_withdrawn',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'cancelled_by', 'aaaaaaaa-0000-0000-0000-00000000fe01'),
   'test:booking_invite_withdrawn'),
  ('0b0b0b0b-0000-0000-0000-00000000fe04',
   'aaaaaaaa-0000-0000-0000-00000000fe01',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_cancelled_by_member',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'cancelled_by', 'bbbbbbbb-0000-0000-0000-00000000fe02'),
   'test:booking_cancelled_by_member');

select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe01']::uuid[])),
  'Bob B.',
  'an accepted invite names the invitee who accepted');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe02']::uuid[])),
  'Alice A.',
  'an invite names its sender');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe03']::uuid[])),
  'Alice A.',
  'a withdrawn invite names who withdrew it');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe04']::uuid[])),
  'Bob B.',
  'a member-cancel names the member who left');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch the first assertion fail**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `invite_notifications.test.sql` fails assertion 1 (`actor_name` is null — nothing reads `accepted_by`); 2–4 already pass.

- [ ] **Step 3: Write `20260924105000_outbox_render_context_accepted_by.sql`**

Copied verbatim from `20260826050000_outbox_render_context.sql` (its only definition) with one key added to the actor coalesce:

```sql
/*
 * Game invites (P3): booking_invite_accepted (20260924103000) names the
 * invitee who accepted under payload key accepted_by. The actor coalesce
 * learns that key; nothing else changes. claim_notification_batch
 * (20260826060000) and fetch_my_notifications (20260830050000) both read
 * actor_name through this function, so neither is redefined.
 */
create or replace function public.outbox_render_context(p_ids uuid[])
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  recipient_id      uuid,
  recipient_name    text,
  recipient_email   text,
  channel           text,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
  -- Whoever did the thing this message is about: booked the seat, declined
  -- it, or cancelled it. "Alice saved you a seat" is a different email from
  -- "someone saved you a seat".
  actor_name        text,
  broadcast_subject text,
  broadcast_body    text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.kind,
         o.payload,
         o.recipient_id,
         p.display_name,
         u.email,
         public.resolve_notify_channel(o.recipient_id),
         o.club_id,
         c.name,
         o.event_id,
         e.title,
         /*
          * 20260825042000 (series shortening) writes event_cancelled rows
          * with event_id = null on purpose -- the dropped occurrence is
          * deleted in the same transaction, and an outbox row still
          * pointing at it would cascade-delete right along with it. That
          * migration carries the occurrence's starts_at in the payload
          * for exactly this: so the fact survives the row that caused it.
          * Guarded with pg_input_is_valid rather than a bare ::timestamptz
          * cast -- most kinds carry no 'starts_at' key at all, and an
          * unguarded cast raises 22P02 on a missing or malformed value,
          * killing the whole batch over one oddly-shaped message.
          *
          * event_title is deliberately left NULL here, not backfilled the
          * same way: the event row is gone and that payload never
          * captured a title, so there is nothing to fall back to. The
          * template layer already degrades to "A game" / "the game" for
          * a null title.
          */
         coalesce(
           e.starts_at,
           case when pg_input_is_valid(o.payload->>'starts_at', 'timestamptz')
                then (o.payload->>'starts_at')::timestamptz
                end
         ),
         c.timezone,
         t.label,
         pa.display_name,
         bc.subject,
         bc.body,
         o.created_at
    from public.notification_outbox o
    join public.profiles p on p.id = o.recipient_id
    join auth.users      u on u.id = o.recipient_id
    join public.clubs    c on c.id = o.club_id
    left join public.events e on e.id = o.event_id
    /*
     * Compared as text, deliberately. Casting `payload->>'booking_id'` to
     * uuid would raise 22P02 for any kind whose payload has no such key or
     * whose value is not a uuid — killing the whole batch because one
     * message had a differently shaped payload. Text comparison simply
     * misses instead.
     */
    left join public.bookings bk
           on bk.id::text = o.payload->>'booking_id'
    left join public.event_tables t
           on t.id::text = coalesce(o.payload->>'event_table_id',
                                    bk.event_table_id::text)
    left join public.broadcasts bc
           on bc.id::text = o.payload->>'broadcast_id'
    /*
     * The actor, whichever key this kind uses to name them. coalesce rather
     * than three joins because exactly one of these is ever present and the
     * templates only ever want "who did this".
     *
     * bk.cancelled_by is a fourth, lower-priority source, not a fourth
     * payload key: cancel_event (20260825040000) sets bookings.cancelled_by
     * to the host who cancelled but writes only {'booking_id': ...} into
     * the payload, so event_cancelled rows from that path had no actor at
     * all -- inconsistent with booking_cancelled_by_host, which duplicates
     * its actor into the payload on purpose. bk is already joined on
     * booking_id, so this reaches the same fact without a new join. The
     * series-shortening event_cancelled rows (20260825042000) carry no
     * booking_id that still resolves -- the booking row is cascade-deleted
     * along with the occurrence -- so bk is null there and this fallback
     * stays null too, which is correct: nobody "cancelled" that occurrence,
     * it was dropped by shortening the series.
     *
     * Gated to `o.kind = 'event_cancelled'`, not left open to every kind.
     * bk.cancelled_by is read live, at render time -- not snapshotted when
     * the outbox row was queued -- and `waitlist_promoted` (20260825010000,
     * 20260825100000) and `unseated` (20260825040000) both write
     * {'booking_id': ...} with no actor key, the same payload shape this
     * fallback targets. A promoted member's booking can be cancelled while
     * their waitlist_promoted row is still waiting to drain -- the lease,
     * backoff and quiet-hour holds can leave it queued for a while -- and
     * an unscoped fallback would then name whoever cancelled the booking
     * as the person who promoted them. Scoping to the one kind that
     * actually wants this fact keeps the other kinds' "no actor" correctly
     * null.
     *
     * bk.booked_by is deliberately NOT added here at all. It is reachable
     * through the same join, but for 'unseated' (20260825040000's
     * remove_event_table) it would name the wrong person: booked_by is
     * whoever originally booked the seat, not the host who removed the
     * table, and that kind's payload carries no actor key precisely
     * because removing a table has no per-recipient actor to name.
     * Payload keys still win over the bk.cancelled_by fallback: it is
     * checked last.
     */
    left join public.profiles pa
           on pa.id::text = coalesce(
                o.payload->>'booked_by',
                o.payload->>'declined_by',
                -- accept_booking_invite (20260924103000) names the invitee
                -- who accepted. Checked after booked_by: that row's
                -- booked_by is not in its payload, so there is no clash.
                o.payload->>'accepted_by',
                o.payload->>'cancelled_by',
                case when o.kind = 'event_cancelled'
                     then bk.cancelled_by::text end)
   where o.id = any(p_ids);
$$;

revoke execute on function public.outbox_render_context(uuid[])
  from public, anon, authenticated;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx supabase db reset --local && npm run test:db`
Expected: every file passes; `invite_notifications.test.sql` 4/4; `notification_claim.test.sql` and `alerts_feed.test.sql` unchanged.

- [ ] **Step 5: Write the failing template tests**

In `supabase/functions/deliver-notifications/__tests__/render.test.ts`:

1. Append the four kinds to `ALL_KINDS`:

```ts
const ALL_KINDS: OutboxKind[] = [
  'booked_by_friend',
  'booking_declined',
  'booking_cancelled_by_host',
  'waitlist_promoted',
  'promotion_offer',
  'promotion_offer_expired',
  'unseated',
  'event_cancelled',
  'need_a_fourth',
  'event_reminder',
  'broadcast',
  'attendance_declined',
  'booking_invited',
  'booking_invite_accepted',
  'booking_invite_withdrawn',
  'booking_cancelled_by_member',
];
```

2. In `DISTINGUISHING_CONTENT`, replace the `booking_declined` entry and append four entries, so the relevant lines read:

```ts
    { kind: 'booking_declined', field: 'text', phrase: 'declined your invite' },
```

and, after the `attendance_declined` entry:

```ts
    { kind: 'booking_invited', field: 'subject', phrase: 'invited you to' },
    { kind: 'booking_invite_accepted', field: 'subject', phrase: 'is in for' },
    { kind: 'booking_invite_withdrawn', field: 'subject', phrase: 'was withdrawn' },
    { kind: 'booking_cancelled_by_member', field: 'text', phrase: 'their seat is open' },
```

(In the comment above the table, "covers all eleven" → "covers all sixteen".)

3. Add these tests inside `describe('renderMessage', ...)`, after the `DISTINGUISHING_CONTENT` test:

```ts
  it('tells an invitee to a full game that accepting joins the waitlist', () => {
    const held = renderMessage(
      row({ kind: 'booking_invited', payload: { holds_seat: true } }),
      APP,
    );
    const full = renderMessage(
      row({ kind: 'booking_invited', table_label: null, payload: { holds_seat: false } }),
      APP,
    );
    expect(held.subject).toBe('Alice invited you to Tuesday night');
    expect(held.text).toContain('at Table 2');
    expect(held.text).toContain('A seat is held for you');
    expect(full.text).toContain('accepting puts you on the waitlist');
    expect(full.text).not.toContain('A seat is held');
  });

  it('says an accepted invite landed on the waitlist when it did', () => {
    const seated = renderMessage(
      row({ kind: 'booking_invite_accepted', payload: { waitlisted: false } }),
      APP,
    );
    const waiting = renderMessage(
      row({ kind: 'booking_invite_accepted', table_label: null, payload: { waitlisted: true } }),
      APP,
    );
    expect(seated.subject).toBe('Alice is in for Tuesday night');
    expect(seated.text).not.toContain('waitlist');
    expect(waiting.text).toContain("they're on the waitlist");
  });

  it('links a withdrawn invite to the club, not the game it can no longer see', () => {
    const r = row({ kind: 'booking_invite_withdrawn' });
    const message = renderMessage(r, APP);
    expect(message.subject).toBe('Your invite to Tuesday night was withdrawn');
    expect(message.text).toContain(`${APP}/clubs/${r.club_id}`);
    expect(message.text).not.toContain(`/events/${r.event_id}`);
  });

  it('tells the sender when an accepted invitee drops out', () => {
    const message = renderMessage(row({ kind: 'booking_cancelled_by_member' }), APP);
    expect(message.subject).toBe("Alice can't make Tuesday night anymore");
    expect(message.text).toContain("can't make Tuesday night");
    expect(message.text).toContain('their seat is open');
  });

  it('does not tell an invitee they hold a seat in the footer', () => {
    const message = renderMessage(row({ kind: 'booking_invited' }), APP);
    expect(message.text).not.toContain('a seat you hold');
  });
```

In `lib/notifications.test.ts`, replace the `booking_declined` test:

```ts
  it('booking_declined', () => {
    const result = describeNotification(row({ kind: 'booking_declined', actor_name: 'Ben' }));
    expect(result.headline).toBe('Invite declined');
    expect(result.detail).toContain('Ben declined your invite');
  });
```

and add, after the `attendance_declined` test in the same `describe`:

```ts
  it('booking_invited: names the sender and says the seat is held', () => {
    const result = describeNotification(
      row({ kind: 'booking_invited', actor_name: 'Ada', table_label: 'Table 2', payload: { holds_seat: true } }),
    );
    expect(result.headline).toBe("You're invited");
    expect(result.detail).toContain('Ada invited you to');
    expect(result.detail).toContain('at Table 2');
    expect(result.detail).toContain('Your seat is held');
    expect(result.href).toBe('/clubs/club-1/events/event-1');
  });

  it('booking_invited: into a full game, says accepting joins the waitlist', () => {
    const result = describeNotification(
      row({ kind: 'booking_invited', actor_name: 'Ada', payload: { holds_seat: false } }),
    );
    expect(result.detail).toContain('accepting puts you on the waitlist');
  });

  it('booking_invite_accepted', () => {
    const result = describeNotification(row({ kind: 'booking_invite_accepted', actor_name: 'Ben' }));
    expect(result.headline).toBe('Invite accepted');
    expect(result.detail).toContain('Ben is in for');
  });

  it('booking_invite_withdrawn: links to the club, not the game', () => {
    const result = describeNotification(row({ kind: 'booking_invite_withdrawn', actor_name: 'Cara' }));
    expect(result.headline).toBe('Invite withdrawn');
    expect(result.detail).toContain('Cara withdrew your invite');
    expect(result.href).toBe('/clubs/club-1');
  });

  it('booking_cancelled_by_member', () => {
    const result = describeNotification(row({ kind: 'booking_cancelled_by_member', actor_name: 'Ben' }));
    expect(result.headline).toBe('A seat opened up');
    expect(result.detail).toContain("Ben can't make");
    expect(result.detail).toContain('their seat is open');
  });
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npm test -- supabase/functions/deliver-notifications/__tests__/render.test.ts lib/notifications.test.ts`
Expected: FAIL — the four kinds hit `unhandledKind` ("bodyFor: unhandled notification kind") / fall through `describeNotification`, and the `booking_declined` copy assertions fail.

- [ ] **Step 7: Extend the kind unions**

In `supabase/functions/deliver-notifications/types.ts` AND in `lib/notifications.ts` (lines 8–20), the `OutboxKind` union becomes:

```ts
export type OutboxKind =
  | 'booked_by_friend'
  | 'booking_declined'
  | 'booking_cancelled_by_host'
  | 'waitlist_promoted'
  | 'promotion_offer'
  | 'promotion_offer_expired'
  | 'unseated'
  | 'event_cancelled'
  | 'need_a_fourth'
  | 'event_reminder'
  | 'broadcast'
  | 'attendance_declined'
  | 'booking_invited'
  | 'booking_invite_accepted'
  | 'booking_invite_withdrawn'
  | 'booking_cancelled_by_member';
```

- [ ] **Step 8: Add the email templates**

In `supabase/functions/deliver-notifications/templates/bodies.ts`:

1. Directly after the `SEAT_FOOTER` constant add:

```ts
/**
 * Game invites. SEAT_FOOTER ("a seat you hold") is false for an invitee,
 * who holds nothing until they accept, and for a sender, who may not be
 * playing at all.
 */
const INVITE_FOOTER = (club: string) =>
  `You're getting this because a member of ${club} invited you to a game.`;

const SENDER_FOOTER = (club: string) =>
  `You're getting this because you invited someone to a game at ${club}.`;
```

2. In `unhandledKind`'s doc comment, "one of the eleven cases below" → "one of the sixteen cases below" and "add a twelfth kind" → "add a seventeenth kind".

3. In `bodyFor`, after `const broadcastFooter = BROADCAST_FOOTER(row.club_name);` add:

```ts
  const inviteFooter = INVITE_FOOTER(row.club_name);
  const senderFooter = SENDER_FOOTER(row.club_name);
```

4. Replace the whole `case 'booking_declined':` block with:

```ts
    case 'booking_declined':
      return {
        subject: `${actor(row, 'Someone')} can't make ${row.event_title ?? 'the game'}`,
        headline: 'Invite declined',
        paragraphs: [
          `${actor(row, 'The person you invited')} declined your invite to ${game(row)}.`,
          'Any seat held for them is back in the pool — you can invite someone else.',
        ],
        cta: { label: 'See the game', url },
        footerNote: senderFooter,
      };
```

5. Insert these four cases immediately before `default:`:

```ts
    case 'booking_invited': {
      // holds_seat is written by commit_booking: false means the game was
      // full when the invite went out, so accepting joins the waitlist.
      const holdsSeat = row.payload.holds_seat !== false;
      return {
        subject: `${actor(row, 'Someone')} invited you to ${row.event_title ?? 'a game'}`,
        headline: "You're invited",
        paragraphs: [
          `${actor(row, 'A member')} invited you to ${game(row)}${at(row)}.`,
          holdsSeat
            ? "A seat is held for you until you answer. Accept or decline from the game page — if you can't make it, declining frees the seat for somebody else."
            : "The game is full right now, so accepting puts you on the waitlist. You'll move up if a seat opens.",
        ],
        cta: { label: 'Accept or decline', url },
        footerNote: inviteFooter,
      };
    }

    case 'booking_invite_accepted': {
      // `waitlisted` is written by accept_booking_invite: true when the
      // invite held no seat, so accepting queued them.
      const waitlisted = row.payload.waitlisted === true;
      return {
        subject: `${actor(row, 'Someone')} is in for ${row.event_title ?? 'the game'}`,
        headline: 'Invite accepted',
        paragraphs: [
          `${actor(row, 'The person you invited')} accepted your invite to ${game(row)}${at(row)}.`,
          ...(waitlisted
            ? ["The game was full, so they're on the waitlist and will move up if a seat opens."]
            : []),
        ],
        cta: { label: 'See the game', url },
        footerNote: senderFooter,
      };
    }

    case 'booking_invite_withdrawn':
      return {
        subject: `Your invite to ${row.event_title ?? 'the game'} was withdrawn`,
        headline: 'Invite withdrawn',
        paragraphs: [
          `${actor(row, 'The organizer')} withdrew your invite to ${game(row)}.`,
          "There's nothing you need to do.",
        ],
        // The club, not the event: an invite-only game stops being visible
        // to someone whose invite was withdrawn, so the event link would
        // open "That game could not be loaded."
        cta: {
          label: `See what else ${row.club_name} has on`,
          url: `${appUrl}/clubs/${row.club_id}`,
        },
        footerNote: inviteFooter,
      };

    case 'booking_cancelled_by_member':
      return {
        subject: `${actor(row, 'Someone')} can't make ${row.event_title ?? 'the game'} anymore`,
        headline: 'A seat opened up',
        paragraphs: [
          `${actor(row, 'The person you invited')} can't make ${game(row)} anymore — their seat is open.`,
          'You can invite someone else to fill it.',
        ],
        cta: { label: 'See the game', url },
        footerNote: senderFooter,
      };
```

- [ ] **Step 9: Add the Alerts-feed descriptions**

In `lib/notifications.ts`'s `describeNotification`, replace the `case 'booking_declined':` block with:

```ts
    case 'booking_declined':
      return {
        headline: 'Invite declined',
        detail: `${actor(row, 'The person you invited')} declined your invite to ${game(row)}.`,
        href: href(row),
      };
```

and insert immediately before `default:`:

```ts
    case 'booking_invited':
      return {
        headline: "You're invited",
        detail:
          row.payload.holds_seat === false
            ? `${actor(row, 'A member')} invited you to ${game(row)}. It's full — accepting puts you on the waitlist.`
            : `${actor(row, 'A member')} invited you to ${game(row)}${at(row)}. Your seat is held until you answer.`,
        href: href(row),
      };

    case 'booking_invite_accepted':
      return {
        headline: 'Invite accepted',
        detail: `${actor(row, 'The person you invited')} is in for ${game(row)}${at(row)}.`,
        href: href(row),
      };

    case 'booking_invite_withdrawn':
      return {
        headline: 'Invite withdrawn',
        detail: `${actor(row, 'The organizer')} withdrew your invite to ${game(row)}.`,
        // The game may no longer be visible to them (invite-only).
        href: `/clubs/${row.club_id}`,
      };

    case 'booking_cancelled_by_member':
      return {
        headline: 'A seat opened up',
        detail: `${actor(row, 'The person you invited')} can't make ${game(row)} anymore — their seat is open.`,
        href: href(row),
      };
```

- [ ] **Step 10: Run the tests and the type check**

Run: `npm test -- supabase/functions/deliver-notifications/__tests__/render.test.ts lib/notifications.test.ts && npx tsc --noEmit`
Expected: both files pass; `tsc` clean.

- [ ] **Step 11: Commit**

```bash
git add supabase/tests/database/fixtures/invite_notifications.test.sql \
  supabase/migrations/20260924105000_outbox_render_context_accepted_by.sql \
  supabase/functions/deliver-notifications/types.ts \
  supabase/functions/deliver-notifications/templates/bodies.ts \
  supabase/functions/deliver-notifications/__tests__/render.test.ts \
  lib/notifications.ts lib/notifications.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): game invite emails and alerts

Templates for booking_invited, booking_invite_accepted,
booking_invite_withdrawn and booking_cancelled_by_member; booking_declined
now reads "declined your invite". outbox_render_context names the
accepting invitee from payload.accepted_by.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Data layer — types, accept/withdraw calls, refusals, dashboard and event helpers

**Files:**
- Modify: `lib/bookings.ts`
- Modify: `lib/bookings.test.ts`
- Modify: `lib/events.ts`
- Modify: `lib/dashboard.ts`
- Modify: `lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `accept_booking_invite(target_booking uuid)`, `withdraw_booking_invite(target_booking uuid)` (Task 4); the new `event_seating` / `my_upcoming_bookings` columns (Task 5); the refusal messages `'already invited'` (Task 3) and `'invite already accepted'` (Task 4).
- Produces, in `lib/bookings.ts`:
  - `type BookingStatus = 'confirmed' | 'waitlisted' | 'invited' | 'cancelled' | 'declined'`
  - `SeatOccupant`: `profile_id: string | null`, `display_name: string | null` (null only on an anonymous invite-only `invited` row), `status: 'confirmed' | 'waitlisted' | 'invited'`, `invite_holds_seat?: boolean | null`.
  - `MyBooking.invite_holds_seat?: boolean | null`; `BookingOutcome['placements'][number].status?: 'confirmed' | 'waitlisted' | 'invited'`.
  - `takesSeat(b: { status: string; invite_holds_seat?: boolean | null }): boolean` — `confirmed`, or `invited` holding a seat.
  - `acceptBookingInvite(bookingId: string): Promise<{ error: string | null }>` → RPC `accept_booking_invite` `{ target_booking }`.
  - `withdrawBookingInvite(bookingId: string): Promise<{ error: string | null }>` → RPC `withdraw_booking_invite` `{ target_booking }`.
  - `BOOKING_REFUSALS` maps `'already invited'` → "You or someone you picked has already been invited to this game." and `'invite already accepted'` → "That invite has already been accepted." (P4).
  - `declineBooking` / `cancelBooking` unchanged (the RPCs changed underneath them).
- Produces, in `lib/events.ts`: `EVENT_COLUMNS`'s bookings embed adds `invite_holds_seat`; `EventBookingRow.status` includes `'invited'`, plus `invite_holds_seat?: boolean | null`. (`eventStatusLine` is not called by any screen and is left alone.)
- Produces, in `lib/dashboard.ts`: `pendingGameInvites(bookings: MyBooking[]): MyBooking[]`; `buildDashboardRows` never turns an `invited` booking into a row but still marks its event as seen; `viewerIsIn` counts `invited`; free-seat and need-a-fourth counts use `takesSeat`.
- After this task `npx tsc --noEmit` reports errors ONLY in `components/TableCard.tsx` (`profile_id`/`display_name` now nullable) and `app/clubs/[id]/events/[eventId]/index.tsx` (`booked={seating.map((o) => o.profile_id)}`); Tasks 8 and 9 clear them. Any other error is real.

- [ ] **Step 1: Write the failing `lib/bookings.test.ts` tests**

Extend the import from `./bookings` to:

```ts
import {
  acceptBookingInvite,
  bookingErrorMessage,
  callForAFourth,
  cancelBooking,
  commitBooking,
  fetchEventSeating,
  needsAFourth,
  offerCountdown,
  seatsRemaining,
  takesSeat,
  tierWarning,
  waitlistLabel,
  withdrawBookingInvite,
} from './bookings';
```

Add after the `describe('cancelBooking', ...)` block:

```ts
describe('takesSeat', () => {
  it('counts a confirmed booking', () => {
    expect(takesSeat({ status: 'confirmed' })).toBe(true);
  });

  it('counts a pending invite that holds a seat', () => {
    expect(takesSeat({ status: 'invited', invite_holds_seat: true })).toBe(true);
  });

  it('does not count an invite sent into a full game', () => {
    expect(takesSeat({ status: 'invited', invite_holds_seat: false })).toBe(false);
  });

  it('does not count a waitlisted booking', () => {
    expect(takesSeat({ status: 'waitlisted', invite_holds_seat: null })).toBe(false);
  });
});

describe('acceptBookingInvite', () => {
  it('calls accept_booking_invite with the booking id', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await acceptBookingInvite('b1')).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith('accept_booking_invite', { target_booking: 'b1' });
  });

  it('reports an invite answered elsewhere plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'invite already accepted' },
    });
    expect((await acceptBookingInvite('b1')).error).toBe(
      'That invite has already been accepted.',
    );
  });

  it('reports a started game plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'event already started' },
    });
    expect((await acceptBookingInvite('b1')).error).toBe(
      'This game has already started.',
    );
  });
});

describe('withdrawBookingInvite', () => {
  it('calls withdraw_booking_invite with the booking id', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await withdrawBookingInvite('b1')).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith('withdraw_booking_invite', { target_booking: 'b1' });
  });

  it('reports an invite the invitee already accepted plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'invite already accepted' },
    });
    expect((await withdrawBookingInvite('b1')).error).toBe(
      'That invite has already been accepted.',
    );
  });
});

describe('game invite refusals', () => {
  it('says someone picked is already invited', () => {
    expect(
      bookingErrorMessage({ code: '23514', message: 'already invited' }),
    ).toBe('You or someone you picked has already been invited to this game.');
  });

  it('keeps "already booked" distinct from "already invited"', () => {
    expect(
      bookingErrorMessage({ code: '23514', message: 'already booked' }),
    ).toBe('You or someone in your group already has a seat at this game.');
  });
});
```

- [ ] **Step 2: Write the failing `lib/dashboard.test.ts` tests**

Add `pendingGameInvites` to the import from `./dashboard`, then add at the end of the file:

```ts
describe('game invites', () => {
  const threeSeated = [
    { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-a' },
    { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-b' },
    { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-c' },
  ];

  it('keeps a pending invite out of "Your games", and its game off the joinable list', () => {
    const rows = buildDashboardRows({
      bookings: [
        booking({ event_id: 'event-1', status: 'invited', invite_holds_seat: true }),
      ],
      events: [event()],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('lists pending invites, and only those, for the invite card', () => {
    const invite = booking({
      booking_id: 'inv',
      status: 'invited',
      invite_holds_seat: false,
      event_table_id: null,
      table_label: null,
    });
    expect(pendingGameInvites([booking(), invite])).toEqual([invite]);
  });

  it("counts a held invite as a taken seat: an organizer's table full of held seats reads as Hosting", () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'd',
              status: 'invited',
              event_table_id: 'table-1',
              group_id: 'g-a',
              invite_holds_seat: true,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      organizerClubIds: new Set(['club-1']),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].joinable).toBe(false);
    expect(rows[0].organizing).toBe(true);
  });

  it('does not call for a fourth over a held seat', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'd',
              status: 'invited',
              event_table_id: 'table-1',
              group_id: 'g-a',
              invite_holds_seat: true,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('does not ask someone already invited to the game to be the fourth', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'me',
              status: 'invited',
              event_table_id: null,
              group_id: 'g-me',
              invite_holds_seat: false,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('ignores an invite that holds no seat when counting the table', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'd',
              status: 'invited',
              event_table_id: null,
              group_id: 'g-a',
              invite_holds_seat: false,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npm test -- lib/bookings.test.ts lib/dashboard.test.ts`
Expected: FAIL — `acceptBookingInvite`, `withdrawBookingInvite`, `takesSeat`, `pendingGameInvites` are not exported; the refusal and dashboard assertions fail. The self-audit (`'maps, or explicitly allowlists, every message the migrations raise'`) also fails naming `already invited` and `invite already accepted`.

- [ ] **Step 4: Update `lib/bookings.ts`**

1. Replace the `BookingStatus` line:

```ts
export type BookingStatus = 'confirmed' | 'waitlisted' | 'invited' | 'cancelled' | 'declined';
```

2. Replace the `SeatOccupant` doc comment and type:

```ts
/**
 * One live booking, as `event_seating` returns it.
 *
 * `status` is narrower than `BookingStatus`: `event_seating`'s own
 * `where b.status in ('confirmed', 'waitlisted', 'invited')`
 * (20260924104000) means a cancelled or declined booking can never appear
 * in this field. Typed to match, so a caller that mishandles
 * 'cancelled'/'declined' here is a compile error rather than dead code.
 */
export type SeatOccupant = {
  booking_id: string;
  group_id: string;
  /** Null only on an 'invited' row of an invite-only game that the viewer
   *  may not see the name of (event_seating shows invitees only to
   *  organizers, the sender and the invitee) -- render it as an anonymous
   *  "Invited" seat. */
  profile_id: string | null;
  display_name: string | null;
  skill_level: SkillLevel | null;
  event_table_id: string | null;
  status: 'confirmed' | 'waitlisted' | 'invited';
  booked_by: string;
  booked_by_name: string;
  group_status: BookingGroupStatus;
  waitlist_position: number | null;
  created_at: string;
  /** Non-null only for status 'invited': true = a seat is held (at
   *  event_table_id, or any table when that is null); false = the game was
   *  full when sent, so accepting joins the waitlist. Optional so existing
   *  fixtures keep compiling. */
  invite_holds_seat?: boolean | null;
};
```

3. In `MyBooking`, after `min_spend_cents: number;` add:

```ts
  /** See SeatOccupant.invite_holds_seat. Null unless status is 'invited'
   *  (a pending game invite -- the dashboard's Accept / Decline card). */
  invite_holds_seat?: boolean | null;
```

4. In `BookingOutcome.placements`, the element type becomes:

```ts
  placements: {
    profile_id: string;
    event_table_id: string | null;
    table_label: string | null;
    /** booking_result reports each placement's status since game invites:
     *  everyone but the sender is 'invited'. */
    status?: 'confirmed' | 'waitlisted' | 'invited';
  }[];
```

5. In `BOOKING_REFUSALS`, directly after the `'already booked'` entry, add:

```ts
  {
    // assert_players_bookable (20260924102000): a pending game invite is
    // the one active row per person per game, so a member who is already
    // invited cannot be invited (or book) again. Worded like 'already
    // booked' above, for the same reason: the caller cannot tell whether
    // it was them or someone they picked.
    contains: 'already invited',
    message: 'You or someone you picked has already been invited to this game.',
    codes: ['23514'],
  },
  {
    // accept_booking_invite / withdraw_booking_invite (20260924103000):
    // the invitee answered first (accept and withdraw race on the row).
    contains: 'invite already accepted',
    message: 'That invite has already been accepted.',
    codes: ['23514'],
  },
```

6. In the "Pure helpers" section (next to `seatsRemaining`), add:

```ts
/**
 * Does this booking occupy a seat for capacity purposes? A confirmed seat,
 * or a pending invite that holds one -- the same rule the database uses
 * (table_free_seats, event_free_seats, need_a_fourth_stage). An invite
 * sent into a full game holds nothing.
 */
export function takesSeat(b: {
  status: string;
  invite_holds_seat?: boolean | null;
}): boolean {
  return (
    b.status === 'confirmed' ||
    (b.status === 'invited' && b.invite_holds_seat === true)
  );
}
```

7. After `declineBooking`, add:

```ts
/** The invitee's Accept (accept_booking_invite, 20260924103000). */
export async function acceptBookingInvite(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('accept_booking_invite', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('acceptBookingInvite failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('acceptBookingInvite failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** The sender's or an organizer's Withdraw invite
 *  (withdraw_booking_invite, 20260924103000). */
export async function withdrawBookingInvite(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('withdraw_booking_invite', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('withdrawBookingInvite failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('withdrawBookingInvite failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 5: Update `lib/events.ts`**

1. The last line of `EVENT_COLUMNS` becomes:

```ts
  'bookings(profile_id, status, event_table_id, group_id, invite_holds_seat)';
```

2. `EventBookingRow` becomes:

```ts
export type EventBookingRow = {
  profile_id: string;
  status: 'confirmed' | 'waitlisted' | 'invited' | 'cancelled' | 'declined';
  event_table_id: string | null;
  /**
   * The booking group this seat was booked as part of (`bookings.group_id`,
   * `not null` — a solo booking is a group of one). Added for Task 8's door
   * list: an organizer assigning tables on the day of an open-seating night
   * needs to see who arrived together, and this embed is already fetched
   * with the event, so the badge costs no extra round trip.
   */
  group_id: string;
  /** Game invites: see SeatOccupant.invite_holds_seat in lib/bookings.ts.
   *  On an invite-only game RLS hides other people's pending invites from
   *  a non-organizer, which is harmless here: only an organizer can
   *  invite anyone onto one. */
  invite_holds_seat?: boolean | null;
};
```

- [ ] **Step 6: Update `lib/dashboard.ts`**

1. Imports:

```ts
import { needsAFourth, seatsRemaining, takesSeat } from './bookings';
```

2. Replace `viewerIsIn` and `confirmedOnTable`:

```ts
/** Live means it holds, is queued for, or has been invited to a seat;
 *  declined and cancelled do not. An invitee is not offered "Join"
 *  (commit_booking would refuse: an invite is their one active row) nor a
 *  Need-a-4th card for a game they already have an invite to. */
function viewerIsIn(event: ClubEvent, userId: string): boolean {
  return event.bookings.some(
    (row) =>
      row.profile_id === userId &&
      (row.status === 'confirmed' ||
        row.status === 'waitlisted' ||
        row.status === 'invited'),
  );
}

/** Seats taken at one table: confirmed, plus pending invites holding one
 *  (lib/bookings' takesSeat -- the database's own rule). */
function takenOnTable(event: ClubEvent, tableId: string): number {
  return event.bookings.filter(
    (row) => takesSeat(row) && row.event_table_id === tableId,
  ).length;
}
```

3. In `hasFreeSeat`, the first statement becomes:

```ts
  const confirmed = event.bookings.filter(takesSeat).length;
```

4. In `needAFourthAlerts`, `confirmedOnTable(event, table.id),` → `takenOnTable(event, table.id),`.

5. In `buildDashboardRows`, replace the `rows` initializer and `seen`:

```ts
  // A pending game invite is not one of "Your games" until it is answered
  // -- the dashboard renders it as its own Accept / Decline card
  // (pendingGameInvites below) -- but its event still counts as seen, so
  // it never reappears as a joinable row.
  const rows: DashboardRow[] = input.bookings
    .filter((booking) => booking.status !== 'invited')
    .map((booking) => ({
      eventId: booking.event_id,
      clubId: booking.club_id,
      clubName: booking.club_name,
      title: booking.event_title,
      startsAt: booking.starts_at,
      timezone: booking.club_timezone,
      venueName: booking.venue_name,
      booking,
      joinable: false,
      organizing: false,
      feeCents: booking.fee_cents,
      minSpendCents: booking.min_spend_cents,
    }));

  const seen = new Set(input.bookings.map((booking) => booking.event_id));
```

6. After `buildDashboardRows`, add:

```ts
/** Pending game invites for the dashboard's Accept / Decline card, soonest
 *  first (my_upcoming_bookings already orders by starts_at). */
export function pendingGameInvites(bookings: MyBooking[]): MyBooking[] {
  return bookings.filter((booking) => booking.status === 'invited');
}
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npm test -- lib/bookings.test.ts lib/dashboard.test.ts lib/events.test.ts`
Expected: PASS, including the migration self-audit (both new messages are now mapped).

Run: `npx tsc --noEmit`
Expected: errors only in `components/TableCard.tsx` and `app/clubs/[id]/events/[eventId]/index.tsx` (see Interfaces).

- [ ] **Step 8: Commit**

```bash
git add lib/bookings.ts lib/bookings.test.ts lib/events.ts lib/dashboard.ts lib/dashboard.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): game invite types, accept/withdraw calls and seat counting

SeatOccupant and MyBooking carry invited rows and invite_holds_seat;
acceptBookingInvite / withdrawBookingInvite wrap the new RPCs; the two
new refusals read as sentences; the dashboard counts held invites as
taken seats and keeps pending invites out of "Your games".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Components — held seats, Withdraw, table-less invites, "Send invites"

**Files:**
- Modify: `components/SeatGrid.tsx`
- Modify: `components/TableCard.tsx`
- Modify: `components/WaitlistPanel.tsx`
- Modify: `components/BringSomeoneSheet.tsx`
- Modify: `components/__tests__/SeatGrid.test.tsx`
- Modify: `components/__tests__/TableCard.test.tsx`
- Modify: `components/__tests__/WaitlistPanel.test.tsx`
- Modify: `components/__tests__/BringSomeoneSheet.test.tsx`

**Interfaces:**
- Consumes: `SeatOccupant` (nullable `profile_id`/`display_name`, `status` incl. `'invited'`, `invite_holds_seat`) from Task 7.
- Produces:
  - `SeatGrid`: `Seat.name: string | null`; `Seat.invited?: boolean`; `Seat.canWithdraw?: boolean`; new prop `onWithdrawInvite?: (bookingId: string) => void`. An invited seat is drawn dimmed/dashed with the invitee's name and an "Invited" tag, or — when `name` is null — the single word "Invited". It is never offered Move / Remove / Leave / Record; when `canWithdraw && onWithdrawInvite && onToggleManage` it opens a panel whose only action is **Withdraw invite**. Held seats count toward the grid's filled seats.
  - `TableCard`: new props `isOrganizer?: boolean`, `onWithdrawInvite?: (bookingId: string) => void`; draws confirmed seats then held (`invited`) seats; a held seat is withdrawable when `onWithdrawInvite` is supplied and the viewer is an organizer or the seat's `booked_by`.
  - `WaitlistPanel`: new props `invited?: SeatOccupant[]` (table-less `invited` rows), `canWithdraw?: (occupant: SeatOccupant) => boolean`, `onWithdrawInvite?: (bookingId: string) => void`; renders an "Invited" card listing each as "Invited — seat held" (holds a seat, any table) or "Invited — would join the waitlist" (holds none), with **Withdraw invite** where `canWithdraw` allows.
  - `BringSomeoneSheet` (P2): when anyone other than the opener is picked, the primary confirm reads **Send invites** and the split-proposal button **Send invites this way**; a You-only sheet keeps **Confirm** / **Book it this way**; "Wait together instead" and "Wait together" are unchanged. The `booked` prop means "already holding a live booking or a pending invite" (the caller passes invited profile ids too — Task 9).

- [ ] **Step 1: Write the failing component tests**

`components/__tests__/SeatGrid.test.tsx` — add at the end of the file:

```tsx
describe('SeatGrid: held seats (game invites)', () => {
  const held = {
    bookingId: 'b9',
    profileId: 'p9',
    name: 'Jane P.',
    isYou: false,
    invited: true,
  };

  it('draws a named held seat with an Invited tag, and counts it as taken', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={2}
        seats={[seats[1], held]}
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });

  it('draws an anonymous held seat as a single "Invited"', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ ...held, profileId: '', name: null }]}
      />,
    );
    expect(screen.getAllByText('Invited')).toHaveLength(1);
  });

  it('offers only Withdraw invite on a held seat, even to an organizer', () => {
    const onWithdrawInvite = vi.fn();
    function Harness() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <SeatGrid
          tableLabel="Table 1"
          capacity={4}
          seats={[{ ...held, canWithdraw: true }]}
          otherTables={[{ id: 't2', label: 'Table 2' }]}
          onMove={vi.fn()}
          onRemove={vi.fn()}
          openBookingId={open}
          onToggleManage={(id) => setOpen((cur) => (cur === id ? null : id))}
          onWithdrawInvite={onWithdrawInvite}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Manage the invite for Jane P.'));
    expect(screen.queryByText('Move to Table 2')).toBeNull();
    expect(screen.queryByText('Remove from game')).toBeNull();
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Jane P.'));
    expect(onWithdrawInvite).toHaveBeenCalledWith('b9');
  });

  it('is not tappable for a viewer who may not withdraw it', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ ...held, canWithdraw: false }]}
        openBookingId={null}
        onToggleManage={vi.fn()}
        onWithdrawInvite={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Manage the invite for Jane P.')).toBeNull();
    expect(screen.getByText('Jane P.')).toBeTruthy();
  });
});
```

`components/__tests__/TableCard.test.tsx` — add at the end of the file:

```tsx
describe('TableCard: held seats (game invites)', () => {
  const heldInvite = {
    ...occupants[0],
    booking_id: 'b9',
    profile_id: 'p5',
    display_name: 'Owen B.',
    status: 'invited' as const,
    booked_by: 'p1',
    booked_by_name: 'Ravi K.',
    invite_holds_seat: true,
  };

  it('draws a held seat after the confirmed ones, named, with an Invited tag', () => {
    render(<TableCard table={table} occupants={[...occupants, heldInvite]} youId="p9" />);
    expect(screen.getByText('Owen B.')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.getAllByText('Empty')).toHaveLength(2);
  });

  it('draws an anonymous held seat for a viewer who may not see the name', () => {
    render(
      <TableCard
        table={table}
        occupants={[...occupants, { ...heldInvite, profile_id: null, display_name: null }]}
        youId="p9"
      />,
    );
    expect(screen.getAllByText('Invited')).toHaveLength(1);
    expect(screen.getAllByText('Empty')).toHaveLength(2);
  });

  it('lets an organizer withdraw a held seat', () => {
    const onWithdrawInvite = vi.fn();
    function Harness() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <TableCard
          table={table}
          occupants={[...occupants, heldInvite]}
          youId="p9"
          isOrganizer
          openBookingId={open}
          onToggleManage={(id) => setOpen((cur) => (cur === id ? null : id))}
          onWithdrawInvite={onWithdrawInvite}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Manage the invite for Owen B.'));
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Owen B.'));
    expect(onWithdrawInvite).toHaveBeenCalledWith('b9');
  });

  it('lets the non-organizer sender withdraw it, but nobody else', () => {
    const { unmount } = render(
      <TableCard
        table={table}
        occupants={[...occupants, heldInvite]}
        youId="p1"
        openBookingId={null}
        onToggleManage={vi.fn()}
        onWithdrawInvite={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Manage the invite for Owen B.')).toBeTruthy();
    unmount();

    render(
      <TableCard
        table={table}
        occupants={[...occupants, heldInvite]}
        youId="p9"
        openBookingId={null}
        onToggleManage={vi.fn()}
        onWithdrawInvite={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Manage the invite for Owen B.')).toBeNull();
  });
});
```

`components/__tests__/WaitlistPanel.test.tsx` — add at the end of the file:

```tsx
describe('WaitlistPanel: table-less invites', () => {
  const INVITED = {
    ...UNSEATED,
    booking_id: 'b9',
    profile_id: 'p9',
    display_name: 'Jane P.',
    status: 'invited' as const,
    booked_by: 'p1',
    booked_by_name: 'Mei L.',
    invite_holds_seat: false,
  };

  it('renders with nothing but a pending invite', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[INVITED]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.getByText('Invited — would join the waitlist')).toBeTruthy();
  });

  it('says a held any-table invite holds a seat', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[{ ...INVITED, invite_holds_seat: true }]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Invited — seat held')).toBeTruthy();
  });

  it('names nobody on an anonymous invite', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[{ ...INVITED, profile_id: null, display_name: null }]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Someone')).toBeTruthy();
  });

  it('offers Withdraw invite only where canWithdraw allows it', () => {
    const onWithdrawInvite = vi.fn();
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[INVITED, { ...INVITED, booking_id: 'b10', display_name: 'Kim S.' }]}
        youId="p1"
        offer={null}
        now={NOW}
        canWithdraw={(o) => o.booking_id === 'b9'}
        onWithdrawInvite={onWithdrawInvite}
      />,
    );
    expect(screen.queryByLabelText('Withdraw the invite to Kim S.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Jane P.'));
    expect(onWithdrawInvite).toHaveBeenCalledWith('b9');
  });
});
```

`components/__tests__/BringSomeoneSheet.test.tsx` — the confirm now reads "Send invites" whenever Jane is added:
- In `'shows exactly who sits where before committing a split'`: `screen.getByText('Confirm')` → `screen.getByText('Send invites')`, and `screen.getByText('Book it this way')` → `screen.getByText('Send invites this way')`.
- In `'commits without a second step when nobody is split up'`, `'offers the waitlist when the group does not fit'`, `'proposes just the friend picked, not [you, friend]'` and `'marks the chips aria-disabled while a proposal is in flight'`: `screen.getByText('Confirm')` → `screen.getByText('Send invites')`.
- `'does not propose an empty group when nobody is picked'` keeps `'Confirm'`.

Then add inside `describe('BringSomeoneSheet', ...)`:

```tsx
  it('reads "Send invites" once someone else is picked, and "Confirm" for just you', () => {
    renderSheet();
    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.queryByText('Send invites')).toBeNull();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    expect(screen.getByText('Send invites')).toBeTruthy();
    expect(screen.queryByText('Confirm')).toBeNull();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- components/__tests__/SeatGrid.test.tsx components/__tests__/TableCard.test.tsx components/__tests__/WaitlistPanel.test.tsx components/__tests__/BringSomeoneSheet.test.tsx`
Expected: FAIL — held seats render as nothing (TableCard) or as plain names with no tag (SeatGrid), `WaitlistPanel` returns null for an invites-only input, the sheet still reads "Confirm".

- [ ] **Step 3: Update `components/SeatGrid.tsx`**

1. In the `Seat` type, `name: string;` becomes:

```ts
  /** Null only for an invited seat the viewer may not see the name of
   *  (event_seating hides invite-only invitees from everyone but
   *  organizers, the sender and the invitee). */
  name: string | null;
```

and, after `isLeader?: boolean;`, add:

```ts
  /** A pending game invite holding this seat ('invited' booking). Drawn
   *  dimmed with an "Invited" tag; never offered Move / Remove / Leave /
   *  Record -- none of those apply until the invitee accepts, and
   *  place_booking refuses invited rows. */
  invited?: boolean;
  /** Invited seats only: this viewer may withdraw it (an organizer, or the
   *  sender). Computed by the caller (TableCard). */
  canWithdraw?: boolean;
```

2. In `Props`, after `onRecordRound?: ...;` add:

```ts
  /** Withdraw a held invite. An invited seat opens a panel only when it
   *  has `canWithdraw`, this handler, and `onToggleManage` -- and that
   *  panel's one action is this, in place of Move / Remove. */
  onWithdrawInvite?: (bookingId: string) => void;
```

3. Add `onWithdrawInvite,` to the destructured props of `SeatGrid`.

4. At the top of the `seats.map((seat) => {` callback, before `const displayName = ...`, insert:

```tsx
        if (seat.invited) {
          return (
            <InvitedSeat
              key={seat.bookingId}
              seat={seat}
              busy={busy}
              open={seat.bookingId === openBookingId}
              onToggleManage={onToggleManage}
              onWithdrawInvite={onWithdrawInvite}
            />
          );
        }
```

5. Directly above `export default function SeatGrid(`, add:

```tsx
/**
 * A seat held for a pending game invite. Taken (it counts toward the
 * grid's filled seats, so no Empty cell is drawn for it), but not by
 * someone who has said yes: dimmed and dashed, the invitee's name plus an
 * "Invited" tag -- or, when the viewer may not see who (an invite-only
 * game's other members), the single word "Invited".
 *
 * The only thing anyone can do to it is withdraw it, and only the sender or
 * an organizer (`seat.canWithdraw`, computed by TableCard) -- so its panel
 * carries that one action instead of Move / Remove / Leave / Record.
 */
function InvitedSeat({
  seat,
  busy,
  open,
  onToggleManage,
  onWithdrawInvite,
}: {
  seat: Seat;
  busy: boolean;
  open: boolean;
  onToggleManage?: (bookingId: string) => void;
  onWithdrawInvite?: (bookingId: string) => void;
}) {
  const shownName = seat.isYou ? 'You' : seat.name;
  const nameText = (
    <Text
      style={[styles.name, styles.nameInvited]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {shownName ?? 'Invited'}
    </Text>
  );
  // A named held seat carries its own tag; an anonymous one already reads
  // "Invited" as its name, so no second copy.
  const tag = shownName !== null ? <Text style={styles.invitedTag}>Invited</Text> : null;
  const manageable = Boolean(seat.canWithdraw && onWithdrawInvite && onToggleManage);

  if (!manageable) {
    return (
      <View style={[styles.seat, styles.seatInvited, styles.seatRow]}>
        {nameText}
        {tag}
      </View>
    );
  }

  const label = `Manage the invite for ${seat.name ?? 'this seat'}`;
  const toggle = () => onToggleManage!(seat.bookingId);

  if (!open) {
    return (
      <Pressable
        style={[styles.seat, styles.seatInvited]}
        onPress={busy ? undefined : toggle}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-expanded={false}
      >
        <View style={styles.nameRow}>
          {nameText}
          <Text aria-hidden style={styles.chevron}>▾</Text>
          {tag}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.seat, styles.seatOpen, styles.seatInvited]}>
      <Pressable
        onPress={busy ? undefined : toggle}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-expanded
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={styles.nameRow}>
          {nameText}
          <Text aria-hidden style={styles.chevron}>▴</Text>
          {tag}
        </View>
      </Pressable>
      <View style={styles.manageActions}>
        <Button
          variant="ghost"
          big={false}
          disabled={busy}
          onPress={() => onWithdrawInvite!(seat.bookingId)}
          accessibilityLabel={`Withdraw the invite to ${seat.name ?? 'this seat'}`}
        >
          Withdraw invite
        </Button>
      </View>
    </View>
  );
}
```

6. In `StyleSheet.create`, after `seatYou`, add:

```ts
  // A held seat (pending game invite): taken, but not by someone who has
  // said yes yet -- lighter fill and a dashed edge so it reads between
  // "Empty" and a filled seat. textMuted on surface is already pinned AA
  // in lib/theme.test.ts.
  seatInvited: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[600],
  },
  nameInvited: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  invitedTag: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
```

7. In the component docstring above `SeatGrid`, append a short section:

```
 * ## Held seats (game invites)
 *
 * A seat with `invited: true` is a pending invite holding it. It renders
 * through `InvitedSeat` (above) and never through the occupied-seat
 * branches below, so none of Move / Remove / Leave / Record can reach an
 * invited booking.
```

- [ ] **Step 4: Update `components/TableCard.tsx`**

1. In `Props`, after `onToggleManage?: ...;` add:

```ts
  /** Organizer on this game -- may withdraw any held invite here. */
  isOrganizer?: boolean;
  /** Supplied while invites can still be withdrawn (the event screen's
   *  canBook). A held seat offers it to an organizer, or to the seat's
   *  own sender (`booked_by`). */
  onWithdrawInvite?: (bookingId: string) => void;
```

2. Add `isOrganizer = false,` and `onWithdrawInvite,` to the destructured props.

3. Replace the `const seated = ...` line with:

```ts
  const seated = occupants.filter((o) => o.status === 'confirmed');
  // Held seats draw on the grid too, after the confirmed ones: taken, but
  // the invitee has not said yes yet. An invite that holds no seat never
  // has a table, so it never reaches this card.
  const held = occupants.filter((o) => o.status === 'invited');
```

4. Replace the `seats={seated.map(...)}` prop with:

```tsx
        seats={[
          ...seated.map((o) => {
            const points = o.profile_id
              ? (totalsByProfile.get(o.profile_id) ?? null)
              : null;
            return {
              bookingId: o.booking_id,
              profileId: o.profile_id ?? '',
              name: o.display_name,
              isYou: o.profile_id === youId,
              points,
              isLeader: points !== null && points === maxPoints,
            };
          }),
          ...held.map((o) => ({
            bookingId: o.booking_id,
            profileId: o.profile_id ?? '',
            // null for an invitee this viewer may not see: "Invited".
            name: o.display_name,
            isYou: o.profile_id !== null && o.profile_id === youId,
            invited: true,
            canWithdraw:
              Boolean(onWithdrawInvite) && (isOrganizer || o.booked_by === youId),
          })),
        ]}
        onWithdrawInvite={onWithdrawInvite}
```

- [ ] **Step 5: Update `components/WaitlistPanel.tsx`**

1. In `Props`, after `onSeat?: ...;` add:

```ts
  /** Table-less pending invites ('invited' rows with no event_table_id):
   *  a held "any table" seat (invite_holds_seat true) or an invite into a
   *  full game (false: accepting joins the waitlist). */
  invited?: SeatOccupant[];
  /** Whether this viewer may withdraw a given invite (an organizer, or its
   *  sender). */
  canWithdraw?: (occupant: SeatOccupant) => boolean;
  onWithdrawInvite?: (bookingId: string) => void;
```

2. Add `invited = [],`, `canWithdraw,` and `onWithdrawInvite,` to the destructured props.

3. Replace the early return with:

```ts
  if (!unseated.length && !waiting.length && !offer && !invited.length) return null;
```

4. After the closing `) : null}` of the "Waiting for a seat" card, add:

```tsx
      {invited.length ? (
        <Card>
          <Text style={styles.heading}>Invited</Text>
          {invited.map((person) => (
            <View key={person.booking_id} style={styles.unseatedRow}>
              <Text style={styles.person}>
                {person.profile_id !== null && person.profile_id === youId
                  ? 'You'
                  : (person.display_name ?? 'Someone')}
              </Text>
              <Text style={styles.help}>
                {person.invite_holds_seat
                  ? 'Invited — seat held'
                  : 'Invited — would join the waitlist'}
              </Text>
              {onWithdrawInvite && canWithdraw?.(person) ? (
                <Button
                  variant="ghost"
                  big={false}
                  disabled={busy}
                  onPress={() => onWithdrawInvite(person.booking_id)}
                  accessibilityLabel={`Withdraw the invite to ${person.display_name ?? 'this person'}`}
                >
                  Withdraw invite
                </Button>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
```

5. In the component docstring, add a sentence: "Table-less pending game invites get their own "Invited" card here, with Withdraw invite for the sender or an organizer — a held seat at a specific table is drawn on that table's SeatGrid instead."

- [ ] **Step 6: Update `components/BringSomeoneSheet.tsx`**

1. The `booked` prop doc: `/** profile ids already holding a live booking or a pending invite for this game. */`

2. After the `available` constant, add:

```ts
  // Anyone besides the opener makes this an invitation (commit_booking
  // books only the caller; everyone else is invited and must accept), so
  // the buttons say so. A You-only sheet is still a plain booking.
  const invitingOthers = players.some((id) => id !== youId);
```

3. Replace the `plan === null` Button with:

```tsx
        <Button
          block
          loading={busy}
          disabled={players.length === 0}
          onPress={confirm}
          accessibilityLabel={invitingOthers ? 'Send invites' : 'Confirm this booking'}
        >
          {invitingOthers ? 'Send invites' : 'Confirm'}
        </Button>
```

4. Replace the "Book it this way" Button with:

```tsx
          <Button
            block
            loading={busy}
            onPress={() => commit(true)}
            accessibilityLabel={invitingOthers ? 'Send invites this way' : 'Book it this way'}
          >
            {invitingOthers ? 'Send invites this way' : 'Book it this way'}
          </Button>
```

"Wait together instead", "Wait together" and "There is no room for all of you right now." are unchanged (P2).

- [ ] **Step 7: Run the tests and the type check**

Run: `npm test -- components/__tests__/SeatGrid.test.tsx components/__tests__/TableCard.test.tsx components/__tests__/WaitlistPanel.test.tsx components/__tests__/BringSomeoneSheet.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: the only remaining error is `booked={seating.map((o) => o.profile_id)}` in `app/clubs/[id]/events/[eventId]/index.tsx` (Task 9).

- [ ] **Step 8: Commit**

```bash
git add components/SeatGrid.tsx components/TableCard.tsx components/WaitlistPanel.tsx \
  components/BringSomeoneSheet.tsx components/__tests__/SeatGrid.test.tsx \
  components/__tests__/TableCard.test.tsx components/__tests__/WaitlistPanel.test.tsx \
  components/__tests__/BringSomeoneSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(seating): draw held invite seats and offer Withdraw invite

SeatGrid draws a pending invite as a dimmed "Invited" seat whose only
action is Withdraw invite; TableCard decides who may withdraw it;
WaitlistPanel lists table-less invites; the sheet says "Send invites"
when it is inviting someone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Game screen — invitee banner, Withdraw, invitee gating, headcount line

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: `app/__tests__/events-detail.test.tsx`

**Interfaces:**
- Consumes: `acceptBookingInvite`, `declineBooking`, `withdrawBookingInvite`, `takesSeat`, `SeatOccupant` (Task 7); `TableCard`'s `isOrganizer` / `onWithdrawInvite`, `WaitlistPanel`'s `invited` / `canWithdraw` / `onWithdrawInvite` (Task 8).
- Produces (screen behaviour):
  - `myInvite` = the viewer's own `invited` row. While it exists and the game is bookable, a banner reads "*Sender* invited you to this game — *Table N*" (or "— you'd join the waitlist" for an invite that holds no seat; no suffix for a held any-table seat) with **Accept** (`acceptBookingInvite`) and **Decline** (`declineBooking`).
  - P6: declining an **invite-only** game's invite (as a non-organizer) navigates to `/clubs` — the game is no longer visible to them; otherwise the screen reloads.
  - An invitee is not offered Join (open seating), an Empty-seat tap, or Join the waitlist — `commit_booking` would refuse them (the invite is their one active row). The "Getting a seat" tip is hidden for them.
  - Held seats count toward `gameFull`, "Needs a 4th", and the organizer's "Call for a 4th now" gate (`takesSeat`).
  - Withdraw invite: on a held seat (TableCard) and on table-less invites (WaitlistPanel), for any organizer and for a non-organizer on the invites they sent, while `canBook`.
  - P7: when there are pending invites and the viewer can see the roster, a line under the section title reads "*N* playing · *M* invited" (N = confirmed, M = invited rows).
  - P1: `canSeeFullRoster` unlocks on `myBooking?.status === 'confirmed'` (table or not). The locked card's copy becomes "… You won't see who else is playing until you have a seat." — or "… You'll see who else is playing once you accept." for a pending invitee.
  - The promotion offer card is never shown to a pending invitee (`is_booking_group_member` has no status filter, so an invitee could otherwise see the sender's group's offer, which only the group's creator can take). Everyone else sees offers exactly as before.
  - `BringSomeoneSheet`'s `booked` = every non-null `profile_id` in `seating` (so invited members — visible by name in open play — are not offered again).

- [ ] **Step 1: Write the failing screen tests**

In `app/__tests__/events-detail.test.tsx`:

1. Next to the other `lib/bookings` doubles (after `const commitBooking = vi.fn();`) add:

```ts
// Game invites (2026-09-24): the invitee's Accept/Decline and the
// sender's/organizer's Withdraw.
const acceptBookingInvite = vi.fn();
const declineBooking = vi.fn();
const withdrawBookingInvite = vi.fn();
```

and add to the object returned by the `vi.mock('../../lib/bookings', ...)` factory:

```ts
    acceptBookingInvite: (...args: unknown[]) => acceptBookingInvite(...args),
    declineBooking: (...args: unknown[]) => declineBooking(...args),
    withdrawBookingInvite: (...args: unknown[]) => withdrawBookingInvite(...args),
```

2. In the top-level `beforeEach`, after `callForAFourth.mockResolvedValue({ error: null });` add:

```ts
  acceptBookingInvite.mockReset();
  acceptBookingInvite.mockResolvedValue({ error: null });
  declineBooking.mockReset();
  declineBooking.mockResolvedValue({ error: null });
  withdrawBookingInvite.mockReset();
  withdrawBookingInvite.mockResolvedValue({ error: null });
```

3. Replace the whole `describe('not-yet-placed invitee headcount view', () => { ... });` block with:

```tsx
// The invite-only privacy piece. The database layer already restricts what
// a locked viewer's own `seating` fetch returns -- their row and nobody
// else's -- so these tests prove `canSeeFullRoster` picks the right JSX
// branch given that already-narrowed data. Since game invites (P1,
// 2026-09-24) the roster unlocks on a CONFIRMED booking, table or not;
// waitlisted and pending invites stay locked.
describe('invite-only headcount view', () => {
  const INVITE_ONLY_EVENT = { ...EVENT, game_mode: 'invite_only' as const };

  const WAITLISTED_ME = {
    booking_id: 'booking-waiting',
    group_id: 'group-waiting',
    profile_id: 'test-user',
    display_name: 'Ada',
    skill_level: null,
    event_table_id: null as string | null,
    status: 'waitlisted' as const,
    booked_by: 'test-user',
    booked_by_name: 'Ada',
    group_status: 'waitlisted' as const,
    waitlist_position: 1,
    created_at: '2026-08-20T10:00:00Z',
  };

  const UNPLACED_ME = {
    ...WAITLISTED_ME,
    booking_id: 'booking-unplaced',
    group_id: 'group-unplaced',
    status: 'confirmed' as const,
    group_status: 'confirmed' as const,
    waitlist_position: null,
  };

  const INVITED_ME = {
    ...UNPLACED_ME,
    booking_id: 'booking-invited',
    group_id: 'group-owen',
    status: 'invited' as const,
    booked_by: 'p-owen',
    booked_by_name: 'Owen B.',
    invite_holds_seat: true,
  };

  it('shows only the headcount note, not the tables, to a waitlisted member of an invite-only game', async () => {
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventSeating.mockResolvedValue([WAITLISTED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(8);
    render(<EventScreen />);

    expect(
      await screen.findByText(
        "8 people have accepted. You won't see who else is playing until you have a seat.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Table 1')).toBeNull();
    expect(screen.queryByText('Nobody has booked yet.')).toBeNull();
  });

  it('says "1 person has accepted", not "1 people have accepted"', async () => {
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventSeating.mockResolvedValue([WAITLISTED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(1);
    render(<EventScreen />);

    expect(
      await screen.findByText(
        "1 person has accepted. You won't see who else is playing until you have a seat.",
      ),
    ).toBeTruthy();
  });

  it('falls back to a plain mode statement while the headcount is still null', async () => {
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventSeating.mockResolvedValue([WAITLISTED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(null);
    render(<EventScreen />);

    expect(
      await screen.findByText(
        "This is an invite-only game. You won't see who else is playing until you have a seat.",
      ),
    ).toBeTruthy();
  });

  it('tells a pending invitee the roster opens once they accept', async () => {
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventSeating.mockResolvedValue([INVITED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(3);
    render(<EventScreen />);

    expect(
      await screen.findByText(
        "3 people have accepted. You'll see who else is playing once you accept.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Table 1')).toBeNull();
  });

  it('reveals the full table view to a confirmed member, even before they are placed at a table', async () => {
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([UNPLACED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(8);
    render(<EventScreen />);

    expect(await screen.findByText('Table 1')).toBeTruthy();
    expect(screen.queryByText(/people have accepted/)).toBeNull();
  });

  it('still shows the full table view to the organizer of an invite-only game', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([WAITLISTED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(8);
    render(<EventScreen />);

    expect(await screen.findByText('Table 1')).toBeTruthy();
    expect(screen.queryByText(/people have accepted/)).toBeNull();
  });

  it('keeps the full table view on an open_play game regardless of status', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([WAITLISTED_ME]);
    fetchEventAcceptedCount.mockResolvedValue(8);
    render(<EventScreen />);

    expect(await screen.findByText('Table 1')).toBeTruthy();
    expect(screen.queryByText(/people have accepted/)).toBeNull();
  });
});
```

4. Add a new block at the end of the file:

```tsx
describe('game invites', () => {
  const OWEN = {
    profile_id: 'p-owen',
    role: 'member' as const,
    display_name: 'Owen B.',
    skill_level: null,
  };

  // Ada (the viewer) invited by Owen, her seat at Table 1 held.
  const INVITED_ADA = {
    ...SEATED_ADA,
    booking_id: 'b-inv',
    group_id: 'g-owen',
    status: 'invited' as const,
    booked_by: 'p-owen',
    booked_by_name: 'Owen B.',
    invite_holds_seat: true,
  };

  // Ravi invited by Owen, his seat at Table 1 held.
  const INVITED_RAVI = {
    ...SEATED_RAVI,
    booking_id: 'b-ravi-inv',
    group_id: 'g-owen',
    status: 'invited' as const,
    booked_by: 'p-owen',
    booked_by_name: 'Owen B.',
    invite_holds_seat: true,
  };

  it('shows the invitee a banner naming the sender and the held table', async () => {
    fetchRoster.mockResolvedValue([...MEMBER_ROLE, OWEN]);
    fetchEventSeating.mockResolvedValue([INVITED_ADA]);
    render(<EventScreen />);
    expect(
      await screen.findByText('Owen B. invited you to this game — Table 1'),
    ).toBeTruthy();
  });

  it("says an invite into a full game would join the waitlist", async () => {
    fetchEventSeating.mockResolvedValue([
      { ...INVITED_ADA, event_table_id: null, invite_holds_seat: false },
    ]);
    render(<EventScreen />);
    expect(
      await screen.findByText("Owen B. invited you to this game — you'd join the waitlist"),
    ).toBeTruthy();
  });

  it('accepts the invite', async () => {
    fetchEventSeating.mockResolvedValue([INVITED_ADA]);
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Accept the invite'));
    await waitFor(() => expect(acceptBookingInvite).toHaveBeenCalledWith('b-inv'));
  });

  it('declines an open-play invite and stays on the game', async () => {
    fetchEventSeating.mockResolvedValue([INVITED_ADA]);
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Decline the invite'));
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b-inv'));
    expect(push).not.toHaveBeenCalledWith('/clubs');
  });

  it('declines an invite-only invite and goes back to the dashboard', async () => {
    fetchEvent.mockResolvedValue({ ...EVENT, game_mode: 'invite_only' as const });
    fetchEventSeating.mockResolvedValue([INVITED_ADA]);
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Decline the invite'));
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b-inv'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/clubs'));
  });

  it('offers an invitee no seat tap and no waitlist -- the invite is their way in', async () => {
    // Table 1 full: three confirmed plus Ada's held seat.
    fetchEventSeating.mockResolvedValue([
      { ...SEATED_RAVI, booking_id: 'c1', profile_id: 'c1', display_name: 'C One' },
      { ...SEATED_RAVI, booking_id: 'c2', profile_id: 'c2', display_name: 'C Two' },
      { ...SEATED_RAVI, booking_id: 'c3', profile_id: 'c3', display_name: 'C Three' },
      INVITED_ADA,
    ]);
    render(<EventScreen />);
    await screen.findByText('Owen B. invited you to this game — Table 1');
    expect(screen.queryByLabelText('Join the waitlist')).toBeNull();
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });

  it('draws an empty seat as not tappable for an invitee', async () => {
    fetchEventSeating.mockResolvedValue([INVITED_ADA]);
    render(<EventScreen />);
    await screen.findByText('Owen B. invited you to this game — Table 1');
    const seats = screen.getAllByLabelText('Take a seat at Table 1');
    expect(seats[0].getAttribute('aria-disabled')).toBe('true');
  });

  it('shows an organizer who is invited and lets them withdraw it', async () => {
    fetchRoster.mockResolvedValue(HOST_ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([INVITED_RAVI]);
    render(<EventScreen />);
    expect(await screen.findByText('Ravi K.')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Manage the invite for Ravi K.'));
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Ravi K.'));
    await waitFor(() =>
      expect(withdrawBookingInvite).toHaveBeenCalledWith('b-ravi-inv'),
    );
  });

  it('shows another member an anonymous held seat they cannot manage', async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([
      { ...INVITED_RAVI, profile_id: null, display_name: null },
    ]);
    render(<EventScreen />);
    expect(await screen.findByText('Invited')).toBeTruthy();
    expect(screen.queryByLabelText(/Manage the invite/)).toBeNull();
  });

  it('reads "N playing · M invited" when invites are pending', async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_ADA, INVITED_RAVI]);
    render(<EventScreen />);
    expect(await screen.findByText('1 playing · 1 invited')).toBeTruthy();
  });

  it('has no playing/invited line when nobody is invited', async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_ADA, SEATED_RAVI]);
    render(<EventScreen />);
    await screen.findByText('Ravi K.');
    expect(screen.queryByText(/invited$/)).toBeNull();
  });

  it("does not show an invitee the sender's group offer", async () => {
    fetchEventSeating.mockResolvedValue([
      { ...INVITED_ADA, event_table_id: null, invite_holds_seat: false },
    ]);
    fetchOpenOffer.mockResolvedValue({
      id: 'offer-1',
      group_id: 'g-owen',
      offered_seat_count: 2,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    render(<EventScreen />);
    await screen.findByText("Owen B. invited you to this game — you'd join the waitlist");
    expect(screen.queryByLabelText('Take the 2 seats')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- app/__tests__/events-detail.test.tsx`
Expected: FAIL — no banner, no Withdraw on a held seat, no "1 playing · 1 invited", old privacy copy, an unplaced confirmed member still locked out, the offer card shown to an invitee.

- [ ] **Step 3: Update the imports**

The `lib/bookings` import block becomes:

```ts
import {
  acceptBookingInvite,
  acceptPromotionOffer,
  callForAFourth,
  cancelBooking,
  commitBooking,
  declineBooking,
  declinePromotionOffer,
  fetchEventAcceptedCount,
  fetchEventSeating,
  fetchOpenOffer,
  needsAFourth,
  placeBooking,
  proposeBooking,
  seatsRemaining,
  takesSeat,
  tierWarning,
  waitlistLabel,
  withdrawBookingInvite,
  type SeatOccupant,
  type SkillLevel,
} from '../../../../../lib/bookings';
```

- [ ] **Step 4: Update the derivations**

1. `gameFull`'s per-table count becomes (and its comment's "counting only bookings actually placed at one" gains "— confirmed, or held for a pending invite"):

```ts
    tables.every((t) => {
      const takenHere = seating.filter(
        (o) => takesSeat(o) && o.event_table_id === t.id,
      ).length;
      return seatsRemaining(t.capacity, takenHere) === 0;
    });
```

2. Directly after `const myHoldsSeat = myBooking !== undefined;` add:

```ts
  // This member's own pending game invite, if any. `myBooking` above stays
  // confirmed/waitlisted only -- an invite is not a seat yet, so it must
  // not unlock the roster or the leave controls. It drives the Accept /
  // Decline banner and blocks every "book myself" control below:
  // commit_booking would refuse (the invite is the one active row per
  // person per game).
  const myInvite = seating.find(
    (o) => o.profile_id === me && o.status === 'invited',
  );
  const invitedRows = seating.filter((o) => o.status === 'invited');
  // withdraw_booking_invite's own gate: any organizer, or the sender.
  const canWithdraw = (o: SeatOccupant) =>
    canBook && o.status === 'invited' && (isOrganizer || o.booked_by === me);
```

3. `canSeeFullRoster` becomes (and its comment: "a placed booking" → "a confirmed booking, placed or not (P1, 2026-09-24: 'accepted and holding a seat')"):

```ts
  const canSeeFullRoster =
    event.game_mode === 'open_play' ||
    isOrganizer ||
    myBooking?.status === 'confirmed';
```

4. `canJoinOpenSeating` becomes:

```ts
  const canJoinOpenSeating = isOpenSeating && canBook && !myHoldsSeat && !myInvite;
```

- [ ] **Step 5: Add the handlers**

Directly after `leaveSeat`:

```ts
  // The invitee's answers. Accept reloads like any seat change.
  async function acceptInvite() {
    if (!myInvite) return;
    await run(() => acceptBookingInvite(myInvite.booking_id));
  }

  // Declining an invite-only game's invite also removes the caller's only
  // reason to see it (events_select_member), so a reload would land on
  // "That game could not be loaded." -- go back to the dashboard instead
  // (P6). An organizer can always see their own game, so they stay.
  async function declineInvite() {
    if (!myInvite) return;
    setBusy(true);
    setError(null);
    const { error: declineError } = await declineBooking(myInvite.booking_id);
    setBusy(false);
    if (declineError) {
      setError(declineError);
      return;
    }
    if (event?.game_mode === 'invite_only' && !isOrganizer) {
      router.push('/clubs');
      return;
    }
    await load();
  }

  // The sender's or an organizer's Withdraw invite, from a held seat's
  // panel or the waitlist area's "Invited" card.
  async function withdrawInvite(bookingId: string) {
    setOpenBookingId(null);
    await run(() => withdrawBookingInvite(bookingId));
  }
```

(If `event` is already narrowed to non-null at this point in the component, write `event.game_mode` instead of `event?.game_mode` — follow what `leaveSeat`'s neighbours do.)

- [ ] **Step 6: Update the JSX**

1. Directly after `{error ? <ErrorBanner message={error} /> : null}` add the banner:

```tsx
      {myInvite && canBook ? (
        <Card>
          <Text style={styles.inviteBanner}>
            {`${myInvite.booked_by_name} invited you to this game${
              myInvite.event_table_id
                ? ` — ${tables.find((t) => t.id === myInvite.event_table_id)?.label ?? 'a table'}`
                : myInvite.invite_holds_seat === false
                  ? " — you'd join the waitlist"
                  : ''
            }`}
          </Text>
          <View style={styles.chips}>
            <Button
              big={false}
              disabled={busy}
              onPress={() => void acceptInvite()}
              accessibilityLabel="Accept the invite"
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => void declineInvite()}
              accessibilityLabel="Decline the invite"
            >
              Decline
            </Button>
          </View>
        </Card>
      ) : null}
```

2. The "Getting a seat" TipCard's condition gains `&& !myInvite`:

```tsx
      {!isOrganizer && !myInvite && event.status !== 'cancelled' && canBook && guides.isVisible('tip:event') ? (
```

3. Directly after the section-title `</Text>` (the one that renders "N tables · M seats" / "N signed up"), add the P7 line:

```tsx
      {canSeeFullRoster && invitedRows.length > 0 ? (
        <Text style={styles.help}>
          {`${seating.filter((o) => o.status === 'confirmed').length} playing · ${invitedRows.length} invited`}
        </Text>
      ) : null}
```

4. In the per-table map, after `const confirmedHere = confirmedAtTable.length;` add:

```ts
                  // Seats actually taken here: confirmed plus held invites.
                  // A held seat is not a missing fourth.
                  const takenHere = tableOccupants.filter(takesSeat).length;
```

5. On `<TableCard>`: `onTakeSeat` gains a leading `!myInvite &&`:

```tsx
                      onTakeSeat={
                        !myInvite &&
                        (myBooking && myBooking.status === 'confirmed'
                          ? canManageOwnSeat
                          : canBook) &&
                        (!myBooking ||
                          (myBooking.status === 'confirmed' &&
                            myBooking.event_table_id !== table.id))
                          ? () => takeSeat(table)
                          : undefined
                      }
```

`needsFourth` passes `takenHere` instead of `confirmedHere`:

```tsx
                      needsFourth={needsAFourth(
                        table.capacity,
                        takenHere,
                        new Date(event.starts_at),
                        now,
                      )}
```

and add, next to `onToggleManage={toggleManageSeat}`:

```tsx
                      isOrganizer={isOrganizer}
                      onWithdrawInvite={canBook ? withdrawInvite : undefined}
```

6. The "Call for a 4th now" gate: `confirmedHere === table.capacity - 1 &&` → `takenHere === table.capacity - 1 &&`. (If `confirmedHere` is then unused, delete its declaration and `confirmedAtTable`'s, unless something else still reads them.)

7. The locked privacy card's second sentence becomes invite-aware:

```tsx
        <Card>
          <Text style={styles.help}>
            {acceptedCount === null
              ? 'This is an invite-only game.'
              : `${acceptedCount} ${acceptedCount === 1 ? 'person has' : 'people have'} accepted.`}
            {' '}
            {myInvite
              ? "You'll see who else is playing once you accept."
              : "You won't see who else is playing until you have a seat."}
          </Text>
        </Card>
```

(and its leading comment: "accepted-but-not-yet-placed invitee" → "viewer without a confirmed booking — waitlisted, or a pending invitee".)

8. `BringSomeoneSheet`'s `booked` prop:

```tsx
          booked={seating
            .map((o) => o.profile_id)
            .filter((id): id is string => id !== null)}
```

9. "Join the waitlist" gains `&& !myInvite`:

```tsx
      {canBook && gameFull && !myHoldsSeat && !myInvite ? (
```

10. `<WaitlistPanel>` gains the invite props and gates the offer:

```tsx
      <WaitlistPanel
        unseated={unseatedBookings}
        waiting={seating.filter((o) => o.status === 'waitlisted')}
        invited={invitedRows.filter((o) => o.event_table_id === null)}
        canWithdraw={canWithdraw}
        onWithdrawInvite={withdrawInvite}
        youId={me}
        // Never to a pending invitee: fetchOpenOffer reads
        // promotion_offers through is_booking_group_member, which has no
        // status filter, so an invitee in the sender's group would
        // otherwise see the sender's offer -- one only the group's
        // creator can take.
        offer={myInvite ? null : offer}
        now={now}
        busy={busy}
        onAcceptOffer={acceptOffer}
        onDeclineOffer={declineOffer}
        onLeaveWaitlist={leaveWaitlist}
        tables={isOrganizer ? tables : undefined}
        onSeat={isOrganizer ? hostPlace : undefined}
      />
```

11. In `StyleSheet.create`, after `chips`, add:

```ts
  inviteBanner: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
```

- [ ] **Step 7: Run the tests and the type check**

Run: `npm test -- app/__tests__/events-detail.test.tsx app/__tests__/bookings-detail.test.tsx`
Expected: PASS (bookings-detail exercises the same screen, including the offer banner for a viewer with no seating rows — which is why the offer gate is `myInvite`, not `myBooking`; it holds no invited rows).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" app/__tests__/events-detail.test.tsx
git commit -m "$(cat <<'EOF'
feat(event): accept/decline banner, withdraw, and held seats on the game screen

The invitee gets an Accept / Decline banner and no self-booking
controls; declining an invite-only game returns to the dashboard.
Organizers and senders withdraw held invites. Held seats fill tables,
"N playing · M invited" appears while invites are pending, and the
invite-only roster opens to any confirmed member.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Dashboard — game-invite cards and "Can't make it"

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/your-games.test.tsx`

**Interfaces:**
- Consumes: `acceptBookingInvite`, `declineBooking`, `cancelBooking`, `MyBooking.invite_holds_seat` (Task 7); `pendingGameInvites` and the invite-free `buildDashboardRows` (Task 7); `my_upcoming_bookings` returning invited rows (Task 5).
- Produces:
  - `GameInviteCards` (local component in `app/clubs/index.tsx`), rendered directly after the club-invite `PendingInviteCards` in the populated dashboard: one card per pending game invite reading "*Sender* invited you to *Game* — *Table N*" (or "— you'd join the waitlist"; no suffix for a held any-table seat), a "*Club* · *when*" line, **Accept** (`acceptBookingInvite`) and **Decline** (`declineBooking`). This is the only new dashboard surface. (The empty-clubs branch needs none: a game invite requires club membership.)
  - "Your games": on a seat someone else booked for you (an accepted invite), the leave control is **Can't make it** → `cancelBooking` (which now tells the sender), replacing **Decline**. The `GameRow` / `BookingSeatControls` prop `onDecline` is renamed `onCantMakeIt`.

- [ ] **Step 1: Update the existing "Your games" tests and write the failing new ones**

In `app/__tests__/your-games.test.tsx`:

1. Add a double next to the others and wire it into the `lib/bookings` mock:

```ts
const acceptBookingInvite = vi.fn();
```

```ts
    acceptBookingInvite: (...a: unknown[]) => acceptBookingInvite(...a),
```

and in `beforeEach`, next to `cancelBooking.mockReset();`:

```ts
  acceptBookingInvite.mockReset();
```

2. Replace `'says who booked a seat for you, and offers a way out'` with:

```tsx
  it("says who booked a seat for you, and offers Can't make it", async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({ booked_by: 'p2', booked_by_name: 'Jane P.' }),
    ]);
    cancelBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    expect(await screen.findByText('Jane P. booked this for you')).toBeTruthy();
    expect(screen.getByText("Can't make it")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText("Can't make Tuesday game — tell Jane P."),
    );
    await waitFor(() => expect(cancelBooking).toHaveBeenCalledWith('b1'));
    expect(declineBooking).not.toHaveBeenCalled();
  });
```

3. Replace `'offers no decline on a seat you booked yourself'` with:

```tsx
  it('offers no way out on a seat you booked yourself', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([booking()]);
    render(<ClubsScreen />);
    await screen.findByText("St Mary's Hall");
    expect(screen.queryByText(/booked this for you/)).toBeNull();
    expect(screen.queryByText("Can't make it")).toBeNull();
  });
```

4. In `'renders the data layer refusal verbatim, not a generic message'`: `declineBooking.mockResolvedValue({` → `cancelBooking.mockResolvedValue({`, and `await screen.findByLabelText('Decline the seat Jane P. booked')` → `await screen.findByLabelText("Can't make Tuesday game — tell Jane P.")`.

5. Rename `'hides Decline on an in-progress booking someone else made, but keeps the check-in control'` to `"hides Can't make it on an in-progress booking someone else made, but keeps the check-in control"`, change its comment's "Decline" to "Can't make it", and replace its `screen.queryByLabelText('Decline the seat Jane P. booked')` with `screen.queryByLabelText("Can't make Tuesday game — tell Jane P.")`.

6. Add at the end of the file:

```tsx
describe('Game invites on the dashboard', () => {
  function invite(overrides: Partial<MyBooking> = {}): MyBooking {
    return booking({
      status: 'invited',
      booked_by: 'p2',
      booked_by_name: 'Jane P.',
      invite_holds_seat: true,
      ...overrides,
    });
  }

  it('shows a pending invite as its own card, not a "Your games" row', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([invite()]);
    render(<ClubsScreen />);
    expect(
      await screen.findByText('Jane P. invited you to Tuesday game — Table 2'),
    ).toBeTruthy();
    expect(screen.queryByText('Seated · Table 2')).toBeNull();
    expect(screen.queryByText('Jane P. booked this for you')).toBeNull();
  });

  it("says an invite into a full game would join the waitlist", async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      invite({ event_table_id: null, table_label: null, invite_holds_seat: false }),
    ]);
    render(<ClubsScreen />);
    expect(
      await screen.findByText(
        "Jane P. invited you to Tuesday game — you'd join the waitlist",
      ),
    ).toBeTruthy();
  });

  it('accepts from the card', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([invite()]);
    acceptBookingInvite.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByLabelText('Accept the invite to Tuesday game'),
    );
    await waitFor(() => expect(acceptBookingInvite).toHaveBeenCalledWith('b1'));
  });

  it('declines from the card', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([invite()]);
    declineBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByLabelText("Decline Jane P.'s invite to Tuesday game"),
    );
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b1'));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- app/__tests__/your-games.test.tsx`
Expected: FAIL — the seat still says "Decline" and calls `declineBooking`; an invited booking renders as a "Your games" row, not a card.

- [ ] **Step 3: Update `app/clubs/index.tsx` imports**

The `lib/bookings` import becomes:

```ts
import {
  acceptBookingInvite,
  acceptPromotionOffer,
  cancelBooking,
  commitBooking,
  declineBooking,
  declinePromotionOffer,
  fetchMyUpcomingBookings,
  offerCountdown,
  waitlistLabel,
} from '../../lib/bookings';
```

and the `lib/dashboard` import gains `pendingGameInvites`:

```ts
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  inScope,
  needAFourthAlerts,
  pendingGameInvites,
} from '../../lib/dashboard';
```

- [ ] **Step 4: Add the handlers**

Directly after `handleDecline` (which stays — it now answers a game invite):

```ts
  function handleAcceptGameInvite(booking: MyBooking) {
    void runBookingAction(() => acceptBookingInvite(booking.booking_id));
  }

  // "Can't make it" on a seat someone else secured for you (an accepted
  // invite): cancel_booking, which tells the sender
  // (booking_cancelled_by_member). Replaces the old Decline here --
  // declining is for answering an invite, not for leaving a game you
  // already said yes to.
  function handleCantMakeIt(booking: MyBooking) {
    void runBookingAction(() => cancelBooking(booking.booking_id));
  }
```

- [ ] **Step 5: Render the invite cards**

In the populated branch, directly after:

```tsx
      <PendingInviteCards
        invites={pendingInvites}
        busy={busy}
        onAccept={handleAcceptInvite}
        onDecline={handleDeclineInvite}
      />
```

add:

```tsx
      <GameInviteCards
        invites={pendingGameInvites(bookings ?? []).filter((invite) =>
          inScope(invite.club_id, selected),
        )}
        busy={busy}
        onAccept={handleAcceptGameInvite}
        onDecline={handleDecline}
      />
```

(Leave the empty-clubs branch's `PendingInviteCards` alone.)

In the "Your games" map, `onDecline={handleDecline}` on `<GameRow>` → `onCantMakeIt={handleCantMakeIt}`.

- [ ] **Step 6: Add `GameInviteCards`**

Directly after the `PendingInviteCards` function:

```tsx
/**
 * A pending game invite (bookings.status 'invited', from
 * my_upcoming_bookings) -- the invitee's one dashboard surface for
 * answering it. Sits beside the club-invite card: both are "somebody asked
 * you something", and neither belongs in "Your games" until it is
 * answered.
 */
function GameInviteCards({
  invites,
  busy,
  onAccept,
  onDecline,
}: {
  invites: MyBooking[];
  busy: boolean;
  onAccept: (booking: MyBooking) => void;
  onDecline: (booking: MyBooking) => void;
}) {
  return (
    <>
      {invites.map((invite) => {
        const where = invite.table_label
          ? ` — ${invite.table_label}`
          : invite.invite_holds_seat === false
            ? " — you'd join the waitlist"
            : '';
        return (
          <Card key={invite.booking_id}>
            <Text style={styles.inviteHeading}>
              {`${invite.booked_by_name} invited you to ${invite.event_title}${where}`}
            </Text>
            <Text style={styles.help}>
              {`${invite.club_name} · ${formatEventWhen(invite.starts_at, invite.club_timezone)}`}
            </Text>
            <Button
              block
              disabled={busy}
              onPress={() => onAccept(invite)}
              accessibilityLabel={`Accept the invite to ${invite.event_title}`}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onDecline(invite)}
              accessibilityLabel={`Decline ${invite.booked_by_name}'s invite to ${invite.event_title}`}
            >
              Decline
            </Button>
          </Card>
        );
      })}
    </>
  );
}
```

(Both accessibility labels are chosen never to collide with the club card's `Join <club>` / `Decline the invite to <club>`.)

- [ ] **Step 7: "Can't make it" in "Your games"**

1. In `GameRow`: the destructured prop `onDecline,` → `onCantMakeIt,`; its type `onDecline: (booking: MyBooking) => void;` → `onCantMakeIt: (booking: MyBooking) => void;`; and where it renders `<BookingSeatControls`, `onDecline={onDecline}` → `onCantMakeIt={onCantMakeIt}`.
2. In `BookingSeatControls`: the same rename in the destructuring and the prop type; in its doc comment, "a seat someone else booked for you (decline)" → "a seat someone else booked for you (can't make it)".
3. Replace the `bookedByOther` branch:

```tsx
      ) : bookedByOther ? (
        <>
          <Text style={styles.friendNote}>
            {booking.booked_by_name} booked this for you
          </Text>
          {notStarted ? (
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onCantMakeIt(booking)}
              accessibilityLabel={`Can't make ${booking.event_title} — tell ${booking.booked_by_name}`}
            >
              {"Can't make it"}
            </Button>
          ) : null}
        </>
```

- [ ] **Step 8: Run the tests and the type check**

Run: `npm test -- app/__tests__/your-games.test.tsx app/__tests__/clubs.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/your-games.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): game invite Accept/Decline cards and "Can't make it"

Pending game invites get their own card next to the club-invite card.
A seat someone else booked for you now offers "Can't make it", which
cancels and tells the sender, instead of Decline.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Verification, visual baseline, by-hand check, QA Pass, PR

**Files:**
- Modify: `e2e/visual.spec.ts-snapshots/clubs-populated-desktop-darwin.png`, `e2e/visual.spec.ts-snapshots/clubs-populated-mobile-darwin.png` (regenerated)
- Modify: `e2e/session.ts` (one comment)
- Commit (if not already committed): `docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md`, `docs/superpowers/plans/2026-09-24-game-invites-accept-decline.md`
- Update (outside the repo): the **MahjHero QA Pass** artifact, https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB

**Interfaces:**
- Consumes: everything above. Changes no behaviour; if a check below fails, fix it in the task that owns the code (and re-run that task's tests) before continuing.

- [ ] **Step 1: Full automated suite**

Run, in order, and read each result:

```bash
npx supabase db reset --local && npm run test:db
npm test
npx tsc --noEmit
npm run test:contract
```

Expected: all green. Record the pgTAP total and the Vitest totals; compare with `main` (`git stash` is not needed — run `npm test` on `main` in a scratch worktree only if the numbers look off). The DB suite gains `game_invites_schema` (9), `invite_capacity` (38), `booking_invites` (68), `invite_privacy` (21), `invite_notifications` (4), plus `bookings_commit` +7, `event_reminders` +1, `series_shortening_notifies` +1 and `grants` +1.

- [ ] **Step 2: Refresh ONLY the `clubs-populated` baseline**

The "Your games" friend-booked row on `/clubs` (seeded by `seatBooking(..., { bookedBy: owen })` in `e2e/session.ts`) now shows "Can't make it" instead of "Decline". No other screen's seed contains an invite, so no other baseline should move — and about 35 baselines are already red on `main` for unrelated reasons; do NOT regenerate those.

1. In `e2e/session.ts`, in the comment above that `seatBooking` call, change `you" and the Decline control` to `you" and the "Can't make it" control`.
2. Run:

```bash
npx playwright test -g "clubs list with a club" --update-snapshots=all
```

3. Open both regenerated PNGs (`e2e/visual.spec.ts-snapshots/clubs-populated-desktop-darwin.png` and `...-mobile-darwin.png`) with the Read tool and confirm the ONLY difference is the button label on the friend-booked row. If anything else moved, stop and investigate instead of committing.
4. Run `npx playwright test -g "clubs list with a club"` again: it must pass without `--update-snapshots`.
5. The visual run writes seeded rows into the local database: `npx supabase db reset --local` afterwards.

```bash
git add e2e/session.ts \
  e2e/visual.spec.ts-snapshots/clubs-populated-desktop-darwin.png \
  e2e/visual.spec.ts-snapshots/clubs-populated-mobile-darwin.png
git commit -m "$(cat <<'EOF'
test(visual): refresh clubs-populated for "Can't make it"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: By-hand check in the browser preview**

jsdom does not prove this feature works; check it in a real browser. Start the app with the Browser pane (`preview_start`, configuration `mahjhero-web` from `.claude/launch.json`). First confirm the app is pointed at the LOCAL Supabase stack (`EXPO_PUBLIC_SUPABASE_URL` → `http://127.0.0.1:54321` in the env file Expo loads). If it points at mahjhero-dev — which does not have these migrations — stop and ask the user; do not push migrations. Use two local accounts (sign-in codes arrive in the local mail catcher that `npx supabase status` lists), both members of one club, A a host.

Check, and record the actual outcome of each:
1. Open play, assigned tables: B opens a game and taps **Invite**, picks A → the button reads **Send invites**; B's seat and A's held seat appear; A's seat shows A's name with an **Invited** tag, dimmed.
2. As A: the game shows the banner "B invited you to this game — Table N" with Accept / Decline; no Empty-seat tap, no Join the waitlist. The dashboard shows the game-invite card with the club and date.
3. A taps **Accept** on the dashboard card → the card goes; the game appears in "Your games" with "B booked this for you" and **Can't make it**.
4. A taps **Can't make it** → the seat frees (as B, the table shows an Empty seat again).
5. B invites A again, then withdraws: tap A's held seat → the panel offers only **Withdraw invite** → the seat frees; A's dashboard card disappears on reload.
6. Invite-only game (A hosts, invites B): as B, the game is visible with the banner and the "N people have accepted. You'll see who else is playing once you accept." card; **Decline** returns B to `/clubs` and the game is gone from the dashboard.
7. A full game: A invites B → B's invite reads "— you'd join the waitlist"; accepting puts B on the waitlist ("Waiting for a seat").
8. Mobile width (`resize_window` preset `mobile`): the banner, the Invited seat and the dashboard card lay out without overflow. Reset with preset `desktop` afterwards.

Screenshot each state you check. Reset the local database afterwards (`npx supabase db reset --local`).

- [ ] **Step 4: Update the MahjHero QA Pass artifact (per `CLAUDE.md`)**

1. Read the live artifact: `Artifact` with `action: "read"`, `url: "https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB"`. Work from the saved file the result names — never from memory of its content.
2. Find every scenario this change makes wrong or incomplete. Expect at least: the scenario(s) covering **Invite** / Bring someone (the sheet now says **Send invites**; the invitee is not seated until they accept), the seating/Withdraw steps (held **Invited** seats, **Withdraw invite**), the dashboard invite area (the new game-invite card with **Accept** / **Decline**), and any "Your games" step that says **Decline** on a seat someone else booked (now **Can't make it**). An invite-only scenario that expects a not-yet-placed confirmed member to see only the headcount is also now wrong (they see the roster; the headcount card is for waitlisted members and pending invitees).
3. For each affected step, verify the exact label/copy against the source you just shipped (`components/BringSomeoneSheet.tsx`, `components/SeatGrid.tsx`, `components/WaitlistPanel.tsx`, `app/clubs/[id]/events/[eventId]/index.tsx`, `app/clubs/index.tsx`) — never reuse wording from this plan without checking it against the code.
4. Edit only the affected scenario(s). Keep every existing checkbox `data-id` as is (it is also the local-storage key for a tester's saved checkmark); give new steps new ids instead of renumbering.
5. Update that scenario's `data-progress-for` fraction and the footer's total step count if the number of steps changed.
6. Republish in place: `Artifact` publish with `url: "https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB"` and `file_path` = the edited file. Do not publish without `url` (that creates a duplicate).

- [ ] **Step 5: Commit the design docs and open the PR**

```bash
git status --short
```

Confirm `CLAUDE.md` and `social media assets/` are still untracked and NOT staged. Then, if the spec revision and this plan are not already committed:

```bash
git add docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md \
  docs/superpowers/plans/2026-09-24-game-invites-accept-decline.md
git commit -m "$(cat <<'EOF'
docs: game invites design revision and implementation plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Push and open the PR against `main`:

```bash
git push -u origin feat/game-invites-accept-decline
gh pr create --base main --title "Game invites: accept / decline, held seats, withdraw" --body "$(cat <<'EOF'
## Summary
- Inviting another member to a game (open play or invite-only) now creates a pending `invited` booking that holds a seat (or, in a full game, a waitlist place) until they accept or decline, the sender or a host withdraws it, or the game starts.
- New RPCs `accept_booking_invite` / `withdraw_booking_invite`; `decline_booking` takes invites; `cancel_booking` tells the sender when an accepted invitee drops out; a 5-minute cron sweep closes invites at kickoff.
- Emails: invited, accepted, withdrawn, member-cancel; "declined your invite" rewording.
- Invite-only privacy: only organizers, the sender and the invitee see who is invited (RLS + `event_seating`); the roster unlocks on any confirmed booking.
- App: held "Invited" seats with Withdraw invite, invitee banner, "N playing · M invited", "Send invites", dashboard game-invite card, "Can't make it".

## Migrations
`20260924100000` … `20260924105000` (thirteen files). Not yet applied to mahjhero-dev.

## Test plan
- [ ] `npm run test:db` (new: game_invites_schema, invite_capacity, booking_invites, invite_privacy, invite_notifications)
- [ ] `npm test`, `npx tsc --noEmit`, `npm run test:contract`
- [ ] `clubs-populated` visual baseline refreshed (only that one)
- [ ] By-hand browser pass (Task 11 Step 3 of the plan)
- [ ] MahjHero QA Pass artifact updated

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL, the test totals from Step 1, the by-hand results from Step 3, and which QA Pass scenarios changed.

---

## Self-Review

**Spec coverage** (spec section → task):
- Decisions 1–2, 8; Data model (`invited`, `invite_holds_seat`, four outbox kinds, one `add value` per file) → Task 1.
- Decision 2 "pending invites hold seats"; "What `invited` counts toward" — capacity, need-a-fourth free seat and recipients, removing a table (no change needed, pinned by test) → Task 2; one-active-row → Tasks 1 + 3; headcount / promotion / reminders / check-in exclusions → Tasks 2, 5 (explicit no-change list) and the tests in Tasks 2 (incl. the `event_reminders` pin), 4, 5; `close_group_if_empty` → Task 3.
- Sending (sender booked, others invited, held tables, full game → no table, `booking_invited` replaces `booked_by_friend`, permissions unchanged) → Task 3.
- Accept (invitee only, guards, held → confirmed, unheld → new solo waitlisted group, close old group, promote, `booking_invite_accepted`, no organizer re-check; membership re-check P8) → Task 4.
- Decline (invited rows, frees seat, `booking_declined`, close group, promote) → Task 4; reworded body → Task 6.
- Withdraw (sender or organizer, invited, not started, `booking_invite_withdrawn`, close, promote) → Task 4 (DB), Tasks 8–9 (UI).
- Game start sweep + cron → Task 4.
- Leaving after accepting (`booking_cancelled_by_member`; host removal unchanged) → Task 4 (DB), Task 10 ("Can't make it").
- Decision 4 (invite into a full game allowed) → Tasks 3, 4 tests; UI copy "you'd join the waitlist" → Tasks 8–10.
- Decision 6 notifications both ways; Notifications table → Task 6 (templates, actor `accepted_by` P3, Alerts feed).
- Decision 7 guest invites unchanged → no task touches `create_club_invite` / `accept_club_invite` (`accept_club_invite` calls `assert_players_bookable` inside its own best-effort block; a brand-new member cannot hold an invite, so the new refusal cannot reach it).
- Who sees pending invitees (revised; P1) → Task 5 (RLS, `event_seating`, roster unlock), Task 9 (`canSeeFullRoster`, copy), Task 8 (anonymous seat).
- UI: game screen sender/host, other members, invitee → Tasks 8–9; "Send invites" (P2) → Task 8; headcount line (P7) → Task 9; decline → `/clubs` (P6) → Task 9; dashboard card → Task 10; "Your games" "Can't make it" → Task 10.
- Edge cases: sender cancels while invites pending (group stays open; P5 flip) → Task 3 test; game cancelled → Task 4 (`cancel_event`, `cancel_booking_group`, series shortening); mode switched → no code (existing rows untouched); host moves a held seat → not offered (Task 8; `place_booking` refuses, Task 2 test); table-less accept with a seat free → normal waitlist flow (Task 4).
- Testing section: pgTAP (Tasks 1–6), Vitest (Tasks 6–10), notification snapshots (Task 6), visual baselines (Task 11 — only `clubs-populated`), QA Pass artifact (Task 11).
- Out of the spec's text but required by the code: refusal mappings (P4) → Task 7; `lib/schema-contract.test.ts` → Task 5; `docs/testing.md` cron table → Task 4; offer card hidden from invitees → Task 9.

**Placeholder scan:** no TBD/TODO. Line numbers quoted for existing files are as of `97d2a04`; each edit also names the surrounding code to find it by.

**Name consistency:** `accept_booking_invite(uuid)` / `withdraw_booking_invite(uuid)` / `close_started_invites()` (Task 4) ↔ `acceptBookingInvite` / `withdrawBookingInvite` (Task 7) ↔ grants allowlists (Task 4) ↔ screens (Tasks 9–10). `invite_holds_seat` everywhere (column, `event_seating`, `my_upcoming_bookings`, `EVENT_COLUMNS`, `SeatOccupant`, `MyBooking`, `EventBookingRow`). Payload keys `holds_seat` / `accepted_by` / `waitlisted` / `cancelled_by` written in Tasks 3–4 are the ones read in Task 6. Refusal strings `'already invited'` (Task 3) and `'invite already accepted'` (Task 4) are the ones mapped in Task 7. `takesSeat` (Task 7) is used by Tasks 7 and 9. `SeatGrid` `onWithdrawInvite` / `Seat.invited` / `Seat.canWithdraw` and `TableCard` `isOrganizer` / `onWithdrawInvite` and `WaitlistPanel` `invited` / `canWithdraw` / `onWithdrawInvite` (Task 8) are exactly what Task 9 passes.
