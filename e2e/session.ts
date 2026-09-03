import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The one place the service_role key is read and the one place the local-only
 * guard lives, shared by `mintSession` and `seedClubWithEvent`.
 *
 * Factored out rather than copy-pasted on purpose: this check is the only
 * control stopping a service_role key from being pointed at a hosted project,
 * and two copies of it are two chances for one of them to drift into a
 * substring test. Every caller in this file goes through here.
 */
function adminClient(purpose: string): SupabaseClient {
  const url = process.env.SUPABASE_LOCAL_URL;
  const serviceRole = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error(
      'Set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY. Both are ' +
        'printed by `npx supabase start`. Never use hosted-project values here.',
    );
  }

  // Compare the parsed hostname exactly. A substring check is foolable —
  // `https://notlocalhost.evil.example.com` contains "localhost", and
  // `https://evil.com/?x=127.0.0.1` contains the loopback address. This is
  // the only control stopping a service_role key from being pointed at a
  // hosted project, so it has to actually hold.
  const hostname = new URL(url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`Refusing to ${purpose} against a non-local URL: ${url}`);
  }

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Mints a real session against the LOCAL Supabase stack for visual tests.
 *
 * Uses the admin API to generate a magic link, then extracts the tokens from
 * the returned URL — the same tokens a real sign-in would produce. The app
 * gains no test-only code path.
 *
 * The service_role key is read from the environment and is only ever pointed
 * at the local stack. It must never appear in the app bundle: nothing under
 * app/ or lib/ may import this file.
 */
export async function mintSession(
  email: string,
): Promise<{ access_token: string; refresh_token: string; user_id: string }> {
  const admin = adminClient('mint sessions');

  await admin.auth.admin.createUser({ email, email_confirm: true });

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);

  // The profile id every seeded row is attributed to. `generateLink` returns
  // the user it generated the link for, so this is the same account the
  // tokens below belong to — reading it from `createUser`'s response instead
  // would break the day someone reuses an existing address here.
  const user_id = data.user?.id;
  if (!user_id) throw new Error('generateLink returned no user');

  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error('generateLink returned no action_link');

  const verify = await fetch(actionLink, { redirect: 'manual' });
  const location = verify.headers.get('location');
  if (!location) throw new Error('magic link did not redirect');

  const fragment = new URL(location).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!access_token || !refresh_token) {
    throw new Error(`no tokens in redirect fragment: ${location}`);
  }

  return { access_token, refresh_token, user_id };
}

/**
 * The fixed instants the seeded games sit on.
 *
 * Hard-coded rather than derived from `Date.now()`, because a baseline whose
 * date text changes every run is a baseline that diffs every run. Both are
 * Tuesdays in 2099 — far enough out that `fetchUpcomingEvents`' `ends_at >=
 * now()` filter will still include them long after everyone reading this has
 * stopped caring, and matching the weekly-Tuesday series they belong to.
 *
 * 23:00Z is 7pm in America/New_York on those dates (EDT, UTC-4), which is the
 * series' 19:00 start time. That correspondence is the point: the club's
 * timezone is what the screens render in, so an instant that read as some
 * other hour would make every baseline a picture of a bug.
 */
const FIRST_OCCURRENCE = {
  date: '2099-09-08',
  startsAt: '2099-09-08T23:00:00Z',
  endsAt: '2099-09-09T02:00:00Z',
};
const SECOND_OCCURRENCE = {
  date: '2099-09-15',
  startsAt: '2099-09-15T23:00:00Z',
  endsAt: '2099-09-16T02:00:00Z',
};

const SEEDED_NOTES =
  'Bring a set if you have one. Tea and biscuits are on the club.';

/*
 * ---------------------------------------------------------------------------
 * Booking-state fixtures (Task 15).
 * ---------------------------------------------------------------------------
 *
 * Five booking states need a game to already have people in it: a mixed
 * table with room left, a full table, a full game with a waitlist and a
 * held offer, a table one short of "needs a fourth", and a friend-booked
 * seat. Three of those get their own new baseline (`event-full`,
 * `event-offer`, `event-needs-a-fourth`); the other two — the mixed table
 * and the friend-booked seat — land on `event-detail` and
 * `clubs-populated`, two baselines that already existed, so their text
 * anchors were folded into those two tests instead of living behind a
 * same-picture `event-booking`/`your-games` baseline that could only ever
 * be byte-identical to the original (see e2e/visual.spec.ts). None of that
 * fits FIRST_OCCURRENCE/
 * SECOND_OCCURRENCE above — those exist to be safely far in the future
 * (2099) so the "upcoming" filter never ages them out, and two of the new
 * states are the opposite: `needsAFourth` (lib/bookings.ts) and
 * `need_a_fourth_stage` (SQL) both gate on the game starting within 48
 * hours of "now", and a promotion offer's countdown is `expires_at` minus
 * "now" — both need an event close to whatever "now" the page reads.
 *
 * "Now" on every page in this suite is `e2e/visual.spec.ts`'s frozen
 * clock (`page.clock.setFixedTime(new Date('2026-08-22T16:00:00Z'))`,
 * set before this function ever runs), not the real wall clock — so an
 * instant fixed relative to THAT frozen value is exactly as durable as
 * FIRST_OCCURRENCE's 2099 dates are relative to the real one: it never
 * moves, on any machine, on any day. FROZEN_NOW below is that value,
 * restated here (not imported — e2e/session.ts and e2e/visual.spec.ts
 * share no module) purely so the arithmetic in the comments is checkable
 * without cross-referencing the other file.
 *
 * These four games live in a SECOND club (BOOKING_CLUB below), not
 * Riverside. Riverside's `club-detail` baseline lists every future event
 * for its own club id, unfiltered by status — so a near-term event added
 * to Riverside would silently grow into a THIRD card on a baseline this
 * task never touches. A second club keeps that list exactly as it was and
 * gives `my_upcoming_bookings` (see its own comment: "across every club,
 * which is the point") something to actually aggregate across.
 */
const FROZEN_NOW = '2026-08-22T16:00:00Z';

// 26h after FROZEN_NOW — inside `needsAFourth`'s 48-hour window with
// margin either side, so a slow CI run settling a few seconds late is
// nowhere near either boundary.
const NEEDS_A_FOURTH_GAME = {
  startsAt: '2026-08-23T18:00:00Z',
  endsAt: '2026-08-23T21:00:00Z',
};
// Not itself time-sensitive — a full table is full at any hour — but kept
// close to FROZEN_NOW anyway so every booking-state game reads as part of
// the same near-term week rather than one dated 73 years apart from the
// others for no reason a reader could guess.
const FULL_GAME = {
  startsAt: '2026-08-23T20:00:00Z',
  endsAt: '2026-08-23T23:00:00Z',
};
// 3h after FROZEN_NOW.
const OFFER_GAME = {
  startsAt: '2026-08-22T19:00:00Z',
  endsAt: '2026-08-22T22:00:00Z',
};
// A fixed offset from OFFER_GAME's own starts_at (15 minutes before the
// game), per the brief — not from Date.now(). Working out at 2h45m after
// FROZEN_NOW, so `offerCountdown` renders the same "2 hours 45 minutes
// left" on every run, forever, rather than counting down for real or
// reading "Expired" the first time anyone looks at this baseline again.
const OFFER_EXPIRES_AT = '2026-08-22T18:45:00Z';
// Nothing about a friend-booked seat is time-sensitive, so this one keeps
// FIRST_OCCURRENCE's own far-future pattern rather than living near
// FROZEN_NOW like the three games above.
const FRIEND_GAME = {
  startsAt: '2099-09-22T23:00:00Z',
  endsAt: '2099-09-23T02:00:00Z',
};
// An ordering key only — event_seating/booking_result/my_upcoming_bookings
// all compare one group's waitlisted_at against ANOTHER group's, inside
// the same event, never against "now" — so any fixed instant satisfies it.
// Fixed here for the same reason every other timestamp on this page is:
// this file has no wall-clock reads anywhere.
const WAITLISTED_AT = '2026-08-20T12:00:00Z';

// 15 minutes before FROZEN_NOW, ending 3h45m after — inside the door
// screen's own window (starts_at - 1h .. ends_at, `checkInOpen` in
// lib/attendance.ts) at FROZEN_NOW with margin either side, so a slow CI
// run settling a few seconds late is nowhere near either boundary. Unlike
// every other game above, this one's window has to actually be OPEN at
// the page's frozen clock, not merely dated near it — a closed window
// would still render the door list, just with every control disabled,
// which is not the baseline this fixture exists to show.
const CHECK_IN_GAME = {
  startsAt: '2026-08-22T15:45:00Z',
  endsAt: '2026-08-22T19:45:00Z',
};

/**
 * A club member who exists only to occupy a seat or hold a waitlist spot in
 * a booking-state baseline — never signed in, never screenshotted
 * themselves. Reuses the admin-API user creation `mintSession` uses (no
 * magic link needed, nobody signs in as these), so the seat grid shows a
 * real name instead of the roster's 'Member' placeholder for an unset
 * `display_name`.
 *
 * `label` plus the caller's own per-run `suffix` keep the email unique
 * across runs; `admin.auth.admin.createUser` fails on a collision the same
 * as any other unique-email insert would.
 */
