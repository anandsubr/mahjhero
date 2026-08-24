# Testing

Five layers, each covering something the others structurally cannot.

| Layer | Runner | Covers | Blind to |
|---|---|---|---|
| Logic | Vitest | Pure functions in `lib/` | Anything rendered |
| Schema contract | Vitest + local Supabase | The DB↔client seam — column names, types, JSON shape | UI |
| Database | pgTAP | RLS policies, triggers, constraints | Everything above SQL |
| Component | Vitest + @testing-library/react | Screen structure, navigation, state transitions — of the **web** files (`.web.tsx` wins, same as the bundle) | Colour, layout, truncation, **and all native rendering — see below** |
| Visual | Playwright | Colour, layout, truncation, at real viewport widths | Logic, data, and native rendering (Chromium web only) |

Nothing in this table covers the native time or date pickers. See
"`@react-native-community/datetimepicker` has no coverage anywhere" below.

## Why the visual layer exists

Four rendering defects reached a human reviewer while all three original suites
were green: a missing back button that stranded users on the notifications
screen, a toggle knob rendering in a colour absent from the palette, a truncated
time label, and the layout stretching edge-to-edge on desktop. The component
layer catches the first. Nothing but the visual layer catches the rest.

## Why the threshold is an absolute pixel budget, not a ratio

`playwright.config.ts` sets `maxDiffPixels: 120` — a fixed count of differing
pixels, not `maxDiffPixelRatio`, a fraction of the page. It started as a ratio
(`maxDiffPixelRatio: 0.01`) and was changed after that ratio was shown,
empirically, not to catch the defect class this suite exists for.

A ratio scales with the size of the page, so it silently forgives small
elements: a 62×34 toggle knob is ~2,100px, and on a 375×812 mobile page that
is ~304,500px total, so the knob is only ~0.69% of the page — under a 1%
ratio. Proving this wasn't theoretical: a whole-theme accent-colour mutation
was run against the original `0.01` ratio and **passed** on
`notifications at mobile`, the exact page whose toggle-colour bug is why this
suite exists.

After switching to `maxDiffPixels: 120`, the same two mutations were re-run:

- The whole-theme accent mutation now fails all six baselines that existed
  when this was measured, with diffs ranging from 2,866px
  (`notifications-mobile`) to 24,330px (`notifications-desktop`) — every one
  far past the 120px budget.
- A narrower mutation, changing only the toggle track colour, fails both
  notifications baselines at 1,123px each. Under the old ratio, 1,123px is
  ~0.37% of the mobile page and ~0.28% of desktop — still comfortably under
  1%, so the ratio would have let this regression through too.

Re-measured against the baselines Task 17 added, on the only Toggle outside
the notifications screen that a baseline actually captures: changing the
toggle's on-track colour from `colors.accentColor` to an off-palette green
fails `edit-event-series-mobile` and `edit-event-series-desktop` at 1,126px
each, alongside the two notifications baselines — and nothing else in the
suite moves. That is the point of the seeded baselines: the defect class this
layer was built for now has a tripwire on a second screen.

**This is not the only Toggle outside notifications, only the only one in a
baseline.** `components/VenuePicker.tsx` renders a `Toggle`
("Other clubs can use this venue") in its "New venue" sub-form, reachable
from both the create-game and edit-game screens by typing a venue name that
matches nothing and choosing "Add". No seeded test enters that state, so this
control has zero visual coverage — listed under "Known visual gaps" below.

The lesson for future maintainers: do not "simplify" this back to a ratio to
make a large layout change stop tripping the suite. A ratio that is loose
enough to tolerate a full-page redesign is also loose enough to hide a single
mis-coloured control, which is precisely the failure mode this layer was
built to close.

## Why the pixel budget cannot catch a text regression, and what does

`maxDiffPixels: 120` is sized to stay under a control the size of a toggle
knob (above), and that same sizing has a consequence worth stating plainly:
**it is far too small to ever fail on a one-glyph text substitution.** A
single digit in this app's body type (18pt) is on the order of 16px tall;
measured across the baselines, substituting one digit for another changes
roughly 67–94 pixels — comfortably under the 120px budget on its own, before
antialiasing jitter even enters the picture. So a defect that swaps "2
tables" for "0 tables", or any other single-character text regression, cannot
make `toHaveScreenshot` fail. This is not a flaw to fix by lowering the
budget — a budget tight enough to catch a one-digit diff would also fail on
ordinary antialiasing jitter between machines, which is the opposite problem
this section already covers.

**Text regressions are caught by the `getByText`/`toBeVisible` preconditions
each test asserts before it screenshots, not by the pixel comparison.** Every
test in `e2e/visual.spec.ts` asserts on specific visible text before calling
`captureScreen` — `page.getByText('2 tables').first()` in `club detail`,
`page.getByText('Moved from the usual venue')` in `event detail`, and so on.
Those assertions fail outright, independent of any pixel budget, if the text
they name is wrong or absent. That is a deliberate division of labour: **a
baseline's job is colour, layout, and truncation — not the correctness of the
words on the page.** A baseline can prove "2 tables" renders in the right
place, in the right colour, without truncating; it takes a `getByText`
assertion to prove it says "2" and not "0". Task 17's Fix pass 1 found this
gap directly: the club-card table count (`toClubEvent`'s
`event_tables?.length ?? 0` mapping in `lib/events.ts`) had no assertion at
either the component or visual layer that could fail on it, and a
`table_count: 0` mutation passed all 293 Vitest tests and would have passed
the visual suite too, on pixels alone, until the `club detail` test gained
its own `getByText('2 tables')` precondition.

