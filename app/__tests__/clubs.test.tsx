import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ClubsScreen from '../clubs/index';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'club-1' }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

const fetchMyClubs = vi.fn();

vi.mock('../../lib/clubs', () => ({
  fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
}));

describe('clubs list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a way to start one when the member has no clubs', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.getByText('Start a club')).toBeTruthy();
  });

  it('lists the clubs a member belongs to', async () => {
    fetchMyClubs.mockResolvedValueOnce([
      { id: 'c1', name: 'Riverside Mah Jongg', slug: 'riverside',
        rhythm: 'Thursday evenings', visibility: 'private', timezone: 'America/New_York' },
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
  });

  // The one that matters: fetchMyClubs returns null on a failed load and []
  // when the member genuinely has no clubs. Rendering the empty-state copy
  // for both would tell a member whose fetch just failed that their clubs
  // are gone. app/profile.tsx shipped the equivalent bug once already — a
  // blank-but-editable form after a failed fetch that members then
  // overwrote their real profile through.
  it('shows an error rather than an empty list when the load fails', async () => {
    fetchMyClubs.mockResolvedValueOnce(null);
    render(<ClubsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/not in a club yet/i)).toBeNull();
  });
});

import ImportRosterScreen from '../clubs/[id]/import';

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
    importRoster: vi.fn(async () => ({ created: 2, error: null })),
  };
});

describe('roster import', () => {
  it('reports skipped rows instead of dropping them silently', async () => {
    render(<ImportRosterScreen />);
    const field = screen.getByLabelText('Roster CSV');
    fireEvent.change(field, {
      target: { value: 'name,email\nJane,jane@example.com\nBad,not-an-email' },
    });
    fireEvent.click(screen.getByText('Check the file'));
    expect(await screen.findByText(/1 person ready, 1 row skipped/)).toBeTruthy();
    expect(screen.getByText(/Row 3: Not a valid email address/)).toBeTruthy();
  });
});