async function seedFillerProfile(
  admin: SupabaseClient,
  displayName: string,
  label: string,
  suffix: string,
): Promise<string> {
  const email = `filler-${label}-${suffix}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `seedClubWithEvent: filler profile "${displayName}" failed: ${JSON.stringify(error)}`,
    );
  }
  const { error: updateError } = await admin
    .from('profiles')
    .update({ display_name: displayName, skill_level: 'intermediate' })
    .eq('id', data.user.id);
  if (updateError) {
    throw new Error(
      `seedClubWithEvent: filler profile "${displayName}" update failed: ${JSON.stringify(updateError)}`,
    );
  }
  return data.user.id;
}

/**
 * One person's booking: a `booking_groups` row plus its `bookings` row,
 * written directly rather than through `commit_booking` — service_role
 * carries no JWT here, so the RPC's own `auth.uid()` checks have nothing to
 * authenticate against, the same reason every other row in this file is a
 * direct insert.
 *
 * `bookedBy` defaults to the seated profile itself; passing a different id
 * is what produces the "X booked this for you" / decline-affordance state
 * `bookings.booked_by` exists for. `waitlisted: true` seats nobody — per
 * `bookings_waitlisted_has_no_table`, a waitlisted booking's `event_table_id`
 * must be null — and stamps both rows with the fixed `WAITLISTED_AT` above.
 */
async function seatBooking(
  admin: SupabaseClient,
  need: <T>(what: string, result: { data: unknown; error: unknown }) => T,
  args: {
    eventId: string;
    clubId: string;
    profileId: string;
    bookedBy?: string;
    tableId?: string;
    waitlisted?: boolean;
  },
): Promise<{ groupId: string; bookingId: string }> {
  const bookedBy = args.bookedBy ?? args.profileId;
  const waitlisted = args.waitlisted ?? false;
  const tableId = waitlisted ? null : (args.tableId ?? null);

  const group = need<{ id: string }>(
    'booking group insert',
    await admin
      .from('booking_groups')
      .insert({
        event_id: args.eventId,
        club_id: args.clubId,
        created_by: bookedBy,
        preferred_table_id: tableId,
        status: waitlisted ? 'waitlisted' : 'confirmed',
        waitlisted_at: waitlisted ? WAITLISTED_AT : null,
      })
      .select('id')
      .single(),
  );

  const booking = need<{ id: string }>(
    'booking insert',
    await admin
      .from('bookings')
      .insert({
        group_id: group.id,
        event_id: args.eventId,
        club_id: args.clubId,
        event_table_id: tableId,
        profile_id: args.profileId,
        booked_by: bookedBy,
        status: waitlisted ? 'waitlisted' : 'confirmed',
      })
      .select('id')
      .single(),
  );

  return { groupId: group.id, bookingId: booking.id };
}

/**
 * Seeds a club, two venues, a weekly series, two of its occurrences and their
 * tables for a freshly minted user, so the visual baselines capture real
 * screens rather than empty states.
 *
 * Uses the same admin client and the same local-only guard as mintSession
 * (`adminClient` above): the service_role key is read from the environment,
 * is only ever pointed at the local stack, and must never appear in the app
 * bundle. Nothing under app/ or lib/ may import this file.
 *
 * Writes rows directly rather than calling the RPCs, because the RPCs check
 * auth.uid() and this runs as service_role with no JWT. service_role holds
 * DML on these tables by migration 20260822180200 and its default-privileges
 * clause, and BYPASSRLS skips the policies.
 *
 * Two deliberate fixture choices, both of which decide what the screenshots
 * show:
 *
 *   - **The club's timezone is America/New_York.** Every screen renders event
 *     times in the CLUB's zone, never the device's, so this — not the machine
 *     running Playwright — is what the baselines say. Changing it changes
 *     every seeded baseline's clock.
 *   - **The event is a series occurrence with `overrides: ['venue_id']`**, not
 *     the one-off the brief seeded. A one-off renders no scope choice on the
 *     edit screen and no "Part of a series" line on the detail screen, which
 *     would have left the most complex UI on this branch — and the only
 *     override annotation in it — with no baseline at all.
 *
 * Both venues are `visibility: 'club'`. A public one would be nicer coverage
 * of the "Other clubs can use this venue" copy, and cannot be seeded here:
 * `venues_public_name_idx` is unique on (name, locality) across the PUBLIC set
 * only, so the second test in a run would collide, and giving the name a
 * per-run suffix to dodge that would put a changing string in a baseline. That
 * copy is covered at the component layer instead (app/__tests__/venues.test.tsx).
 */
export async function seedClubWithEvent(profileId: string): Promise<{
  clubId: string;
  eventId: string;
  seriesId: string;
  /** The second club the booking-state fixtures live in. See its own block below. */
  bookingClubId: string;
  /** A completely full game with a waitlist, for the `event full` baseline. */
  fullEventId: string;
  /** A completely full game where the signed-in member's own group holds
   * a fixed-countdown offer, for the `event offer` baseline. */
  offerEventId: string;
  /** A table one short of a fourth, inside the 48-hour call window, for
   * the `event needs a fourth` baseline. */
  needsAFourthEventId: string;
  /** One broadcast already sent to Riverside. The `broadcast history`
   * baseline that read this row was retired in Task 15 — the row is left
   * in place as harmless fixture data exercising the `broadcasts` table,
   * which lib/schema-contract.test.ts and the Edge Function still read. */
  broadcastId: string;
  /** Check-in required, window open at the frozen clock, one person per
   * door-screen render group — for the `check-in door` baseline. */
  checkInEventId: string;
}> {
  const admin = adminClient('seed fixtures');

  // Every insert below is checked. An unchecked `.insert()` that fails
  // returns `{ data: null }` and the next `!` assertion throws a bare "cannot
  // read id of null" several statements later, naming nothing; the seeded
  // rows are the whole basis of the baselines, so a partial seed must fail
  // loudly at the row that actually broke.
  //
  // `data` is typed `never | null` here — the client is created without a
  // generated `Database` type, so PostgREST responses carry no row shape at
  // all — hence the explicit type argument at each call site rather than
  // inference.
  const need = <T>(
    what: string,
    result: { data: unknown; error: unknown },
  ): T => {
    if (result.error || result.data == null) {
      throw new Error(
        `seedClubWithEvent: ${what} failed: ${JSON.stringify(result.error)}`,
      );
    }
    return result.data as T;
  };

  const suffix = profileId.slice(0, 8);

  // The roster card renders 'Member' for an empty display_name — honest, but
  // a placeholder in a baseline whose job is to show what a real screen looks
  // like. `handle_new_user` has already created this row.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ display_name: 'Wei Chen', skill_level: 'intermediate' })
    .eq('id', profileId);
  if (profileError) {
    throw new Error(
      `seedClubWithEvent: profile update failed: ${JSON.stringify(profileError)}`,
    );
  }

  const club = need<{ id: string }>(
    'club insert',
    await admin
      .from('clubs')
      .insert({
        name: 'Riverside Mah Jongg',
        slug: `riverside-${suffix}`,
        rhythm: 'Tuesday evenings',
        timezone: 'America/New_York',
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const clubId = club.id;

  const { error: memberError } = await admin
    .from('club_members')
    .insert({ club_id: clubId, profile_id: profileId, role: 'host' });
  if (memberError) {
    throw new Error(
      `seedClubWithEvent: membership insert failed: ${JSON.stringify(memberError)}`,
    );
  }

  // One broadcast already sent. This used to give `broadcast history` a
  // real row to screenshot rather than the empty state; that baseline is
  // gone (Task 15), but the row is kept as harmless fixture data. event_id
  // null — the whole-roster case.
  const broadcast = need<{ id: string }>(
    'broadcast insert',
    await admin
      .from('broadcasts')
      .insert({
        club_id: clubId,
        event_id: null,
        author_id: profileId,
        subject: 'Doors at seven',
        body: 'Doors open at 7pm sharp this week, not the usual 7:30.',
        recipient_count: 3,
      })
      .select('id')
      .single(),
  );
  const broadcastId = broadcast.id;

  const venues = need<{ id: string; name: string }[]>(
    'venue insert',
    await admin
      .from('venues')
      .insert([
        {
          name: 'St Mary’s Hall',
          address_line: '18 Chapel Street',
          locality: 'Newton',
          added_by_club_id: clubId,
          created_by: profileId,
        },
        {
          name: 'Newton Community Centre',
          address_line: '92 Beacon Road',
          locality: 'Newton',
          added_by_club_id: clubId,
          created_by: profileId,
        },
      ])
      .select('id, name'),
  );

  const usualVenue = venues.find((v) => v.name.startsWith('St Mary'))!;
  const movedVenue = venues.find((v) => v.name.startsWith('Newton'))!;

  const series = need<{ id: string }>(
    'series insert',
    await admin
      .from('event_series')
      .insert({
        club_id: clubId,
        title: 'Tuesday night mahjong',
        venue_id: usualVenue.id,
        notes: SEEDED_NOTES,
        frequency: 'weekly',
        weekday: 2,
        start_time: '19:00',
        duration_minutes: 180,
        table_count: 2,
        starts_on: FIRST_OCCURRENCE.date,
        materialized_through: SECOND_OCCURRENCE.date,
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const seriesId = series.id;

  // The first occurrence carries a venue override, so the event screen shows
  // its "Moved from the usual venue" annotation and the edit screen has a
  // customised week to offer the overridden-occurrences toggle for. The
  // second is untouched, so the club screen's Upcoming list has more than one
  // card and the two states sit side by side.
  const occurrences = need<{ id: string; occurrence_date: string }[]>(
    'occurrence insert',
    await admin
      .from('events')
      .insert([
        {
          club_id: clubId,
          series_id: seriesId,
          title: 'Tuesday night mahjong',
          venue_id: movedVenue.id,
          notes: SEEDED_NOTES,
          starts_at: FIRST_OCCURRENCE.startsAt,
          ends_at: FIRST_OCCURRENCE.endsAt,
          occurrence_date: FIRST_OCCURRENCE.date,
          overrides: ['venue_id'],
          created_by: profileId,
        },
        {
          club_id: clubId,
          series_id: seriesId,
          title: 'Tuesday night mahjong',
          venue_id: usualVenue.id,
          notes: SEEDED_NOTES,
          starts_at: SECOND_OCCURRENCE.startsAt,
          ends_at: SECOND_OCCURRENCE.endsAt,
          occurrence_date: SECOND_OCCURRENCE.date,
          // Spelled out rather than left to the column default. PostgREST
          // builds ONE insert statement for a bulk array and unions the keys
          // across its rows, so a key present on any row becomes an explicit
          // NULL on the rows that omit it — which `overrides` is `not null`
          // and rejects. Omitting it here failed the whole seed with a
          // not-null violation on a column that has a perfectly good default.
          overrides: [],
          created_by: profileId,
        },
      ])
      .select('id, occurrence_date'),
  );

  const eventId = occurrences.find(
    (e) => e.occurrence_date === FIRST_OCCURRENCE.date,
  )!.id;

  // Two tables at the default capacity of 4 on EVERY occurrence — what the
  // event screen renders as "2 tables · 8 seats", and what the series'
  // `table_count` of 2 says each week has. Tabling only the first occurrence
  // was tried and rejected on sight: the club screen's second card then read
  // "0 tables", which is not something a materialized week can ever be, and a
  // reviewer looking at that baseline would be looking at a fixture artefact
  // and wondering which bug it was.
  //
  // Tiers differ within an occurrence so the baseline shows both the selected
  // and unselected chip states an organizer sees. `skill_tier` is spelled out
  // on every row for the same PostgREST key-unioning reason as `overrides`
  // above — omitting it on some rows would send an explicit NULL into a
  // `not null` column.
  // `.select('id, event_id, label')` — not the fire-and-forget insert this
  // used to be — because the booking-state fixtures below need the FIRST
  // occurrence's two table ids to seat anyone at them.
  const tables = need<{ id: string; event_id: string; label: string }[]>(
    'table insert',
    await admin.from('event_tables').insert(
      occurrences.flatMap((occurrence) => [
        {
          event_id: occurrence.id,
          club_id: clubId,
          label: 'Table 1',
          position: 1,
          skill_tier: 'mixed',
        },
        {
          event_id: occurrence.id,
          club_id: clubId,
          label: 'Table 2',
          position: 2,
          skill_tier: 'beginner',
        },
      ]),
    ).select('id, event_id, label'),
  );

  const table1Id = tables.find(
    (t) => t.event_id === eventId && t.label === 'Table 1',
  )!.id;
  const table2Id = tables.find(
    (t) => t.event_id === eventId && t.label === 'Table 2',
  )!.id;

  // -------------------------------------------------------------------
  // Booking-state fixtures (Task 15). See the constants block above for
  // why these four games live in a second club and why their dates are
  // what they are.
  // -------------------------------------------------------------------

  const bookingClub = need<{ id: string }>(
    'second club insert',
    await admin
      .from('clubs')
      .insert({
        name: 'Thursday Casuals',
        slug: `thursday-${suffix}`,
        rhythm: 'Thursday evenings',
        timezone: 'America/New_York',
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const bookingClubId = bookingClub.id;

  // Host, same as Riverside above — Event D (`needsAFourthEventId`) needs
  // the signed-in member to be an organizer for the host's early-call
  // button to render at all.
  const { error: bookingMemberError } = await admin
    .from('club_members')
    .insert({ club_id: bookingClubId, profile_id: profileId, role: 'host' });
  if (bookingMemberError) {
    throw new Error(
      `seedClubWithEvent: booking club membership insert failed: ${JSON.stringify(bookingMemberError)}`,
    );
  }

  const bookingVenue = need<{ id: string }>(
    'booking club venue insert',
    await admin
      .from('venues')
      .insert({
        name: 'Club Two Hall',
        address_line: '4 Elm Street',
        locality: 'Newton',
        added_by_club_id: bookingClubId,
        created_by: profileId,
      })
      .select('id')
      .single(),
  );

  // Four one-off games (no series — nothing about these needs a recurrence),
  // titled distinctly so `getByText` on any one of them cannot accidentally
  // match another.
  const bookingEvents = need<{ id: string; title: string }[]>(
    'booking events insert',
    await admin
      .from('events')
      .insert([
        {
          club_id: bookingClubId,
          title: 'Full house game',
          venue_id: bookingVenue.id,
          notes: '',
          starts_at: FULL_GAME.startsAt,
          ends_at: FULL_GAME.endsAt,
          created_by: profileId,
        },
        {
          club_id: bookingClubId,
          title: 'Offer night',
          venue_id: bookingVenue.id,
          notes: '',
          starts_at: OFFER_GAME.startsAt,
          ends_at: OFFER_GAME.endsAt,
          created_by: profileId,
        },
        {
          club_id: bookingClubId,
          title: 'Short table game',
          venue_id: bookingVenue.id,
          notes: '',
          starts_at: NEEDS_A_FOURTH_GAME.startsAt,
          ends_at: NEEDS_A_FOURTH_GAME.endsAt,
          created_by: profileId,
        },
        {
          club_id: bookingClubId,
          title: 'Saturday pickup game',
          venue_id: bookingVenue.id,
          notes: '',
          starts_at: FRIEND_GAME.startsAt,
          ends_at: FRIEND_GAME.endsAt,
          created_by: profileId,
        },
      ])
      .select('id, title'),
  );
  const fullEventId = bookingEvents.find((e) => e.title === 'Full house game')!.id;
  const offerEventId = bookingEvents.find((e) => e.title === 'Offer night')!.id;
  const needsAFourthEventId = bookingEvents.find(
    (e) => e.title === 'Short table game',
  )!.id;
  const friendEventId = bookingEvents.find(
    (e) => e.title === 'Saturday pickup game',
  )!.id;

  // One table apiece, at the default capacity of 4 — every booking-state
  // scenario below is written in terms of that default.
  const bookingTables = need<{ id: string; event_id: string }[]>(
    'booking tables insert',
    await admin
      .from('event_tables')
      .insert([
        { event_id: fullEventId, club_id: bookingClubId, label: 'Table 1', position: 1 },
        { event_id: offerEventId, club_id: bookingClubId, label: 'Table 1', position: 1 },
        {
          event_id: needsAFourthEventId,
          club_id: bookingClubId,
          label: 'Table 1',
          position: 1,
        },
        { event_id: friendEventId, club_id: bookingClubId, label: 'Table 1', position: 1 },
      ])
      .select('id, event_id'),
  );
  const fullTableId = bookingTables.find((t) => t.event_id === fullEventId)!.id;
  const offerTableId = bookingTables.find((t) => t.event_id === offerEventId)!.id;
  const needsAFourthTableId = bookingTables.find(
    (t) => t.event_id === needsAFourthEventId,
  )!.id;
  const friendTableId = bookingTables.find((t) => t.event_id === friendEventId)!.id;

  // Ten filler profiles, five per club — reused across a club's own games
  // (a booking's uniqueness is scoped per EVENT, not globally, so the same
  // person can hold a seat in more than one of these without conflict).
  const [priya, marcus, dana, leo, hana] = await Promise.all([
    seedFillerProfile(admin, 'Priya Nair', 'priya', suffix),
    seedFillerProfile(admin, 'Marcus Webb', 'marcus', suffix),
    seedFillerProfile(admin, 'Dana Osei', 'dana', suffix),
    seedFillerProfile(admin, 'Leo Fitzgerald', 'leo', suffix),
    seedFillerProfile(admin, 'Hana Suzuki', 'hana', suffix),
  ]);
  const [owen, sofia, ravi, naomi, theo] = await Promise.all([
    seedFillerProfile(admin, 'Owen Bradley', 'owen', suffix),
    seedFillerProfile(admin, 'Sofia Marchetti', 'sofia', suffix),
    seedFillerProfile(admin, 'Ravi Kapoor', 'ravi', suffix),
    seedFillerProfile(admin, 'Naomi Clarke', 'naomi', suffix),
    seedFillerProfile(admin, 'Theo Nguyen', 'theo', suffix),
  ]);

  // State 1 + 2: a mixed table with room left (the signed-in member plus
  // one other), and a second table, full — both on the FIRST occurrence of
  // Riverside's own series, which is also what `event-detail`'s baseline
  // now screenshots and why that baseline grew.
  await seatBooking(admin, need, { eventId, clubId, profileId, tableId: table1Id });
  await seatBooking(admin, need, { eventId, clubId, profileId: priya, tableId: table1Id });
  await seatBooking(admin, need, { eventId, clubId, profileId: marcus, tableId: table2Id });
  await seatBooking(admin, need, { eventId, clubId, profileId: dana, tableId: table2Id });
  await seatBooking(admin, need, { eventId, clubId, profileId: leo, tableId: table2Id });
  await seatBooking(admin, need, { eventId, clubId, profileId: hana, tableId: table2Id });

  // `event full`: every seat at the one table taken by someone else, plus
  // one more person waitlisted (not the member) so WaitlistPanel's "Waiting
  // for a seat" card has something in it, not just the "Join the waitlist"
  // button.
  await seatBooking(admin, need, {
    eventId: fullEventId,
    clubId: bookingClubId,
    profileId: owen,
    tableId: fullTableId,
  });
  await seatBooking(admin, need, {
    eventId: fullEventId,
    clubId: bookingClubId,
    profileId: sofia,
    tableId: fullTableId,
  });
  await seatBooking(admin, need, {
    eventId: fullEventId,
    clubId: bookingClubId,
    profileId: ravi,
    tableId: fullTableId,
  });
  await seatBooking(admin, need, {
    eventId: fullEventId,
    clubId: bookingClubId,
    profileId: naomi,
    tableId: fullTableId,
  });
  await seatBooking(admin, need, {
    eventId: fullEventId,
    clubId: bookingClubId,
    profileId: theo,
    waitlisted: true,
  });

  // `event offer`: the table full again, and the signed-in member's OWN
  // group waitlisted with an outstanding offer — it has to be the member's
  // own group, because `fetchOpenOffer`'s RLS policy
  // (`promotion_offers_select_group`) only lets a caller see an offer made
  // to a group they are actually in.
  await seatBooking(admin, need, {
    eventId: offerEventId,
    clubId: bookingClubId,
    profileId: owen,
    tableId: offerTableId,
  });
  await seatBooking(admin, need, {
    eventId: offerEventId,
    clubId: bookingClubId,
    profileId: sofia,
    tableId: offerTableId,
  });
  await seatBooking(admin, need, {
    eventId: offerEventId,
    clubId: bookingClubId,
    profileId: ravi,
    tableId: offerTableId,
  });
  await seatBooking(admin, need, {
    eventId: offerEventId,
    clubId: bookingClubId,
    profileId: naomi,
    tableId: offerTableId,
  });
  const memberWaitlisted = await seatBooking(admin, need, {
    eventId: offerEventId,
    clubId: bookingClubId,
    profileId,
    waitlisted: true,
  });
  const { error: offerError } = await admin.from('promotion_offers').insert({
    group_id: memberWaitlisted.groupId,
    event_id: offerEventId,
    offered_seat_count: 1,
    expires_at: OFFER_EXPIRES_AT,
  });
  if (offerError) {
    throw new Error(
      `seedClubWithEvent: promotion offer insert failed: ${JSON.stringify(offerError)}`,
    );
  }

  // `event needs a fourth`: one table, three of its four seats taken by
  // people who are NOT the signed-in member, inside the 48-hour call
  // window — `needsAFourth`'s exact trigger.
  await seatBooking(admin, need, {
    eventId: needsAFourthEventId,
    clubId: bookingClubId,
    profileId: owen,
    tableId: needsAFourthTableId,
  });
  await seatBooking(admin, need, {
    eventId: needsAFourthEventId,
    clubId: bookingClubId,
    profileId: sofia,
    tableId: needsAFourthTableId,
  });
  await seatBooking(admin, need, {
    eventId: needsAFourthEventId,
    clubId: bookingClubId,
    profileId: ravi,
    tableId: needsAFourthTableId,
  });

  // `clubs-populated`'s "Your games" second row: a seat Owen booked FOR the
  // signed-in member (`bookedBy: owen`, `profileId` the member's own) — the
  // `booked_by !== youId` state that renders "Owen Bradley booked this for
  // you" and the Decline control, distinct from the member's own
  // self-booked seat on Riverside's event above.
  await seatBooking(admin, need, {
    eventId: friendEventId,
    clubId: bookingClubId,
    profileId,
    bookedBy: owen,
    tableId: friendTableId,
  });

  // -------------------------------------------------------------------
  // Check-in door screen fixture (Task 15). A one-off event under
  // Riverside, `check_in_required: true`, with its window open at the
  // page's frozen clock (CHECK_IN_GAME above) and one person in each of
  // the door screen's three render groups (groupRows,
  // app/clubs/[id]/events/[eventId]/check-in.tsx): a table assignment, a
  // confirmed booking with no table ("Any table" — event_table_id null,
  // via seatBooking without a tableId), and a walk-in with no booking at
  // all (a check_ins row and nothing else). Two of the four are
  // pre-recorded — one arrived, one no_show — so the baseline also shows
  // CheckInControl's two selected-chip colours, not just its unset state.
  // Reuses the filler profiles seeded above rather than minting new ones:
  // a booking's uniqueness is scoped per event (seatBooking's own doc
  // comment), so the same person can hold a seat here too.
  const checkInEvent = need<{ id: string }>(
    'check-in event insert',
    await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Door check-in night',
        venue_id: usualVenue.id,
        notes: '',
        starts_at: CHECK_IN_GAME.startsAt,
        ends_at: CHECK_IN_GAME.endsAt,
        check_in_required: true,
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const checkInEventId = checkInEvent.id;

  const checkInTables = need<{ id: string; label: string }[]>(
    'check-in tables insert',
    await admin
      .from('event_tables')
      .insert([
        { event_id: checkInEventId, club_id: clubId, label: 'Table 1', position: 1 },
        { event_id: checkInEventId, club_id: clubId, label: 'Table 2', position: 2 },
      ])
      .select('id, label'),
  );
  const checkInTable1Id = checkInTables.find((t) => t.label === 'Table 1')!.id;
  const checkInTable2Id = checkInTables.find((t) => t.label === 'Table 2')!.id;

  // Table 1: the signed-in host (Wei Chen, arrived) and Priya (not yet
  // determined). Table 2: Marcus (no_show). Any table: Dana (arrived).
  await seatBooking(admin, need, {
    eventId: checkInEventId,
    clubId,
    profileId,
    tableId: checkInTable1Id,
  });
  await seatBooking(admin, need, {
    eventId: checkInEventId,
    clubId,
    profileId: priya,
    tableId: checkInTable1Id,
  });
  await seatBooking(admin, need, {
    eventId: checkInEventId,
    clubId,
    profileId: marcus,
    tableId: checkInTable2Id,
  });
  await seatBooking(admin, need, {
    eventId: checkInEventId,
    clubId,
    profileId: dana,
  });

  const { error: checkInsError } = await admin.from('check_ins').insert([
    {
      event_id: checkInEventId,
      club_id: clubId,
      profile_id: profileId,
      state: 'arrived',
      recorded_by: profileId,
    },
    {
      event_id: checkInEventId,
      club_id: clubId,
      profile_id: marcus,
      state: 'no_show',
      recorded_by: profileId,
    },
    {
      event_id: checkInEventId,
      club_id: clubId,
      profile_id: dana,
      state: 'arrived',
      recorded_by: profileId,
    },
    // Leo has no booking at all here — that absence is what makes him a
    // walk-in (groupRows checks `booking_status === null` first).
    {
      event_id: checkInEventId,
      club_id: clubId,
      profile_id: leo,
      state: 'arrived',
      recorded_by: profileId,
    },
  ]);
  if (checkInsError) {
    throw new Error(
      `seedClubWithEvent: check-ins insert failed: ${JSON.stringify(checkInsError)}`,
    );
  }

  return {
    clubId,
    eventId,
    seriesId,
    bookingClubId,
    fullEventId,
    offerEventId,
    needsAFourthEventId,
    broadcastId,
    checkInEventId,
  };
}

/**
 * Seeds one club-thread message authored by somebody OTHER than the
 * signed-in member, for the one baseline that has to picture the unread
 * badge (Task 16 shipped it on the Messages tab and the dashboard's club
 * chips; nothing had ever screenshotted it — see the visual suite's own
 * comment on `messages badge at …`).
 *
 * Deliberately NOT folded into `seedClubWithEvent`: that function runs from
 * the shared `beforeEach` in `e2e/visual.spec.ts`'s "with a seeded club"
 * block, so anything it seeds lands in EVERY test there, including the
 * `clubs-populated` and `club-detail` baselines this task does not touch. A
 * standalone function called from just the one new test keeps this addition
 * as narrow as the picture it exists to take.
 *
 * A message the viewer sent themselves is never unread —
 * `fetch_my_threads`' own unread lateral join filters on
 * `m.author_id <> auth.uid()` — so this mints a fresh filler profile as the
 * author, the same way `seedFillerProfile` above does for a seat, rather
 * than reusing the signed-in member's own id.
 *
 * Writes the `message_threads` and `messages` rows directly, the same
 * service-role, no-RPC pattern `seatBooking` uses and for the same reason:
 * service_role carries no JWT, so `post_message`'s own `auth.uid()` checks
 * have nothing to authenticate against. No `thread_members` row is needed —
 * a club thread's membership is derived from `club_members`, never
 * materialised (20260829000000's own docstring).
 */
export async function seedUnreadClubMessage(
  clubId: string,
  suffix: string,
): Promise<void> {
  const admin = adminClient('seed unread message');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(`seedUnreadClubMessage: ${what} failed: ${JSON.stringify(result.error)}`);
    }
    return result.data as T;
  };

  const authorId = await seedFillerProfile(admin, 'Nadia Farouk', 'unread-author', suffix);

  const thread = need<{ id: string }>(
    'unread club thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: clubId,
        event_id: null,
        created_by: authorId,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
  );

  const { error: messageError } = await admin.from('messages').insert({
    thread_id: thread.id,
    author_id: authorId,
    body: 'Reminder: bring your own set this week if you can!',
  });
  if (messageError) {
    throw new Error(
      `seedUnreadClubMessage: message insert failed: ${JSON.stringify(messageError)}`,
    );
  }
}

/**
 * Seeds a POPULATED messages list: a club thread, a game thread and a
 * direct thread, each carrying one message -- the minimum spread needed to
 * picture the flat-list restyle's pinned-clubs-first ordering
 * (`orderThreadsForList`, lib/messages.ts) and three of ThreadRow's four
 * avatar treatments in one screen (club, game, direct; group is the one
 * kind still unpictured after this task -- see docs/testing.md's "Known
 * visual gaps"). Nothing prior to Task 17 ever screenshotted this screen
 * with a row in it: every other `messages-*` baseline is the EMPTY state,
 * and the agent that did the restyle had to write a throwaway spec, look at
 * it, and delete it.
 *
 * Distinct from `seedUnreadClubMessage` just above, which exists for a
 * narrower job -- pin the unread badge on the DASHBOARD (TabBar's tab and
 * ClubChips' chip), seeding exactly one club row for that. This seeds three
 * kinds at once for the messages LIST itself, so it is its own function
 * rather than a parallel setup path or a change to that one's signature.
 * The game thread rides the event `seedClubWithEvent` already seeded
 * (`eventId`) rather than minting a second one: the signed-in member is
 * already that club's host, and `can_read_thread`'s game branch
 * (20260829010000_thread_predicates.sql) admits any organizer regardless of
 * a booking, so no extra fixture is needed to make it readable.
 *
 * Every author is a FRESH filler profile, never the signed-in member --
 * same reasoning as `seedUnreadClubMessage`'s own comment: a message you
 * sent yourself is never unread (`fetch_my_threads`' lateral join filters
 * on `author_id <> auth.uid()`), and a viewer-authored preview line reads
 * like a diary entry ("Wei Chen: ...") rather than a conversation.
 *
 * Every timestamp is fixed relative to the suite's frozen clock
 * (`page.clock.setFixedTime`, set in `e2e/visual.spec.ts` before this ever
 * runs) rather than `new Date()`, and on the same calendar day as it,
 * strictly before it -- not merely because a real-wall-clock timestamp
 * rotates the baseline (the reason every fixture above pins its own
 * instants), but because `relativeTimestamp` (lib/messages.ts) renders
 * relative to the PAGE's clock. A message dated after the frozen "now" the
 * page reads would print as a date in that "now"'s own future, which is a
 * baseline of a bug that does not otherwise exist.
 *
 * The three messages land in newest-first order among themselves --
 * direct (15:15), then game (14:00) -- so `orderThreadsForList`'s split
 * has something to actually order (club pinned first regardless of
 * recency, then the rest newest-active-first), and the direct thread's
 * `thread_members.joined_at` is set BEFORE its message's timestamp, so
 * that row also comes back unread -- the one baseline in this suite that
 * pictures ThreadRow's own inline `UnreadBadge` sitting next to its
 * timestamp, not just the dashboard's copies of it.
 */
export async function seedPopulatedMessagesList(
  clubId: string,
  eventId: string,
  viewerId: string,
  suffix: string,
): Promise<void> {
  const admin = adminClient('seed populated messages list');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(
        `seedPopulatedMessagesList: ${what} failed: ${JSON.stringify(result.error)}`,
      );
    }
    return result.data as T;
  };

  const [clubAuthor, gameAuthor, directPartner] = await Promise.all([
    seedFillerProfile(admin, 'Grace Liu', 'msg-club', suffix),
    seedFillerProfile(admin, 'Felix Turner', 'msg-game', suffix),
    seedFillerProfile(admin, 'Yusuf Ahmed', 'msg-direct', suffix),
  ]);

  // Club: message_threads_one_per_club's own partial unique index (club_id
  // where event_id is null) is what makes this the only club thread this
  // club can ever get, seeded or otherwise.
  const clubThread = need<{ id: string }>(
    'club thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: clubId,
        event_id: null,
        created_by: clubAuthor,
        last_message_at: '2026-08-22T15:30:00Z',
      })
      .select('id')
      .single(),
  );
  const { error: clubMessageError } = await admin.from('messages').insert({
    thread_id: clubThread.id,
    author_id: clubAuthor,
    body: 'Reminder: bring exact change for the raffle this week!',
    created_at: '2026-08-22T15:30:00Z',
  });
  if (clubMessageError) {
    throw new Error(
      `seedPopulatedMessagesList: club message insert failed: ${JSON.stringify(clubMessageError)}`,
    );
  }

  // Game: club_id must equal the event's own club -- message_threads'
  // (event_id, club_id) composite foreign key makes any other pairing
  // unstateable, the same guard bookings and broadcasts carry.
  const gameThread = need<{ id: string }>(
    'game thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: clubId,
        event_id: eventId,
        created_by: gameAuthor,
        last_message_at: '2026-08-22T14:00:00Z',
      })
      .select('id')
      .single(),
  );
  const { error: gameMessageError } = await admin.from('messages').insert({
    thread_id: gameThread.id,
    author_id: gameAuthor,
    body: 'Save me a seat at Table 1 if there is room!',
    created_at: '2026-08-22T14:00:00Z',
  });
  if (gameMessageError) {
    throw new Error(
      `seedPopulatedMessagesList: game message insert failed: ${JSON.stringify(gameMessageError)}`,
    );
  }

  // Direct: a group of two (20260829000000_message_threads.sql's own
  // docstring -- "A direct message is not a kind. It is a group of two.") --
  // no club_id, no event_id, membership lives in thread_members instead of
  // being derived.
  const directThread = need<{ id: string }>(
    'direct thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: null,
        event_id: null,
        title: null,
        created_by: directPartner,
        last_message_at: '2026-08-22T15:15:00Z',
      })
      .select('id')
      .single(),
  );
  const { error: membersError } = await admin.from('thread_members').insert([
    {
      thread_id: directThread.id,
      profile_id: viewerId,
      added_by: directPartner,
      joined_at: '2026-08-22T13:00:00Z',
    },
    {
      thread_id: directThread.id,
      profile_id: directPartner,
      added_by: directPartner,
      joined_at: '2026-08-22T13:00:00Z',
    },
  ]);
  if (membersError) {
    throw new Error(
      `seedPopulatedMessagesList: thread members insert failed: ${JSON.stringify(membersError)}`,
    );
  }
  const { error: directMessageError } = await admin.from('messages').insert({
    thread_id: directThread.id,
    author_id: directPartner,
    body: 'Looking forward to Tuesday -- see you there!',
    created_at: '2026-08-22T15:15:00Z',
  });
  if (directMessageError) {
    throw new Error(
      `seedPopulatedMessagesList: direct message insert failed: ${JSON.stringify(directMessageError)}`,
    );
  }
}

/**
 * Seeds an EMPTY GROUP thread -- three members, no messages -- so the flat
 * thread screen's own empty state (`app/messages/[threadId].tsx`) still has
 * something to picture.
 *
 * That baseline used to be shot on the club thread, reached by clicking the
 * club row in the messages list. Both halves of that stopped working at
 * once: the row lands on the BOARD now, and the flat screen redirects a club
 * thread there itself, so a club thread can no longer render this screen at
 * all. A group is the cheapest kind that still belongs here -- no club, no
 * event, no bookings, membership stored rather than derived.
 *
 * THREE members (the viewer and two fillers), not two: a group of exactly
 * two is a DIRECT thread (20260829000000's own docstring -- "A direct
 * message is not a kind. It is a group of two."), which renders a different
 * avatar and a different title. Three keeps this the group case.
 *
 * `title` is set rather than left to `threadTitleFor`'s join-the-first-names
 * fallback, so the header pill reads the same regardless of what order the
 * filler profiles happen to come back in.
 */
export async function seedEmptyGroupThread(
  viewerId: string,
  suffix: string,
): Promise<{ threadId: string }> {
  const admin = adminClient('seed empty group thread');

  const [first, second] = await Promise.all([
    seedFillerProfile(admin, 'Priya Shah', 'empty-group-a', suffix),
    seedFillerProfile(admin, 'Yusuf Ahmed', 'empty-group-b', suffix),
  ]);

  const { data, error } = await admin
    .from('message_threads')
    .insert({
      club_id: null,
      event_id: null,
      title: 'Tuesday regulars',
      created_by: first,
      last_message_at: null,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `seedEmptyGroupThread: thread insert failed: ${JSON.stringify(error)}`,
    );
  }

  const { error: membersError } = await admin.from('thread_members').insert(
    [viewerId, first, second].map((profileId) => ({
      thread_id: data.id,
      profile_id: profileId,
      added_by: first,
      joined_at: '2026-08-22T13:00:00Z',
    })),
  );
  if (membersError) {
    throw new Error(
      `seedEmptyGroupThread: thread members insert failed: ${JSON.stringify(membersError)}`,
    );
  }

  return { threadId: data.id };
}

/**
 * Seeds a POPULATED thread -- four messages in one GAME thread, so the
 * thread screen's own bubble treatments (`app/messages/[threadId].tsx`) have
 * something to picture. Every OTHER `thread-*` baseline in this suite is the
 * EMPTY thread: nothing has ever screenshotted an actual message, let alone
 * the viewer's OWN bubble, somebody else's, or an announcement's, which is
 * exactly the "amateurish" the bubbles were flagged for -- guarded by
 * nothing since nobody could see them.
 *
 * A GAME thread, not the club thread this used to seed. A club's
 * conversation is a BOARD now, and `app/messages/[threadId].tsx` redirects
 * one straight to `/messages/club/{id}` -- there is no longer any way to
 * picture a club thread on the flat screen, because the app will not render
 * one. A game thread is the kind that keeps every treatment below reachable:
 * it stays flat, and unlike a group it carries a club_id, so `post_message`
 * still permits the ANNOUNCEMENT this fixture seeds ('a group has no roster
 * to announce to' is what a group thread would refuse it with). Seeding an
 * announcement into a group thread would have pictured a state the app
 * cannot produce, which is worse than not picturing it.
 *
 * Distinct from `seedPopulatedMessagesList` just above, which seeds THREE
 * different THREADS (club, game, direct) with one message each to picture
 * the messages LIST's row treatments. This seeds ONE thread with FOUR
 * messages to picture the thread SCREEN's own bubble treatments instead --
 * different job, own function, rather than overloading that one's signature.
 *
 * The four messages cover every bubble treatment this screen renders:
 *
 *   1. a FILLER author's ordinary message ("theirs" -- attributed, muted)
 *   2. the VIEWER's own reply ("mine" -- accent-filled, unattributed)
 *   3. a SECOND filler's ANNOUNCEMENT (the accent2 tag/subject treatment)
 *   4. a THIRD filler's ordinary message, so the announcement is not the
 *      last bubble in the thread either
 *
 * Every filler is a FRESH profile, the same reasoning `seedUnreadClubMessage`
 * and `seedPopulatedMessagesList` both give: a message the viewer sent
 * themselves proves nothing about how somebody ELSE's bubble renders, and
 * three distinct authors (not one, reused) prove the "theirs" author-name
 * treatment actually varies per sender rather than being hardcoded.
 *
 * Timestamps are fixed, on the same calendar day as and strictly before the
 * suite's frozen clock (`page.clock.setFixedTime`, `e2e/visual.spec.ts`),
 * for the identical reason `seedPopulatedMessagesList`'s own comment gives:
 * a real-wall-clock timestamp rotates the baseline, and `relativeTimestamp`
 * renders relative to the PAGE's clock, not the seed's.
 */
export async function seedPopulatedThread(
  clubId: string,
  eventId: string,
  viewerId: string,
  suffix: string,
): Promise<{ threadId: string }> {
  const admin = adminClient('seed populated thread');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(`seedPopulatedThread: ${what} failed: ${JSON.stringify(result.error)}`);
    }
    return result.data as T;
  };

  const [askAuthor, announceAuthor, thanksAuthor] = await Promise.all([
    seedFillerProfile(admin, 'Priya Shah', 'thread-ask', suffix),
    seedFillerProfile(admin, 'Wanda Cole', 'thread-announce', suffix),
    seedFillerProfile(admin, 'Yusuf Ahmed', 'thread-thanks', suffix),
  ]);

  // A GAME thread: club_id must equal the event's own club -- message_threads'
  // (event_id, club_id) composite foreign key makes any other pairing
  // unstateable, the same guard seedPopulatedMessagesList's own game-thread
  // insert records. The viewer reads it as an organizer of the seeded club
  // (`can_read_thread`, 20260829010000: "a seat of any colour, or an
  // organizer of the club"), so no booking is needed here.
  const thread = need<{ id: string }>(
    'game thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: clubId,
        event_id: eventId,
        created_by: askAuthor,
        last_message_at: '2026-08-22T14:15:00Z',
      })
      .select('id')
      .single(),
  );

  // Four SEPARATE inserts, not one array insert -- a single `.insert([...])`
  // call with heterogeneous row shapes sends the UNION of every object's
  // keys as the bulk statement's column list, and PostgREST fills a row that
  // omits one of those keys with an explicit NULL rather than letting the
  // column's own DEFAULT apply. `is_announcement boolean not null default
  // false` then rejects the three plain messages outright, since only the
  // announcement row supplies that key. `seedPopulatedMessagesList` above
  // avoids this the same way, one insert per row.
  const { error: askError } = await admin.from('messages').insert({
    thread_id: thread.id,
    author_id: askAuthor,
    body: 'Are we still on for Tuesday’s game?',
    created_at: '2026-08-22T14:00:00Z',
  });
  if (askError) {
    throw new Error(
      `seedPopulatedThread: ask message insert failed: ${JSON.stringify(askError)}`,
    );
  }

  const { error: replyError } = await admin.from('messages').insert({
    thread_id: thread.id,
    author_id: viewerId,
    body: 'Yes! I will bring extra tiles.',
    created_at: '2026-08-22T14:05:00Z',
  });
  if (replyError) {
    throw new Error(
      `seedPopulatedThread: viewer reply insert failed: ${JSON.stringify(replyError)}`,
    );
  }

  const { error: announceError } = await admin.from('messages').insert({
    thread_id: thread.id,
    author_id: announceAuthor,
    subject: 'Hall closed this week',
    body: 'Hall closed this week\nWe will meet at the community center instead.',
    is_announcement: true,
    created_at: '2026-08-22T14:10:00Z',
  });
  if (announceError) {
    throw new Error(
      `seedPopulatedThread: announcement insert failed: ${JSON.stringify(announceError)}`,
    );
  }

  const { error: thanksError } = await admin.from('messages').insert({
    thread_id: thread.id,
    author_id: thanksAuthor,
    body: 'Thanks for letting us know!',
    created_at: '2026-08-22T14:15:00Z',
  });
  if (thanksError) {
    throw new Error(
      `seedPopulatedThread: thanks message insert failed: ${JSON.stringify(thanksError)}`,
    );
  }

  return { threadId: thread.id };
}

