import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessagesScreen from '../messages/index';
import type { ThreadListRow } from '../../lib/messages';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages',
  useFocusEffect: (cb: () => void) => cb(),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchMyThreads = vi.fn();
const openThreadForClub = vi.fn();

vi.mock('../../lib/messages', async () => {
  // The pure helpers are covered in lib/messages.test.ts. Mocking them here
  // would only let this screen sort and section in ways the real ones never
  // produce.
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchMyThreads: (...a: unknown[]) => fetchMyThreads(...a),
    openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
  };
});

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    thread_id: 't1',
    kind: 'club',
    title: 'Everyone at Riverside',
    club_id: 'c1',
    club_name: 'Riverside',
    member_count: 42,
    last_body: 'See you Tuesday',
    last_author: 'Alice Ng',
    last_is_announcement: false,
    last_message_at: '2026-08-25T10:00:00Z',
    unread: 0,
    event_id: null,
    event_starts_at: null,
    event_timezone: 'America/New_York',
    ...over,
  };
}

const GAME = row({
  thread_id: 't2',
  kind: 'game',
  title: 'Tuesday Night',
  event_id: 'e1',
  event_starts_at: '2026-08-27T22:00:00Z',
  last_message_at: '2026-08-26T09:00:00Z',
});

const DIRECT = row({
  thread_id: 't3',
  kind: 'direct',
  title: 'Bob Reyes',
  club_id: null,
  club_name: null,
  last_message_at: '2026-08-24T09:00:00Z',
});

describe('messages list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMyThreads.mockResolvedValue([row(), GAME, DIRECT]);
    openThreadForClub.mockResolvedValue({ id: 't1', error: null });
  });

  it('lists every thread, newest first, under Recent', async () => {
    render(<MessagesScreen />);
    const titles = await screen.findAllByText(
      /Everyone at Riverside|Tuesday Night|Bob Reyes/,
    );
    expect(titles.map((n) => n.textContent)).toEqual([
      'Tuesday Night',
      'Everyone at Riverside',
      'Bob Reyes',
    ]);
  });

  it('groups under club headers with People pinned first when sorted By club', async () => {
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByText('By club'));
    const headers = await screen.findAllByText(/^People$|^Riverside$/);
    expect(headers.map((n) => n.textContent)).toEqual(['People', 'Riverside']);
  });

  // "we could not ask" and "you have no conversations" are different claims,
  // and an empty state for a failed read tells the member something false.
  it('shows an error rather than an empty state when the load fails', async () => {
    fetchMyThreads.mockResolvedValueOnce(null);
    render(<MessagesScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
  });

  it('shows the empty state when there really is nothing', async () => {
    fetchMyThreads.mockResolvedValueOnce([]);
    render(<MessagesScreen />);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
  });

  // A club thread nobody has posted in has no id yet. Tapping it goes
  // through open_thread_for_club, which creates the row and returns the id.
  it('opens a never-used club thread through the RPC', async () => {
    fetchMyThreads.mockResolvedValueOnce([
      row({ thread_id: null, last_message_at: null, last_body: null, last_author: null }),
    ]);
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Everyone at Riverside'));
    await waitFor(() => expect(openThreadForClub).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages/t1'));
  });

  it('navigates straight to a thread that already has an id', async () => {
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Tuesday Night'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages/t2'));
    expect(openThreadForClub).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from open_thread_for_club instead of navigating', async () => {
    fetchMyThreads.mockResolvedValueOnce([row({ thread_id: null })]);
    openThreadForClub.mockResolvedValueOnce({
      id: null,
      error: 'you are not a member of this club',
    });
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Everyone at Riverside'));
    expect(
      await screen.findByText('you are not a member of this club'),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('reaches the compose screen', async () => {
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('New'));
    expect(push).toHaveBeenCalledWith('/messages/new');
  });
});
