import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThreadScreen from '../messages/[threadId]';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages/t1',
  useLocalSearchParams: () => ({ threadId: 't1' }),
}));

// A module-scoped constant, not a fresh object literal per render: a fresh
// object breaks the referential stability the real Context provides and
// produces a genuine render loop in effects that depend on `session`.
const SESSION_STATE = { session: { user: { id: 'me' } }, loading: false };

vi.mock('../../lib/session', () => ({
  useSession: () => SESSION_STATE,
}));

const fetchThread = vi.fn();
const fetchThreadMessages = vi.fn();
const postMessage = vi.fn();
const markThreadRead = vi.fn();
const countBroadcastRecipients = vi.fn();

vi.mock('../../lib/broadcasts', () => ({
  countBroadcastRecipients: (...a: unknown[]) => countBroadcastRecipients(...a),
}));

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchThread: (...a: unknown[]) => fetchThread(...a),
    fetchThreadMessages: (...a: unknown[]) => fetchThreadMessages(...a),
    postMessage: (...a: unknown[]) => postMessage(...a),
    markThreadRead: (...a: unknown[]) => markThreadRead(...a),
  };
});

// The Realtime boundary. `on` and `subscribe` chain, and `removeChannel` is
// what the unsubscribe assertion below watches.
const channelOn = vi.fn();
const channelSubscribe = vi.fn();
const removeChannel = vi.fn();
const channel = { on: channelOn, subscribe: channelSubscribe };
channelOn.mockReturnValue(channel);
channelSubscribe.mockReturnValue(channel);

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}));

const CLUB_THREAD = {
  id: 't1',
  club_id: 'c1',
  event_id: null,
  title: null,
  clubs: { name: 'Riverside', timezone: 'America/New_York' },
  events: null,
  thread_members: [],
};

const MESSAGES = [
  {
    id: 'm1',
    author_id: 'other',
    body: 'We are one short for Tuesday.',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-25T10:00:00Z',
    profiles: { display_name: 'Sara Lindqvist' },
    reply_to_id: null,
    reply_to: null,
  },
  {
    id: 'm2',
    author_id: 'me',
    body: 'I can take the seat.',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-25T10:05:00Z',
    profiles: { display_name: 'You' },
    reply_to_id: null,
    reply_to: null,
  },
];

