# Alerts: a real notification feed — design

**Date:** 2026-09-02
**Base branch:** `UI-tweaks` (this branch)
**Revises scope from:** `2026-08-23-notifications-and-comms-design.md`, whose
"Out of scope" section named "In-app notification inbox" as a boundary for
that plan specifically, not a rejection of the idea.

**Environment caveat, stated once here rather than repeated everywhere:**
this design includes a database migration this session cannot apply or test
locally — no Docker, no local Supabase stack. Every piece of SQL below is
written to reuse, not duplicate, the existing delivery system's own
proven join logic (`outbox_render_context`), specifically to minimize the
surface that's new and unverified. A pgTAP test file is still written,
matching this repo's own convention, for the owner or CI to run.

---

## The problem

The "Alerts" tab (bottom `TabBar`, `BellIcon`) has always pointed at
`app/notifications.tsx` — a settings screen (channel preference, quiet
hours, a mute toggle). There is no feed anywhere in the app of the things
that actually happened to a member: a friend booked them a seat, a table
needs a fourth, a promoted-from-waitlist seat is theirs, a club posted a
broadcast. Those events already exist as rows in `notification_outbox` —
written the moment they happen, entirely to drive email/push delivery —
but that table was deliberately built with no RLS policy and no grant to
`authenticated`, on the explicit premise (recorded in its own migration
comment) that "every fact a member needs is surfaced from live state
instead."

Turning Alerts into a real feed doesn't mean reopening that decision at the
table level — it means adding the same kind of narrow, purpose-built
`security definer` RPC this schema already uses everywhere for
"read your own X" (`fetch_my_threads`, `my_unread_counts`,
`fetch_my_clubs`), scoped to `recipient_id = auth.uid()`, with
`notification_outbox` itself staying exactly as locked down as it is
today.

---

## The shape

### Database

**One new table**, mirroring `thread_reads`'s own watermark pattern (a
single per-recipient `last_read_at`, not a per-notification read flag —
Alerts has no per-thread concept to key against):

```sql
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
```

**Three new functions**, all `security definer`, none touching
`notification_outbox`'s existing grants:

1. **`fetch_my_notifications()`** — the feed's read path. Reuses
   `outbox_render_context` (the exact function `claim_notification_batch`
   itself calls to render email/push) rather than re-deriving its joins by
   hand — that function already carries the tested, carefully-commented
   logic for which payload key names which actor, the `event_cancelled`
   `starts_at` fallback for a deleted occurrence, and the text-cast
   comparisons that keep one oddly-shaped row from poisoning a whole
   batch. Selects the caller's own most recent 50 ids first, then makes
   one call into that function with the whole array:

   ```sql
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
   ```

   No `sent_at`/`failed_at`/`expired_at` filter — shown regardless of
   delivery outcome, by design (owner's decision: the feed is the reliable
   fallback if push/email ever failed to reach someone). `recipient_id`,
   `recipient_name`, `recipient_email` and `channel` are dropped from the
   returned columns entirely: they exist in `outbox_render_context` for
   email delivery specifically, and the client already knows who it is —
   no reason to echo an email address back over an RPC that doesn't need
   it. `security definer` privileges are what let this call
   `outbox_render_context` despite that function's own
   `revoke ... from public, anon, authenticated` — the same mechanism
   `claim_notification_batch` already relies on to call it.

2. **`mark_notifications_read()`** — the write path, an upsert on the one
   watermark row, same shape as `mark_thread_read`:

   ```sql
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
   ```

