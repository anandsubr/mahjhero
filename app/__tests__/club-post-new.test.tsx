import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewPostScreen from '../messages/club/new';

const replace = vi.fn();
const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn(), replace }),
  usePathname: () => '/messages/club/new',
  useLocalSearchParams: () => ({ threadId: 't1', clubId: 'c1' }),
  // A bare `(cb) => cb()` fires on every render, which the real hook never
  // does -- see app/__tests__/club-board.test.tsx's identical comment.
  useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
}));

// A module-scoped constant, not a literal inside the hook: the same
// referential-stability requirement every other screen test in this repo
// records for its own useSession mock.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const postMessage = vi.fn();
// TabBar (carried by this screen via Screen's `tabBar` prop) calls
// useUnreadCounts, which reaches this -- the same reason every other screen
// test that renders TabBar mocks it.
const fetchUnreadCounts = vi.fn(async () => []);

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    postMessage: (...a: unknown[]) => postMessage(...a),
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

const countBroadcastRecipients = vi.fn();
vi.mock('../../lib/broadcasts', () => ({
  countBroadcastRecipients: (...a: unknown[]) => countBroadcastRecipients(...a),
}));

// The organizer check goes through fetchRoster -- the exact boundary
// app/clubs/[id]/index.tsx, venues.tsx and events/[eventId]/index.tsx all
// already read to derive their own `isOrganizer` -- with `canAnnounce`
// (lib/clubs.ts) left real: it is pure, and it is the predicate under test.
// There is no `organizer` prop on this screen; both branches below are
// driven entirely by what fetchRoster resolves.
const fetchRoster = vi.fn();
vi.mock('../../lib/clubs', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/clubs')>('../../lib/clubs');
  return {
    ...actual,
    fetchRoster: (...a: unknown[]) => fetchRoster(...a),
  };
});

const member = (role: 'host' | 'co_organizer' | 'member') => [
  { profile_id: 'me', role, display_name: 'Me', skill_level: null },
];

describe('composing a post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
    postMessage.mockResolvedValue({ id: 'p1', error: null });
    countBroadcastRecipients.mockResolvedValue(12);
  });

  it('posts a plain post as a root', async () => {
    fetchRoster.mockResolvedValue(member('member'));
    render(<NewPostScreen />);
    fireEvent.change(await screen.findByLabelText('Post'), {
      target: { value: 'Anyone free Thursday?' },
    });
    fireEvent.click(screen.getByLabelText('Post it'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1',
        'Anyone free Thursday?',
        false,
        null,
        null,
      ),
    );
  });

  it('hides the Announcement toggle from a plain member', async () => {
    fetchRoster.mockResolvedValue(member('member'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText('Post')).toBeTruthy());
    expect(screen.queryByLabelText(/Also email/)).toBeNull();
  });

  it('offers an organizer (host) the Announcement toggle', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
  });

  it('offers a co-organizer the Announcement toggle too', async () => {
    fetchRoster.mockResolvedValue(member('co_organizer'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
  });

  it('shows the organizer the subject their email will carry', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Post'), {
      target: { value: 'Doors at seven\nBring cash' },
    });
    fireEvent.click(screen.getByLabelText(/Also email/));
    // getAllByText, not getByText: react-native-web's Card/View wrappers
    // around a single Text child all carry the same aggregate textContent,
    // so a plain getByText matches the notice's own div AND its ancestors.
    await waitFor(() =>
      expect(screen.getAllByText(/Doors at seven/).length).toBeGreaterThan(0),
    );
  });

  // post_message trims the WHOLE body before deriving its subject from the
  // first line, so a draft that starts with a blank line must lose that
  // blank line the same way here -- deriveSubject's own docstring names
  // this exact case as the bug a raw (untrimmed) call site produces: an
  // empty subject shown for a post about to mail a real one.
  it('derives the subject from the trimmed draft, not the raw one', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Post'), {
      target: { value: '\nDoors at seven' },
    });
    fireEvent.click(screen.getByLabelText(/Also email/));
    await waitFor(() =>
      expect(screen.getAllByText(/Subject: Doors at seven/).length).toBeGreaterThan(0),
    );
  });

  it('shows the recipient count from countBroadcastRecipients, for the club and no event', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Also email/));
    await waitFor(() =>
      expect(screen.getAllByText(/12 people/).length).toBeGreaterThan(0),
    );
    expect(countBroadcastRecipients).toHaveBeenCalledWith('c1', null);
  });

  it('does not render the count as "null" when it could not be asked', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    countBroadcastRecipients.mockResolvedValue(null);
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Also email/));
    await waitFor(() =>
      expect(screen.getAllByText(/Subject/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('announces when the toggle is on', async () => {
    fetchRoster.mockResolvedValue(member('host'));
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Also email/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Post'), {
      target: { value: 'Doors at seven' },
    });
    fireEvent.click(screen.getByLabelText(/Also email/));
    fireEvent.click(screen.getByLabelText('Post it'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'Doors at seven', true, null, null),
    );
  });

  it('navigates to the post that was just created', async () => {
    fetchRoster.mockResolvedValue(member('member'));
    postMessage.mockResolvedValue({ id: 'p9', error: null });
    render(<NewPostScreen />);
    fireEvent.change(await screen.findByLabelText('Post'), {
      target: { value: 'Anyone free Thursday?' },
    });
    fireEvent.click(screen.getByLabelText('Post it'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/club/t1/p9'));
  });

  it('keeps the draft when the post is refused', async () => {
    fetchRoster.mockResolvedValue(member('member'));
    postMessage.mockResolvedValue({ id: null, error: 'Nope.' });
    render(<NewPostScreen />);
    const input = await screen.findByLabelText('Post');
    fireEvent.change(input, { target: { value: 'Anyone free Thursday?' } });
    fireEvent.click(screen.getByLabelText('Post it'));
    await waitFor(() => expect(screen.getByText('Nope.')).toBeTruthy());
    expect((input as HTMLTextAreaElement).value).toBe('Anyone free Thursday?');
    expect(replace).not.toHaveBeenCalled();
  });

  it('posts only once when Post it is activated twice before the first send settles', async () => {
    fetchRoster.mockResolvedValue(member('member'));
    let resolvePost!: (value: { id: string | null; error: string | null }) => void;
    postMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(<NewPostScreen />);
    const input = await screen.findByLabelText('Post');
    fireEvent.change(input, { target: { value: 'On my way' } });
    const button = screen.getByLabelText('Post it');

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(postMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({ id: 'p2', error: null });
      await Promise.resolve();
    });
  });
});

