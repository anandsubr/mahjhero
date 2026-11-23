/**
 * Creates or refreshes the App Store review account and a lived-in demo club.
 *
 *   SEED_SUPABASE_URL=... SEED_SERVICE_ROLE_KEY=... REVIEW_PASSWORD=... \
 *     npx tsx scripts/seed-review-account.ts
 *
 * Idempotent: every row is looked up by a fixed name or email before it is
 * created, so running it twice changes nothing the second time (except that
 * the review account's password is reset to REVIEW_PASSWORD, and the demo
 * members get a fresh random password they never use).
 *
 * Data is created by calling the app's own RPCs as the relevant user (the
 * service key is only used to mint those sessions and to read back ids), so
 * clubs, tables, seats, waitlists and threads obey the app's invariants.
 *
 * SEED_CONFIRM_HOST must equal the host of SEED_SUPABASE_URL (e.g. 127.0.0.1:54321).
 *
 * Games are keyed by title and their dates are relative to the FIRST run.
 * Re-seeding months later does not move them; the old games must be removed
 * first (then they are recreated relative to today).
 *
 * Never commit the service-role key or the password; both come from the
 * environment and are never printed.
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STATIC_GUIDE_KEYS } from '../lib/guide-keys';

const REQUIRED = ['SEED_SUPABASE_URL', 'SEED_SERVICE_ROLE_KEY', 'REVIEW_PASSWORD'] as const;
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
const SUPABASE_URL = process.env.SEED_SUPABASE_URL as string;
const SERVICE_KEY = process.env.SEED_SERVICE_ROLE_KEY as string;
const REVIEW_PASSWORD = process.env.REVIEW_PASSWORD as string;

// Deliberate guard: the operator must restate the target host, so a stale
// SEED_SUPABASE_URL in a shell cannot silently seed the wrong project.
let seedHost: string;
try {
  seedHost = new globalThis.URL(SUPABASE_URL).host;
} catch {
  console.error('SEED_SUPABASE_URL is not a valid URL.');
  process.exit(1);
}
console.log(`Seeding ${seedHost}`);
if (process.env.SEED_CONFIRM_HOST !== seedHost) {
  console.error(
    `Refusing to run: set SEED_CONFIRM_HOST=${seedHost} to confirm this is the intended target.`,
  );
  process.exit(1);
}

const REVIEW_EMAIL = 'review@mahjhero.com';
const CLUB_NAME = 'Willow Creek Mahjong (Demo)';
const CLUB_TZ = 'America/New_York';
const VENUE_NAME = 'Willow Creek Community Center';
const GROUP_TITLE = 'Saturday carpool';

const DEMO = [
  { email: 'demo1@mahjhero.com', name: 'Margaret Chen', skill: 'advanced' },
  { email: 'demo2@mahjhero.com', name: 'Linda Okafor', skill: 'intermediate' },
  { email: 'demo3@mahjhero.com', name: 'Susan Patel', skill: 'intermediate' },
  { email: 'demo4@mahjhero.com', name: 'Helen Rosen', skill: 'beginner' },
  { email: 'demo5@mahjhero.com', name: 'Barbara Nguyen', skill: 'advanced' },
] as const;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(what: string, error: unknown): never {
  const message = (error as { message?: string } | null)?.message ?? String(error);
  console.error(`${what} failed: ${message}`);
  process.exit(1);
}

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail('listUsers', error);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Creates the user if absent, otherwise resets the password. Returns the id. */
async function ensureUser(email: string, password: string, name: string): Promise<string> {
  const existing = await findUserId(email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, {
      password,
      email_confirm: true,
    });
    if (error) fail(`update ${email}`, error);
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) fail(`create ${email}`, error);
  return data.user.id;
}

async function ensureProfile(id: string, name: string, skill: string, extra = {}) {
  const { error } = await admin
    .from('profiles')
    .upsert({ id, display_name: name, skill_level: skill, ...extra }, { onConflict: 'id' });
  if (error) fail(`profile ${name}`, error);
}

/** A client acting as this user, so auth.uid() is set inside the RPCs. */
async function actingAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail(`sign in ${email}`, error);
  return client;
}

/** 'YYYY-MM-DD' for today + n days, as the club's wall calendar reads it. */
function clubDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) fail(`rpc ${fn}`, error);
  return data as T;
}