When adding a baseline for a screen whose text matters, add the
`getByText`/`toBeVisible` assertion for that text FIRST, then let the
screenshot cover appearance. Do not rely on the pixel comparison to catch a
wrong word, a wrong number, or a wrong pluralisation — it structurally
cannot, for exactly the arithmetic above.

## Which library, and why

`@testing-library/react` passed the spike; `@testing-library/react-native` did
not.

`vitest.config.mts` aliases `react-native` to `react-native-web`, so `<View>`
and `<Text>` from `react-native` resolve to plain DOM elements (`<div>`,
`<h1>` with `role="heading"`, etc.) under Vitest. `@testing-library/react`
queries that DOM directly with `render`/`screen.getByText`/`screen.getByRole`,
and both spike assertions pass with cleanup registered globally (see below).

`@testing-library/react-native` does not go through that DOM at all — it
renders through `react-test-renderer` against the real, native `react-native`
package, independent of the `react-native` → `react-native-web` alias. In this
repo that real package cannot even be loaded by Vitest's parser. The isolated
spike run failed with:

```
file:///Users/anandsubramanian/Documents/Claude/Projects/MahjongApp/node_modules/react-native/index.js:27
import typeof * as ReactNativePublicAPI from './index.js.flow';
       ^^^^^^

SyntaxError: Unexpected token 'typeof'
    at compileSourceTextModule (node:internal/modules/esm/utils:318:16)
    at ModuleLoader.importSyncForRequire (node:internal/modules/esm/loader:358:18)
    at loadESMFromCJS (node:internal/modules/cjs/loader:1649:24)
    ...
```

`react-native/index.js` is Flow-typed source (`import typeof * as X from
'./index.js.flow'` is Flow syntax, not valid JS), the same class of problem
the existing `resolve.alias` comment in `vitest.config.mts` already warns
about for plain imports of `react-native`. The alias only matches the exact
specifier `"react-native"`; `@testing-library/react-native` and its
dependencies reach into `react-native`'s internals in a way that resolves the
real package regardless, so the alias does not save it here. This was
reproduced identically with and without the alias applied (via `vite-node`
against `vitest.config.mts` directly), confirming it is not an artifact of how
the test was invoked.

One other finding from the spike, unrelated to which library won:
`@testing-library/react`'s automatic per-test cleanup only registers when it
detects a global `afterEach` function (`typeof afterEach === 'function'` in
its own source). This repo's Vitest config does not set `test.globals: true`,
so that global does not exist, and without cleanup being registered somewhere
DOM nodes from one test leak into the next, causing spurious "found multiple
elements" failures.

Cleanup is registered once, globally, in `vitest.setup.ts` (wired in via
`test.setupFiles` in `vitest.config.mts`) — component test authors do not
need to do anything themselves. `test.globals: true` was deliberately not
used for this, since it would inject Jest-style ambient globals across the
whole suite, including the existing `lib/` tests; `setupFiles` runs a single
module before each test file and registers one hook, with no such blast
radius.

## What the component layer does not cover

Component tests run under Vitest with `react-native` aliased to
`react-native-web` (see `vitest.config.mts`). That means every component test
exercises the **web render** of a screen — `<View>` and `<Text>` resolving to
`<div>`, `<h1 role="heading">`, and so on — not native iOS or Android
rendering. `@testing-library/react-native` was tried specifically to get
native coverage and could not be made to work at all in this repo: it fails
at parse time on Flow syntax inside `react-native`'s own internals, which the
`react-native-web` alias never intercepts (see above). There is currently no
substitute for it here.

**Consequence: genuine native rendering differences are uncovered by any
layer in this repo until Maestro simulator flows arrive in Phase 3.** A
passing component test says a screen's web DOM structure and state
transitions are correct; it says nothing about how that screen actually
paints on an iPhone or an Android device. Do not treat green component tests
as evidence that native rendering is fine.

One module is stubbed out for component tests, for the same Flow-parsing
reason as the `react-native` alias above, and so is untested at this layer:

- `react-native-svg` → `test/stubs/react-native-svg.tsx`, whose `Svg`,
  `Circle`, `Path`, etc. all render as a no-op passthrough. Real icon
  rendering is not exercised by component tests.

The visual layer does cover how `react-native-svg` paints: it has a real web
implementation, it is in the production web bundle, and the icons are visibly
present in the screenshots. Native icon rendering is still uncovered until
Maestro.

### `@react-native-community/datetimepicker` has no coverage anywhere

Read this before assuming otherwise — an earlier version of this document
claimed the visual layer covered it, and that claim was wrong.

`components/TimeField.web.tsx` and `components/DateField.web.tsx` both exist.
Metro's platform-extension resolution picks them for web builds, so **the web
bundle never imports `@react-native-community/datetimepicker` at all**. What
the visual layer's screenshots show under "Starts"/"Ends" is an
`<input type="time">` — a different control, from a different file, with a
different implementation. That is real coverage of `TimeField.web.tsx`, and no
coverage whatsoever of the native picker behind it.

