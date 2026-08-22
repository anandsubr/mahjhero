/**
 * The schema contract test.
 *
 * Every other suite stops at one side of the DB-client boundary: the Vitest
 * suites mock supabase-js entirely, and the pgTAP suite never sees the JSON
 * PostgREST produces. Critical 1 lived in the gap — `quiet_hours_start` is a
 * Postgres `time`, PostgREST serializes it as `"21:00:00"`, and the client
 * assumed `"21:00"`. Both suites were green while every first save failed.
 *
 * So this test crosses the boundary for real: it seeds a profile row, signs a
 * user in through supabase-js against the local stack, and asserts that what
 * comes back is the shape lib/profile.ts's types claim — same select lists,
 * same column names, same value types, and time values that satisfy
 * TIME_PATTERN once normalized.
 *
 * It is designed to fail loudly on drift. Verified by mutation: reverting the
 * `.slice(0, 5)` normalization in fetchPreferences, and separately changing a
 * column in PROFILE_COLUMNS, both turn this suite red. See the task report.
 *
 * Requires the local Supabase stack (`npx supabase start`). Without it the
 * suite skips with a warning, so `npm test` stays runnable with no Docker;
 * `npm run test:contract` makes an unreachable stack a hard failure instead.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Defaults are the Supabase CLI's fixed local development keys — they are the
// same on every machine and carry no access to anything real. Override via env
// if your stack reports different ones (`npx supabase status -o json`).
const local = vi.hoisted(() => ({
  url: process.env.SUPABASE_LOCAL_API_URL ?? 'http://127.0.0.1:54321',
  anonKey:
    process.env.SUPABASE_LOCAL_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  serviceRoleKey:
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
}));

// The whole point is to exercise the real lib/profile.ts functions, so the
// client they import is replaced with a real one aimed at the local stack
// rather than a mock. Everything below `supabase` is genuine: PostgREST,
// GoTrue, Postgres.
vi.mock('./supabase', () => ({
  supabase: createClient(local.url, local.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }),
}));

import {
  fetchPreferences,
  fetchProfile,
  normalizeTime,
  PREFERENCE_COLUMNS,
  PROFILE_COLUMNS,
  TIME_PATTERN,
} from './profile';
import { supabase } from './supabase';
import {
  addEventTable,
  cancelEvent,
  createEvent,
  createEventSeries,
  EVENT_COLUMNS,
  EVENT_TABLE_COLUMNS,
  endEventSeries,
  fetchEventTables,
  removeEventTable,
  resetEventToSeries,
  SERIES_COLUMNS,
  updateEvent,
  updateEventSeries,
  updateEventTable,
} from './events';
import {
  archiveVenue,
  createVenue,
  fetchClubVenues,
  searchVenues,
  updateVenue,
  VENUE_COLUMNS,
} from './venues';

const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'];
const NOTIFY_CHANNELS = ['push', 'email', 'both'];

// A well-formed UUID that matches no row. Used wherever a contract check
// needs a plausible id but must not depend on — or mutate — real data.
const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';

// Values chosen to differ from every column default, so a query that silently
// read the wrong row (or no row) cannot pass by coincidence.
const SEEDED = {
  display_name: 'Contract Tester',
  skill_level: 'intermediate',
  timezone: 'America/Chicago',
  notify_channel: 'email',
  mute_need_a_fourth: true,
  quiet_hours_enabled: true,
  quiet_hours_start: '22:30',
  quiet_hours_end: '07:15',
};

async function stackIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${local.url}/rest/v1/`, {
      headers: { apikey: local.anonKey },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await stackIsUp();
const required = process.env.REQUIRE_LOCAL_SUPABASE === '1';

if (!reachable && !required) {
  console.warn(
    `[schema-contract] Local Supabase stack not reachable at ${local.url} — ` +
      'skipping the schema contract suite. Run `npx supabase start` to cover ' +
      'the DB-client boundary, or `npm run test:contract` to make this fatal.',
  );
}

/**
 * Creates a fresh user and signs the shared `supabase` client in as them via
 * a magic link — the same passwordless flow the app uses — so a caller of
 * this helper runs its queries through the `authenticated` role and real RLS
 * policies, never a service-role bypass that would hide a missing grant.
 *
 * `select` on events/event_series/event_tables/venues is granted to
 * `authenticated` only, not `anon` (see e.g. 20260822192000's closing
 * `grant select on public.venues to authenticated`), so the column-contract
 * checks below need a signed-in caller even though they read zero rows.
 * Factored out because both the events/venues column contract and (in a
 * separate file section) any future authenticated probe need the identical
 * dance the profiles block above already performs inline.
 */
