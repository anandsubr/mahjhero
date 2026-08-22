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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'];
const NOTIFY_CHANNELS = ['push', 'email', 'both'];

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
  });

  afterAll(async () => {
    await supabase.auth.signOut();
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it('exposes every column lib/events.ts names on events', async () => {
    const { error } = await supabase
      .from('events')
      .select(
        'id, club_id, series_id, title, venue_id, notes, starts_at, ' +
          'ends_at, status, occurrence_date, overrides',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/events.ts names on event_series, including ended_at', async () => {
    // ended_at is the fact the brief's snapshot of the schema predates: the
    // host STOPPED the series, distinct from ends_on (the host's PLAN to
    // stop repeating after a date). Task 15's edit screen needs both, so
    // both belong in the contract.
    const { error } = await supabase
      .from('event_series')
      .select(
        'id, club_id, title, venue_id, notes, frequency, weekday, ' +
          'nth_week, start_time, duration_minutes, table_count, ' +
          'starts_on, ends_on, ended_at',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/events.ts names on event_tables', async () => {
    const { error } = await supabase
      .from('event_tables')
      .select('id, label, skill_tier, capacity, position')
      .limit(0);
    expect(error).toBeNull();
  });

  it('exposes every column lib/venues.ts names on venues', async () => {
    const { error } = await supabase
      .from('venues')
      .select(
        'id, name, address_line, locality, region, postal_code, visibility',
      )
      .limit(0);
    expect(error).toBeNull();
  });

  it('embeds the venue name the event list renders', async () => {
    const { error } = await supabase
      .from('events')
      .select('id, venues(name), event_tables(id)')
      .limit(0);
    expect(error).toBeNull();
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
 * Deliberately anonymous — no sign-in here. Every function below has EXECUTE
 * revoked from anon and granted only to authenticated (see e.g. 20260822192000's
 * closing grants), so every one of these calls is expected to fail. That is
 * fine and is the point: the only thing under test is the SHAPE of that
 * failure, not whether it succeeds. PostgREST resolves the function (and
 * therefore checks the argument names) before it evaluates whether the
 * caller may execute it, so an anonymous 42501 ("permission denied") already
 * proves the names matched; a PGRST202 proves they did not.
 *
 * Verified by mutation: renaming target_club to target_klub in the
 * search_venues case below turns that one test red with a PGRST202 failure
 * message naming search_venues, and every other case stays green. See the
 * task report for the full mutation log.
 */
describe.runIf(reachable || required)(
  'venues and events RPC argument-name contract',
  () => {
    const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';

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

    // Each pair is a function name and the EXACT argument object the
    // corresponding lib/venues.ts or lib/events.ts function passes to
    // `supabase.rpc(...)` — same keys, same casing, nothing added or
    // dropped. Values are shaped to satisfy each parameter's type (uuid,
    // text, timestamptz, time, date, boolean, int) so a resolved call fails
    // on authorization or business logic, never on a malformed literal.
    const rpcCalls: Array<[string, Record<string, unknown>]> = [
      // lib/venues.ts
      ['search_venues', { target_club: DUMMY_UUID, q: 'hall' }],
      [
        'create_venue',
        {
          venue_name: 'Contract Test Hall',
          address_line: '1 Main St',
          locality: 'Springfield',
          region: 'IL',
          postal_code: '62701',
          target_club: DUMMY_UUID,
          share_publicly: false,
        },
      ],
      [
        'update_venue',
        {
          target_venue: DUMMY_UUID,
          venue_name: 'Renamed Hall',
          address_line: '2 Main St',
          locality: 'Springfield',
          region: 'IL',
          postal_code: '62701',
        },
      ],
      ['archive_venue', { target_venue: DUMMY_UUID }],
      // lib/events.ts
      [
        'create_event',
        {
          target_club: DUMMY_UUID,
          event_title: 'Tuesday Mahjong',
          target_venue: DUMMY_UUID,
          event_notes: 'bring snacks',
          event_starts: '2027-09-07T23:00:00Z',
          event_ends: '2027-09-08T02:00:00Z',
          table_count: 2,
        },
      ],
      [
        'update_event',
        {
          target_event: DUMMY_UUID,
          new_title: 'Renamed game',
          new_venue_id: DUMMY_UUID,
          new_notes: 'updated notes',
          new_starts_at: '2027-09-07T23:00:00Z',
          new_ends_at: '2027-09-08T02:00:00Z',
        },
      ],
      ['cancel_event', { target_event: DUMMY_UUID }],
      ['reset_event_to_series', { target_event: DUMMY_UUID }],
      ['add_event_table', { target_event: DUMMY_UUID }],
      [
        'update_event_table',
        {
          target_table: DUMMY_UUID,
          new_label: 'Table 2',
          new_tier: 'mixed',
        },
      ],
      ['remove_event_table', { target_table: DUMMY_UUID }],
      [
        'create_event_series',
        {
          target_club: DUMMY_UUID,
          series_title: 'Weekly game',
          target_venue: DUMMY_UUID,
          series_notes: '',
          freq: 'weekly',
          weekday: 2,
          nth_week: null,
          start_time: '19:00:00',
          duration_minutes: 180,
          table_count: 1,
          starts_on: '2027-01-01',
          ends_on: null,
        },
      ],
      [
        'update_event_series',
        {
          target_series: DUMMY_UUID,
          new_title: 'Weekly game v2',
          new_venue_id: DUMMY_UUID,
          new_notes: 'updated',
          new_start_time: '19:30:00',
          new_duration: 150,
          new_table_count: 2,
          new_ends_on: '2027-12-31',
          include_overridden: false,
        },
      ],
      ['end_event_series', { target_series: DUMMY_UUID, cancel_future: true }],
    ];

    it.each(rpcCalls)('resolves %s by its argument names', async (fn, args) => {
      const { error } = await supabase.rpc(fn, args);

      expect(
        error,
        `${fn} unexpectedly succeeded for an anonymous, unauthorized caller — ` +
          'expected a permission or validation error instead.',
      ).not.toBeNull();

      expect(
        error?.code,
        `${fn} returned PGRST202 ("Could not find the function ${fn} in the ` +
          'schema cache") — the argument names this test (mirroring the ' +
          'lib/ call site) sent do not match the deployed function\'s ' +
          `parameters. Postgres message: ${error?.message}`,
      ).not.toBe('PGRST202');
    });
  },
);