3. **`my_notification_unread_count()`** — feeds the `TabBar` badge, live
   rather than cached (same reasoning `my_unread_counts` already
   documents for messages: "so the badges and the list cannot disagree").
   Counted against the full table, not capped to the 50 the feed shows —
   a member away long enough to have more than 50 unread sees a badge
   larger than the visible list, which is honest rather than silently
   wrong:

   ```sql
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

**pgTAP test file**, matching `supabase/tests/database/fixtures/`'s own
convention (one file per feature, seeded fixtures, `plan()`/`finish()`) —
written by this plan, run by the owner or CI, not by this session.

### Client — rendering

`bodyFor` (`supabase/functions/deliver-notifications/templates/bodies.ts`)
is a pure, format-agnostic function — plain strings in, plain strings out,
no HTML — and is the proven, already-correct source of what each of the 12
`outbox_kind` values means in words. It runs in a Deno Edge Function and
can't be imported directly into the Expo client, so `lib/notifications.ts`
ports its logic rather than sharing the module: same 12 cases, same
`actor()`/`game()`/`at()` helper shapes, condensed from email's
headline+multi-paragraph+footer shape into a single headline + one detail
line + a destination route, since a list row has one line of space, not an
email's.

```ts
export type NotificationRow = {
  id: string;
  kind: OutboxKind; // same 12-value union as deliver-notifications/types.ts
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

export type NotificationItem = {
  headline: string;
  detail: string;
  href: string;
};

export function describeNotification(row: NotificationRow): NotificationItem {
  // same 12-case switch as bodyFor, condensed to headline/detail/href
}
```

Each case's `headline` is `bodyFor`'s own `headline` string verbatim (same
voice as the email/push copy a member may already have seen); `detail` is
a single condensed line covering what `paragraphs[0]` says; `href` is a
router path, not a full URL (`/clubs/${club_id}/events/${event_id}` when
`event_id` is present, `/clubs/${club_id}` otherwise — the exact fallback
`eventUrl` already uses). `promotion_offer`'s row carries no `table_label`
today (traced in the investigation: `outbox_render_context` never joins
`promotion_offers`, so the field is always null for this one kind) — this
port keeps that same gap rather than adding a new join to fetch seat
counts nobody asked for.

`fetchMyNotifications()`, `markNotificationsRead()`,
`fetchNotificationUnreadCount()` in the same file wrap the three RPCs, each
following this codebase's own established failure contract: a read
resolves to `null`/`0` on failure rather than throwing (matching
`fetchUnreadCounts`'s own "a badge is an invitation, and there is nothing
useful to say to somebody about a count we could not fetch").

### Client — the feed screen

New route `app/alerts.tsx`, in the shape `app/messages/index.tsx` and
`app/friends.tsx` already establish: `Screen` + `TabBar active="alerts"`,
a heading, a dashed empty-state card when the list is genuinely empty, a
flat list otherwise (one row per notification: club-avatar-style initials
circle, headline, detail line, a relative-to-now timestamp in the
**device's own local time** — this is the one place in the app where local
time is the right choice rather than the club's, since a notification's
"when" is about when it reached the recipient, not a game's own schedule).
Tapping a row `router.push`es its `href`.

Calls `markNotificationsRead()` once per focus (`useFocusEffect`, matching
`app/messages/index.tsx`'s own refetch-on-focus pattern) — the whole list
clears at once rather than per-item, since there's one watermark, not one
per row. No per-item unread styling: opening the screen is what clears the
badge, matching how the badge itself already works for messages.

### `TabBar`

The `alerts` tab's `href` changes from `/notifications` to `/alerts`.
`app/notifications.tsx` itself is **completely untouched** — still reachable
from Profile's existing "Notifications › Edit" link, exactly as before.
`TabBar` gains a second unread source alongside `useUnreadCounts()`
(messages): a new `useNotificationsUnread()` hook, same shape as
`lib/use-unread.ts`, feeding the `alerts` tab's own badge the same way
`messages` already has one.

---

## What this touches

- **New migration** — `notification_reads` table, three functions
  (`fetch_my_notifications`, `mark_notifications_read`,
  `my_notification_unread_count`), plus a pgTAP test fixture.
- **`lib/notifications.ts`** (new) — types, the three RPC wrappers,
  `describeNotification`.
- **`lib/use-notifications-unread.ts`** (new) — the polling hook, mirroring
  `lib/use-unread.ts`.
- **`app/alerts.tsx`** (new) — the feed screen.
- **`components/TabBar.tsx`** — `alerts`' href, a second badge source.
- **`app/notifications.tsx`, `app/profile.tsx`** — untouched.

**Tests.**
- SQL: one new pgTAP fixture (written, not run in this session).
- `lib/notifications.test.ts` (new) — `describeNotification` is a pure
  function and fully testable without a database: one case per
  `outbox_kind`, matching the coverage `bodies.ts`'s own tests presumably
  already give the email side (check for an existing `bodies.test.ts` and
  match its fixture style before inventing new ones). The three RPC
  wrappers get the same mocked-Supabase-client test shape every other
  `lib/*.ts` fetcher in this app already uses.
- `lib/use-notifications-unread.test.tsx` (new) — mirrors
  `lib/use-unread.test.tsx` structurally.
- `app/__tests__/alerts.test.tsx` (new) — screen-level: empty state, a
  populated list, tap-to-navigate, marks-read-on-focus.
- `app/__tests__/tab-bar.test.tsx` — updated for the new href and the new
  badge source.

---

## Not in scope

- **Per-item read state.** One watermark, cleared on screen focus — no
  per-row read/unread flag, no swipe-to-dismiss.
- **Pagination.** Most recent 50, no "load more" — matches this app's
  existing pattern of bounded, un-paginated fetches everywhere else.
- **Push for `event_reminder`/any kind beyond what already sends.** This
  is purely a new READ surface over what the outbox already writes; no
  new outbox-writing trigger, no new kind.
- **Muting a broadcast, or any new notification-preference control.** The
  three existing settings on `app/notifications.tsx` are untouched.
- **Realtime.** Refetched on screen focus, same as messages' own list —
  not a live subscription.