describe('backing out of a post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
    fetchRoster.mockResolvedValue(member('member'));
  });

  it('has a back control labelled for the board it came from', async () => {
    render(<NewPostScreen />);
    await waitFor(() => expect(screen.getByLabelText('Back to board')).toBeTruthy());
  });

  it('backs out to the board on the first tap when the draft is empty', async () => {
    render(<NewPostScreen />);
    fireEvent.click(await screen.findByLabelText('Back to board'));
    expect(push).toHaveBeenCalledWith('/messages/club/t1');
  });

  it('arms a confirm, without navigating, on the first tap with a typed draft', async () => {
    render(<NewPostScreen />);
    fireEvent.change(await screen.findByLabelText('Post'), {
      target: { value: 'Anyone free Thursday?' },
    });
    fireEvent.click(screen.getByLabelText('Back to board'));
    expect(push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText('Discard post and go back to board')).toBeTruthy(),
    );
    expect(screen.getByText('Tap back again to discard this draft.')).toBeTruthy();
  });

  it('backs out to the board on the second tap with a typed draft', async () => {
    render(<NewPostScreen />);
    fireEvent.change(await screen.findByLabelText('Post'), {
      target: { value: 'Anyone free Thursday?' },
    });
    fireEvent.click(screen.getByLabelText('Back to board'));
    fireEvent.click(await screen.findByLabelText('Discard post and go back to board'));
    expect(push).toHaveBeenCalledWith('/messages/club/t1');
  });

  it('disarms the confirm when the draft changes after arming', async () => {
    render(<NewPostScreen />);
    const input = await screen.findByLabelText('Post');
    fireEvent.change(input, { target: { value: 'Anyone free Thursday?' } });
    fireEvent.click(screen.getByLabelText('Back to board'));
    await waitFor(() =>
      expect(screen.getByLabelText('Discard post and go back to board')).toBeTruthy(),
    );
    fireEvent.change(input, { target: { value: 'Anyone free Thursday? Say 7pm' } });
    expect(screen.getByLabelText('Back to board')).toBeTruthy();
    expect(screen.queryByLabelText('Discard post and go back to board')).toBeNull();
  });

  it('backs out on one tap when the draft was armed and then cleared back to empty', async () => {
    render(<NewPostScreen />);
    const input = await screen.findByLabelText('Post');
    fireEvent.change(input, { target: { value: 'Anyone free Thursday?' } });
    fireEvent.click(screen.getByLabelText('Back to board'));
    await waitFor(() =>
      expect(screen.getByLabelText('Discard post and go back to board')).toBeTruthy(),
    );
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Back to board'));
    expect(push).toHaveBeenCalledWith('/messages/club/t1');
  });
});
