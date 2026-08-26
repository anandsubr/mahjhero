# TODO

Running list of things to build, fix, or verify. Newest ideas go at the bottom of
their section; check the box when it is done **and** verified.

---

## Build

### [ ] In-app feedback → GitHub Discussions → triage to issues

Let a user raise a question or a piece of feedback from **any** screen, and land it
in the repo's GitHub Discussions so it can be triaged into an issue and fixed.

Open questions to settle before building:

- **Entry point** — a persistent affordance (floating button / header icon) vs. a
  shake-to-report gesture. Needs to work on every route, including modals and the
  signed-out screens.
- **Context to attach** — current route, app version, platform, and whether the
  reporter is signed in. Screenshot? That raises what we're allowed to capture.
- **Transport** — the app cannot hold a GitHub token, so this needs a server side:
  a Supabase Edge Function holding a GitHub App installation token, posting via the
  GraphQL `createDiscussion` mutation (REST has no Discussions write API).
- **Discussion category** — likely a dedicated "Feedback" category on
  https://github.com/anandsubr/mahjhero so triage is not mixed with other threads.
- **Triage loop** — GitHub's built-in "Create issue from discussion" is manual and
  probably enough to start; automate only if volume warrants.
- **Abuse / spam** — an unauthenticated endpoint that writes to a public repo needs
  rate limiting at minimum.

### [x] My Clubs — no space between the last club and the "Start another club" button

`app/clubs/index.tsx` renders the club `Card`s and then the secondary `Button` as
adjacent siblings with no gap. The empty state has the same shape (help text sits
directly on the button), so check both.

Fix belongs in the layout, not a one-off margin — either a gap on the list container
or a consistent bottom margin on `Card`, using `space[…]` from `lib/theme` rather
than a literal. Regenerate the clubs visual baselines afterwards.

Already relying on a page-level `gap: space[4]` between this screen's top-level
sections, which happened to close the gap, but nothing had marked this box done. The
"Your games" commit (Task 13) gives the club cards and the button their own dedicated
`gap: space[3]` list container instead, so the fix no longer depends on the coarser
page-level gap.

### [ ] Venues screen flashes "No venues yet." on a club that has venues

`app/clubs/[id]/venues.tsx` sets `ready` off the club/roster `Promise.all` alone and
calls `loadVenues()` separately, so there is a real window — before the venues fetch
lands — in which the screen renders "No venues yet. The first one is added when you
create a game." for a club that has two. Found while writing the Task 17 visual
baseline for this screen (`e2e/visual.spec.ts`'s `venues at …` test now anchors on
both venue names before the heading, specifically to dodge this window rather than
to fix it).

Fix is to gate the empty-state message on a `venuesReady`/`venuesFailed` pair the
same way the rest of the screen already distinguishes "not loaded yet" from "loaded
and empty" — `venuesFailed` exists precisely so a failed fetch is not read as "none";
a not-yet-landed fetch needs the same treatment. Not mine to fix in a `test:` commit;
recorded here per Task 17's own report.

### [x] `app/clubs/index.tsx` has no page padding

"Your clubs" sits at x=0 with its ascenders touching the top edge, and the club
cards run to the viewport edge at 375px width — visible in every clubs baseline,
including the pre-existing ones this task didn't touch. Every other screen in the
app gets its side margins from `Screen`'s default content padding; this screen must
be opting out of it somewhere, or never had it. Regenerate the `clubs*` and
`clubs-populated-*` visual baselines afterwards.

Fixed in the "Your games" commit (Task 13): `Screen` itself carries no default
padding — every other screen supplies `padding: space[6]` in its own `contentStyle`,
and this one never did. Added it to `app/clubs/index.tsx`'s `container` style.
`clubs-*` and `clubs-populated-*` baselines still need regenerating (Task 15).

### [ ] "Anything else? (optional)" label sits too tight under the Start time field

On both the create-game and edit-game screens, at both widths, the gap above the
notes label is noticeably smaller than every other label gap on the same screen.
Likely `TimeField.web.tsx`'s wrapper `flex: 1` inside the gapped column absorbing
less vertical space than the other field wrappers. Cosmetic; visible in the
`new-event-*` and `edit-event-*` baselines.

