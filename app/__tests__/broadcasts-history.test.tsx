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

const fetchRoster = vi.hoisted(() => vi.fn());

// `canInvite` stays real -- it is pure, and it is the exact host-or-
// co-organizer test this screen is supposed to reuse rather than
// reimplementing its own notion of "organizer".
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return { ...actual, fetchRoster };
});

describe('broadcast history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBroadcasts.mockResolvedValue([
      { id: 'b1', club_id: 'c1', event_id: null, subject: 'Doors at seven',
        body: 'Side entrance is locked.', recipient_count: 14,
        created_at: '2026-09-01T14:00:00Z' },
    ]);
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null },
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

  // Reachable by URL even though nothing links here for a plain member.
  // RLS filters their read to zero rows rather than erroring, so without
  // this gate they saw "you haven't sent anything to this club yet" and a
  // "Write another" button -- both wrong for someone who was never allowed
  // to send in the first place.
  describe('when the viewer is not an organizer', () => {
    beforeEach(() => {
      fetchRoster.mockResolvedValue([
        { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
      ]);
    });

    it('refuses honestly instead of claiming nothing has been sent', async () => {
      render(<BroadcastHistory />);
      expect(
        await screen.findByText(/Only a club's host or co-organizers can see/),
      ).toBeTruthy();
      expect(screen.queryByText(/haven't sent anything/i)).toBeNull();
      expect(screen.queryByLabelText('Write another message')).toBeNull();
    });

    it('also refuses when the roster read fails', async () => {
      fetchRoster.mockResolvedValue(null);
      render(<BroadcastHistory />);
      expect(
        await screen.findByText(/Only a club's host or co-organizers can see/),
      ).toBeTruthy();
    });
  });
});
