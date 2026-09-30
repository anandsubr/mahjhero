import type { GameMode } from './clubs';
import type { SeatingMode } from './events';
import { supabase } from './supabase';

/**
 * 'not' and 'invited' are only produced by the club Games section
 * (phase 2), never by my_games.
 */
export type MyStatus = 'going' | 'waitlisted' | 'hosting' | 'invited' | 'not';

/** One game row, shaped for components/GameRow. */
export type MyGame = {
  eventId: string;
  clubId: string;
  clubName: string;
  title: string | null;
  gameMode: GameMode;
  seatingMode: SeatingMode;
  startsAt: string;
  /** The club's timezone — every date and time on the row is shown in it. */
  timezone: string;
  venueName: string;
  seatsTaken: number;
  /** null = uncapped (open seating with no headcount). */
  capacity: number | null;
  myStatus: MyStatus;
  waitlistPosition: number | null;
  tableLabel: string | null;
  notes?: string;
};

type MyGameRow = {
  event_id: string;
  club_id: string;
  club_name: string;
  title: string | null;
  game_mode: GameMode;
  seating_mode: SeatingMode;
  starts_at: string;
  club_timezone: string;
  venue_name: string;
  seats_taken: number;
  capacity: number;
  capped: boolean;
  my_status: 'going' | 'waitlisted' | 'hosting';
  waitlist_position: number | null;
  table_label: string | null;
};

export async function fetchMyGames(from: Date, to: Date): Promise<MyGame[] | null> {
  try {
    const { data, error } = await supabase.rpc('my_games', {
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
    });
    if (error) {
      console.error('fetchMyGames failed', error);
      return null;
    }
    return ((data ?? []) as MyGameRow[]).map((r) => ({
      eventId: r.event_id,
      clubId: r.club_id,
      clubName: r.club_name,
      title: r.title,
      gameMode: r.game_mode,
      seatingMode: r.seating_mode,
      startsAt: r.starts_at,
      timezone: r.club_timezone,
      venueName: r.venue_name,
      seatsTaken: r.seats_taken,
      capacity: r.capped ? r.capacity : null,
      myStatus: r.my_status,
      waitlistPosition: r.waitlist_position,
      tableLabel: r.table_label,
    }));
  } catch (cause) {
    console.error('fetchMyGames failed', cause);
    return null;
  }
}

type ClubGameRow = MyGameRow & { my_status: MyStatus; notes: string | null };

/**
 * One club's games for the club hub's Games section — same row shape as
 * `fetchMyGames` plus `notes`, and a `myStatus` that can also be
 * `'invited'` or `'not'` (the caller has no part in that game at all).
 */
export async function fetchClubGames(
  clubId: string,
  from: Date,
  to: Date,
): Promise<MyGame[] | null> {
  try {
    const { data, error } = await supabase.rpc('club_games', {
      target_club: clubId,
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
    });
    if (error) {
      console.error('fetchClubGames failed', error);
      return null;
    }
    return ((data ?? []) as ClubGameRow[]).map((r) => ({
      eventId: r.event_id,
      clubId: r.club_id,
      clubName: r.club_name,
      title: r.title,
      gameMode: r.game_mode,
      seatingMode: r.seating_mode,
      startsAt: r.starts_at,
      timezone: r.club_timezone,
      venueName: r.venue_name,
      seatsTaken: r.seats_taken,
      capacity: r.capped ? r.capacity : null,
      myStatus: r.my_status,
      waitlistPosition: r.waitlist_position,
      tableLabel: r.table_label,
      notes: r.notes ?? undefined,
    }));
  } catch (cause) {
    console.error('fetchClubGames failed', cause);
    return null;
  }
}

/** Club id → ISO start of that club's next published game. Clubs with none are absent. */
export async function fetchClubsNextGame(): Promise<Record<string, string> | null> {
  try {
    const { data, error } = await supabase.rpc('my_clubs_next_game');
    if (error) {
      console.error('fetchClubsNextGame failed', error);
      return null;
    }
    return Object.fromEntries(
      ((data ?? []) as { club_id: string; next_starts_at: string }[]).map((r) => [
        r.club_id,
        r.next_starts_at,
      ]),
    );
  } catch (cause) {
    console.error('fetchClubsNextGame failed', cause);
    return null;
  }
}
