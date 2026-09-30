import { useEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// This file's mock preamble is copied from app/__tests__/guides-tips.test.tsx's
// own ClubDetailScreen setup (searched via `grep -l "clubs/\[id\]/index"
// app/__tests__/*`), trimmed to only what ClubDetailScreen itself needs --
// the event/check-in mocks that file also carries belong to screens this
// file never renders.

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace, back }),
  usePathname: () => '/clubs/club-1',
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);
vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const isVisible = vi.fn((_key: string) => false);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
const createInvite = vi.fn();
const sendClubInviteEmail = vi.fn();
const deleteInvite = vi.fn();
const setClubCode = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
    createInvite: (...args: unknown[]) => createInvite(...args),
    sendClubInviteEmail: (...args: unknown[]) => sendClubInviteEmail(...args),
    deleteInvite: (...args: unknown[]) => deleteInvite(...args),
    setClubCode: (...args: unknown[]) => setClubCode(...args),
  };
});

import ClubDetailScreen from '../clubs/[id]/index';

const CLUB = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
  default_game_mode: 'open_play' as const,
  code: 'TEST1',
};

const MEMBER_ROLE = [
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
];
const HOST_ROLE = [
  { profile_id: 'test-user', role: 'host' as const, display_name: 'Ada', skill_level: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  isVisible.mockImplementation(() => false);
  searchParams.id = 'club-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchPendingInvites.mockResolvedValue([]);
  createInvite.mockResolvedValue({ id: 'new-invite', error: null });
  sendClubInviteEmail.mockResolvedValue({ error: null });
  deleteInvite.mockResolvedValue({ error: null });
});

it('shows the club code to every member', async () => {
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  render(<ClubDetailScreen />);
  expect(await screen.findByText('Club code: TEST1')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change club code' })).toBeNull();
});

it('lets a host change the code', async () => {
  fetchRoster.mockResolvedValue(HOST_ROLE);
  setClubCode.mockResolvedValueOnce({ code: 'NEWCODE', error: null });
  render(<ClubDetailScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
  fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'newcode' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
  expect(await screen.findByText('Club code: NEWCODE')).toBeTruthy();
  expect(setClubCode).toHaveBeenCalledWith('c1', 'NEWCODE');
});

it('shows the taken error', async () => {
  fetchRoster.mockResolvedValue(HOST_ROLE);
  setClubCode.mockResolvedValueOnce({ code: null, error: 'That code is taken.' });
  render(<ClubDetailScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
  fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'OAK2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
  expect(await screen.findByText('That code is taken.')).toBeTruthy();
});
