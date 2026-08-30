import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import BroadcastRedirect from '../clubs/[id]/broadcast';
import BroadcastsRedirect from '../clubs/[id]/broadcasts';

const replace = vi.fn();
let params: Record<string, string> = { id: 'c1' };

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useLocalSearchParams: () => params,
  usePathname: () => '/clubs/c1/broadcast',
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const openThreadForClub = vi.fn();
const openThreadForEvent = vi.fn();

vi.mock('../../lib/messages', () => ({
  openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
  openThreadForEvent: (...a: unknown[]) => openThreadForEvent(...a),
}));

describe('the old broadcast routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params = { id: 'c1' };
    openThreadForClub.mockResolvedValue({ id: 't1', error: null });
    openThreadForEvent.mockResolvedValue({ id: 't2', error: null });
  });

  // These URLs are in members' history and in already-sent emails. A 404 is
  // not an acceptable answer to a link that worked last week.
  it('sends the club compose route to the club thread', async () => {
    render(<BroadcastRedirect />);
    await waitFor(() => expect(openThreadForClub).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t1'));
  });

  it('sends the event-scoped compose route to that game’s thread', async () => {
    params = { id: 'c1', eventId: 'e1' };
    render(<BroadcastRedirect />);
    await waitFor(() => expect(openThreadForEvent).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t2'));
    expect(openThreadForClub).not.toHaveBeenCalled();
  });

  it('sends the sent-history route to the club thread', async () => {
    render(<BroadcastsRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t1'));
  });

  // A refusal must not strand somebody on a blank screen with a spinner.
  it('falls back to the club screen when the thread cannot be opened', async () => {
    openThreadForClub.mockResolvedValueOnce({
      id: null,
      error: 'you are not a member of this club',
    });
    render(<BroadcastRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/c1'));
  });

  // A malformed route (no club id) must not dead-end on the loading
  // spinner forever -- the effect that would otherwise navigate never
  // runs when id is missing, so the guard has to send it somewhere real.
  it('sends the club compose route to the dashboard when the id is missing', async () => {
    params = {};
    render(<BroadcastRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs'));
    expect(openThreadForClub).not.toHaveBeenCalled();
    expect(openThreadForEvent).not.toHaveBeenCalled();
  });

  it('sends the sent-history route to the dashboard when the id is missing', async () => {
    params = {};
    render(<BroadcastsRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs'));
    expect(openThreadForClub).not.toHaveBeenCalled();
  });
});