async function main() {
  // --- people -------------------------------------------------------------
  const reviewerId = await ensureUser(REVIEW_EMAIL, REVIEW_PASSWORD, 'App Review');
  await ensureProfile(reviewerId, 'App Review', 'intermediate', {
    // Dismiss first-run tips so the reviewer lands on a clean Home.
    dismissed_guides: [...STATIC_GUIDE_KEYS],
  });

  const demoPassword = randomBytes(24).toString('hex');
  const demoIds: string[] = [];
  for (const d of DEMO) {
    const id = await ensureUser(d.email, demoPassword, d.name);
    await ensureProfile(id, d.name, d.skill);
    demoIds.push(id);
  }
  const [host, linda, susan, helen, barbara] = DEMO.map((d) => d.email);

  const hostClient = await actingAs(host, demoPassword);
  const clients: Record<string, SupabaseClient> = {
    [host]: hostClient,
    [linda]: await actingAs(linda, demoPassword),
    [susan]: await actingAs(susan, demoPassword),
    [helen]: await actingAs(helen, demoPassword),
    [barbara]: await actingAs(barbara, demoPassword),
    [REVIEW_EMAIL]: await actingAs(REVIEW_EMAIL, REVIEW_PASSWORD),
  };

  // --- club ---------------------------------------------------------------
  const { data: clubRow, error: clubErr } = await admin
    .from('clubs')
    .select('id, created_by')
    .eq('name', CLUB_NAME)
    .maybeSingle();
  if (clubErr) fail('look up club', clubErr);
  if (clubRow && clubRow.created_by !== demoIds[0]) {
    console.error(
      `A club named "${CLUB_NAME}" already exists with a different creator; refusing to touch it.`,
    );
    process.exit(1);
  }
  let clubId = clubRow?.id as string | undefined;
  if (!clubId) {
    clubId = await rpc<string>(hostClient, 'create_club', {
      club_name: CLUB_NAME,
      club_rhythm: 'Thursday and Saturday afternoons',
      club_code: null,
    });
  }
  const { data: codeRow, error: codeErr } = await admin
    .from('clubs')
    .select('code')
    .eq('id', clubId)
    .single();
  if (codeErr) fail('read club code', codeErr);
  const clubCode = codeRow.code as string;

  // Members join the way a real member does: by the club code.
  const { data: members, error: memErr } = await admin
    .from('club_members')
    .select('profile_id, status')
    .eq('club_id', clubId);
  if (memErr) fail('read members', memErr);
  const active = new Set(
    (members ?? []).filter((m) => m.status === 'active').map((m) => m.profile_id as string),
  );
  for (const email of [linda, susan, helen, barbara, REVIEW_EMAIL]) {
    const id = email === REVIEW_EMAIL ? reviewerId : demoIds[DEMO.findIndex((d) => d.email === email)];
    if (active.has(id)) continue;
    await rpc(clients[email], 'join_club_by_code', { club_code: clubCode });
  }

  // --- venue --------------------------------------------------------------
  const { data: venueRow, error: venueErr } = await admin
    .from('venues')
    .select('id')
    .eq('added_by_club_id', clubId)
    .eq('name', VENUE_NAME)
    .maybeSingle();
  if (venueErr) fail('look up venue', venueErr);
  const venueId =
    (venueRow?.id as string | undefined) ??
    (await rpc<string>(hostClient, 'create_venue', {
      venue_name: VENUE_NAME,
      address_line: '120 Willow Creek Road',
      locality: 'Princeton',
      region: 'NJ',
      postal_code: '08540',
      target_club: clubId,
      share_publicly: false,
    }));

  // --- games --------------------------------------------------------------
  const games = [
    { title: 'Thursday Afternoon Mahjong', days: 7, time: '13:00', tables: 1, notes: 'Bring your own tile set if you like. Tea and snacks provided.' },
    { title: 'Saturday Social Game', days: 10, time: '14:00', tables: 2, notes: 'All levels welcome. We rotate tables after each round.' },
    { title: 'Evening Beginners Night', days: 14, time: '18:30', tables: 2, notes: 'A relaxed night for newer players. Card provided.' },
  ];
  const eventIds: string[] = [];
  for (const g of games) {
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id')
      .eq('club_id', clubId)
      .eq('title', g.title)
      .eq('status', 'published')
      .maybeSingle();
    if (evErr) fail(`look up ${g.title}`, evErr);
    eventIds.push(
      (ev?.id as string | undefined) ??
        (await rpc<string>(hostClient, 'create_event', {
          target_club: clubId,
          event_title: g.title,
          target_venue: venueId,
          event_notes: g.notes,
          event_date: clubDate(g.days),
          start_time: g.time,
          duration_minutes: 180,
          table_count: g.tables,
          check_in: false,
          fee_cents: 0,
          min_spend_cents: 0,
          event_game_mode: null,
          event_seating_mode: 'assigned_tables',
          capacity_limit: null,
        })),
    );
  }

  async function book(eventId: string, email: string, id: string) {
    const { data, error } = await admin
      .from('bookings')
      .select('id')
      .eq('event_id', eventId)
      .eq('profile_id', id)
      .in('status', ['confirmed', 'waitlisted']);
    if (error) fail('look up booking', error);
    if ((data ?? []).length > 0) return;
    await rpc(clients[email], 'commit_booking', {
      target_event: eventId,
      players: [id],
      preferred: null,
      allow_split: true,
    });
  }
  const idOf = (email: string) => demoIds[DEMO.findIndex((d) => d.email === email)];

  // Game 1: one table of four, full, with a waitlisted fifth.
  for (const e of [host, linda, susan, helen, barbara]) await book(eventIds[0], e, idOf(e));
  // Game 2: the reviewer is in.
  for (const e of [host, linda]) await book(eventIds[1], e, idOf(e));
  await book(eventIds[1], REVIEW_EMAIL, reviewerId);
  // Game 3: a few signed up.
  for (const e of [susan, barbara]) await book(eventIds[2], e, idOf(e));

  // --- board post with a reply -------------------------------------------
  const thread = { id: await rpc<string>(clients[host], 'open_thread_for_club', { target_club: clubId }) };
  const POST = 'Welcome to Willow Creek Mahjong! Thursday games start at 1pm sharp. Tell us if you are bringing a set.';
  const { data: post, error: postErr } = await admin
    .from('messages')
    .select('id')
    .eq('thread_id', thread.id)
    .is('root_id', null)
    .eq('body', POST)
    .maybeSingle();
  if (postErr) fail('look up board post', postErr);
  let postId = post?.id as string | undefined;
  if (!postId) {
    postId = await rpc<string>(clients[host], 'post_message', {
      target_thread: thread.id,
      p_body: POST,
      p_announce: false,
      p_reply_to: null,
      p_root: null,
      p_attachments: null,
    });
  }
  const REPLY = 'Thank you! I will bring my set and some almond cookies.';
  const { data: reply, error: replyErr } = await admin
    .from('messages')
    .select('id')
    .eq('root_id', postId)
    .eq('body', REPLY)
    .maybeSingle();
  if (replyErr) fail('look up reply', replyErr);
  if (!reply) {
    await rpc(clients[linda], 'post_message', {
      target_thread: thread.id,
      p_body: REPLY,
      p_announce: false,
      p_reply_to: postId,
      p_root: postId,
      p_attachments: null,
    });
  }

  // --- group thread with the reviewer ------------------------------------
  const { data: tmRows, error: tmErr } = await admin
    .from('thread_members')
    .select('thread_id')
    .eq('profile_id', reviewerId);
  if (tmErr) fail('look up group threads', tmErr);
  const { data: groupRow, error: groupErr } = await admin
    .from('message_threads')
    .select('id')
    .eq('title', GROUP_TITLE)
    .is('club_id', null)
    .in('id', (tmRows ?? []).map((r) => r.thread_id as string))
    .maybeSingle();
  if (groupErr) fail('look up group thread', groupErr);
  let groupId = groupRow?.id as string | undefined;
  if (!groupId) {
    groupId = await rpc<string>(clients[linda], 'create_group_thread', {
      p_title: GROUP_TITLE,
      p_members: [reviewerId, idOf(susan)],
    });
  }
  const { count, error: countErr } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', groupId);
  if (countErr) fail('count group messages', countErr);
  if ((count ?? 0) === 0) {
    await rpc(clients[linda], 'post_message', {
      target_thread: groupId,
      p_body: 'Anyone want to carpool to Saturday\'s game? I can pick up two people.',
    });
    await rpc(clients[susan], 'post_message', {
      target_thread: groupId,
      p_body: 'Yes please! I will meet you at the corner of Maple at 1:15.',
    });
  }

  console.log(`Seeded ${REVIEW_EMAIL} and "${CLUB_NAME}".`);
  console.log(`Club id: ${clubId}`);
}

void main().catch((cause) => fail('seed', cause));