### [x] "seats" is never singularised on the event detail screen

`app/clubs/[id]/events/[eventId]/index.tsx` (around line 252) renders
`` `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${seats} seats` ``
— the table count is singularised, the seat count never is. A single table of
capacity 1 would read "1 table · 1 seats". Unreachable through the UI today: table
capacity is not editable anywhere and every table is created at the default of 4, so
this has never actually been seen. Low priority; fix alongside anything else that
touches this line.

**Fixed** in the seating branch (PR #5). Task 10 rewrote that header while wiring
booking, and the line now reads `${seats} ${seats === 1 ? 'seat' : 'seats'}`
(`app/clubs/[id]/events/[eventId]/index.tsx:594`). Still unreachable through the
UI — capacity is not editable anywhere — but it no longer lies if it ever is.

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

### [ ] The connection-break escape hatch dead-letters the queue's head, not the poison row

`release_notification_claims` (`20260826110000`) stops sparing a row once
it triggers three connection-class breaks in a row, so a genuinely poisoned
address eventually spends its own attempts budget instead of wedging every
batch behind it forever. But `claim_notification_batch` orders by
`next_attempt_at, created_at`, and every released row — spared or
triggering — gets the same flat `now() + 5 minutes` lease. During a real
relay outage, that means the row tripping the hatch is whichever row
happens to be oldest-due when the outage starts, not one whose own address
is at fault. Three breaks 5 minutes apart (09:00, 09:05, 09:10) dead-letters
that innocent head-of-queue row with a `last_error` describing a relay
problem it had nothing to do with — roughly one such row per continuous
75-minute outage. Still a large improvement on the old behaviour (the whole
batch dead-lettering on every tick), and there is no cheap discriminator:
during an outage the head row genuinely does throw the same way a poison
row would, so nothing inside `release_notification_claims` can tell the two
apart without spending something to find out.

The one known way to actually tell them apart: after a break trips the
escape hatch for the current head-of-queue row, try the *next* row once
before giving up on the first — if the relay is actually down, the second
row breaks too and neither should dead-letter yet; if only the first row is
poisoned, the second row goes through cleanly and that's the signal to
treat the first as the real problem. Not built — it adds a second RPC round
trip and a materially different control flow to `deliverBatch` for a
failure mode that is already bounded and infrequent. Recorded here as a
deliberate decision, not a surprise to rediscover later.

---

### [ ] A real home screen

`app/index.tsx` is a 103-line redirect resolver with no UI — it sends a signed-in
member straight to `/clubs`, which is "Your clubs" plus "Your games" and is doing duty
as the landing screen by default rather than by design.

Raised while designing check-in (plan 5): the member's check-in control had to live
somewhere reachable in zero taps, and "Your games" was the only surface that qualified.
That works, but it is the wrong long-term home. A real home screen wants the next game,
outstanding promotion offers, waitlist position, and club activity — designing it
around check-in alone would produce the wrong screen, so plan 5 deliberately did not.

When it is built it reuses `CheckInControl` and `my_upcoming_bookings()`'s check-in
columns unchanged. See [check-in design](docs/superpowers/specs/2026-08-24-check-in-design.md).

### [ ] Offline-tolerant check-in — the cache, the queue, and the sync loop

The V1 spec commits to this and plan 5 does not ship it; the deferral is recorded in
both [the V1 spec](docs/superpowers/specs/2026-08-01-mahjhero-v1-design.md) and
[the roadmap](docs/roadmap.md). Until it lands, a host at a venue with dead wifi cannot
check anybody in — which is the exact scenario the V1 spec named as the reason to build
it.

Nothing exists to build on: AsyncStorage is in the app for auth persistence only, and
there is no cache, queue, or sync anywhere. This plan owns all three.

Two hooks are already in place so this is additive rather than a rewrite of plan 5:
`check_ins` is uniquely keyed on `(event_id, profile_id)`, so a replayed queue cannot
duplicate; and `record_attendance` takes a caller-supplied `recorded_at` and applies
only when it is newer than the stored value, so a write that sat in a phone's queue
cannot clobber a decision the host has made since.

### [ ] The pgTAP suite fails if the contract or visual suites ran first

`npm run test:db` passes 931/931 immediately after `npx supabase db reset --local`,
and fails 3 assertions in `waitlist_promotion.test.sql` (tests 4, 24, 26) if
`npm run test:contract` or `npm run test:visual` ran against the same local stack
first. Both of those seed rows that are never cleaned up, and those three assertions
count globally rather than scoping to their own fixture.

Found while verifying plan 5 — the failure looks alarming and is purely ordering.
Two candidate fixes: scope the counting assertions to their own club/event, or have
the contract and visual suites clean up after themselves. The first is probably
right; a test that counts every row in a table is asserting something it does not
control.

Worth doing before anyone wires up CI, because in CI this shows up as a flaky
failure whose cause is invisible from the log.

## Configure & verify

### [ ] Google login — configure and check end to end

`docs/auth-configuration.md` already documents what the hosted Supabase project
needs; what is unverified is whether it is actually set and whether the round trip
works on a device.

- Google provider enabled in Supabase (Authentication → Providers) for **each**
  environment, with the OAuth client ID/secret from Google Cloud Console.
- Redirect URLs allow-listed: `mahjhero://auth/callback` in every environment, plus
  each developer's own `exp://<lan-ip>:8081/--/auth/callback` for Expo Go.
- Confirm email **on**, manual linking **off** — automatic linking on verified email
  is what keeps one person from becoming two profiles.
- Apple sign-in is mandatory on iOS once Google is offered (App Store Review 4.8) —
  so shipping Google without Apple blocks the iOS release.
- Verify: sign in with Google, then sign in with a magic link to the *same* address,
  and confirm one profile results. `supabase/tests/database/identity_linking.test.sql`
  asserts this — run it against any environment whose auth settings change.

### [ ] Seating & booking — the by-hand pass before PR #5 merges

The plan for V1 plan 4 names four checks as merge criteria and **none have been
done**. Automated coverage is 663 pgTAP / 67 hosted / 459 Vitest / 49 contract /
5 concurrency / 28 visual, but none of it exercises two real people, and none of
it has ever run on a phone.

The app points at the hosted **mahjhero-dev** project, which already has all 22 of
the branch's migrations. So this tests real code against the real schema.

**Setup, once (~10 min).**

- In the Supabase dashboard → Authentication → Users → *Add user*, create three
  extra accounts with **Auto Confirm** ticked (`you+a@…`, `+b`, `+c`). You need
  enough members to fill a table; you only have two hands.
- `npm run web`, sign in with a real address you can read — sign-in is a magic
  link, and the local stack's mail catcher is deliberately excluded, so the mail
  goes to real email. If the link does not return you to the app, that is the
  redirect allow-list: see `docs/auth-configuration.md`.
- Create a club, invite the three placeholders (they must be members before you
  can book on their behalf), and create a game for tomorrow evening with
  **1 table** — four seats.

**1. Two accounts racing one seat.**
Book two placeholders via "Bring someone" so the table sits at 3 of 4. Open the
event screen in two browsers signed in as different people, and tap the last empty
seat together.
*Expect:* exactly one wins. The loser reads *"That game filled up while you were
looking. Join the waitlist?"* — **not** "Could not reach MahjHero. Check your
connection." A connection message here means a refusal is being mis-mapped, which
is the bug class this branch fixed four separate times.

**2. A friend-booked seat, and its decline.**
Book a placeholder via "Bring someone", then sign in as them and open `/clubs`.
*Expect:* a "Your games" row reading *"[name] booked this for you"* with a
Decline. Decline it, then re-check the event screen — the seat is free and anyone
waiting is promoted **immediately**, not after a five-minute sweep.

**3. An offer end to end.** *The one that matters most.*
Fill all four seats. Then, as somebody with no seat, use "Bring someone" to
propose **yourself plus one other** — a group of two against zero seats, so you
are waitlisted. Now cancel one booking to free a single seat.
*Expect:* the booker gets an offer for **1 seat** with a countdown, on the event
screen and on "Your games". Accept it. **One of you is seated and the other is
still waitlisted, at the same place in the queue.** That is the rule the whole
design rests on, and this is the check that would most likely have caught the
waitlist livelock the final review found.

*Optional, to watch the livelock fix work:* in the SQL editor,
`update promotion_offers set expires_at = now() - interval '1 minute';` then
`select public.sweep_promotion_offers();`. Whoever is waiting *behind* the group
should get seated, and the group should keep its original position rather than
being handed the same seat forever.

**4. On a device.**
`npm run start`, scan the QR with Expo Go.
*Expect:* the seat grid legible at phone width. Are empty seats obviously
tappable at 18pt? Does a four-seat table wrap sanely? Is "Bring someone" reachable
without horizontal scrolling? Plan 3 shipped having never been run on a device,
and the seat grid is the densest thing this app draws.

Everything here writes to the dev project's data — harmless, but it is shared
state if anyone else is looking at it.

### [x] Check-in — the by-hand pass before plan 6's PR merges

Task 15's automated suites (contract + visual) cross the DB-client boundary and
baseline the door screen, but neither can see a real device tap, a real dropped
socket, or a real inbox — so this ran against the **local** stack
(`npx supabase start`), with a host and member account minted the same way
`e2e/session.ts` mints one, a web build served locally, and the browser driven
directly rather than through Playwright.

- **[x] Check-in off shows no trace.** A game with `check_in_required: false`
  renders no "Door list" button, no member control, on the event screen for
  either role. *One nuance:* the `/check-in` route itself is not gated on the
  flag — navigating to it directly still resolves, showing a permanently
  "Check-in is closed for this game" door (because `opensAt`/`closesAt` are
  never set) rather than a 404/redirect. Nobody is linked there, so this is a
  reachability footnote, not a leak — but worth knowing if a future task adds
  a route guard.
- **[x] Per-occurrence toggle scoping survives a series edit.** Turned check-in
  ON for one occurrence of a weekly series via the real edit screen ("This
  game" scope) — confirmed by database read (`check_in_required=t`,
  `overrides={check_in_required}`), and the door list link appeared on that
  occurrence's own event screen. Then edited the WHOLE series (a notes change,
  "The whole series" scope) and confirmed by a second database read that the
  toggled occurrence stayed `t` and the untouched occurrence and the series
  itself stayed `f`. `supabase/tests/database/fixtures/check_in_flag.test.sql`
  already pins this at the SQL layer (22 assertions); this closes the gap
  pgTAP cannot reach — the UI round trip that builds and sends the RPC calls.
