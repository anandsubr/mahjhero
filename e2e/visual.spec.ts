import { expect, test, type Page } from '@playwright/test';
import {
  mintSession,
  seedClubWithEvent,
  seedEmptyGroupThread,
  seedMessageCandidates,
  seedPopulatedBoard,
  seedPopulatedMessagesList,
  seedPopulatedThread,
  seedUnreadClubMessage,
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
    // club. The seeding hook lives in the nested describe below precisely so
    // that adding populated baselines could not quietly turn this one into a
    // second picture of the populated list.
    test(`clubs at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/clubs');
      // `{ exact: true }` — "Your clubs" is the header's NAME now
      // (headerScope's all-clubs scope, lib/dashboard.ts), and that scope
      // draws no kicker: "YOUR CLUBS" above "All your clubs" was the same
      // words twice. Playwright's getByText does substring matching by
      // default, so the bare locator would still be worth avoiding if the
      // longer title ever comes back.
      await expect(page.getByText('Your clubs', { exact: true })).toBeVisible();
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
      // The populated dashboard: the chip row (the only club list now), the
      // header's ⊕ and pencil, and "Your games" underneath. This baseline's
      // existence still traces back to Task 11's spacing fix — "no space
      // between the last club and the Start another club button" (todo.md)
      // — which could only regenerate the EMPTY-state baseline, because
      // nothing seeded a club at that point, so the state that bug was
      // actually reported against had never been screenshotted. The cards
      // and that button are both gone from the screen since (the single-list
      // rework folded the club list into the chip row and moved the action
      // into the header), but this is still the one baseline that shoots a
      // member's dashboard with a club on it.
      test(`clubs list with a club at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/clubs');
        // `.first()` — there is no club-list card left for this to anchor
        // on; the club list is the chip row now, and "Riverside Mah Jongg"
        // is one of its two chip labels (the seeded user belongs to both
        // Riverside and Thursday Casuals). Task 15's booking fixtures give
        // the signed-in member a confirmed seat in Riverside's own seeded
        // game, so the name renders a second time as that booking's club
        // name inside the "Your games" card below the chip row, and a third
        // time on the row for Riverside's second occurrence, which
        // `buildDashboardRows` (lib/dashboard.ts) now also lists as an open,
        // joinable game the member is not in. All three are real; this line
        // only needs to know the chip itself still has one.
        await expect(page.getByText('Riverside Mah Jongg').first()).toBeVisible();
        // The action moved out of the chip row and into the header: at two
        // clubs the trailing "+ New club" pill was scrolled off-screen
        // entirely, and it was the only route to /clubs/new for a member who
        // already had a club. The ⊕ beside the avatar does not scroll.
        await expect(
          page.getByRole('button', { name: 'Start a club' }),
        ).toBeVisible();
        await expect(page.getByText('+ New club')).toHaveCount(0);
        // The "Your games" section below the chip row — the club list, once
        // the section below it, is the chip row now: one game the member
        // booked themselves (Riverside's own seeded event above)
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
      // the Messages tab and on the dashboard's club chips (components/TabBar.tsx,
      // components/ClubChips.tsx), and every OTHER baseline in this suite is
      // shot with a freshly-seeded user who has nothing unread — UnreadBadge
      // (components/UnreadBadge.tsx) returns null at count 0, so all 32
      // pre-existing baselines came back byte-identical whether the badge
      // code was there or not. Its real rendering — whether the pill clips
      // the icon, overflows the tab, or collides with the label — was
      // guarded by nothing.
      //
      // `seedUnreadClubMessage` (e2e/session.ts) posts as a FRESH filler
      // profile, never the signed-in member: a message you sent yourself is
      // never unread (fetch_my_threads' own lateral join filters on
      // `author_id <> auth.uid()`), so seeding it as the viewer would prove
      // nothing. The dashboard is the one screen that renders both badge
      // sites at once — TabBar's own Messages tab and ClubChips' Riverside
      // chip — so one capture pictures both.
      test(`messages badge at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await seedUnreadClubMessage(seeded.clubId, userId.slice(0, 8));
        await page.goto('/clubs');
        // ClubChips and TabBar compose the unread count straight into their
        // accessibilityLabel now (components/ClubChips.tsx,
        // components/TabBar.tsx) rather than leaving it on UnreadBadge's own
        // nested <Text> — react-native-web's aria-label REPLACES the
        // accessible name computed from children, it does not merge with
        // it, so the count never reached assistive tech any other way. That
        // also settles the trap this comment used to record: whatever else
        // on the page renders the plain "Riverside Mah Jongg" text, only the
        // chip's accessible name has "1 unread" composed into it, so that
        // composed name is unique on its own — `.first()` stays only as a
        // defensive belt.
        const clubChip = page
          .getByRole('button', { name: 'Riverside Mah Jongg, 1 unread', exact: true })
          .first();
        await expect(clubChip.getByText('1', { exact: true })).toBeVisible();
        // The Messages tab's own badge, scoped to its button for the same
        // reason — TabBar.tsx renders it inside the "Messages" Pressable.
        const messagesTab = page.getByRole('button', {
          name: 'Messages, 1 unread',
          exact: true,
        });
        await expect(messagesTab.getByText('1', { exact: true })).toBeVisible();
        await captureScreen(page, vp, `messages-badge-${vp.name}.png`);
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