/**
 * Seeds a POPULATED board — a club of its own, with a club thread carrying
 * two posts that each have real replies, so the board and post screens
 * (`app/messages/club/[threadId]/index.tsx`, `app/messages/club/[threadId]/
 * [postId].tsx`) have something to picture besides the empty case.
 *
 * `seedPopulatedThread` above seeds four ROOT-level messages (none set
 * `root_id`) and is what the board/post baselines used until this task —
 * every post it produces therefore reads "No replies", because nothing in
 * it is actually a reply. The board and post screens exist to show a post
 * WITH a threaded discussion under it; a fixture that cannot produce one
 * cannot picture the thing the feature adds. Direct inserts bypass
 * `post_message` (20260830010000), so this sets `root_id`, `reply_count`
 * and `last_reply_at` itself — the same denormalisation `post_message`
 * performs in its own transaction (see that migration: `reply_count =
 * reply_count + 1, last_reply_at = now()` on every reply) — rather than
 * leaving `fetch_club_posts` to read stale zeros off rows it never
 * recomputes on read.
 *
 * A brand-new club, not `seeded.clubId` (Riverside): `seedPopulatedThread`
 * is left completely untouched by this function, but sharing a club would
 * still leave a shared surface for a future edit to trip over, and this
 * function needs its own `club_members` row anyway, stamped with a
 * `joined_at` in the PAST relative to the seeded messages (see below) —
 * touching Riverside's own membership row, seeded with the real wall clock
 * by `seedClubWithEvent`, would be a second, harder-to-notice way for a
 * future change here to reach into a fixture other baselines depend on. A
 * club of its own keeps the blast radius exactly the two tests that call
 * this.
 *
 * `floorAt` and every message timestamp sit in the SAME 2026-08-21/22
 * window `seedPopulatedThread` and `seedClubWithEvent`'s own fixtures use,
 * because `e2e/visual.spec.ts` freezes the PAGE's clock to
 * `2026-08-22T16:00:00Z` before any of this runs — `relativeTimestamp` and
 * `groupSeparatorLabel` (lib/messages.ts) both read that frozen "now", so a
 * timestamp outside its frame reads as a bug in the baseline rather than a
 * picture of one. `club_members.joined_at` is a different matter: unlike
 * every timestamp on a message, it is inserted by THIS function running in
 * Node, against the real Postgres wall clock (page.clock only patches the
 * browser's Date, never this admin client's) — so it defaults to
 * "whatever day this suite happens to run," which sits AFTER every
 * 2026-08-22 message. `fetch_club_posts`' own unread arithmetic floors on
 * exactly that column
 * (`greatest(floor_at, coalesce(post_reads.last_read_at, floor_at))`,
 * 20260830020000_board_reads.sql) — a joined_at left at its default would
 * floor out every seeded message and the badge this fixture exists to show
 * would never appear. `joinedAt` below is passed explicitly for that
 * reason, dated before every message that follows it.
 *
 * Two posts, not one, so the board still shows more than a single row (the
 * same proof `seedPopulatedThread`'s own board test used to make) and the
 * announcement's distinct rail-and-tag treatment stays pictured alongside
 * an ordinary post:
 *
 *   - an ANNOUNCEMENT root with FOUR replies, spread across three time
 *     groups (a gap of exactly `GROUP_GAP_MS` or more, or a day boundary —
 *     `startsNewGroup`, lib/messages.ts) so the post screen's separators
 *     have more than one to draw, plus one reply authored by the VIEWER —
 *     the post screen's "mine" bubble treatment — among three other reply
 *     authors, so a fixture with only one other voice could not be mistaken
 *     for proof the author-attribution line varies per sender.
 *   - a PLAIN post with two replies, so `replyCountLabel`'s plural form
 *     ("2 replies") sits on the board next to the announcement's ("4
 *     replies") — a single populated post could only ever prove the
 *     singular or the plural, never that the count itself is read off the
 *     row rather than hard-coded.
 *
 * Every author but the viewer's own single reply is a FRESH filler
 * profile, the same reasoning `seedPopulatedThread`'s own docstring
 * gives — and, per `fetch_club_posts`' own `r.author_id <> caller` clause,
 * why every row not authored by the viewer counts toward that post's
 * unread total: this fixture does not have to contrive a SEPARATE
 * unread-only post the way `seedUnreadClubMessage` does for the dashboard
 * badge, because nothing here ever calls `mark_post_read` for either post
 * before the board baseline is shot.
 *
 * Returns the announcement's own id, not just the thread's, so the post
 * baseline can `page.goto` straight to it (`/messages/club/{threadId}/
 * {announcementId}`) instead of clicking the board row to get there. A
 * click is a CLIENT-SIDE navigation, and expo-router's web stack keeps the
 * screen it leaves mounted (hidden, not unmounted) rather than tearing it
 * down — so the board screen's OWN `testID="screen-scroll"` ScrollView is
 * still in the DOM under the post screen's identical testID, and
 * `captureScreen`'s `document.querySelector` (e2e/visual.spec.ts) returns
 * whichever of the two comes first, which does not have to be the one
 * actually on screen. That is latent in the click-based navigation the
 * `club post populated` test used before this task, not something this
 * fixture introduces — it stayed invisible only because the post it opened
 * had no replies to overflow the viewport and so never needed
 * `captureScreen` to grow anything. A `page.goto` is a full browser
 * navigation, the same one `thread populated`'s own test already uses to
 * reach its thread id, and it tears down the previous screen entirely, so
 * there is only ever one `screen-scroll` node for the selector to find.
 */