- **[x] The door screen at 375px: sixteen names, four tables, no horizontal
  scroll.** Seeded 16 confirmed bookings (host + 15 members) across 4 tables
  on one check-in-required game and loaded `/check-in` at a 375px viewport.
  `document.documentElement.scrollWidth` measured exactly 375 — no overflow.
  All 16 names and both controls per row are visible descending the page; long
  names wrap to a second line rather than clipping or forcing a scrollbar.
- **[x] Tapping "Here" sixteen times feels instant.** Dispatched 16 real click
  events against the door screen's "Here" buttons back to back; every handler
  returned in under 1.3ms (the optimistic `setRows` update, not the network
  round trip), and all 16 `record_attendance` calls landed with `204`. No
  spinner blocks a subsequent tap — confirms the per-profile `busy` guard
  (check-in.tsx) actually decouples one person's write from the next.
- **[x] Killing the network mid-tap fails honestly, not silently.** Patched
  `window.fetch` to reject only `rpc/record_attendance` calls, then tapped
  "Not coming" for an unset row. Result: the row reverted to unset (not
  falsely marked either way), the summary counts stayed truthful, and the
  banner read *"Could not reach MahjHero. Check your connection and try
  again."* A database check confirmed no row was written — the failure never
  reached the server. Restored `fetch` and confirmed the same tap then
  succeeded normally. This is the exact gap the offline follow-up (queue +
  replay) exists to close — today a dropped connection loses the tap and
  says so, which is the honest failure mode the check above asked for.
