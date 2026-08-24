# MahjHero Notifications & Comms — Design

**Date:** 2026-08-23
**Plan:** V1 plan 6 of 6, following [foundation & identity](2026-08-01-mahjhero-v1-design.md)
(plan 1), clubs & membership (plan 2),
[events & scheduling](2026-08-22-events-and-scheduling-design.md) (plan 3), and
[seating & booking](2026-08-23-seating-and-booking-design.md) (plan 4).
**Parent spec:** [2026-08-01-mahjhero-v1-design.md](2026-08-01-mahjhero-v1-design.md) —
sections 7 (Notifications and scheduled work), 8 (Permissions), 9 (Error handling),
10 (Testing).

---

## Goal

Tell people things. Plan 4 built a booking system that writes a
`notification_outbox` row at every notifiable moment and has never sent a single
message; `sent_at` has been on the table since the day it was created and nothing
has ever written to it. A seat offered to a waitlisted member expires two hours
later whether or not they had any way of knowing it existed. This plan drains that
queue, adds the two things nothing has yet queued — event reminders and host
broadcasts — and gets the result into a member's inbox.

Plan 4's own closing note called the undrained outbox "the single strongest argument
for plan 6 following immediately". This is that plan.

## Scope

**In.** Draining `notification_outbox` to email; the reminder job reading
`clubs.reminder_offsets`; host broadcasts to a club roster or to one event's booked
members, stored with a sent history; per-recipient quiet hours, channel preference,
and the need-a-4th mute enforced at claim time; bounded retries with dead-lettering;
a staleness horizon; a branded HTML email shell with a plain-text alternative.

**Out.** Native and web push delivery. SMS. In-app notification inbox. Digest or
batching of multiple messages into one email. Per-club email branding. Bounce and
complaint ingestion. Reply-to-a-broadcast threading.

### The push boundary

Push is **wired but dark**. Every preference the app already collects speaks of
push — `profiles.notify_channel` has offered `push`, `email`, and `both` since plan
1, and [app/notifications.tsx](../../../app/notifications.tsx) has been letting
members choose between them for weeks. This plan does not make `push` real.

What it does instead: a `push_tokens` table exists, the channel resolver consults
it, and a member set to `push` or `both` with no registered token resolves to email.
No client code registers a token, so in practice every member resolves to email
today. The `Sender` interface has one implementation.

This is deliberate. The app is developed and tested web-first — vitest runs against
`react-native-web`, Playwright runs Chromium, and there is no EAS build
configuration in the repository. A native push leg could be written but not verified
by anything in the current suite, and an unverifiable delivery path is worse than an
absent one. When a later plan adds `expo-notifications` and a dev build, only the
client registration and one `Sender` implementation change; the queue, the
preferences, the quiet hours, the retries, and the templates are all already
correct.

The cost of the choice is honest and small: a member who picks "Push only" gets
email. The settings screen is not changed to hide the option, because the option is
about to become true and churning the UI twice is worse than the temporary
imprecision.

## Decisions locked during brainstorming

1. **Email now, push wired but dark.** As above.
2. **Claim in SQL, send in TypeScript.** `pg_cron` → `pg_net` → Edge Function, which
   claims a batch through an RPC, sends, and marks the result through another. The
   correctness-critical half stays in the layer this repo tests hardest.
3. **SMTP, provider-agnostic.** Not a provider's HTTP API. Local development and
   hosted sends run the identical code path, and the provider is a secret rather
   than a dependency.
4. **Broadcasts are stored records.** A `broadcasts` row per message, with a sent
   history the host can read.
5. **Both broadcast targets.** Club-wide and event-scoped, two entry points over one
   mechanism.
6. **One branded HTML shell, per-kind body.** Not eleven bespoke designs, and not
   plain text only.
7. **Bounded retries, then dead-letter.** Exponential backoff, give up after five,
   and the row stays inspectable in the table.
8. **A staleness horizon.** Rows too old to be worth sending are marked expired, not
   delivered.

---

## Architecture

```
pg_cron (every minute)
  └─ pg_net POST ──► Edge Function `deliver-notifications`
                       ├─ rpc claim_notification_batch(limit)   ──► rows, render-ready
                       ├─ render + SMTP send, one at a time
                       ├─ rpc mark_notifications_sent(ids)
                       └─ rpc mark_notifications_failed(id, err)
```

