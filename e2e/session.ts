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
 * Tuesdays in 2099 — far enough out that `fetchUpcomingEvents`' `starts_at >=
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
  /** One broadcast already sent to Riverside, for the `broadcast history`
   * baseline. */
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

  // One broadcast already sent, so `broadcast history` has a real row to
  // screenshot rather than the empty state. event_id null — the
  // whole-roster case — since nothing about that baseline needs the
  // event-scoped variant.
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