- **[x] A decline reaches the host's email within a drain cycle.** As the
  member, declined a friend-booked seat. Confirmed a `notification_outbox` row
  landed immediately (`kind='booking_declined'`, `recipient_id` = the host).
  Ran the real `deliver-notifications` edge function against the local
  stack's Mailpit instance — first attempt hit a connection-class SMTP error
  (misconfigured host on my part, not the app) and correctly backed off
  (`connection_break_count` incremented, `next_attempt_at` pushed ~4 minutes
  out — the fix from "stop a poisoned SMTP connection… from dead-lettering the
  drain queue" working as designed); the retry succeeded and Mailpit shows the
  real message: subject *"Mel Member can't make Friend booked game"*,
  addressed to the host, `sent_at` stamped in the outbox row.
- **[x] The 24-hour tail.** Seeded a check-in-required game that started 8h ago
  and ended 5h ago. As the **host**: the door screen's controls are enabled
  (`aria-disabled` absent) and the event screen still offers "Door list" and
  "Edit this game" — the organizer window (`starts_at-1h .. ends_at+24h`) is
  still open. As the **member** on the same event: `CheckInControl` does not
  render at all (not merely disabled) — `memberCheckInOpen` (no organizer
  tail) reads closed, and `event.tsx`'s own conditional
  (`event.check_in_required && myBooking?.status === 'confirmed' &&
  memberCheckInOpen`) omits the control entirely, which is a stronger form of
  read-only than a greyed-out button.

No concerns for the reviewer beyond the one nuance noted above (the
unguarded `/check-in` route on a check-in-off event). Full detail, including
every command's output, lives in `.superpowers/sdd/task-15-report.md`.

---

## Nice to have

### [ ] Selectable themes — seasonal, beach, metro, cultural

Let a user pick a visual theme instead of the single fixed "Organic" palette.
Proposed sets:

- **Seasonal** — spring, summer, autumn, winter
- **Beach**
- **Metro** — NYC, Paris, London
- **Cultural** — Indian, Korean, Chinese

Deliberately parked as nice-to-have: it touches every screen, and the roadmap's
V1 wedge is scheduling. Worth doing once the palette stops moving.

**The blocker to know about up front.** `lib/theme.ts` is currently a set of frozen
constants, and ~23 files import `colors`/`space`/`type` into module-scope
`StyleSheet.create` calls (~20 of them). Module scope evaluates once at import, so
today's structure cannot swap a palette at runtime. Making themes selectable means
first moving to a `useTheme()` hook (or context) and building styles inside the
component. That refactor is the bulk of the work; the palettes themselves are cheap.

Other things to settle:

- **What varies per theme** — colours only, or also the display font? `type.heading`
  is Caprasimo; a Tokyo or Paris theme is much more convincing with a different face,
  but each font is an asset to load in `app/_layout.tsx` and a hit to startup.
- **Accessibility is the hard constraint, not decoration.** The comments in
  `lib/theme.ts` show the current palette's contrast was derived deliberately, and
  this player base skews older — 18pt body minimum, 16pt for helper text only. Every
  theme needs to clear contrast on its own; a pretty palette that fails on muted text
  is not shippable. Budget a contrast check per theme.
- **Cultural themes need care, not clip art.** Indian/Korean/Chinese themes drawn
  from stock motifs read as costume. If we ship these, they should be palette-led and
  worth showing to someone from that culture before release.
- **Where it's stored** — profile column (follows the user across devices) vs. local
  device setting. Profile is more consistent with identity-as-the-key, but it means a
  migration and a round trip before first paint.
- **Where it's picked** — a section on the profile screen is the obvious home.
- **Seasonal: manual or automatic?** Auto-switching by date is a cute touch but
  hemisphere-dependent, and surprising users with a changed app is a real risk. Manual
  pick, with the current season merely suggested, is safer.
- **Testing cost** — 22 Playwright visual baselines exist today
  (`e2e/visual.spec.ts-snapshots`). Do not multiply those by the number of themes.
  Keep visual coverage on one default theme and test the rest at the token layer
  (contrast assertions, every theme exports a complete token set).
