# Alerts: a real notification feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the feed in [docs/superpowers/specs/2026-09-02-alerts-feed-design.md](../specs/2026-09-02-alerts-feed-design.md) on branch `UI-tweaks`.

**Architecture:** Bottom-up — Task 1 lays the database access (a migration this session cannot apply or test locally), Task 2 the pure client rendering + RPC wrappers, Task 3 the unread hook, Task 4 the screen, Task 5 wires it into the tab bar.

**Tech Stack:** PostgreSQL/Supabase (migration, pgTAP), React Native (Expo Router) + TypeScript, Vitest + Testing Library.

## Global Constraints

- Run scoped TS tests with `npm test -- <path>` (`TZ=America/New_York vitest run`).
- **Task 1 is SQL only. There is no Docker/local Supabase in this environment — do not claim to have run `supabase test db`, `supabase db reset`, or any command that needs a running database. Verification for that task is careful static review only: match this repo's own established migration idioms exactly (quoted throughout this plan), and get a second pair of eyes via the task review, same as every other task, but the review itself must also be static — reading, not running.**
- Every pressable needs `accessibilityRole="button"` and an `accessibilityLabel`.
- A failed read resolves to an empty/zero value, never an error state or a thrown exception that reaches the UI — matching `fetchUnreadCounts`'s own contract ("a badge is an invitation, and there is nothing useful to say to somebody about a count we could not fetch").
- Every color/spacing/radius/font value comes from `lib/theme.ts`.

---

### Task 1: Migration — `notification_reads` table and three RPCs

**Files:**
- Create: a new migration file under `supabase/migrations/`, timestamped after the most recent existing migration (run `ls supabase/migrations/ | tail -5` to find the latest timestamp and pick the next one in the same `YYYYMMDDHHMMSS_description.sql` naming scheme this repo uses throughout).
- Create: `supabase/tests/database/fixtures/alerts_feed.test.sql`

**Interfaces:**
- Produces: `public.fetch_my_notifications()`, `public.mark_notifications_read()`, `public.my_notification_unread_count()` — three new RPCs, callable by any `authenticated` user, each scoped to `auth.uid()` internally. Task 2 calls all three by name via `supabase.rpc(...)`.

- [ ] **Step 1: Find the next migration timestamp**

Run: `ls supabase/migrations/ | tail -5`

Pick a timestamp later than the newest file listed, in the same `YYYYMMDDHHMMSS` format, and name the new file `<timestamp>_alerts_feed.sql`.

- [ ] **Step 2: Write the migration**

Create the new migration file with exactly this content:

