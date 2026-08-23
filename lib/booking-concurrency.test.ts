/**
 * The race the event lock exists to lose.
 *
 * pgTAP runs in a single session, so it can assert the RULES of seat
 * allocation but never that two people cannot take the same seat. This
 * test signs in two real users against the local stack and fires
 * commit_booking for the last remaining seat at the same moment.
 *
 * Verified by mutation: removing `perform 1 from public.events where
 * id = target_event for update` from commit_booking turns this suite red
 * and leaves the table with five bookings in four seats.
 *
 * Requires the local Supabase stack. Skips with a warning without it, so
 * `npm test` stays runnable; `npm run test:concurrency` makes an
 * unreachable stack a hard failure.
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

const required = process.env.REQUIRE_LOCAL_SUPABASE === '1';

let admin: SupabaseClient;
let reachable = false;
let clubId = '';
let eventId = '';
let tableId = '';
const players: { email: string; id: string; client: SupabaseClient }[] = [];

const PASSWORD = 'seat-race-password-1';

async function makeUser(email: string) {
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

beforeAll(async () => {
  admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const probe = await admin.from('clubs').select('id').limit(1);
    reachable = !probe.error;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    if (required) throw new Error('local Supabase stack is not reachable');
    console.warn('skipping: local Supabase stack not reachable');
    return;
  }

  const stamp = Date.now();
  for (const name of ['racer-a', 'racer-b', 'racer-host']) {
    players.push(await makeUser(`${name}-${stamp}@example.com`));
  }
  const host = players[2];

  const club = await admin
    .from('clubs')
    .insert({
      name: `Race ${stamp}`,
      slug: `race-${stamp}`,
      timezone: 'America/New_York',
      created_by: host.id,
    })
    .select('id')
    .single();
  if (club.error) throw club.error;
  clubId = club.data.id;

  await admin.from('club_members').insert(
    players.map((p) => ({
      club_id: clubId,
      profile_id: p.id,
      role: p.id === host.id ? 'host' : 'member',
    })),
  );

  const venue = await admin
    .from('venues')
    .insert({ name: `Hall ${stamp}`, added_by_club_id: clubId, created_by: host.id })
    .select('id')
    .single();
  if (venue.error) throw venue.error;

  const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const ends = new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3 * 3600 * 1000).toISOString();
  const event = await admin
    .from('events')
    .insert({
      club_id: clubId,
      title: 'Race game',
      venue_id: venue.data.id,
      starts_at: starts,
      ends_at: ends,
      created_by: host.id,
    })
    .select('id')
    .single();
  if (event.error) throw event.error;
  eventId = event.data.id;

  // One table, ONE seat. Both racers want it.
  const table = await admin
    .from('event_tables')
    .insert({
      event_id: eventId,
      club_id: clubId,
      label: 'Table 1',
      capacity: 1,
      position: 1,
    })
    .select('id')
    .single();
  if (table.error) throw table.error;
  tableId = table.data.id;
});

afterAll(async () => {
  if (!reachable) return;
  // venues.added_by_club_id has no ON DELETE CASCADE (by design: a venue
  // can outlive the club that first typed it in), so deleting the club
  // before its own venue throws a foreign-key violation and — because nobody
  // was checking these results — leaves the club, venue, event and table
  // behind on every run. Delete the venue first, and check for errors
  // instead of swallowing them, so a broken cleanup fails loudly here
  // instead of leaking rows into the next run.
  //
  // Order matters: events.venue_id also has no ON DELETE CASCADE, so the
  // venue can't go until the event that points at it is gone first. The
  // event itself cascades away via events.club_id (ON DELETE CASCADE), but
  // only once we delete it explicitly here rather than relying on the club
  // delete, which is blocked by the venue in the other direction.
  const eventDelete = await admin.from('events').delete().eq('id', eventId);
  if (eventDelete.error) throw eventDelete.error;

  const venueDelete = await admin
    .from('venues')
    .delete()
    .eq('added_by_club_id', clubId);
  if (venueDelete.error) throw venueDelete.error;

  const clubDelete = await admin.from('clubs').delete().eq('id', clubId);
  if (clubDelete.error) throw clubDelete.error;

  for (const p of players) {
    const { error } = await admin.auth.admin.deleteUser(p.id);
    if (error) throw error;
  }
});

describe('two members racing for the last seat', () => {
  it('gives it to exactly one of them', async () => {
    if (!reachable) return;

    const [a, b] = await Promise.all([
      players[0].client.rpc('commit_booking', {
        target_event: eventId,
        players: [players[0].id],
        preferred: tableId,
        allow_split: true,
      }),
      players[1].client.rpc('commit_booking', {
        target_event: eventId,
        players: [players[1].id],
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
  });
});