async function signInFreshUser(): Promise<{
  admin: SupabaseClient;
  userId: string;
}> {
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const email = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@mahjhero.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  expect(createError, `createUser failed: ${createError?.message}`).toBeNull();
  const userId = created!.user!.id;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  expect(linkError, `generateLink failed: ${linkError?.message}`).toBeNull();

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: link!.properties!.hashed_token,
    type: 'magiclink',
  });
  expect(verifyError, `verifyOtp failed: ${verifyError?.message}`).toBeNull();

  return { admin, userId };
}

describe.runIf(reachable || required)('profiles schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);

    admin = createClient(local.url, local.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const email = `contract-${Date.now()}@mahjhero.test`;
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(createError, `createUser failed: ${createError?.message}`).toBeNull();
    userId = created!.user!.id;

    // Sign in the way the app does — passwordless — so every read below goes
    // through the `authenticated` role and the profiles_select_own RLS policy,
    // not a service-role bypass that would hide a broken grant.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    expect(linkError, `generateLink failed: ${linkError?.message}`).toBeNull();

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: link!.properties!.hashed_token,
      type: 'magiclink',
    });
    expect(verifyError, `verifyOtp failed: ${verifyError?.message}`).toBeNull();

    // The on_auth_user_created trigger has already inserted the profile row;
    // this only replaces the defaults with the distinctive values above.
    // Seeded as the member rather than as service_role, which the migration
    // deliberately grants nothing on public.profiles.
    // `.select('id')` for the same reason the app's writes carry it: PostgREST
    // answers 204 with error: null when an update matches nothing, so without
    // it a zero-row seed would sail through here and surface later as a
    // baffling value mismatch in an unrelated assertion.
    const { data: seeded, error: seedError } = await supabase
      .from('profiles')
      .update(SEEDED)
      .eq('id', userId)
      .select('id');
    expect(seedError, `seeding the profile failed: ${seedError?.message}`).toBeNull();
    expect(seeded, 'seeding the profile matched no rows').toHaveLength(1);
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('answers the Profile select list with exactly the columns the type names', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single();

    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    // Exact key set, not a subset: an added column is drift too, and a
    // removed one must not be papered over by an optional-property check.
    expect(Object.keys(row).sort()).toEqual(
      ['avatar_url', 'display_name', 'id', 'skill_level', 'timezone'].sort(),
    );

    expect(typeof row.id).toBe('string');
    expect(row.id).toBe(userId);
    // `display_name` and `timezone` are NOT NULL in the schema; the Profile
    // type declares them non-nullable and the screens render them directly.
    expect(typeof row.display_name).toBe('string');
    expect(row.display_name).toBe(SEEDED.display_name);
    expect(typeof row.timezone).toBe('string');
    expect(row.timezone).toBe(SEEDED.timezone);
    // Nullable in both the schema and the type.
    expect(row.avatar_url).toBeNull();
    expect(SKILL_LEVELS).toContain(row.skill_level);
    expect(row.skill_level).toBe(SEEDED.skill_level);
  });

  it('answers the NotificationPreferences select list with exactly the columns the type names', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PREFERENCE_COLUMNS)
      .eq('id', userId)
      .single();

    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual(
      [
        'mute_need_a_fourth',
        'notify_channel',
        'quiet_hours_enabled',
        'quiet_hours_end',
        'quiet_hours_start',
      ].sort(),
    );

    expect(NOTIFY_CHANNELS).toContain(row.notify_channel);
    expect(row.notify_channel).toBe(SEEDED.notify_channel);
    expect(typeof row.mute_need_a_fourth).toBe('boolean');
    expect(row.mute_need_a_fourth).toBe(SEEDED.mute_need_a_fourth);
    expect(typeof row.quiet_hours_enabled).toBe('boolean');
    expect(row.quiet_hours_enabled).toBe(SEEDED.quiet_hours_enabled);
    expect(typeof row.quiet_hours_start).toBe('string');
    expect(typeof row.quiet_hours_end).toBe('string');
  });

  it('serializes the quiet-hours `time` columns with seconds, which TIME_PATTERN alone rejects', async () => {
    // This is Critical 1 stated as a contract rather than a bug report. If a
    // future migration changes these columns' type — or PostgREST changes how
    // it renders `time` — this fails and the normalization below has to be
    // revisited rather than quietly becoming wrong.
    const { data, error } = await supabase
      .from('profiles')
      .select('quiet_hours_start, quiet_hours_end')
      .eq('id', userId)
      .single();

    expect(error).toBeNull();
    expect(data!.quiet_hours_start).toBe('22:30:00');
    expect(data!.quiet_hours_end).toBe('07:15:00');
    expect(TIME_PATTERN.test(data!.quiet_hours_start)).toBe(false);
    expect(TIME_PATTERN.test(normalizeTime(data!.quiet_hours_start))).toBe(true);
  });

  it('fetchPreferences hands the client times it will accept back unchanged', async () => {
    // The round trip that used to fail on every member's first visit: what
    // fetchPreferences returns is exactly what the screen submits to
    // updatePreferences, so it must already satisfy TIME_PATTERN.
    const prefs = await fetchPreferences(userId);

    expect(prefs).not.toBeNull();
    expect(prefs!.quiet_hours_start).toBe(SEEDED.quiet_hours_start);
    expect(prefs!.quiet_hours_end).toBe(SEEDED.quiet_hours_end);
    expect(TIME_PATTERN.test(prefs!.quiet_hours_start)).toBe(true);
    expect(TIME_PATTERN.test(prefs!.quiet_hours_end)).toBe(true);
    expect(prefs!.notify_channel).toBe(SEEDED.notify_channel);
    expect(prefs!.mute_need_a_fourth).toBe(SEEDED.mute_need_a_fourth);
    expect(prefs!.quiet_hours_enabled).toBe(SEEDED.quiet_hours_enabled);
  });

  it('fetchProfile returns the row the Profile type describes', async () => {
    const profile = await fetchProfile(userId);

    expect(profile).toEqual({
      id: userId,
      display_name: SEEDED.display_name,
      skill_level: SEEDED.skill_level,
      avatar_url: null,
      timezone: SEEDED.timezone,
    });
  });

  it('fetchProfile reports a miss rather than inventing a row for a stranger', async () => {
    // RLS confines the signed-in member to their own row. Reading someone
    // else's must come back as a failed load — which app/profile.tsx now
    // renders as an error instead of a blank, editable form.
    const other = '00000000-0000-0000-0000-000000000000';
    expect(await fetchProfile(other)).toBeNull();
  });
});

