import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BroadcastHistory from '../clubs/[id]/broadcasts';

const push = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchBroadcasts = vi.hoisted(() => vi.fn());

vi.mock('../../lib/broadcasts', () => ({ fetchBroadcasts }));

describe('broadcast history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBroadcasts.mockResolvedValue([
      { id: 'b1', club_id: 'c1', event_id: null, subject: 'Doors at seven',
        body: 'Side entrance is locked.', recipient_count: 14,
        created_at: '2026-09-01T14:00:00Z' },
    ]);
  });

  // The first question after mailing fifty people is whether it went.
  it('says what was sent and how many it reached', async () => {
    render(<BroadcastHistory />);
    expect(await screen.findByText('Doors at seven')).toBeTruthy();
    expect(screen.getByText(/14 members/)).toBeTruthy();
  });

  it('offers an empty state rather than a bare screen', async () => {
    fetchBroadcasts.mockResolvedValue([]);
    render(<BroadcastHistory />);
    expect(await screen.findByText(/haven't sent anything/i)).toBeTruthy();
  });

  // A failed read must not read as "you have sent nothing", which is a
  // different and alarming statement.
  it('distinguishes a failed read from an empty history', async () => {
    fetchBroadcasts.mockResolvedValue(null);
    render(<BroadcastHistory />);
    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
    expect(screen.queryByText(/haven't sent anything/i)).toBeNull();
  });
});