**`DateField.web.tsx` now has coverage at both layers.**
`app/clubs/[id]/events/new.tsx` (Task 13) is the first
screen to import `DateField`, and `app/__tests__/events-new.test.tsx`
renders it, interacting with the "Date" and "Stop repeating on" fields
through `screen.getByLabelText` the same way the notifications screen's test
drives `TimeField.web.tsx`. Covered, specifically: the `<input type="date">`
markup resolves by `aria-label`; an ordinary onChange reaches the screen's
state (every date in that file is set this way, and the value shows up in the
`createEvent`/`createEventSeries` arguments); and the empty-string guard —
"clearing a date field" fires a `''` change and asserts the previously picked
date is still what the screen sends. That last one was an overclaim for one
commit: this paragraph named empty-string handling while nothing fired a
`''`, and deleting `if (event.target.value === '') return;` left the whole
suite green.

How the control paints is the visual layer's half, and as of Task 17 it has
it: `new-event-mobile` and `new-event-desktop` screenshot the create-game
screen with the "Date" field rendered and filled, at 375px and 1440px. What
those baselines cover is the field's own resting appearance — the pill
treatment `webInputStyle` applies, the calendar glyph the browser draws
inside it, and the value text. What they do **not** cover is the picker
*popup*: it is browser chrome rendered outside the page, so no screenshot of
this page can contain it, at any width. The "Stop repeating on" `DateField`
is not in a baseline either — it only renders on the create screen once a
repeat option is chosen, and on the edit screen only when "Runs indefinitely"
is switched off, and neither baseline is in that state. Check that this
paragraph is still true when you next touch this file.

The component layer does not reach them either. `resolve.extensions` in
`vitest.config.mts` makes Vitest resolve `.web.tsx` first, exactly as the web
bundle does, so `import TimeField from '../components/TimeField'` (and the
same for `DateField`) under Vitest loads the `.web.tsx` file. Nothing under
test imports the package. (This is why the old
`test/stubs/datetimepicker.tsx` stub was deleted: with web resolution in
place, no test pulls the package in, so there is nothing left to stub.)

**So: `@react-native-community/datetimepicker`, `components/TimeField.tsx`,
and `components/DateField.tsx` — the native picker and the two files that
drive it — are exercised by zero layers in this repo, and will stay that way
until Maestro.** An overclaim is worse than a gap: a gap gets filled, false
confidence does not.

### Which platform's files the component layer resolves

Vite has no notion of Metro's platform extensions on its own. Without help,
`import TimeField from '../components/TimeField'` under Vitest resolves
`components/TimeField.tsx` — the **native** file — even though everything else
about the test is a web render. That combination (the native `TimeField`'s iOS
branch with its picker stubbed to `null`) is one no shipped platform runs,
and it left `components/TimeField.web.tsx` — where the web truncation fix
actually lives — imported by no test at all.

`vitest.config.mts` therefore sets `resolve.extensions` with the `.web.*`
variants ahead of Vite's defaults. The component layer now resolves the same
files the web bundle ships, which is what "web render" above has always
claimed. Note this applies inside `node_modules` too, where several Expo and
React Native packages ship `.web.js` variants — again matching what the web
bundle does. If a future dependency bump makes a test fail on something that
looks like a wrong-platform import, this option is the first thing to check.

## Running

    npm test              # logic + component
    npm run test:contract # schema contract (needs the local stack)
    npm run test:concurrency # two clients racing for one seat (needs the local stack)
    npm run test:visual   # visual regression (needs the local stack)
    npm run test:db       # pgTAP, local (needs the local stack)
    npm run test:db:remote # pgTAP, against the linked project

`test:db:remote` runs only `supabase/tests/database/portable/` — the files that
assert privileges rather than behaviour. Those are the ones worth running
against the real project, because grants drift on hosted in ways they cannot
locally: Supabase's default privileges, dashboard changes and extension
installs all alter them with no migration to review. The `TRUNCATE`-bypasses-RLS
hole this project shipped for a week was invisible to every policy test and
would have been caught here.

The rest of the suite lives in `fixtures/` and runs locally only, because
creating a signed-in member means inserting into `auth.users` and the linked
project denies that. See `supabase/tests/database/README.md` for why granting
it would be the wrong fix.

## The booking concurrency suite