export async function seedPopulatedBoard(
  profileId: string,
  suffix: string,
): Promise<{ threadId: string; announcementId: string }> {
  const admin = adminClient('seed populated board');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(`seedPopulatedBoard: ${what} failed: ${JSON.stringify(result.error)}`);
    }
    return result.data as T;
  };

  const club = need<{ id: string }>(
    'club insert',
    await admin
      .from('clubs')
      .insert({
        name: 'Cedar Falls Mah Jongg',
        slug: `cedar-falls-${suffix}`,
        rhythm: 'Sunday afternoons',
        timezone: 'America/New_York',
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const clubId = club.id;

  // Dated before every message below, and NOT the column's own default —
  // see this function's own docstring on why `joined_at` cannot be left at
  // its real-wall-clock default here.
  const joinedAt = '2026-08-20T00:00:00Z';
  const { error: memberError } = await admin
    .from('club_members')
    .insert({ club_id: clubId, profile_id: profileId, role: 'member', joined_at: joinedAt });
  if (memberError) {
    throw new Error(`seedPopulatedBoard: membership insert failed: ${JSON.stringify(memberError)}`);
  }

  const [announceAuthor, replyAuthorA, replyAuthorB, replyAuthorC, postAuthor, postReplyA, postReplyB] =
    await Promise.all([
      seedFillerProfile(admin, 'Mara Ellison', 'board-announce', suffix),
      seedFillerProfile(admin, 'Devon Cole', 'board-reply-a', suffix),
      seedFillerProfile(admin, 'Sana Iqbal', 'board-reply-b', suffix),
      seedFillerProfile(admin, 'Theo Nakamura', 'board-reply-c', suffix),
      seedFillerProfile(admin, 'Ruth Okafor', 'board-post', suffix),
      seedFillerProfile(admin, 'Callum Reyes', 'board-post-reply-a', suffix),
      seedFillerProfile(admin, 'Ines Duarte', 'board-post-reply-b', suffix),
    ]);

  const thread = need<{ id: string }>(
    'club thread insert',
    await admin
      .from('message_threads')
      .insert({
        club_id: clubId,
        event_id: null,
        created_by: announceAuthor,
        last_message_at: '2026-08-22T13:00:00Z',
      })
      .select('id')
      .single(),
  );
  const threadId = thread.id;

  // The announcement root. `2026-08-21` — the day BEFORE the frozen clock's
  // own day — is what gives the first reply-group boundary below a real day
  // change to fire on, not just a `GROUP_GAP_MS` gap.
  const root1 = need<{ id: string }>(
    'announcement root insert',
    await admin
      .from('messages')
      .insert({
        thread_id: threadId,
        author_id: announceAuthor,
        subject: 'Fall tournament signup opens Monday',
        body: 'Fall tournament signup opens Monday\nSeats go fast, so reply here if you want in.',
        is_announcement: true,
        created_at: '2026-08-21T14:00:00Z',
      })
      .select('id')
      .single(),
  );

  // Four replies. Timestamps deliberately fall into three groups
  // (`startsNewGroup`, lib/messages.ts): r1 stays within an hour of the
  // root (same group as the root itself); r2 is both a day later AND more
  // than an hour on (new group); r3 stays within an hour of r2 (same
  // group); r4 is more than an hour after r3, same day (a third group).
  const root1Replies: { author: string; body: string; created_at: string }[] = [
    { author: profileId, body: 'Count me in, I will bring extra tiles too.', created_at: '2026-08-21T14:20:00Z' },
    { author: replyAuthorA, body: 'Same here — put me down for two seats.', created_at: '2026-08-22T09:00:00Z' },
    { author: replyAuthorB, body: 'Is the beginner table still running this year?', created_at: '2026-08-22T09:10:00Z' },
    { author: replyAuthorC, body: 'Yes, we kept the beginner table again this year.', created_at: '2026-08-22T13:00:00Z' },
  ];
  for (const reply of root1Replies) {
    const { error } = await admin.from('messages').insert({
      thread_id: threadId,
      author_id: reply.author,
      body: reply.body,
      root_id: root1.id,
      created_at: reply.created_at,
    });
    if (error) {
      throw new Error(`seedPopulatedBoard: root1 reply insert failed: ${JSON.stringify(error)}`);
    }
  }
  // Denormalised the same way `post_message` leaves them after four reply
  // inserts: a running `reply_count` and the LAST reply's own timestamp,
  // not `max()` over all of them — the two agree here only because the
  // replies above are listed in chronological order, the same assumption
  // `post_message`'s own `now()` update makes on every call it ever gets.
  const { error: root1UpdateError } = await admin
    .from('messages')
    .update({ reply_count: root1Replies.length, last_reply_at: root1Replies[root1Replies.length - 1].created_at })
    .eq('id', root1.id);
  if (root1UpdateError) {
    throw new Error(`seedPopulatedBoard: root1 update failed: ${JSON.stringify(root1UpdateError)}`);
  }

  // The plain post. Two replies, so `replyCountLabel(2)` reads "2 replies"
  // on the board next to the announcement's "4 replies" — the plural form
  // at a different count from the announcement's own, not a second copy of
  // it.
  const root2 = need<{ id: string }>(
    'plain post root insert',
    await admin
      .from('messages')
      .insert({
        thread_id: threadId,
        author_id: postAuthor,
        body: 'Anyone free to help set up tables Saturday morning?',
        created_at: '2026-08-22T10:00:00Z',
      })
      .select('id')
      .single(),
  );
  const root2Replies: { author: string; body: string; created_at: string }[] = [
    { author: postReplyA, body: 'I can be there by 9.', created_at: '2026-08-22T10:15:00Z' },
    { author: postReplyB, body: 'Count me in as well.', created_at: '2026-08-22T10:30:00Z' },
  ];
  for (const reply of root2Replies) {
    const { error } = await admin.from('messages').insert({
      thread_id: threadId,
      author_id: reply.author,
      body: reply.body,
      root_id: root2.id,
      created_at: reply.created_at,
    });
    if (error) {
      throw new Error(`seedPopulatedBoard: root2 reply insert failed: ${JSON.stringify(error)}`);
    }
  }
  const { error: root2UpdateError } = await admin
    .from('messages')
    .update({ reply_count: root2Replies.length, last_reply_at: root2Replies[root2Replies.length - 1].created_at })
    .eq('id', root2.id);
  if (root2UpdateError) {
    throw new Error(`seedPopulatedBoard: root2 update failed: ${JSON.stringify(root2UpdateError)}`);
  }

  return { threadId, announcementId: root1.id };
}

/**
 * Seeds a LIVE event -- published, already under way at the suite's frozen
 * clock -- with one table, two confirmed players, and one round already
 * recorded for it, so the event screen's rounds section (RoundLog's totals
 * line and round row, RoundTimer's duration pills) has something real to
 * picture. Nothing else in this file reaches that state:
 * `seedClubWithEvent`'s own occurrences sit in 2099 (FIRST_OCCURRENCE /
 * SECOND_OCCURRENCE above), and its four booking-state games all end well
 * before or start well after the frozen clock -- every one of them reads as
 * upcoming or past, never live, to `gameLive`
 * (app/clubs/[id]/events/[eventId]/index.tsx). RoundLog's own record form
 * and RoundTimer's start buttons both gate on that same window, so a
 * baseline built on any of those events would picture the rounds section
 * with its live-only affordances silently missing, not because of anything
 * this task changed.
 *
 * Takes an already-seeded club and its host's profile id rather than
 * seeding its own club -- called from the `with a seeded club` describe
 * block in e2e/visual.spec.ts, so the viewer is already that club's host
 * (`seedClubWithEvent`'s own `club_members` insert) and needs no roster
 * fetch of its own to appear as `isOrganizer` on this event too.
 *
 * The window (15 minutes before the frozen clock, four hours after) mirrors
 * `CHECK_IN_GAME` above for the same reason: fixed relative to
 * `page.clock.setFixedTime(new Date('2026-08-22T16:00:00Z'))`
 * (e2e/visual.spec.ts), not `new Date()`, so "live" here never ages into
 * "upcoming" or "past" on a future run.
 *
 * The winner is inserted into `club_members`, not just seated at the table
 * — `roster.find(...)` (the event screen's own winner-name lookup, since
 * RoundLog is handed a display name rather than an id — see its own
 * docstring) reads the CLUB roster fetched by `fetchRoster`, a different
 * query from the one that names seat occupants. A winner who is only ever a
 * `bookings` row would render as "Unknown" on the round line, same as a
 * departed member would.
 *
 * The round itself is written directly into `table_rounds`, the same
 * service-role, no-RPC pattern `seatBooking` above uses and for the same
 * reason: `record_round` derives `recorded_by` from `auth.uid()`, and
 * service_role carries no JWT for that to read.
 */
export async function seedTableWithRound(
  clubId: string,
  hostProfileId: string,
  suffix: string,
): Promise<{ eventId: string; tableId: string; winnerName: string; points: number }> {
  const admin = adminClient('seed table with a round');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(`seedTableWithRound: ${what} failed: ${JSON.stringify(result.error)}`);
    }
    return result.data as T;
  };

  const venue = need<{ id: string }>(
    'venue insert',
    await admin
      .from('venues')
      .insert({
        name: 'Elm Street Hall',
        address_line: '4 Elm Street',
        locality: 'Newton',
        added_by_club_id: clubId,
        created_by: hostProfileId,
      })
      .select('id')
      .single(),
  );

  // 15 minutes before FROZEN_NOW, ending nearly 4h after it -- inside the
  // event screen's own `gameLive` window (starts_at <= now < ends_at) at
  // FROZEN_NOW with margin either side, so a slow CI run settling a few
  // seconds late is nowhere near either boundary.
  const event = need<{ id: string }>(
    'live event insert',
    await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Live scoring night',
        venue_id: venue.id,
        notes: '',
        starts_at: '2026-08-22T15:45:00Z',
        ends_at: '2026-08-22T19:45:00Z',
        created_by: hostProfileId,
      })
      .select('id')
      .single(),
  );
  const eventId = event.id;

  const table = need<{ id: string }>(
    'table insert',
    await admin
      .from('event_tables')
      .insert({ event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 })
      .select('id')
      .single(),
  );
  const tableId = table.id;

  const winnerId = await seedFillerProfile(admin, 'Amara Whitfield', 'round-winner', suffix);
  const runnerUpId = await seedFillerProfile(admin, 'Deepak Rao', 'round-runner-up', suffix);

  const { error: rosterError } = await admin.from('club_members').insert([
    { club_id: clubId, profile_id: winnerId, role: 'member' },
    { club_id: clubId, profile_id: runnerUpId, role: 'member' },
  ]);
  if (rosterError) {
    throw new Error(`seedTableWithRound: roster insert failed: ${JSON.stringify(rosterError)}`);
  }

  await seatBooking(admin, need, { eventId, clubId, profileId: winnerId, tableId });
  await seatBooking(admin, need, { eventId, clubId, profileId: runnerUpId, tableId });

  // One of the plan's fixed set (25/30/35/40/45/50/75) --
  // `table_rounds_points_check` (supabase/migrations, Task 1) rejects
  // anything else. No other round is seeded on this table, so any of the
  // seven values is collision-free.
  const points = 30;
  const { error: roundError } = await admin.from('table_rounds').insert({
    event_table_id: tableId,
    event_id: eventId,
    club_id: clubId,
    winner_profile_id: winnerId,
    points,
    recorded_by: hostProfileId,
  });
  if (roundError) {
    throw new Error(`seedTableWithRound: round insert failed: ${JSON.stringify(roundError)}`);
  }

  return { eventId, tableId, winnerName: 'Amara Whitfield', points };
}