```sql
/*
 * A real feed for the Alerts tab, reading notification_outbox for the
 * first time from the client side — see
 * docs/superpowers/specs/2026-09-02-alerts-feed-design.md for the full
 * rationale. notification_outbox itself is untouched: still no RLS
 * policy, still no grant to authenticated, exactly as
 * 20260825000000_create_bookings.sql built it. Every function below is
 * security definer, scoped to auth.uid() internally, the same shape
 * fetch_my_threads/my_unread_counts already use for "read your own X".
 */

-- One watermark per recipient, the same shape thread_reads already uses
-- for messages (20260829000000_message_threads.sql) — a single
-- last-read timestamp, not a per-notification read flag. Alerts has no
-- per-thread concept to key a row against.
create table public.notification_reads (
  recipient_id  uuid primary key references public.profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now()
);

alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;
grant select, insert, update on public.notification_reads to authenticated;

create policy notification_reads_own on public.notification_reads
  for all
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

/*
 * The feed's read path. Reuses outbox_render_context
 * (20260826050000_outbox_render_context.sql) — the exact function
 * claim_notification_batch itself calls to render email/push — rather
 * than re-deriving its joins by hand: that function already carries the
 * tested logic for which payload key names which actor, the
 * event_cancelled starts_at fallback for a deleted occurrence, and the
 * text-cast comparisons that keep one oddly-shaped row from poisoning a
 * whole batch. security definer privileges are what let this call
 * outbox_render_context despite that function's own
 * revoke ... from public, anon, authenticated — the same mechanism
 * claim_notification_batch already relies on.
 *
 * Shown regardless of delivery outcome (no sent_at/failed_at/expired_at
 * filter) — the feed is the reliable fallback if push or email ever
 * failed to reach someone. recipient_id/recipient_name/recipient_email/
 * channel are dropped from the returned columns: those exist in
 * outbox_render_context for email delivery specifically, and the client
 * already knows who it is.
 */
create function public.fetch_my_notifications()
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
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
  select ctx.id, ctx.kind, ctx.payload, ctx.club_id, ctx.club_name,
         ctx.event_id, ctx.event_title, ctx.event_starts_at,
         ctx.club_timezone, ctx.table_label, ctx.actor_name,
         ctx.broadcast_subject, ctx.broadcast_body, ctx.created_at
    from public.outbox_render_context(
           array(
             select o.id
               from public.notification_outbox o
              where o.recipient_id = (select auth.uid())
              order by o.created_at desc
              limit 50
           )
         ) ctx
   order by ctx.created_at desc;
$$;

revoke execute on function public.fetch_my_notifications()
  from public, anon;
grant execute on function public.fetch_my_notifications()
  to authenticated;

-- The write path, an upsert on the one watermark row -- same shape as
-- mark_thread_read (20260829040000_post_message.sql).
create function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.notification_reads (recipient_id, last_read_at)
  values (caller, now())
  on conflict (recipient_id)
  do update set last_read_at = now();
end;
$$;

revoke execute on function public.mark_notifications_read()
  from public, anon;
grant execute on function public.mark_notifications_read()
  to authenticated;

/*
 * Feeds the TabBar badge, live rather than cached -- same reasoning
 * my_unread_counts already documents for messages: "so the badges and
 * the list cannot disagree." Counted against the full table, not capped
 * to the 50 the feed shows -- a member away long enough to have more
 * than 50 unread sees a badge larger than the visible list, which is
 * honest rather than silently wrong.
 */
create function public.my_notification_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notification_outbox o
    left join public.notification_reads r
           on r.recipient_id = o.recipient_id
   where o.recipient_id = (select auth.uid())
     and o.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz);
$$;

revoke execute on function public.my_notification_unread_count()
  from public, anon;
grant execute on function public.my_notification_unread_count()
  to authenticated;
```

- [ ] **Step 3: Write the pgTAP test fixture**

Create `supabase/tests/database/fixtures/alerts_feed.test.sql`. Follow the exact structural conventions already established in `supabase/tests/database/fixtures/thread_reads_api.test.sql` and its siblings: `begin;` / `set local search_path to extensions, public;` / `select plan(N);` at the top, seeded fixture data with clearly-named UUIDs and a comment explaining the scenario, one `select ok(...)`/`select is(...)` per assertion, `select * from finish();` / `rollback;` at the end. Cover:

