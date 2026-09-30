import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import ClubMembers, { type ClubMembersHandle } from '../../../../components/ClubMembers';
import HubSection from '../../../../components/hub/HubSection';
import { useClubHub } from '../../../../components/hub/ClubHubContext';

/**
 * The club hub's Members section: the roster, pending invites, and (for a
 * host or co-organizer) the invite-by-email form ClubMembers renders --
 * moved out of app/clubs/[id]/legacy.tsx (club-hub phase 2, Task 10). This
 * route owns only what a route must: reading `?imported=N` off the URL
 * (app/clubs/[id]/import.tsx redirects here after a successful import) and
 * wiring HubSection's pull-to-refresh to ClubMembers' own reload.
 */
export default function MembersSection() {
  const { club, role } = useClubHub();
  const { imported } = useLocalSearchParams<{ imported?: string }>();
  const membersRef = useRef<ClubMembersHandle>(null);

  // Parsed defensively because it arrives from a URL.
  const parsedImported = Number.parseInt(imported ?? '', 10);
  const importedCount =
    Number.isFinite(parsedImported) && parsedImported > 0 ? parsedImported : null;

  return (
    <HubSection onRefresh={() => membersRef.current?.reload() ?? Promise.resolve()}>
      <ClubMembers ref={membersRef} club={club} role={role} importedCount={importedCount} />
    </HubSection>
  );
}
