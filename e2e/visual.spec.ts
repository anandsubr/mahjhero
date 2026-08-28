import { expect, test, type Page } from '@playwright/test';
import { mintSession, seedClubWithEvent, storageKeyFor } from './session';

// The LOCAL stack — the same project the bundle was built against in
// playwright.config.ts. Deliberately not EXPO_PUBLIC_SUPABASE_URL, which
// .env.local points at the hosted dev project; a session minted locally is
// not valid there, and the storage key would not match either.
const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? '';

type Viewport = { name: string; width: number; height: number };

const WIDTHS: Viewport[] = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** components/Screen.tsx puts this on the ScrollView it renders in `scroll` mode. */
const SCROLLER = '[data-testid="screen-scroll"]';

/** Fonts are fetched, so a screenshot taken before they land is a false diff. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The one deliberate sleep in this suite, covering the last paint after
  // fonts swap in. If a baseline ever starts flaking on a hairline of text
  // or an icon edge, suspect this number FIRST — it is the only
  // wall-clock-dependent step here. Raise it before touching maxDiffPixels.
  await page.waitForTimeout(300);
}

/**
 * Grows the viewport until the whole screen fits inside it, then screenshots.
 *
 * `fullPage: true` is a no-op in this app and used to give a silently
 * truncated baseline. components/Screen.tsx renders through a
 * react-native-web `ScrollView`, which does not scroll the document — it
 * scrolls an inner `overflow: auto` div. `document.scrollHeight` therefore
 * always equals the viewport height, so `fullPage` had nothing extra to
 * capture and every baseline came out exactly viewport-sized. The
 * notifications-mobile baseline stopped part-way through the "Mute" card and
 * did not contain the Save button at all — on the very screen this suite was
 * built for, at the width where the original truncation defect happened.
 *
 * Screenshotting a locator instead does NOT fix it. That was tried and
 * measured: `locator.screenshot()` on the ScrollView returns the border box
 * (375x812, same truncation), and on its inner content container it returns
 * the full 375x907 — but the bottom 95px come back blank white, because the
 * ancestor's `overflow: auto` clips them in the compositor and capturing
 * beyond the viewport does not undo that. A baseline that is the right size
 * and blank where the content should be is worse than an obviously short one.
 *
 * So the viewport itself is grown to the content height. Nothing about the
 * render changes: these screens lay out top-down from the content column, so
 * a taller window reveals the rest without moving anything above it. Width —
 * which is what every layout defect in this app's history turned on — is left
 * exactly at the device value. Screens that already fit (sign-in, which
 * `Screen` renders as a plain View and vertically centres) are not resized at
 * all, so their baselines stay at true device dimensions.
 *
 * The amount grown is the scroller's OVERFLOW — scrollHeight minus its own
 * clientHeight — not its scrollHeight outright. components/Screen.tsx renders
 * the bottom tab bar as a flex SIBLING of the scroller (`tabShellBody` holds
 * the scroller, `tabBarColumn` holds the bar), not inside it, so on any
 * tab-bar screen the scroller's clientHeight is already short by the bar's
 * height. Growing the viewport to scrollHeight outright reproduces that same
 * shortfall one level up and clips the last of the content — exactly what
 * happened to the committed profile-mobile baseline, which came out missing
 * its Sign out button. Adding the overflow to the CURRENT viewport height
 * instead accounts for whatever space is already spoken for outside the
 * scroller, whatever it is, so it isn't tied to the tab bar specifically. For
 * a screen with nothing outside the scroller, clientHeight already equals the
 * viewport height, so this yields the same number the old content-height
 * check did — those baselines do not move.
 *
 * A baseline's height is therefore content-dependent. That is intentional:
 * if a screen grows or shrinks, Playwright reports a size mismatch, which is
 * a diff, which is the point.
 */
