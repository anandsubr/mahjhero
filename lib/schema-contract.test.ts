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
    const { error: seedError } = await supabase
      .from('profiles')
      .update(SEEDED)
      .eq('id', userId);
    expect(seedError, `seeding the profile failed: ${seedError?.message}`).toBeNull();
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