`lib/booking-concurrency.test.ts` is the one suite that proves two people
cannot take the same seat, and it is the only layer that can: pgTAP runs
every assertion inside one session, so it can check the RULES `commit_booking`
follows but never that two *simultaneous* callers actually serialize. This
test signs in two real users against the local stack and fires
`commit_booking` for the same one-seat table at the same moment — five times,
against five independent one-seat events, not once, because a single race is
"a coin this suite has watched land wrong" (see the file's own docblock for
the measured cold-start numbers behind that phrase, and why there is a
warm-up call before either racer's real request).

**What makes it red:** `commit_booking` takes `perform 1 from public.events
where id = target_event for update;` before it re-derives the seating plan —
that lock is the entire concurrency design (every seat-changing function
takes it before reading any count). Removing that one line from the live
local database and re-running `npm run test:concurrency` seats both racers
at the same 1-seat table — the exact double-booking the lock exists to
prevent — and the suite fails. Restore it with `npx supabase db reset`.

Needs the local stack, same as the schema-contract suite, and degrades to
skipped rather than failing when `npm test` runs it without one; `npm run
test:concurrency` sets `REQUIRE_LOCAL_SUPABASE=1` to make an unreachable
stack fatal instead, exactly as `test:contract` does.

## Prerequisites

Component and logic tests need nothing. The schema-contract and visual suites
need the local Supabase stack:

    npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit

Visual tests additionally need three environment variables, all printed by
`npx supabase status`:

    SUPABASE_LOCAL_URL=http://127.0.0.1:54321
    SUPABASE_LOCAL_ANON_KEY=<anon/publishable key from supabase status>
    SUPABASE_LOCAL_SERVICE_ROLE_KEY=<service_role key from supabase status>

The service_role key is for local test setup only. It bypasses RLS entirely and
must never reach the app bundle or a hosted project.

Export them in the shell that runs `npm run test:visual`. Nothing loads a
`.env` file for you — there is no dotenv wiring in this repo, deliberately, so
the keys live only in the shell that needs them.

If any of the three is unset, `playwright.config.ts` throws immediately and
names the missing variables. That check exists because the failure without it
was actively misleading: an unset variable is not an error to the shell, it
expands to the empty string, so `expo export` would spend minutes building a
bundle with an empty Supabase URL, `lib/supabase.ts`'s guard would throw in
the browser, and every test would fail on `toBeVisible` timeouts.
`mintSession`'s own guard would not fire either, because the URL it checks was
fine. Every symptom pointed at Playwright; the cause was a missing export.

**Visual tests run entirely against the local stack, not the hosted dev
project.** `playwright.config.ts` rebuilds the web bundle with the local URL and
anon key, overriding `.env.local` for that build. This is not incidental: a
session minted against one Supabase project is not valid for another, so
building against the hosted project would make every signed-in test fail to
authenticate — and the failure would look like a Playwright problem rather than
a configuration one.

### What the visual suite has baselines for, and what seeds them

Fourteen screens, each at 375×812 and 1440×900 — 28 baselines total:

- signed out: `sign-in`
- signed in, no club: `profile`, `notifications`, `clubs` (the empty state)
- signed in, with a seeded club: `clubs-populated`, `club-detail`,
  `event-detail`, `new-event`, `edit-event` ("This game" scope),
  `edit-event-series` ("The whole series" scope), `venues`
- signed in, with the booking-state fixtures (Task 15): `event-full`,
  `event-offer`, `event-needs-a-fourth`

Two of the five booking states this task adds do not get their own
baseline. A mixed table with room left and a friend-booked seat both land
on pages that already have baselines — `event-detail` (Riverside's own
seeded event) and `clubs-populated` (the "Your games" section of `/clubs`)
— so a separate `event-booking` or `your-games` screenshot would have
visited the exact same URL in the exact same seeded state and produced a
byte-identical PNG. Their distinguishing text is asserted inside
`event-detail`'s and `clubs-populated`'s own tests instead (see
`e2e/visual.spec.ts`); the states are still covered, just not by a second
copy of a picture that already exists under another name.

`mintSession` creates a brand-new user who belongs to no club, so everything
past `clubs` would have screenshotted an empty state or a redirect.
`seedClubWithEvent` in `e2e/session.ts` writes what they need: a club
(`Riverside Mah Jongg`, timezone `America/New_York`), a host membership, two
venues, a weekly Tuesday series, two of its occurrences — the first carrying
an `overrides` entry for `venue_id` — and two tables on each. It runs through
the same `adminClient` helper `mintSession` uses, which reads the
`service_role` key from the environment and refuses any URL whose parsed
hostname is not loopback. Nothing under `app/` or `lib/` may import that file.

#### The booking-state fixtures (Task 15)

The same `seedClubWithEvent` call also seats people into the games above, so
the new and existing baselines it touches are real seat grids and a real
waitlist rather than another empty state:

- **A mixed table** on Riverside's own seeded event — two of Table 1's four
  seats taken (the signed-in member and one filler profile), Table 2 full.
  This is also why `event-detail`'s own baseline grew: it is the same event,
  the same seat grid, the same waitlist panel. There is no separate
  `event-booking` baseline for this state — it would have visited the exact
  same URL in the exact same seeded state and produced a byte-identical
  PNG, so its distinguishing text ("You", "Priya Nair", "Bring someone",
  "2 seats free") is asserted inside the `event-detail` test itself.
- **Four one-off games in a SECOND club** ("Thursday Casuals"), not
  Riverside — `event full`, `event offer`, `event needs a fourth`, and the
  friend-booked game the `clubs-populated` baseline's "Your games" section
  needs. (There is no separate `your-games` baseline either, for the same
  byte-identical reason as `event-booking` above — see `clubs-populated`'s
  own test.) A second club, not a second event on Riverside, on purpose:
  Riverside's `club-detail` baseline lists every future event for its own
  club id with no status filter, so a near-term event added there would
  have silently become a third card on a baseline this task otherwise
  never touches.
- **Ten filler profiles** (five per club), created the same way
  `mintSession` creates its own user, purely so the seat grid shows real
  names instead of the roster's `Member` placeholder for an unset
  `display_name`. Reused freely across a club's own games — a booking's
  uniqueness is per EVENT, not global, so the same filler can hold a seat in
  more than one of a club's fixtures.

**Every seeded timestamp here is relative to a FIXED instant, never
`Date.now()` — the same rule `FIRST_OCCURRENCE`/`SECOND_OCCURRENCE` above
follow, extended to cover a second clock.** Two client-side rules read
`page.clock.setFixedTime`'s frozen value (`2026-08-22T16:00:00Z`, set before
`seedClubWithEvent` ever runs) rather than the real wall clock:
`needsAFourth` (`lib/bookings.ts`) needs its game to start within 48 hours of
"now" for the "Needs a 4th" call to render, and a promotion offer's countdown
(`offerCountdown`) is `expires_at` minus "now". `NEEDS_A_FOURTH_GAME`,
`FULL_GAME` and `OFFER_GAME` in `e2e/session.ts` are therefore all fixed
instants a day or so after that frozen value — close enough to be "soon" by
the frozen clock's own reckoning, on every run, forever — and
`OFFER_EXPIRES_AT` is a fixed offset from `OFFER_GAME`'s own `starts_at`
(15 minutes before it), not from `Date.now()`. The countdown renders the same
"2 hours 45 minutes left" today, tomorrow, and on every run after that.
`FRIEND_GAME` carries no such constraint — nothing about a friend-booked seat
is time-sensitive — so it keeps `FIRST_OCCURRENCE`'s own far-future (2099)
pattern instead.

