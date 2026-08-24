# Notifications & Comms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain `notification_outbox` to email, add event reminders and host broadcasts, so that MahjHero finally tells people the things it has been silently recording since plan 4.

**Architecture:** `pg_cron` pings a Supabase Edge Function once a minute through `pg_net`. The function calls `claim_notification_batch()`, an RPC that expires stale rows, filters by each recipient's quiet hours and mutes, takes a five-minute lease on what remains, and returns rows already joined into render context. The function renders one branded HTML shell plus a plain-text alternative, sends over SMTP, and reports back through `mark_notifications_sent()` / `mark_notifications_failed()`. Two new producers feed the queue: a 15-minute reminder job reading `clubs.reminder_offsets`, and `send_broadcast()` fanning a stored broadcast out to a roster or to one event's booked members.

**Tech Stack:** Postgres 15 (plpgsql, `pg_cron`, `pg_net`, pgTAP), Supabase Edge Functions (Deno), `denomailer` for SMTP, React Native / Expo Router with `react-native-web`, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-08-23-notifications-and-comms-design.md](../specs/2026-08-23-notifications-and-comms-design.md)

## Global Constraints

- **Every new SQL function is revoked from `public`, `anon`, AND `authenticated`.** Supabase's hosted bootstrap grants `EXECUTE` to `authenticated` at function-creation time, and `revoke ... from public` does not clear it. Only `send_broadcast` and `broadcast_recipient_count` are then granted back to `authenticated`. This repository has been retro-fixed for exactly this four times.
- **Every new table gets `revoke all ... from authenticated` before any `grant`.** Supabase grants `ALL` (including `TRUNCATE`, which ignores RLS) by default.
- **Migrations are forward-only.** Never edit a committed migration. Fix forward with a new one.
- **Every pgTAP file starts with `begin;` then `set local search_path to extensions, public;` then `select plan(N);` and ends with `select * from finish();` and `rollback;`.** pgTAP lives in `extensions`, which is not on the runner's search_path.
- **`alter type ... add value` cannot be used in the transaction that adds it.** New enum values land in their own migration, ahead of any migration referencing them.
- **Colour, spacing, radius, and type values come from `lib/theme`** — never literals — in all React Native code. The Edge Function is the one exception and duplicates a handful of hex values in `brand.ts` with a pointer comment on both sides, because Deno cannot resolve through Metro.
- **Client functions in `lib/` never reject.** They resolve `{ error: string | null }` or `null`, logging the original cause with `console.error`. A screen awaits them directly.
- **Push is wired but dark.** `resolve_notify_channel` returns `'email'` on every branch. Do not add push delivery, `expo-notifications`, or token registration in this plan.
- **Test commands:** `npm test` (Vitest), `npm run test:db` (pgTAP, local), `npm run test:visual` (Playwright). The local Supabase stack must be running (`npx supabase start`) for `test:db`.

## File Structure

**Migrations** (`supabase/migrations/`)

| File | Responsibility |
|---|---|
| `20260826000000_outbox_kinds_reminder_and_broadcast.sql` | Two `outbox_kind` values, alone in their own transaction |
| `20260826010000_outbox_delivery_lifecycle.sql` | Five lifecycle columns, terminal-state constraint, due index |
| `20260826020000_push_tokens.sql` | `push_tokens` table, RLS, grants |
| `20260826030000_broadcasts.sql` | `broadcasts` table, `broadcast_recipients`, `broadcast_recipient_count`, `send_broadcast` |
| `20260826040000_notification_predicates.sql` | `in_quiet_window`, `outbox_quiet_class`, `outbox_expires_at`, `outbox_backoff`, `outbox_max_attempts` |
| `20260826050000_outbox_render_context.sql` | `resolve_notify_channel`, `outbox_render_context` |
| `20260826060000_claim_notification_batch.sql` | The claim RPC |
| `20260826070000_mark_notifications.sql` | `mark_notifications_sent`, `mark_notifications_failed` |
| `20260826080000_queue_event_reminders.sql` | The reminder producer and its cron job |
| `20260826090000_schedule_notification_drain.sql` | `app_config`, `pg_net`, the one-minute drain job |

**Edge Function** (`supabase/functions/deliver-notifications/`)

| File | Responsibility |
|---|---|
| `types.ts` | `RenderRow`, `Message`, `Body` — shared shapes, no logic |
| `sender.ts` | `Sender` interface and `FakeSender` — no Deno imports, so Vitest can reach it |
| `smtp.ts` | `SmtpSender`, the only file that imports a Deno URL module |
| `brand.ts` | Colours and wordmark mirrored from `lib/theme` |
| `templates/shell.ts` | The one table-based HTML layout |
| `templates/bodies.ts` | `kind -> { subject, headline, paragraphs, cta, footerNote }` |
| `render.ts` | Composes a `Body` and the shell into a `Message` |
| `batch.ts` | The send loop and its per-message failure guard — no Deno imports |
| `index.ts` | HTTP handler, secret check, environment wiring |

**Client** (`lib/`, `app/`, `components/`)

| File | Responsibility |
|---|---|
| `lib/broadcasts.ts` | Types, column list, `fetchBroadcasts`, `countBroadcastRecipients`, `sendBroadcast` |
| `app/clubs/[id]/broadcast.tsx` | Compose screen, both targets, confirmation step |
| `app/clubs/[id]/broadcasts.tsx` | Sent history |

**Tests**

| File | Responsibility |
|---|---|
| `supabase/tests/database/fixtures/outbox_lifecycle.test.sql` | Tasks 1, 2 |
| `supabase/tests/database/fixtures/broadcasts.test.sql` | Task 3 |
| `supabase/tests/database/fixtures/notification_predicates.test.sql` | Task 4 |
| `supabase/tests/database/fixtures/notification_claim.test.sql` | Tasks 5, 6, 7 |
| `supabase/tests/database/fixtures/event_reminders.test.sql` | Task 8 |
| `supabase/functions/deliver-notifications/__tests__/render.test.ts` | Tasks 9, 10 (runs under Vitest, not Deno) |
| `lib/broadcasts.test.ts` | Task 12 |
| `components/__tests__/TextField.test.tsx` | Task 13 |
| `app/__tests__/broadcast.test.tsx` | Task 13 |
| `app/__tests__/broadcasts-history.test.tsx` | Task 14 |
| `supabase/tests/database/portable/grants.test.sql` | Task 15 (extended) |
| `lib/schema-contract.test.ts` | Task 15 (extended) |
| `e2e/visual.spec.ts` | Task 15 (extended) |

---

## Task 1: Outbox delivery lifecycle

**Files:**
- Create: `supabase/migrations/20260826000000_outbox_kinds_reminder_and_broadcast.sql`
- Create: `supabase/migrations/20260826010000_outbox_delivery_lifecycle.sql`
- Create: `supabase/tests/database/fixtures/outbox_lifecycle.test.sql`

**Interfaces:**
- Consumes: `public.notification_outbox` and `public.outbox_kind` from plan 4 (`20260825000000_create_bookings.sql`).
- Produces: `outbox_kind` values `'event_reminder'` and `'broadcast'`; columns `attempts int`, `next_attempt_at timestamptz`, `last_error text`, `failed_at timestamptz`, `expired_at timestamptz` on `notification_outbox`; index `notification_outbox_due`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/outbox_lifecycle.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(14);

-- The two new kinds. enum_range is the only way to ask "does this enum
-- carry this label" without casting, and a cast would fail the whole file
-- rather than fail one assertion.
select ok(
  'event_reminder' = any(enum_range(null::public.outbox_kind)::text[]),
  'outbox_kind carries event_reminder'
);
select ok(
  'broadcast' = any(enum_range(null::public.outbox_kind)::text[]),
  'outbox_kind carries broadcast'
);

select has_column('public', 'notification_outbox', 'attempts',        'attempts exists');
select has_column('public', 'notification_outbox', 'next_attempt_at', 'next_attempt_at exists');
select has_column('public', 'notification_outbox', 'last_error',      'last_error exists');
select has_column('public', 'notification_outbox', 'failed_at',       'failed_at exists');
select has_column('public', 'notification_outbox', 'expired_at',      'expired_at exists');

select col_not_null('public', 'notification_outbox', 'attempts',
                    'attempts is not null');
select col_not_null('public', 'notification_outbox', 'next_attempt_at',
                    'next_attempt_at is not null');
select col_default_is('public', 'notification_outbox', 'attempts', '0',
                      'attempts defaults to 0');

-- A row inserted by plan 4's producers must be due immediately, or the
-- very first drain would find an empty queue.
insert into auth.users (id, email)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'event_cancelled', '{}'::jsonb, 'lifecycle:1');