Three other jobs feed the queue. Two already exist from plan 4
(`sweep-promotion-offers` every 5 minutes, `announce-need-a-fourth` every 15). This
plan adds the third, `queue-event-reminders`, on the 15-minute schedule the parent
spec's table specifies. Everything else that queues a message does so inline, inside
whichever transaction caused it, and has done since plan 4.

### Why the join lives in SQL

Plan 4's outbox payloads are deliberately thin — `{"booking_id": …}`,
`{"offer_id": …, "seats": 2}`, `{"event_table_id": …, "table_label": "Table 2"}`.
They identify; they do not describe. Nothing in a payload knows the club's name, the
event's title, when it starts, or who the recipient is. There is no email address
anywhere in `public`; addresses live in `auth.users.email`.

So the claim RPC returns render context, not raw rows. It joins the outbox to
`profiles`, `auth.users`, `clubs`, `events`, `event_tables`, and `bookings`, and
hands the Edge Function everything a template needs: recipient display name and
address, club name, event title, start time rendered in the club's timezone, table
label, and a deep link.

The alternative — an Edge Function that fetches its own context — would need read
access across the whole schema under the service role, and would re-implement
tenancy rules that already exist inside `security definer` functions. One RPC that
returns render-ready rows keeps the function a dumb renderer with no business logic
in it, which is also what makes the function easy to test.

### At-least-once, made safe by the dedupe key

The Edge Function sends *after* the claim transaction commits, so `for update skip
locked` cannot hold a lock across the send. Claiming therefore takes a **lease**:

- `attempts` is incremented
- `next_attempt_at` is set to `now() + interval '5 minutes'`

A function that dies mid-batch loses nothing; the row becomes due again in five
minutes and `attempts` has already moved, so it cannot loop forever. A function that
sends and then fails to call `mark_notifications_sent` will send that message twice
— accepted, and the reason the fifth attempt is the last.

The existing unique constraint on `dedupe_key` is what makes the *producers* safe: a
cron job that runs twice, a fan-out that resumes after a crash, and a series edit
that touches the same booking twice all collapse to one row. Duplication is
prevented where messages are created, not where they are sent.

---

## Data model

### `notification_outbox`, extended

Plan 4's table gains five columns. Nothing is renamed and nothing is dropped.

| Column | Type | Meaning |
|---|---|---|
| `attempts` | `int not null default 0` | Incremented at claim, not at send. Bounds the work. |
| `next_attempt_at` | `timestamptz not null default now()` | Due time. The lease, the backoff, and the quiet-hours hold all express themselves here. |
| `last_error` | `text` | The most recent failure, for a human reading the table. |
| `failed_at` | `timestamptz` | Set when attempts are exhausted. Terminal. |
| `expired_at` | `timestamptz` | Set when the staleness horizon passed it by. Terminal. |

A row is **due** when `sent_at`, `failed_at`, and `expired_at` are all null and
`next_attempt_at <= now()`. Three terminal states, mutually exclusive, each with its
own timestamp — so "what happened to this message" is answerable from the row alone.

**The outbox is its own send log.** Parent spec section 7 rule 1 requires every send
to be logged and deduped. `dedupe_key` is the dedupe; these columns are the log.
A second `notification_log` table would hold the same facts keyed the same way.

**Backoff** is `5 minutes × 2^(attempts-1)` — 5, 10, 20, 40, 80 minutes — and the
fifth failure sets `failed_at`. A permanently bad address costs five sends over
roughly two and a half hours and then stops consuming batch slots forever.

### `push_tokens`

```
id          uuid primary key
profile_id  uuid not null references profiles(id) on delete cascade
token       text not null unique
platform    text not null check (platform in ('ios','android','web'))
created_at  timestamptz not null default now()
last_seen_at timestamptz not null default now()
```

Empty in this plan. It exists so the channel resolver has something to consult and
so the later push plan is additive rather than a schema change under live traffic.
RLS on, with a policy letting a member manage only their own rows — written now
because writing it later, once the client is registering tokens, is the moment
mistakes get made.

### `broadcasts`

```
id              uuid primary key
club_id         uuid not null references clubs(id) on delete cascade
event_id        uuid references events(id) on delete cascade   -- null = club-wide
author_id       uuid not null references profiles(id)
subject         text not null check (length(trim(subject)) between 1 and 120)
body            text not null check (length(trim(body)) between 1 and 2000)
recipient_count int not null default 0
created_at      timestamptz not null default now()

foreign key (event_id, club_id) references events (id, club_id)
```

