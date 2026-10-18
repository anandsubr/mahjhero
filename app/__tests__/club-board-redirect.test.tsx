import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ClubBoardRedirect from '../messages/club/[threadId]/index';

const replace = vi.fn();
const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ replace, push, back: vi.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({ threadId: 't1' }),
}));

const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchThread = vi.fn();
vi.mock('../../lib/messages', () => ({
  fetchThread: (...a: unknown[]) => fetchThread(...a),
}));

// The standalone board is gone: old emails, pushes and history entries that
// name /messages/club/{thread} land on the club hub's Board instead.
describe('the old standalone club board route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchThread.mockResolvedValue({ id: 't1', club_id: 'c1' });
  });

  it('forwards to the hub Board of the thread’s club', async () => {
    render(<ClubBoardRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/c1/board'));
    expect(fetchThread).toHaveBeenCalledWith('t1');
    expect(push).not.toHaveBeenCalled();
  });

  it('goes Home when the thread cannot be read', async () => {
    fetchThread.mockResolvedValue(null);
    render(<ClubBoardRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('goes Home when the thread has no club', async () => {
    fetchThread.mockResolvedValue({ id: 't1', club_id: null });
    render(<ClubBoardRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });
});