select ok(
  (select next_attempt_at <= now() from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'a freshly queued row is due immediately'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  0,
  'a freshly queued row has made no attempts'
);

-- The terminal states are mutually exclusive. Without the constraint a
-- retry could mark a row both failed and sent, and "what happened to this
-- message" stops being answerable from the row.
select throws_ok(
  $$update public.notification_outbox
       set sent_at = now(), failed_at = now()
     where id = '0b0b0b0b-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'a row cannot be both sent and failed'
);

select has_index('public', 'notification_outbox', 'notification_outbox_due',
                 'the due index exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL. `outbox_lifecycle.test.sql` reports the enum assertions failing and `has_column` failing for all five columns.

- [ ] **Step 3: Add the enum values, alone**

Create `supabase/migrations/20260826000000_outbox_kinds_reminder_and_broadcast.sql`:

```sql
/*
 * Two new kinds, alone in their own migration.
 *
 * `alter type ... add value` cannot be used by any statement in the same
 * transaction that adds it, and each migration file is one transaction.
 * Every migration below this one references both labels, so they have to
 * arrive first and by themselves. This file does nothing else on purpose.
 *
 * `if not exists` because migrations are forward-only and `db reset`
 * replays them all — the same guard 20260825060000 uses around
 * `cron.unschedule`.
 */
alter type public.outbox_kind add value if not exists 'event_reminder';
alter type public.outbox_kind add value if not exists 'broadcast';
```

- [ ] **Step 4: Add the lifecycle columns**

Create `supabase/migrations/20260826010000_outbox_delivery_lifecycle.sql`:

```sql
/*
 * Plan 4 built the outbox and never read one row back. `sent_at` has been
 * on the table since the day it was created with nothing writing to it.
 * These five columns turn it from a queue into a queue with a memory: what
 * has been tried, when it may be tried again, why it last failed, and
 * which of the three terminal states it reached.
 *
 * There is no separate notification_log table. The parent spec requires
 * every send to be logged and deduped; `dedupe_key` was already the dedupe,
 * and these columns are the log. A second table would hold the same facts
 * keyed the same way.
 */
alter table public.notification_outbox
  -- Incremented at CLAIM, not at send. The Edge Function sends after the
  -- claim transaction commits, so nothing can hold a row lock across the
  -- send; the increment is what bounds the work when a function dies
  -- mid-batch and the row becomes due again.
  add column attempts        int         not null default 0,
  -- Due time. The five-minute claim lease, the exponential backoff, and a
  -- quiet-hours hold all express themselves through this one column.
  add column next_attempt_at timestamptz not null default now(),
  add column last_error      text,
  add column failed_at       timestamptz,
  add column expired_at      timestamptz;

/*
 * Exactly one terminal state, or none. Three nullable timestamps with no
 * constraint would let a confused retry mark a row both sent and failed,
 * and then nobody can answer "what happened to this message" from the row
 * itself — which is the entire reason the columns are on the row rather
 * than in a side table.
 */
alter table public.notification_outbox
  add constraint notification_outbox_one_terminal_state check (
      (case when sent_at    is not null then 1 else 0 end)
    + (case when failed_at  is not null then 1 else 0 end)
    + (case when expired_at is not null then 1 else 0 end)
    <= 1
  );

/*
 * Partial, because the claim query only ever asks for live rows and the
 * table is append-only — every message ever sent stays in it forever. A
 * full index would grow without bound while the interesting set stays
 * small. Ordered to match the claim's `order by` exactly, so a backlog
 * drains oldest-due-first without a sort.
 */
create index notification_outbox_due
  on public.notification_outbox (next_attempt_at, created_at)
  where sent_at is null and failed_at is null and expired_at is null;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 14 of 14 in `outbox_lifecycle.test.sql`, and every pre-existing fixture still passing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260826000000_outbox_kinds_reminder_and_broadcast.sql supabase/migrations/20260826010000_outbox_delivery_lifecycle.sql supabase/tests/database/fixtures/outbox_lifecycle.test.sql
git commit -m "feat: give the outbox a memory of what it has tried"
```

---

## Task 2: `push_tokens`, written now and left empty

**Files:**
- Create: `supabase/migrations/20260826020000_push_tokens.sql`
- Modify: `supabase/tests/database/fixtures/outbox_lifecycle.test.sql`

**Interfaces:**
- Produces: `public.push_tokens (id, profile_id, token, platform, created_at, last_seen_at)`. Consumed by `resolve_notify_channel` in Task 5.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/database/fixtures/outbox_lifecycle.test.sql`, change `select plan(14);` to `select plan(20);` and insert these assertions immediately before `select * from finish();`:

```sql
select has_table('public', 'push_tokens', 'push_tokens exists');
select col_is_pk('public', 'push_tokens', 'id', 'push_tokens has a uuid pk');

-- One physical device, one row. Without the unique a reinstall would
-- accumulate rows and the later push plan would fan out duplicates.
select col_is_unique('public', 'push_tokens', 'token',
                     'a token is registered once');

select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.push_tokens'::regclass),
  'push_tokens has RLS enabled'
);

-- TRUNCATE ignores RLS entirely, so the grant matters more than the policy.
select ok(
  not has_table_privilege('authenticated', 'public.push_tokens', 'TRUNCATE'),
  'authenticated cannot TRUNCATE push_tokens'
);
select ok(
  has_table_privilege('authenticated', 'public.push_tokens', 'INSERT'),
  'authenticated can register a token'
);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `relation "public.push_tokens" does not exist`.

- [ ] **Step 3: Create the table**

Create `supabase/migrations/20260826020000_push_tokens.sql`:

```sql
/*
 * Empty in this plan, and deliberately so.
 *
 * `profiles.notify_channel` has offered 'push', 'email' and 'both' since
 * plan 1, and app/notifications.tsx has been letting members choose
 * between them for weeks. This plan does not make 'push' real — nothing in
 * a web-first test suite (vitest against react-native-web, Playwright
 * against Chromium, no EAS configuration in the repo) can verify a device
 * delivery leg, and an unverifiable delivery path is worse than an absent
 * one.
 *
 * The table exists so `resolve_notify_channel` has something to consult
 * and so the later push plan is additive. The RLS policy is written now,
 * while nothing depends on it, rather than later under live traffic —
 * which is the moment this kind of policy gets written wrong.
 */
create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  -- One physical device, one row. A reinstall that re-registers the same
  -- token must update, not accumulate.
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_profile on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

/*
 * A member's devices are their own business — not their club's, and not
 * another member's. `for all` with a matching `with check` so the same
 * rule governs reads and writes; a select-only policy plus an insert grant
 * would let a member register a token against somebody else's profile.
 */
create policy push_tokens_own on public.push_tokens
  for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

/*
 * `revoke all` first. Supabase grants ALL on every table in `public` to
 * `authenticated` by default, and ALL includes TRUNCATE — which is not
 * subject to row-level security, so the policy above would not stop a
 * member emptying the table. See supabase/tests/database/portable/
 * grants.test.sql, which exists entirely because of this.
 */
revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 20 of 20 in `outbox_lifecycle.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826020000_push_tokens.sql supabase/tests/database/fixtures/outbox_lifecycle.test.sql
git commit -m "feat: add the push token table the later plan will fill"
```

---

## Task 3: Broadcasts — table, fan-out, and the organizer gate

**Files:**
- Create: `supabase/migrations/20260826030000_broadcasts.sql`
- Create: `supabase/tests/database/fixtures/broadcasts.test.sql`

**Interfaces:**
- Consumes: `outbox_kind` value `'broadcast'` (Task 1); `public.assert_club_organizer(uuid)` from `20260822192000_create_venues.sql`; `public.club_members(club_id, profile_id, role, status)`; `public.bookings(event_id, profile_id, status)`.
- Produces:
  - `public.broadcasts (id, club_id, event_id, author_id, subject, body, recipient_count, created_at)`
  - `public.broadcast_recipients(target_club uuid, target_event uuid) returns table (profile_id uuid)` — internal
  - `public.broadcast_recipient_count(target_club uuid, target_event uuid) returns int` — granted to `authenticated`
  - `public.send_broadcast(target_club uuid, target_event uuid, p_subject text, p_body text) returns uuid` — granted to `authenticated`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/broadcasts.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),  -- host
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),    -- member, booked
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),  -- member, not booked
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com');    -- another club entirely

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Hillside', 'hillside',
   'America/New_York', 'dddddddd-0000-0000-0000-000000000004');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000004', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'The Annexe',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  -- Belongs to the OTHER club. The cross-club assertion below aims at it.
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Their night',
   '11111111-0000-0000-0000-000000000002',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1);

-- Bob is booked; Carol is not. Event-scoped broadcasts must tell the
-- difference, and club-wide ones must not.
insert into public.booking_groups (id, event_id, club_id, created_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          '7ab1e000-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002',
          'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

-- ---------------------------------------------------------------------
-- A host broadcasting to the whole roster.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001', null,
      'Doors open at seven', 'The side entrance is locked this week.')$$,
  'a host can broadcast to the roster'
);

-- Two, not three: the author is not mailed their own announcement.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'broadcast'),
  2,
  'a club-wide broadcast reaches every member except its author'
);
select is(
  (select recipient_count from public.broadcasts
    where subject = 'Doors open at seven'),
  2,
  'recipient_count is written in the same transaction as the fan-out'
);
select ok(
  not exists (select 1 from public.notification_outbox
               where kind = 'broadcast'
                 and recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'the author is not a recipient of their own broadcast'
);

-- ---------------------------------------------------------------------
-- Event-scoped: only the booked.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001',
      'e1e1e1e1-0000-0000-0000-000000000001',
      'Bring a spare card', 'Mine has seen better days.')$$,
  'a host can broadcast to one event'
);
select is(
  (select recipient_count from public.broadcasts
    where subject = 'Bring a spare card'),
  1,
  'an event broadcast reaches only the booked'
);
select ok(
  exists (select 1 from public.notification_outbox o
           join public.broadcasts b
             on b.id::text = o.payload->>'broadcast_id'
          where b.subject = 'Bring a spare card'
            and o.recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'the booked member is told'
);
select ok(
  not exists (select 1 from public.notification_outbox o
               join public.broadcasts b
                 on b.id::text = o.payload->>'broadcast_id'
              where b.subject = 'Bring a spare card'
                and o.recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  'a member who is not booked is not told'
);

-- The count the compose screen shows before sending must agree with what
-- the fan-out actually does, or the confirmation lies.
select is(
  public.broadcast_recipient_count(
    'c1c1c1c1-0000-0000-0000-000000000001', null),
  2,
  'the previewed count matches the club-wide fan-out'
);
select is(
  public.broadcast_recipient_count(
    'c1c1c1c1-0000-0000-0000-000000000001',
    'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'the previewed count matches the event fan-out'
);

-- ---------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001',
      'e2e2e2e2-0000-0000-0000-000000000002',
      'Wrong club', 'This event is not theirs.')$$,
  '42501',
  null,
  'a host cannot broadcast to an event in another club'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001', null,
      'Not my place', 'I am only a member.')$$,
  '42501',
  null,
  'an ordinary member cannot broadcast'
);

-- A member cannot read what the organizers sent, either.
select is(
  (select count(*)::int from public.broadcasts),
  0,
  'a member reads no broadcasts'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.broadcasts),
  2,
  'an organizer reads their club''s broadcasts'
);

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'INSERT'),
  'authenticated cannot INSERT broadcasts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'TRUNCATE'),
  'authenticated cannot TRUNCATE broadcasts'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.send_broadcast(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826030000_broadcasts.sql`:

```sql
/*
 * The host writes once and everybody hears it.
 *
 * A broadcast is a stored record rather than a fire-and-forget fan-out for
 * three reasons: the host's first question after mailing fifty people is
 * whether it went; the broadcast id is a stable dedupe parent, so a
 * fan-out interrupted halfway resumes instead of double-sending; and the
 * body has to survive somewhere for the Edge Function to render, since the
 * outbox payload carries ids and never prose.
 */
create table public.broadcasts (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  -- Null means the whole roster. Not a separate table and not an enum: the
  -- two targets differ only in who they resolve to.
  event_id        uuid references public.events(id) on delete cascade,
  author_id       uuid not null references public.profiles(id),
  subject         text not null check (length(trim(subject)) between 1 and 120),
  body            text not null check (length(trim(body)) between 1 and 2000),
  -- Written by the fan-out in the same transaction, so the sent history can
  -- say "went to 14 members" without counting outbox rows at read time.
  recipient_count int not null default 0,
  created_at      timestamptz not null default now(),

  /*
   * Composite, so a broadcast cannot point at an event belonging to a
   * different club. Plan 3's tenancy bugs were all of this shape and plan 4
   * put the same guard on `bookings`. The runtime check in send_broadcast
   * is the friendly error; this is the one that makes the state
   * unrepresentable.
   */
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade
);

create index broadcasts_club_recent
  on public.broadcasts (club_id, created_at desc);

-- ---------------------------------------------------------------------
-- Who hears it.
-- ---------------------------------------------------------------------

/*
 * One function, both targets, so the count the compose screen previews and
 * the set the fan-out writes can never disagree. They disagree the moment
 * this is two queries in two places.
 *
 * The author is NOT excluded here — send_broadcast excludes them and
 * broadcast_recipient_count does too, but each does it against its own
 * caller. Putting it here would make the function lie to any future caller
 * that is not the author.
 */
create function public.broadcast_recipients(
  target_club  uuid,
  target_event uuid
)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select cm.profile_id
    from public.club_members cm
   where target_event is null
     and cm.club_id = target_club
     and cm.status = 'active'
  union
  select b.profile_id
    from public.bookings b
   where target_event is not null
     and b.event_id = target_event
     and b.status = 'confirmed';
$$;

/*
 * `union`, not `union all`, as a defensive choice rather than a fix for a
 * reachable duplicate: the two branches are mutually exclusive per call,
 * and within the bookings branch `bookings_one_active_per_person_idx`
 * (20260825000000) already makes a second active booking for one person at
 * one event impossible. Nothing can be tested here today; `union` costs
 * nothing and survives that index changing.
 */

create function public.broadcast_recipient_count(
  target_club  uuid,
  target_event uuid
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform public.assert_club_organizer(target_club);

  if target_event is not null then
    perform 1 from public.events
      where id = target_event and club_id = target_club;
    if not found then
      raise exception 'event does not belong to this club'
        using errcode = '42501';
    end if;
  end if;

  select count(*)::int into n
    from public.broadcast_recipients(target_club, target_event) r
   where r.profile_id <> (select auth.uid());
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Sending.
-- ---------------------------------------------------------------------
create function public.send_broadcast(
  target_club  uuid,
  target_event uuid,
  p_subject    text,
  p_body       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  new_id uuid;
  told   int;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Raises 42501 for anyone who is not host or co-organizer. Reused rather
  -- than reimplemented, so the UI's `canInvite` gate and this one cannot
  -- drift apart.
  perform public.assert_club_organizer(target_club);

  if target_event is not null then
    perform 1 from public.events
      where id = target_event and club_id = target_club;
    if not found then
      raise exception 'event does not belong to this club'
        using errcode = '42501';
    end if;
  end if;

  insert into public.broadcasts (club_id, event_id, author_id, subject, body)
  values (target_club, target_event, caller, p_subject, p_body)
  returning id into new_id;

  /*
   * The dedupe key carries the recipient, not just the broadcast. A
   * multi-row INSERT ... ON CONFLICT DO NOTHING checks each row against the
   * unique index as it is inserted, including rows the same statement has
   * already placed — so a key of `broadcast:<id>` alone would keep exactly
   * ONE row for the entire fan-out and tell one person. Plan 4's
   * announce_table_fourth has the same note for the same reason.
   */
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select r.profile_id, target_club, target_event, 'broadcast',
         jsonb_build_object('broadcast_id', new_id),
         'broadcast:' || new_id::text || ':' || r.profile_id::text
    from public.broadcast_recipients(target_club, target_event) r
   -- You do not need mailing about the thing you just wrote.
   where r.profile_id <> caller
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  update public.broadcasts set recipient_count = told where id = new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------
alter table public.broadcasts enable row level security;

/*
 * Organizers of the club, and nobody else. Not the roster: a broadcast
 * arrives by email, and a member browsing every announcement a host ever
 * sent — including ones sent to a different event they were not part of —
 * is a feature nobody asked for.
 *
 * `is_club_organizer` is the boolean form and is already used inside an
 * RLS policy in 20260822194000_create_events.sql. `assert_club_organizer`
 * raises, which a policy cannot use — that one is for the functions.
 */
create policy broadcasts_select_organizer on public.broadcasts
  for select using (public.is_club_organizer(broadcasts.club_id));

revoke all on public.broadcasts from anon, authenticated;
grant select on public.broadcasts to authenticated;

/*
 * The `authenticated` revoke is the one that matters. Supabase's hosted
 * bootstrap grants EXECUTE to `authenticated` at function-creation time and
 * `revoke ... from public` never clears it — the gap that was retro-fixed
 * in 20260823020000, 20260823030000, 20260823060000 and 20260825061000, and
 * which is invisible against the local stack because it grants
 * `authenticated` nothing by default.
 */
revoke execute on function public.broadcast_recipients(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.broadcast_recipient_count(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.broadcast_recipient_count(uuid, uuid)
  to authenticated;

revoke execute on function public.send_broadcast(uuid, uuid, text, text)
  from public, anon, authenticated;
grant  execute on function public.send_broadcast(uuid, uuid, text, text)
  to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 16 of 16 in `broadcasts.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826030000_broadcasts.sql supabase/tests/database/fixtures/broadcasts.test.sql
git commit -m "feat: let a host write once and reach the room"
```

---

## Task 4: The delivery predicates

Four small, pure functions. They are separated from the claim query because every interesting edge case in this plan — a quiet window that wraps midnight, a reminder for a 9am game, a backoff schedule — lives in one of them, and testing them through the claim query would mean building a fixture per case.

**Files:**
- Create: `supabase/migrations/20260826040000_notification_predicates.sql`
- Create: `supabase/tests/database/fixtures/notification_predicates.test.sql`

**Interfaces:**
- Produces:
  - `public.in_quiet_window(p_tz text, p_start time, p_end time, p_at timestamptz) returns boolean`
  - `public.outbox_quiet_class(p_kind public.outbox_kind) returns text` — one of `'never_held'`, `'exempt_near_event'`, `'suppressible'`
  - `public.outbox_expires_at(p_kind public.outbox_kind, p_created_at timestamptz, p_starts_at timestamptz) returns timestamptz`
  - `public.outbox_backoff(p_attempts int) returns interval`
  - `public.outbox_max_attempts() returns int`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/notification_predicates.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(21);

-- ---------------------------------------------------------------------
-- in_quiet_window. Every default user has a window that wraps midnight
-- (21:00-08:00), so the naive `start <= t <= end` comparison is wrong for
-- everybody. These assertions exist to keep it that way.
-- ---------------------------------------------------------------------

-- A wrapping window, evaluated in New York.
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T02:00:00-04:00'::timestamptz),
  '02:00 local is inside a 21:00-08:00 window'
);
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T23:30:00-04:00'::timestamptz),
  '23:30 local is inside a 21:00-08:00 window'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T12:00:00-04:00'::timestamptz),
  'midday is outside a 21:00-08:00 window'
);

-- Boundaries: inclusive at the start, exclusive at the end. A message due
-- at exactly 08:00 goes; the window is over.
select ok(
  public.in_quiet_window('America/New_York', '21:00', '08:00',
                         '2026-09-01T21:00:00-04:00'::timestamptz),
  'the window includes its start'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T08:00:00-04:00'::timestamptz),
  'the window excludes its end'
);

-- A non-wrapping window still has to work.
select ok(
  public.in_quiet_window('America/New_York', '13:00', '15:00',
                         '2026-09-01T14:00:00-04:00'::timestamptz),
  'a same-day window contains its middle'
);
select ok(
  not public.in_quiet_window('America/New_York', '13:00', '15:00',
                             '2026-09-01T16:00:00-04:00'::timestamptz),
  'a same-day window excludes what follows it'
);

-- The timezone is the MEMBER's, and it is the whole point. The same
-- instant is quiet for one member and not for another.
select ok(
  public.in_quiet_window('America/Los_Angeles', '21:00', '08:00',
                         '2026-09-01T05:00:00-04:00'::timestamptz),
  '05:00 in New York is 02:00 in Los Angeles, and quiet there'
);
select ok(
  not public.in_quiet_window('America/New_York', '21:00', '08:00',
                             '2026-09-01T09:00:00-04:00'::timestamptz),
  'the same instant is not quiet in New York'
);

-- Degenerate: a zero-length window is no window at all.
select ok(
  not public.in_quiet_window('America/New_York', '08:00', '08:00',
                             '2026-09-01T08:00:00-04:00'::timestamptz),
  'a zero-length window holds nothing'
);

-- ---------------------------------------------------------------------
-- outbox_quiet_class.
-- ---------------------------------------------------------------------
select is(public.outbox_quiet_class('promotion_offer'), 'never_held',
          'an offer with a two-hour fuse is never held');
select is(public.outbox_quiet_class('event_cancelled'), 'never_held',
          'a cancellation is never held');
select is(public.outbox_quiet_class('event_reminder'), 'exempt_near_event',
          'a reminder is held, with an exemption');
select is(public.outbox_quiet_class('need_a_fourth'), 'suppressible',
          'a call for a fourth waits for morning');
select is(public.outbox_quiet_class('broadcast'), 'suppressible',
          'a broadcast waits for morning');

-- ---------------------------------------------------------------------
-- outbox_expires_at.
-- ---------------------------------------------------------------------
select is(
  public.outbox_expires_at('event_reminder',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-02T23:00:00Z'::timestamptz),
  '2026-09-02T23:00:00Z'::timestamptz,
  'an event-bound message dies when the game starts'
);
select is(
  public.outbox_expires_at('event_cancelled',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-02T23:00:00Z'::timestamptz),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a cancellation outlives the slot it cancelled, by a day'
);
select is(
  public.outbox_expires_at('broadcast',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           '2026-09-05T23:00:00Z'::timestamptz),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a broadcast is stale after a day whatever it was about'
);
select is(
  public.outbox_expires_at('broadcast',
                           '2026-09-01T10:00:00Z'::timestamptz,
                           null),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a club-wide broadcast has no event to die with'
);

-- ---------------------------------------------------------------------
-- Backoff and the attempt ceiling.
-- ---------------------------------------------------------------------
select is(
  array[public.outbox_backoff(1), public.outbox_backoff(2),
        public.outbox_backoff(3), public.outbox_backoff(4),
        public.outbox_backoff(5)],
  array[interval '5 minutes',  interval '10 minutes',
        interval '20 minutes', interval '40 minutes',
        interval '80 minutes'],
  'backoff doubles from five minutes'
);
select is(public.outbox_max_attempts(), 5,
          'five attempts, then the row is dead-lettered');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.in_quiet_window(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826040000_notification_predicates.sql`:

```sql
/*
 * The four decisions the claim query makes, pulled out where they can be
 * tested one case at a time.
 *
 * Everything genuinely fiddly in this plan lives here: a quiet window that
 * wraps midnight, a reminder for a game that starts during one, and a
 * backoff schedule. Inline in the claim query, each of those would need its
 * own fixture — clubs, events, bookings, profiles — to exercise one boolean.
 */

/*
 * Is `p_at` inside this member's quiet window?
 *
 * `stable`, not `immutable`: `at time zone <text>` depends on the timezone
 * database, which can be updated under a running server.
 *
 * Inclusive at the start, exclusive at the end. The default window is
 * 21:00-08:00, which wraps midnight — so the obvious `p_start <= t and t <
 * p_end` is wrong for every member who never touched the setting. The
 * wrapping branch is the common case here, not the edge case.
 */
create function public.in_quiet_window(
  p_tz    text,
  p_start time,
  p_end   time,
  p_at    timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    -- A zero-length window holds nothing. Without this the wrapping branch
    -- below would return true for every instant of the day.
    when p_start = p_end then false
    when p_start <  p_end then (p_at at time zone p_tz)::time >= p_start
                           and (p_at at time zone p_tz)::time <  p_end
    else                       (p_at at time zone p_tz)::time >= p_start
                            or (p_at at time zone p_tz)::time <  p_end
  end;
$$;

/*
 * How quiet hours treat each kind. Three classes, from the parent spec's
 * section 7 rule 2.
 *
 * `never_held` is not a loophole — it is the eight kinds that exist because
 * somebody else acted on your seat. A promotion offer has a two-hour fuse;
 * holding it overnight guarantees it lapses unseen, which is worse than a
 * notification at 11pm about a seat you asked to be told about.
 *
 * An explicit `else` rather than listing all eight: a kind added by a later
 * plan defaults to being delivered, and a message that arrives when it
 * should have waited is a smaller failure than one that never arrives.
 */
create function public.outbox_quiet_class(p_kind public.outbox_kind)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'need_a_fourth'  then 'suppressible'
    when 'broadcast'      then 'suppressible'
    when 'event_reminder' then 'exempt_near_event'
    else 'never_held'
  end;
$$;

/*
 * When a message stops being worth sending.
 *
 * Event-bound kinds die when the game starts: nothing about a game is worth
 * saying once it has begun, and plan 4 already refuses every seat mutation
 * at that moment for the same reason.
 *
 * `event_cancelled` and `broadcast` are the exceptions, at a day from
 * creation. A cancellation is worth knowing after the slot passes — that is
 * when somebody would otherwise turn up — but not a week later.
 *
 * This is also what makes the first deploy safe. Plan 4 has been writing
 * outbox rows through weeks of development and test runs; without a horizon,
 * turning the drain on would mail every member a backlog of announcements
 * about games that finished in August.
 */
create function public.outbox_expires_at(
  p_kind       public.outbox_kind,
  p_created_at timestamptz,
  p_starts_at  timestamptz
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('event_cancelled', 'broadcast')
      then p_created_at + interval '24 hours'
    when p_starts_at is not null then p_starts_at
    else p_created_at + interval '24 hours'
  end;
$$;

/*
 * 5, 10, 20, 40, 80 minutes. A permanently bad address costs five sends
 * over about two and a half hours and then stops consuming batch slots
 * forever.
 *
 * `greatest(p_attempts, 1)` because attempts is incremented at claim, so
 * the first failure already reports 1; a 0 would halve the first delay for
 * no reason.
 */
create function public.outbox_backoff(p_attempts int)
returns interval
language sql
immutable
as $$
  select interval '5 minutes' * power(2, greatest(p_attempts, 1) - 1);
$$;

/*
 * Named rather than inlined so the claim, the mark-failed path, and the
 * tests cannot disagree about where the ceiling is.
 */
create function public.outbox_max_attempts()
returns int
language sql
immutable
as $$
  select 5;
$$;

revoke execute on function
  public.in_quiet_window(text, time, time, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.outbox_quiet_class(public.outbox_kind)
  from public, anon, authenticated;
revoke execute on function
  public.outbox_expires_at(public.outbox_kind, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.outbox_backoff(int)
  from public, anon, authenticated;
revoke execute on function public.outbox_max_attempts()
  from public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 21 of 21 in `notification_predicates.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826040000_notification_predicates.sql supabase/tests/database/fixtures/notification_predicates.test.sql
git commit -m "feat: teach the queue what quiet means and when news goes stale"
```

---

## Task 5: Render context

The outbox payloads are ids, not prose — `{"booking_id": ...}`, `{"offer_id": ..., "seats": 2}`. Nothing in a payload knows the club's name, the event's title, when it starts, or the recipient's address, and there is no email column anywhere in `public`. This task is the join that turns an id into something a template can read.

**Files:**
- Create: `supabase/migrations/20260826050000_outbox_render_context.sql`
- Create: `supabase/tests/database/fixtures/notification_claim.test.sql`

**Interfaces:**
- Consumes: `public.push_tokens` (Task 2), `public.broadcasts` (Task 3).
- Produces:
  - `public.resolve_notify_channel(p_profile uuid) returns text`
  - `public.outbox_render_context(p_ids uuid[]) returns table (id uuid, kind public.outbox_kind, payload jsonb, recipient_id uuid, recipient_name text, recipient_email text, channel text, club_id uuid, club_name text, event_id uuid, event_title text, event_starts_at timestamptz, club_timezone text, table_label text, actor_name text, broadcast_subject text, broadcast_body text, created_at timestamptz)`

The column list above is the contract Tasks 6, 9, 10 and 11 all depend on. `claim_notification_batch` returns exactly these columns, and `RenderRow` in `types.ts` mirrors them one for one.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/notification_claim.test.sql`. This fixture is reused and extended by Tasks 6 and 7, so it is built to be added to:

```sql
begin;
set local search_path to extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

update public.profiles set display_name = 'Alice', timezone = 'America/New_York'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob', timezone = 'America/New_York'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'beginner', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status)
  values ('b00c1234-0000-0000-0000-000000000001',
          '9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          '7ab1e000-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002',
          'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed');

-- A booking-shaped message: the payload names a booking and nothing else,
-- which is exactly what plan 4 writes.
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'booked_by_friend',
   jsonb_build_object('booking_id', 'b00c1234-0000-0000-0000-000000000001',
                      'booked_by', 'aaaaaaaa-0000-0000-0000-000000000001'),
   'ctx:1');

-- ---------------------------------------------------------------------
-- resolve_notify_channel. Every branch is email today; the shape is what
-- the later push plan changes.
-- ---------------------------------------------------------------------
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'a member defaulting to both resolves to email'
);

update public.profiles set notify_channel = 'push'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'push with no registered token resolves to email'
);

insert into public.push_tokens (profile_id, token, platform)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'ExponentPushToken[x]',
          'ios');
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'push with a token still resolves to email while push is dark'
);
delete from public.push_tokens;
update public.profiles set notify_channel = 'both'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select is(
  public.resolve_notify_channel('00000000-0000-0000-0000-0000000000ff'),
  null,
  'an unknown profile resolves to nothing at all'
);

-- ---------------------------------------------------------------------
-- outbox_render_context. The point of the whole task: an id-only payload
-- comes back as something a template can read.
-- ---------------------------------------------------------------------
select is(
  (select recipient_email from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'bob@example.com',
  'the address is fetched from auth.users, the only place it exists'
);
select is(
  (select recipient_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Bob',
  'the recipient is named'
);
select is(
  (select club_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Riverside',
  'the club is named'
);
select is(
  (select event_title from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Tuesday night',
  'the event is named'
);

-- The table label is reached THROUGH the booking. Nothing in this payload
-- mentions a table, and an email that cannot say which table is most of
-- the value of the message gone.
select is(
  (select table_label from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Table 2',
  'the table is found through the booking the payload names'
);

select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Alice',
  'the person who booked the seat is named'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.resolve_notify_channel(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826050000_outbox_render_context.sql`:

```sql
/*
 * Push is wired but dark, and this function is the whole of the wiring.
 *
 * Every branch returns 'email' today. That is not an oversight and it is
 * not dead code — the two decision points (what did the member ask for,
 * and do they have a device registered) are the two the later push plan
 * needs, and having them here means that plan changes two return values
 * rather than inventing a resolver under live traffic.
 */
create function public.resolve_notify_channel(p_profile uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref     public.notify_channel;
  has_push boolean;
begin
  select notify_channel into pref from public.profiles where id = p_profile;
  -- No profile, no channel. The caller expires the row rather than
  -- retrying something that cannot succeed.
  if pref is null then return null; end if;

  select exists (
    select 1 from public.push_tokens t where t.profile_id = p_profile
  ) into has_push;

  if pref = 'email' then return 'email'; end if;
  -- A member who asked for push and has no device gets email. This stays
  -- true after the push plan lands; it is the fallback, not the stopgap.
  if not has_push then return 'email'; end if;

  -- The one line the push plan changes: `return pref::text`.
  return 'email';
end;
$$;

/*
 * An id-only payload, joined into something a template can read.
 *
 * The Edge Function could fetch this itself under the service role, and
 * that is precisely the design being avoided: it would need read access
 * across the whole schema and would re-implement tenancy rules that already
 * live inside security definer functions. One RPC returning render-ready
 * rows keeps the function a renderer with no business logic in it — which
 * is also what makes it testable without a database.
 *
 * Every join is LEFT except profiles, auth.users and clubs. A club-wide
 * broadcast has no event; an event-cancelled message has no booking; only
 * some kinds involve a table. A single INNER join anywhere here would
 * silently drop whole classes of message from every batch.
 */
create function public.outbox_render_context(p_ids uuid[])
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
         e.starts_at,
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
     */
    left join public.profiles pa
           on pa.id::text = coalesce(o.payload->>'booked_by',
                                     o.payload->>'declined_by',
                                     o.payload->>'cancelled_by')
   where o.id = any(p_ids);
$$;

revoke execute on function public.resolve_notify_channel(uuid)
  from public, anon, authenticated;
revoke execute on function public.outbox_render_context(uuid[])
  from public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 10 of 10 in `notification_claim.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826050000_outbox_render_context.sql supabase/tests/database/fixtures/notification_claim.test.sql
git commit -m "feat: turn an id-shaped payload into something worth reading"
```

---

## Task 6: `claim_notification_batch`

**Files:**
- Create: `supabase/migrations/20260826060000_claim_notification_batch.sql`
- Modify: `supabase/tests/database/fixtures/notification_claim.test.sql`

**Interfaces:**
- Consumes: every function from Tasks 4 and 5.
- Produces: `public.claim_notification_batch(p_limit int default 50)` returning exactly the `outbox_render_context` column list. Granted to `service_role` only.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/database/fixtures/notification_claim.test.sql`, change `select plan(10);` to `select plan(21);` and insert the following immediately before `select * from finish();`:

```sql
-- ---------------------------------------------------------------------
-- Claiming. Each scenario clears the outbox first: these assertions are
-- about which rows come back, and a leftover row from the previous
-- scenario makes every count meaningless.
-- ---------------------------------------------------------------------
update public.profiles set quiet_hours_enabled = false;

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a due row is claimed'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  1,
  'claiming counts as an attempt, before anything is sent'
);
-- The lease. The Edge Function sends after this transaction commits, so
-- nothing holds a row lock across the send; this is what stops a second
-- invocation a few seconds later sending the same message again.
select ok(
  (select next_attempt_at > now() + interval '4 minutes'
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'a claimed row is leased five minutes into the future'
);
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a leased row is not claimed again'
);

-- Mute. Applies to need_a_fourth and to nothing else.
delete from public.notification_outbox;
update public.profiles set mute_need_a_fourth = true
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'need_a_fourth', '{}'::jsonb, 'claim:muted'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:offer');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a muted member hears about a seat but not about a fourth'
);
update public.profiles set mute_need_a_fourth = false;

-- Quiet hours. The window is built around now() so the assertion does not
-- depend on what time the suite runs.
delete from public.notification_outbox;
update public.profiles
   set quiet_hours_enabled = true,
       quiet_hours_start =
         ((now() at time zone 'America/New_York') - interval '1 hour')::time,
       quiet_hours_end =
         ((now() at time zone 'America/New_York') + interval '1 hour')::time
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'broadcast', '{}'::jsonb, 'claim:quiet-broadcast'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:quiet-offer');

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'quiet hours hold a broadcast and let an offer through'
);
select is(
  (select kind::text from public.notification_outbox
    where attempts = 1),
  'promotion_offer',
  'the one that got through is the one with a two-hour fuse'
);
-- Held, not failed. The distinction matters: a failed row is retried on a
-- backoff and eventually dies, a held row simply is not due yet.
select ok(
  (select failed_at is null and expired_at is null and attempts = 0
     from public.notification_outbox
    where dedupe_key = 'claim:quiet-broadcast'),
  'a held broadcast is untouched, not failed'
);

-- The reminder exemption. A game starting inside the quiet window must be
-- reminded about during it, or a club that plays at 9am gets its two-hour
-- reminder at 08:00, after it stopped being useful.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '30 minutes',
       ends_at   = now() + interval '3 hours 30 minutes'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', jsonb_build_object('offset_minutes', 120),
   'claim:exempt-reminder');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a reminder for a game inside the quiet window is exempt'
);

-- ... and a reminder for a game well outside it is not.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '3 days',
       ends_at   = now() + interval '3 days 3 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', jsonb_build_object('offset_minutes', 1440),
   'claim:held-reminder');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a reminder for a game three days out waits for morning'
);
update public.profiles set quiet_hours_enabled = false;

-- Staleness. The game has started; nothing about it is worth saying.
delete from public.notification_outbox;
update public.events
   set starts_at = now() - interval '1 hour',
       ends_at   = now() + interval '2 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', '{}'::jsonb, 'claim:stale');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a message about a game already underway is not sent'
);
select ok(
  (select expired_at is not null from public.notification_outbox
    where dedupe_key = 'claim:stale'),
  'it is marked expired rather than left to rot in the queue'
);

-- Nobody to send to.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '2 days',
       ends_at   = now() + interval '2 days 3 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
update auth.users set email = null
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:no-address');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a recipient with no address is not claimed'
);
select ok(
  (select expired_at is not null from public.notification_outbox
    where dedupe_key = 'claim:no-address'),
  'and is expired, not retried five times against nothing'
);
update auth.users set email = 'bob@example.com'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- The limit is honoured, so one enormous backlog cannot become one
-- enormous function invocation.
delete from public.notification_outbox;
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key)
select 'bbbbbbbb-0000-0000-0000-000000000002',
       'c1c1c1c1-0000-0000-0000-000000000001',
       'e1e1e1e1-0000-0000-0000-000000000001',
       'promotion_offer', '{}'::jsonb, 'claim:bulk:' || i::text
  from generate_series(1, 10) i;
select is(
  (select count(*)::int from public.claim_notification_batch(4)),
  4,
  'the batch limit is honoured'
);
select is(
  (select count(*)::int from public.notification_outbox where attempts = 0),
  6,
  'and the rest are left untouched for the next tick'
);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.claim_notification_batch(integer) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826060000_claim_notification_batch.sql`:

```sql
/*
 * The one thing the Edge Function is allowed to ask for.
 *
 * Three statements, in this order and for a reason:
 *
 *   1. Expire what is past its horizon. Before claiming, so a backlog of
 *      stale rows never occupies a batch slot. This is also what makes the
 *      first deploy safe — plan 4 has been queueing messages for weeks with
 *      nothing draining them.
 *   2. Expire what has nobody to send to. A missing address is not a
 *      transient failure and retrying it five times achieves nothing.
 *   3. Claim what is left, oldest-due first, with a lease.
 *
 * The lease exists because the send happens AFTER this transaction commits.
 * `for update ... skip locked` gives the batch exclusivity for the length
 * of the claim and not one moment longer, so the durable part of "this row
 * is being worked on" has to be the row itself: attempts up, next_attempt_at
 * pushed five minutes out. A function that dies mid-batch loses nothing and
 * a function that sends without reporting back sends twice — which is why
 * the fifth attempt is the last.
 */
create function public.claim_notification_batch(p_limit int default 50)
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
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed uuid[];
begin
  update public.notification_outbox o
     set expired_at = now()
   where o.sent_at is null and o.failed_at is null and o.expired_at is null
     and now() >= public.outbox_expires_at(
           o.kind,
           o.created_at,
           (select e.starts_at from public.events e where e.id = o.event_id));

  update public.notification_outbox o
     set expired_at = now(),
         last_error = 'recipient has no email address'
   where o.sent_at is null and o.failed_at is null and o.expired_at is null
     and not exists (
       select 1 from auth.users u
        where u.id = o.recipient_id and u.email is not null);

  with due as (
    select o.id
      from public.notification_outbox o
      join public.profiles p on p.id = o.recipient_id
     where o.sent_at is null
       and o.failed_at is null
       and o.expired_at is null
       and o.next_attempt_at <= now()
       -- The one mutable preference. Reminders for a game you booked are
       -- deliberately not mutable; the parent spec says so and this plan
       -- adds no setting that would make them so.
       and not (o.kind = 'need_a_fourth' and p.mute_need_a_fourth)
       and (
            not p.quiet_hours_enabled
         or public.outbox_quiet_class(o.kind) = 'never_held'
         or not public.in_quiet_window(p.timezone, p.quiet_hours_start,
                                       p.quiet_hours_end, now())
         /*
          * The exemption, expressed by stretching the window's far end by
          * two hours and asking whether the game starts inside it. `time +
          * interval` wraps within the day in Postgres, and in_quiet_window
          * already handles a wrapped window, so 22:00-08:00 becomes
          * 22:00-10:00 and a 09:00 game qualifies.
          *
          * A member with a window longer than 22 hours would see start and
          * end collide after stretching, and in_quiet_window reports false
          * for a zero-length window — so an exemption would be missed. That
          * is a 22-hour quiet window; the message waits until it closes.
          */
         or (public.outbox_quiet_class(o.kind) = 'exempt_near_event'
             and exists (
               select 1 from public.events e
                where e.id = o.event_id
                  and public.in_quiet_window(
                        p.timezone,
                        p.quiet_hours_start,
                        p.quiet_hours_end + interval '2 hours',
                        e.starts_at)))
       )
     -- Matches notification_outbox_due exactly, so a backlog drains in the
     -- order it accumulated and without a sort.
     order by o.next_attempt_at, o.created_at
     limit p_limit
     for update of o skip locked
  ),
  leased as (
    update public.notification_outbox o
       set attempts        = o.attempts + 1,
           next_attempt_at = now() + interval '5 minutes'
      from due
     where o.id = due.id
    returning o.id
  )
  select array_agg(leased.id) into claimed from leased;

  -- array_agg over no rows is null, not an empty array.
  if claimed is null then return; end if;

  return query select * from public.outbox_render_context(claimed);
end;
$$;

/*
 * service_role and nothing else. `revoke ... from public` alone would not
 * clear the EXECUTE that Supabase's hosted bootstrap grants `authenticated`
 * at creation time; the explicit revoke is the load-bearing one. A public
 * caller who could reach this would be able to lease every pending message
 * away from the real drain and let it expire.
 */
revoke execute on function public.claim_notification_batch(int)
  from public, anon, authenticated;
grant  execute on function public.claim_notification_batch(int)
  to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 21 of 21 in `notification_claim.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826060000_claim_notification_batch.sql supabase/tests/database/fixtures/notification_claim.test.sql
git commit -m "feat: claim a batch of mail without losing it if the sender dies"
```

---

## Task 7: Reporting the outcome

**Files:**
- Create: `supabase/migrations/20260826070000_mark_notifications.sql`
- Modify: `supabase/tests/database/fixtures/notification_claim.test.sql`

**Interfaces:**
- Consumes: `public.outbox_backoff(int)`, `public.outbox_max_attempts()` (Task 4).
- Produces:
  - `public.mark_notifications_sent(p_ids uuid[]) returns int` — the number marked
  - `public.mark_notifications_failed(p_id uuid, p_error text) returns void`

  Both granted to `service_role` only.

- [ ] **Step 1: Write the failing test**

In `supabase/tests/database/fixtures/notification_claim.test.sql`, change `select plan(21);` to `select plan(30);` and insert before `select * from finish();`:

```sql
-- ---------------------------------------------------------------------
-- Reporting back.
-- ---------------------------------------------------------------------
delete from public.notification_outbox;
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-00000000000a',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'mark:sent'),
  ('0b0b0b0b-0000-0000-0000-00000000000b',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'mark:failed');

-- `perform` is plpgsql only; a pgTAP file is plain SQL, so the claim has
-- to be an assertion rather than a discarded statement.
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  2,
  'both rows are claimed before their outcomes are reported'
);