The composite foreign key is not decorative — it is the same guard plan 4 put on
`bookings`, and it makes "broadcast to an event in someone else's club" unstateable
rather than merely refused.

`recipient_count` is written by the fan-out in the same transaction, so the sent
history can say "went to 14 members" without counting outbox rows at read time.

RLS: `select` for organizers of the club, no `insert`, `update`, or `delete` for
anybody. Every write goes through `send_broadcast()`. This is exactly the posture
plans 3 and 4 established.

### `outbox_kind`, extended

Two values added: `event_reminder` and `broadcast`.

`alter type … add value` cannot be used in the same transaction that adds it, so the
two values land in their own migration, ahead of the migrations that reference them.

---

## Delivery rules

### Channel resolution

| `notify_channel` | Registered token? | Resolves to |
|---|---|---|
| `email` | — | email |
| `both` | no | email |
| `both` | yes | email (push arrives with the push plan) |
| `push` | no | **email** |
| `push` | yes | email (as above) |

Today every branch resolves to email, because `push_tokens` is empty. The table is
written this way so the later plan changes one column of it.

A member with no address on `auth.users` — not currently reachable through any sign
-up path, but cheap to guard — has their row expired rather than failed. There is
nothing to retry.

### Quiet hours

Evaluated per recipient, at claim time, in `profiles.timezone` — never in the club's
timezone and never in UTC. A held row is not failed and not retried; it is simply
not due, expressed by leaving `next_attempt_at` where it is and excluding the row
from the claim predicate. It flows on the first tick after the window closes.

Windows wrap midnight. The default is 21:00–08:00, so the naive `start <= t <= end`
comparison is wrong for every default user; the predicate handles both the wrapping
and non-wrapping case.

Three classes, following parent spec section 7 rule 2:

| Class | Kinds | Behaviour |
|---|---|---|
| **Never held** | `promotion_offer`, `promotion_offer_expired`, `booked_by_friend`, `booking_declined`, `booking_cancelled_by_host`, `waitlist_promoted`, `unseated`, `event_cancelled` | Somebody else acted on your seat. Delay makes the message wrong, or in the case of a two-hour offer, useless. |
| **Held, with the near-event exemption** | `event_reminder` | Held by quiet hours, **unless** the event starts inside the window or within two hours after it ends. Without the exemption, a 9am club's two-hour reminder waits until 08:00 and lands after it stopped being useful. |
| **Suppressible** | `need_a_fourth`, `broadcast` | Queue until the window closes. No exemption. |

The `mute_need_a_fourth` preference is a separate filter, applied at claim time to
`need_a_fourth` only. Parent spec section 7 rule 3: reminders for events you have
booked are not mutable, and this plan does not add a preference that would make them
so.

### Staleness

Checked at claim, before anything else. A stale row gets `expired_at` and is never
sent.

| Kind | Horizon |
|---|---|
| Event-bound kinds (`event_reminder`, `need_a_fourth`, `promotion_offer`, `promotion_offer_expired`, `waitlist_promoted`, `unseated`, `booked_by_friend`, `booking_declined`, `booking_cancelled_by_host`) | The event's `starts_at`. Nothing about a game is worth saying after it began. |
| `event_cancelled` | 24 hours after creation. A cancellation is worth knowing after the slot passes, but not a week later. |
| `broadcast` | 24 hours after creation. |

This also handles the first deploy gracefully. Plan 4 has been writing outbox rows
throughout its development and test cycles; without a horizon, turning the drain on
would mail every member a backlog of announcements about games that finished weeks
ago. With it, the backlog expires on the first tick.

### Batching

Fifty rows per invocation, sent sequentially. At one invocation per minute that is
3,000 messages an hour, which is far beyond anything a club-scale product produces,
and sequential sending keeps a shared SMTP relay from rate-limiting the whole batch
because of one burst. Ordering is `next_attempt_at, created_at` — oldest due first,
so a backlog drains in the order it accumulated.

---

## Scheduled work

| Job | Frequency | Source | Purpose |
|---|---|---|---|
| `deliver-notifications` | every 1 min | **new** | Drain the outbox |
| `queue-event-reminders` | every 15 min | **new** | Queue reminders at each club's offsets |
| `sweep-promotion-offers` | every 5 min | plan 4 | Expire stale offers, promote next group |
| `announce-need-a-fourth` | every 15 min | plan 4 | Announce tables at 3 of 4 |
| `materialize-event-series` | nightly | plan 3 | Keep ~6 weeks bookable |