async function captureScreen(page: Page, vp: Viewport, name: string) {
  await settle(page);

  // Grow-and-resettle can itself introduce a little more overflow (a taller
  // window can reflow text), so repeat the measurement until it settles.
  // Bounded rather than looped to convergence: a screen that never settles
  // should fail loudly, not hang the suite.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Measure only after fonts have landed — text reflow changes the height.
    const overflow = await page.evaluate((selector) => {
      const scroller = document.querySelector(selector);
      const scrollerOverflow = scroller
        ? scroller.scrollHeight - scroller.clientHeight
        : 0;
      const docOverflow =
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight;
      return Math.max(scrollerOverflow, docOverflow, 0);
    }, SCROLLER);

    if (overflow <= 0) break;

    const vpNow = page.viewportSize() ?? vp;
    await page.setViewportSize({
      width: vp.width,
      height: vpNow.height + Math.ceil(overflow),
    });
    // Re-settle: the resize triggers a relayout and a fresh paint.
    await settle(page);
  }

  await expect(page).toHaveScreenshot(name);
}

test.describe('signed out', () => {
  for (const vp of WIDTHS) {
    test(`sign-in at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/sign-in');
      await expect(page.getByText('Sign in to MahjHero')).toBeVisible();
      await captureScreen(page, vp, `sign-in-${vp.name}.png`);
    });
  }
});

test.describe('signed in', () => {
  // Captured by the mint hook below and read by the nested "with a seeded
  // club" block's own hook. A fresh user per test, so nothing one test writes
  // can reach another.
  let userId: string;

  test.beforeEach(async ({ page }) => {
    const session = await mintSession(`visual-${Date.now()}@example.com`);
    userId = session.user_id;
    const key = storageKeyFor(SUPABASE_URL);
    await page.addInitScript(
      ([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)),
      [
        key,
        {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
        },
      ] as const,
    );
  });

  for (const vp of WIDTHS) {
    test(`profile at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/profile');
      await expect(page.getByText('Your profile')).toBeVisible();
      await captureScreen(page, vp, `profile-${vp.name}.png`);
    });

    test(`notifications at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/notifications');
      await expect(page.getByText('How should we reach you?')).toBeVisible();
      await captureScreen(page, vp, `notifications-${vp.name}.png`);
    });

    // The fourth tab destination. Anchored on the body copy, NOT on the
    // "Messages" heading: the tab bar this screen renders carries a
    // "Messages" label too, so the heading is two matches and Playwright's
    // strict mode would make it a hard failure — the same collision the
    // `clubs at …` test below hit on "Your clubs".
    test(`messages at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/messages');
      await expect(
        page.getByText('Club messages are on the way.'),
      ).toBeVisible();
      await captureScreen(page, vp, `messages-${vp.name}.png`);
    });

    // The EMPTY state: this block's user belongs to no club, so there are
    // neither friends nor anybody to add. Anchored on the intro copy rather
    // than the "Friends" heading — not because of a same-page collision like
    // the `messages` and `clubs` tests above (this page navigates fully, so
    // Profile isn't rendered, and app/friends.tsx has exactly one "Friends"
    // string and no tab bar), but because the intro copy is simply the more
    // specific anchor for this screen's empty state.
    test(`friends at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/friends');
      await expect(
        page.getByText('These are the people you can hold seats with'),
      ).toBeVisible();
      await captureScreen(page, vp, `friends-${vp.name}.png`);
    });

    // The EMPTY state, and it stays that way: this block's user belongs to no
    // club. The seeding hook lives in the nested describe below precisely so
    // that adding populated baselines could not quietly turn this one into a
    // second picture of the populated list.
    test(`clubs at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/clubs');
      // `.first()` — "Your clubs" now renders TWICE on this screen: once as
      // DashboardHeader's kicker (headerScope's all-clubs scope, lib/dashboard.ts)
      // and once as the club-list section title. Both are real, and Playwright's
      // strict mode turns the bare locator into a hard failure rather than a
      // stale baseline. The unit suite had to switch to `findAllByText` for
      // exactly this reason; this line only needs to know the screen painted.
      await expect(page.getByText('Your clubs').first()).toBeVisible();
      // The brief's literal snippet uses `toHaveScreenshot(..., { fullPage:
      // true })`, but `captureScreen`'s own doc comment above explains why
      // that option is a no-op against this app's ScrollView-based layout
      // and previously produced a truncated notifications-mobile baseline
      // that cut off the Save button. Using captureScreen here instead
      // keeps the clubs baseline from repeating that exact defect.
      await captureScreen(page, vp, `clubs-${vp.name}.png`);
    });
  }

  /**
   * Everything below needs data on screen to be worth a picture.
   *
   * `mintSession` creates a user who belongs to no club, so without this hook
   * the club, event, create-game, edit and venues screens would all screenshot
   * an empty state or a redirect — a baseline of nothing, which would then be
   * the expected state for every future run.
   *
   * The seed runs in a NESTED hook rather than the outer one on purpose: the
   * `clubs at …` baseline above is deliberately the empty state, and seeding
   * one level up would have silently replaced it.
   *
   * See `seedClubWithEvent` in e2e/session.ts for what the fixtures are and
   * why — in particular that the club's timezone (America/New_York) is what
   * every time on these screens is rendered in, and that the seeded event is a
   * series occurrence with a venue override rather than a one-off.
   */
  test.describe('with a seeded club', () => {
    let seeded: Awaited<ReturnType<typeof seedClubWithEvent>>;

    test.beforeEach(async ({ page }) => {
      // Freezes the page's clock BEFORE anything navigates.
      //
      // `app/clubs/[id]/events/new.tsx` opens its Date field on
      // `dateToDateString(new Date())` — today. The first run of this suite
      // duly baked "08/22/2026" into `new-event-*.png`, which would have
      // failed the very next day and every day after, for no reason anyone
      // could have read off the diff. A fixture that is only stable on the
      // afternoon it was generated is not a baseline.
      //
      // `setFixedTime` rather than `install`: it only pins what `Date.now()`
      // and `new Date()` return, leaving real timers running. A full fake
      // clock would stall the app's own timeouts and supabase-js's refresh
      // scheduling. The instant chosen sits in the past relative to any real
      // run, so the injected session's `expires_at` (computed from the real
      // clock, in Node) still reads as comfortably in the future to the
      // client and no spurious token refresh is triggered.
      await page.clock.setFixedTime(new Date('2026-08-22T16:00:00Z'));
      seeded = await seedClubWithEvent(userId);
    });

    for (const vp of WIDTHS) {
      // The clubs LIST with cards in it. Task 11 fixed the spacing bug
      // todo.md reported — "no space between the last club and the Start
      // another club button" — but could only regenerate the EMPTY-state
      // baseline, because nothing seeded a club at that point. So the state
      // the bug was actually reported against had never been screenshotted.
      test(`clubs list with a club at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/clubs');
        // `.first()` — Task 15's booking fixtures give the signed-in member
        // a confirmed seat in this club's own seeded game, so "Riverside
        // Mah Jongg" now also renders a second time as that booking's club
        // name inside the "Your games" card above this list. Both are real;
        // this line only needs to know the club list itself still has one.
        await expect(page.getByText('Riverside Mah Jongg').first()).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Start another club' }),
        ).toBeVisible();
        // The "Your games" section above the club list: one game the
        // member booked themselves (Riverside's own seeded event above)
        // and one a friend booked for them (`seedBookings`'s
        // `friendEventId`, under the second club). This is the same
        // `/clubs` page in the same seeded state a dedicated `your games`
        // baseline would have shot — there is no such baseline, since it
        // could only ever be byte-identical to this one — so its anchors
        // live here instead. A third card — the held offer — also lands
        // here via the same `my_upcoming_bookings` query; that is a real
        // consequence of seeding the offer as the member's OWN group (see
        // the `event offer` test's own comment on why it has to be), not
        // a fixture bug, so this only anchors on the two rows the brief
        // actually asks for.
        await expect(page.getByText('Your games')).toBeVisible();
        // `.first()`, for the same reason as the club name above. Riverside
        // seeds TWO occurrences of "Tuesday night mahjong" and the member is
        // booked on only the first; `buildDashboardRows` (lib/dashboard.ts)
        // now also lists open events the member is not in, so the second
        // occurrence renders a second time as a joinable Join row. Both are
        // real; this line only needs to know the booked row is there.
        await expect(page.getByText('Tuesday night mahjong').first()).toBeVisible();
        await expect(
          page.getByText('Owen Bradley booked this for you'),
        ).toBeVisible();
        await captureScreen(page, vp, `clubs-populated-${vp.name}.png`);
      });

      test(`club detail at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}`);
        // Both seeded occurrences, not just the section heading: the roster
        // and invite controls render underneath regardless of whether the
        // events fetch has landed, so waiting on "Upcoming" alone would
        // happily shoot a screen with the games still missing. Anchored on
        // the two venue names — one per card — rather than on the formatted
        // date, because the abbreviation Intl produces for September ("Sep"
        // vs "Sept") differs between ICU builds and would make this assertion
        // a portability trap rather than a check.
        await expect(page.getByText('Newton Community Centre')).toBeVisible();
        await expect(page.getByText('St Mary’s Hall')).toBeVisible();
        // `exact` because Playwright's string matcher is case-insensitive and
        // this screen's failure copy — "Could not load upcoming games." —
        // would otherwise match too, turning a red test into an ambiguity
        // error that names the wrong problem.
        await expect(page.getByText('Upcoming', { exact: true })).toBeVisible();
        // The table count on each card, as text — not just as pixels.
        // `toClubEvent` in lib/events.ts derives this from the embedded
        // `event_tables` array (`event_tables?.length ?? 0`), and nothing
        // else in the suite pins that mapping: a mutation collapsing it to a
        // constant 0 still produces "0 tables", a one-digit change that fits
        // well inside the 120px `maxDiffPixels` budget and so cannot fail the
        // screenshot comparison (see docs/testing.md, "Why the threshold is
        // an absolute pixel budget"). Both seeded occurrences have 2 tables,
        // so `.first()` is enough to catch the mapper regressing without
        // needing to disambiguate the two cards.
        await expect(page.getByText('2 tables').first()).toBeVisible();
        await captureScreen(page, vp, `club-detail-${vp.name}.png`);
      });

      test(`event detail at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/events/${seeded.eventId}`);
        await expect(page.getByText('2 tables · 8 seats')).toBeVisible();
        // The override annotation and the series line are the two things this
        // screen does that no other does; if either were missing the capture
        // would still "pass" on the seats line alone.
        await expect(page.getByText('Moved from the usual venue')).toBeVisible();
        await expect(page.getByText('Every Tuesday')).toBeVisible();
        // Table 1's own booking state (Task 15): two of four seats taken
        // (the signed-in member and one other), room left, and the
        // per-table "Bring someone" both this table and the screen-level
        // entry point offer. This is the same page a dedicated `event
        // booking` baseline would have shot — same club, same event, same
        // seeded state — so there is no such baseline; it could only ever
        // be byte-identical to this one. `exact: true` on the role query
        // is load-bearing — TableCard's own "Bring someone" button carries
        // the accessible name "Bring someone to Table 1", not the bare
        // "Bring someone" the screen-level button uses, so without `exact`
        // this would still resolve to one match by luck rather than by the
        // query actually being specific. `.first()` on Priya's name — kept
        // even though the seat-tap redesign means her name now renders only
        // ONCE on a fresh load (the old HostSeating component used to
        // render it a second time, in its own always-visible "Move to …" /
        // "Remove from game" controls; that list is gone, replaced by a
        // panel that only appears once an organizer taps her specific
        // seat — see .superpowers/sdd/seat-tap-host-controls.md). `.first()`
        // is harmless on a single match and keeps this assertion robust if
        // that ever changes again.
        await expect(page.getByText('You', { exact: true })).toBeVisible();
        await expect(page.getByText('Priya Nair').first()).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Bring someone', exact: true }),
        ).toBeVisible();
        await expect(page.getByText('2 seats free')).toBeVisible();
        await captureScreen(page, vp, `event-detail-${vp.name}.png`);
      });

      test(`new event at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/events/new`);
        await expect(page.getByText('Add a game')).toBeVisible();
        // The frozen clock, asserted rather than assumed. This screen's Date
        // field opens on "today", and this is the only baseline in the suite
        // whose content depends on when it was taken — if the clock override
        // or the pinned `timezoneId` ever stops applying, this line says so
        // instead of leaving a baseline that quietly rots overnight.
        await expect(page.getByLabel('Date')).toHaveValue('2026-08-22');
        await captureScreen(page, vp, `new-event-${vp.name}.png`);
      });

      // Two baselines for this screen, because it is two screens wearing one
      // route. The scope buttons swap the entire form between an
      // occurrence-scoped and a series-scoped snapshot, and the series scope
      // is the only place a Toggle paints in any BASELINE outside the
      // notifications screen — the control whose wrong-coloured knob is why
      // this suite exists at all. It is not the only place a Toggle exists
      // outside notifications: components/VenuePicker.tsx's "New venue"
      // sub-form has one too, unreached by any seeded test here — see
      // docs/testing.md, "Known visual gaps".
      test(`edit event, this game, at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.clubId}/events/${seeded.eventId}/edit`,
        );
        await expect(
          page.getByRole('button', { name: 'The whole series' }),
        ).toBeVisible();
        await captureScreen(page, vp, `edit-event-${vp.name}.png`);
      });

      test(`edit event, whole series, at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.clubId}/events/${seeded.eventId}/edit`,
        );
        await page.getByRole('button', { name: 'The whole series' }).click();
        await expect(
          page.getByText('This series runs indefinitely.'),
        ).toBeVisible();
        // The overridden-occurrences toggle only renders when the series has
        // a customised week to apply the edit to — the seeded first
        // occurrence is that week.
        await expect(
          page.getByText('Also apply this edit to the 1 game'),
        ).toBeVisible();
        await captureScreen(page, vp, `edit-event-series-${vp.name}.png`);
      });

      test(`venues at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/venues`);
        // Both venue names first, and only then the heading.
        //
        // This screen sets `ready` off the club/roster fetch alone, while the
        // venue list loads separately — so there is a real window in which it
        // renders "No venues yet. The first one is added when you create a
        // game." for a club that has two. Waiting on the heading alone caught
        // that window and shot the empty state (it also went ambiguous:
        // Playwright's string matcher is case-insensitive and "No venues yet"
        // matched "Venues" too, which is how this surfaced). Anchoring on
        // content that only exists once the fetch has landed is what makes
        // this baseline a picture of the loaded screen every time.
        await expect(page.getByText('St Mary’s Hall')).toBeVisible();
        await expect(page.getByText('Newton Community Centre')).toBeVisible();
        await expect(page.getByText('Venues', { exact: true })).toBeVisible();
        await captureScreen(page, vp, `venues-${vp.name}.png`);
      });

      /*
       * Five booking states, from `seedBookings` in e2e/session.ts (see
       * that file's own comment for why four of these five games live in
       * a SECOND club rather than Riverside), captured across the three
       * NEW baselines below plus two that already existed. There is no
       * dedicated `event booking` or `your games` baseline: both would
       * have visited the exact same URL, in the exact same seeded state,
       * as `event detail` and `clubs list with a club` respectively — the
       * fixtures are seeded once per `describe`, so two tests hitting the
       * same route in the same state can only ever produce byte-identical
       * PNGs. Their text anchors were folded into those two tests instead
       * (see each test's own comment below); the states themselves are
       * still fully covered, just not by a second copy of the same
       * picture under a different name. Every test anchors on the text
       * that actually distinguishes its state before shooting — "pixels
       * cannot catch a one-glyph regression" (docs/testing.md) — because
       * none of the numbers below are things `toHaveScreenshot` itself
       * could ever fail on.
       */

      // Every seat at the game's one table taken by someone else — so the
      // signed-in member holds no seat and "Join the waitlist" renders —
      // plus one more person already queued, so WaitlistPanel's "Waiting
      // for a seat" card has content rather than being the empty return
      // `null` its own guard produces.
      test(`event full at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.bookingClubId}/events/${seeded.fullEventId}`,
        );
        // TableCard now says "Full" rather than "0 seats free" (seatsFreeLabel,
        // lib/bookings.ts) -- a bare zero-count sentence nobody writes.
        // `exact: true` is load-bearing: this event's own title is "Full
        // house game" (bookingClubId fixture), which also matches a bare
        // substring search.
        await expect(page.getByText('Full', { exact: true })).toBeVisible();
        await expect(page.getByText('Waiting for a seat')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Join the waitlist' }),
        ).toBeVisible();
        await captureScreen(page, vp, `event-full-${vp.name}.png`);
      });

      // The signed-in member's own group, waitlisted, with a promotion
      // offer already outstanding for it — `fetchOpenOffer`'s RLS policy
      // only surfaces an offer to a member of the group it was made to, so
      // this is the one booking-state game where the member holds the
      // waitlisted seat rather than a filler profile. The countdown text
      // is fixed relative to OFFER_GAME's own starts_at and the suite's
      // frozen clock (see e2e/session.ts) — not Date.now() — so it reads
      // the same "2 hours 45 minutes left" on every run, forever, rather
      // than counting down for real or reading "Expired" the next time
      // anyone looks at this baseline. `getByText`, not `getByRole`, for
      // the accept button: its accessible name is "Take the 1 seat"
      // (WaitlistPanel builds that from `offer.seats`), which differs from
      // the VISIBLE "Take the seat" this line actually checks.
      test(`event offer at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.bookingClubId}/events/${seeded.offerEventId}`,
        );
        await expect(
          page.getByText('1 seat is free for your group'),
        ).toBeVisible();
        await expect(page.getByText('2 hours 45 minutes left')).toBeVisible();
        await expect(page.getByText('Take the seat')).toBeVisible();
        await captureScreen(page, vp, `event-offer-${vp.name}.png`);
      });

      // One table, three of its four seats taken by people who are not the
      // signed-in member, inside `needsAFourth`'s 48-hour window — and the
      // signed-in member is this club's host, so the event screen's own
      // early "Call for a 4th now" control renders too, not just the Tag.
      // "1 seat free", not "3 seats free": `needsAFourth`'s own definition
      // (lib/bookings.ts) is `confirmed === capacity - 1`, which on a
      // 4-seat table always leaves exactly one seat, never three — the
      // brief's own example snippet uses "3 seats free" only to illustrate
      // the anchor-before-capture PATTERN, not this table's actual count.
      test(`event needs a fourth at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.bookingClubId}/events/${seeded.needsAFourthEventId}`,
        );
        await expect(page.getByText('Needs a 4th')).toBeVisible();
        await expect(page.getByText('1 seat free')).toBeVisible();
        await expect(page.getByText('Last seat')).toBeVisible();
        await expect(page.getByText('Call for a 4th now')).toBeVisible();
        await captureScreen(page, vp, `event-needs-a-fourth-${vp.name}.png`);
      });

      // Anchored on the recipient count, not the heading. The count is
      // fetched after mount (app/clubs/[id]/broadcast.tsx's useEffect), so a
      // screenshot taken on first paint would catch "Working out who this
      // reaches…" and the baseline would be a race. The regex matches both
      // the singular and plural copy — Riverside's only active member here
      // is the signed-in host themselves, so `countBroadcastRecipients`
      // (which excludes the caller) resolves to 0, and "This goes to 0
      // members, by email." is the real, correctly-loaded state, not a
      // stand-in for a failure.
      test(`broadcast compose at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/broadcast`);
        await expect(page.getByText(/goes to \d+ member/)).toBeVisible();
        await captureScreen(page, vp, `broadcast-compose-${vp.name}.png`);
      });

      // 'Doors at seven' is the seeded broadcast's subject (e2e/session.ts).
      test(`broadcast history at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/broadcasts`);
        await expect(page.getByText('Doors at seven')).toBeVisible();
        await captureScreen(page, vp, `broadcast-history-${vp.name}.png`);
      });

      // The organizer's door screen (Task 15). `seeded.checkInEventId`
      // (e2e/session.ts) puts one person in each of the three render groups
      // — a table assignment, an "Any table" confirmed booking, and a
      // walk-in with no booking at all — plus two pre-recorded states (one
      // arrived, one no_show), so this baseline shows both of
      // CheckInControl's selected-chip colours, not just its unset default.
      //
      // Anchored on names, not the "Check-in" heading — the `venues at …`
      // test's own comment explains why: this screen's groups render off
      // three fetches that resolve after mount (`load()`, check-in.tsx), so
      // waiting on the heading alone could shoot the screen before any group
      // had actually painted. Wei Chen anchors Table 1, Leo Fitzgerald
      // anchors the Walk-ins group specifically — that section only renders
      // once its own array is non-empty, so waiting on the group heading
      // alone would not prove a walk-in ROW is on screen, only that the
      // heading is.
      test(`check-in door at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.clubId}/events/${seeded.checkInEventId}/check-in`,
        );
        await expect(page.getByText('Wei Chen')).toBeVisible();
        await expect(page.getByText('Leo Fitzgerald')).toBeVisible();
        await expect(page.getByText(/booked here/)).toBeVisible();
        await captureScreen(page, vp, `check-in-${vp.name}.png`);
      });
    }
  });
});
