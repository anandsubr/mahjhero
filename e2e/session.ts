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
export async function seedClubWithEvent(
  profileId: string,
): Promise<{ clubId: string; eventId: string; seriesId: string }> {
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
  const { error: tableError } = await admin.from('event_tables').insert(
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
  );
  if (tableError) {
    throw new Error(
      `seedClubWithEvent: table insert failed: ${JSON.stringify(tableError)}`,
    );
  }

  return { clubId, eventId, seriesId };
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
