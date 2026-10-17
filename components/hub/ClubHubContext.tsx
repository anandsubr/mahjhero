import { createContext, useContext } from 'react';
import type { Club, ClubRole } from '../../lib/clubs';

export type ClubHubValue = {
  club: Club;
  /** The caller's role in this club; null if they are not an active member. */
  role: ClubRole | null;
  /** Refetches the club (and role, cover) without showing the loading state. */
  reloadClub: () => Promise<void>;
};

export const ClubHubContext = createContext<ClubHubValue | null>(null);

/** The club and role loaded by app/clubs/[id]/(hub)/_layout.tsx. */
export function useClubHub(): ClubHubValue {
  const value = useContext(ClubHubContext);
  if (!value) throw new Error('useClubHub must be used inside the club hub layout');
  return value;
}
