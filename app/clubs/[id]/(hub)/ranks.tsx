import { useRef } from 'react';
import ClubLeaderboard, { type ClubLeaderboardHandle } from '../../../../components/ClubLeaderboard';
import HubSection from '../../../../components/hub/HubSection';
import { useClubHub } from '../../../../components/hub/ClubHubContext';
import { useSession } from '../../../../lib/session';

/**
 * The club hub's Ranks section: the same all-time leaderboard
 * app/clubs/[id]/leaderboard.tsx used to draw under its own header (that
 * route now redirects here). Nothing about the ranking itself changed --
 * only the surrounding chrome, which is the hub header above this section
 * now.
 */
export default function RanksSection() {
  const { club } = useClubHub();
  const { session } = useSession();
  const leaderboardRef = useRef<ClubLeaderboardHandle>(null);

  return (
    <HubSection onRefresh={() => leaderboardRef.current?.reload() ?? Promise.resolve()}>
      <ClubLeaderboard ref={leaderboardRef} clubId={club.id} userId={session?.user.id} />
    </HubSection>
  );
}
