import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  mintSession,
  seedClubWithEvent,
  seedEmptyGroupThread,
  seedMessageCandidates,
  seedOpenSeatingEvent,
  seedPopulatedBoard,
  seedPopulatedMessagesList,
  seedPopulatedThread,
  seedTableWithRound,
  seedThreadWithAttachments,
  seedUnreadClubMessage,
  setDismissedGuides,
  storageKeyFor,
} from './session';

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

/**
 * `extraMask` for the club settings baseline, which shows the club's own
 * code as plain text next to a "Change" button (no icon of its own).
 * `suggest_club_code` (20260929100000_club_codes.sql) appends a RANDOM
 * 3-digit suffix to the club's name on every insert, same as `profile`'s
 * per-run email or `check-in`'s per-run avatar colour -- so the text differs
 * on every run that reseeds the club, and an unmasked screenshot would fail
 * the very next run against its own just-written baseline. `text=/Club
 * code:/` matches the whole "Club code: XXXX" string as ONE node (`Text`'s
 * children collapse into a single text node on web), so this masks the
 * digits regardless of how many the suffix ends up being.
 */
const CLUB_CODE_MASK = ['text=/Club code:/'];

/**
 * `extraMask` for every OTHER club-hub baseline (Games/Board/Ranks/Photos/
 * Members) -- these all render the code through `ClubHubHeader` instead,
 * where masking the code text alone was NOT enough: a first pass using
 * `CLUB_CODE_MASK` here still flaked on immediate re-run, isolated (per the
 * diff PNG) to the Share pill right next to it, not the masked text. That
 * pill's `ShareIcon` is an inline SVG, the same sub-pixel-jitter class the
 * `thread-avatar-club-tile` global mask above already exists for -- so
 * this masks the whole row (`testID="club-hub-code-row"`,
 * components/hub/ClubHubHeader.tsx) rather than only the code text.
 */
const CLUB_HUB_HEADER_CODE_ROW_MASK = ['[data-testid="club-hub-code-row"]'];

/** Fonts are fetched, so a screenshot taken before they land is a false diff. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The one deliberate sleep in this suite, covering the last paint after
  // fonts swap in. If a baseline ever starts flaking on a hairline of text
  // or an icon edge, suspect this number FIRST — it is the only
  // wall-clock-dependent step here. Raise it before touching maxDiffPixels.
  await page.waitForTimeout(500);
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
 * an optional footer as a flex SIBLING of the scroller (`footerShellBody`
 * holds the scroller, `footerColumn` holds the footer), not inside it, so on
 * any screen with a footer the scroller's clientHeight is already short by
 * the footer's height. (The global bottom tab bar this used to describe is
 * gone — every screen now renders through the plain `footer` slot, which is
 * absent far more often than not.) Growing the viewport to scrollHeight
 * outright reproduces that same shortfall one level up and clips the last of
 * the content — exactly what happened to the committed profile-mobile
 * baseline, which came out missing its Sign out button. Adding the overflow
 * to the CURRENT viewport height instead accounts for whatever space is
 * already spoken for outside the scroller, whatever it is, so it isn't tied
 * to any one footer. For a screen with nothing outside the scroller,
 * clientHeight already equals the viewport height, so this yields the same
 * number the old content-height check did — those baselines do not move.
 *
 * A baseline's height is therefore content-dependent. That is intentional:
 * if a screen grows or shrinks, Playwright reports a size mismatch, which is
 * a diff, which is the point.
 */
async function captureScreen(
  page: Page,
  vp: Viewport,
  name: string,
  extraMask: string[] = [],
) {
  await settle(page);

  // Grow-and-resettle can itself introduce a little more overflow (a taller
  // window can reflow text), so repeat the measurement until it settles.
  // Bounded to 3 iterations to prevent hanging. An assertion after the loop
  // fails loudly if a screen never settles, ensuring a test failure instead
  // of a truncated PNG baseline on first generation.
  let overflow = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Measure only after fonts have landed — text reflow changes the height.
    overflow = await page.evaluate((selector) => {
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

  expect(overflow <= 0, `Screen "${name}" never stopped overflowing (overflow: ${overflow}px)`).toBe(true);

  await expect(page).toHaveScreenshot(name, {
    // The club-tile glyph (components/ThreadAvatar.tsx's `asTile` branch,
    // testID="thread-avatar-club-tile") renders with genuine run-to-run
    // sub-pixel jitter, independent of any real content change — confirmed
    // by regenerating a baseline fresh and immediately re-running against
    // it, same session, no code change in between: still failed most of
    // the time at this suite's maxDiffPixels budget, isolated entirely to
    // that one glyph in every diff image (2026-09-05,
    // feat/invite-only-games). Masking it here is the fix
    // maxDiffPixels's own comment asks for, rather than a wider tolerance
    // that would blunt this suite everywhere. A no-op on any screen that
    // doesn't render the tile.
    //
    // `extraMask` layers in additional per-call CSS selectors for the same
    // class of sub-pixel SVG jitter on a screen-specific element, without
    // widening this global list — a global addition would shift the masked
    // region on every other baseline that uses captureScreen, forcing a
    // regeneration of all of them instead of just the one screen that
    // actually needs it. No current caller needs it (the dashboard's
    // club-chip glyphs this was added for, components/ClubChips.tsx, no
    // longer exist), but the mechanism stays for the next screen-specific
    // jitter case.
    mask: [
      page.locator('[data-testid="thread-avatar-club-tile"]'),
      ...extraMask.map((selector) => page.locator(selector)),
    ],
  });
}

/**
 * A service-role client for the one fixture below that this file seeds
 * directly rather than through e2e/session.ts (`seedJoinableOpenSeatingEvent`
 * just below). Mirrors `adminClient` in e2e/session.ts exactly, including its
 * local-only hostname guard — a substring check on the URL is foolable
 * (`https://notlocalhost.evil.example.com` contains "localhost"), so the
 * parsed hostname is compared exactly, same as there. Not imported from that
 * file because `adminClient` isn't exported, and this task's brief scopes
 * every change to this one file.
 */
function fixtureAdminClient() {
  const url = process.env.SUPABASE_LOCAL_URL;
  const serviceRole = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      'Set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY. Both are ' +
        'printed by `npx supabase start`. Never use hosted-project values here.',
    );
  }
  const hostname = new URL(url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`Refusing to seed fixtures against a non-local URL: ${url}`);
  }
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Seeds a SECOND open-seating event — published, starting well after the
 * suite's frozen clock, with the host holding no booking of their own — so
 * `canJoinOpenSeating` (app/clubs/[id]/events/[eventId]/index.tsx) can
 * actually be true for a screenshot.
 *
 * `seedOpenSeatingEvent` (e2e/session.ts) cannot be reused for this. Its one
 * event is deliberately windowed to be mid-check-in AT the frozen clock
 * (`starts_at` 15:45, `ends_at` 19:45, against a 16:00 "now") — the
 * `check-in door, open seating` baseline needs that window open. But that
 * also means `canBook` (`event.status === 'published' && starts_at > now`)
 * is already false there, for every viewer, host included — which is what
 * actually keeps the "Join" button off the `open-seating event detail`
 * baseline above, not a booking already held by the viewer, as it first
 * looked. This fixture is a plain published event dated the day after that
 * one, still well before it starts, with nobody but one other member booked
 * — so `canBook` is true and the host (who never gets a booking of their own
 * in either fixture) has `myHoldsSeat === false`.
 *
 * Written directly against the local stack with service_role, the same
 * pattern and the same local-only guard (`fixtureAdminClient` above) every
 * fixture in e2e/session.ts uses for the same reason: service_role carries
 * no JWT, so the app's own RPCs have no `auth.uid()` to check against. This
 * lives here rather than in that file only because this task's brief scopes
 * changes to this one file.
 */