**The frozen clock and the database's `now()` are two different clocks, and
different queries read different ones — this is worth knowing before adding
a sixth fixture.** `canBook`, `needsAFourth`, `fetchEvent` and `fetchOpenOffer`
all either take no time filter or read the CLIENT's clock (frozen, in the
browser), so they are exactly as durable as `FIRST_OCCURRENCE`'s 2099 dates:
never mind what day it really is. `my_upcoming_bookings`, by contrast, is a
`security definer` SQL function whose `e.starts_at > now()` filter runs
against the DATABASE server's REAL clock. That is why "Your games" shows
only two rows — the member's own Riverside booking and the friend-booked
game, both dated 2099 — and not a third for the held offer on "Offer night":
`OFFER_GAME`'s near-term date is, by design, close to the frozen clock's own
2026-08-22, which recedes further into the real past every day this suite
runs and so is permanently excluded from `my_upcoming_bookings`' real-time
filter. The offer itself is unaffected — `fetchOpenOffer` carries no time
filter at all, which is why `event offer`'s own baseline still shows it —
only an aggregate view built on `now()` loses it. A future fixture that
needs a near-term game to also appear in "Your games" (or any other
`now()`-filtered list) cannot use a date this close to the frozen clock.

**One rule, implemented twice, that must change together:** `needsAFourth` in
`lib/bookings.ts` and `need_a_fourth_stage` in
`supabase/migrations/20260825050000_need_a_fourth.sql` both encode "exactly
one seat short, and the game starts soon" — the client copy for what the
seat grid shows, the SQL copy for what `call_for_a_fourth` and the 15-minute
announcement job actually honour. They were already two copies before this
task; the `event needs a fourth` baseline is the first thing in this suite
that renders the client half at all, so a future change to either rule
needs the other one checked by hand, not just by this baseline going green.

Two properties of the fixtures decide what the baselines say, and both are
deliberate:

- **The club's timezone, not the machine's.** Every event time on these
  screens is rendered in the CLUB's zone. `America/New_York` is the fixture's
  choice; the seeded instants (fixed dates in 2099, so an "upcoming" filter
  keeps them and no baseline ages) are the 7pm those dates read as there.
- **The seeded event is a series occurrence, not a one-off.** A one-off shows
  no scope choice on the edit screen and no "Part of a series" line on the
  event screen, which would have left the branch's most complex UI with no
  picture of it.

**Three** things on these screens read the DEVICE clock, not one — a claim
this section previously understated. Besides the create-game screen's "Date"
field (opens on today), `fetchFutureOccurrenceCount` and
`fetchOverriddenOccurrences` in `lib/events.ts` both filter on client-side
`new Date().toISOString()`, which decides what the series-scope edit screen
lists as upcoming/customised, and the event screen's `canReset` gate compares
`event.starts_at` against `Date.now()` to decide whether "Reset to the
series" renders at all. All three feed the `edit-event-series` baseline (the
overridden-occurrences toggle text and the reset button's visibility on the
occurrence baselines) as well as `new-event`.

They do not move, and the fixture is why: the seeded occurrences sit in
2099, so "future" never flips regardless of what day the suite runs, and the
frozen clock (below) pins `Date.now()` itself besides. But all three run in
the SAME browser page, so the fix is one mechanism, not three: `page.clock.
setFixedTime` in the seeded `beforeEach` freezes `Date`/`Date.now()` for
whichever of them a given screen happens to call, not just the Date field.
`playwright.config.ts` additionally pins `use.timezoneId` (so the wall-clock
digits these produce do not depend on the machine) and `use.locale` (so the
separators and ordering those digits render in do not either — see that
file's comment). `new-event` asserts the Date field's resulting value
explicitly, so if the clock override or either pin stops applying, the suite
says so instead of leaving a baseline that rots overnight. A future
maintainer adding a screen that reads `Date.now()` should assume it needs
the same protection, not treat the Date field as the only such case.

**The `venues` baselines show two club-only venues and no shared one.**
`venues_public_name_idx` is unique on (name, locality) across public venues,
so a seeded public venue would collide on the second test of a run, and a
per-run suffix to dodge that would put a changing string in a baseline. The
"Other clubs can use this venue" copy is covered at the component layer
(`app/__tests__/venues.test.tsx`) and by no screenshot.

### Known visual gaps

States that render in this app but are in no baseline, gathered here so the
next person does not have to rediscover each one by reading a diff that never
comes:

- **`components/VenuePicker.tsx`'s "New venue" sub-form**, reachable from
  both the create-game and edit-game screens by typing a venue name that
  matches nothing and choosing "Add". It renders this suite's *other*
  `Toggle` ("Other clubs can use this venue") and the "Other clubs can use
  this venue" copy — both covered at the component layer
  (`app/__tests__/venues.test.tsx`) and by no screenshot. See "Why the
  threshold is an absolute pixel budget, not a ratio" above for why this
  specifically matters: it is the one other place in the app the
  wrong-coloured-Toggle defect class could recur unseen.
- **The `DateField` picker popup** — the calendar the browser opens when the
  "Date" field is tapped — is native browser chrome rendered outside the
  page's DOM. No screenshot of this page can ever contain it, at any width;
  what `new-event-*` covers is only the field's resting appearance (see
  "`@react-native-community/datetimepicker` has no coverage anywhere" above).