1. A signed-in member with two `notification_outbox` rows (e.g. one `booked_by_friend`, one `broadcast`) sees both from `fetch_my_notifications()`, most recent first.
2. A member sees ONLY their own rows — seed a second member with their own outbox row and assert it does not appear in the first member's `fetch_my_notifications()` result.
3. `my_notification_unread_count()` returns the full count before any read; returns 0 immediately after calling `mark_notifications_read()`; a new outbox row created after that call is counted again.
4. `fetch_my_notifications()` includes a row regardless of `sent_at`/`failed_at`/`expired_at` — seed one of each state and assert all three still appear.
5. Calling the RPCs with no session (`auth.uid()` null, if this repo's existing pgTAP tests have an established way to simulate that — check `thread_reads_api.test.sql` or a similar file for the pattern) is refused / returns nothing rather than another user's data. If no other test file in this repo exercises the "no session" case for a `security definer` function this way, skip this one assertion rather than inventing an untested technique — note in a comment why.

Read `supabase/tests/database/fixtures/thread_reads_api.test.sql` in full before writing this file, and match its idioms (UUID naming scheme, `insert into auth.users`/`update public.profiles` pairing, comment style) as closely as possible.

- [ ] **Step 4: Static self-review (no execution)**

Re-read the full migration file once, end to end, checking specifically for:
- Every `create function` has a matching `revoke`/`grant` pair, in that order, matching every other function in this schema.
- Every column name in `fetch_my_notifications`'s `returns table (...)` appears in its `select` list, in the same order.
- The `notification_reads_own` policy's `using`/`with check` both reference `recipient_id = (select auth.uid())`, matching `push_tokens_own`'s exact idiom (`20260826020000_push_tokens.sql`).
- No trailing commas, matching parens, semicolons on every statement — a plain read-through, not a syntax checker (none is available without Docker).

Do NOT attempt to apply this migration, run `supabase db reset`, `supabase test db`, or any command requiring a running database. State plainly in your report that this task's verification is static-review-only.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_alerts_feed.sql supabase/tests/database/fixtures/alerts_feed.test.sql
git commit -m "feat(alerts): add notification_reads and the three feed RPCs

Read-only reuse of outbox_render_context's existing join logic, scoped to
auth.uid() the same way every other 'read your own X' RPC in this schema
already works. notification_outbox itself is untouched -- still no RLS
policy, still no grant to authenticated.

Not applied or tested locally -- no Docker in this environment. Verified
by static review only; the accompanying pgTAP fixture needs a real run
before merge."
```

---

### Task 2: `lib/notifications.ts` — types, RPC wrappers, per-kind rendering

**Files:**
- Create: `lib/notifications.ts`
- Create: `lib/notifications.test.ts`

**Interfaces:**
- Produces: `NotificationRow` (type), `OutboxKind` (type, the same 12-value union `supabase/functions/deliver-notifications/types.ts` already defines — do not import across the Deno/Node boundary, redeclare it), `fetchMyNotifications(): Promise<NotificationRow[] | null>`, `markNotificationsRead(): Promise<{ error: string | null }>`, `fetchNotificationUnreadCount(): Promise<number>`, `describeNotification(row: NotificationRow): { headline: string; detail: string; href: string }`.
- Consumes (Task 3, 4): all of the above.

- [ ] **Step 1: Write the failing tests first**

Create `lib/notifications.test.ts`. `describeNotification` is a pure function — test it directly, one case per `kind`, no mocking needed. Use this base fixture and vary only what each case needs:

```ts
import { describe, expect, it, vi } from 'vitest';
import { describeNotification } from './notifications';
import type { NotificationRow } from './notifications';

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n1',
    kind: 'booked_by_friend',
    payload: {},
    club_id: 'club-1',
    club_name: 'Riverside Mah Jongg',
    event_id: 'event-1',
    event_title: 'Thursday Mahjong',
    event_starts_at: '2026-09-03T23:00:00.000Z',
    club_timezone: 'America/New_York',
    table_label: null,
    actor_name: null,
    broadcast_subject: null,
    broadcast_body: null,
    created_at: '2026-09-01T12:00:00.000Z',
    ...over,
  };
}

