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

import { GENERIC_ERROR } from './constants';
import { checkInOpen } from './attendance';
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
  fetchSeries,
  removeEventTable,
  resetEventToSeries,
  SERIES_COLUMNS,
  updateEvent,
  updateEventSeries,
  updateEventTable,
} from './events';
import { BROADCAST_COLUMNS } from './broadcasts';
import type { Broadcast } from './broadcasts';
import {
  archiveVenue,
  createVenue,
  fetchClubVenues,
  searchVenues,
  updateVenue,
  VENUE_COLUMNS,
} from './venues';
import { GREETING_COLUMNS } from './greetings';
import {
  createGroupThread,
  fetchThread,
  fetchThreadMessages,
  MESSAGE_COLUMNS,
  openThreadForEvent,
  postMessage,
  THREAD_COLUMNS,
} from './messages';
import type { ThreadDetail, ThreadMessage } from './messages';
import { fetchTableRounds } from './rounds';
import type { TableRound } from './rounds';

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
      ['avatar_url', 'display_name', 'id', 'is_admin', 'skill_level', 'timezone'].sort(),
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
      is_admin: false,
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
        'check_in_required', 'fee_cents', 'min_spend_cents', 'venues',
        'event_tables', 'bookings',
      ].sort(),
    );
    expect(row.title).toBe('Tuesday Mahjong');
    expect(row.overrides).toEqual(['title']);
    // Not set on insert above, so this pins the column's own default —
    // Task 12 added check_in_required to EVENT_COLUMNS.
    expect(row.check_in_required).toBe(false);
    expect((row.venues as { name: string }).name).toBe('Contract Hall');
    expect((row.event_tables as unknown[]).length).toBe(1);
    // Task 14: `eventStatusLine` (lib/events.ts) needs capacity and label off
    // each table, and the live bookings, to compute where a member stands on
    // this game — added to EVENT_COLUMNS alongside the id-only embed this
    // suite already pinned.
    const [table] = row.event_tables as {
      id: string;
      capacity: number;
      label: string;
    }[];
    expect(table.capacity).toBe(4);
    expect(table.label).toBe('Table 1');
    // No bookings seeded for this event — an empty array, not a missing key.
    expect(row.bookings).toEqual([]);
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
        'check_in_required', 'fee_cents', 'min_spend_cents', 'venues',
      ].sort(),
    );
    expect(row.ends_on).toBe('2027-12-31');
    expect(row.ended_at).toBe('2027-06-01T00:00:00+00:00');
    // Not set on insert — pins the column's own default (Task 14 added
    // check_in_required to SERIES_COLUMNS; EVENT_COLUMNS already had it from
    // Task 12, asserted above).
    expect(row.check_in_required).toBe(false);
    // `venues(name)`, added alongside Fix pass 1 on Task 15's review so the
    // edit screen's "The whole series" heading can show the series' own
    // venue rather than the occurrence's — the seed row reuses the same
    // venue ("Contract Hall") both events and event_series point at above.
    expect((row.venues as { name: string }).name).toBe('Contract Hall');

    // The raw-row assertion above pins the PostgREST embed shape but never
    // runs it through `toEventSeries` — the mapper that turns `venues.name`
    // into the flat `venue_name` the edit screen actually reads (Task 15
    // fix pass 2). Every Vitest suite mocks `fetchSeries` wholesale, so a
    // broken mapper (or PostgREST returning `venues` as an array instead of
    // an object) would ship as a silently blank venue name. Calling the
    // real `fetchSeries` here closes that gap.
    const series = await fetchSeries(seriesId);
    expect(series).not.toBeNull();
    expect(series!.venue_name).toBe('Contract Hall');
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
            date: '2027-09-07',
            startTime: '19:00',
            durationMinutes: 180,
            tableCount: 2,
            checkInRequired: false,
            feeCents: 0,
            minSpendCents: 0,
          }),
      },
      {
        fnName: 'update_event',
        invoke: () =>
          updateEvent(DUMMY_UUID, {
            title: 'Renamed game',
            venueId: DUMMY_UUID,
            notes: 'updated notes',
            date: '2027-09-07',
            startTime: '19:00',
            durationMinutes: 180,
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
            checkInRequired: false,
            feeCents: 0,
            minSpendCents: 0,
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
      // Same RPC, but exercising `clear_ends_on` -- the argument name added
      // by supabase/migrations/20260823080000 for the edit screen's "Runs
      // indefinitely" control. A PGRST202 here would mean the client and the
      // deployed function have drifted on this specific parameter, which the
      // case above (which never sends it) cannot catch.
      {
        fnName: 'update_event_series',
        invoke: () =>
          updateEventSeries(DUMMY_UUID, {
            clearEndsOn: true,
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

/*
 * ---------------------------------------------------------------------------
 * Club-local calendar values resolve to instants — in the database.
 * ---------------------------------------------------------------------------
 *
 * The create screen no longer computes an instant. It sends the calendar date
 * and the wall-clock time the host picked, and `create_event` resolves them
 * against `clubs.timezone` with the same `(date + time) at time zone club_tz`
 * expression `materialize_one_series` uses for every week of a series
 * (supabase/migrations/20260823070000).
 *
 * That leaves a gap no mocked suite can close. app/__tests__/events-new can
 * only prove the right STRINGS were passed; it cannot prove those strings
 * produce the right instant, because the conversion now happens somewhere it
 * cannot see. A semantically different implementation would sail through it —
 * which is exactly how the previous, wrong client-side conversion survived
 * 205 green tests. So this block calls the real lib/events.ts functions
 * against the real database and reads the stored instants back.
 *
 * Two anti-coincidence properties, both deliberate:
 *
 *   - Every club zone below DIFFERS from the device's. `npm test` and
 *     `npm run test:contract` are pinned to TZ=America/New_York, and the
 *     America/New_York cases are the only ones that share it; Asia/Tokyo
 *     (never any DST) and Australia/Sydney (DST in the opposite half of the
 *     year) cannot pass by borrowing the device's offset.
 *   - The dates are the transition-adjacent ones, in pairs that straddle a
 *     transition: 2027-03-13/14 and 2027-11-06/07 in America/New_York, and
 *     2027-06-15/2027-11-07 in Australia/Sydney. An implementation that
 *     ignores DST entirely gets one of each pair right and the other wrong by
 *     an hour. Both DST dates are the ones the pgTAP recurrence fixtures
 *     already pin, so the two suites agree about which days matter.
 *
 * Expected instants are computed by hand from the zone's UTC offset on that
 * date, never by running the code under test.
 */
describe.runIf(reachable || required)(
  'club-local calendar values resolve to instants',
  () => {
    let admin: SupabaseClient;
    let userId: string;
    // club timezone -> { clubId, venueId }
    const clubs = new Map<string, { clubId: string; venueId: string }>();
    const createdEventIds: string[] = [];

    const ZONES = ['America/New_York', 'Asia/Tokyo', 'Australia/Sydney'];

    beforeAll(async () => {
      expect(
        reachable,
        `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
      ).toBe(true);

      ({ admin, userId } = await signInFreshUser());

      for (const timezone of ZONES) {
        const { data: club, error: clubError } = await admin
          .from('clubs')
          .insert({
            name: `Instant Club ${timezone}`,
            slug: `instant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timezone,
            created_by: userId,
          })
          .select('id')
          .single();
        expect(
          clubError,
          `seeding club for ${timezone} failed: ${clubError?.message}`,
        ).toBeNull();

        const { error: memberError } = await admin.from('club_members').insert({
          club_id: club!.id,
          profile_id: userId,
          role: 'host',
          status: 'active',
        });
        expect(memberError, `seeding host failed: ${memberError?.message}`).toBeNull();

        const { data: venue, error: venueError } = await admin
          .from('venues')
          .insert({
            name: 'Instant Hall',
            visibility: 'club',
            added_by_club_id: club!.id,
            created_by: userId,
          })
          .select('id')
          .single();
        expect(venueError, `seeding venue failed: ${venueError?.message}`).toBeNull();

        clubs.set(timezone, { clubId: club!.id, venueId: venue!.id });
      }
    });

    afterAll(async () => {
      await supabase.auth.signOut();
      if (admin) {
        for (const eventId of createdEventIds) {
          await admin.from('event_tables').delete().eq('event_id', eventId);
          await admin.from('events').delete().eq('id', eventId);
        }
        for (const { clubId, venueId } of clubs.values()) {
          await admin.from('events').delete().eq('club_id', clubId);
          await admin.from('venues').delete().eq('id', venueId);
          await admin.from('club_members').delete().eq('club_id', clubId);
          await admin.from('clubs').delete().eq('id', clubId);
        }
      }
      if (admin && userId) await admin.auth.admin.deleteUser(userId);
    });

    async function createAndRead(input: {
      timezone: string;
      date: string;
      startTime: string;
      durationMinutes: number;
    }): Promise<{ startsAt: string; endsAt: string }> {
      const seeded = clubs.get(input.timezone)!;
      const { eventId, error } = await createEvent({
        clubId: seeded.clubId,
        title: `${input.timezone} ${input.date} ${input.startTime}`,
        venueId: seeded.venueId,
        notes: '',
        date: input.date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        tableCount: 1,
        checkInRequired: false,
        feeCents: 0,
        minSpendCents: 0,
      });
      expect(error, `createEvent reported: ${error}`).toBeNull();
      expect(eventId).not.toBeNull();
      createdEventIds.push(eventId!);

      const { data, error: readError } = await supabase
        .from('events')
        .select('starts_at, ends_at')
        .eq('id', eventId!)
        .single();
      expect(readError, `reading the event back failed: ${readError?.message}`).toBeNull();
      return {
        startsAt: new Date((data as { starts_at: string }).starts_at).toISOString(),
        endsAt: new Date((data as { ends_at: string }).ends_at).toISOString(),
      };
    }

    const cases: Array<{
      name: string;
      timezone: string;
      date: string;
      startTime: string;
      durationMinutes: number;
      startsAt: string;
      endsAt: string;
    }> = [
      {
        name: 'America/New_York, the day before spring forward (EST, UTC-5)',
        timezone: 'America/New_York',
        date: '2027-03-13',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-03-14T00:00:00.000Z',
        endsAt: '2027-03-14T03:00:00.000Z',
      },
      {
        name: 'America/New_York, spring-forward day itself (EDT, UTC-4)',
        timezone: 'America/New_York',
        date: '2027-03-14',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-03-14T23:00:00.000Z',
        endsAt: '2027-03-15T02:00:00.000Z',
      },
      {
        name: 'America/New_York, the day before fall back (EDT, UTC-4)',
        timezone: 'America/New_York',
        date: '2027-11-06',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-11-06T23:00:00.000Z',
        endsAt: '2027-11-07T02:00:00.000Z',
      },
      {
        name: 'America/New_York, fall-back day itself (EST, UTC-5)',
        timezone: 'America/New_York',
        date: '2027-11-07',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-11-08T00:00:00.000Z',
        endsAt: '2027-11-08T03:00:00.000Z',
      },
      {
        // The device is at America/New_York, four hours behind UTC on this
        // date and nine behind Tokyo. A conversion that leaked the device's
        // own offset landed this one 13 hours out.
        name: 'Asia/Tokyo in September, device four hours from UTC (JST, UTC+9)',
        timezone: 'Asia/Tokyo',
        date: '2027-09-07',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-09-07T10:00:00.000Z',
        endsAt: '2027-09-07T13:00:00.000Z',
      },
      {
        // Tokyo has never observed DST. On the device's own transition day
        // the club's offset must not move at all.
        name: 'Asia/Tokyo on the US spring-forward day (JST, UTC+9, unmoved)',
        timezone: 'Asia/Tokyo',
        date: '2027-03-14',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-03-14T10:00:00.000Z',
        endsAt: '2027-03-14T13:00:00.000Z',
      },
      {
        // Southern-hemisphere DST, running in the opposite half of the year
        // from the device's: Sydney is on standard time in June.
        name: 'Australia/Sydney in June (AEST, UTC+10)',
        timezone: 'Australia/Sydney',
        date: '2027-06-15',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-06-15T09:00:00.000Z',
        endsAt: '2027-06-15T12:00:00.000Z',
      },
      {
        // ...and on daylight time in November, the very day America/New_York
        // goes the other way.
        name: 'Australia/Sydney on the US fall-back day (AEDT, UTC+11)',
        timezone: 'Australia/Sydney',
        date: '2027-11-07',
        startTime: '19:00',
        durationMinutes: 180,
        startsAt: '2027-11-07T08:00:00.000Z',
        endsAt: '2027-11-07T11:00:00.000Z',
      },
      {
        // A game that starts before a spring-forward transition and runs
        // through it. Three hours of duration is three hours of elapsed time,
        // so it ends at a wall clock four hours later.
        name: 'America/New_York, a game running through the spring-forward hour',
        timezone: 'America/New_York',
        date: '2027-03-14',
        startTime: '01:00',
        durationMinutes: 180,
        startsAt: '2027-03-14T06:00:00.000Z',
        endsAt: '2027-03-14T09:00:00.000Z',
      },
    ];

    it.each(cases)(
      'create_event: $name',
      async ({ timezone, date, startTime, durationMinutes, startsAt, endsAt }) => {
        const stored = await createAndRead({
          timezone,
          date,
          startTime,
          durationMinutes,
        });
        expect(stored.startsAt).toBe(startsAt);
        expect(stored.endsAt).toBe(endsAt);
      },
    );

    /*
     * update_event takes the same calendar values, for the same reason: the
     * edit screen (Task 15) must not need a conversion of its own. Moving an
     * occurrence to another date is the one thing it has to keep doing, and
     * the date it moves to may sit on the other side of a transition.
     */
    it('update_event moves an occurrence across a DST transition and keeps its wall clock', async () => {
      const seeded = clubs.get('America/New_York')!;
      const { eventId, error } = await createEvent({
        clubId: seeded.clubId,
        title: 'Movable feast',
        venueId: seeded.venueId,
        notes: '',
        date: '2027-03-13',
        startTime: '19:00',
        durationMinutes: 180,
        tableCount: 1,
        checkInRequired: false,
        feeCents: 0,
        minSpendCents: 0,
      });
      expect(error).toBeNull();
      createdEventIds.push(eventId!);

      const { error: updateError } = await updateEvent(eventId!, {
        date: '2027-03-14',
      });
      expect(updateError).toBeNull();

      const { data } = await supabase
        .from('events')
        .select('starts_at, ends_at')
        .eq('id', eventId!)
        .single();
      const row = data as { starts_at: string; ends_at: string };
      // Still 7pm on the club's wall clock, now an hour's less UTC offset
      // away because 14 March is EDT and 13 March was EST.
      expect(new Date(row.starts_at).toISOString()).toBe('2027-03-14T23:00:00.000Z');
      expect(new Date(row.ends_at).toISOString()).toBe('2027-03-15T02:00:00.000Z');
    });

    it('update_event leaves the instants exactly alone when no calendar field is given', async () => {
      const seeded = clubs.get('Australia/Sydney')!;
      const { eventId, error } = await createEvent({
        clubId: seeded.clubId,
        title: 'Untouched',
        venueId: seeded.venueId,
        notes: '',
        date: '2027-11-07',
        startTime: '19:00',
        durationMinutes: 180,
        tableCount: 1,
        checkInRequired: false,
        feeCents: 0,
        minSpendCents: 0,
      });
      expect(error).toBeNull();
      createdEventIds.push(eventId!);

      const { error: updateError } = await updateEvent(eventId!, {
        title: 'Renamed, not rescheduled',
      });
      expect(updateError).toBeNull();

      const { data } = await supabase
        .from('events')
        .select('title, starts_at, ends_at')
        .eq('id', eventId!)
        .single();
      const row = data as { title: string; starts_at: string; ends_at: string };
      expect(row.title).toBe('Renamed, not rescheduled');
      expect(new Date(row.starts_at).toISOString()).toBe('2027-11-07T08:00:00.000Z');
      expect(new Date(row.ends_at).toISOString()).toBe('2027-11-07T11:00:00.000Z');
    });

    it('update_event changes only the duration when only the duration is given', async () => {
      const seeded = clubs.get('Asia/Tokyo')!;
      const { eventId, error } = await createEvent({
        clubId: seeded.clubId,
        title: 'Longer game',
        venueId: seeded.venueId,
        notes: '',
        date: '2027-09-07',
        startTime: '19:00',
        durationMinutes: 180,
        tableCount: 1,
        checkInRequired: false,
        feeCents: 0,
        minSpendCents: 0,
      });
      expect(error).toBeNull();
      createdEventIds.push(eventId!);

      const { error: updateError } = await updateEvent(eventId!, {
        durationMinutes: 240,
      });
      expect(updateError).toBeNull();

      const { data } = await supabase
        .from('events')
        .select('starts_at, ends_at')
        .eq('id', eventId!)
        .single();
      const row = data as { starts_at: string; ends_at: string };
      expect(new Date(row.starts_at).toISOString()).toBe('2027-09-07T10:00:00.000Z');
      expect(new Date(row.ends_at).toISOString()).toBe('2027-09-07T14:00:00.000Z');
    });
  },
);

/*
 * The refusal contract.
 *
 * lib/events.ts's `rpcErrorMessage` and lib/venues.ts's `updateVenue` decide
 * what the host is told by matching a SQLSTATE against a substring of the
 * message Postgres produced — either a function's own `raise ... using
 * errcode`, or the constraint name Postgres writes into a CHECK/UNIQUE
 * violation. Both halves of that key live in migrations, and neither is
 * something the Vitest suites can see: they mock supabase-js and hand the
 * mapper a payload written by hand, which proves the mapper reads the shape
 * it was given and nothing at all about whether the database still produces
 * it.
 *
 * That gap is where the original bug lived — three deliberate refusals
 * reaching the host as "Could not reach MahjHero. Check your connection and
 * try again.", a false statement about a request that arrived and was refused
 * on purpose. So these run the real RPCs against the real database and assert
 * the message the host would actually read. Reword a `raise`, rename
 * `event_series_ends_after_start`, or drop a mapping, and this block goes
 * red with the exact wrong sentence in the failure output.
 */
describe.runIf(reachable || required)('deliberate refusals reach the host as refusals', () => {
  let admin: SupabaseClient;
  let userId: string;
  let clubId: string;
  let venueId: string;
  let otherVenueId: string;
  let eventId: string;
  let seriesId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    ({ admin, userId } = await signInFreshUser());

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: club, error: clubError } = await admin
      .from('clubs')
      .insert({
        name: 'Refusal Club',
        slug: `refusal-club-${suffix}`,
        timezone: 'America/New_York',
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
    expect(memberError, `seeding host failed: ${memberError?.message}`).toBeNull();

    // Two PUBLIC venues, so renaming one onto the other's name is the real
    // unique-index collision updateVenue has to translate. The names carry a
    // per-run suffix because this suite runs against the persistent local
    // stack, where a leftover row from an earlier run would otherwise make
    // the first insert, not the rename, the thing that collides.
    const { data: venues, error: venueError } = await admin
      .from('venues')
      .insert([
        {
          name: `Refusal Hall ${suffix}`,
          visibility: 'public',
          added_by_club_id: clubId,
          created_by: userId,
        },
        {
          name: `Refusal Annex ${suffix}`,
          visibility: 'public',
          added_by_club_id: clubId,
          created_by: userId,
        },
      ])
      .select('id, name')
      .order('name');
    expect(venueError, `seeding venues failed: ${venueError?.message}`).toBeNull();
    // Ordered by name: "Annex" before "Hall".
    otherVenueId = venues![0].id;
    venueId = venues![1].id;

    const { eventId: created, error: createError } = await createEvent({
      clubId,
      title: 'A real future game',
      venueId,
      notes: '',
      date: '2027-09-07',
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(createError, `seeding event failed: ${createError}`).toBeNull();
    eventId = created!;

    const { data: series, error: seriesError } = await admin
      .from('event_series')
      .insert({
        club_id: clubId,
        title: 'A real series',
        venue_id: venueId,
        notes: '',
        frequency: 'weekly',
        weekday: 2,
        start_time: '19:00:00',
        duration_minutes: 180,
        table_count: 1,
        starts_on: '2027-06-01',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(seriesError, `seeding series failed: ${seriesError?.message}`).toBeNull();
    seriesId = series!.id;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin) {
      if (eventId) await admin.from('event_tables').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('club_id', clubId);
      await admin.from('event_series').delete().eq('club_id', clubId);
      if (venueId) await admin.from('venues').delete().eq('id', venueId);
      if (otherVenueId) await admin.from('venues').delete().eq('id', otherVenueId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('createEvent on a date that has gone by says so, and creates nothing', async () => {
    const { eventId: created, error } = await createEvent({
      clubId,
      title: 'The mistyped year',
      venueId,
      notes: '',
      date: '2020-01-01',
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(created).toBeNull();
    expect(error).toBe('That start time has already passed. Pick a later one.');
    expect(error).not.toBe(GENERIC_ERROR);

    // The other half of the finding: it used to SAVE and then be visible
    // nowhere, because fetchUpcomingEvents is the only listing there is.
    const { count } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('title', 'The mistyped year');
    expect(count).toBe(0);
  });

  it('updateEvent with a cleared title says what the create screen says', async () => {
    const { error } = await updateEvent(eventId, { title: '   ' });
    expect(error).toBe('Give the game a name.');
    expect(error).not.toBe(GENERIC_ERROR);
  });

  it('updateEvent moving a game backwards into the past says so', async () => {
    const { error } = await updateEvent(eventId, { date: '2020-01-01' });
    expect(error).toBe('That start time has already passed. Pick a later one.');
    expect(error).not.toBe(GENERIC_ERROR);
  });

  it('updateEventSeries with a cleared title says the same thing', async () => {
    const { error } = await updateEventSeries(seriesId, { title: '   ' });
    expect(error).toBe('Give the game a name.');
    expect(error).not.toBe(GENERIC_ERROR);
  });

  it('updateEventSeries with an end date before the start says so', async () => {
    // This one is a table CHECK violation, not a `raise`, so what is being
    // pinned here is that `event_series_ends_after_start` still appears in
    // the message PostgREST returns.
    const { error } = await updateEventSeries(seriesId, { endsOn: '2027-01-01' });
    expect(error).toBe('That end date is before the series starts.');
    expect(error).not.toBe(GENERIC_ERROR);
  });

  it('createEventSeries whose run is already over says so, and creates nothing', async () => {
    const { seriesId: created, error } = await createEventSeries({
      clubId,
      title: 'Already over',
      venueId,
      notes: '',
      frequency: 'weekly',
      weekday: 2,
      nthWeek: null,
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      startsOn: '2020-01-01',
      endsOn: '2020-02-01',
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(created).toBeNull();
    expect(error).toBe('No games would be created before that end date.');
    expect(error).not.toBe(GENERIC_ERROR);

    const { count } = await supabase
      .from('event_series')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('title', 'Already over');
    expect(count).toBe(0);
  });

  it('updateVenue renaming onto an existing public name says so', async () => {
    const { data: other } = await supabase
      .from('venues')
      .select('name')
      .eq('id', otherVenueId)
      .single();
    const { error } = await updateVenue(venueId, {
      name: (other as { name: string }).name,
    });
    expect(error).toBe('A shared venue with that name already exists here.');
    expect(error).not.toBe(GENERIC_ERROR);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The booking RPCs' JSON shape.
 * ---------------------------------------------------------------------------
 *
 * `commit_booking` returns a jsonb OBJECT and `event_seating` returns a SET
 * OF ROWS with enum-typed columns — exactly the shape where PostgREST's
 * serialization and lib/bookings.ts's TypeScript types (`BookingOutcome`,
 * `SeatOccupant`) can drift silently, the same class of gap
 * `quiet_hours_start`/`TIME_PATTERN` closed for `time` columns at the top of
 * this file. A mocked Vitest suite hands the mapper a payload written by
 * hand and proves only that the mapper reads the shape it was given; this
 * block calls the real RPCs against the real database and reads back what
 * PostgREST actually produces.
 *
 * The third case exists for one column specifically: `waitlist_position` is
 * a Postgres `int` (cast down from a `bigint` count precisely so it arrives
 * this way — see booking_result's and event_seating's own `::int` casts),
 * but a plain `bigint` column serializes through PostgREST as a STRING, not
 * a number, because a bigint can exceed what a JS `number` represents
 * exactly. `typeof data.waitlist_position === 'number'` is what stops that
 * cast being "simplified" away as redundant — WaitlistPanel's `waitlistLabel`
 * does arithmetic (`position % 100`) directly on this value, which silently
 * produces `NaN`-shaped nonsense on a string rather than an error.
 */
describe.runIf(reachable || required)(
  'booking RPCs return the shape lib/bookings.ts claims',
  () => {
    let admin: SupabaseClient;
    let userId: string;
    let clubId: string;
    let eventId: string;
    let tableId: string;
    let fullEventId: string | null = null;
    let fillerId: string | null = null;

    beforeAll(async () => {
      expect(
        reachable,
        `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
      ).toBe(true);
      ({ admin, userId } = await signInFreshUser());

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: club, error: clubError } = await admin
        .from('clubs')
        .insert({
          name: 'Booking Contract Club',
          slug: `booking-contract-${suffix}`,
          timezone: 'America/New_York',
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
      expect(memberError, `seeding membership failed: ${memberError?.message}`).toBeNull();

      const { data: venue, error: venueError } = await admin
        .from('venues')
        .insert({
          name: 'Contract Booking Hall',
          visibility: 'club',
          added_by_club_id: clubId,
          created_by: userId,
        })
        .select('id')
        .single();
      expect(venueError, `seeding venue failed: ${venueError?.message}`).toBeNull();

      // A two-table game, per the brief — only the first table is used for
      // seating below, but a caller resolving `preferred` against a game
      // with just one table would never exercise the join `plan_seating`
      // does against `event_tables`.
      const { data: event, error: eventError } = await admin
        .from('events')
        .insert({
          club_id: clubId,
          title: 'Contract booking game',
          venue_id: venue!.id,
          notes: '',
          starts_at: '2099-09-08T23:00:00Z',
          ends_at: '2099-09-09T02:00:00Z',
          created_by: userId,
        })
        .select('id')
        .single();
      expect(eventError, `seeding event failed: ${eventError?.message}`).toBeNull();
      eventId = event!.id;

      const { data: tables, error: tableError } = await admin
        .from('event_tables')
        .insert([
          { event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 },
          { event_id: eventId, club_id: clubId, label: 'Table 2', position: 2 },
        ])
        .select('id, label');
      expect(tableError, `seeding tables failed: ${tableError?.message}`).toBeNull();
      tableId = tables!.find((t) => t.label === 'Table 1')!.id;
    });

    afterAll(async () => {
      await supabase.auth.signOut();
      if (admin) {
        if (fullEventId) {
          await admin.from('bookings').delete().eq('event_id', fullEventId);
          await admin.from('booking_groups').delete().eq('event_id', fullEventId);
          await admin.from('event_tables').delete().eq('event_id', fullEventId);
          await admin.from('events').delete().eq('id', fullEventId);
        }
        if (eventId) {
          await admin.from('bookings').delete().eq('event_id', eventId);
          await admin.from('booking_groups').delete().eq('event_id', eventId);
          await admin.from('event_tables').delete().eq('event_id', eventId);
          await admin.from('events').delete().eq('id', eventId);
        }
        if (clubId) {
          await admin.from('venues').delete().eq('added_by_club_id', clubId);
          await admin.from('club_members').delete().eq('club_id', clubId);
          await admin.from('clubs').delete().eq('id', clubId);
        }
      }
      if (admin && fillerId) await admin.auth.admin.deleteUser(fillerId);
      if (admin && userId) await admin.auth.admin.deleteUser(userId);
    });

    it('returns the booking outcome in the shape BookingOutcome claims', async () => {
      const { data, error } = await supabase.rpc('commit_booking', {
        target_event: eventId,
        players: [userId],
        preferred: tableId,
        allow_split: true,
      });
      expect(error, `commit_booking failed: ${error?.message}`).toBeNull();
      const row = data as Record<string, unknown>;

      // The whole point of this suite: the JSON PostgREST actually
      // produces, not the plpgsql that produced it.
      expect(Object.keys(row).sort()).toEqual(
        ['group_id', 'offer', 'outcome', 'placements', 'split', 'waitlist_position'].sort(),
      );
      expect(row.outcome).toBe('seated');
      expect(Array.isArray(row.placements)).toBe(true);
      expect((row.placements as unknown[])[0]).toMatchObject({
        profile_id: userId,
        event_table_id: tableId,
      });
    });

    it('returns event_seating rows with the column names SeatOccupant claims', async () => {
      const { data, error } = await supabase.rpc('event_seating', {
        target_event: eventId,
      });
      expect(error, `event_seating failed: ${error?.message}`).toBeNull();
      const rows = data as Record<string, unknown>[];

      // The previous test already seated the caller here, so this is never
      // an empty set — `rows[0]` below is a real row, not `undefined`.
      expect(rows.length).toBeGreaterThan(0);
      expect(Object.keys(rows[0]!).sort()).toEqual(
        [
          'booked_by', 'booked_by_name', 'booking_id', 'created_at',
          'display_name', 'event_table_id', 'group_id', 'group_status',
          'profile_id', 'skill_level', 'status', 'waitlist_position',
        ].sort(),
      );
      // Enums arrive as strings. A typo in the TS union would type-check
      // fine and compare false at runtime forever.
      expect(['confirmed', 'waitlisted']).toContain(rows[0]!.status);
    });

    it('returns a waitlist_position that is a number, not a string', async () => {
      // A second, ALREADY-FULL game (capacity 1, filled by a throwaway
      // profile via service_role — assert_players_bookable never runs
      // against it, so it does not need to be a club member) so the
      // caller's own commit_booking call below is provably 'waitlisted'
      // rather than 'seated' by the first test above.
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: fullVenue, error: fullVenueError } = await admin
        .from('venues')
        .insert({
          name: 'Contract Full Hall',
          visibility: 'club',
          added_by_club_id: clubId,
          created_by: userId,
        })
        .select('id')
        .single();
      expect(fullVenueError, `seeding full venue failed: ${fullVenueError?.message}`).toBeNull();

      const { data: fullEvent, error: fullEventError } = await admin
        .from('events')
        .insert({
          club_id: clubId,
          title: 'Contract full game',
          venue_id: fullVenue!.id,
          notes: '',
          starts_at: '2099-09-15T23:00:00Z',
          ends_at: '2099-09-16T02:00:00Z',
          created_by: userId,
        })
        .select('id')
        .single();
      expect(fullEventError, `seeding full event failed: ${fullEventError?.message}`).toBeNull();
      fullEventId = fullEvent!.id;

      const { data: fullTable, error: fullTableError } = await admin
        .from('event_tables')
        .insert({
          event_id: fullEventId,
          club_id: clubId,
          label: 'Table 1',
          position: 1,
          capacity: 1,
        })
        .select('id')
        .single();
      expect(fullTableError, `seeding full table failed: ${fullTableError?.message}`).toBeNull();

      const { data: filler, error: fillerError } = await admin.auth.admin.createUser({
        email: `contract-filler-${suffix}@mahjhero.test`,
        email_confirm: true,
      });
      expect(fillerError, `seeding filler profile failed: ${fillerError?.message}`).toBeNull();
      fillerId = filler!.user!.id;

      const { data: fillerGroup, error: fillerGroupError } = await admin
        .from('booking_groups')
        .insert({
          event_id: fullEventId,
          club_id: clubId,
          created_by: fillerId,
          preferred_table_id: fullTable!.id,
          status: 'confirmed',
        })
        .select('id')
        .single();
      expect(fillerGroupError, `seeding filler group failed: ${fillerGroupError?.message}`).toBeNull();

      const { error: fillerBookingError } = await admin.from('bookings').insert({
        group_id: fillerGroup!.id,
        event_id: fullEventId,
        club_id: clubId,
        event_table_id: fullTable!.id,
        profile_id: fillerId,
        booked_by: fillerId,
        status: 'confirmed',
      });
      expect(fillerBookingError, `seeding filler booking failed: ${fillerBookingError?.message}`).toBeNull();

      const { data, error } = await supabase.rpc('commit_booking', {
        target_event: fullEventId,
        players: [userId],
        preferred: null,
        allow_split: true,
      });
      expect(error, `commit_booking failed: ${error?.message}`).toBeNull();
      const row = data as Record<string, unknown>;

      expect(row.outcome).toBe('waitlisted');
      // Postgres bigint arrives as a string through PostgREST. This one is
      // cast to int in SQL precisely so it does not, and this assertion is
      // what stops that cast being removed as redundant.
      expect(typeof row.waitlist_position).toBe('number');
    });
  },
);

describe.runIf(reachable || required)('broadcasts schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;
  let clubId: string;
  let broadcastId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    // A signed-in caller: broadcasts_select_organizer only lets a host or
    // co-organizer read a club's own broadcasts, and `select` on the table
    // is granted to `authenticated` only, never `anon`.
    ({ admin, userId } = await signInFreshUser());

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

    // 'host', not 'member' — broadcasts_select_organizer requires
    // is_club_organizer, which only 'host' and 'co_organizer' satisfy.
    const { error: memberError } = await admin.from('club_members').insert({
      club_id: clubId,
      profile_id: userId,
      role: 'host',
      status: 'active',
    });
    expect(memberError, `seeding club_members failed: ${memberError?.message}`).toBeNull();

    // Seeded through the service-role client rather than send_broadcast —
    // this suite is testing what the SELECT side hands back, not the RPC's
    // own fan-out. event_id null (the whole-roster case) exercises the
    // branch the `Broadcast` type declares as nullable.
    const { data: broadcast, error: broadcastError } = await admin
      .from('broadcasts')
      .insert({
        club_id: clubId,
        event_id: null,
        author_id: userId,
        subject: 'Doors at seven',
        body: 'Doors open at 7pm sharp this week, not the usual 7:30.',
        recipient_count: 3,
      })
      .select('id')
      .single();
    expect(broadcastError, `seeding broadcast failed: ${broadcastError?.message}`).toBeNull();
    broadcastId = broadcast!.id;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin) {
      if (broadcastId) await admin.from('broadcasts').delete().eq('id', broadcastId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('answers with the shape the `Broadcast` type claims', async () => {
    // fetchBroadcasts is gone (Task 15 absorbed the broadcast compose and
    // history screens into the message threads) — the RLS-governed read it
    // used to wrap is exercised directly here instead, through the same
    // authenticated client and column list fetchBroadcasts used to use.
    const { data, error } = await supabase
      .from('broadcasts')
      .select(BROADCAST_COLUMNS)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false });
    expect(error).toBeNull();
    const rows = (data ?? []) as unknown as Broadcast[];
    expect(rows).toHaveLength(1);

    const [row] = rows;
    // Every field the type declares, with the type it declares. This is the
    // boundary Critical 1 lived in: both suites were green while
    // `quiet_hours_start` arrived as "21:00:00" and the client expected
    // "21:00", because neither suite crossed it.
    expect(typeof row.id).toBe('string');
    expect(typeof row.club_id).toBe('string');
    expect(row.event_id).toBeNull();
    expect(typeof row.subject).toBe('string');
    expect(typeof row.body).toBe('string');
    // int4, not a numeric arriving as a string.
    expect(typeof row.recipient_count).toBe('number');
    expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
  });

  it('selects every column the type declares and no others', async () => {
    // Same pattern as EVENT_COLUMNS/SERIES_COLUMNS/EVENT_TABLE_COLUMNS/
    // VENUE_COLUMNS above: fetch the real row through BROADCAST_COLUMNS and
    // assert the EXACT key set PostgREST hands back, not two hardcoded
    // strings compared to each other. Reuses the broadcast beforeAll already
    // seeded rather than inserting a second one.
    const { data, error } = await supabase
      .from('broadcasts')
      .select(BROADCAST_COLUMNS)
      .eq('id', broadcastId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    // Expected keys come from `keyof Broadcast`, not a retyped array literal,
    // so this is a compile-time contract as well as a runtime one: add a
    // field to the Broadcast type without adding it here and `tsc --noEmit`
    // refuses to build (missing property on a `Record<keyof Broadcast,
    // true>`), and a stray field here that Broadcast doesn't declare fails
    // the same way (excess property). That closes the gap the plain-string
    // version left — a field on the type that never made it into
    // BROADCAST_COLUMNS was invisible to both this suite and the type
    // checker; now it fails one of the two immediately, and the resulting
    // key-count mismatch against the live row still catches drift in
    // BROADCAST_COLUMNS itself.
    const declaredFields: Record<keyof Broadcast, true> = {
      id: true,
      club_id: true,
      event_id: true,
      subject: true,
      body: true,
      recipient_count: true,
      created_at: true,
    };
    expect(Object.keys(row).sort()).toEqual(Object.keys(declaredFields).sort());
  });
});

/*
 * ---------------------------------------------------------------------------
 * Attendance crosses the boundary too.
 * ---------------------------------------------------------------------------
 *
 * `attendance_state` is a Postgres enum and the check-in window is two
 * `timestamptz` columns computed in SQL (my_upcoming_bookings,
 * 20260827070000) — exactly the shape of risk `quiet_hours_start` was at the
 * top of this file: a mocked Vitest suite hands its mapper a payload the
 * mapper already agrees with, so it cannot see PostgREST's actual enum
 * string, nor the client's own `checkInOpen` (lib/attendance.ts) disagreeing
 * with the server's one-hour-lead arithmetic. This block seeds a real
 * confirmed booking and a real check_ins row and reads both back through the
 * real RPCs a signed-in organizer would call.
 */
describe.runIf(reachable || required)('attendance schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;
  let clubId: string;
  let venueId: string;
  let eventId: string;
  let tableId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    // A signed-in caller: event_attendance's assert_club_organizer refuses
    // anyone who isn't running the door, and this block calls it as this
    // same session below.
    ({ admin, userId } = await signInFreshUser());

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: club, error: clubError } = await admin
      .from('clubs')
      .insert({
        name: 'Attendance Contract Club',
        slug: `attendance-contract-${suffix}`,
        timezone: 'America/New_York',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(clubError, `seeding club failed: ${clubError?.message}`).toBeNull();
    clubId = club!.id;

    // 'host': event_attendance's assert_club_organizer requires
    // is_club_organizer, which only 'host' and 'co_organizer' satisfy.
    const { error: memberError } = await admin.from('club_members').insert({
      club_id: clubId,
      profile_id: userId,
      role: 'host',
      status: 'active',
    });
    expect(memberError, `seeding host failed: ${memberError?.message}`).toBeNull();

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .insert({
        name: 'Attendance Hall',
        visibility: 'club',
        added_by_club_id: clubId,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(venueError, `seeding venue failed: ${venueError?.message}`).toBeNull();
    venueId = venue!.id;

    // starts_at 30 minutes AGO, ends_at 2.5 hours from now — unlike every
    // other seed in this file, which sits safely in the future because
    // nothing there depends on the wall clock, THIS fixture has to straddle
    // it: the check-in window my_upcoming_bookings computes
    // (starts_at - 1h .. ends_at) must actually be open right now, or the
    // `checkInOpen` assertion below would be checking parseability only,
    // not the boundary crossing the brief calls "the point of the whole
    // test".
    const now = Date.now();
    const startsAt = new Date(now - 30 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 150 * 60 * 1000).toISOString();

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Attendance contract game',
        venue_id: venueId,
        notes: '',
        starts_at: startsAt,
        ends_at: endsAt,
        check_in_required: true,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(eventError, `seeding event failed: ${eventError?.message}`).toBeNull();
    eventId = event!.id;

    const { data: table, error: tableError } = await admin
      .from('event_tables')
      .insert({ event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 })
      .select('id')
      .single();
    expect(tableError, `seeding table failed: ${tableError?.message}`).toBeNull();
    tableId = table!.id;

    const { data: group, error: groupError } = await admin
      .from('booking_groups')
      .insert({
        event_id: eventId,
        club_id: clubId,
        created_by: userId,
        preferred_table_id: tableId,
        status: 'confirmed',
      })
      .select('id')
      .single();
    expect(groupError, `seeding booking group failed: ${groupError?.message}`).toBeNull();

    const { error: bookingError } = await admin.from('bookings').insert({
      group_id: group!.id,
      event_id: eventId,
      club_id: clubId,
      event_table_id: tableId,
      profile_id: userId,
      booked_by: userId,
      status: 'confirmed',
    });
    expect(bookingError, `seeding booking failed: ${bookingError?.message}`).toBeNull();

    // The check-in row itself — what event_attendance's second CTE arm
    // joins in, and what makes row.state something other than null below.
    // Inserted through the service-role client: check_ins carries no write
    // policy at all (20260827020000's own comment — "Task 4's definer
    // functions are the only way a row is ever created"), and this suite
    // seeds the shape it wants to read, not the write path.
    const { error: checkInError } = await admin.from('check_ins').insert({
      event_id: eventId,
      club_id: clubId,
      profile_id: userId,
      state: 'arrived',
      recorded_by: userId,
    });
    expect(checkInError, `seeding check-in failed: ${checkInError?.message}`).toBeNull();
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin) {
      if (eventId) {
        await admin.from('check_ins').delete().eq('event_id', eventId);
        await admin.from('bookings').delete().eq('event_id', eventId);
        await admin.from('booking_groups').delete().eq('event_id', eventId);
        await admin.from('event_tables').delete().eq('event_id', eventId);
        await admin.from('events').delete().eq('id', eventId);
      }
      if (venueId) await admin.from('venues').delete().eq('id', venueId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('serializes attendance_state as the client union', async () => {
    const { data, error } = await supabase.rpc('event_attendance', {
      target_event: eventId,
    });
    expect(error, `event_attendance failed: ${error?.message}`).toBeNull();
    const rows = data as Record<string, unknown>[];
    const row = rows.find((r) => r.profile_id === userId);
    expect(row, 'event_attendance did not return the seeded booking').toBeDefined();

    // Enums arrive as strings; a typo in AttendanceState (lib/attendance.ts)
    // would type-check fine and only fail here, at runtime.
    expect(['arrived', 'no_show', null]).toContain(row!.state);
    expect(row!.state).toBe('arrived');
    expect(
      row!.booking_status === null || row!.booking_status === 'confirmed',
    ).toBe(true);
    expect(row!.booking_status).toBe('confirmed');
  });

  it('serializes the check-in window as parseable timestamps checkInOpen agrees with', async () => {
    const { data, error } = await supabase.rpc('my_upcoming_bookings');
    expect(error, `my_upcoming_bookings failed: ${error?.message}`).toBeNull();
    const rows = data as Record<string, unknown>[];
    const row = rows.find((r) => r.event_id === eventId);
    expect(row, 'my_upcoming_bookings did not return the seeded booking').toBeDefined();

    expect(row!.check_in_required).toBe(true);
    expect(Number.isNaN(Date.parse(row!.check_in_opens_at as string))).toBe(false);
    expect(Number.isNaN(Date.parse(row!.check_in_closes_at as string))).toBe(false);
    // The point of the whole test: the client's own predicate, run against
    // timestamps the server actually produced — not a hand-typed pair that
    // could quietly drift from what my_upcoming_bookings really returns.
    expect(
      checkInOpen(
        row!.check_in_opens_at as string,
        row!.check_in_closes_at as string,
      ),
    ).toBe(true);
  });
});

describe.runIf(reachable || required)('table_rounds contract', () => {
  let admin: SupabaseClient;
  let userId: string;
  let clubId: string;
  let venueId: string;
  let eventId: string;
  let tableId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    // A signed-in caller: record_round's assert_round_writable and its own
    // organizer-or-seated-player gate both run as this same session below.
    ({ admin, userId } = await signInFreshUser());

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: club, error: clubError } = await admin
      .from('clubs')
      .insert({
        name: 'Table Rounds Contract Club',
        slug: `table-rounds-contract-${suffix}`,
        timezone: 'America/New_York',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(clubError, `seeding club failed: ${clubError?.message}`).toBeNull();
    clubId = club!.id;

    // 'host': record_round accepts either a club organizer or a player
    // seated at the table (is_club_organizer / bookings check inside the
    // RPC). Seeding this session as the organizer AND, below, as the
    // confirmed booking at the table it will record a round for satisfies
    // both gates with a single profile, the same simplification the
    // event_attendance fixture makes for its own signed-in caller.
    const { error: memberError } = await admin.from('club_members').insert({
      club_id: clubId,
      profile_id: userId,
      role: 'host',
      status: 'active',
    });
    expect(memberError, `seeding host failed: ${memberError?.message}`).toBeNull();

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .insert({
        name: 'Table Rounds Hall',
        visibility: 'club',
        added_by_club_id: clubId,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(venueError, `seeding venue failed: ${venueError?.message}`).toBeNull();
    venueId = venue!.id;

    // starts_at 30 minutes AGO, ends_at 2.5 hours from now -- record_round's
    // assert_round_writable refuses a table whose event has not started yet
    // (starts_at > now) or has already ended (ends_at <= now), so like the
    // attendance fixture above (and unlike most other seeds in this file,
    // which sit safely in the future) this one has to straddle the wall
    // clock rather than just be well-formed.
    const now = Date.now();
    const startsAt = new Date(now - 30 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 150 * 60 * 1000).toISOString();

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        club_id: clubId,
        title: 'Table rounds contract game',
        venue_id: venueId,
        notes: '',
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(eventError, `seeding event failed: ${eventError?.message}`).toBeNull();
    eventId = event!.id;

    const { data: table, error: tableError } = await admin
      .from('event_tables')
      .insert({ event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 })
      .select('id')
      .single();
    expect(tableError, `seeding table failed: ${tableError?.message}`).toBeNull();
    tableId = table!.id;

    const { data: group, error: groupError } = await admin
      .from('booking_groups')
      .insert({
        event_id: eventId,
        club_id: clubId,
        created_by: userId,
        preferred_table_id: tableId,
        status: 'confirmed',
      })
      .select('id')
      .single();
    expect(groupError, `seeding booking group failed: ${groupError?.message}`).toBeNull();

    // Also the round's winner-to-be: record_round re-derives who is seated
    // from bookings itself, never trusting the client, so the winner needs
    // its own confirmed booking at this table -- here that is the same
    // profile as the caller, doubling as both recorder and winner.
    const { error: bookingError } = await admin.from('bookings').insert({
      group_id: group!.id,
      event_id: eventId,
      club_id: clubId,
      event_table_id: tableId,
      profile_id: userId,
      booked_by: userId,
      status: 'confirmed',
    });
    expect(bookingError, `seeding booking failed: ${bookingError?.message}`).toBeNull();
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin) {
      if (eventId) {
        // table_rounds' own foreign keys cascade off event_tables/events,
        // but this suite deletes it explicitly first anyway, matching the
        // attendance fixture's explicit check_ins delete above rather than
        // relying on cascade to do cleanup unremarked.
        await admin.from('table_rounds').delete().eq('event_id', eventId);
        await admin.from('bookings').delete().eq('event_id', eventId);
        await admin.from('booking_groups').delete().eq('event_id', eventId);
        await admin.from('event_tables').delete().eq('event_id', eventId);
        await admin.from('events').delete().eq('id', eventId);
      }
      if (venueId) await admin.from('venues').delete().eq('id', venueId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('record_round returns a row the client can read back as TableRound', async () => {
    const { data, error } = await supabase.rpc('record_round', {
      target_table: tableId,
      winner_profile: userId,
      target_points: 8,
    });
    expect(error, `record_round failed: ${error?.message}`).toBeNull();

    // Cast to the client's own type -- a column record_round stops
    // returning, or a type that drifts from what the RPC actually sends
    // back (e.g. points arriving as a numeric string rather than a
    // number), would type-check here regardless and only be caught by the
    // assertions below, at runtime.
    const round = data as TableRound;
    expect(round).toMatchObject({
      event_table_id: tableId,
      winner_profile_id: userId,
      points: 8,
      recorded_by: userId,
    });
    expect(typeof round.id).toBe('string');
    expect(Number.isNaN(Date.parse(round.created_at))).toBe(false);

    // fetchTableRounds (lib/rounds.ts) is a plain RLS-scoped select, not an
    // RPC -- this is the other half of the boundary record_round's own
    // response already crossed: the row this table's SELECT grant and
    // table_rounds_select_member policy actually let an ordinary club
    // member read back has to agree with the same TableRound shape too.
    const rounds = await fetchTableRounds(eventId);
    expect(rounds).toEqual([
      expect.objectContaining({
        id: round.id,
        event_table_id: tableId,
        winner_profile_id: userId,
        points: 8,
        recorded_by: userId,
      }),
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Messages cross the boundary too.
 * ---------------------------------------------------------------------------
 *
 * lib/messages.ts's THREAD_COLUMNS and MESSAGE_COLUMNS carry the one embed
 * in this codebase whose resolution is a genuine open question rather than a
 * formality: `messages` self-references through `reply_to_id`, by way of a
 * COMPOSITE foreign key -- `(reply_to_id, thread_id) references messages
 * (id, thread_id)` -- and MESSAGE_COLUMNS asks PostgREST to embed it as
 * `reply_to:reply_to_id(...)`. Whether PostgREST resolves a composite
 * self-reference through a column-name hint at all, and whether it embeds
 * one row (not many, and not the wrong side of the pair) is exactly what a
 * mocked Vitest suite cannot see -- the mock answers whatever shape the test
 * hands it, so a broken hint and a working one look identical to it. Only a
 * real PostgREST server, on a real composite foreign key, can prove this one
 * way or the other.
 */
describe.runIf(reachable || required)('messages schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;
  let otherId: string;
  let otherEmail: string;
  let clubId: string;
  let venueId: string;
  let eventId: string;
  let gameThreadId: string;
  let groupThreadId: string;

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${local.url}. Run \`npx supabase start\`.`,
    ).toBe(true);
    ({ admin, userId } = await signInFreshUser());

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: club, error: clubError } = await admin
      .from('clubs')
      .insert({
        name: 'Messages Contract Club',
        slug: `messages-contract-${suffix}`,
        timezone: 'America/New_York',
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
    expect(memberError, `seeding host failed: ${memberError?.message}`).toBeNull();

    const { error: nameError } = await admin
      .from('profiles')
      .update({ display_name: 'Contract Poster' })
      .eq('id', userId);
    expect(nameError, `naming caller profile failed: ${nameError?.message}`).toBeNull();

    // A second real profile, in the same club, so createGroupThread's
    // can_reach check (shared active club membership) passes -- and so
    // THREAD_COLUMNS' thread_members embed carries two distinguishable
    // rows, not the caller alone.
    otherEmail = `messages-contract-other-${suffix}@mahjhero.test`;
    const { data: otherUser, error: otherError } = await admin.auth.admin.createUser({
      email: otherEmail,
      email_confirm: true,
    });
    expect(otherError, `seeding second profile failed: ${otherError?.message}`).toBeNull();
    otherId = otherUser!.user!.id;
    const { error: otherMemberError } = await admin.from('club_members').insert({
      club_id: clubId,
      profile_id: otherId,
      role: 'member',
      status: 'active',
    });
    expect(
      otherMemberError,
      `seeding second member failed: ${otherMemberError?.message}`,
    ).toBeNull();
    const { error: otherNameError } = await admin
      .from('profiles')
      .update({ display_name: 'Contract Other' })
      .eq('id', otherId);
    expect(
      otherNameError,
      `naming second profile failed: ${otherNameError?.message}`,
    ).toBeNull();

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .insert({
        name: 'Messages Contract Hall',
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
        title: 'Contract Mahjong Night',
        venue_id: venueId,
        notes: '',
        starts_at: '2099-09-08T23:00:00Z',
        ends_at: '2099-09-09T02:00:00Z',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(eventError, `seeding event failed: ${eventError?.message}`).toBeNull();
    eventId = event!.id;

    // A confirmed booking, so the caller (already the host, but this keeps
    // the fixture honest about who a real game-thread poster is) can open
    // and post to the game thread below.
    const { data: table, error: tableError } = await admin
      .from('event_tables')
      .insert({ event_id: eventId, club_id: clubId, label: 'Table 1', position: 1 })
      .select('id')
      .single();
    expect(tableError, `seeding table failed: ${tableError?.message}`).toBeNull();

    const { data: group, error: groupError } = await admin
      .from('booking_groups')
      .insert({
        event_id: eventId,
        club_id: clubId,
        created_by: userId,
        preferred_table_id: table!.id,
        status: 'confirmed',
      })
      .select('id')
      .single();
    expect(groupError, `seeding booking group failed: ${groupError?.message}`).toBeNull();

    const { error: bookingError } = await admin.from('bookings').insert({
      group_id: group!.id,
      event_id: eventId,
      club_id: clubId,
      event_table_id: table!.id,
      profile_id: userId,
      booked_by: userId,
      status: 'confirmed',
    });
    expect(bookingError, `seeding booking failed: ${bookingError?.message}`).toBeNull();

    // Opened through the real RPCs as the signed-in caller -- can_read_thread
    // and can_post_thread must actually pass here, not merely be assumed.
    const { id: openedGameThreadId, error: openGameError } =
      await openThreadForEvent(eventId);
    expect(openGameError, `openThreadForEvent failed: ${openGameError}`).toBeNull();
    gameThreadId = openedGameThreadId!;

    const { id: openedGroupThreadId, error: groupThreadError } = await createGroupThread(
      'Contract Group',
      [otherId],
    );
    expect(groupThreadError, `createGroupThread failed: ${groupThreadError}`).toBeNull();
    groupThreadId = openedGroupThreadId!;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin) {
      if (eventId) {
        await admin.from('bookings').delete().eq('event_id', eventId);
        await admin.from('booking_groups').delete().eq('event_id', eventId);
        await admin.from('event_tables').delete().eq('event_id', eventId);
      }
      if (groupThreadId) {
        await admin.from('message_threads').delete().eq('id', groupThreadId);
      }
      if (eventId) await admin.from('events').delete().eq('id', eventId);
      if (venueId) await admin.from('venues').delete().eq('id', venueId);
      if (clubId) await admin.from('club_members').delete().eq('club_id', clubId);
      if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    }
    if (admin && otherId) await admin.auth.admin.deleteUser(otherId);
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('answers THREAD_COLUMNS with exactly the columns ThreadDetail names, for a game thread', async () => {
    const { data, error } = await supabase
      .from('message_threads')
      .select(THREAD_COLUMNS)
      .eq('id', gameThreadId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    // Same pattern as BROADCAST_COLUMNS above: expected keys come from
    // `keyof ThreadDetail`, not a retyped array literal, so an added or
    // renamed field on the type fails at compile time as well as here.
    const declaredFields: Record<keyof ThreadDetail, true> = {
      id: true,
      club_id: true,
      event_id: true,
      title: true,
      clubs: true,
      events: true,
      thread_members: true,
    };
    expect(Object.keys(row).sort()).toEqual(Object.keys(declaredFields).sort());

    expect(row.club_id).toBe(clubId);
    expect(row.event_id).toBe(eventId);
    expect((row.clubs as { name: string }).name).toBe('Messages Contract Club');
    expect((row.events as { title: string }).title).toBe('Contract Mahjong Night');
    // Game threads never populate thread_members -- membership is derived
    // from bookings, not materialized -- so the embed must resolve to an
    // empty array, not a missing key or an error.
    expect(row.thread_members).toEqual([]);
  });

  it('answers THREAD_COLUMNS with exactly the columns ThreadDetail names, for a group thread', async () => {
    const { data, error } = await supabase
      .from('message_threads')
      .select(THREAD_COLUMNS)
      .eq('id', groupThreadId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    expect(row.club_id).toBeNull();
    expect(row.event_id).toBeNull();
    expect(row.clubs).toBeNull();
    expect(row.events).toBeNull();
    const members = row.thread_members as {
      profile_id: string;
      profiles: { display_name: string } | null;
    }[];
    expect(members.map((m) => m.profile_id).sort()).toEqual([userId, otherId].sort());

    /*
     * A FINDING against the RAW select, still true and still worth pinning:
     * `profiles` has been self-row-only since 20260822180000 (see that
     * migration's own docstring -- a plain member reading a co-member's
     * quiet hours was the defect it closed), and the fix moved co-member
     * identity behind a SECURITY DEFINER function, `club_roster`, rather
     * than reopening the table's RLS. THREAD_COLUMNS' `thread_members(
     * profile_id, profiles!thread_members_profile_id_fkey(display_name))`
     * is a plain select, so it inherits that same self-only policy: the
     * caller's OWN row in the embed carries a name, and everyone else's
     * carries `profiles: null`, silently, exactly the shape a co-member's
     * quiet-hours leak used to take before club_roster closed it.
     *
     * There is no club to hand a `club_roster`-style function for a GROUP
     * thread -- that is the whole reason it has no club_id -- which is why
     * `thread_roster` (20260829080000) exists: a security definer RPC, by
     * the same shape, that answers the question this raw select cannot.
     * `fetchThread` merges it in, and the next test proves that merge
     * actually names the co-member -- this one keeps pinning what the raw
     * embed alone still cannot do, so nobody mistakes THREAD_COLUMNS itself
     * for the fix.
     */
    const caller = members.find((m) => m.profile_id === userId);
    expect(caller!.profiles!.display_name).toBe('Contract Poster');
    const other = members.find((m) => m.profile_id === otherId);
    expect(other!.profiles).toBeNull();
  });

  it('fetchThread returns the ThreadDetail shape for both a game and a group thread, naming every member -- through thread_roster, not the self-only profiles embed', async () => {
    const game = await fetchThread(gameThreadId);
    expect(game).not.toBeNull();
    expect(game!.event_id).toBe(eventId);
    expect(game!.events!.title).toBe('Contract Mahjong Night');

    const group = await fetchThread(groupThreadId);
    expect(group).not.toBeNull();
    expect(group!.title).toBe('Contract Group');
    expect(group!.thread_members).toHaveLength(2);

    // The fix: fetchThread merges thread_roster's names into thread_members,
    // so unlike the raw THREAD_COLUMNS select above, the co-member's row is
    // no longer `profiles: null`.
    const caller = group!.thread_members.find((m) => m.profile_id === userId);
    expect(caller!.profiles!.display_name).toBe('Contract Poster');
    const other = group!.thread_members.find((m) => m.profile_id === otherId);
    expect(
      other!.profiles!.display_name,
      'thread_roster should have named the co-member, closing the gap the raw select above still pins',
    ).toBe('Contract Other');
  });

  /*
   * MESSAGE_COLUMNS' finding, pinned as a regression test rather than left
   * as a one-time observation: `messages` has exactly one foreign key into
   * itself, `messages_reply_to_id_thread_id_fkey`, a COMPOSITE key on
   * (reply_to_id, thread_id). Verified directly against this stack's
   * PostgREST (v14.15) that no hint syntax resolves it as an embed --
   * `reply_to:reply_to_id(...)` (the brief's original form),
   * `reply_to:messages!messages_reply_to_id_thread_id_fkey(...)`, and the
   * bare constraint-name hint all answer PGRST200 ("Could not find a
   * relationship between 'messages' and 'messages' in the schema cache"),
   * never PGRST201 (ambiguity) -- proving the schema cache does not expose
   * this relationship as embeddable at all, not merely that it needs a
   * hint. See the task report for the full curl transcript. So
   * MESSAGE_COLUMNS carries no reply_to embed, and this first assertion
   * pins that absence: a future MESSAGE_COLUMNS that re-adds the embed
   * (say, after a PostgREST upgrade) should extend this test, not silently
   * pass it.
   */
  it('MESSAGE_COLUMNS answers exactly its own columns -- no reply_to embed, because PostgREST cannot serve one', async () => {
    const { id: firstId, error: firstError } = await postMessage(
      groupThreadId,
      'First message, nothing quoted',
    );
    expect(firstError, `postMessage (first) failed: ${firstError}`).toBeNull();

    const { id: replyId, error: replyError } = await postMessage(
      groupThreadId,
      'Replying to the first',
      false,
      firstId,
    );
    expect(replyError, `postMessage (reply) failed: ${replyError}`).toBeNull();

    const { data, error } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', replyId!)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;

    // Every key of ThreadMessage EXCEPT reply_to, which fetchThreadMessages
    // fills in from a second query rather than this select list.
    const declaredFields: Record<Exclude<keyof ThreadMessage, 'reply_to'>, true> = {
      id: true,
      author_id: true,
      body: true,
      subject: true,
      is_announcement: true,
      created_at: true,
      profiles: true,
      reply_to_id: true,
    };
    expect(Object.keys(row).sort()).toEqual(Object.keys(declaredFields).sort());
    expect(row.reply_to_id).toBe(firstId);
    expect(row).not.toHaveProperty('reply_to');
  });

  it('fetchThreadMessages resolves the quoted message inline, through fetch_thread_messages, not a second query', async () => {
    const messages = await fetchThreadMessages(groupThreadId);
    expect(messages).not.toBeNull();
    expect(messages!.length).toBeGreaterThanOrEqual(2);

    const reply = messages!.find((m) => m.reply_to_id !== null);
    expect(reply, 'expected the seeded reply among the thread messages').toBeDefined();
    expect(reply!.reply_to).not.toBeNull();
    expect(reply!.reply_to!.body).toBe('First message, nothing quoted');
    // Both messages in this fixture were posted by the caller, so this only
    // proves the RPC names a sender at all, in the right shape -- the next
    // test proves it also names somebody who is NOT the caller, which a
    // same-sender case cannot.
    expect(reply!.profiles?.display_name).toBe('Contract Poster');
    expect(reply!.reply_to!.profiles?.display_name).toBe('Contract Poster');

    const first = messages!.find((m) => m.id === reply!.reply_to_id);
    expect(
      first,
      'expected the quoted message itself among the thread messages',
    ).toBeDefined();
    expect(first!.reply_to).toBeNull();
  });

  /*
   * A second FINDING, in the same shape as the thread_members one above,
   * and worth pinning separately because it hits MESSAGE_COLUMNS' `profiles`
   * embed -- the sender's name on every bubble, not a members list. Posted
   * by a REAL second session (not the service-role client, which bypasses
   * RLS and would hide exactly this), then read back through the caller's
   * own session -- the only way to observe what RLS actually does, not what
   * a service-role query would suggest it does.
   *
   * The raw select still comes back with `profiles: null` -- that half of
   * the test is unchanged, because MESSAGE_COLUMNS itself was never the
   * fix. What changed is what happens next: fetchThreadMessages, called on
   * the same caller session against the same message, names the sender
   * anyway, because fetch_thread_messages (20260829080000) is security
   * definer and does not go through profiles' RLS at all.
   */
  it('the raw MESSAGE_COLUMNS embed still cannot name a co-member -- fetchThreadMessages does, through fetch_thread_messages', async () => {
    const otherClient = createClient(local.url, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: otherEmail,
    });
    expect(linkError, `generateLink for second session failed: ${linkError?.message}`).toBeNull();
    const { error: verifyError } = await otherClient.auth.verifyOtp({
      token_hash: link!.properties!.hashed_token,
      type: 'magiclink',
    });
    expect(verifyError, `signing in second session failed: ${verifyError?.message}`).toBeNull();

    // Posted as otherId, through a real RPC call on otherClient -- not
    // lib/messages.ts's postMessage, which is wired to the module-mocked
    // `supabase` singleton (userId's session) and cannot be pointed at a
    // second client.
    const { data: otherMessageId, error: postError } = await otherClient.rpc('post_message', {
      target_thread: groupThreadId,
      p_body: 'A message from the other member',
      p_announce: false,
      p_reply_to: null,
    });
    expect(postError, `post_message as the other member failed: ${postError?.message}`).toBeNull();
    await otherClient.auth.signOut();

    // Read back as the ORIGINAL caller (userId) -- the session this whole
    // describe block otherwise runs as.
    const { data, error } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', otherMessageId as string)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;
    expect(row.author_id).toBe(otherId);
    // Not `.toBe('Contract Other')`. The same profiles_select_own policy
    // that hid the co-member's name in thread_members (20260822180000) hides
    // it here too -- MESSAGE_COLUMNS' profiles embed is a plain select, so
    // it inherits the caller's own RLS, and a message from anyone but the
    // caller carries a sender with no name on a raw select.
    expect(row.profiles).toBeNull();

    // The fix: fetchThreadMessages, same caller session, same message --
    // named anyway. This is the cross-member proof the raw-select
    // assertion above cannot give, because fetch_thread_messages
    // re-resolves the sender itself rather than trusting an embed that
    // profiles' RLS will always null out for anyone but the caller.
    const messages = await fetchThreadMessages(groupThreadId);
    expect(messages).not.toBeNull();
    const otherMessage = messages!.find((m) => m.id === otherMessageId);
    expect(
      otherMessage,
      "expected the other member's message among the thread messages",
    ).toBeDefined();
    expect(otherMessage!.author_id).toBe(otherId);
    expect(otherMessage!.profiles?.display_name).toBe('Contract Other');
  });
});

describe.runIf(reachable || required)('greetings schema contract', () => {
  let admin: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    const signedIn = await signInFreshUser();
    admin = signedIn.admin;
    userId = signedIn.userId;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('refuses a write from a non-admin member', async () => {
    const { error } = await supabase.from('greetings').insert({ text: 'Hi {name}' });
    expect(error).not.toBeNull();
  });

  it('lets any signed-in member read the list', async () => {
    const { error } = await supabase.from('greetings').select(GREETING_COLUMNS);
    expect(error).toBeNull();
  });

  it('lets an admin write, and the write round-trips with the right columns', async () => {
    await admin.from('profiles').update({ is_admin: true }).eq('id', userId);
    const { data, error } = await supabase
      .from('greetings')
      .insert({ text: 'Contract test greeting {name}' })
      .select(GREETING_COLUMNS)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'text'].sort());
    expect(row.text).toBe('Contract test greeting {name}');
    await admin.from('greetings').delete().eq('id', row.id as string);
  });
});