### `queue_event_reminders()`

For every published, future event, for every offset in `clubs.reminder_offsets`
(default `{1440, 120}` — 24 hours and 2 hours), once `now()` has passed
`starts_at - offset`, insert one outbox row per **confirmed** booking. Waitlisted
members are not reminded; they have no seat to be reminded of.

`dedupe_key` is `reminder:{event_id}:{offset}:{profile_id}` and the insert is
`on conflict do nothing`. This makes the job idempotent by construction and removes
the need for exact window arithmetic entirely: a tick that is missed catches up on
the next run, and a tick that runs twice is a no-op. The job asks "has this
threshold been crossed", never "was it crossed in the last 15 minutes" — the
question that goes wrong the moment a run is skipped.

A member who books *after* a threshold has passed gets that reminder on the next
tick, which is correct: they booked knowing the game is in 90 minutes, and a
"starting in 2 hours" message would be stale on arrival. Guarded by the staleness
horizon, not by special-casing the job.

---

## Email

### Structure

`supabase/functions/deliver-notifications/`

| File | Responsibility |
|---|---|
| `index.ts` | HTTP handler, shared-secret check, batch loop, RPC calls |
| `sender.ts` | The `Sender` interface, `SmtpSender`, `FakeSender` |
| `render.ts` | Shell + body composition, HTML and text together |
| `templates/shell.ts` | The one branded HTML layout |
| `templates/bodies.ts` | `kind → { subject, headline, paragraphs, cta }` |
| `brand.ts` | Colours and wordmark, mirrored from `lib/theme` |

The Edge Function is Deno and cannot import [lib/theme](../../../lib/theme.ts)
through Metro's resolver, so a handful of hex values are duplicated in `brand.ts`
with a pointer comment on both sides. This is the only duplication in the plan and
it is named here so it is not later mistaken for an oversight.

### The shell

One table-based HTML layout — the only construct email clients agree on — carrying
the wordmark, the accent colour, a single content column at 600px, and a footer.
Every message is a subject, a headline, one or two sentences, and at most one call
to action. A plain-text alternative is generated from the same body data, not
scraped from the HTML, and both parts ship as `multipart/alternative`.

Eleven bespoke designs would look better and would be eleven separate sets of
client-compatibility risk for a product that has not yet sent its first email.

### Links

Email clients do not follow custom schemes, so nothing links to `mahjhero://`. A
`PUBLIC_APP_URL` secret plus the existing Expo Router paths gives one HTTPS URL that
works in a browser today — the web target is a permanent commitment, per the
roadmap — and becomes a universal link when the native builds land.

### The footer

Names the club the message came from, and links to the notification settings screen.
Reminders for booked games say plainly that they cannot be switched off, rather than
offering a link that would not work. Broadcasts and need-a-4th alerts link straight
to the setting that silences them.

---

## Screens

| Screen | Route | Who | What |
|---|---|---|---|
| Compose broadcast | `app/clubs/[id]/broadcast.tsx` | organizers | Subject, body, recipient count, confirm |
| Sent messages | `app/clubs/[id]/broadcasts.tsx` | organizers | Reverse-chronological history |

Two entry points reach the compose screen: **Message members** on the club screen,
which targets the roster, and **Message everyone booked** on the event screen, which
targets that event's confirmed bookings. Both land on the same screen; the target is
a route parameter.

The compose screen shows the recipient count *before* sending — "This goes to 14
members" — and asks for confirmation. A broadcast is irreversible and outward-facing,
which is exactly the class of action that deserves a second tap.

The sent history shows subject, target, recipient count, and time. It exists because
the first question a host asks after sending to fifty people is whether it went.

Nothing else changes. The notification settings screen already exists and is already
correct; this plan makes its settings mean something.

---

## Permissions

| Object | anon | authenticated | Notes |
|---|---|---|---|
| `notification_outbox` | — | — | No policy. Plan 4's posture, unchanged. |
| `push_tokens` | — | own rows | Member manages their own devices. |
| `broadcasts` | — | `select` for organizers | No DML. |
| `send_broadcast()` | — | execute | `assert_club_organizer()` inside. |
| `claim_notification_batch()` | — | **revoked** | Service role only. |
| `mark_notifications_sent()` | — | **revoked** | Service role only. |
| `mark_notifications_failed()` | — | **revoked** | Service role only. |
| `queue_event_reminders()` | — | **revoked** | `postgres` only, via cron. |