describe('describeNotification', () => {
  it('booked_by_friend: names who booked you in, and where', () => {
    const result = describeNotification(row({ kind: 'booked_by_friend', actor_name: 'Ada' }));
    expect(result.headline).toBe('You have a seat');
    expect(result.detail).toContain('Ada booked you in for');
    expect(result.href).toBe('/clubs/club-1/events/event-1');
  });

  it('booked_by_friend: falls back to "Someone" with no actor name', () => {
    const result = describeNotification(row({ kind: 'booked_by_friend', actor_name: null }));
    expect(result.detail).toContain('Someone booked you in for');
  });

  it('booking_declined', () => {
    const result = describeNotification(row({ kind: 'booking_declined', actor_name: 'Ben' }));
    expect(result.headline).toBe('A seat came free');
    expect(result.detail).toContain('Ben declined the seat');
  });

  it('booking_cancelled_by_host', () => {
    const result = describeNotification(row({ kind: 'booking_cancelled_by_host', actor_name: 'Cara' }));
    expect(result.headline).toBe('Your seat was cancelled');
    expect(result.detail).toContain('Cara cancelled your seat');
  });

  it('waitlist_promoted: includes the table when there is one', () => {
    const result = describeNotification(
      row({ kind: 'waitlist_promoted', table_label: 'Table 2' }),
    );
    expect(result.headline).toBe('You have a seat');
    expect(result.detail).toContain('at Table 2');
  });

  it('promotion_offer', () => {
    const result = describeNotification(row({ kind: 'promotion_offer' }));
    expect(result.headline).toBe('A seat is yours if you want it');
    expect(result.detail).toContain('Held for two hours');
  });

  it('promotion_offer_expired', () => {
    const result = describeNotification(row({ kind: 'promotion_offer_expired' }));
    expect(result.headline).toBe('That seat has gone');
  });

  it('unseated', () => {
    const result = describeNotification(row({ kind: 'unseated' }));
    expect(result.headline).toBe('You lost your seat');
  });

  it('event_cancelled: links to the club, not the (gone) event', () => {
    const result = describeNotification(
      row({ kind: 'event_cancelled', event_id: null }),
    );
    expect(result.headline).toBe('The game is off');
    expect(result.href).toBe('/clubs/club-1');
  });

  it('need_a_fourth: falls back to "A table" with none named', () => {
    const result = describeNotification(
      row({ kind: 'need_a_fourth', table_label: null }),
    );
    expect(result.headline).toBe('They need a fourth');
    expect(result.detail).toContain('A table at');
  });

  it('event_reminder: says "Tomorrow" for a day-ahead offset', () => {
    const result = describeNotification(
      row({ kind: 'event_reminder', payload: { offset_minutes: 1440 } }),
    );
    expect(result.headline).toBe('Tomorrow');
  });

  it('event_reminder: says "Starting soon" for a same-day offset', () => {
    const result = describeNotification(
      row({ kind: 'event_reminder', payload: { offset_minutes: 120 } }),
    );
    expect(result.headline).toBe('Starting soon');
  });

  it('broadcast: uses the subject as the headline', () => {
    const result = describeNotification(
      row({
        kind: 'broadcast',
        broadcast_subject: 'Court closed Saturday',
        broadcast_body: 'The usual room is unavailable this weekend.\n\nSee you Sunday instead.',
      }),
    );
    expect(result.headline).toBe('Court closed Saturday');
    expect(result.detail).toBe('The usual room is unavailable this weekend.');
  });

  it('broadcast: falls back to a club-named headline with no subject', () => {
    const result = describeNotification(
      row({ kind: 'broadcast', broadcast_subject: null, broadcast_body: null }),
    );
    expect(result.headline).toBe('A message from Riverside Mah Jongg');
  });

  it('attendance_declined', () => {
    const result = describeNotification(
      row({ kind: 'attendance_declined', actor_name: 'Dev' }),
    );
    expect(result.headline).toBe('Someone is not coming');
    expect(result.detail).toContain("Dev says they can't make");
  });
});

vi.mock('./supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from './supabase';
import { fetchMyNotifications, markNotificationsRead, fetchNotificationUnreadCount } from './notifications';

describe('fetchMyNotifications', () => {
  it('returns the rows on success', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: [row()], error: null } as never);
    expect(await fetchMyNotifications()).toEqual([row()]);
  });

  it('resolves to null on failure rather than throwing', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    expect(await fetchMyNotifications()).toBeNull();
  });
});

describe('fetchNotificationUnreadCount', () => {
  it('returns the count on success', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: 3, error: null } as never);
    expect(await fetchNotificationUnreadCount()).toBe(3);
  });

  it('resolves to 0 on failure', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    expect(await fetchNotificationUnreadCount()).toBe(0);
  });
});

