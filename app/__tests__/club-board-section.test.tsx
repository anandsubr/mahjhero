import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Club } from '../../lib/clubs';

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  useFocusEffect: (cb: () => void) => {
    // A bare mount-time run is enough here: ClubBoard's own focus-refetch
    // behaviour is already covered by app/__tests__/club-board.test.tsx --
    // this file only needs to prove the Board SECTION wires the thread id
    // and the New-post control through correctly.
    cb();
  },
}));

const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const openThreadForClub = vi.fn();
const fetchClubPosts = vi.fn();
vi.mock('../../lib/messages', async () => {
  const actual = await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
    fetchClubPosts: (...a: unknown[]) => fetchClubPosts(...a),
  };
});

const useThreadRealtime = vi.fn();
vi.mock('../../lib/use-thread-realtime', () => ({
  useThreadRealtime: (...a: unknown[]) => useThreadRealtime(...a),
}));

import BoardSection from '../clubs/[id]/(hub)/board';
import { ClubHubContext } from '../../components/hub/ClubHubContext';

const CLUB: Club = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: '',
  visibility: 'private',
  timezone: 'America/New_York',
  default_game_mode: 'open_play',
  code: 'RIVER24',
  cover_path: null,
  cover_color: 'accent2_800',
};

function renderSection() {
  render(
    <ClubHubContext.Provider value={{ club: CLUB, role: 'member', reloadClub: vi.fn() }}>
      <BoardSection />
    </ClubHubContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  openThreadForClub.mockResolvedValue({ id: 't1', error: null });
  fetchClubPosts.mockResolvedValue([]);
});

describe('club hub Board section', () => {
  it("opens this club's own board thread and shows its posts", async () => {
    fetchClubPosts.mockResolvedValue([
      {
        id: 'p1',
        author_id: 'a1',
        author_name: 'Alice Chen',
        body: 'Anyone free Thursday?',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-30T10:00:00.000Z',
        reply_count: 0,
        last_reply_at: null,
        last_activity_at: '2026-08-30T10:00:00.000Z',
        unread: 0,
      },
    ]);
    renderSection();
    expect(await screen.findByText('Anyone free Thursday?')).toBeTruthy();
    expect(openThreadForClub).toHaveBeenCalledWith('c1');
  });

  it('shows a New post button that goes to the compose screen for this club and thread', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByLabelText('New post')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('New post'));
    expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=c1');
  });

  it('shows "Could not load the board." with Retry when the thread cannot be opened', async () => {
    openThreadForClub.mockResolvedValue({ id: null, error: 'nope' });
    renderSection();
    expect(await screen.findByText('Could not load the board.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Retry re-opens the thread and recovers', async () => {
    openThreadForClub.mockResolvedValueOnce({ id: null, error: 'nope' });
    renderSection();
    await screen.findByText('Could not load the board.');
    openThreadForClub.mockResolvedValueOnce({ id: 't1', error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Could not load the board.')).toBeNull());
  });
});
