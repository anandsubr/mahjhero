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

### [ ] `app/clubs/index.tsx` has no page padding

"Your clubs" sits at x=0 with its ascenders touching the top edge, and the club
cards run to the viewport edge at 375px width — visible in every clubs baseline,
including the pre-existing ones this task didn't touch. Every other screen in the
app gets its side margins from `Screen`'s default content padding; this screen must
be opting out of it somewhere, or never had it. Regenerate the `clubs*` and
`clubs-populated-*` visual baselines afterwards.

### [ ] "Anything else? (optional)" label sits too tight under the Start time field

On both the create-game and edit-game screens, at both widths, the gap above the
notes label is noticeably smaller than every other label gap on the same screen.
Likely `TimeField.web.tsx`'s wrapper `flex: 1` inside the gapped column absorbing
less vertical space than the other field wrappers. Cosmetic; visible in the
`new-event-*` and `edit-event-*` baselines.

### [ ] "seats" is never singularised on the event detail screen

`app/clubs/[id]/events/[eventId]/index.tsx` (around line 252) renders
`` `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${seats} seats` ``
— the table count is singularised, the seat count never is. A single table of
capacity 1 would read "1 table · 1 seats". Unreachable through the UI today: table
capacity is not editable anywhere and every table is created at the default of 4, so
this has never actually been seen. Low priority; fix alongside anything else that
touches this line.

---

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