describe('markNotificationsRead', () => {
  it('reports no error on success', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: null } as never);
    expect(await markNotificationsRead()).toEqual({ error: null });
  });

  it('relays the refusal on failure', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    const { error } = await markNotificationsRead();
    expect(error).toBeTruthy();
  });
});
```

Before writing this, check `lib/supabase.ts`'s actual export shape and how another `lib/*.test.ts` file in this repo mocks it (e.g. `lib/clubs.test.ts` or `lib/bookings.test.ts`) — match that exact mocking pattern rather than the sketch above if it differs (the sketch assumes a named `supabase` export with an `rpc` method, which matches `lib/messages.ts`'s own usage of `supabase.rpc('my_unread_counts')`, but confirm the test-mocking convention this repo actually uses before finalizing).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/notifications.test.ts`
Expected: FAIL — `Cannot find module './notifications'`

- [ ] **Step 3: Write `lib/notifications.ts`**

```ts
import { formatEventWhen } from './events';
import { supabase } from './supabase';

/** Mirrors supabase/functions/deliver-notifications/types.ts's OutboxKind
 *  exactly -- can't be imported across the Deno/Node boundary, so this is
 *  a deliberate, parallel redeclaration, not a drift risk in practice: the
 *  enum is stable schema, not something either side edits casually. */
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
  | 'attendance_declined';

/** One row of fetch_my_notifications() -- the RPC's own returns table (...)
 *  shape, column for column. */
export type NotificationRow = {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  club_id: string;
  club_name: string;
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

export async function fetchMyNotifications(): Promise<NotificationRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_my_notifications');
    if (error) {
      console.error('fetchMyNotifications failed', error);
      return null;
    }
    return (data ?? []) as NotificationRow[];
  } catch (cause) {
    console.error('fetchMyNotifications failed', cause);
    return null;
  }
}

export async function markNotificationsRead(): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('mark_notifications_read');
    if (error) {
      console.error('markNotificationsRead failed', error);
      return { error: error.message };
    }
    return { error: null };
  } catch (cause) {
    console.error('markNotificationsRead failed', cause);
    return { error: 'Something went wrong. Try again.' };
  }
}

export async function fetchNotificationUnreadCount(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('my_notification_unread_count');
    if (error) {
      console.error('fetchNotificationUnreadCount failed', error);
      return 0;
    }
    return typeof data === 'number' ? data : 0;
  } catch (cause) {
    console.error('fetchNotificationUnreadCount failed', cause);
    return 0;
  }
}

/**
 * A ported, condensed twin of supabase/functions/deliver-notifications/
 * templates/bodies.ts's bodyFor -- same 12 cases, same voice, collapsed
 * from email's headline+multi-paragraph+cta+footer shape into a single
 * headline + one detail line + a destination route, since a list row has
 * one line of space, not an email's. Every headline below is bodyFor's own
 * headline string verbatim, so a member sees the same words here they may
 * already have seen in a push/email.
 */
function game(row: NotificationRow): string {
  const title = row.event_title ?? 'the game';
  if (!row.event_starts_at) return title;
  return `${title} · ${formatEventWhen(row.event_starts_at, row.club_timezone)}`;
}

function at(row: NotificationRow): string {
  return row.table_label ? ` at ${row.table_label}` : '';
}

function actor(row: NotificationRow, fallback: string): string {
  return row.actor_name ?? fallback;
}

function href(row: NotificationRow): string {
  return row.event_id
    ? `/clubs/${row.club_id}/events/${row.event_id}`
    : `/clubs/${row.club_id}`;
}

function unhandledKind(kind: never): never {
  throw new Error(`describeNotification: unhandled kind: ${String(kind)}`);
}

