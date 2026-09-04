import { supabase } from './supabase';

export type LeaderboardEntry = {
  profile_id: string;
  display_name: string;
  total_points: number;
  rounds_won: number;
};

/**
 * All-time, ranked by total points then rounds won -- exactly the order
 * `club_leaderboard` (supabase/migrations/20260904000000) already returns,
 * so this never re-sorts client-side. Never rejects, the same "never
 * rejects" contract every other lib/*.ts fetch follows.
 */
export async function fetchClubLeaderboard(
  clubId: string,
): Promise<LeaderboardEntry[] | null> {
  try {
    const { data, error } = await supabase.rpc('club_leaderboard', {
      target_club: clubId,
    });
    if (error) {
      console.error('fetchClubLeaderboard failed', error);
      return null;
    }
    return (data ?? []) as LeaderboardEntry[];
  } catch (cause) {
    console.error('fetchClubLeaderboard failed', cause);
    return null;
  }
}
