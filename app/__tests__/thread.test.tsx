import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThreadScreen from '../messages/[threadId]';

// Hoisted rather than a fresh `vi.fn()` per `useRouter()` call: a factory
// returning brand-new mocks on every render would make `expect(replace)
// .toHaveBeenCalledWith(...)` assert against a mock instance the component
// never actually called, since each render gets its own. Same pattern
// app/__tests__/messages-new.test.tsx already uses for `push`/`replace`.
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back, replace }),
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
const addToGroupThread = vi.fn();
const leaveGroupThread = vi.fn();
const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();

vi.mock('../../lib/broadcasts', () => ({
  countBroadcastRecipients: (...a: unknown[]) => countBroadcastRecipients(...a),
}));

// The same candidate source app/messages/new.tsx already uses for its own
// People picker, reused rather than a second way of gathering who is
// addable — see this screen's own comment above `openAdding`.
vi.mock('../../lib/friends', () => ({
  fetchFriends: (...a: unknown[]) => fetchFriends(...a),
  fetchAddablePeople: (...a: unknown[]) => fetchAddablePeople(...a),
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
    addToGroupThread: (...a: unknown[]) => addToGroupThread(...a),
    leaveGroupThread: (...a: unknown[]) => leaveGroupThread(...a),
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

// A group, not a direct: three members, so threadTitleFor's "join first
// names" branch fires rather than the single-other-person branch, and
// there is genuinely more than one member for the members panel to list.
const GROUP_THREAD = {
  id: 't1',
  club_id: null,
  event_id: null,
  title: null,
  clubs: null,
  events: null,
  thread_members: [
    { profile_id: 'me', profiles: { display_name: 'You' } },
    { profile_id: 'other', profiles: { display_name: 'Sara Lindqvist' } },
    { profile_id: 'third', profiles: { display_name: 'Peter Ng' } },
  ],
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
    addToGroupThread.mockResolvedValue({ error: null });
    leaveGroupThread.mockResolvedValue({ error: null });
    fetchFriends.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Bob Reyes', club_names: [] },
    ]);
    fetchAddablePeople.mockResolvedValue([
      { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Riverside' },
    ]);
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

  // The announcement background (accent2[100]) wins over the mine background
  // in the bubble's own style array (see the comment there), but the body
  // text colour used to be chosen from `mine` alone -- so an organizer's OWN
  // announcement rendered bodyMine's cream (colors.bg) on the pale-green
  // announcement background: 1.10:1, effectively invisible. This happens on
  // EVERY announcement its author looks at, since the screen reloads after
  // sending and the sender's own row comes back with is_announcement=true
  // and author_id===viewerId. The fix makes is_announcement -- not mine --
  // the text-colour signal, landing on accent2[800] (9.12:1 on accent2[100],
  // the same token the subject line already uses on this ground).
  it("gives an organizer's own announcement dark text, not the cream mine-bubble text", async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      {
        id: 'm9',
        author_id: 'me',
        body: 'We open again Monday.',
        subject: 'Hall is closed Friday',
        is_announcement: true,
        created_at: '2026-08-25T10:00:00Z',
        profiles: { display_name: 'You' },
        reply_to_id: null,
        reply_to: null,
      },
    ]);
    render(<ThreadScreen />);
    const body = await screen.findByText('We open again Monday.');
    // getComputedStyle, not `.style`: react-native-web emits atomic CSS
    // classes here, not inline styles -- see profile.test.tsx and
    // Button.test.tsx for the same pattern.
    expect(getComputedStyle(body).color).toBe('rgb(61, 71, 43)');
  });

  // send()'s guard used to read `sending` from the render closure, which is
  // blind to a second activation dispatched before React commits the
  // re-render from the first `setSending(true)`. For an announcement that is
  // a duplicate email to the entire club, which cannot be unsent. Both clicks
  // are dispatched inside one `act()` so no render lands between them --
  // reproducing the actual race, not a sequence RTL has already serialized.
  // A deferred promise (not a timer, not waitFor) keeps the first send
  // pending so the second activation's outcome is deterministic.
  it('sends only once when Send is activated twice before the first send settles', async () => {
    let resolvePost!: (value: { id: string; error: string | null }) => void;
    postMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(<ThreadScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'On my way' } });
    const send = screen.getByLabelText('Send');

    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });

    expect(postMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({ id: 'm3', error: null });
      await Promise.resolve();
    });
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

  // postMessage trims before sending, and post_message's own SQL trims the
  // WHOLE body before taking its first line -- `body := trim(coalesce(
  // p_body, ''))`, then `split_part(body, E'\n', 1)`. Passing the raw,
  // untrimmed draft to deriveSubject here used to disagree: the first LINE
  // of an untrimmed body starting with a blank line is empty, so the
  // confirmation showed no subject at all while post_message was about to
  // mail a real one.
  it('shows the real subject, not an empty one, for a body that starts with a blank line', async () => {
    render(<ThreadScreen />);
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: '\n\nHall is closed Friday' },
    });
    fireEvent.click(screen.getByLabelText('Also email everyone'));
    expect(
      await screen.findByText(
        'Emails the club with the subject: Hall is closed Friday',
      ),
    ).toBeTruthy();
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

  // `leave_group_thread` and `add_to_group_thread` shipped fully wired
  // server-side (migrations, grants, pgTAP) but with no caller anywhere in
  // app/ or components/: anyone sharing an active club with you could add
  // you to a group, and you had no leave, no mute, no block. This block
  // covers the client wiring that closes that gap.
  describe('group membership', () => {
    // A club or game thread's membership is derived, not stored -- there is
    // nothing to leave and nobody to add. Only a group or direct (both
    // thread.club_id === null) gets the Members affordance at all.
    it('offers no Members control on a club thread', async () => {
      render(<ThreadScreen />);
      await screen.findByText('Everyone at Riverside');
      expect(screen.queryByLabelText('Members')).toBeNull();
    });

    it('opens a members panel listing the roster, for a group thread', async () => {
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      expect(await screen.findByText('You')).toBeTruthy();
      expect(screen.getByText('Sara Lindqvist')).toBeTruthy();
      expect(screen.getByText('Peter Ng')).toBeTruthy();
      expect(screen.getByLabelText('Add people')).toBeTruthy();
      expect(screen.getByLabelText('Leave')).toBeTruthy();
    });

    // Friends first, then people from your clubs -- the same shape and the
    // same ordering app/messages/new.tsx's own People picker uses, reused
    // rather than a second way of gathering who is addable.
    it('adds the picked people to the group', async () => {
      fetchThread.mockResolvedValue(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      fireEvent.click(await screen.findByLabelText('Add people'));
      fireEvent.click(await screen.findByLabelText('Bob Reyes'));
      fireEvent.click(screen.getByLabelText('Add'));
      await waitFor(() =>
        expect(addToGroupThread).toHaveBeenCalledWith('t1', ['p1']),
      );
      // A successful add reloads the thread, the same way send() reloads
      // after posting -- the roster shown has to include who was just added.
      await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2));
    });

    // Guards against the same bug class as sendingRef: `addBusy` state is
    // read from the render closure, so a second activation landing before
    // React re-renders with the disabled button would otherwise double the
    // RPC call. Both clicks fire inside one `act()` so no render lands
    // between them.
    it('adds only once when Add is activated twice before it settles', async () => {
      let resolveAdd!: (value: { error: string | null }) => void;
      addToGroupThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAdd = resolve;
          }),
      );
      fetchThread.mockResolvedValue(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      fireEvent.click(await screen.findByLabelText('Add people'));
      fireEvent.click(await screen.findByLabelText('Bob Reyes'));
      const add = screen.getByLabelText('Add');

      act(() => {
        fireEvent.click(add);
        fireEvent.click(add);
      });

      expect(addToGroupThread).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveAdd({ error: null });
        await Promise.resolve();
      });
    });

    // Leaving deletes the last member's own view of the thread and, if
    // nobody is left, the thread itself -- the same irreversible shape as
    // an announcement, so it asks first with the identical two-step control
    // Send already uses on this screen.
    it('leaves on confirm and returns to the messages list', async () => {
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      fireEvent.click(await screen.findByLabelText('Leave'));
      expect(leaveGroupThread).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByLabelText('Confirm leave'));
      await waitFor(() => expect(leaveGroupThread).toHaveBeenCalledWith('t1'));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages'));
    });

    it('surfaces a refusal instead of leaving', async () => {
      leaveGroupThread.mockResolvedValueOnce({
        error: 'you are not in this conversation',
      });
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      fireEvent.click(await screen.findByLabelText('Leave'));
      fireEvent.click(await screen.findByLabelText('Confirm leave'));
      expect(
        await screen.findByText('you are not in this conversation'),
      ).toBeTruthy();
      expect(replace).not.toHaveBeenCalledWith('/messages');
    });

    // Same guard-ordering bug class as Add above, for the destructive action
    // that cannot be undone.
    it('leaves only once when Confirm is activated twice before it settles', async () => {
      let resolveLeave!: (value: { error: string | null }) => void;
      leaveGroupThread.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLeave = resolve;
          }),
      );
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText('Members'));
      fireEvent.click(await screen.findByLabelText('Leave'));
      const confirm = await screen.findByLabelText('Confirm leave');

      act(() => {
        fireEvent.click(confirm);
        fireEvent.click(confirm);
      });

      expect(leaveGroupThread).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveLeave({ error: null });
        await Promise.resolve();
      });
    });
  });
});
