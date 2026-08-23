/**
 * The race the event lock exists to lose.
 *
 * pgTAP runs in a single session, so it can assert the RULES of seat
 * allocation but never that two people cannot take the same seat. This test
 * signs in two real users against the local stack and fires commit_booking
 * for the same one-seat table at the same moment — five times, against five
 * independent one-seat events, not once.
 *
 * WHY FIVE EVENTS, AND WHY A WARM-UP CALL FIRST: measured directly (see the
 * task report's fix-pass section), the FIRST commit_booking call either
 * racer's client makes on a cold connection — freshly signed in, no prior
 * request ever sent on it — carries enough incidental connection/auth/pool
 * warm-up latency to accidentally serialize what should be a genuine race,
 * roughly 1 run in 7. CI is always the cold case: every run starts a fresh
 * process with fresh clients, so that unreliable first call would be the
 * ONLY call that ever happens if the race ran only once here. Two things
 * close that gap:
 *
 *   1. beforeAll makes one throwaway authenticated call per racer client
 *      (a `select` against a table neither test cares about) before either
 *      client ever calls commit_booking for real, so the connection each
 *      one uses for the actual race is already warm.
 *   2. The race runs five times, against five separate one-seat events,
 *      instead of once. This is NOT because five independent races make an
 *      accidental serialization exponentially less likely — five cold-start
 *      runs of this same suite (see the task report's second fix-pass
 *      section) showed the races are not independent trials: races 1–4
 *      came back red in all five runs (20/20), while race 5 was masked in
 *      every single one of those runs (5/5), a pattern a per-race-chance
 *      model does not predict. Cause undetermined — plausible candidates
 *      include fetch/undici keep-alive connection reuse maturing over the
 *      sequence, or local Supabase connection-handling changing under a
 *      short burst of prior calls — but not chased down. The measured,
 *      load-bearing fact is narrower: the FIRST race alone detected the
 *      missing lock in all five cold trials, so racing at least once after
 *      the warm-up is what this suite actually relies on; the extra four
 *      races are redundancy against whatever is masking race 5, not
 *      insurance against independent bad luck on any given race.
 *
 * Requires the local Supabase stack. Reachability is probed once at module
 * scope (the same pattern lib/schema-contract.test.ts uses) and the whole
 * suite is gated with `describe.runIf(reachable || required)`, so an
 * unreachable stack is reported as SKIPPED — never as a silent pass that
 * counts toward the total. `npm test` runs this file without
 * REQUIRE_LOCAL_SUPABASE, so it must degrade to skipped, not green, when
 * Docker is not running; `npm run test:concurrency` sets
 * REQUIRE_LOCAL_SUPABASE=1, which turns an unreachable stack into a hard
 * failure instead.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_LOCAL_API_URL ?? 'http://127.0.0.1:54321';
const anonKey =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const serviceKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function stackIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Probed once, at module scope, before any describe/it runs — so
// `describe.runIf` below can gate the ENTIRE suite as skipped rather than
// having each `it` quietly return early and count as a pass. See
// lib/schema-contract.test.ts for the same pattern and the reasoning.
const reachable = await stackIsUp();
const required = process.env.REQUIRE_LOCAL_SUPABASE === '1';

if (!reachable && !required) {
  console.warn(
    `[booking-concurrency] Local Supabase stack not reachable at ${url} — ` +
      'skipping the seat-race suite. Run `npx supabase start` to cover it, ' +
      'or `npm run test:concurrency` to make this fatal.',
  );
}

const PASSWORD = 'seat-race-password-1';
const RACE_COUNT = 5;

async function makeUser(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signIn.error) throw signIn.error;
  return { email, id: data.user!.id, client };
}

describe.runIf(reachable || required)('two members racing for the last seat', () => {
  let admin: SupabaseClient;
  let clubId = '';
  let venueId = '';
  const players: { email: string; id: string; client: SupabaseClient }[] = [];
  // Five independent one-seat tables, one per race, so a masked race on any
  // single run does not need a fresh database to retry against.
  const races: { eventId: string; tableId: string }[] = [];

  beforeAll(async () => {
    expect(
      reachable,
      `Local Supabase stack not reachable at ${url}. Run \`npx supabase start\`.`,
    ).toBe(true);

    admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const stamp = Date.now();
    for (const name of ['racer-a', 'racer-b', 'racer-host']) {
      players.push(await makeUser(admin, `${name}-${stamp}@example.com`));
    }
    const [racerA, racerB, host] = players;

    // Warm-up: one throwaway authenticated call per racer client, made
    // AFTER sign-in and BEFORE either client ever calls commit_booking.
    // This is the direct fix for the named cause of the cold-start false
    // green (see the file docblock): whatever connection/auth/pool setup
    // happens on a client's first real request happens here, on a query
    // whose data nobody needs — but its `.error` is still checked. If this
    // call itself failed (an auth or RLS regression, say), silently
    // ignoring that would leave the connection cold and quietly regress
    // the race to the undetected cold case this warm-up exists to close.
    const warmA = await racerA!.client.from('clubs').select('id').limit(1);
    if (warmA.error) throw new Error(`racer A warm-up failed: ${warmA.error.message}`);
    const warmB = await racerB!.client.from('clubs').select('id').limit(1);
    if (warmB.error) throw new Error(`racer B warm-up failed: ${warmB.error.message}`);

    const club = await admin
      .from('clubs')
      .insert({
        name: `Race ${stamp}`,
        slug: `race-${stamp}`,
        timezone: 'America/New_York',
        created_by: host!.id,
      })
      .select('id')
      .single();
    if (club.error) throw club.error;
    clubId = club.data.id;

    const membership = await admin.from('club_members').insert(
      players.map((p) => ({
        club_id: clubId,
        profile_id: p.id,
        role: p.id === host!.id ? 'host' : 'member',
      })),
    );
    if (membership.error) throw membership.error;

    const venue = await admin
      .from('venues')
      .insert({ name: `Hall ${stamp}`, added_by_club_id: clubId, created_by: host!.id })
      .select('id')
      .single();
    if (venue.error) throw venue.error;
    venueId = venue.data.id;

    for (let i = 0; i < RACE_COUNT; i++) {
      const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000 + i * 3600 * 1000).toISOString();
      const ends = new Date(
        Date.now() + 7 * 24 * 3600 * 1000 + i * 3600 * 1000 + 3 * 3600 * 1000,
      ).toISOString();
      const event = await admin
        .from('events')
        .insert({
          club_id: clubId,
          title: `Race game ${i + 1}`,
          venue_id: venueId,
          starts_at: starts,
          ends_at: ends,
          created_by: host!.id,
        })
        .select('id')
        .single();
      if (event.error) throw event.error;

      // One table, ONE seat. Both racers want it.
      const table = await admin
        .from('event_tables')
        .insert({
          event_id: event.data.id,
          club_id: clubId,
          label: 'Table 1',
          capacity: 1,
          position: 1,
        })
        .select('id')
        .single();
      if (table.error) throw table.error;

      races.push({ eventId: event.data.id, tableId: table.data.id });
    }
  });

  afterAll(async () => {
    if (!reachable) return;
    // Guarded on a non-empty id and structured so one step's failure does
    // not skip the rest: a partial beforeAll failure (e.g. users created
    // but the club insert throwing) must not leak the users just because
    // clubId stayed '' and a later step errored on it. Errors are
    // collected rather than swallowed, so a broken cleanup still fails
    // loudly here instead of leaking rows silently into the next run.
    const errors: string[] = [];

    // events.club_id cascades to event_tables, bookings, booking_groups,
    // and notification_outbox (see 20260825000000_create_bookings.sql), so
    // deleting each event is enough to take its table and any bookings
    // with it.
    for (const { eventId } of races) {
      const { error } = await admin.from('events').delete().eq('id', eventId);
      if (error) errors.push(`event ${eventId}: ${error.message}`);
    }

    // venues.added_by_club_id has no ON DELETE CASCADE (by design: a venue
    // can outlive the club that first typed it in), so deleting the club
    // before its own venue throws a foreign-key violation. Venue first.
    if (venueId) {
      const { error } = await admin.from('venues').delete().eq('id', venueId);
      if (error) errors.push(`venue ${venueId}: ${error.message}`);
    }

    if (clubId) {
      const { error } = await admin.from('clubs').delete().eq('id', clubId);
      if (error) errors.push(`club ${clubId}: ${error.message}`);
    }

    for (const p of players) {
      if (!p.id) continue;
      const { error } = await admin.auth.admin.deleteUser(p.id);
      if (error) errors.push(`user ${p.email}: ${error.message}`);
    }

    if (errors.length > 0) {
      throw new Error(`afterAll cleanup failed:\n${errors.join('\n')}`);
    }
  });

  it.each(Array.from({ length: RACE_COUNT }, (_, i) => i + 1))(
    'gives the seat to exactly one racer (race %i)',
    async (raceNumber) => {
      const { eventId, tableId } = races[raceNumber - 1]!;

      const [a, b] = await Promise.all([
        players[0]!.client.rpc('commit_booking', {
          target_event: eventId,
          players: [players[0]!.id],
          preferred: tableId,
          allow_split: true,
        }),
        players[1]!.client.rpc('commit_booking', {
          target_event: eventId,
          players: [players[1]!.id],
          preferred: tableId,
          allow_split: true,
        }),
      ]);

      expect(a.error).toBeNull();
      expect(b.error).toBeNull();

      const outcomes = [a.data?.outcome, b.data?.outcome].sort();
      expect(outcomes).toEqual(['seated', 'waitlisted']);

      const seated = await admin
        .from('bookings')
        .select('id')
        .eq('event_id', eventId)
        .eq('status', 'confirmed');
      expect(seated.data?.length).toBe(1);
    },
  );
});
