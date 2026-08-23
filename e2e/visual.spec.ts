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
 * A baseline's height is therefore content-dependent. That is intentional:
 * if a screen grows or shrinks, Playwright reports a size mismatch, which is
 * a diff, which is the point.
 */
async function captureScreen(page: Page, vp: Viewport, name: string) {
  await settle(page);

  // Measure only after fonts have landed — text reflow changes the height.
  const needed = await page.evaluate((selector) => {
    const scroller = document.querySelector(selector);
    return Math.max(
      scroller ? scroller.scrollHeight : 0,
      document.documentElement.scrollHeight,
    );
  }, SCROLLER);

  if (needed > vp.height) {
    await page.setViewportSize({ width: vp.width, height: Math.ceil(needed) });
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

    // The EMPTY state, and it stays that way: this block's user belongs to no
    // club. The seeding hook lives in the nested describe below precisely so
    // that adding populated baselines could not quietly turn this one into a
    // second picture of the populated list.
    test(`clubs at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/clubs');
      await expect(page.getByText('Your clubs')).toBeVisible();
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
    let seeded: { clubId: string; eventId: string; seriesId: string };

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
        await expect(page.getByText('Riverside Mah Jongg')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Start another club' }),
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
      // is the only place in the app outside the notifications screen where a
      // Toggle paints — the control whose wrong-coloured knob is why this
      // suite exists at all.
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
    }
  });
});