export function describeNotification(
  row: NotificationRow,
): { headline: string; detail: string; href: string } {
  switch (row.kind) {
    case 'booked_by_friend':
      return {
        headline: 'You have a seat',
        detail: `${actor(row, 'Someone')} booked you in for ${game(row)}${at(row)}.`,
        href: href(row),
      };

    case 'booking_declined':
      return {
        headline: 'A seat came free',
        detail: `${actor(row, 'The person you booked for')} declined the seat you booked for them at ${game(row)}.`,
        href: href(row),
      };

    case 'booking_cancelled_by_host':
      return {
        headline: 'Your seat was cancelled',
        detail: `${actor(row, 'A host')} cancelled your seat at ${game(row)}.`,
        href: href(row),
      };

    case 'waitlist_promoted':
      return {
        headline: 'You have a seat',
        detail: `A seat opened up at ${game(row)} and you were next on the waitlist${at(row)}.`,
        href: href(row),
      };

    case 'promotion_offer':
      return {
        headline: 'A seat is yours if you want it',
        detail: `Room came free at ${game(row)}, and you were next. Held for two hours.`,
        href: href(row),
      };

    case 'promotion_offer_expired':
      return {
        headline: 'That seat has gone',
        detail: `The seat held for you at ${game(row)} wasn't taken in time. You're still on the waitlist.`,
        href: href(row),
      };

    case 'unseated':
      return {
        headline: 'You lost your seat',
        detail: `Your seat at ${game(row)} is no longer yours.`,
        href: href(row),
      };

    case 'event_cancelled':
      // Always the club, never the event -- matches bodyFor's own cta for
      // this kind (the occurrence is usually gone by the time this renders).
      return {
        headline: 'The game is off',
        detail: `${game(row)} has been cancelled. Your seat went with it.`,
        href: `/clubs/${row.club_id}`,
      };

    case 'need_a_fourth':
      return {
        headline: 'They need a fourth',
        detail: `${row.table_label ?? 'A table'} at ${game(row)} is three of four. Take the seat and they have a game.`,
        href: href(row),
      };

    case 'event_reminder': {
      const minutes = Number(row.payload.offset_minutes ?? 0);
      const dayAhead = minutes >= 1440;
      return {
        headline: dayAhead ? 'Tomorrow' : 'Starting soon',
        detail: `You have a seat at ${game(row)}${at(row)}.`,
        href: href(row),
      };
    }

    case 'broadcast': {
      const firstParagraph = (row.broadcast_body ?? '')
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .find((part) => part.length > 0);
      return {
        headline: row.broadcast_subject ?? `A message from ${row.club_name}`,
        detail: firstParagraph ?? 'Open it to read more.',
        href: href(row),
      };
    }

    case 'attendance_declined':
      return {
        headline: 'Someone is not coming',
        detail: `${actor(row, 'A member')} says they can't make ${game(row)}. Their seat is still theirs.`,
        href: href(row),
      };

    default:
      return unhandledKind(row.kind);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- lib/notifications.test.ts`
Expected: PASS (whole file)

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.ts lib/notifications.test.ts
git commit -m "feat(alerts): add lib/notifications.ts

RPC wrappers matching this repo's own fetch-resolves-to-empty-on-failure
contract, plus describeNotification -- a condensed, ported twin of
deliver-notifications' own bodyFor, same 12 cases and same voice."
```

---

### Task 3: `lib/use-notifications-unread.ts`

**Files:**
- Create: `lib/use-notifications-unread.ts`
- Create: `lib/use-notifications-unread.test.tsx`

**Interfaces:**
- Consumes: `fetchNotificationUnreadCount` from Task 2.
- Produces: `useNotificationsUnread(): number`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test first**

Create `lib/use-notifications-unread.test.tsx`, mirroring `lib/use-unread.test.tsx`'s exact structure (read that file first and match its mocking approach for `useFocusEffect`/`useSession`/the fetch function). Cover: resolves to 0 with no session; calls `fetchNotificationUnreadCount` and returns its result when signed in; resolves to 0 (not throwing) when the fetch itself fails.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/use-notifications-unread.test.tsx`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Write the hook**

```ts
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchNotificationUnreadCount } from './notifications';
import { useSession } from './session';

/**
 * The Alerts tab's own badge -- a live count, not cached, matching
 * lib/use-unread.ts's own reasoning for messages: refetched on focus
 * rather than held live (no realtime here either), and a failed fetch
 * resolves to zero rather than an error state, since a badge is an
 * invitation and there is nothing useful to say about a count that could
 * not be fetched.
 */
export function useNotificationsUnread(): number {
  const { session } = useSession();
  // Keyed on the user id, NOT on `session` -- see lib/use-unread.ts's
  // identical comment.
  const userId = session?.user.id;
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setCount(0);
        return;
      }
      let cancelled = false;

      void fetchNotificationUnreadCount().then((result) => {
        if (cancelled) return;
        setCount(result);
      });

      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  return count;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- lib/use-notifications-unread.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/use-notifications-unread.ts lib/use-notifications-unread.test.tsx
git commit -m "feat(alerts): add the Alerts tab's own unread-count hook

Mirrors lib/use-unread.ts's exact shape and failure contract."
```

---

### Task 4: `app/alerts.tsx` — the feed screen

**Files:**
- Create: `app/alerts.tsx`
- Create: `app/__tests__/alerts.test.tsx`

**Interfaces:**
- Consumes: `fetchMyNotifications`, `markNotificationsRead`, `describeNotification`, `NotificationRow` from Task 2.

- [ ] **Step 1: Read two reference files first**

Before writing tests or code, read `app/friends.tsx` (list rendering, avatar-circle style, empty-state card, back button — this screen is the closest existing shape to copy) and `app/messages/index.tsx` (the refetch-on-focus pattern for a list screen, and its `ErrorBanner`/loading-state handling). Match their established idioms rather than inventing new ones.

- [ ] **Step 2: Write the failing tests first**

Create `app/__tests__/alerts.test.tsx`. Follow `app/__tests__/friends.test.tsx`'s router-mock and session-mock setup exactly (module-level `push`, `usePathname` returning `/alerts`, `useFocusEffect` wrapped in a real `useEffect`). Mock `lib/notifications` the same way other screens mock their own `lib/*` module (spread `actual` for anything not being doubled, matching `app/friends.test.tsx`'s own `vi.mock('../../lib/friends', ...)` shape). Cover:

1. Shows a dashed empty-state card when `fetchMyNotifications()` resolves to `[]`.
2. Shows an error banner (not the empty state) when it resolves to `null` — these must not look the same to a member, matching this repo's established "null is 'could not ask', [] is 'genuinely nothing'" distinction used everywhere else (`app/messages/index.tsx`, `app/friends.tsx`).
3. Renders a row's headline and detail text for a populated list (use a `booked_by_friend` fixture row).
4. Tapping a row calls `router.push` with that row's `href`.
5. Calls `markNotificationsRead()` once the screen has loaded (assert it was called — don't assert timing beyond "called by the time the list is on screen").
6. Carries the tab bar with `active="alerts"`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- app/__tests__/alerts.test.tsx`
Expected: FAIL — `Cannot find module '../alerts'`

- [ ] **Step 4: Write the screen**

Build `app/alerts.tsx` following `app/friends.tsx`'s overall shape (imports, `useSession`/`loading`/`Redirect` guard, a `ready`/`error` state pair, `useFocusEffect` for the fetch, `Screen scroll` + `TabBar active="alerts"`). Concretely:

- Heading: plain `<Text style={styles.heading}>Alerts</Text>` — no back button (this is a genuine tab root, like Messages and the Club dashboard, not a screen pushed into from elsewhere).
- On focus: fetch via `fetchMyNotifications()`; on a non-null result, also fire-and-forget `markNotificationsRead()` (don't block the list render on it, and don't surface its own failure to the member — a failed read-mark just means the badge doesn't clear this time, not something worth an error banner over).
- Empty state: a dashed `View` card (`app/friends.tsx`'s `emptyCard`/`emptyText` styles are the exact pattern), shown only when the fetch resolved to a genuinely empty array (`rows !== null && rows.length === 0`).
- Error state: an `ErrorBanner` with `GENERIC_ERROR` (`lib/constants`) when the fetch resolved to `null`.
- Each row: a `Card` (or a `Pressable` wrapping one, matching `app/clubs/index.tsx`'s `GameRow` pattern for "the row itself is one press target") — `router.push(item.href)` on press, `accessibilityRole="button"`, `accessibilityLabel` composing the headline and detail (same reasoning as every other list row in this app: `accessibilityLabel` replaces the computed name on react-native-web). Inside: a small circular avatar carrying the club's initials (`initialsFrom(row.club_name)`, the exact avatar treatment `app/friends.tsx`'s own `avatar`/`avatarFriend` styles already establish — reuse that shape, a fresh color token is fine, just pull it from `lib/theme.ts`), the headline (bold), the detail line (muted, `numberOfLines={2}`), and a timestamp.
- Timestamp: format `row.created_at` with `Intl.DateTimeFormat` in the **device's own local timezone** (no `timeZone` override) — comment this choice explicitly, since every other date in this app is deliberately rendered in the *club's* timezone and a reviewer should not mistake this for the same bug those other call sites guard against: a notification's "when" is about when it reached the recipient, not a game's own schedule.

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- app/__tests__/alerts.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/alerts.tsx app/__tests__/alerts.test.tsx
git commit -m "feat(alerts): add the Alerts feed screen"
```

---

### Task 5: Wire `TabBar`

**Files:**
- Modify: `components/TabBar.tsx`
- Modify: `app/__tests__/tab-bar.test.tsx`

**Interfaces:**
- Consumes: `useNotificationsUnread` from Task 3.

- [ ] **Step 1: Update the failing tests first**

In `app/__tests__/tab-bar.test.tsx`, find the existing tests asserting the `alerts` tab's `href` (currently `/notifications`) and change the expected value to `/alerts`. Find or add a mock for `lib/use-notifications-unread` (matching however `lib/use-unread` is already mocked in this file for the `messages` badge tests) and add a test asserting the `alerts` tab shows a badge when the hook returns a nonzero count, mirroring whatever existing test proves this for `messages`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- app/__tests__/tab-bar.test.tsx`
Expected: FAIL — `alerts` still points at `/notifications` and shows no badge

- [ ] **Step 3: Wire the tab bar**

In `components/TabBar.tsx`, change:

```tsx
import { useUnreadCounts } from '../lib/use-unread';
```

to:

```tsx
import { useNotificationsUnread } from '../lib/use-notifications-unread';
import { useUnreadCounts } from '../lib/use-unread';
```

Change:

```tsx
  { key: 'alerts', label: 'Alerts', href: '/notifications' },
```

to:

```tsx
  { key: 'alerts', label: 'Alerts', href: '/alerts' },
```

Change:

```tsx
  const router = useRouter();
  const pathname = usePathname();
  const { total } = useUnreadCounts();
```

to:

```tsx
  const router = useRouter();
  const pathname = usePathname();
  const { total } = useUnreadCounts();
  const alertsUnread = useNotificationsUnread();
```

Change:

```tsx
        // Only the Messages tab carries a badge, so every other tab's
        // suffix is always empty.
        const badgeCount = tab.key === 'messages' ? total : 0;
```

to:

```tsx
        // Messages and Alerts both carry a badge; the other two tabs'
        // suffix is always empty.
        const badgeCount =
          tab.key === 'messages' ? total : tab.key === 'alerts' ? alertsUnread : 0;
```

Change:

```tsx
            <View style={styles.iconWrap}>
              {icon(tab.key, tint)}
              {tab.key === 'messages' ? (
                <View style={styles.badge}>
                  <UnreadBadge count={total} />
                </View>
              ) : null}
            </View>
```

to:

```tsx
            <View style={styles.iconWrap}>
              {icon(tab.key, tint)}
              {tab.key === 'messages' || tab.key === 'alerts' ? (
                <View style={styles.badge}>
                  <UnreadBadge count={badgeCount} />
                </View>
              ) : null}
            </View>
```

(Note the last change also fixes `count={total}` to `count={badgeCount}` — the two were equivalent while only `messages` ever reached this branch; they no longer are once `alerts` shares it.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- app/__tests__/tab-bar.test.tsx`
Expected: PASS (whole file)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/TabBar.tsx app/__tests__/tab-bar.test.tsx
git commit -m "feat(alerts): point the Alerts tab at the new feed, badge it

app/notifications.tsx is untouched -- still reachable from Profile's own
Notifications link, exactly as before."
```

---

### Final verification (not a separate task)

- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] **Task 1's migration and pgTAP fixture still need a real run against a local Supabase stack before this ships** — flag this explicitly in the final summary to the branch owner. Every other task in this plan is verified the normal way; this one piece is not, by environment necessity, not by choice.
- [ ] Visual baselines still cannot regenerate in this environment (no Docker) — same accepted gap as the rest of this branch's work; a new `alerts` baseline is needed once they can.
