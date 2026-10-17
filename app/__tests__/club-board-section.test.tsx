import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Club, ClubRole } from '../../lib/clubs';
import type { FeedPost } from '../../lib/board';

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  // Identity-keyed like the real hook (re-runs when the callback changes,
  // never on a plain re-render). ClubBoard's own focus-refetch behaviour is
  // covered by app/__tests__/club-board.test.tsx -- this file proves the
  // Board SECTION wires the thread id, composer and role through.
  useFocusEffect: (cb: () => void) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const openThreadForClub = vi.fn();
const postMessage = vi.fn();
vi.mock('../../lib/messages', async () => {
  const actual = await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
    postMessage: (...a: unknown[]) => postMessage(...a),
  };
});

const fetchClubFeed = vi.fn();
vi.mock('../../lib/board', async () => {
  const actual = await vi.importActual<typeof import('../../lib/board')>('../../lib/board');
  return {
    ...actual,
    fetchClubFeed: (...a: unknown[]) => fetchClubFeed(...a),
    loadFeedOrder: async () => 'recent',
    saveFeedOrder: async () => {},
  };
});

vi.mock('../../lib/attachments', () => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
  uploadAttachment: vi.fn(),
  getSignedUrls: async () => ({}),
  MAX_ATTACHMENTS: 4,
}));

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

function post(id: string, body: string): FeedPost {
  return {
    id,
    authorId: 'a1',
    authorName: 'Alice Chen',
    authorRole: 'member',
    body,
    subject: null,
    isAnnouncement: false,
    createdAt: '2026-08-30T10:00:00.000Z',
    lastActivityAt: '2026-08-30T10:00:00.000Z',
    replyCount: 0,
    unread: false,
    heartCount: 0,
    heartedByMe: false,
    attachments: [],
    recentComments: [],
  };
}

function renderSection(role: ClubRole | null = 'member') {
  render(
    <ClubHubContext.Provider value={{ club: CLUB, role, reloadClub: vi.fn() }}>
      <BoardSection />
    </ClubHubContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  openThreadForClub.mockResolvedValue({ id: 't1', error: null });
  fetchClubFeed.mockResolvedValue([]);
});

describe('club hub Board section', () => {
  it("opens this club's own board thread and shows its posts", async () => {
    fetchClubFeed.mockResolvedValue([post('p1', 'Anyone free Thursday?')]);
    renderSection();
    expect(await screen.findByText('Anyone free Thursday?')).toBeTruthy();
    expect(openThreadForClub).toHaveBeenCalledWith('c1');
    expect(fetchClubFeed).toHaveBeenCalledWith('t1', 'recent');
  });

  it('shows hosts an Announcement button to the full composer for this club and thread', async () => {
    renderSection('host');
    fireEvent.click(await screen.findByRole('button', { name: 'Announcement' }));
    expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=c1');
  });

  it('does not show members an Announcement button, or the old New post pill', async () => {
    renderSection('member');
    await screen.findByText('Nothing here yet. Start the first post.');
    expect(screen.queryByRole('button', { name: 'Announcement' })).toBeNull();
    expect(screen.queryByLabelText('New post')).toBeNull();
  });

  it('pins the composer below the board; posting reloads with the new post first', async () => {
    fetchClubFeed
      .mockResolvedValueOnce([post('p1', 'Older post')])
      .mockResolvedValueOnce([post('p9', 'Fresh post'), post('p1', 'Older post')]);
    postMessage.mockResolvedValue({ id: 'p9', error: null });
    renderSection();
    await screen.findByText('Older post');
    const field = screen.getByPlaceholderText('Write to the club');
    // Outside the scroller: the footer column, not the scrolling content.
    expect(screen.getByTestId('hub-section-scroll').contains(field)).toBe(false);
    fireEvent.change(field, { target: { value: 'Fresh post' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Fresh post')).toBeTruthy();
    expect(postMessage).toHaveBeenCalledWith('t1', 'Fresh post', false, null, null, []);
    const bodies = screen.getAllByText(/^(Fresh post|Older post)$/).map((n) => n.textContent);
    expect(bodies).toEqual(['Fresh post', 'Older post']);
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
