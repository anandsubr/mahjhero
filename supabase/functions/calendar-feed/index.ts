import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { buildCalendar, type FeedGame } from './ics.ts';

// Same local-stub reasoning as deliver-notifications/index.ts: a bare
// top-level `declare const Deno` in a *script* file leaks globally to
// every file `tsc` type-checks; inside a *module* file (this one, because
// of the imports above) it stays local. Repeated here rather than shared,
// on purpose -- see that file's own long comment for why.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

type EventRow = {
  id: string;
  club_id: string;
  title: string | null;
  game_mode: FeedGame['gameMode'];
  starts_at: string;
  ends_at: string;
  notes: string | null;
  club: { name: string } | null;
  venue: { name: string } | null;
};

type BookingRow = {
  status: 'confirmed' | 'waitlisted' | 'invited';
  event: EventRow | null;
};

const EVENT_COLUMNS =
  'id, club_id, title, game_mode, starts_at, ends_at, notes, club:clubs(name), venue:venues(name)';

const BOOKING_STATUS: Record<BookingRow['status'], FeedGame['status']> = {
  confirmed: 'going',
  waitlisted: 'waitlisted',
  invited: 'invited',
};

function toGame(e: EventRow, status: FeedGame['status']): FeedGame {
  return {
    eventId: e.id,
    clubId: e.club_id,
    title: e.title,
    gameMode: e.game_mode,
    clubName: e.club?.name ?? '',
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    venueName: e.venue?.name ?? '',
    notes: e.notes ?? '',
    status,
  };
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Public by design (`verify_jwt = false`): calendar apps subscribe to a URL
 * and can't sign in, so the per-member token in the query string is the
 * whole of the authentication. The service-role client below therefore
 * scopes every query to the token's owner by hand — RLS isn't in play.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const token = new URL(request.url).searchParams.get('token');
  if (!token) return text('Missing token', 400);

  try {
    const supabase = createClient(
      required('SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const appUrl = required('APP_URL');

    const { data: feed, error: feedError } = await supabase
      .from('calendar_feeds')
      .select('profile_id')
      .eq('token', token)
      .maybeSingle();
    if (feedError) throw feedError;
    if (!feed) return text('Not found', 404);
    const owner = feed.profile_id as string;

    const now = new Date();
    const from = new Date(now.getTime() - PAST_DAYS * DAY_MS).toISOString();
    const to = new Date(now.getTime() + FUTURE_DAYS * DAY_MS).toISOString();

    // Only clubs the owner still belongs to: leaving a club takes its games
    // off the calendar even if a booking row lingers.
    const { data: memberships, error: memberError } = await supabase
      .from('club_members')
      .select('club_id')
      .eq('profile_id', owner)
      .eq('status', 'active');
    if (memberError) throw memberError;
    const clubIds = (memberships ?? []).map((m) => m.club_id as string);

    const games = new Map<string, FeedGame>();

    if (clubIds.length > 0) {
      const [booked, hosted] = await Promise.all([
        supabase
          .from('bookings')
          .select(`status, event:events!inner(${EVENT_COLUMNS})`)
          .eq('profile_id', owner)
          .in('status', ['confirmed', 'waitlisted', 'invited'])
          .eq('event.status', 'published')
          .in('event.club_id', clubIds)
          .gte('event.starts_at', from)
          .lte('event.starts_at', to),
        supabase
          .from('events')
          .select(EVENT_COLUMNS)
          .eq('created_by', owner)
          .eq('status', 'published')
          .in('club_id', clubIds)
          .gte('starts_at', from)
          .lte('starts_at', to),
      ]);
      if (booked.error) throw booked.error;
      if (hosted.error) throw hosted.error;

      // Without a generated Database type, postgrest-js types these to-one
      // embeds as arrays; a single object is what comes back at runtime.
      for (const b of (booked.data ?? []) as unknown as BookingRow[]) {
        if (b.event) games.set(b.event.id, toGame(b.event, BOOKING_STATUS[b.status]));
      }
      // Second, so hosting wins over any booking the host also holds.
      for (const e of (hosted.data ?? []) as unknown as EventRow[]) {
        games.set(e.id, toGame(e, 'hosting'));
      }
    }

    const sorted = [...games.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    return new Response(buildCalendar(sorted, now, appUrl), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (cause) {
    console.error('calendar-feed failed', cause);
    return text('Could not build calendar', 500);
  }
});