describe('thread screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelOn.mockReturnValue(channel);
    channelSubscribe.mockReturnValue(channel);
    fetchThread.mockResolvedValue(CLUB_THREAD);
    fetchThreadMessages.mockResolvedValue(MESSAGES);
    postMessage.mockResolvedValue({ id: 'm3', error: null });
    markThreadRead.mockResolvedValue({ error: null });
    countBroadcastRecipients.mockResolvedValue(14);
  });

  it('shows the thread title and every message', async () => {
    render(<ThreadScreen />);
    expect(await screen.findByText('Everyone at Riverside')).toBeTruthy();
    expect(screen.getByText('We are one short for Tuesday.')).toBeTruthy();
    expect(screen.getByText('I can take the seat.')).toBeTruthy();
  });

  // Somebody else's message is attributed; your own is not — it is on your
  // side of the thread, and a name over it is noise.
  it('names other people and not you', async () => {
    render(<ThreadScreen />);
    expect(await screen.findByText('Sara Lindqvist')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
  });

  // Opening a thread is reading it. Without this the badge outlives the act
  // it is meant to prompt.
  it('marks the thread read on open', async () => {
    render(<ThreadScreen />);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledWith('t1'));
  });

  it('sends a message and clears the composer', async () => {
    render(<ThreadScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'On my way' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'On my way', false, null),
    );
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });

  it('keeps the text and shows the refusal when the send fails', async () => {
    postMessage.mockResolvedValueOnce({
      id: null,
      error: 'you cannot post in this conversation',
    });
    render(<ThreadScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'On my way' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(
      await screen.findByText('you cannot post in this conversation'),
    ).toBeTruthy();
    // Losing what somebody typed because the network failed is the worst
    // possible response to a failed send.
    expect((input as HTMLInputElement).value).toBe('On my way');
  });

  it('subscribes to the thread and tears the channel down on unmount', async () => {
    const { unmount } = render(<ThreadScreen />);
    await waitFor(() => expect(channelSubscribe).toHaveBeenCalled());
    expect(channelOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'thread_id=eq.t1',
      }),
      expect.any(Function),
    );
    unmount();
    // An un-torn-down subscription is the bug this kind of screen actually
    // ships, and nothing else in the suite would notice it.
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it('renders an announcement with its subject and a tag', async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      {
        id: 'm9',
        author_id: 'other',
        body: 'Hall is closed Friday\nUse the side door.',
        subject: 'Hall is closed Friday',
        is_announcement: true,
        created_at: '2026-08-25T10:00:00Z',
        profiles: { display_name: 'Alice Ng' },
        reply_to_id: null,
        reply_to: null,
      },
    ]);
    render(<ThreadScreen />);
    expect(await screen.findByText('Hall is closed Friday')).toBeTruthy();
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('shows an error rather than an empty thread when the load fails', async () => {
    fetchThread.mockResolvedValueOnce(null);
    render(<ThreadScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
  });

  // An announcement mails people and cannot be unsent. The count comes from
  // the database, not from local state, so the confirmation cannot be a lie.
  it('shows the recipient count and asks before sending an announcement', async () => {
    render(<ThreadScreen />);
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'Hall is closed Friday' },
    });
    fireEvent.click(screen.getByLabelText('Also email everyone'));
    await waitFor(() =>
      expect(countBroadcastRecipients).toHaveBeenCalledWith('c1', null),
    );
    expect(
      await screen.findByText('Emails 14 members, subject: Hall is closed Friday'),
    ).toBeTruthy();

    // First tap arms, second tap sends.
    fireEvent.click(screen.getByLabelText('Send'));
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByLabelText('Confirm send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1',
        'Hall is closed Friday',
        true,
        null,
      ),
    );
  });

  // "Emails 0 members" is a claim; a failed count has nothing to say.
  it('omits the number when the count cannot be fetched', async () => {
    countBroadcastRecipients.mockResolvedValueOnce(null);
    render(<ThreadScreen />);
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'Hall is closed Friday' },
    });
    fireEvent.click(screen.getByLabelText('Also email everyone'));
    expect(
      await screen.findByText(
        'Emails the club with the subject: Hall is closed Friday',
      ),
    ).toBeTruthy();
  });

  it('disarms the confirmation when the toggle goes back off', async () => {
    render(<ThreadScreen />);
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'Hall is closed Friday' },
    });
    fireEvent.click(screen.getByLabelText('Also email everyone'));
    fireEvent.click(await screen.findByLabelText('Send'));
    expect(await screen.findByLabelText('Confirm send')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Also email everyone'));
    fireEvent.click(await screen.findByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1',
        'Hall is closed Friday',
        false,
        null,
      ),
    );
  });

  it('quotes the picked message and sends the pointer with the reply', async () => {
    render(<ThreadScreen />);
    fireEvent.click(await screen.findByLabelText('Reply to Sara Lindqvist'));
    // The stub appears above the composer, so you can see what you are
    // answering while you write it.
    expect(
      await screen.findByText('Sara Lindqvist: We are one short for Tuesday.'),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'I can play' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'I can play', false, 'm1'),
    );
  });

  it('drops the quote when it is cancelled', async () => {
    render(<ThreadScreen />);
    fireEvent.click(await screen.findByLabelText('Reply to Sara Lindqvist'));
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'never mind' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'never mind', false, null),
    );
  });

  it('renders a sent reply with its quoted stub', async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      ...MESSAGES,
      {
        id: 'm3',
        author_id: 'other',
        body: 'Perfect, that is the table full.',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-25T10:10:00Z',
        profiles: { display_name: 'Peter Ng' },
        reply_to_id: 'm2',
        reply_to: {
          id: 'm2',
          body: 'I can take the seat.',
          profiles: { display_name: 'You' },
        },
      },
    ]);
    render(<ThreadScreen />);
    expect(await screen.findByText('You: I can take the seat.')).toBeTruthy();
  });

  // reply_to_id is `on delete set null`, so a reply can outlive what it
  // answered. An empty quote box is worse than none.
  it('renders a reply whose parent is gone as an ordinary message', async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      {
        ...MESSAGES[0],
        id: 'm4',
        body: 'Answering something that no longer exists.',
        reply_to_id: 'm-gone',
        reply_to: null,
      },
    ]);
    render(<ThreadScreen />);
    expect(
      await screen.findByText('Answering something that no longer exists.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('quote-stub')).toBeNull();
  });
});