The explicit `revoke … from authenticated` on all four internal functions is not
belt-and-braces. Supabase's hosted bootstrap grants `execute` to `authenticated` at
function-creation time, and `revoke … from public` does not clear it. This repository
has been bitten by exactly that four times —
[20260823020000](../../../supabase/migrations/20260823020000_fix_event_mutation_races_and_acls.sql),
[20260823030000](../../../supabase/migrations/20260823030000_event_series_mutations.sql),
[20260823060000](../../../supabase/migrations/20260823060000_schedule_materialize_event_series.sql),
and [20260825061000](../../../supabase/migrations/20260825061000_revoke_internal_functions_from_authenticated.sql)
— and each time the gap was invisible against the local stack, which grants
`authenticated` nothing by default.

The Edge Function endpoint itself rejects any request without a shared secret held
in the function's environment and supplied by the `pg_net` call. The drain must not
be triggerable by anyone who can guess the URL; a public trigger is a way to force
the retry counter up and dead-letter real messages.

---

## Error handling

| Failure | Behaviour |
|---|---|
| SMTP connection refused | Row stays due, `last_error` set, backoff applies. Whole batch abandoned; next tick retries. |
| SMTP rejects one address | That row backs off; the rest of the batch proceeds. |
| Five failures | `failed_at` set. Terminal, visible, never retried. |
| Function times out mid-batch | Lease expires in 5 minutes. Sent-but-unmarked rows send twice; unsent rows retry. |
| `pg_net` call fails | Nothing marked, nothing lost. The next tick is a minute away. |
| Recipient has no address | `expired_at` set. Nothing to retry. |
| Broadcast fan-out interrupted | `on conflict do nothing` means re-running inserts only the missing rows. |

Members see none of this. A host composing a broadcast gets the ordinary
[error handling](2026-08-01-mahjhero-v1-design.md) treatment of any failed write —
the message is not recorded as sent, and they can try again.

---

## Testing

**pgTAP** — the claim lease and its `attempts` increment; backoff arithmetic; the
quiet-hours predicate across several timezones and across a midnight-wrapping
window; the near-event exemption on both sides of the boundary; the `need_a_fourth`
mute; each staleness horizon; `dedupe_key` collapsing a repeated insert;
`queue_event_reminders` producing one row per offset per confirmed booking and
nothing on a second run; `send_broadcast` refusing a non-organizer, refusing a
cross-club event, and writing a correct `recipient_count`; and the grant matrix
above, in the portable suite that runs against the hosted project.

**Vitest** — every kind rendering a subject and a text body, against a `FakeSender`;
channel resolution across the table above; the retry schedule; and the compose
screen's structure, confirmation step, and error states.

**End-to-end, locally, for real** — `supabase functions serve`, invoke the drain,
and assert the message arrives in the Mailpit inbox Supabase already runs at
`localhost:54324`. `[local_smtp]` is enabled in
[config.toml](../../../supabase/config.toml); this costs nothing, needs no DNS, and
exercises the exact code path that runs in production. Documented in
[docs/testing.md](../../testing.md).

**Playwright** — the compose screen and the sent history at both viewports.

---

## Risks and open items

1. **Deliverability is unproven.** The first real send is the first time SPF, DKIM,
   and DMARC alignment are tested against a live inbox. The domain is ready; the DNS
   records are a setup step, and until they are right, mail lands in spam. Mitigated
   only by doing it early and checking, not by anything in the code.
2. **No bounce ingestion.** A hard bounce is invisible to the app; the SMTP relay
   knows and MahjHero does not. Repeated bounces to a dead address burn five attempts
   and dead-letter, which is the right shape, but nobody is told. Worth revisiting
   once there is volume.
3. **`push` still means email.** Named above, accepted, and temporary.
4. **One send per notifiable moment.** A member whose group of four is cancelled by
   a host receives one email per person. No digesting. At club scale this is
   tolerable; it is the first thing to reconsider if anybody complains about volume.
5. **The Edge Function is a new deploy surface.** `supabase/functions` did not exist
   before this plan. Deployment, secrets, and log access all become part of the
   release procedure and need documenting alongside the migrations.

## Not in this plan

Native and web push delivery. SMS. An in-app notification inbox. Digests. Per-club
email branding or custom sender addresses. Bounce and complaint webhooks. Replying
to a broadcast. Scheduled or delayed broadcasts. Read receipts.
