import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useLocalSearchParams: () => searchParams,
}));

import LeaderboardRedirect from '../clubs/[id]/leaderboard';

/**
 * The old standalone leaderboard screen (club-hub phase 2, Task 9): its
 * content moved into components/ClubLeaderboard.tsx, tested at
 * components/__tests__/club-leaderboard.test.tsx now, and this route is a
 * bare redirect to the Ranks hub section so an old link still lands
 * somewhere real.
 */
describe('the old leaderboard route', () => {
  it('redirects to the club hub Ranks section', () => {
    render(<LeaderboardRedirect />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/clubs/club-1/ranks');
  });
});