- **The "Stop repeating on" `DateField`** on both the create and edit
  screens. It only renders once a repeat option is chosen (create) or when
  "Runs indefinitely" is switched off (edit), and no seeded test puts either
  screen in that state.
- **The signed-in member view.** Every seeded baseline is the *organizer*
  view (the seeded membership is `host`); a plain member sees strictly less
  on the club-detail and event-detail screens, and that reduced layout has no
  baseline of its own. Covered at the component layer
  (`app/__tests__/clubs.test.tsx`, `events-detail.test.tsx`) but not visually.

### Side effects of `npm run test:visual`

Two things worth knowing before you run it:

- **It overwrites `dist/`.** The suite's `webServer` command runs
  `expo export -p web`, which replaces `dist/` with a bundle pointing at
  **localhost** Supabase. If you were holding a `dist/` built for anything
  else — a deploy candidate, a hosted-project build — it is gone, and the
  bundle now sitting there must not be shipped. `dist/` is gitignored, so
  nothing warns you. Rebuild before deploying.
- **It always rebuilds, and it will not share port 4173.** See below.

### Why the suite never reuses a running server

`webServer.reuseExistingServer` is `false`, unconditionally — including
locally, where Playwright's usual advice is the opposite.

The reason is that `webServer.command` is `expo export && serve dist`. Reuse
skips the *whole command*, so it does not merely reuse a server: it skips the
build. An orphaned `serve` on 4173 — left by a killed run, or by something
else on that port — would make the suite validate whatever `dist/` happened to
contain from an earlier build, and pass. That is a false green in the one
layer whose entire job is preventing false greens, and it is invisible: the
run just looks fast and normal.

With reuse off, a busy port fails loudly (`http://127.0.0.1:4173 is already
used`). Kill the stray `serve` and re-run. The cost is a full `expo export`
every run, which is the honest price of this layer.

Moving only the export into `globalSetup` was tried and does not work:
Playwright runs webServer plugins **before** `globalSetup`, so `serve` would
start against a `dist/` that had not been rebuilt — and on a fresh checkout,
where `dist/` does not exist at all, fail outright. Putting the export at the
top of `playwright.config.ts` fails differently: Playwright re-evaluates that
file in every worker process, so the export would run once per worker.

### Why the visual suite resizes the viewport

`fullPage: true` does nothing in this app, and relying on it left a baseline
silently truncated for real.

`components/Screen.tsx` renders through a react-native-web `ScrollView`, which
does not scroll the document — it scrolls an inner `overflow: auto` div. So
`document.scrollHeight` always equals the viewport height and `fullPage` has
nothing extra to capture. Every baseline came out exactly viewport-sized, and
`notifications-mobile` stopped part-way through the "Mute" card: **the Save
button was not in the baseline at all**, on the one screen this suite was
built for, at the width where the original truncation defect happened.

Screenshotting a locator instead does not fix it, and this was measured rather
than assumed. `locator.screenshot()` on the ScrollView returns its border box
(375×812 — the same truncation). On its inner content container it returns the
full 375×907, but the bottom 95px come back blank white: the ancestor's
`overflow: auto` clips them, and capturing beyond the viewport does not undo
that. A baseline that is the right size and blank where the content belongs is
worse than an obviously short one.

So `e2e/visual.spec.ts` measures the scroller (`components/Screen.tsx` carries
a `testID="screen-scroll"` purely so the test can find it — no behaviour is
attached) and grows the viewport height to fit before shooting. Nothing about
the render changes: these screens lay out top-down, so a taller window reveals
the rest without moving anything above it. Width, which is what every layout
defect in this app's history turned on, stays at the device value. Screens
that already fit are not resized, so `sign-in`, `profile`, `clubs` and
`venues` baselines remain at true device dimensions. The taller ones grow:
`notifications-mobile` to 375×907, and every screen Task 17 added a baseline
for except the two `venues` ones and the two `clubs-populated` ones — up to
375×1404 for `event-detail-mobile`.

One screen this measurement does **not** protect: `app/clubs/index.tsx`
renders `Screen` WITHOUT `scroll`, so there is no `screen-scroll` element to
measure and `document.scrollHeight` stays at the viewport height. Its content
fits today (`clubs` and `clubs-populated`, one club), and a list long enough
to overflow would be clipped by the outer `flex: 1` View rather than growing
the capture. If that screen ever gains enough rows to scroll, give it
`scroll` before trusting its baseline.

A baseline's height is therefore content-dependent. That is deliberate: if a
screen grows or shrinks, Playwright reports a size mismatch, which is a diff,
which is the point.