/**
 * Two friends and two club-mates for `app/messages/new.tsx`'s picker, in a
 * club of its own rather than added to `seedClubWithEvent`'s Riverside —
 * that club's roster is what the club-detail, roster and booking baselines
 * screenshot, and padding it out here would move every one of them for a
 * baseline that has nothing to do with rosters.
 *
 * Friends first, since `fetchFriends` and `fetchAddablePeople` are two
 * separate RPCs with two separate refusal rules to picture: a friendship
 * (the `friendships` table, written directly the way `add_friend` would)
 * and ordinary shared club membership are not the same relationship, and
 * the screen's own "Friend" vs club-name meta line only means something if
 * both are actually seeded.
 */
export async function seedMessageCandidates(
  profileId: string,
): Promise<{ friendId: string; friendName: string }> {
  const admin = adminClient('seed message candidates');

  const need = <T>(what: string, result: { data: unknown; error: unknown }): T => {
    if (result.error || result.data == null) {
      throw new Error(
        `seedMessageCandidates: ${what} failed: ${JSON.stringify(result.error)}`,
      );
    }
    return result.data as T;
  };

  const suffix = profileId.slice(0, 8);

  const club = need<{ id: string }>(
    'club insert',
    await admin
      .from('clubs')
      .insert({
        name: 'Maple Street Mahjong',
        slug: `maple-street-${suffix}`,
        rhythm: 'Wednesday evenings',
        timezone: 'America/New_York',
        created_by: profileId,
      })
      .select('id')
      .single(),
  );
  const clubId = club.id;

  const { error: memberError } = await admin
    .from('club_members')
    .insert({ club_id: clubId, profile_id: profileId, role: 'member' });
  if (memberError) {
    throw new Error(
      `seedMessageCandidates: membership insert failed: ${JSON.stringify(memberError)}`,
    );
  }

  const [friendA, friendB, clubmateA, clubmateB] = await Promise.all([
    seedFillerProfile(admin, 'Elena Vasquez', 'msgpick-friend-a', suffix),
    seedFillerProfile(admin, 'Tobias Reid', 'msgpick-friend-b', suffix),
    seedFillerProfile(admin, 'Priyanka Menon', 'msgpick-clubmate-a', suffix),
    seedFillerProfile(admin, 'Cormac Doyle', 'msgpick-clubmate-b', suffix),
  ]);

  const { error: rosterError } = await admin.from('club_members').insert([
    { club_id: clubId, profile_id: friendA, role: 'member' },
    { club_id: clubId, profile_id: friendB, role: 'member' },
    { club_id: clubId, profile_id: clubmateA, role: 'member' },
    { club_id: clubId, profile_id: clubmateB, role: 'member' },
  ]);
  if (rosterError) {
    throw new Error(
      `seedMessageCandidates: roster insert failed: ${JSON.stringify(rosterError)}`,
    );
  }

  // Directly into `friendships`, not through `add_friend` — the RPC runs as
  // the caller (`auth.uid()`), and the fixture has no session to call it
  // with. The table has a select policy and no write policy at all (see
  // supabase/migrations/20260828010000_friend_mutations.sql's own docstring
  // on that), so service_role is the only way in here anyway.
  const { error: friendshipError } = await admin.from('friendships').insert([
    { profile_id: profileId, friend_id: friendA },
    { profile_id: profileId, friend_id: friendB },
  ]);
  if (friendshipError) {
    throw new Error(
      `seedMessageCandidates: friendship insert failed: ${JSON.stringify(friendshipError)}`,
    );
  }

  return { friendId: friendA, friendName: 'Elena Vasquez' };
}

/**
 * The localStorage key supabase-js persists its session under, derived from
 * the project ref in the URL. Keep in step with the client's own convention:
 * see `defaultStorageKey` in `node_modules/@supabase/supabase-js/src/SupabaseClient.ts`
 * (``sb-${baseUrl.hostname.split('.')[0]}-auth-token``). If a future
 * supabase-js bump changes that derivation, this helper will silently
 * produce a mismatched key, and Task 4's screenshots will just come back
 * blank/unauthenticated — check that file first before suspecting Playwright
 * or the injection step.
 */
export function storageKeyFor(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}