select is(
  public.mark_notifications_sent(
    array['0b0b0b0b-0000-0000-0000-00000000000a'::uuid]),
  1,
  'a sent message is marked once'
);
select ok(
  (select sent_at is not null from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-00000000000a'),
  'and carries the time it went'
);
-- Idempotent: the Edge Function may retry the mark after a network blip
-- without un-sending or double-counting anything.
select is(
  public.mark_notifications_sent(
    array['0b0b0b0b-0000-0000-0000-00000000000a'::uuid]),
  0,
  'marking an already-sent message again does nothing'
);

select lives_ok(
  $$select public.mark_notifications_failed(
      '0b0b0b0b-0000-0000-0000-00000000000b', 'connection refused')$$,
  'a failure is recorded'
);
select is(
  (select last_error from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-00000000000b'),
  'connection refused',
  'with the reason, for whoever reads the table later'
);
-- One attempt in, so the first backoff is five minutes — not the lease's
-- five minutes by coincidence, but because outbox_backoff(1) says so.
select ok(
  (select failed_at is null and next_attempt_at > now()
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-00000000000b'),
  'a first failure backs off rather than dying'
);

-- The fifth attempt is the last. Simulated by setting attempts to the
-- ceiling rather than by claiming five times, which would need the clock
-- to advance.
update public.notification_outbox
   set attempts = public.outbox_max_attempts()
 where id = '0b0b0b0b-0000-0000-0000-00000000000b';
select lives_ok(
  $$select public.mark_notifications_failed(
      '0b0b0b0b-0000-0000-0000-00000000000b', 'still refused')$$,
  'the ceiling attempt is recorded'
);
select ok(
  (select failed_at is not null from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-00000000000b'),
  'the last attempt dead-letters the row'
);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.mark_notifications_sent(uuid[]) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826070000_mark_notifications.sql`:

```sql
/*
 * The other half of the lease: telling the queue what happened.
 *
 * Both functions ignore rows already in a terminal state. The Edge Function
 * retries a failed RPC call, and a retry that arrives after the first
 * succeeded must not un-send a message or restart a dead-lettered one.
 */

/*
 * Batched, because the happy path is a whole batch succeeding and fifty
 * round trips to say so would cost more than the sending did. Returns the
 * count actually marked, which is how a caller notices it reported the
 * same batch twice.
 */
create function public.mark_notifications_sent(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  marked int;
begin
  update public.notification_outbox
     set sent_at    = now(),
         -- A message that eventually went is not carrying a failure any
         -- more; leaving the last error would make the table read as though
         -- it had.
         last_error = null
   where id = any(p_ids)
     and sent_at is null and failed_at is null and expired_at is null;

  get diagnostics marked = row_count;
  return marked;
end;
$$;

/*
 * One at a time, because a batch fails one address at a time and each has
 * its own reason worth keeping.
 *
 * `attempts` was already incremented at claim, so a row reaching this with
 * attempts at the ceiling has had every attempt it is going to get.
 */
create function public.mark_notifications_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox
     -- Truncated: this is an error string from an SMTP library and there is
     -- no bound on what a server might say.
     set last_error = left(coalesce(p_error, 'unknown error'), 500),
         failed_at = case
           when attempts >= public.outbox_max_attempts() then now()
         end,
         next_attempt_at = case
           when attempts >= public.outbox_max_attempts() then next_attempt_at
           else now() + public.outbox_backoff(attempts)
         end
   where id = p_id
     and sent_at is null and failed_at is null and expired_at is null;
$$;

revoke execute on function public.mark_notifications_sent(uuid[])
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_sent(uuid[])
  to service_role;

revoke execute on function public.mark_notifications_failed(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_failed(uuid, text)
  to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 30 of 30 in `notification_claim.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260826070000_mark_notifications.sql supabase/tests/database/fixtures/notification_claim.test.sql
git commit -m "feat: let the sender say what happened to each message"
```

---

## Task 8: Event reminders

**Files:**
- Create: `supabase/migrations/20260826080000_queue_event_reminders.sql`
- Create: `supabase/tests/database/fixtures/event_reminders.test.sql`

**Interfaces:**
- Consumes: `clubs.reminder_offsets int[]` (default `{1440, 120}`, from `20260822033527_create_clubs.sql`); `outbox_kind` value `'event_reminder'` (Task 1).
- Produces: `public.queue_event_reminders() returns int` (rows queued), and the `queue-event-reminders` cron job on `*/15 * * * *`.
- Payload shape written: `{"event_id": <uuid>, "offset_minutes": <int>}`. Task 10's template reads `offset_minutes` to choose between "tomorrow" and "in two hours" wording.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/fixtures/event_reminders.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 starts in 90 minutes: both the 1440 and the 120 threshold are behind
-- us. E2 starts in 20 hours: only 1440. E3 starts in 3 days: neither.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tonight',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '90 minutes', now() + interval '4 hours 30 minutes',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tomorrow',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '20 hours', now() + interval '23 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next week',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '3 days', now() + interval '3 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status)
  values
  ('9409409e-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status)
  values
  ('9409409e-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  -- Waitlisted, so no table and, the point of this row, no reminder.
  ('9409409e-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   null,
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

-- Three: two thresholds for tonight's game, one for tomorrow's.
select is(
  public.queue_event_reminders(),
  3,
  'each crossed threshold queues one reminder per confirmed booking'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  2,
  'a game 90 minutes away has crossed both the 24-hour and 2-hour marks'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1,
  'a game 20 hours away has crossed only the 24-hour mark'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'),
  0,
  'a game three days away has crossed nothing'
);
select ok(
  not exists (select 1 from public.notification_outbox
               where kind = 'event_reminder'
                 and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  'a waitlisted member has no seat to be reminded of'
);

-- The whole idempotency story. The job asks "has this threshold been
-- crossed", never "was it crossed in the last 15 minutes" — so a missed
-- tick catches up and a double tick is free.
select is(
  public.queue_event_reminders(),
  0,
  'running the job again queues nothing'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'),
  3,
  'and leaves the queue exactly as it was'
);

-- The template needs to know which threshold this is, to choose between
-- "tomorrow" and "in two hours".
select is(
  (select (payload->>'offset_minutes')::int
     from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1440,
  'the payload names which threshold produced it'
);

-- A cancelled game reminds nobody.
delete from public.notification_outbox;
update public.events set status = 'cancelled'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
select is(
  (select count(*)::int
     from (select public.queue_event_reminders()) q,
          public.notification_outbox o
    where o.kind = 'event_reminder'
      and o.event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  0,
  'a cancelled game reminds nobody'
);

select has_function('public', 'queue_event_reminders',
                    'the reminder producer exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:db
```

Expected: FAIL with `function public.queue_event_reminders() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260826080000_queue_event_reminders.sql`:

```sql
/*
 * `clubs.reminder_offsets` has been sitting on the table since plan 2 with
 * nothing reading it. This is the reader.
 *
 * The defaults are {1440, 120} — a day ahead, which leaves time to cancel
 * and free the seat, and two hours ahead, which is the leaving-the-house
 * nudge. A club overrides them because a morning club and an evening club
 * want different timing; when the message actually lands is then the
 * member's business, through their own quiet hours.
 */
create function public.queue_event_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  queued int;
begin
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id,
         e.club_id,
         e.id,
         'event_reminder',
         jsonb_build_object('event_id', e.id, 'offset_minutes', mins),
         'reminder:' || e.id::text || ':' || mins::text
                     || ':' || b.profile_id::text
    from public.events e
    join public.clubs c on c.id = e.club_id
    -- One row per offset per event. `mins` rather than `offset`, which is
    -- a reserved word.
    cross join lateral unnest(c.reminder_offsets) as mins
    join public.bookings b
      on b.event_id = e.id
     -- Confirmed only. A waitlisted member has no seat to be reminded of,
     -- and telling them about a game they might not get into reads as a
     -- promotion that never came.
     and b.status = 'confirmed'
   where e.status = 'published'
     and e.starts_at > now()
     and now() >= e.starts_at - make_interval(mins => mins)
  /*
   * The whole idempotency story, in one clause.
   *
   * The key is (event, offset, recipient), so the job can ask the simple
   * question — "has this threshold been crossed" — instead of the fragile
   * one — "was it crossed in the last 15 minutes". A tick that is skipped
   * because the database was restarting catches up on the next run. A tick
   * that runs twice inserts nothing the second time. No window arithmetic
   * anywhere, and nothing to get wrong when the schedule changes.
   *
   * The recipient must be in the key: a multi-row INSERT ... ON CONFLICT
   * DO NOTHING checks each row against the unique index as it is inserted,
   * including rows the same statement already placed, so a key of
   * (event, offset) alone would keep exactly one row and remind one person.
   */
  on conflict (dedupe_key) do nothing;

  get diagnostics queued = row_count;
  return queued;
end;
$$;

/*
 * A member who books after a threshold has already passed gets that
 * reminder on the next tick. That is correct — they booked knowing the
 * game is in 90 minutes — and the staleness horizon in
 * claim_notification_batch is what stops it arriving after the game began.
 * Deliberately not special-cased here.
 */

revoke execute on function public.queue_event_reminders()
  from public, anon, authenticated;

/*
 * Fifteen minutes, matching the parent spec's table. A threshold is
 * therefore crossed and queued within 15 minutes of the moment itself,
 * which is well inside the resolution anybody experiences on a 2-hour or
 * 24-hour reminder.
 *
 * `cron.unschedule` first, guarded, so re-running against a project that
 * already has the job is not an error — migrations are forward-only and
 * `db reset` replays them all. Same guard as 20260825060000.
 */
do $$
begin
  perform cron.unschedule('queue-event-reminders');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'queue-event-reminders',
  '*/15 * * * *',
  $$select public.queue_event_reminders()$$
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx supabase db reset && npm run test:db
```

Expected: PASS, 10 of 10 in `event_reminders.test.sql`.

- [ ] **Step 5: Verify the job is actually scheduled**

pgTAP cannot check this — `cli_login_postgres` has no `USAGE` on the `cron` schema, which is why `docs/testing.md`'s "Scheduled work" section verifies cron jobs with local psql instead.

```bash
npx supabase db reset >/dev/null 2>&1 && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select jobname, schedule from cron.job order by jobname"
```

Expected: four rows — `announce-need-a-fourth`, `queue-event-reminders`, `sweep-promotion-offers`, and the nightly materialization job.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260826080000_queue_event_reminders.sql supabase/tests/database/fixtures/event_reminders.test.sql
git commit -m "feat: read the reminder offsets that have sat unread since plan 2"
```

---

## Task 9: Rendering, and the sender seam

Everything in this task is plain TypeScript with no Deno-only imports except `smtp.ts`, which is why Vitest can test it. That split is the whole point of the file layout: the part with judgement in it (what does this message say) is testable without a mail server, and the part with I/O in it is one small class.

**Files:**
- Create: `supabase/functions/deliver-notifications/types.ts`
- Create: `supabase/functions/deliver-notifications/sender.ts`
- Create: `supabase/functions/deliver-notifications/smtp.ts`
- Create: `supabase/functions/deliver-notifications/brand.ts`
- Create: `supabase/functions/deliver-notifications/templates/shell.ts`
- Create: `supabase/functions/deliver-notifications/templates/bodies.ts`
- Create: `supabase/functions/deliver-notifications/render.ts`
- Test: `supabase/functions/deliver-notifications/__tests__/render.test.ts`

**Interfaces:**
- Consumes: the `claim_notification_batch` column list from Task 6, mirrored exactly by `RenderRow`.
- Produces:
  - `type RenderRow`, `type Message`, `type Body`, `type OutboxKind` (`types.ts`)
  - `interface Sender { send(message: Message): Promise<void> }` and `class FakeSender` (`sender.ts`)
  - `class SmtpSender` and `type SmtpConfig` (`smtp.ts`)
  - `bodyFor(row: RenderRow, appUrl: string): Body` (`templates/bodies.ts`)
  - `renderShell(body: Body, clubName: string, settingsUrl: string): string` and `escapeHtml(value: string): string` (`templates/shell.ts`)
  - `renderMessage(row: RenderRow, appUrl: string): Message` (`render.ts`)

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/deliver-notifications/__tests__/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeSender } from '../sender';
import { renderMessage } from '../render';
import type { OutboxKind, RenderRow } from '../types';

const APP = 'https://app.example.test';

function row(overrides: Partial<RenderRow> = {}): RenderRow {
  return {
    id: '0b0b0b0b-0000-0000-0000-000000000001',
    kind: 'booked_by_friend',
    payload: { booking_id: 'b00c1234-0000-0000-0000-000000000001' },
    recipient_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    recipient_name: 'Bob',
    recipient_email: 'bob@example.com',
    channel: 'email',
    club_id: 'c1c1c1c1-0000-0000-0000-000000000001',
    club_name: 'Riverside',
    event_id: 'e1e1e1e1-0000-0000-0000-000000000001',
    event_title: 'Tuesday night',
    event_starts_at: '2026-09-08T23:00:00Z',
    club_timezone: 'America/New_York',
    table_label: 'Table 2',
    actor_name: 'Alice',
    broadcast_subject: null,
    broadcast_body: null,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

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
];

describe('renderMessage', () => {
  // Nothing is allowed to render as a blank subject or an empty body. A
  // kind added later without a template would otherwise ship as an email
  // with no subject line and nobody would notice until a member did.
  it.each(ALL_KINDS)('renders %s with a subject and a body', (kind) => {
    const message = renderMessage(
      row({
        kind,
        broadcast_subject: kind === 'broadcast' ? 'Doors open at seven' : null,
        broadcast_body:
          kind === 'broadcast' ? 'The side entrance is locked.' : null,
        payload: kind === 'event_reminder' ? { offset_minutes: 120 } : {},
      }),
      APP,
    );

    expect(message.to).toBe('bob@example.com');
    expect(message.subject.trim().length).toBeGreaterThan(0);
    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(message.html).toContain('<table');
  });

  // The plain-text part is generated from the same body data, not scraped
  // out of the HTML. A stray tag here means somebody stripped markup with
  // a regex instead.
  it.each(ALL_KINDS)('gives %s a text part with no markup', (kind) => {
    const message = renderMessage(
      row({
        kind,
        broadcast_subject: kind === 'broadcast' ? 'Doors open at seven' : null,
        broadcast_body:
          kind === 'broadcast' ? 'The side entrance is locked.' : null,
        payload: kind === 'event_reminder' ? { offset_minutes: 120 } : {},
      }),
      APP,
    );
    expect(message.text).not.toMatch(/<[a-z/]/i);
  });

  it('names the person who acted', () => {
    const message = renderMessage(row({ kind: 'booked_by_friend' }), APP);
    expect(message.subject).toContain('Alice');
  });

  // The actor is nullable — a promotion is nobody's doing — so the copy
  // must not read "undefined booked you a seat".
  it('says something sensible when nobody acted', () => {
    const message = renderMessage(
      row({ kind: 'booking_cancelled_by_host', actor_name: null }),
      APP,
    );
    expect(message.subject).not.toContain('null');
    expect(message.text).not.toContain('undefined');
  });

  // The two default offsets want different words. "Tuesday night is
  // tomorrow" and "Tuesday night starts soon" are not interchangeable.
  it('words a day-ahead reminder differently from a two-hour one', () => {
    const dayAhead = renderMessage(
      row({ kind: 'event_reminder', payload: { offset_minutes: 1440 } }),
      APP,
    );
    const soon = renderMessage(
      row({ kind: 'event_reminder', payload: { offset_minutes: 120 } }),
      APP,
    );
    expect(dayAhead.subject).not.toBe(soon.subject);
  });

  it('uses the host their own words for a broadcast', () => {
    const message = renderMessage(
      row({
        kind: 'broadcast',
        broadcast_subject: 'Doors open at seven',
        broadcast_body: 'The side entrance is locked this week.',
      }),
      APP,
    );
    expect(message.subject).toBe('Doors open at seven');
    expect(message.text).toContain('The side entrance is locked this week.');
  });

  // Every link has to be absolute https. Email clients do not follow the
  // mahjhero:// scheme, so a relative or custom-scheme href is a dead link.
  it('links absolutely, over https', () => {
    const message = renderMessage(row({ kind: 'event_reminder' }), APP);
    expect(message.html).toContain(`${APP}/clubs/`);
    expect(message.html).not.toContain('mahjhero://');
  });

  // A club is named by its host and goes straight into an HTML document.
  it('escapes anything a host typed', () => {
    const message = renderMessage(
      row({ club_name: 'Bell <script>alert(1)</script> Club' }),
      APP,
    );
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  // Reminders for a booked game cannot be switched off, so the footer must
  // not offer a link that implies otherwise.
  it('tells a member which messages they can silence', () => {
    const reminder = renderMessage(row({ kind: 'event_reminder' }), APP);
    const fourth = renderMessage(row({ kind: 'need_a_fourth' }), APP);
    expect(reminder.text.toLowerCase()).toContain("can't be switched off");
    expect(fourth.text).toContain(`${APP}/notifications`);
  });
});

describe('FakeSender', () => {
  it('records what it was given', async () => {
    const sender = new FakeSender();
    await sender.send(renderMessage(row(), APP));
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('bob@example.com');
  });

  it('rejects when told to, and records nothing', async () => {
    const sender = new FakeSender(() => 'connection refused');
    await expect(sender.send(renderMessage(row(), APP))).rejects.toThrow(
      'connection refused',
    );
    expect(sender.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- supabase/functions
```

Expected: FAIL — `Failed to resolve import "../sender"`.

- [ ] **Step 3: Write the shared types**

Create `supabase/functions/deliver-notifications/types.ts`:

```ts
/**
 * The shapes this function passes around, and nothing else.
 *
 * `RenderRow` mirrors `claim_notification_batch`'s return columns one for
 * one. If a column is added there, it is added here, in the same order —
 * the RPC is the contract and this is the copy of it.
 */

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
  | 'broadcast';

export type RenderRow = {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  channel: string;
  club_id: string;
  club_name: string;
  // Null for a club-wide broadcast, which is the only kind with no event.
  event_id: string | null;
  event_title: string | null;
  event_starts_at: string | null;
  club_timezone: string;
  table_label: string | null;
  actor_name: string | null;
  broadcast_subject: string | null;
  broadcast_body: string | null;
  created_at: string;
};

/** One call to action. At most one per message, deliberately. */
export type Cta = { label: string; url: string };

/**
 * What a message says, before it is any particular format. Both the HTML
 * and the plain-text parts are built from this — the text is never scraped
 * out of the HTML, which is how text parts end up full of stray markup.
 */
export type Body = {
  subject: string;
  headline: string;
  paragraphs: string[];
  cta: Cta | null;
  footerNote: string;
};

export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
```

- [ ] **Step 4: Write the sender seam**

Create `supabase/functions/deliver-notifications/sender.ts`:

```ts
import type { Message } from './types.ts';

/**
 * One method, so a test can substitute a recorder and so the later push
 * plan adds an implementation rather than an `if` in the batch loop.
 *
 * Deliberately free of Deno imports: Vitest resolves this file, and
 * everything that touches a socket lives in smtp.ts instead.
 */
export interface Sender {
  send(message: Message): Promise<void>;
}

export class FakeSender implements Sender {
  readonly sent: Message[] = [];

  /**
   * @param failOn returns a failure reason for messages that should be
   *   rejected, or null to accept. Lets a test drive the retry path
   *   without a mail server that can be made to misbehave on cue.
   */
  constructor(private readonly failOn: (message: Message) => string | null = () => null) {}

  send(message: Message): Promise<void> {
    const reason = this.failOn(message);
    // Recorded only on success, so `sent` means sent.
    if (reason) return Promise.reject(new Error(reason));
    this.sent.push(message);
    return Promise.resolve();
  }
}
```

Create `supabase/functions/deliver-notifications/smtp.ts`:

```ts
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import type { Sender } from './sender.ts';
import type { Message } from './types.ts';

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

/**
 * The only file in this function that imports a URL module, and therefore
 * the only one Vitest cannot see. Keep it that thin.
 *
 * SMTP rather than a provider's HTTP API so that local development and the
 * hosted deployment run the identical code path — locally against the
 * Mailpit the Supabase CLI already runs on port 54325, and in production
 * against whatever relay the secrets point at. The provider becomes a
 * secret rather than a dependency.
 */
export class SmtpSender implements Sender {
  constructor(private readonly config: SmtpConfig) {}

  async send(message: Message): Promise<void> {
    const client = new SMTPClient({
      connection: {
        hostname: this.config.host,
        port: this.config.port,
        // Implicit TLS on 465; 587 negotiates STARTTLS on its own. The
        // local Mailpit on 54325 offers neither and needs this false.
        tls: this.config.port === 465,
        // Mailpit accepts anything and wants no credentials. Passing an
        // empty username makes it refuse the connection outright.
        auth: this.config.user
          ? { username: this.config.user, password: this.config.pass }
          : undefined,
      },
    });

    try {
      await client.send({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        content: message.text,
        html: message.html,
      });
    } finally {
      // A connection left open survives the invocation in Deno Deploy and
      // the relay eventually refuses new ones.
      await client.close();
    }
  }
}
```

- [ ] **Step 5: Write the brand tokens**

Create `supabase/functions/deliver-notifications/brand.ts`:

```ts
/**
 * The only duplication in this plan, and named so it is not later mistaken
 * for an oversight.
 *
 * These values are copied from `lib/theme.ts` — `colors.bg`,
 * `colors.surface`, `colors.text`, `colors.textMuted`, `accent[500]`,
 * `accent[700]` and `neutral[300]`. This function runs under Deno and
 * cannot resolve through Metro, so importing the real module is not
 * available. If the palette moves in lib/theme, move it here too.
 */
export const brand = {
  name: 'MahjHero',
  bg: '#f5ead8',
  surface: '#ebddc5',
  text: '#201e1d',
  muted: '#807a71',
  accent: '#d67f48',
  accentDark: '#8c491a',
  divider: '#dcd3c4',
} as const;
```

- [ ] **Step 6: Write the shell**

Create `supabase/functions/deliver-notifications/templates/shell.ts`:

```ts
import { brand } from '../brand.ts';
import type { Body } from '../types.ts';

/**
 * Club names, event titles and broadcast bodies are all typed by people and
 * all go straight into an HTML document. Everything interpolated below goes
 * through this first.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One layout for all eleven kinds.
 *
 * Tables and inline styles, because that is the only construct email
 * clients agree on — no flexbox, no grid, no external stylesheet, no
 * `<style>` block that Gmail will strip. 600px is the width every client
 * renders without horizontal scrolling.
 *
 * Eleven bespoke designs would look better and would be eleven separate
 * sets of client-compatibility risk for a product that has not sent its
 * first email yet.
 */
export function renderShell(
  body: Body,
  clubName: string,
  settingsUrl: string,
): string {
  const paragraphs = body.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${brand.text};">${escapeHtml(text)}</p>`,
    )
    .join('');

  const cta = body.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
         <tr><td style="border-radius:999px;background:${brand.accent};">
           <a href="${escapeHtml(body.cta.url)}"
              style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(body.cta.label)}</a>
         </td></tr>
       </table>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${brand.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:${brand.surface};border-radius:16px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 24px;font-size:20px;font-weight:700;color:${brand.accentDark};">${brand.name}</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;color:${brand.text};">${escapeHtml(body.headline)}</h1>
        ${paragraphs}
        ${cta}
        <hr style="border:none;border-top:1px solid ${brand.divider};margin:24px 0;" />
        <p style="margin:0;font-size:13px;line-height:20px;color:${brand.muted};">
          ${escapeHtml(`Sent by ${clubName} on MahjHero.`)}<br />
          ${escapeHtml(body.footerNote)}
        </p>
        <p style="margin:8px 0 0;font-size:13px;line-height:20px;color:${brand.muted};">
          <a href="${escapeHtml(settingsUrl)}" style="color:${brand.accentDark};">Notification settings</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
```

- [ ] **Step 7: Write the per-kind bodies**

Create `supabase/functions/deliver-notifications/templates/bodies.ts`:

```ts
import type { Body, RenderRow } from '../types.ts';

/**
 * In the CLUB's timezone, not the recipient's. A game happens where the
 * club is; telling a member who travelled that Tuesday night starts at
 * 20:00 their time would be true and useless.
 */
function formatWhen(row: RenderRow): string {
  if (!row.event_starts_at) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: row.club_timezone,
  }).format(new Date(row.event_starts_at));
}

/** "Tuesday night on Tuesday, September 8 at 7:00 PM" — the whole phrase. */
function game(row: RenderRow): string {
  const title = row.event_title ?? 'the game';
  const when = formatWhen(row);
  return when ? `${title} on ${when}` : title;
}

function at(row: RenderRow): string {
  return row.table_label ? ` at ${row.table_label}` : '';
}

/**
 * `actor_name` is null whenever nobody did it — a waitlist promotion is
 * the system's doing, and a host who deleted their account leaves a
 * cancellation with no name on it. Every use goes through this so no email
 * ever reads "undefined cancelled your seat".
 */
function actor(row: RenderRow, fallback: string): string {
  return row.actor_name ?? fallback;
}

function eventUrl(row: RenderRow, appUrl: string): string {
  return row.event_id
    ? `${appUrl}/clubs/${row.club_id}/events/${row.event_id}`
    : `${appUrl}/clubs/${row.club_id}`;
}

const SEAT_FOOTER = (club: string) =>
  `You're getting this because of a seat you hold at ${club}.`;

const MEMBER_FOOTER = (club: string) =>
  `You're getting this because you're a member of ${club}. You can change what reaches you in your notification settings.`;

const REMINDER_FOOTER =
  "You're getting this because you have a seat at this game. Reminders for games you've booked can't be switched off.";

export function bodyFor(row: RenderRow, appUrl: string): Body {
  const url = eventUrl(row, appUrl);
  const seatFooter = SEAT_FOOTER(row.club_name);
  const memberFooter = MEMBER_FOOTER(row.club_name);

  switch (row.kind) {
    case 'booked_by_friend':
      return {
        subject: `${actor(row, 'Someone')} saved you a seat at ${row.club_name}`,
        headline: 'You have a seat',
        paragraphs: [
          `${actor(row, 'Someone')} booked you in for ${game(row)}${at(row)}.`,
          "If you can't make it, decline the seat and it goes back into the pool for somebody else.",
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'booking_declined':
      return {
        subject: `${actor(row, 'Someone')} can't make ${row.event_title ?? 'the game'}`,
        headline: 'A seat came free',
        paragraphs: [
          `${actor(row, 'The person you booked for')} declined the seat you booked for them at ${game(row)}.`,
          'The seat is back in the pool.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'booking_cancelled_by_host':
      return {
        subject: `Your seat at ${row.event_title ?? 'the game'} was cancelled`,
        headline: 'Your seat was cancelled',
        paragraphs: [
          `${actor(row, 'A host')} cancelled your seat at ${game(row)}.`,
          'If that looks wrong, the club is the place to sort it out.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'waitlist_promoted':
      return {
        subject: `You're in for ${row.event_title ?? 'the game'}`,
        headline: 'You have a seat',
        paragraphs: [
          `A seat opened up at ${game(row)} and you were next on the waitlist${at(row)}.`,
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'promotion_offer':
      return {
        subject: `A seat is being held for you at ${row.event_title ?? 'the game'}`,
        headline: 'A seat is yours if you want it',
        paragraphs: [
          `Room came free at ${game(row)}, and you were next.`,
          "It's held for you for the next two hours. After that it goes to whoever is behind you.",
        ],
        cta: { label: 'Take the seat', url },
        footerNote: seatFooter,
      };

    case 'promotion_offer_expired':
      return {
        subject: `The seat at ${row.event_title ?? 'the game'} has gone`,
        headline: 'That seat has gone',
        paragraphs: [
          `The seat held for you at ${game(row)} wasn't taken in time, so it went to the next group.`,
          "You're still on the waitlist.",
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'unseated':
      return {
        subject: `You no longer have a seat at ${row.event_title ?? 'the game'}`,
        headline: 'You lost your seat',
        paragraphs: [
          `Your seat at ${game(row)} is no longer yours.`,
          'If there is room left, you can take another.',
        ],
        cta: { label: 'See the game', url },
        footerNote: seatFooter,
      };

    case 'event_cancelled':
      return {
        subject: `${row.event_title ?? 'A game'} is cancelled`,
        headline: 'The game is off',
        paragraphs: [
          `${game(row)} has been cancelled. Your seat went with it.`,
        ],
        cta: { label: `See what else ${row.club_name} has on`, url: `${appUrl}/clubs/${row.club_id}` },
        footerNote: seatFooter,
      };

    case 'need_a_fourth':
      return {
        subject: `${row.club_name} needs a fourth`,
        headline: 'They need a fourth',
        paragraphs: [
          `${row.table_label ?? 'A table'} at ${game(row)} is three of four.`,
          'Take the seat and they have a game.',
        ],
        cta: { label: 'Take the seat', url },
        footerNote: memberFooter,
      };

    case 'event_reminder': {
      // The two default offsets want different words. A day-ahead reminder
      // exists so you can cancel and free the seat; a two-hour one exists
      // so you leave the house.
      const minutes = Number(row.payload.offset_minutes ?? 0);
      const dayAhead = minutes >= 1440;
      return {
        subject: dayAhead
          ? `${row.event_title ?? 'Your game'} is tomorrow`
          : `${row.event_title ?? 'Your game'} starts soon`,
        headline: dayAhead ? 'Tomorrow' : 'Starting soon',
        paragraphs: [
          `You have a seat at ${game(row)}${at(row)}.`,
          dayAhead
            ? "If you can't make it, cancelling now gives the seat to somebody who can."
            : 'See you there.',
        ],
        cta: { label: 'See the game', url },
        footerNote: REMINDER_FOOTER,
      };
    }

    case 'broadcast':
      return {
        subject: row.broadcast_subject ?? `A message from ${row.club_name}`,
        headline: row.broadcast_subject ?? `A message from ${row.club_name}`,
        paragraphs: (row.broadcast_body ?? '')
          .split(/\n{2,}/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
        cta: { label: row.event_id ? 'See the game' : `See ${row.club_name}`, url },
        footerNote: memberFooter,
      };
  }
}
```

- [ ] **Step 8: Write the composer**

Create `supabase/functions/deliver-notifications/render.ts`:

```ts
import { renderShell } from './templates/shell.ts';
import { bodyFor } from './templates/bodies.ts';
import type { Body, Message, RenderRow } from './types.ts';

/**
 * Built from the same Body the HTML is built from, never scraped out of the
 * HTML. Regex-stripping markup is how text parts end up with `&amp;` in
 * them and a stray `</p>` at the end of every paragraph.
 */
function renderText(body: Body, clubName: string, settingsUrl: string): string {
  const parts = [body.headline, '', ...body.paragraphs];
  if (body.cta) parts.push('', `${body.cta.label}: ${body.cta.url}`);
  parts.push('', '---', `Sent by ${clubName} on MahjHero.`, body.footerNote,
             `Notification settings: ${settingsUrl}`);
  return parts.join('\n');
}

export function renderMessage(row: RenderRow, appUrl: string): Message {
  const body = bodyFor(row, appUrl);
  // Absolute https, always. Email clients do not follow the mahjhero://
  // scheme, so every link in every template resolves against appUrl.
  const settingsUrl = `${appUrl}/notifications`;
  return {
    to: row.recipient_email,
    subject: body.subject,
    html: renderShell(body, row.club_name, settingsUrl),
    text: renderText(body, row.club_name, settingsUrl),
  };
}
```

- [ ] **Step 9: Run test to verify it passes**

```bash
npm test -- supabase/functions
```

Expected: PASS, 31 tests (11 kinds × 2 parameterised cases, plus 9 named cases).

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/deliver-notifications
git commit -m "feat: write the eleven things MahjHero has to say"
```

---

## Task 10: The drain handler

**Files:**
- Create: `supabase/functions/deliver-notifications/index.ts`
- Create: `supabase/functions/deliver-notifications/batch.ts`
- Modify: `supabase/functions/deliver-notifications/__tests__/render.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `renderMessage` (Task 9), `Sender` (Task 9), and the three RPCs from Tasks 6 and 7.
- Produces:
  - `deliverBatch(rows: RenderRow[], sender: Sender, appUrl: string, report: Report): Promise<{ sent: number; failed: number }>` (`batch.ts`) — pure, no Deno, Vitest-testable
  - `type Report = { markSent(ids: string[]): Promise<void>; markFailed(id: string, error: string): Promise<void> }`
  - The HTTP handler (`index.ts`), which wires the RPCs into a `Report` and an `SmtpSender` into a `Sender`

The batch loop is split out of `index.ts` for one reason: it is the part with a decision in it — one message failing must not stop the other forty-nine — and `index.ts` is otherwise environment wiring that no test can reach.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/deliver-notifications/__tests__/render.test.ts`:

```ts
import { deliverBatch } from '../batch';
import type { Report } from '../batch';

function recordingReport() {
  const sentIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  const report: Report = {
    markSent: async (ids) => {
      sentIds.push(...ids);
    },
    markFailed: async (id, error) => {
      failures.push({ id, error });
    },
  };
  return { report, sentIds, failures };
}

describe('deliverBatch', () => {
  it('sends every row and reports them in one call', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two' }), row({ id: 'three' })];
    const sender = new FakeSender();
    const { report, sentIds } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(sender.sent).toHaveLength(3);
    // One markSent for the whole batch. Fifty round trips to say "that
    // worked" would cost more than the sending did.
    expect(sentIds).toEqual(['one', 'two', 'three']);
  });

  // The reason the loop exists. A relay that rejects one address must not
  // cost the other forty-nine their delivery window.
  it('keeps going when one address is rejected', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two', recipient_email: 'bad@example.com' }), row({ id: 'three' })];
    const sender = new FakeSender((message) =>
      message.to === 'bad@example.com' ? '550 no such user' : null,
    );
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(sentIds).toEqual(['one', 'three']);
    expect(failures).toEqual([{ id: 'two', error: '550 no such user' }]);
  });

  // A row that cannot be rendered at all is a failure like any other, not
  // an exception that abandons the batch.
  it('treats a render failure as that row failing', async () => {
    const rows = [row({ id: 'one', kind: 'nonsense' as never })];
    const sender = new FakeSender();
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(sentIds).toEqual([]);
    expect(failures[0].id).toBe('one');
  });

  it('reports nothing when there is nothing to do', async () => {
    const sender = new FakeSender();
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch([], sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sentIds).toEqual([]);
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- supabase/functions
```

Expected: FAIL — `Failed to resolve import "../batch"`.

- [ ] **Step 3: Write the batch loop**

Create `supabase/functions/deliver-notifications/batch.ts`:

```ts
import { renderMessage } from './render.ts';
import type { Sender } from './sender.ts';
import type { RenderRow } from './types.ts';

/**
 * How the loop tells the queue what happened. An interface rather than the
 * Supabase client itself, so the loop can be tested without a database.
 */
export type Report = {
  markSent(ids: string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
};

/**
 * Sequential, not concurrent.
 *
 * Fifty messages a minute is three thousand an hour, far beyond what a
 * club-scale product produces, and sending one at a time keeps a shared
 * relay from rate-limiting the whole batch because of one burst. There is
 * no latency problem here worth solving with concurrency.
 *
 * One message failing must not cost the rest their delivery window, so
 * every send is individually guarded — including the render, which can
 * throw on a payload shaped differently from what its kind expects.
 */
export async function deliverBatch(
  rows: RenderRow[],
  sender: Sender,
  appUrl: string,
  report: Report,
): Promise<{ sent: number; failed: number }> {
  const sentIds: string[] = [];
  let failed = 0;

  for (const row of rows) {
    try {
      await sender.send(renderMessage(row, appUrl));
      sentIds.push(row.id);
    } catch (cause) {
      failed += 1;
      // Reported one at a time, because each failure has its own reason and
      // the reason is the only thing a human reading the table later has.
      await report.markFailed(row.id, cause instanceof Error ? cause.message : String(cause));
    }
  }

  // One call for the whole batch, and skipped entirely when nothing went —
  // marking an empty array is a wasted round trip on every quiet minute,
  // which is most of them.
  if (sentIds.length > 0) await report.markSent(sentIds);

  return { sent: sentIds.length, failed };
}
```

- [ ] **Step 4: Write the handler**

Create `supabase/functions/deliver-notifications/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { deliverBatch, type Report } from './batch.ts';
import { SmtpSender } from './smtp.ts';
import type { RenderRow } from './types.ts';

/**
 * Fifty per invocation, one invocation a minute.
 *
 * Deliberately not "drain until empty": a runaway producer would then turn
 * one invocation into an unbounded one, and Edge Functions have a wall
 * clock. A backlog drains at 3,000 an hour instead, oldest first.
 */
const BATCH_SIZE = 50;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

Deno.serve(async (req: Request): Promise<Response> => {
  let secret: string;
  try {
    secret = required('DRAIN_SECRET');
  } catch (cause) {
    // A misconfigured function must not silently accept every caller.
    return new Response(String(cause), { status: 500 });
  }

  /*
   * The endpoint is public — `verify_jwt = false` in config.toml, because
   * pg_net calls it with a header and not a session. The shared secret is
   * the whole of the authentication.
   *
   * This matters more than it looks: anyone who could trigger the drain
   * could lease every pending message away five minutes at a time and burn
   * the attempt counter until real messages dead-lettered.
   */
  if (req.headers.get('x-drain-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const supabase = createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase.rpc('claim_notification_batch', {
    p_limit: BATCH_SIZE,
  });

  if (error) {
    // Nothing was claimed, so nothing is lost — the next tick is a minute
    // away. 500 so the failure shows up in the function logs.
    console.error('claim_notification_batch failed', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = (data ?? []) as RenderRow[];

  const sender = new SmtpSender({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    // Empty is legitimate: the local Mailpit wants no credentials.
    user: Deno.env.get('SMTP_USER') ?? '',
    pass: Deno.env.get('SMTP_PASS') ?? '',
    from: required('SMTP_FROM'),
  });

  const report: Report = {
    markSent: async (ids) => {
      const { error: markError } = await supabase.rpc('mark_notifications_sent', { p_ids: ids });
      // Logged, not thrown. The messages went; failing to record that costs
      // a duplicate on the next tick, which is the at-least-once contract
      // working as designed, not an outage.
      if (markError) console.error('mark_notifications_sent failed', markError);
    },
    markFailed: async (id, message) => {
      const { error: markError } = await supabase.rpc('mark_notifications_failed', {
        p_id: id,
        p_error: message,
      });
      if (markError) console.error('mark_notifications_failed failed', markError);
    },
  };

  const result = await deliverBatch(rows, sender, required('PUBLIC_APP_URL'), report);

  return new Response(JSON.stringify({ claimed: rows.length, ...result }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 5: Tell the local stack about the function and its mail server**

In `supabase/config.toml`, uncomment the Mailpit SMTP port under `[local_smtp]` so the function has something to send to:

```toml
[local_smtp]
enabled = true
# Port to use for the email testing server web interface.
port = 54324
# Uncomment to expose additional ports for testing user applications that send emails.
smtp_port = 54325
```

Then append a functions section at the end of the file:

```toml
# The drain is called by pg_net with a shared secret in a header, not by a
# signed-in user with a JWT. Leaving verify_jwt on would reject every call
# the cron job makes.
[functions.deliver-notifications]
verify_jwt = false
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test -- supabase/functions
```

Expected: PASS. The four `deliverBatch` cases join the existing rendering ones.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/deliver-notifications supabase/config.toml
git commit -m "feat: drain the batch, and let one bad address cost only itself"
```

---

## Task 11: Schedule it, and prove a real email arrives

The end-to-end check in this task is the point of the whole plan. Everything before it is tested against fakes.

**Files:**
- Create: `supabase/migrations/20260826090000_schedule_notification_drain.sql`
- Modify: `docs/testing.md`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `public.claim_notification_batch` (Task 6), the deployed `deliver-notifications` function (Task 10).
- Produces: `public.app_config (key, value)` and the `deliver-notifications` cron job on `* * * * *`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260826090000_schedule_notification_drain.sql`:

```sql
/*
 * The function URL and the drain secret differ per environment and neither
 * belongs in a migration — migrations are committed, and this repository is
 * a public GitHub project.
 *
 * So the cron body reads both from a table that ships empty. Until somebody
 * seeds it, the job runs every minute and does nothing, which is the right
 * behaviour for a fresh `db reset`: no outbound HTTP from a developer's
 * laptop unless they asked for it.
 */
create table public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;
-- No policy at all, the same posture notification_outbox takes. RLS is on
-- and nothing passes it, so a stray grant later still reaches nothing.
revoke all on public.app_config from anon, authenticated;

create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('deliver-notifications');
exception
  when others then
    null;
end;
$$;

/*
 * Every minute. A promotion offer runs for two hours and a two-hour
 * reminder wants to land near the hour, so a minute is the coarsest
 * schedule nobody notices. The 5-minute claim lease is deliberately longer
 * than the interval: overlapping invocations are expected and skip each
 * other's leased rows rather than racing for them.
 *
 * The `where exists` makes an unconfigured environment a no-op rather than
 * an error in the cron log every sixty seconds.
 */
select cron.schedule(
  'deliver-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'functions_url')
           || '/deliver-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-drain-secret',
      (select value from public.app_config where key = 'drain_secret')),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.app_config where key = 'functions_url')
    and exists (select 1 from public.app_config where key = 'drain_secret')
  $$
);
```

- [ ] **Step 2: Apply it and confirm the job exists**

```bash
npx supabase db reset >/dev/null 2>&1 && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select jobname, schedule from cron.job order by jobname"
```

Expected: five rows, including `deliver-notifications` at `* * * * *` and `queue-event-reminders` at `*/15 * * * *`.

- [ ] **Step 3: Serve the function against the local stack**

In one terminal:

```bash
npx supabase functions serve deliver-notifications --no-verify-jwt --env-file supabase/functions/.env.local
```

Create `supabase/functions/.env.local` first — it is git-ignored via the existing `.env*` rules; confirm with `git check-ignore -v supabase/functions/.env.local` before writing anything into it:

```
DRAIN_SECRET=local-drain-secret
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<the service_role key from `npx supabase status`>
SMTP_HOST=127.0.0.1
SMTP_PORT=54325
SMTP_USER=
SMTP_PASS=
SMTP_FROM=MahjHero <noreply@mahjhero.test>
PUBLIC_APP_URL=http://localhost:8081
```

- [ ] **Step 4: Queue a real message and drain it**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "insert into public.app_config (key, value) values ('functions_url', 'http://host.docker.internal:54321/functions/v1'), ('drain_secret', 'local-drain-secret') on conflict (key) do update set value = excluded.value"
```

Then queue one message against a seeded club and member of your choosing, and invoke the drain by hand rather than waiting for the tick:

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/deliver-notifications -H 'x-drain-secret: local-drain-secret' -H 'Content-Type: application/json' -d '{}'
```

Expected: `{"claimed":1,"sent":1,"failed":0}`.

- [ ] **Step 5: Confirm the email actually arrived**

Open http://127.0.0.1:54324 — the Mailpit inbox the Supabase CLI already runs. The message must be there, with the branded HTML rendering and a plain-text alternative.

This is the only step in the plan that exercises the real code path end to end: real Postgres, real claim, real render, real SMTP. Everything else is fakes.

- [ ] **Step 6: Confirm the secret is load-bearing**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:54321/functions/v1/deliver-notifications -H 'x-drain-secret: wrong' -d '{}'
```

Expected: `403`.

- [ ] **Step 7: Document it**

Add to the end of `docs/testing.md`'s "Scheduled work" section:

````markdown
### The notification drain

`deliver-notifications` runs every minute and is the only scheduled job
that leaves the database. `pg_cron` does not call the Edge Function
directly — it `pg_net`-POSTs to it, reading the URL and the shared secret
from `public.app_config`, which ships **empty**. An unconfigured
environment therefore runs the job every minute and does nothing, which is
what makes `npx supabase db reset` on a laptop safe: no outbound HTTP
unless somebody seeded that table.

To exercise the whole path locally:

1. `npx supabase start` (Mailpit's SMTP port must be uncommented in
   `config.toml` as `smtp_port = 54325`; the web inbox is on 54324)
2. `npx supabase functions serve deliver-notifications --no-verify-jwt --env-file supabase/functions/.env.local`
3. Seed `app_config` with `functions_url` and `drain_secret`
4. `curl -X POST .../functions/v1/deliver-notifications -H 'x-drain-secret: ...'`
5. Read the result at http://127.0.0.1:54324

The function URL for `pg_net` running inside the Supabase Docker network is
`http://host.docker.internal:54321/functions/v1`, not `127.0.0.1` — the
database container cannot reach the host loopback by that name.

Nothing in the automated suites covers step 5. The claim, the backoff, the
quiet hours and the templates are all tested; that an SMTP connection
succeeds is not, and cannot be without a mail server in CI.

Deploying it is two commands and is **not** part of `supabase db push` —
this is the first Edge Function in the repository, so a migration landing
without the function landing leaves the cron job posting into nothing:

```
npx supabase functions deploy deliver-notifications
npx supabase secrets set DRAIN_SECRET=... SMTP_HOST=... SMTP_PORT=... \
  SMTP_USER=... SMTP_PASS=... SMTP_FROM=... PUBLIC_APP_URL=...
```

Then seed `app_config` on the hosted project with `functions_url`
(`https://<project-ref>.supabase.co/functions/v1`) and the same
`drain_secret`. Function logs are under Edge Functions in the dashboard;
nothing about a failed send reaches the client.
````

- [ ] **Step 8: Record the secrets a deployment needs**

Add to `.env.local.example`:

```
# --- Edge Function secrets (set with `npx supabase secrets set`, NOT here) ---
# DRAIN_SECRET       shared secret pg_net sends as x-drain-secret
# SMTP_HOST          relay hostname
# SMTP_PORT          465 for implicit TLS, 587 for STARTTLS
# SMTP_USER          empty for the local Mailpit
# SMTP_PASS
# SMTP_FROM          e.g. "MahjHero <noreply@yourdomain>"
# PUBLIC_APP_URL     https origin the emails link to; email clients do not
#                    follow the mahjhero:// scheme
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260826090000_schedule_notification_drain.sql docs/testing.md .env.local.example
git commit -m "feat: put the drain on a schedule and prove mail lands"
```

---

## Task 12: The client module

**Files:**
- Create: `lib/broadcasts.ts`
- Test: `lib/broadcasts.test.ts`

**Interfaces:**
- Consumes: `send_broadcast`, `broadcast_recipient_count`, and `select` on `broadcasts` (Task 3).
- Produces:
  - `type Broadcast = { id, club_id, event_id, subject, body, recipient_count, created_at }`
  - `const BROADCAST_COLUMNS: string`, `const SUBJECT_MAX = 120`, `const BODY_MAX = 2000`
  - `isValidBroadcast(subject: string, body: string): boolean`
  - `fetchBroadcasts(clubId: string): Promise<Broadcast[] | null>`
  - `countBroadcastRecipients(clubId: string, eventId: string | null): Promise<number | null>`
  - `sendBroadcast(clubId, eventId, subject, body): Promise<{ id: string | null; error: string | null }>`

- [ ] **Step 1: Write the failing test**

Create `lib/broadcasts.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The read path is `from(...).select(...).eq(...).order(...)`; the two
// writes are `rpc(...)`. Modelled as the real chains so a test is
// exercising the behaviour and not a TypeError on a missing method.
const orderAfterEq = vi.fn();
const rpc = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: orderAfterEq })),
      })),
    })),
    rpc,
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  countBroadcastRecipients,
  fetchBroadcasts,
  isValidBroadcast,
  sendBroadcast,
  BODY_MAX,
  SUBJECT_MAX,
} from './broadcasts';

beforeEach(() => {
  orderAfterEq.mockReset();
  orderAfterEq.mockRejectedValue(new Error('network down'));
  rpc.mockReset();
  rpc.mockRejectedValue(new Error('network down'));
});

describe('isValidBroadcast', () => {
  it('accepts an ordinary message', () => {
    expect(isValidBroadcast('Doors at seven', 'Side entrance is locked.')).toBe(true);
  });

  // Whitespace is not a message. The database check constraint trims too,
  // so a client that let this through would produce a 23514 the member
  // could do nothing about.
  it('rejects a subject or body that is only whitespace', () => {
    expect(isValidBroadcast('   ', 'Body')).toBe(false);
    expect(isValidBroadcast('Subject', '  \n ')).toBe(false);
  });

  // The bounds match the constraints in 20260826030000 exactly. If they
  // drift, a member types a valid-looking message and the write fails.
  it('rejects anything past the stored limits', () => {
    expect(isValidBroadcast('x'.repeat(SUBJECT_MAX), 'Body')).toBe(true);
    expect(isValidBroadcast('x'.repeat(SUBJECT_MAX + 1), 'Body')).toBe(false);
    expect(isValidBroadcast('Subject', 'x'.repeat(BODY_MAX))).toBe(true);
    expect(isValidBroadcast('Subject', 'x'.repeat(BODY_MAX + 1))).toBe(false);
  });
});

describe('fetchBroadcasts', () => {
  it('returns the club history newest first', async () => {
    orderAfterEq.mockResolvedValue({
      data: [{ id: 'b1', club_id: 'c1', event_id: null, subject: 'Hi',
               body: 'There', recipient_count: 4,
               created_at: '2026-09-01T10:00:00Z' }],
      error: null,
    });
    const result = await fetchBroadcasts('c1');
    expect(result).toHaveLength(1);
    expect(orderAfterEq).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  // Never rejects: the history screen awaits this directly and an escaping
  // rejection would strand it on a spinner.
  it('resolves null when the read fails', async () => {
    orderAfterEq.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(fetchBroadcasts('c1')).resolves.toBeNull();
  });

  it('resolves null when the network is gone', async () => {
    await expect(fetchBroadcasts('c1')).resolves.toBeNull();
  });
});

describe('countBroadcastRecipients', () => {
  it('asks the database rather than counting locally', async () => {
    rpc.mockResolvedValue({ data: 14, error: null });
    await expect(countBroadcastRecipients('c1', null)).resolves.toBe(14);
    expect(rpc).toHaveBeenCalledWith('broadcast_recipient_count', {
      target_club: 'c1',
      target_event: null,
    });
  });

  it('resolves null rather than guessing when it cannot ask', async () => {
    await expect(countBroadcastRecipients('c1', 'e1')).resolves.toBeNull();
  });
});

describe('sendBroadcast', () => {
  it('returns the new broadcast id', async () => {
    rpc.mockResolvedValue({ data: 'b-new', error: null });
    await expect(
      sendBroadcast('c1', null, 'Doors at seven', 'Side entrance is locked.'),
    ).resolves.toEqual({ id: 'b-new', error: null });
  });

  // A refusal from assert_club_organizer must reach the member as words,
  // not as a silent no-op that looks like it worked.
  it('surfaces a refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not an organizer' } });
    const result = await sendBroadcast('c1', null, 'Subject', 'Body');
    expect(result.id).toBeNull();
    expect(result.error).toBe('not an organizer');
  });

  it('reports a generic failure rather than rejecting', async () => {
    const result = await sendBroadcast('c1', null, 'Subject', 'Body');
    expect(result).toEqual({ id: null, error: GENERIC_ERROR });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- lib/broadcasts
```

Expected: FAIL — `Failed to resolve import "./broadcasts"`.

- [ ] **Step 3: Write the module**

Create `lib/broadcasts.ts`:

```ts
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type Broadcast = {
  id: string;
  club_id: string;
  // Null means the whole roster; a uuid means that event's booked members.
  event_id: string | null;
  subject: string;
  body: string;
  recipient_count: number;
  created_at: string;
};

/**
 * Named once so lib/schema-contract.test.ts can assert the database really
 * answers with the shape `Broadcast` claims. Plan 1's Critical 1 — a `time`
 * column arriving as `21:00:00` where the client assumed `21:00` — was
 * invisible to both suites precisely because nothing crossed this boundary.
 */
export const BROADCAST_COLUMNS =
  'id, club_id, event_id, subject, body, recipient_count, created_at';

/**
 * These match the check constraints in 20260826030000 exactly. Drift here
 * means a member types a message the screen accepts and the database
 * rejects with a 23514 they can do nothing about.
 */
export const SUBJECT_MAX = 120;
export const BODY_MAX = 2000;

export function isValidBroadcast(subject: string, body: string): boolean {
  const s = subject.trim();
  const b = body.trim();
  return s.length > 0 && s.length <= SUBJECT_MAX
      && b.length > 0 && b.length <= BODY_MAX;
}

/**
 * Never rejects — the history screen awaits this directly, and an escaping
 * rejection would leave it spinning with no message. Same contract as
 * fetchProfile in lib/profile.ts.
 */
export async function fetchBroadcasts(clubId: string): Promise<Broadcast[] | null> {
  try {
    const { data, error } = await supabase
      .from('broadcasts')
      .select(BROADCAST_COLUMNS)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('fetchBroadcasts failed', error);
      return null;
    }
    return (data ?? []) as Broadcast[];
  } catch (cause) {
    console.error('fetchBroadcasts failed', cause);
    return null;
  }
}

/**
 * Asked of the database rather than counted from a locally-held roster.
 * The compose screen shows this number in a confirmation before sending,
 * and a count derived from stale client state would make that confirmation
 * a lie. `broadcast_recipient_count` and `send_broadcast` resolve their
 * recipients through the same function, so they cannot disagree.
 *
 * Resolves null on failure rather than 0: "this goes to 0 members" is a
 * statement, and a failed count has nothing to say.
 */
export async function countBroadcastRecipients(
  clubId: string,
  eventId: string | null,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('broadcast_recipient_count', {
      target_club: clubId,
      target_event: eventId,
    });
    if (error) {
      console.error('countBroadcastRecipients failed', error);
      return null;
    }
    return typeof data === 'number' ? data : null;
  } catch (cause) {
    console.error('countBroadcastRecipients failed', cause);
    return null;
  }
}

export async function sendBroadcast(
  clubId: string,
  eventId: string | null,
  subject: string,
  body: string,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('send_broadcast', {
      target_club: clubId,
      target_event: eventId,
      p_subject: subject.trim(),
      p_body: body.trim(),
    });
    // The refusal from assert_club_organizer arrives here. Surfaced as
    // words rather than swallowed — a silent failure on a send button
    // reads as success to the person who pressed it.
    if (error) return { id: null, error: error.message };
    return { id: (data as string) ?? null, error: null };
  } catch (cause) {
    console.error('sendBroadcast failed', cause);
    return { id: null, error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- lib/broadcasts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/broadcasts.ts lib/broadcasts.test.ts
git commit -m "feat: give the client a way to write to the room"
```

---

## Task 13: The compose screen

**Files:**
- Create: `app/clubs/[id]/broadcast.tsx`
- Modify: `components/TextField.tsx`
- Test: `app/__tests__/broadcast.test.tsx`
- Test: `components/__tests__/TextField.test.tsx`

**Interfaces:**
- Consumes: everything from `lib/broadcasts` (Task 12); `useSession` from `lib/session`; `Screen`, `Card`, `Button`, `TextField`, `ErrorBanner` from `components/`.
- Produces: the route `/clubs/[id]/broadcast`, accepting an optional `eventId` search parameter. Task 14 links to both forms.
- Modifies: `TextField` gains an optional `rows?: number` prop. Existing call sites are untouched — omitting it keeps the current 58px pill exactly.

- [ ] **Step 1: Write the failing test for the taller field**

Create `components/__tests__/TextField.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TextField from '../TextField';

describe('TextField', () => {
  it('renders a single-line pill by default', () => {
    render(<TextField label="Subject" value="" onChangeText={() => {}} />);
    const input = screen.getByLabelText('Subject');
    expect(input.tagName.toLowerCase()).toBe('input');
  });

  // A 2000-character broadcast body in a 58px pill is unusable. `rows`
  // switches to a textarea sized to fit, and is the only way to get one —
  // the component omits `style` from its props on purpose.
  it('renders a sized textarea when asked for rows', () => {
    render(<TextField label="Message" rows={6} value="" onChangeText={() => {}} />);
    const input = screen.getByLabelText('Message');
    expect(input.tagName.toLowerCase()).toBe('textarea');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- components/__tests__/TextField
```

Expected: FAIL — the second case renders an `input`, not a `textarea`.

- [ ] **Step 3: Add `rows` to TextField**

In `components/TextField.tsx`, replace the props type and the component body:

```tsx
type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /**
   * Turns the field into a multi-line box that many rows tall. Omit it and
   * nothing changes — every existing call site keeps the 58px pill.
   *
   * This exists because the component deliberately omits `style` from its
   * props, so a caller with a 2000-character message to collect has no
   * other way to ask for room.
   */
  rows?: number;
};

export default function TextField({ label, rows, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={rows ? [styles.input, styles.multiline, { height: rows * 24 + 24 }] : styles.input}
        placeholderTextColor={colors.textMuted}
        cursorColor={colors.accentColor}
        selectionColor={colors.accentColor}
        multiline={rows ? true : undefined}
        numberOfLines={rows}
        {...inputProps}
      />
    </View>
  );
}
```

And add to the `StyleSheet.create` block:

```tsx
  multiline: {
    // The pill is centred for one line of text; a paragraph has to start
    // at the top or the first line floats in the middle of the box.
    textAlignVertical: 'top',
    paddingTop: space[3],
    paddingBottom: space[3],
    borderRadius: radius.lg,
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- components/__tests__/TextField
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test for the screen**

Create `app/__tests__/broadcast.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Broadcast from '../clubs/[id]/broadcast';

const push = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: { id: 'c1' } as Record<string, string> }));

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn() }),
  useLocalSearchParams: () => params.current,
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const countBroadcastRecipients = vi.hoisted(() => vi.fn(async () => 14));
const sendBroadcast = vi.hoisted(() => vi.fn(async () => ({ id: 'b1', error: null })));

vi.mock('../../lib/broadcasts', async () => {
  const actual = await vi.importActual<typeof import('../../lib/broadcasts')>(
    '../../lib/broadcasts',
  );
  return { ...actual, countBroadcastRecipients, sendBroadcast };
});

async function compose(subject: string, body: string) {
  render(<Broadcast />);
  await screen.findByLabelText('Subject');
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: body } });
}

describe('broadcast compose screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params.current = { id: 'c1' };
    countBroadcastRecipients.mockResolvedValue(14);
    sendBroadcast.mockResolvedValue({ id: 'b1', error: null });
  });

  // The count is the thing that makes the confirmation meaningful. "Send
  // this?" is a different question from "send this to 14 people?".
  it('says how many people this reaches before anything is sent', async () => {
    render(<Broadcast />);
    expect(await screen.findByText(/14 members/)).toBeTruthy();
  });

  it('reaches only the booked when it is scoped to a game', async () => {
    params.current = { id: 'c1', eventId: 'e1' };
    render(<Broadcast />);
    await waitFor(() =>
      expect(countBroadcastRecipients).toHaveBeenCalledWith('c1', 'e1'),
    );
  });

  // A broadcast is irreversible and outward-facing. One tap must not send.
  it('does not send on the first tap', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByLabelText('Yes, send it')).toBeTruthy());
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  it('sends once confirmed', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() =>
      expect(sendBroadcast).toHaveBeenCalledWith(
        'c1', null, 'Doors at seven', 'The side entrance is locked.',
      ),
    );
  });

  it('goes to the sent history afterwards', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/clubs/c1/broadcasts'));
  });

  // An empty message must not be sendable at all — the check constraint
  // would reject it with an error nobody can act on.
  it('will not send an empty message', async () => {
    await compose('', '');
    expect(screen.getByLabelText('Send').getAttribute('aria-disabled')).toBe('true');
  });

  // A refusal must reach the member as words. The defect this guards
  // against is a send button that silently does nothing.
  it('shows a refusal rather than swallowing it', async () => {
    sendBroadcast.mockResolvedValue({ id: null, error: 'not an organizer' });
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    expect(await screen.findByText('not an organizer')).toBeTruthy();
  });

  it('lets the member back out of the confirmation', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Keep editing'));
    await waitFor(() => expect(screen.queryByLabelText('Yes, send it')).toBeNull());
    expect(sendBroadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npm test -- app/__tests__/broadcast
```

Expected: FAIL — `Failed to resolve import "../clubs/[id]/broadcast"`.

- [ ] **Step 7: Write the screen**

Create `app/clubs/[id]/broadcast.tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import {
  BODY_MAX,
  SUBJECT_MAX,
  countBroadcastRecipients,
  isValidBroadcast,
  sendBroadcast,
} from '../../../lib/broadcasts';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function Broadcast() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { id, eventId } = useLocalSearchParams<{ id?: string; eventId?: string }>();
  const clubId = id ?? '';
  // The route parameter arrives as a string or not at all; the RPC wants
  // null for "the whole roster", and undefined would be sent as missing.
  const targetEvent = eventId ?? null;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    countBroadcastRecipients(clubId, targetEvent).then((count) => {
      if (!cancelled) setRecipients(count);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, targetEvent]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  const valid = isValidBroadcast(subject, body);

  async function onConfirmedSend() {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const { error: sendError } = await sendBroadcast(
        clubId, targetEvent, subject, body,
      );
      if (sendError) {
        // Back to the form with the words. A refusal that closed the
        // confirmation and did nothing else would read as success.
        setConfirming(false);
        setError(sendError);
        return;
      }
      router.push(`/clubs/${clubId}/broadcasts`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push(`/clubs/${clubId}`)}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        Club
      </Button>

      <Text style={styles.heading}>
        {targetEvent ? 'Message everyone booked' : 'Message members'}
      </Text>

      <Card>
        <Text style={styles.help}>
          {recipients === null
            ? 'Working out who this reaches…'
            : recipients === 1
              ? 'This goes to 1 member, by email.'
              : `This goes to ${recipients} members, by email.`}
        </Text>
      </Card>

      <TextField
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        maxLength={SUBJECT_MAX}
        accessibilityLabel="Subject"
      />
      <TextField
        label="Message"
        value={body}
        onChangeText={setBody}
        maxLength={BODY_MAX}
        rows={6}
        accessibilityLabel="Message"
      />

      {error ? <ErrorBanner message={error} /> : null}

      {confirming ? (
        // A broadcast is irreversible and lands in other people's inboxes.
        // The second tap is the whole point of this block.
        <Card style={styles.confirmCard}>
          <Text style={styles.confirmText}>
            {recipients === 1
              ? 'Send this to 1 member?'
              : `Send this to ${recipients ?? 'the'} members?`}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="primary"
              onPress={onConfirmedSend}
              disabled={sending}
              loading={sending}
              accessibilityLabel="Yes, send it"
            >
              Yes, send it
            </Button>
            <Button
              variant="secondary"
              onPress={() => setConfirming(false)}
              disabled={sending}
              accessibilityLabel="Keep editing"
            >
              Keep editing
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          variant="primary"
          block
          onPress={() => setConfirming(true)}
          disabled={!valid}
          accessibilityLabel="Send"
        >
          Send
        </Button>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
  confirmCard: { padding: space[4], gap: space[3] },
  confirmText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  confirmActions: { gap: space[2] },
});
```

- [ ] **Step 8: Run test to verify it passes**

```bash
npm test -- app/__tests__/broadcast components/__tests__/TextField
```

Expected: PASS, 10 tests.

- [ ] **Step 9: Commit**

```bash
git add app/clubs/\[id\]/broadcast.tsx components/TextField.tsx app/__tests__/broadcast.test.tsx components/__tests__/TextField.test.tsx
git commit -m "feat: let a host write to the room, and ask before it goes"
```

---

## Task 14: Sent history, and the two ways in

**Files:**
- Create: `app/clubs/[id]/broadcasts.tsx`
- Modify: `app/clubs/[id]/index.tsx`
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Test: `app/__tests__/broadcasts-history.test.tsx`

**Interfaces:**
- Consumes: `fetchBroadcasts` (Task 12); the compose route (Task 13).
- Produces: the route `/clubs/[id]/broadcasts`. Two organizer-gated entry points reach the compose screen: **Message members** on the club screen (`/clubs/[id]/broadcast`) and **Message everyone booked** on the event screen (`/clubs/[id]/broadcast?eventId=<id>`).

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/broadcasts-history.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BroadcastHistory from '../clubs/[id]/broadcasts';

const push = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchBroadcasts = vi.hoisted(() => vi.fn());

vi.mock('../../lib/broadcasts', () => ({ fetchBroadcasts }));

describe('broadcast history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBroadcasts.mockResolvedValue([
      { id: 'b1', club_id: 'c1', event_id: null, subject: 'Doors at seven',
        body: 'Side entrance is locked.', recipient_count: 14,
        created_at: '2026-09-01T14:00:00Z' },
    ]);
  });

  // The first question after mailing fifty people is whether it went.
  it('says what was sent and how many it reached', async () => {
    render(<BroadcastHistory />);
    expect(await screen.findByText('Doors at seven')).toBeTruthy();
    expect(screen.getByText(/14 members/)).toBeTruthy();
  });

  it('offers an empty state rather than a bare screen', async () => {
    fetchBroadcasts.mockResolvedValue([]);
    render(<BroadcastHistory />);
    expect(await screen.findByText(/haven't sent anything/i)).toBeTruthy();
  });

  // A failed read must not read as "you have sent nothing", which is a
  // different and alarming statement.
  it('distinguishes a failed read from an empty history', async () => {
    fetchBroadcasts.mockResolvedValue(null);
    render(<BroadcastHistory />);
    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
    expect(screen.queryByText(/haven't sent anything/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- app/__tests__/broadcasts-history
```

Expected: FAIL — `Failed to resolve import "../clubs/[id]/broadcasts"`.

- [ ] **Step 3: Write the history screen**

Create `app/clubs/[id]/broadcasts.tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import Screen from '../../../components/Screen';
import { ChevronLeftIcon } from '../../../components/icons';
import { fetchBroadcasts, type Broadcast } from '../../../lib/broadcasts';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function BroadcastHistory() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const clubId = id ?? '';

  const [sent, setSent] = useState<Broadcast[] | null>(null);
  // Distinguished from `sent === null` on purpose: "not loaded yet" and
  // "loaded and failed" look identical otherwise, and the screen would say
  // "you haven't sent anything" to a host whose read was denied.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    let cancelled = false;
    setReady(false);
    fetchBroadcasts(clubId).then((rows) => {
      if (cancelled) return;
      setSent(rows);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push(`/clubs/${clubId}`)}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        Club
      </Button>

      <Text style={styles.heading}>Sent messages</Text>

      {!ready ? (
        <ActivityIndicator />
      ) : sent === null ? (
        <Card>
          <Text style={styles.help}>We couldn't load what you've sent.</Text>
        </Card>
      ) : sent.length === 0 ? (
        <Card>
          <Text style={styles.help}>
            You haven't sent anything to this club yet.
          </Text>
        </Card>
      ) : (
        sent.map((message) => (
          <Card key={message.id} style={styles.item}>
            <Text style={styles.subject}>{message.subject}</Text>
            <Text style={styles.body}>{message.body}</Text>
            <Text style={styles.meta}>
              {message.recipient_count === 1
                ? 'Sent to 1 member'
                : `Sent to ${message.recipient_count} members`}
              {message.event_id ? ' booked into one game' : ''}
            </Text>
          </Card>
        ))
      )}

      <Button
        variant="secondary"
        onPress={() => router.push(`/clubs/${clubId}/broadcast`)}
        accessibilityLabel="Write another message"
      >
        Write another
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  item: { gap: space[2] },
  subject: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.text,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
  },
});
```

- [ ] **Step 4: Add the club-screen entry points**

In `app/clubs/[id]/index.tsx`, immediately after the existing `mayInvite` "Add a game" block (the `<Button ... accessibilityLabel="Add a game">` and its closing `) : null}`), add:

```tsx
      {mayInvite ? (
        <Button
          variant="secondary"
          onPress={() => router.push(`/clubs/${id}/broadcast`)}
          accessibilityLabel="Message members"
        >
          Message members
        </Button>
      ) : null}

      {mayInvite ? (
        <Button
          variant="ghost"
          big={false}
          onPress={() => router.push(`/clubs/${id}/broadcasts`)}
          accessibilityLabel="See sent messages"
        >
          Sent messages
        </Button>
      ) : null}
```

`mayInvite` is reused rather than recomputed for the reason the existing comment at `app/clubs/[id]/index.tsx:116` gives: it is exactly the host-or-co-organizer test `assert_club_organizer` enforces in SQL, so the UI and the database agree about who may do this instead of each deciding separately.

- [ ] **Step 5: Add the event-screen entry point**

In `app/clubs/[id]/events/[eventId]/index.tsx`, add this inside the existing `isOrganizer` host-controls block. The identifiers already exist in that file: `clubId` and `eventId` come from the `useLocalSearchParams` destructure at line 94, and `isOrganizer` is the `useState` at line 113, set from `canInvite(myRole.role)` at line 230 — the same host-or-co-organizer test `assert_club_organizer` enforces in SQL.

```tsx
        <Button
          variant="secondary"
          onPress={() =>
            router.push(`/clubs/${clubId}/broadcast?eventId=${eventId}`)
          }
          accessibilityLabel="Message everyone booked"
        >
          Message everyone booked
        </Button>
```

Do not introduce a second organizer boolean. That file's comment at line 69 records the reason: one derivation, so the UI and the database cannot drift about who may act.

- [ ] **Step 6: Run the full component suite**

```bash
npm test
```

Expected: PASS. The three new history cases join the existing suites, and the club and event screen suites still pass — the new buttons are additive and gated by an existing boolean.

- [ ] **Step 7: Commit**

```bash
git add app/clubs/\[id\]/broadcasts.tsx app/clubs/\[id\]/index.tsx app/clubs/\[id\]/events/\[eventId\]/index.tsx app/__tests__/broadcasts-history.test.tsx
git commit -m "feat: show a host what they sent, and give them two ways to send it"
```

---

## Task 15: Close the boundaries

Three suites in this repository exist to catch what the others structurally cannot: the schema contract crosses the DB-client boundary, the portable grants file guards privileges against the hosted project, and the visual suite catches what neither logic nor structure tests can see.

**Files:**
- Modify: `lib/schema-contract.test.ts`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Modify: `e2e/session.ts`
- Modify: `e2e/visual.spec.ts`
- Modify: `todo.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–14.
- Produces: no new interfaces. This task adds coverage across boundaries the per-task suites do not cross.

- [ ] **Step 1: Extend the grant matrix**

In `supabase/tests/database/portable/grants.test.sql`, raise the plan count by 12 and add:

```sql
-- The three new tables. TRUNCATE is not subject to RLS, so these are the
-- only assertions standing between a future `create table` and a member
-- who can empty the queue.
select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'TRUNCATE'),
  'authenticated cannot TRUNCATE broadcasts'
);
select ok(
  not has_table_privilege('authenticated', 'public.push_tokens', 'TRUNCATE'),
  'authenticated cannot TRUNCATE push_tokens'
);
select ok(
  not has_table_privilege('authenticated', 'public.app_config', 'TRUNCATE'),
  'authenticated cannot TRUNCATE app_config'
);

-- Broadcasts are written only through send_broadcast, which checks the
-- caller is an organizer. An insert privilege here would let any member
-- mail the whole club.
select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'INSERT'),
  'authenticated cannot INSERT broadcasts'
);

-- app_config holds the drain secret. Nothing but the postgres role that
-- runs the cron job has any business reading it.
select ok(
  not has_table_privilege('authenticated', 'public.app_config', 'SELECT'),
  'authenticated cannot read app_config'
);
select ok(
  not has_table_privilege('anon', 'public.app_config', 'SELECT'),
  'anon cannot read app_config'
);

/*
 * The four internal functions. `revoke ... from public` does NOT clear the
 * EXECUTE that Supabase's hosted bootstrap grants `authenticated` at
 * function-creation time — the gap retro-fixed in 20260823020000,
 * 20260823030000, 20260823060000 and 20260825061000, and invisible against
 * the local stack, which grants `authenticated` nothing by default. This is
 * a portable test for exactly that reason: it has to run against the hosted
 * project to mean anything.
 */
select ok(
  not has_function_privilege('authenticated',
    'public.claim_notification_batch(int)', 'EXECUTE'),
  'authenticated cannot claim the notification queue'
);
select ok(
  not has_function_privilege('authenticated',
    'public.mark_notifications_sent(uuid[])', 'EXECUTE'),
  'authenticated cannot mark notifications sent'
);
select ok(
  not has_function_privilege('authenticated',
    'public.mark_notifications_failed(uuid, text)', 'EXECUTE'),
  'authenticated cannot mark notifications failed'
);
select ok(
  not has_function_privilege('authenticated',
    'public.queue_event_reminders()', 'EXECUTE'),
  'authenticated cannot run the reminder job'
);
select ok(
  not has_function_privilege('authenticated',
    'public.broadcast_recipients(uuid, uuid)', 'EXECUTE'),
  'authenticated cannot enumerate a roster through the fan-out helper'
);

-- The positive case, so this block cannot pass by revoking everything.
select ok(
  has_function_privilege('authenticated',
    'public.send_broadcast(uuid, uuid, text, text)', 'EXECUTE'),
  'authenticated can call send_broadcast, which checks the caller itself'
);
```

- [ ] **Step 2: Run the portable suite**

```bash
npm run test:db
```

Expected: PASS, including the raised plan count in `grants.test.sql`.

- [ ] **Step 3: Cross the client boundary for broadcasts**

In `lib/schema-contract.test.ts`, add `BROADCAST_COLUMNS` and `fetchBroadcasts` to the imports from `./broadcasts`, and add a describe block following the file's existing pattern — seed a club, a host membership, and a broadcast row through the service-role client, sign the host in through `supabase-js`, then:

```ts
describe('broadcasts', () => {
  it('answers with the shape lib/broadcasts.ts claims', async () => {
    const rows = await fetchBroadcasts(clubId);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);

    const [row] = rows!;
    // Every field the type declares, with the type it declares. This is
    // the boundary Critical 1 lived in: both suites were green while
    // `quiet_hours_start` arrived as "21:00:00" and the client expected
    // "21:00", because neither suite crossed it.
    expect(typeof row.id).toBe('string');
    expect(typeof row.club_id).toBe('string');
    expect(row.event_id).toBeNull();
    expect(typeof row.subject).toBe('string');
    expect(typeof row.body).toBe('string');
    // int4, not a numeric arriving as a string.
    expect(typeof row.recipient_count).toBe('number');
    expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
  });

  it('selects every column the type declares and no others', () => {
    const declared = BROADCAST_COLUMNS.split(',').map((c) => c.trim()).sort();
    expect(declared).toEqual([
      'body', 'club_id', 'created_at', 'event_id', 'id',
      'recipient_count', 'subject',
    ]);
  });
});
```

- [ ] **Step 4: Run the contract suite**

```bash
npm run test:contract
```

Expected: PASS. Requires the local stack.

- [ ] **Step 5: Add visual baselines**

In `e2e/session.ts`, extend `seedClubWithEvent` to also insert one broadcast for the seeded club through the admin client, and return its id alongside the existing ids, following the shape the function already returns.

In `e2e/visual.spec.ts`, add two tests following the existing pattern — one per screen, each at both viewports:

```ts
test('broadcast compose at %s', async ({ page }) => {
  // Anchor on the recipient count before screenshotting. The count is
  // fetched after mount, so a screenshot taken on first paint catches
  // "Working out who this reaches…" and the baseline becomes a race.
  await page.goto(`/clubs/${clubId}/broadcast`);
  await expect(page.getByText(/goes to \d+ member/)).toBeVisible();
  await expect(page).toHaveScreenshot(`broadcast-compose-${name}.png`);
});

test('broadcast history at %s', async ({ page }) => {
  await page.goto(`/clubs/${clubId}/broadcasts`);
  await expect(page.getByText('Doors at seven')).toBeVisible();
  await expect(page).toHaveScreenshot(`broadcast-history-${name}.png`);
});
```

Match the surrounding file's exact parameterisation over `WIDTHS`, its font-ready wait, and its `SCROLLER` handling rather than the sketch above — read the neighbouring tests first.

- [ ] **Step 6: Generate and eyeball the baselines**

```bash
npm run test:visual -- --update-snapshots
```

Then **look at** the four new PNGs in `e2e/visual.spec.ts-snapshots/`. A baseline is only worth having if it was correct when it was taken; an ugly screenshot committed as a baseline locks the ugliness in.

- [ ] **Step 7: Add the follow-ups to the TODO**

Append to the "Build" section of `todo.md`:

```markdown
### [ ] Turn push on

`push_tokens` and `resolve_notify_channel` exist and every branch of the
resolver returns `'email'`. Turning push on means: `expo-notifications` in
the client, token registration on sign-in, one `Sender` implementation
against Expo's push service, and the resolver's last line becoming
`return pref::text`. Nothing in the queue, the preferences, the quiet
hours, the retries or the templates changes.

Needs an EAS dev build before any of it can be verified — the current
suites are web-only and cannot reach a device delivery leg.

### [ ] Nothing ingests bounces

A hard bounce is invisible to the app: the SMTP relay knows and MahjHero
does not. A dead address burns five attempts over two and a half hours and
dead-letters, which is the right shape, but nobody is told and the address
stays on the account. Worth a webhook once there is enough volume for it
to matter.

### [ ] One email per notifiable moment, no digesting

A member whose group of four is cancelled by a host gets one email per
person. At club scale this is tolerable. It is the first thing to
reconsider if anybody complains about volume.
```

- [ ] **Step 8: Run everything**

```bash
npm test && npm run test:db && npm run test:visual
```

Expected: all three suites pass. This is the gate before the PR — do not report the plan complete on a partial run.

- [ ] **Step 9: Commit**

```bash
git add lib/schema-contract.test.ts supabase/tests/database/portable/grants.test.sql e2e/session.ts e2e/visual.spec.ts e2e/visual.spec.ts-snapshots todo.md
git commit -m "test: guard the boundaries the per-task suites cannot cross"
```

---

## Done

Open a PR against `main` titled **"Notifications and comms (V1 plan 6 of 6)"**, following the four merged plans before it.