## Updating visual baselines

When a design change is intentional:

    npx playwright test --update-snapshots

Then **look at every changed PNG** before committing. Review them in the pull
request like any other change — a baseline regenerated without being examined
turns a regression into the new expected state.

**`--update-snapshots` does not rewrite a baseline whose diff is under
`maxDiffPixels`.** It compares first and only writes when the comparison
fails, so a change small enough to fit inside the 120px budget leaves the old
PNG in place and reports a pass. This is not hypothetical: Task 17 changed a
fixture so a club card read "2 tables" instead of "0 tables", re-ran with
`--update-snapshots`, and got a green run and an unchanged baseline — one
digit is under 120 pixels. If you know the render changed and the file did
not, delete the PNG and re-run (missing snapshots are always written), or
pass `--update-snapshots=all`.

## When a visual test fails

Read the diff image in `test-results/` first. Raising `maxDiffPixels` to
make a failure go away defeats the layer's only purpose — see "Why the
threshold is an absolute pixel budget, not a ratio" above for what that
threshold protects against. If a diff is genuinely non-deterministic, mask
that region instead.

**If the failure is intermittent, suspect `settle()`'s `waitForTimeout(300)`
in `e2e/visual.spec.ts` first.** It is the only wall-clock-dependent step in
the suite — a fixed sleep after `document.fonts.ready`, covering the last
paint as fonts swap in. On a loaded or slower machine that 300ms can expire
before the final paint, which shows up as a hairline diff on text or an icon
edge. Raise the timeout; do not raise `maxDiffPixels`.

A size mismatch rather than a pixel diff is a different signal: the screen's
content height changed. See "Why the visual suite resizes the viewport".

## Scheduled work

`pg_cron` runs the nightly job that keeps recurring events materialized about
six weeks ahead. It was verified on both the local stack and the hosted
project before anything depended on it — `shared_preload_libraries` contains
`pg_cron` in both, `create extension pg_cron` succeeds and persists in both,
and `cron.schedule`/`cron.unschedule` round-trip as `postgres` (the role the
local stack and `supabase db push` both connect as).

That round-trip does **not** work as `cli_login_postgres`, the restricted
role `supabase test db --linked` provisions for pgTAP runs against the hosted
project (see `supabase/tests/database/README.md`). It has no `USAGE` on the
`cron` schema the extension owns —
`has_schema_privilege(current_user, 'cron', 'USAGE')` returns `false` — and
scheduling fails with `permission denied for schema cron`, the same error a
plain `select count(*) from cron.job` gets. pgTAP's own
`has_table('cron', 'job', ...)` still passes for this role, because that
check reads `pg_class`/`pg_namespace` directly, which every role can see
regardless of schema `USAGE`: the row is visible in the catalog even though
the role cannot query the table itself. The distinction was confirmed with a
temporary pgTAP probe run via
`npx supabase test db --linked supabase/tests/database/portable`, deleted
after use — not checked in, since it exists to answer this one question, not
to run on every suite invocation.

This is not the same situation as the missing `USAGE` on `extensions`
documented in that README, and does not call for the same fix. That grant was
load-bearing: without it, `plan()` itself did not resolve, so every file in
`portable/` failed before a single assertion ran — the whole hosted suite was
dead without it. A `cron` grant would not do that; it would upgrade one
already-passing suite by one convenience assertion, nothing more. It also
would not change what actually schedules the job: `supabase db push` applies
migrations as `postgres`, which owns the `cron` schema outright as the role
that created it, so `cron.schedule` in a later migration needs no grant on
`cli_login_postgres` to run. The precedent this follows instead is the `auth`
schema one in `supabase/tests/database/README.md`: migrations are
forward-only and apply to every environment, so a grant added purely for test
convenience ships permanently to production, whatever it grants. There the
stakes were high — `INSERT` on `auth.users` would be a writable path into the
real user table. Here the stakes are much lower — `USAGE` on `cron` only
exposes visibility into a job schedule — but the same principle applies at a
smaller scale: a grant that exists only to make one optional assertion pass
in an otherwise-green suite is not worth adding to every environment forever,
so this gap stays as a documented limitation rather than a grant.

The job is `materialize-event-series`, defined in
`20260823060000_schedule_materialize_event_series.sql`. It calls
`public.materialize_event_series()`, which is ordinary SQL — so it is tested
by pgTAP calling it directly, with no HTTP, no secrets, and no Edge Function
in the loop. To run it by hand:

    select public.materialize_event_series();

Inspect the schedule with `select * from cron.job;` and its history with
`select * from cron.job_run_details order by start_time desc limit 20;`.

The sweep wraps each series in its own exception block (see
`20260823000000_harden_event_series_materialization.sql`), so one club's bad
data — a timezone the `clubs_validate_timezone` trigger didn't exist to
reject when the row was written, a venue deleted out from under a series,
anything else `materialize_one_series` can throw on — is skipped rather than
rolling back the whole run. The skip is not silent: it `raise warning`s the
series id, title, club id, and the underlying error before moving on. A
`WARNING` raised inside a function called by `cron.schedule` does not go
anywhere a client would see it; it lands in `cron.job_run_details.return_message`
for that run (`cli_login_postgres` cannot read that table — see above — so
this is a `postgres`/dashboard-only inspection) and in the Postgres server
log for whichever environment ran it. Nobody currently polls either one, so
today a skipped series is discoverable but not alerted on.

