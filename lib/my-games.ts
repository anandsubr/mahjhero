import type { GameMode } from './clubs';
import type { SeatingMode } from './events';
import { supabase } from './supabase';

/** 'not' is only produced by the club Games section (phase 2), never by my_games. */
export type MyStatus = 'going' | 'waitlisted' | 'hosting' | 'not';

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
