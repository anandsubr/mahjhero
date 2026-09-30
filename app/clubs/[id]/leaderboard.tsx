import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * The standalone leaderboard screen moved into the club hub's Ranks section
 * (club-hub phase 2, Task 9) -- its content lives in
 * components/ClubLeaderboard.tsx now, rendered by
 * app/clubs/[id]/(hub)/ranks.tsx under the hub's own header. This route
 * stays only so any old link (a bookmark, a push notification built before
 * this change) still lands somewhere real.
 */
export default function LeaderboardRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/clubs/${id}/ranks`} />;
}