Five jobs now run on `pg_cron`:

| Job | Schedule | What it does |
|---|---|---|
| `materialize-event-series` | `0 3 * * *` | Keeps ~6 weeks of recurring events materialized |
| `sweep-promotion-offers` | `*/5 * * * *` | Expires promotion offers past `expires_at`, releases their held seats, and promotes the next eligible group |
| `announce-need-a-fourth` | `*/15 * * * *` | Writes `notification_outbox` rows for tables at `capacity - 1` inside the 48-hour window |
| `queue-event-reminders` | `*/15 * * * *` | Writes `notification_outbox` rows at each club's configured reminder offsets |
| `deliver-notifications` | `* * * * *` | Drains the outbox by POSTing to the `deliver-notifications` Edge Function |

Four of these five are ordinary plpgsql and are tested by **calling them**,
not by waiting for a schedule. `sweep_promotion_offers()`,
`announce_need_a_fourth()` and `queue_event_reminders()` each return a
count, so a fixture can assert what a run did rather than inspecting
`cron.job_run_details` — which the hosted suite could not read anyway.

The fifth, `deliver-notifications`, is not plpgsql at all — `pg_cron` POSTs
to an Edge Function through `pg_net` rather than calling a function in the
database, so "call it and assert what it did" doesn't apply the same way.
It's covered separately, in "The notification drain" below.

**Waitlist promotion is not on this list, and that is deliberate.** It runs
inline inside whichever transaction frees a seat. The sweep calls it too,
but only after expiring an offer; if you find yourself adding a "promote the
waitlist" job, something inline has stopped calling `promote_waitlist`.

`sweep_promotion_offers` and `announce_need_a_fourth` are also the first two
scheduled-job functions revoked from `authenticated` explicitly, in
`20260825060000_schedule_booking_jobs.sql`. Their own migrations
(`20260825010000`, `20260825050000`) only revoke `from public, anon` — the
same shape of gap `reflow_events_for_timezone`, `assert_club_organizer` and
`event_series_detach_occurrences` each hit before them, where a hosted
bootstrap grant of EXECUTE directly to `authenticated` survived a `revoke
... from public` that looked complete against the local stack. Neither
function takes a caller argument or checks membership, so `authenticated`
reaching either would be a real hole, not a theoretical one.

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
database container cannot reach the host loopback by that name. This was
verified directly: seeding `app_config` and waiting for the minute tick
shows `deliver-notifications` receiving the POST (the outbox row's
`attempts` advances) at that URL and not at `127.0.0.1:54321`.

The Edge Function container has the identical problem one layer further
in. It talks to Mailpit over real SMTP rather than HTTP, and
`host.docker.internal` inside its container resolves but does not route
anywhere reachable — connecting to it times out. What does work is the
Supabase CLI's own Docker network: `supabase functions serve` and the
`inbucket` (Mailpit) container it starts alongside it share
`supabase_network_<project>`, where the compose network gives `inbucket`
as a resolvable alias for the SMTP port 1025 the container listens on
internally — not the host-mapped `54325`. So `supabase/functions/.env.local`
sets `SMTP_HOST=inbucket` and `SMTP_PORT=1025`, not the values from step 3
of the Task 11 brief; `docker inspect <edge runtime container> --format
'{{json .NetworkSettings.Networks}}'` is how that alias was found rather
than assumed.

That reachability fix uncovered a real bug, not an infrastructure one:
every real send to Mailpit failed with `Connection is not secure! Don't
send authentication over non secure connection!`, from
[denomailer's `client.ts`](https://deno.land/x/denomailer@1.6.0/client/basic/client.ts).
The message names authentication, but the check that throws it
(`!this.config.debug.allowUnsecure && !this.secure`) fires regardless of
whether credentials are being sent — it is denomailer's blanket refusal to
finish a handshake that ended up neither on implicit TLS nor upgraded via
STARTTLS, and Mailpit offers neither. `smtp.ts` never set
`debug.allowUnsecure`, so this path was unreachable in every test the
function has, all of which fake the SMTP layer — the real `SMTPClient`
never ran a real send until this task's end-to-end check, which is what
caught it.

The first fix tried tied `allowUnsecure` to whether credentials were being
sent (`allowUnsecure: !this.config.user`), on the theory that a production
relay always gets `SMTP_USER`. Commit `96c70af` replaced that: credential
presence is the wrong invariant to gate plaintext on, because nothing
stops `SMTP_USER` from being empty against a real, non-local relay — a
typo in `npx supabase secrets set`, an intentionally anonymous relay, a
future config nobody has written yet — and that gap would have sent
member content in plaintext to a host the fix was never meant to trust.
`smtp.ts` gates on **host trust** instead
(`isLocalDevHost(this.config.host) && !this.config.user`): an unsecured
connection is only ever permitted to a host on `LOCAL_DEV_SMTP_HOSTS` —
Mailpit's own hostnames, a fixed allowlist rather than a heuristic — and
the credential check stays as a second, independent condition on top of
that, which is what guarantees a password can never cross the socket
whenever the flag is permitted. A production relay on 465 or 587 is
already secure (implicit TLS, or the STARTTLS upgrade denomailer
negotiates for itself before this check ever runs) regardless of the
flag, so nothing about a real deployment's security posture changes;
see `smtp.ts`'s own comment on `allowUnsecure` for the full reasoning.

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