describe.runIf(reachable || required)('events schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;
  let clubId: string;
  let venueId: string;
  let eventId: string;
  let seriesId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    // A signed-in caller, not anon: `select` on these tables is granted only
    // to `authenticated` (see signInFreshUser's doc comment above), and this
    // block runs after the profiles block's own afterAll has already signed
    // that session out — so this needs its own, not a borrowed one.
    ({ admin, userId } = await signInFreshUser());

    // Real, non-empty rows via the service-role client (which has full DML
    // by default privilege — see 20260822180200 — and BYPASSRLS), so the
    // checks below fetch a genuine row rather than an empty `.limit(0)`
    // result. That distinction matters: a `.select` that merely OMITS a
    // column from its list never errors, so `.limit(0)` alone cannot catch
    // a column silently dropped from EVENT_COLUMNS / SERIES_COLUMNS — only
    // comparing the fetched row's actual key set against what the type
    // promises can. See the task report for the ended_at / overrides
    // mutation proof this closes.
    const { data: club, error: clubError } = await admin
      .from('clubs')
      .insert({
        name: 'Contract Club',
        slug: `contract-club-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(clubError, `seeding club failed: ${clubError?.message}`).toBeNull();
    clubId = club!.id;

    const { error: memberError } = await admin.from('club_members').insert({
      club_id: clubId,
      profile_id: userId,
      role: 'host',
      status: 'active',
    });
    expect(memberError, `seeding club_members failed: ${memberError?.message}`).toBeNull();

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .insert({
        name: 'Contract Hall',
        address_line: '1 Main St',
        locality: 'Springfield',
        region: 'IL',
        postal_code: '62701',
        visibility: 'club',
        added_by_club_id: clubId,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(venueError, `seeding venue failed: ${venueError?.message}`).toBeNull();
    venueId = venue!.id;

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Tuesday Mahjong',
        venue_id: venueId,
        notes: 'bring snacks',
        starts_at: '2027-09-07T23:00:00Z',
        ends_at: '2027-09-08T02:00:00Z',
        status: 'published',
        overrides: ['title'],
        created_by: userId,
      })
      .select('id')
      .single();
    expect(eventError, `seeding event failed: ${eventError?.message}`).toBeNull();
    eventId = event!.id;

    const { error: tableError } = await admin.from('event_tables').insert({
      event_id: eventId,
      club_id: clubId,
      label: 'Table 1',
      skill_tier: 'mixed',
      capacity: 4,
      position: 1,
    });
    expect(tableError, `seeding event_tables failed: ${tableError?.message}`).toBeNull();

    const { data: series, error: seriesError } = await admin
      .from('event_series')
      .insert({
        club_id: clubId,
        title: 'Weekly Mahjong',
        venue_id: venueId,
        notes: '',
        frequency: 'weekly',
        weekday: 2,
        start_time: '19:00:00',
        duration_minutes: 180,
        table_count: 1,
        starts_on: '2027-01-01',
        ends_on: '2027-12-31',
        // Distinct from ends_on and non-null, so a query that dropped this
        // column from its select list cannot pass by coincidence.
        ended_at: '2027-06-01T00:00:00Z',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(seriesError, `seeding event_series failed: ${seriesError?.message}`).toBeNull();
    seriesId = series!.id;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    // Explicit, dependency-ordered cleanup rather than relying on cascade —
    // this suite runs against the persistent local stack, not a throwaway
    // database, so leftover rows would accumulate across runs.
    if (admin) {
      if (eventId) await admin.from('event_tables').delete().eq('event_id', eventId);
      if (eventId) await admin.from('events').delete().eq('id', eventId);
      if (seriesId) await admin.from('event_series').delete().eq('id', seriesId);
      if (venueId) await admin.from('venues').delete().eq('id', venueId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  // These four import EVENT_COLUMNS / SERIES_COLUMNS / EVENT_TABLE_COLUMNS /
  // VENUE_COLUMNS from the libraries themselves rather than retyping the
  // select lists — see PROFILE_COLUMNS above for why a retyped copy is not a
  // contract at all. Each fetches the real seeded row and asserts the EXACT
  // key set, the same pattern the profiles block above uses — not merely
  // "the query didn't error", which a dropped (not renamed) column would
  // sail through.
  it('exposes exactly the columns lib/events.ts names on events, including the venue/table embeds', async () => {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('id', eventId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'club_id', 'series_id', 'title', 'venue_id', 'notes',
        'starts_at', 'ends_at', 'status', 'occurrence_date', 'overrides',
        'venues', 'event_tables',
      ].sort(),
    );
    expect(row.title).toBe('Tuesday Mahjong');
    expect(row.overrides).toEqual(['title']);
    expect((row.venues as { name: string }).name).toBe('Contract Hall');
    expect((row.event_tables as unknown[]).length).toBe(1);
  });

  it('exposes exactly the columns lib/events.ts names on event_series, including ended_at', async () => {
    // ended_at is the fact the brief's snapshot of the schema predates: the
    // host STOPPED the series, distinct from ends_on (the host's PLAN to
    // stop repeating after a date). Task 15's edit screen needs both, so
    // both belong in the contract — and, because dropping a column from a
    // select list never errors, only a real row's key set can prove it is
    // still there.
    const { data, error } = await supabase
      .from('event_series')
      .select(SERIES_COLUMNS)
      .eq('id', seriesId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'club_id', 'title', 'venue_id', 'notes', 'frequency',
        'weekday', 'nth_week', 'start_time', 'duration_minutes',
        'table_count', 'starts_on', 'ends_on', 'ended_at',
      ].sort(),
    );
    expect(row.ends_on).toBe('2027-12-31');
    expect(row.ended_at).toBe('2027-06-01T00:00:00+00:00');
  });

  it('exposes exactly the columns lib/events.ts names on event_tables', async () => {
    const { data, error } = await supabase
      .from('event_tables')
      .select(EVENT_TABLE_COLUMNS)
      .eq('event_id', eventId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual(
      ['id', 'label', 'skill_tier', 'capacity', 'position'].sort(),
    );
    expect(row.label).toBe('Table 1');
  });

  it('exposes exactly the columns lib/venues.ts names on venues', async () => {
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_COLUMNS)
      .eq('id', venueId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'name', 'address_line', 'locality', 'region', 'postal_code',
        'visibility',
      ].sort(),
    );
    expect(row.name).toBe('Contract Hall');
  });

  /*
   * MINOR 5: added_by_club_id and archived_at (venues) and event_id
   * (event_tables) appear only in .eq()/.is() filters in lib/venues.ts and
   * lib/events.ts — never in a checked select list, so nothing above would
   * notice a rename. Rather than naming them in a second hand-typed string
   * (which would have exactly the snapshot problem Important 1 fixes),
   * these two call the real library functions against the real seeded club
   * and event, and check they find exactly the seeded row. If either
   * column were renamed in the library, the real PostgREST query would
   * fail with 42703 (undefined column) and the function — which catches
   * internally, per the lib/ never-rejects convention — would return null
   * instead of the row; if the filter silently matched nothing the row
   * would still fail to appear.
   */
  it('fetchClubVenues resolves against the filter columns it actually sends (added_by_club_id, archived_at)', async () => {
    const result = await fetchClubVenues(clubId);
    expect(result).not.toBeNull();
    expect(result!.map((v) => v.id)).toContain(venueId);
  });

  it('fetchEventTables resolves against the filter column it actually sends (event_id)', async () => {
    const result = await fetchEventTables(eventId);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]!.label).toBe('Table 1');
  });
});

/*
 * ---------------------------------------------------------------------------
 * RPC argument-name contract.
 * ---------------------------------------------------------------------------
 *
 * PostgREST resolves `supabase.rpc(name, args)` by matching `args`' KEYS
 * against a function's parameter names, not by position and not by type. Get
 * one name wrong — `target_club` where the function expects `club_id` — and
 * PostgREST cannot find a matching overload at all. That failure has a
 * specific, checkable shape: `PGRST202`, "Could not find the function ... in
 * the schema cache". It happened for real once already: 20260822193000
 * documents update_venue's parameters being renamed out from under every
 * call site, silently, until this exact class of test would have caught it.
 *
 * A mocked Vitest suite cannot see this at all — the mock answers to
 * whatever shape the test hands it, so a call built with the wrong argument
 * names looks identical to one built with the right ones. Only a real
 * PostgREST server can refuse to resolve a call, so this suite deliberately
 * makes every one of these calls for real, against the local stack.
 *
 * This block does NOT hand-type a copy of each argument object (an earlier
 * version did, and a reviewer proved that copy could drift silently from the
 * library — see the task report for the three-way mutation proof). Instead
 * it calls the REAL exported lib/venues.ts / lib/events.ts functions and
 * spies on `supabase.rpc` with `vi.spyOn`, which by default calls through to
 * the genuine implementation. That gives two things no hand-typed copy can:
 * the function name and argument object are read back from the actual call
 * the library made (so a rename inside the library changes what the test
 * sees, with nothing to keep in sync by hand), and the spy's own return
 * value is the real PostgREST response for that exact call, which is used
 * below for the 42501 assertion (MINOR 4) without needing a second request.
 *
 * Deliberately anonymous — no sign-in here. Every function below has EXECUTE
 * revoked from anon and granted only to authenticated (see e.g. 20260822192000's
 * closing grants), so every one of these calls is expected to fail. That is
 * fine and is the point: the only thing under test is the SHAPE of that
 * failure, not whether it succeeds. PostgREST resolves the function (and
 * therefore checks the argument names) before it evaluates whether the
 * caller may execute it, so an anonymous 42501 ("permission denied") already
 * proves the names matched. Verified against the live stack by curl: all 14
 * functions return exactly 42501 for an anonymous caller — never PGRST202
 * (unresolved name), never PGRST203 (ambiguous overload) — so asserting the
 * exact code (rather than merely `.not.toBe('PGRST202')`) additionally
 * catches a grant regression or an overload collision that a one-code
 * denylist would miss while staying green.
 *
 * Verified by mutation: renaming target_club to target_klub inside
 * searchVenues in lib/venues.ts turns that one case red with a PGRST202
 * failure naming search_venues, and every other case stays green — because
 * the test is reading the argument names back from the mutated library
 * itself, not from a copy. See the task report for the full mutation log.
 */
describe.runIf(reachable || required)(
  'venues and events RPC argument-name contract',
  () => {
    beforeAll(async () => {
      expect(
        reachable,
        `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
      ).toBe(true);
      // Independent of whatever the profiles describe block above left
      // behind — this block's whole premise is an anonymous caller, so it
      // asserts that starting condition rather than assuming it.
      await supabase.auth.signOut();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Each case is the Postgres function name expected to be called and a
    // thunk that invokes the REAL lib/venues.ts or lib/events.ts function —
    // never a hand-typed argument object. Inputs are shaped to satisfy each
    // parameter's TypeScript type (uuid, text, ISO timestamp, time, date,
    // boolean, int) so the call resolves and fails on authorization, never
    // on a malformed literal.
    const rpcCases: Array<{ fnName: string; invoke: () => Promise<unknown> }> = [
      // lib/venues.ts
      { fnName: 'search_venues', invoke: () => searchVenues(DUMMY_UUID, 'hall') },
      {
        fnName: 'create_venue',
        invoke: () =>
          createVenue({
            clubId: DUMMY_UUID,
            name: 'Contract Test Hall',
            addressLine: '1 Main St',
            locality: 'Springfield',
            region: 'IL',
            postalCode: '62701',
            sharePublicly: false,
          }),
      },
      {
        fnName: 'update_venue',
        invoke: () =>
          updateVenue(DUMMY_UUID, {
            name: 'Renamed Hall',
            addressLine: '2 Main St',
            locality: 'Springfield',
            region: 'IL',
            postalCode: '62701',
          }),
      },
      { fnName: 'archive_venue', invoke: () => archiveVenue(DUMMY_UUID) },
      // lib/events.ts
      {
        fnName: 'create_event',
        invoke: () =>
          createEvent({
            clubId: DUMMY_UUID,
            title: 'Tuesday Mahjong',
            venueId: DUMMY_UUID,
            notes: 'bring snacks',
            startsAt: '2027-09-07T23:00:00Z',
            endsAt: '2027-09-08T02:00:00Z',
            tableCount: 2,
          }),
      },
      {
        fnName: 'update_event',
        invoke: () =>
          updateEvent(DUMMY_UUID, {
            title: 'Renamed game',
            venueId: DUMMY_UUID,
            notes: 'updated notes',
            startsAt: '2027-09-07T23:00:00Z',
            endsAt: '2027-09-08T02:00:00Z',
          }),
      },
      { fnName: 'cancel_event', invoke: () => cancelEvent(DUMMY_UUID) },
      { fnName: 'reset_event_to_series', invoke: () => resetEventToSeries(DUMMY_UUID) },
      { fnName: 'add_event_table', invoke: () => addEventTable(DUMMY_UUID) },
      {
        fnName: 'update_event_table',
        invoke: () => updateEventTable(DUMMY_UUID, { label: 'Table 2', tier: 'mixed' }),
      },
      { fnName: 'remove_event_table', invoke: () => removeEventTable(DUMMY_UUID) },
      {
        fnName: 'create_event_series',
        invoke: () =>
          createEventSeries({
            clubId: DUMMY_UUID,
            title: 'Weekly game',
            venueId: DUMMY_UUID,
            notes: '',
            frequency: 'weekly',
            weekday: 2,
            nthWeek: null,
            startTime: '19:00:00',
            durationMinutes: 180,
            tableCount: 1,
            startsOn: '2027-01-01',
            endsOn: null,
          }),
      },
      {
        fnName: 'update_event_series',
        invoke: () =>
          updateEventSeries(DUMMY_UUID, {
            title: 'Weekly game v2',
            venueId: DUMMY_UUID,
            notes: 'updated',
            startTime: '19:30:00',
            durationMinutes: 150,
            tableCount: 2,
            endsOn: '2027-12-31',
            includeOverridden: false,
          }),
      },
      {
        fnName: 'end_event_series',
        invoke: () => endEventSeries(DUMMY_UUID, true),
      },
    ];

    it.each(rpcCases)(
      '$fnName: the library resolves it by the argument names it actually sends',
      async ({ fnName, invoke }) => {
        // Calls through to the real supabase-js implementation by default —
        // this only observes the call, it does not replace it.
        const rpcSpy = vi.spyOn(supabase, 'rpc');

        await invoke();

        expect(
          rpcSpy,
          `${fnName}: expected the library function to call supabase.rpc exactly once`,
        ).toHaveBeenCalledTimes(1);
        const [calledName] = rpcSpy.mock.calls[0]!;
        expect(
          calledName,
          `expected lib/ to call RPC function "${fnName}", but it called "${calledName}"`,
        ).toBe(fnName);

        // The spy's own return value IS the real PostgREST response for
        // this exact call — reusing it (rather than issuing a second
        // request) is what ties the assertion below to the argument names
        // the library actually sent, not a reconstruction of them.
        const { error } = (await rpcSpy.mock.results[0]!.value) as {
          error: { code?: string; message?: string } | null;
        };

        expect(
          error,
          `${fnName} unexpectedly succeeded for an anonymous, unauthorized caller — ` +
            'expected a permission error instead.',
        ).not.toBeNull();

        expect(
          error?.code,
          `${fnName} returned ${error?.code} instead of 42501 ("permission denied") ` +
            `— Postgres message: ${error?.message}. A PGRST202 here means the ` +
            `argument names lib/ sends do not match ${fnName}'s deployed ` +
            'parameters; a PGRST203 means an ambiguous overload; anything ' +
            'else means the grant this test relies on has regressed.',
        ).toBe('42501');
      },
    );
  },
);