async function seedJoinableOpenSeatingEvent(
  clubId: string,
  hostProfileId: string,
  suffix: string,
): Promise<{ eventId: string; capacity: number; signupName: string }> {
  const admin = fixtureAdminClient();

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(
        `seedJoinableOpenSeatingEvent: ${what} failed: ${JSON.stringify(result.error)}`,
      );
    }
    return result.data as T;
  };

  const venue = need<{ id: string }>(
    'venue insert',
    await admin
      .from('venues')
      .insert({
        name: 'Willow Park Hall',
        address_line: '3 Willow Park Avenue',
        locality: 'Newton',
        added_by_club_id: clubId,
        created_by: hostProfileId,
      })
      .select('id')
      .single(),
  );

  const capacity = 30;

  const event = need<{ id: string }>(
    'event insert',
    await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Saturday open house mahjong',
        venue_id: venue.id,
        notes: '',
        // A day after the suite's frozen clock (2026-08-22T16:00:00Z) — well
        // inside `canBook`'s "not yet started" window, unlike
        // `seedOpenSeatingEvent`'s own event (see this function's own doc
        // comment above).
        starts_at: '2026-08-23T20:00:00Z',
        ends_at: '2026-08-23T23:00:00Z',
        seating_mode: 'open_seating',
        capacity,
        fee_cents: 1000,
        created_by: hostProfileId,
      })
      .select('id')
      .single(),
  );
  const eventId = event.id;

  // One other confirmed signup — NOT the host — so the roster card shows a
  // real name instead of the bare "Nobody has signed up yet." empty state,
  // while the host (this screenshot's own viewer) still holds no booking at
  // all, which is the whole point of this fixture.
  const signupName = 'Priya Okafor';
  const { data: signupUser, error: signupUserError } = await admin.auth.admin.createUser({
    email: `joinable-signup-${suffix}@example.com`,
    email_confirm: true,
  });
  if (signupUserError || !signupUser.user) {
    throw new Error(
      `seedJoinableOpenSeatingEvent: signup profile create failed: ${JSON.stringify(signupUserError)}`,
    );
  }
  const { error: profileError } = await admin
    .from('profiles')
    .update({ display_name: signupName, skill_level: 'intermediate' })
    .eq('id', signupUser.user.id);
  if (profileError) {
    throw new Error(
      `seedJoinableOpenSeatingEvent: signup profile update failed: ${JSON.stringify(profileError)}`,
    );
  }

  const group = need<{ id: string }>(
    'booking group insert',
    await admin
      .from('booking_groups')
      .insert({
        event_id: eventId,
        club_id: clubId,
        created_by: signupUser.user.id,
        preferred_table_id: null,
        status: 'confirmed',
        waitlisted_at: null,
      })
      .select('id')
      .single(),
  );
  const { error: bookingError } = await admin.from('bookings').insert({
    group_id: group.id,
    event_id: eventId,
    club_id: clubId,
    event_table_id: null,
    profile_id: signupUser.user.id,
    booked_by: signupUser.user.id,
    status: 'confirmed',
  });
  if (bookingError) {
    throw new Error(
      `seedJoinableOpenSeatingEvent: booking insert failed: ${JSON.stringify(bookingError)}`,
    );
  }

  return { eventId, capacity, signupName };
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
    // First-run guidance predates almost every baseline in this file. This
    // user belongs to no club yet, so this only dismisses the static keys —
    // the nested `with a seeded club` hook below calls it again once this
    // user hosts a club, to also cover that club's host checklist.
    await setDismissedGuides(userId, 'all');
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
      await expect(page.getByText('About you')).toBeVisible();
      await captureScreen(page, vp, `profile-${vp.name}.png`);
    });

    test(`new club at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/clubs/new');
      await expect(page.getByText('Add a short description')).toBeVisible();
      await captureScreen(page, vp, `new-club-${vp.name}.png`);
    });

    test(`notifications at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/notifications');
      await expect(page.getByText('How should we reach you?')).toBeVisible();
      await captureScreen(page, vp, `notifications-${vp.name}.png`);
    });

    // The empty conversations list. Anchored on the body copy rather than
    // the "Messages" heading purely because it's the more specific empty-
    // state text; the global tab bar this comment used to warn about (its
    // own "Messages" label collided with this screen's heading) is gone, so
    // the heading is unique here now.
    test(`messages at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/messages');
      await expect(
        page.getByText('No conversations yet. Start one with the + above.'),
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

    // The GENUINELY-EMPTY picker: this block's user belongs to no club, so
    // `fetchFriends` and `fetchAddablePeople` both come back `[]` rather
    // than failing -- a real state, not a fixture accident, and one every
    // member sees at least once (their first visit, before joining a club
    // or adding a friend). Worth its own baseline for exactly the reason
    // this task exists: before Task 16 this was the ONLY thing `message-new`
    // ever pictured, by accident, because nothing distinguished it from a
    // still-loading or failed-fetch screen. Now that the populated picker
    // has its own baseline (`with a seeded club`'s `new message` test
    // below), this one keeps the honest-empty-state copy under regression
    // instead of losing coverage of it entirely.
    test(`message-new empty at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/messages/new');
      await expect(
        page.getByText('Nobody to message yet. Add a friend or join a club to find people to message.'),
      ).toBeVisible();
      await captureScreen(page, vp, `message-new-empty-${vp.name}.png`);
    });

    // The EMPTY state, and it stays that way: this block's user belongs to no
    // club and has no games, so `homeDefault` (lib/home.ts) picks the Clubs
    // view by default and this screenshots it directly, no switch click
    // needed. The seeding hook lives in the nested describe below precisely
    // so that adding populated baselines could not quietly turn this one
    // into a second picture of the populated screen. Replaces the old
    // dashboard's `clubs at …` baseline — `app/clubs/index.tsx` and the
    // global tab bar it rendered through are both gone; Home
    // (`app/home.tsx`) is what every signed-in baseline now starts from.
    test(`home empty at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/home');
      await expect(page.getByText('Join a club')).toBeVisible();
      await captureScreen(page, vp, `home-empty-${vp.name}.png`);
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
   * `home empty at …` baseline above is deliberately the empty state, and
   * seeding one level up would have silently replaced it.
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
      // Re-dismiss with 'all' now that this user hosts Riverside and
      // Thursday Casuals — both clubs' `host-checklist:<id>` keys need to be
      // in `dismissed_guides` too, or every baseline below would grow a
      // checklist card that predates this feature.
      await setDismissedGuides(userId, 'all');
    });

    for (const vp of WIDTHS) {
      // The populated My games list — Home's default view once there is at
      // least one upcoming game (`homeDefault`, lib/home.ts), replacing the
      // old dashboard's `clubs list with a club at …` baseline
      // (`clubs-populated-*.png`).
      //
      // Anchored on "Offer night" (Thursday Casuals), NOT on any Riverside
      // game — checked against the real screen rather than assumed, and
      // worth recording why none of Riverside's own seeded games make this
      // list. `public.my_games` (20260929100100_home_feeds.sql) windows
      // every row to `[from_ts, to_ts)`, and Home's own `loadFeed` calls it
      // with a 120-day window starting at "now" (the page's frozen clock,
      // 2026-08-22T16:00:00Z). Riverside's own series occurrences
      // (FIRST_OCCURRENCE/SECOND_OCCURRENCE, e2e/session.ts) are dated 2099
      // specifically so the OLD dashboard's unbounded `my_upcoming_bookings`
      // query would never age them out — the same 2099 dates fall outside
      // this new 120-day window, so neither occurrence renders here. The
      // only OTHER Riverside event `seedClubWithEvent` seeds,
      // `checkInEventId` ("Door check-in night"), starts at 15:45 — 15
      // minutes BEFORE the frozen clock — so `starts_at >= from_ts` excludes
      // it too. What actually lands in this 120-day window is the
      // booking-state fixtures under the SECOND club, Thursday Casuals,
      // which `my_games` includes as "hosting" rows regardless of whether
      // the signed-in member holds a seat.
      //
      // `extraMask`'s selector here (and on every other Home test below that
      // renders a club's glyph tile — GameRow's club line, ClubCard) masks
      // the whole MahjongTile (components/MahjongTile.tsx) that DIRECTLY
      // contains a `glyph-<suit>` testID node, for the same reason
      // `captureScreen`'s global mask exists for `thread-avatar-club-tile`:
      // confirmed by reading the diff PNG rather than assumed. The glyph
      // testID alone was tried first and was not enough — the diff isolated
      // to a thin ring right at the tile's own rounded corner and
      // border-bottom "lip", outside the glyph element's own bounding box,
      // so the CSS `:has()` selector reaches one level up to the tile View
      // that actually paints that edge. Scoped per-call rather than added to
      // the global list, same reasoning as that one's own comment: a global
      // addition would shift the masked region on every baseline that uses
      // captureScreen, not just the ones that actually render a small club
      // glyph tile.
      test(`home my games at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/home');
        await expect(page.getByText('Offer night')).toBeVisible();
        await captureScreen(page, vp, `home-my-games-${vp.name}.png`, [
          'div:has(> [data-testid^="glyph-"])',
        ]);
      });

      // The Calendar half of My games — the month card (dots per club,
      // today's ring, the selected day highlighted) and the selected day's
      // games underneath. "Next month" is the anchor because it exists the
      // moment the calendar mounts, before any month's games have to load.
      // `extraMask` here masks club glyph jitter — see `home my games`'s own
      // comment above.
      test(`home calendar at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/home');
        await page.getByRole('button', { name: 'Calendar' }).click();
        await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();
        await captureScreen(page, vp, `home-calendar-${vp.name}.png`, [
          'div:has(> [data-testid^="glyph-"])',
        ]);
      });

      // The Clubs view: "Join a club", then a card per club the member
      // belongs to (Riverside Mah Jongg, Thursday Casuals) — reached via the
      // switch rather than being the default here, since this block's user
      // has upcoming games and so lands on My games first. `extraMask` here
      // masks club glyph jitter — see `home my games`'s own comment above.
      test(`home clubs at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/home');
        await page.getByRole('button', { name: /^Clubs/ }).click();
        await expect(page.getByText('Riverside Mah Jongg')).toBeVisible();
        await captureScreen(page, vp, `home-clubs-${vp.name}.png`, [
          'div:has(> [data-testid^="glyph-"])',
        ]);
      });

      // The club hub's Games section (app/clubs/[id]/(hub)/games.tsx), the
      // hub's default landing section, replacing the old club-detail screen
      // (app/clubs/[id]/index.tsx, now a redirect to `.../games`) that the
      // `club detail` baseline used to picture. Lands on "Upcoming" by
      // default (`GamesSection`'s own initial `segment` state) -- pictured
      // here rather than "All" or "Past" because that is what an organizer
      // or member actually sees first.
      //
      // Deliberately the EMPTY state, checked against the real screen rather
      // than assumed, for the same reason `home my games`'s own comment
      // above gives for Home: `fetchClubGames`'s "upcoming" window is
      // `[now, now+120d)` against the page's frozen clock (2026-08-22), and
      // every event `seedClubWithEvent` seeds on THIS club falls outside it
      // -- FIRST_OCCURRENCE/SECOND_OCCURRENCE are dated 2099 (deliberately,
      // for the OLD unbounded query the redirect's predecessor used) and
      // `checkInEventId` starts 15 minutes BEFORE the frozen clock, so it
      // only ever shows on "Past". A populated Upcoming list is already
      // pictured for a DIFFERENT club, Thursday Casuals, by `home my games`
      // and the `event *` baselines below -- this section's own
      // rendering (the segmented control, the pinned "Add to calendar" /
      // "New game" footer, host-only) is what is actually new here, and the
      // empty state's "New game" button is the host-only affordance this
      // baseline would otherwise never show.
      test(`club games at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/games`);
        await expect(page.getByText('Riverside Mah Jongg', { exact: true })).toBeVisible();
        await expect(page.getByText('Club code:')).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Upcoming', selected: true })).toBeVisible();
        await expect(page.getByText('No games here yet.')).toBeVisible();
        // Two "New game" buttons render at once here: the empty state's own
        // (host-only) and the pinned footer's, which is always there
        // regardless of segment. `.first()` -- the empty-state one -- is
        // proof the empty state itself renders the host affordance, not
        // just the footer.
        await expect(page.getByRole('button', { name: 'New game' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
        // `CLUB_HUB_HEADER_CODE_ROW_MASK` -- see its own comment below.
        await captureScreen(page, vp, `club-games-${vp.name}.png`, CLUB_HUB_HEADER_CODE_ROW_MASK);
      });

      // The hub's Members section (app/clubs/[id]/(hub)/members.tsx) --
      // moved out of the old club-detail/legacy screen verbatim (club-hub
      // phase 2, Task 10). `seedClubWithEvent` puts nobody but the
      // signed-in host on Riverside's roster, so this is the singular
      // "1 member" heading and the host's own row with its "Host" tag --
      // the search field only appears once the roster is non-empty
      // (`ClubMembers`'s own `roster.length > 0` gate), so this also
      // pictures that.
      test(`club members at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/members`);
        await expect(page.getByText('1 member', { exact: true })).toBeVisible();
        await expect(page.getByText('Wei Chen')).toBeVisible();
        await expect(page.getByText('Host', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Search members')).toBeVisible();
        await captureScreen(page, vp, `club-members-${vp.name}.png`, CLUB_HUB_HEADER_CODE_ROW_MASK);
      });

      // The hub's Board section (app/clubs/[id]/(hub)/board.tsx) -- the SAME
      // `ClubBoard` component the `club board populated`/`club post
      // populated` baselines below already picture through the messages
      // route, now reached through the hub's own chrome instead. Seeds its
      // own club (`seedPopulatedBoard`, same as those two baselines) rather
      // than reusing `seeded.clubId`, so this baseline is the hub header
      // and section tabs around a populated board, not a second exercise of
      // the post/reply rendering those two baselines already cover.
      test(`club board at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { clubId } = await seedPopulatedBoard(userId, userId.slice(0, 8));
        await page.goto(`/clubs/${clubId}/board`);
        await expect(page.getByText('Cedar Falls Mah Jongg', { exact: true })).toBeVisible();
        await expect(
          page.getByText('Fall tournament signup opens Monday', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('4 replies')).toBeVisible();
        await captureScreen(page, vp, `club-hub-board-${vp.name}.png`, CLUB_HUB_HEADER_CODE_ROW_MASK);
      });

      // The hub's Ranks section (app/clubs/[id]/(hub)/ranks.tsx) -- the same
      // `ClubLeaderboard` app/clubs/[id]/leaderboard.tsx used to draw under
      // its own header (that route now redirects here). Reuses
      // `seedTableWithRound` the same way the `event detail, live with a
      // round recorded` baseline below does (same club, same helper) so this
      // pictures a populated podium row rather than the "No rounds recorded
      // yet." empty card -- the ranking itself already has a real winner to
      // show once that fixture exists on this club.
      test(`club ranks at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { winnerName, points } = await seedTableWithRound(
          seeded.clubId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/clubs/${seeded.clubId}/ranks`);
        await expect(page.getByText(winnerName)).toBeVisible();
        await expect(page.getByText('1 round won')).toBeVisible();
        await expect(page.getByText(`${points} pts`)).toBeVisible();
        // The winner's own avatar circle (`testID="leaderboard-avatar"`,
        // components/ClubLeaderboard.tsx) is colored by `avatarColorFor`,
        // hashed from `seedTableWithRound`'s FRESH filler profile id --
        // random every run, same class as `check-in`'s own per-run avatar
        // colour (docs/testing.md) -- confirmed here by four consecutive
        // failures against this baseline's own just-written PNG before this
        // mask was added.
        await captureScreen(page, vp, `club-ranks-${vp.name}.png`, [
          ...CLUB_HUB_HEADER_CODE_ROW_MASK,
          '[data-testid="leaderboard-avatar"]',
        ]);
      });

      // The hub's Photos section (app/clubs/[id]/(hub)/photos.tsx) -- nothing
      // built yet but the "coming soon" placeholder (`PhotosSection`'s own
      // docstring), needing no seeded data beyond the club itself.
      test(`club photos at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/photos`);
        await expect(page.getByText('Photos and files are coming soon.')).toBeVisible();
        await captureScreen(page, vp, `club-photos-${vp.name}.png`, CLUB_HUB_HEADER_CODE_ROW_MASK);
      });

      // Club settings (app/clubs/[id]/settings.tsx) -- organizers only,
      // reached from the hub header's gear (`canManage`, ClubHubHeader) and
      // new in club-hub phase 2 (Task 11): cover photo/colour, the club
      // code, the invite-only default for new games, and links to Venues
      // and Import a roster, moved out of the old club-detail/legacy
      // screen. `seeded`'s host role satisfies `canInvite`, so this is the
      // organizer's own view, not the `Redirect` a plain member would get.
      test(`club settings at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/settings`);
        await expect(page.getByText('Club settings', { exact: true })).toBeVisible();
        await expect(page.getByText('Cover', { exact: true })).toBeVisible();
        await expect(page.getByText('Club code:')).toBeVisible();
        await expect(page.getByText('New games default to invite-only')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Venues' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import a roster from a spreadsheet' })).toBeVisible();
        await captureScreen(page, vp, `club-settings-${vp.name}.png`, CLUB_CODE_MASK);
      });

      // The POPULATED picker. Before Task 16 this baseline pictured the
      // empty state by accident -- `seedClubWithEvent` puts nobody but the
      // signed-in member on either of its clubs' rosters, so `fetchFriends`
      // and `fetchAddablePeople` both came back `[]` and the whole point of
      // the screen (picking somebody) went unpictured. `seedMessageCandidates`
      // gives it two friends and two club-mates in a club of its own; one
      // friend is also clicked before the shot so the selected-row border
      // (`styles.personOn`, app/messages/new.tsx) is pictured too, not just
      // the unselected list.
      test(`new message at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { friendName } = await seedMessageCandidates(userId);
        await page.goto('/messages/new');
        await expect(page.getByText('Send to')).toBeVisible();
        await expect(page.getByLabel(friendName)).toBeVisible();
        await expect(page.getByLabel('Priyanka Menon')).toBeVisible();
        await page.getByLabel(friendName).click();
        await captureScreen(page, vp, `message-new-${vp.name}.png`);
      });

      test(`flat thread empty at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/messages');
        // Through the row, not a guessed id: thread ids are generated and
        // the club thread has none at all until it is opened. Named exactly
        // rather than a loose pattern on the club's own name — Task 15's
        // booking-state fixtures (e2e/session.ts) seed a SECOND club,
        // "Thursday Casuals", so this list carries two club-thread rows and
        // a loose pattern is a strict-mode hard failure now, the same
        // "Your clubs" trap this file's other comments record. The row's
        // title is the club's bare name now, not "Everyone at <club>" — see
        // lib/messages.ts's `threadTitleFor` for why.
        //
        // The club row still goes through open_thread_for_club, and that RPC
        // path — a club thread that has never been opened and so has no id
        // to guess — is why the click, rather than a goto, stays here. It
        // lands on the BOARD now, and this asserts that: the flat screen is
        // no longer somewhere a club thread can end up, from a row or from
        // anywhere else (app/messages/[threadId].tsx redirects one itself).
        await page.getByRole('button', { name: 'Riverside Mah Jongg' }).click();
        await page.waitForURL(/\/messages\/club\/.+/);

        // The flat screen's own empty state is still real — game, group and
        // direct conversations all live there — so it keeps its baseline, on
        // a kind that still belongs to it. `seedEmptyGroupThread`
        // (e2e/session.ts) seeds one with no messages at all.
        const { threadId } = await seedEmptyGroupThread(userId, userId.slice(0, 8));
        await page.goto(`/messages/${threadId}`);
        // `exact: true` — the brief's own bare `getByLabel('Message')` is
        // ALSO a substring match on this screen's own "< Messages" back
        // link (accessibilityLabel="Messages", app/messages/[threadId].tsx),
        // a same-page collision on top of the multi-club one above.
        await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
        await expect(
          page.getByText('No messages yet. Say hello to start the conversation.'),
        ).toBeVisible();
        await captureScreen(page, vp, `thread-${vp.name}.png`);
      });

      // The POPULATED list, pictured for the first time. Every other
      // `messages-*` baseline in this suite is the EMPTY state
      // ("No conversations yet") -- the flat-list restyle (row shape,
      // avatar column per kind, hairline dividers, truncation, timestamp
      // and badge placement) shipped guarded by nothing but a throwaway
      // spec the restyling agent wrote, looked at, and deleted.
      // `seedPopulatedMessagesList` (e2e/session.ts) seeds a club thread, a
      // game thread and a direct thread -- three of ThreadRow's four
      // avatar treatments -- each authored by a filler profile so the
      // preview lines read as a real conversation, never the viewer's own.
      test(`messages populated at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await seedPopulatedMessagesList(
          seeded.clubId,
          seeded.eventId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto('/messages');
        // The club row, pinned first by lib/messages.ts's
        // `orderThreadsForList`. Same anchor the `club thread at …` test
        // above uses -- `getByRole`'s `name` option is a substring match,
        // which is what keeps this robust regardless of whether the row's
        // composed accessibilityLabel (`unreadSuffix`, lib/messages.ts)
        // carries a ", N unread" tail.
        await expect(
          page.getByRole('button', { name: 'Riverside Mah Jongg' }),
        ).toBeVisible();
        // The game thread's own title -- unique to this fixture on this
        // screen (no other row's title or subtitle contains it) -- proves a
        // NON-club row survived the club pin, not just the club one. This
        // is exactly the assertion this task exists to add: a future
        // regression that empties the list fails loudly here instead of
        // quietly matching the empty-state baseline above.
        await expect(page.getByText('Tuesday night mahjong')).toBeVisible();
        await captureScreen(page, vp, `messages-populated-${vp.name}.png`);
      });

      // The thread screen's own bubbles, pictured for the first time. Every
      // OTHER `thread-*` baseline in this suite (the `flat thread empty at …`
      // test above) is the EMPTY thread — nothing has ever screenshotted an
      // actual message, so the bubble treatments themselves (an ordinary
      // "theirs" bubble, the viewer's own "mine" bubble, and an
      // announcement) were guarded by nothing.
      // `seedPopulatedThread` (e2e/session.ts) seeds one GAME thread with
      // four messages: a filler's ordinary message, the viewer's own reply,
      // a second filler's announcement, and a third filler's ordinary
      // message after it — every bubble treatment this screen renders, in
      // one thread. It used to seed a CLUB thread; see that function's own
      // docstring for why a game thread is the kind that keeps all four of
      // those treatments reachable now that a club's conversation is a board.
      test(`thread populated at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { threadId } = await seedPopulatedThread(
          seeded.clubId,
          seeded.eventId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/messages/${threadId}`);
        // A known body from each side of the conversation -- the viewer's
        // own reply and the announcement's subject -- so a regression that
        // empties the thread (or drops the announcement) fails loudly here
        // rather than quietly matching the empty-thread baseline above.
        await expect(page.getByText('Yes! I will bring extra tiles.')).toBeVisible();
        // `exact: true` -- the announcement's own body starts with the same
        // words as its subject line ("Hall closed this week" is both the
        // subject AND the body's first line, by design: deriveSubject takes
        // the body's first line), so a loose match resolves to both the bare
        // subject <Text> and the multi-line body <Text> and Playwright's
        // strict mode turns that into a hard failure.
        await expect(
          page.getByText('Hall closed this week', { exact: true }),
        ).toBeVisible();
        await captureScreen(page, vp, `thread-populated-${vp.name}.png`);
      });

      // Image attachments, pictured for the first time. Every OTHER
      // `thread-*` baseline in this suite is text-only -- neither
      // `AttachmentGrid`'s grid cells nor its full-screen viewer
      // (components/messages/AttachmentGrid.tsx) had ever been screenshotted
      // in a real browser before this task, only under jsdom in Tasks 7-9's
      // component tests. `seedThreadWithAttachments` (e2e/session.ts) seeds
      // a real filler's "theirs" bubble carrying ONE real image and the
      // viewer's own "mine" bubble carrying the maximum FOUR, each a real
      // JPEG uploaded to the actual `message-images` Storage bucket and
      // resolved here through a real signed URL -- not a stubbed row, so a
      // broken-image regression would show up in the PNG the same way it
      // would to a person actually using the app.
      //
      // A THIRD message here -- captionless, image-only -- is what this
      // suite was missing when it shipped: every message it pictured paired
      // an image with caption text, so `AttachmentGrid`'s cell width (then a
      // PERCENTAGE of the bubble) always had that caption already giving the
      // bubble a real width to resolve against. A member's first genuinely
      // captionless photo collapsed to an invisible 0x0 bubble in
      // production -- a percentage of a box whose own size depends on that
      // percentage resolving first, which the browser breaks by computing
      // it as zero. `.toBeVisible()` below is a real assertion of this: a
      // 0x0 element is not visible to it. jsdom cannot exercise this at
      // all -- it has no layout engine -- which is the whole reason this
      // scenario belongs here and not only in a component test.
      test(`thread with image attachments at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { threadId } = await seedThreadWithAttachments(
          seeded.clubId,
          seeded.eventId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/messages/${threadId}`);
        await expect(
          page.getByText('Here is the corner we set up for Tuesday.'),
        ).toBeVisible();
        await expect(
          page.getByText('Found four venues to compare, what do you all think?'),
        ).toBeVisible();
        // One grid cell per image -- proof both messages actually rendered
        // their attachments, not just their body text, before the
        // screenshot below is trusted to show the same.
        const singleImageButtons = page.getByRole('button', { name: 'View image 1 of 1' });
        await expect(singleImageButtons).toHaveCount(2);
        await expect(singleImageButtons.first()).toBeVisible();
        // The captionless message's own bubble: it renders LAST (its
        // created_at is the latest of the three), so it's the third
        // attachment-grid on the screen -- and the one whose single-image
        // button is the SECOND of the two matching "View image 1 of 1".
        await expect(page.locator('[data-testid="attachment-grid"]')).toHaveCount(3);
        await expect(singleImageButtons.last()).toBeVisible();
        await expect(page.getByRole('button', { name: 'View image 4 of 4' })).toBeVisible();
        await captureScreen(page, vp, `thread-attachments-${vp.name}.png`);
      });

      // The full-screen viewer, opened on the SECOND of the four-image
      // message's images (not the first) -- deliberately, so this baseline
      // also proves the tapped INDEX is what opens, not just that some image
      // does. Each of the four images is a distinct colour and aspect ratio
      // (see `ATTACHMENT_FIXTURES`, e2e/session.ts), so a regression that
      // opened the wrong index would show a visibly different picture here,
      // not just a byte-identical swap.
      test(`thread image viewer open at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { threadId } = await seedThreadWithAttachments(
          seeded.clubId,
          seeded.eventId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/messages/${threadId}`);
        await expect(page.getByRole('button', { name: 'View image 2 of 4' })).toBeVisible();
        await page.getByRole('button', { name: 'View image 2 of 4' }).click();
        await expect(
          page.getByRole('button', { name: 'Close image viewer' }),
        ).toBeVisible();
        await captureScreen(page, vp, `thread-attachments-viewer-${vp.name}.png`);
      });

      // The board, pictured for the first time -- and, since Task 13's own
      // review, pictured with a THREADED discussion under it, not just four
      // root-level messages that each read "No replies". `seedPopulatedThread`
      // sets no message's `root_id`, so every message it inserts becomes its
      // own post; reusing it here (as this test used to) meant the one thing
      // this feature exists to show -- a post with replies under it -- was
      // never in the picture. `seedPopulatedBoard` (e2e/session.ts) seeds its
      // OWN club and thread instead, an announcement with four replies and a
      // plain post with two, so this baseline shows two different
      // `replyCountLabel` plurals ("4 replies", "2 replies") rather than four
      // rows all reading "No replies".
      test(`club board populated at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { threadId } = await seedPopulatedBoard(userId, userId.slice(0, 8));
        await page.goto(`/messages/club/${threadId}`);
        // The announcement's own title (postTitle, lib/messages.ts, takes an
        // announcement's `subject` verbatim) and the plain post's title (the
        // body's own first line) -- proof the board rendered more than one
        // row, and that the announcement styling actually reached a real
        // post rather than being asserted against nothing.
        await expect(
          page.getByText('Fall tournament signup opens Monday', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('Anyone free to help set up tables Saturday morning?'),
        ).toBeVisible();
        // Both plurals, read off the row rather than asserted only via the
        // screenshot -- "pixels cannot catch a one-glyph regression"
        // (docs/testing.md). A regression that collapsed every count to the
        // same value would still "pass" a screenshot-only check if both rows
        // happened to read the same text.
        await expect(page.getByText('4 replies')).toBeVisible();
        await expect(page.getByText('2 replies')).toBeVisible();
        await captureScreen(page, vp, `club-board-${vp.name}.png`);
      });

      // The post screen, pictured for the first time -- and, like the board
      // test above, now with real replies under the root instead of an
      // empty post and a composer. Opens the announcement `seedPopulatedBoard`
      // seeded above by its OWN id, via a direct `page.goto`, not by clicking
      // the board row: a click is a client-side navigation, and expo-router's
      // web stack leaves the screen it came from mounted (hidden, not torn
      // down), so the board's own `testID="screen-scroll"` ScrollView is
      // still in the DOM under the post screen's identical testID --
      // `captureScreen`'s `document.querySelector` (this file, above) can
      // then measure the WRONG one and grow the viewport by nothing, leaving
      // this screen's own last reply clipped below the fold. That was latent
      // in this test's old click-based navigation too; it only started
      // failing once this test had enough replies to actually overflow.
      // `page.goto`, the same full navigation `thread populated`'s own test
      // already uses to reach its id, tears the previous screen down
      // entirely, so there is only ever one `screen-scroll` node here.
      // MessageBubble's announcement treatment (the accent2 Tag, the subject
      // line, `announcementBody` dropping the body's duplicated first line)
      // has a baseline on the flat thread screen already; this is the same
      // component reached through the board/post route instead, now actually
      // carrying the four replies `seedPopulatedBoard` seeded under it -- an
      // ordinary "theirs" bubble, the viewer's own "mine" bubble, and three
      // time-group separators among them.
      test(`club post populated at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { threadId, announcementId } = await seedPopulatedBoard(
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/messages/club/${threadId}/${announcementId}`);
        // `announcementBody` drops the subject-duplicated first line, so
        // this is the announcement's SECOND line -- proof the root rendered
        // with the announcement treatment, not just that some post opened.
        await expect(
          page.getByText('Seats go fast, so reply here if you want in.'),
        ).toBeVisible();
        // The viewer's own reply (the "mine" bubble) and the LAST reply in
        // the thread -- proof the replies rendered at all, not just the
        // root, and that the one authored by the viewer is among them.
        await expect(
          page.getByText('Count me in, I will bring extra tiles too.'),
        ).toBeVisible();
        await expect(
          page.getByText('Yes, we kept the beginner table again this year.'),
        ).toBeVisible();
        await captureScreen(page, vp, `club-post-${vp.name}.png`);
      });

      // The unread badge, pictured for the first time. Task 16 shipped it on
      // the old dashboard's Messages tab and club chips
      // (components/TabBar.tsx, components/ClubChips.tsx) — both gone now,
      // along with the global tab bar itself. Home's `ClubCard`
      // (components/home/ClubCard.tsx) is the only place this state renders
      // today, on the Clubs view. Every OTHER baseline in this suite is shot
      // with a freshly-seeded user who has nothing unread — UnreadBadge
      // (components/UnreadBadge.tsx) returns null at count 0 — so this is
      // still the one baseline that pictures the badge's real rendering:
      // whether the pill clips the tile, overflows the row, or collides
      // with the name.
      //
      // `seedUnreadClubMessage` (e2e/session.ts) posts as a FRESH filler
      // profile, never the signed-in member: a message you sent yourself is
      // never unread (fetch_my_threads' own lateral join filters on
      // `author_id <> auth.uid()`), so seeding it as the viewer would prove
      // nothing. `extraMask` below masks club glyph jitter — see
      // `home my games`'s own comment above.
      test(`messages badge at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await seedUnreadClubMessage(seeded.clubId, userId.slice(0, 8));
        await page.goto('/home');
        await page.getByRole('button', { name: /^Clubs/ }).click();
        // ClubCard composes the unread count straight into its
        // accessibilityLabel (components/home/ClubCard.tsx,
        // `unreadSuffix`, lib/messages.ts) rather than leaving it on
        // UnreadBadge's own nested <Text> — react-native-web's aria-label
        // REPLACES the accessible name computed from children, it does not
        // merge with it, so the count never reaches assistive tech any
        // other way. `.first()` stays only as a defensive belt: Riverside's
        // own card is the only one carrying "unread" in its composed name.
        const clubCard = page.getByRole('button', { name: /Riverside Mah Jongg/ }).first();
        await expect(clubCard).toHaveAccessibleName(/, 1 unread$/);
        await expect(clubCard.getByText('1', { exact: true })).toBeVisible();
        await captureScreen(page, vp, `messages-badge-${vp.name}.png`, [
          'div:has(> [data-testid^="glyph-"])',
        ]);
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
        // (the signed-in member and one other), room left. This is the
        // same page a dedicated `event booking` baseline would have shot —
        // same club, same event, same seeded state — so there is no such
        // baseline; it could only ever be byte-identical to this one.
        // Task 14 renamed the screen-level button from "Bring someone" to
        // "Invite" (its own accessibilityLabel is now the bare "Invite").
        // `.first()` on Priya's name — kept
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
          page.getByRole('button', { name: 'Invite', exact: true }),
        ).toBeVisible();
        // TableCard no longer prints a "N seats free" sentence (Task 6) --
        // room left is now only visible as unoccupied seat tiles themselves.
        // Table 1 seats You + Priya at a capacity-4 table, so exactly two of
        // its tiles render SeatGrid's own "Empty" label; Table 2 (seeded
        // full in e2e/session.ts) contributes none.
        await expect(page.getByText('Empty')).toHaveCount(2);
        await captureScreen(page, vp, `event-detail-${vp.name}.png`);
      });

      // The rounds section, pictured for the first time -- and the only
      // baseline in this suite where it has anything to show. Every other
      // seeded event here (this describe's own `seeded.eventId` above, and
      // the four booking-state games from `seedBookings`) reads as upcoming
      // or past, never live, to `gameLive`
      // (app/clubs/[id]/events/[eventId]/index.tsx) -- RoundLog's totals
      // line and round row, and RoundTimer's duration pills, all render
      // nothing or nothing but their own gated-off state on the seeded
      // event above. `seedTableWithRound` (e2e/session.ts) seeds a SEPARATE
      // event, windowed to be live at the suite's own frozen clock, with one
      // table two of whose four seats are confirmed and one round already
      // recorded for it.
      test(`event detail, live with a round recorded, at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const { eventId, winnerName, points } = await seedTableWithRound(
          seeded.clubId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/clubs/${seeded.clubId}/events/${eventId}`);
        await expect(page.getByText('1 table · 4 seats')).toBeVisible();
        // TableCard no longer prints a "N seats free" sentence (Task 6) --
        // the winner and runner-up fill two of this table's four seats, so
        // exactly two tiles render SeatGrid's own "Empty" label.
        await expect(page.getByText('Empty')).toHaveCount(2);
        // RoundLog's 2a row (components/RoundLog.tsx), announced as one
        // "<name> won <points> points" -- proof the seeded round reached the
        // screen, not just the fixture.
        await expect(page.getByLabel(`${winnerName} won ${points} points`)).toBeVisible();
        await expect(page.getByText(`+${points}`, { exact: true })).toBeVisible();
        // The winner's seat tile (components/SeatGrid.tsx): the running
        // total on its second line, and the last-round trophy badge.
        await expect(page.getByText(new RegExp(`${points} pts$`))).toBeVisible();
        // The pinned round bar (components/RoundTimer.tsx) -- needs no seeded
        // data at all, only a live game.
        await expect(page.getByText('Start round 2 · 15 min')).toBeVisible();
        await captureScreen(page, vp, `event-detail-round-${vp.name}.png`);
      });

      test(`new event at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/events/new`);
        await expect(page.getByText('New game')).toBeVisible();
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
        await expect(page.getByText('No end date', { exact: true })).toBeVisible();
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
       * as `event detail` and `home my games` respectively — the
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
        // TableCard no longer prints its own per-table "Full" label (Task 6
        // dropped the whole seats-free sentence, "0 seats free" included).
        // `seatsFreeLabel` (lib/bookings.ts) still owns the SAME "Full" word
        // for a different screen (the club/dashboard list's own summary
        // line) -- unrelated to this one, not touched here. The fullness of
        // this table is instead proven by the state it actually drives: no
        // seat for the signed-in member to take, so the waitlist renders.
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
      // TableCard no longer prints a "1 seat free" sentence (Task 6) --
      // `needsAFourth`'s own definition (lib/bookings.ts) is
      // `confirmed === capacity - 1`, which on a 4-seat table always leaves
      // exactly one seat, never three, so "Last seat" (SeatGrid's own
      // special label for that one remaining tile, distinct from a plain
      // "Empty" one) already proves the exact same count on its own.
      test(`event needs a fourth at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(
          `/clubs/${seeded.bookingClubId}/events/${seeded.needsAFourthEventId}`,
        );
        await expect(page.getByText('Needs a 4th')).toBeVisible();
        await expect(page.getByText('Last seat')).toBeVisible();
        await expect(page.getByText('Call for a 4th now')).toBeVisible();
        await captureScreen(page, vp, `event-needs-a-fourth-${vp.name}.png`);
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
        await expect(page.getByText(/ booked · /)).toBeVisible();
        await captureScreen(page, vp, `check-in-${vp.name}.png`);
      });

      // Task 11: the open-seating event detail screen, pictured for the
      // first time. Every other `event-detail*`/`event-*` baseline in this
      // suite is an ASSIGNED-TABLES night — `seedOpenSeatingEvent`
      // (e2e/session.ts) is the one fixture in this file with
      // `seating_mode: 'open_seating'` and no `event_tables` rows at all, so
      // this is the first baseline to exercise the screen's `isOpenSeating`
      // branch (app/clubs/[id]/events/[eventId]/index.tsx): the "N signed
      // up · M spots" heading in place of "N tables · M seats", and a plain
      // roster card in place of per-table seat grids.
      test(`open-seating event detail at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const seating = await seedOpenSeatingEvent(
          seeded.clubId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/clubs/${seeded.clubId}/events/${seating.eventId}`);
        // The headcount heading -- five confirmed players, the fixture's own
        // fixed capacity. Distinct from every `N tables · M seats` heading
        // elsewhere in this suite, and the only place that distinction is
        // pictured.
        await expect(
          page.getByText(`5 signed up · ${seating.capacity} spots`),
        ).toBeVisible();
        // The fee line -- `$15 to play`, `formatFeeCents`'s own whole-dollar
        // format for a cents value with no fractional part.
        await expect(page.getByText('$15 to play')).toBeVisible();
        // The two-person booking group's own tag, on the roster card --
        // `.first()` because BOTH members of the pair render it.
        await expect(page.getByText('Group of 2').first()).toBeVisible();
        await expect(page.getByText(seating.longName)).toBeVisible();
        await expect(page.getByText(seating.partnerName)).toBeVisible();
        await captureScreen(page, vp, `event-detail-open-seating-${vp.name}.png`);
      });

      // The self-serve "Join" button (`canJoinOpenSeating`,
      // app/clubs/[id]/events/[eventId]/index.tsx, commit 0d031a4), pictured
      // for the first time. The `open-seating event detail` baseline above
      // does NOT cover it — see `seedJoinableOpenSeatingEvent`'s own doc
      // comment for why that fixture's event can never show this button,
      // regardless of who's looking or what they've booked. This uses a
      // second, plain open-seating event that is still bookable, with the
      // signed-in host holding no booking of their own — the one shape that
      // makes the button render.
      test(`open-seating event detail, joinable, at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const joinable = await seedJoinableOpenSeatingEvent(
          seeded.clubId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(`/clubs/${seeded.clubId}/events/${joinable.eventId}`);
        // The headcount heading -- one confirmed signup (not the viewer)
        // against the fixture's own fixed capacity.
        await expect(
          page.getByText(`1 signed up · ${joinable.capacity} spots`),
        ).toBeVisible();
        await expect(page.getByText(joinable.signupName)).toBeVisible();
        // The fee line -- `formatFeeCents(1000)`'s whole-dollar format.
        await expect(page.getByText('$10 to play')).toBeVisible();
        // The assertion this baseline exists for: the "Join" button actually
        // rendered, not merely a screen that would look identical whether it
        // did or not. `exact: true` so this can never accidentally match
        // "Join the waitlist" (unreachable here anyway -- this event has no
        // tables, so `gameFull` is always false).
        await expect(
          page.getByRole('button', { name: 'Join', exact: true }),
        ).toBeVisible();
        // "Invite" (`canBringSomeone`) sits directly below "Join" in the
        // JSX -- the two buttons this baseline exists to show side by side.
        await expect(
          page.getByRole('button', { name: 'Invite', exact: true }),
        ).toBeVisible();
        await captureScreen(
          page,
          vp,
          `event-detail-open-seating-joinable-${vp.name}.png`,
        );
      });

      // Task 11: the check-in screen's OPEN-SEATING branch, pictured for the
      // first time -- and the baseline this task's two verification gaps
      // are about. Every other `check-in-*` baseline in this suite is an
      // assigned-tables door list, grouped by table; this one has no tables
      // at all, so it renders `groupByStatus`'s four status sections
      // instead (check-in.tsx), with the search field the brief's sticky-
      // search gap is about pinned above them.
      //
      // `seedOpenSeatingEvent` puts one confirmed booking GROUP of two in
      // "Still to arrive" (one of the pair carrying a deliberately long
      // name), two solo bookings in "Here" (one marked paid, so the paid
      // badge's filled and outline states both render), and one solo
      // booking in "Not coming" -- all three status sections the brief's
      // Step 1 asks for, plus the exact row shape (a long name, a group
      // tag, an "owed" line, the paid badge and the Here control all
      // sharing one `personRow`) the `flexWrap` gap is about.
      test(`check-in door, open seating, at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const seating = await seedOpenSeatingEvent(
          seeded.clubId,
          userId,
          userId.slice(0, 8),
        );
        await page.goto(
          `/clubs/${seeded.clubId}/events/${seating.eventId}/check-in`,
        );
        await expect(page.getByLabel('Search players')).toBeVisible();
        // The legend's counts, read as text -- "pixels cannot catch a
        // one-glyph regression" (docs/testing.md). The legend counts
        // everyone on the list, walk-ins included.
        await expect(page.getByText('2 to check')).toBeVisible();
        await expect(page.getByText('1 not coming')).toBeVisible();
        await expect(page.getByTestId('door-everyone')).toBeVisible();
        await expect(page.getByText(seating.longName)).toBeVisible();
        await expect(page.getByText(seating.partnerName)).toBeVisible();
        await expect(page.getByText(seating.hereName)).toBeVisible();
        await expect(page.getByText(seating.secondHereName)).toBeVisible();
        await expect(page.getByText(seating.notComingName)).toBeVisible();
        // The group tag, on both members of the pair.
        await expect(page.getByText('Group of 2')).toHaveCount(2);
        // What the unpaid half of the pair owes -- `formatFeeCents(1500)`.
        await expect(page.getByText('$15 owed').first()).toBeVisible();
        await captureScreen(page, vp, `check-in-open-seating-${vp.name}.png`);
      });

      // The Clubs view's host checklist, not the player-intro card: this
      // user hosts Riverside (and Thursday Casuals), and `hostChecklist`
      // (lib/guides.ts) is NOT complete for either — `seedClubWithEvent`
      // only ever adds the host to `club_members` (both clubs read
      // `members === 1`, `pendingInvites === 0`), so the "Invite your
      // players" step stays undone on BOTH clubs' cards even though
      // "Schedule your first game" and the optional "Say hello"
      // (Riverside's seeded broadcast) are both done. Checked against the
      // real screen rather than assumed: both cards render, so every
      // assertion below is scoped to Riverside's own card
      // (`testID="host-checklist-<clubId>"`, components/home/HomeGuides.tsx)
      // — the bare text queries this test started with hit "Schedule your
      // first game" and "Invite your players" on BOTH cards and failed
      // Playwright strict mode.
      //
      // Replaces the old dashboard's `dashboard with host checklist at …`
      // baseline (`clubs-guides-*.png`) — the checklist card itself carried
      // over unchanged to Home's Clubs view (`components/home/HomeGuides.tsx`,
      // still the same `TipCard`), just reached through the switch instead
      // of being the only thing on the old `/clubs` route. `extraMask` below
      // masks club glyph jitter — see `home my games`'s own comment above.
      test(`home guides at ${vp.name}`, async ({ page }) => {
        await setDismissedGuides(userId, []);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/home');
        await page.getByRole('button', { name: /^Clubs/ }).click();
        const card = page.getByTestId(`host-checklist-${seeded.clubId}`);
        await expect(card.getByText('Get Riverside Mah Jongg going')).toBeVisible();
        await expect(card.getByText('Schedule your first game')).toBeVisible();
        await expect(card.getByText('Invite your players')).toBeVisible();
        await expect(card.getByRole('button', { name: 'Got it: Get Riverside Mah Jongg going' })).toBeVisible();
        await captureScreen(page, vp, `home-guides-${vp.name}.png`, [
          'div:has(> [data-testid^="glyph-"])',
        ]);
      });

      // The "Add a game" screen's own tip — not gated by role in the
      // component, but only a host ever reaches this route in practice, and
      // this user is Riverside's host.
      test(`new event with tip at ${vp.name}`, async ({ page }) => {
        await setDismissedGuides(userId, []);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/clubs/${seeded.clubId}/events/new`);
        await expect(page.getByText('Setting up a game')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Got it: Setting up a game' })).toBeVisible();
        await captureScreen(page, vp, `new-event-tip-${vp.name}.png`);
      });
    }
  });

  for (const vp of WIDTHS) {
    // The replayable half of first-run guidance (app/how-it-works.tsx) —
    // reachable from Profile regardless of whether any tip has ever been
    // dismissed, so this test needs no `setDismissedGuides` call of its own.
    test(`how it works at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/how-it-works');
      await expect(page.getByText('Show tips again')).toBeVisible();
      await captureScreen(page, vp, `how-it-works-${vp.name}.png`);
    });
  }
});
