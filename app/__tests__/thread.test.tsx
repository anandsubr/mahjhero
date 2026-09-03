import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ThreadScreen from '../messages/[threadId]';
import { groupSeparatorLabel } from '../../lib/messages';

// Hoisted rather than a fresh `vi.fn()` per `useRouter()` call: a factory
// returning brand-new mocks on every render would make `expect(replace)
// .toHaveBeenCalledWith(...)` assert against a mock instance the component
// never actually called, since each render gets its own. Same pattern
// app/__tests__/messages-new.test.tsx already uses for `push`/`replace`.
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();

vi.mock('expo-router', () => ({
  // Renders the href rather than null: this screen redirects a CLUB thread
  // to its board, and a mock that renders nothing cannot tell "redirected
  // somewhere" from "redirected to the right place". Same shape
  // app/__tests__/clubs.test.tsx already uses.
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, back, replace }),
  usePathname: () => '/messages/t1',
  useLocalSearchParams: () => ({ threadId: 't1' }),
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// A `vi.fn()` whose return value is set in `beforeEach` and held fixed for
// the body of a test, not a fresh object literal per render: a fresh object
// on every call breaks the referential stability the real Context provides
// and produces a genuine render loop in effects that depend on `session`.
// The regression test below reassigns it mid-test (same shape
// `app/__tests__/index-screen.test.tsx` and `lib/use-unread.test.tsx` already
// use) to model `lib/session.tsx` handing out a fresh `Session` object with
// the same user id on `TOKEN_REFRESHED` -- the trap `lib/use-unread.ts`'s
// docstring documents.
const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'me' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchThread = vi.fn();
const fetchThreadMessages = vi.fn();
const postMessage = vi.fn();
const markThreadRead = vi.fn();
const addToGroupThread = vi.fn();
const leaveGroupThread = vi.fn();
const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();

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
    // TabBar (now carried by this screen) calls `useUnreadCounts`, which
    // reaches this.
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

// The Realtime boundary, modeled after the real behavior traced in
// node_modules/@supabase/realtime-js, not just its call shape:
//
//  - `supabase.channel(topic)` REUSES: RealtimeClient.channel finds an
//    existing channel by topic and returns it rather than creating a
//    second one. A stub that hands back a fresh object per call cannot see
//    a bug that depends on the second call getting the SAME, already-
//    subscribed channel back.
//  - `.on()` on the real RealtimeChannel THROWS once the channel is
//    subscribed (RealtimeChannel.js:418) -- that's the exact crash this
//    file exists to catch, so the double has to be able to throw it too.
//  - `removeChannel` is ASYNC on the real client (it awaits
//    `channel.unsubscribe()` before deregistering the topic); a
//    synchronous double would let a test pass by accident on timing the
//    real client never provides, since a React cleanup can't await it.
// Typed as plain call signatures, not `ReturnType<typeof vi.fn>`: `vi.fn`
// is itself generic, so extracting its return type without pinning the
// type parameter resolves against the generic's constraint
// (`Procedure | Constructable`) rather than a real function, and a `Mock`
// of that union loses its call signature entirely -- `mock.on(...)` would
// no longer type-check as callable. `vi.fn(impl)` still returns a `Mock<T>`
// that is assignable to these plain signatures, so nothing about the
// mocking itself changes.
type MockChannel = {
  topic: string;
  subscribed: boolean;
  on: (...args: unknown[]) => MockChannel;
  subscribe: () => MockChannel;
  unsubscribe: () => Promise<string>;
};

let channelsByTopic: Map<string, MockChannel>;

function makeMockChannel(topic: string): MockChannel {
  const ch = {} as MockChannel;
  ch.topic = topic;
  ch.subscribed = false;
  ch.on = vi.fn((..._args: unknown[]) => {
    if (ch.subscribed) {
      throw new Error(
        `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
      );
    }
    return ch;
  });
  ch.subscribe = vi.fn(() => {
    ch.subscribed = true;
    return ch;
  });
  // Real unsubscribe() also returns a Promise; nothing here reads the
  // result, but shape parity with the client matters more than
  // convenience.
  ch.unsubscribe = vi.fn(async () => {
    // The real unsubscribe() waits on a server round trip before the
    // channel is actually torn down -- it does not flip synchronously.
    // React's cleanup for the old effect and the setup for the new one run
    // synchronously back to back in the same commit, with no microtask
    // flush in between; this await is what lets that new setup still find
    // the channel subscribed, exactly as the real async client does. A
    // synchronous flip here would make `subscribed` already false by the
    // time the new effect body runs, and the mock would fail to reproduce
    // the crash it exists to catch.
    await Promise.resolve();
    ch.subscribed = false;
    return 'ok';
  });
  return ch;
}

const channelFn = vi.fn<(topic: string) => MockChannel>((topic) => {
  const existing = channelsByTopic.get(topic);
  if (existing) return existing;
  const created = makeMockChannel(topic);
  channelsByTopic.set(topic, created);
  return created;
});

// Async, like the real RealtimeClient.removeChannel: it awaits the
// channel's own unsubscribe before the topic is free to be reused.
const removeChannel = vi.fn(async (ch: MockChannel): Promise<string> => {
  await ch.unsubscribe();
  channelsByTopic.delete(ch.topic);
  return 'ok';
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: (...a: [string]) => channelFn(...a),
    removeChannel: (...a: [MockChannel]) => removeChannel(...a),
  },
}));

// A CLUB thread -- which this screen no longer RENDERS. Its conversation is
// a board of posts, so the only thing left to assert about one here is that
// it is sent there; every other test in this file runs on a kind that still
// belongs on the flat screen.
const CLUB_THREAD = {
  id: 't1',
  club_id: 'c1',
  event_id: null,
  title: null,
  clubs: { name: 'Riverside', timezone: 'America/New_York' },
  events: null,
  thread_members: [],
};

// A GAME thread: club_id AND event_id, so it stays flat but still has
// DERIVED membership (bookings) with nothing to list or leave. It is the
// kind that now carries every "a thread with no members view" assertion the
// club thread used to, since it is the only one left on this screen whose
// club_id is set.
const GAME_THREAD = {
  id: 't1',
  club_id: 'c1',
  event_id: 'e1',
  title: null,
  clubs: { name: 'Riverside', timezone: 'America/New_York' },
  events: { title: 'Tuesday night mahjong', starts_at: '2026-08-25T18:00:00Z' },
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

// The members control's accessible name composes the thread title, the
// member count, and what pressing it does -- see the component's own
// comment on why. GROUP_THREAD's title (threadTitleFor's "join first
// names" branch) is "Sara, Peter", and it has 3 thread_members.
const GROUP_MEMBERS_LABEL = 'Sara, Peter, 3 members, view members';

// A genuine direct thread -- exactly one other member -- so the header
// avatar picks the 'direct' kind (initials) rather than 'group' (a people
// glyph).
const DIRECT_THREAD = {
  id: 't1',
  club_id: null,
  event_id: null,
  title: null,
  clubs: null,
  events: null,
  thread_members: [
    { profile_id: 'me', profiles: { display_name: 'You' } },
    { profile_id: 'other', profiles: { display_name: 'Bob Reyes' } },
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
    // clearAllMocks resets call history but not a mock's configured return
    // value, so both need re-establishing explicitly each test -- otherwise
    // whatever the previous test last set (a reassigned session, a leftover
    // topic) would leak forward.
    useSessionMock.mockReturnValue({ session: { user: { id: 'me' } }, loading: false });
    channelsByTopic = new Map();
    // A GROUP thread by default. The default used to be CLUB_THREAD, which
    // this screen redirects to the board now -- every test below that just
    // wants "a thread on the flat screen" gets one that still is.
    fetchThread.mockResolvedValue(GROUP_THREAD);
    fetchThreadMessages.mockResolvedValue(MESSAGES);
    postMessage.mockResolvedValue({ id: 'm3', error: null });
    markThreadRead.mockResolvedValue({ error: null });
    addToGroupThread.mockResolvedValue({ error: null });
    leaveGroupThread.mockResolvedValue({ error: null });
    fetchFriends.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Bob Reyes', club_names: [] },
    ]);
    fetchAddablePeople.mockResolvedValue([
      { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Riverside' },
    ]);
  });

  // A couple of the tests below fake the clock (either to hold a long-press
  // timer still, or to pin `groupSeparatorLabel`'s `now`) -- a test that fails
  // partway through and never reaches its own `vi.useRealTimers()` must not
  // leave fake timers active for every test that runs after it. Harmless to
  // call when timers are already real.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the thread title and every message', async () => {
    render(<ThreadScreen />);
    expect(await screen.findByText('Sara, Peter')).toBeTruthy();
    expect(screen.getByText('We are one short for Tuesday.')).toBeTruthy();
    expect(screen.getByText('I can take the seat.')).toBeTruthy();
  });

  /*
   * A club's conversation is a BOARD of root posts, not a flat chat, and
   * this screen cannot serve one. Three routing sites still sent an
   * organizer here; they were repointed, but a history entry, a bookmark or
   * a link shared before the change still names this URL. What it gave a
   * club member was a composer that silently started a new POST per line, no
   * Announcement control, a quote post_message refuses outright, and a badge
   * that never cleared -- so the screen catches it itself rather than
   * trusting every caller to remember.
   */
  it('sends a club thread to its board rather than rendering a flat chat', async () => {
    fetchThread.mockResolvedValueOnce(CLUB_THREAD);
    render(<ThreadScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/messages/club/t1');
    // Not even for a frame on the way past: the composer and the messages
    // are the flat screen, and neither is ever painted for a club thread.
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByText('We are one short for Tuesday.')).toBeNull();
  });

  // A game thread carries a club_id too, and it is still a flat chat. The
  // redirect keys on event_id being NULL as well, not on club_id alone --
  // get that wrong and every game conversation lands on a board that has no
  // posts and never will.
  it('leaves a game thread on the flat screen', async () => {
    fetchThread.mockResolvedValueOnce(GAME_THREAD);
    render(<ThreadScreen />);
    expect(await screen.findByText('Tuesday night mahjong')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.getByLabelText('Message')).toBeTruthy();
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

  // The artboard's composer is a 58×58 circular icon button beside a
  // 58-tall input -- matched heights, one shape. We shipped a text "Send"
  // pill with horizontal padding next to a multiline input whose rendered
  // height exceeded 58, so the two halves never lined up. Asserted on the
  // literal CSS `width`/`height`/`borderRadius` rather than a real layout
  // measurement (jsdom does not lay pages out) -- these are properties this
  // component sets directly, not ones a browser would need to compute.
  it('renders Send as a 58×58 circular icon button, not a text pill', async () => {
    render(<ThreadScreen />);
    const send = await screen.findByLabelText('Send');
    // No "Send" text node left inside it -- an icon button has no label to
    // change into "Confirm" the way the old text pill did.
    expect(screen.queryByText('Send')).toBeNull();
    const style = getComputedStyle(send);
    expect(style.width).toBe('58px');
    expect(style.height).toBe('58px');
    // Not `style.borderRadius` -- react-native-web emits the four longhand
    // corner properties, and jsdom's `getComputedStyle` does not synthesize
    // the shorthand back up from them (it reads back as '').
    expect(style.borderTopLeftRadius).toBe('999px');
  });

  // The input's resting height must match the button's -- not merely claim
  // to via `minHeight`, which is exactly what let a react-native-web
  // `<textarea>`'s own intrinsic rows push the box taller than 58 in the
  // first place. The fix sets an explicit `height`, which (unlike
  // `minHeight`) is a literal value `getComputedStyle` can read back even
  // without jsdom performing real layout.
  it("matches the composer input's resting height to the send button's", async () => {
    render(<ThreadScreen />);
    const input = await screen.findByLabelText('Message');
    expect(getComputedStyle(input).height).toBe('58px');
  });

  // The owner's call: composing an announcement (the toggle, its recipient-
  // count note, and the two-step Send/Confirm arming that existed only for
  // it) is gone until the redesign lands. Send is now a single tap that
  // always posts an ordinary message -- `announce` is always `false`, never
  // driven by UI state any more. `postMessage`'s own `announce` parameter,
  // `post_message`, `broadcast_recipients`, and the outbox fan-out are all
  // untouched below this screen -- see lib/broadcasts.ts's
  // countBroadcastRecipients, which loses its only caller here but stays in
  // place for the redesign to reattach a UI to.
  it('has no announce toggle, note, or confirm arming -- Send posts in a single tap', async () => {
    render(<ThreadScreen />);
    const input = await screen.findByLabelText('Message');
    expect(screen.queryByLabelText('Also email everyone')).toBeNull();
    expect(screen.queryByText(/Emails.*subject/)).toBeNull();

    fireEvent.change(input, {
      target: { value: 'Hall is closed Friday' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't1',
        'Hall is closed Friday',
        false,
        null,
      ),
    );
    expect(screen.queryByLabelText('Confirm send')).toBeNull();
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
    await waitFor(() => expect(channelsByTopic.size).toBe(1));
    const ch = [...channelsByTopic.values()][0];
    // The topic must still carry the thread id, so a live channel is
    // identifiable when debugging -- it need not equal `thread:t1` exactly,
    // since the fix makes it unique per subscription.
    expect(ch.topic.startsWith('thread:t1')).toBe(true);
    expect(ch.subscribe).toHaveBeenCalled();
    expect(ch.on).toHaveBeenCalledWith(
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
    expect(removeChannel).toHaveBeenCalledWith(ch);
  });

  // The regression this file exists to add. `session` is an OBJECT, and
  // lib/session.tsx hands out a fresh one on every onAuthStateChange --
  // TOKEN_REFRESHED included, which fires within the hour and on web tab
  // focus (see app/profile.tsx's identical comment, which documents the
  // same trap). If the effect below is keyed on that object, a same-user token
  // refresh re-runs it; `supabase.channel(topic)` then hands back the SAME,
  // still-subscribed channel (removeChannel is async, so the old channel's
  // teardown hasn't landed by the time the new effect body runs), and `.on()`
  // throws on an already-subscribed channel. A new session object with the
  // SAME user id is exactly what a token refresh produces, so that -- not a
  // changed user -- is the realistic trigger reproduced here.
  it('survives a same-user session refresh without throwing, and ends with exactly one live subscription', async () => {
    const { rerender } = render(<ThreadScreen />);
    await waitFor(() => expect(channelsByTopic.size).toBe(1));

    // A brand-new Session object, same user id -- what TOKEN_REFRESHED hands
    // `onAuthStateChange` in lib/session.tsx.
    useSessionMock.mockReturnValue({
      session: { user: { id: 'me' } },
      loading: false,
    });
    expect(() => rerender(<ThreadScreen />)).not.toThrow();

    await waitFor(() => {
      const live = [...channelsByTopic.values()].filter((c) => c.subscribed);
      expect(live.length).toBe(1);
    });
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

  // The screenshot the owner flagged shows "Hall closed this week" printed
  // TWICE -- once as the bold subject, once again as the body's own first
  // line -- because deriveSubject's stored subject IS the body's opening
  // line, character for character. The fix is in what this screen prints,
  // not in deriveSubject (which still has to store and mail the real
  // subject): the duplicated line should appear exactly once.
  it('does not repeat the subject as the body when they are the same line', async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      {
        id: 'm9',
        author_id: 'other',
        body: 'Hall closed this week\nWe will meet at the community center instead.',
        subject: 'Hall closed this week',
        is_announcement: true,
        created_at: '2026-08-25T10:00:00Z',
        profiles: { display_name: 'Alice Ng' },
        reply_to_id: null,
        reply_to: null,
      },
    ]);
    render(<ThreadScreen />);
    // One node carries this text -- the subject -- not a second, identical
    // line repeating it as the body.
    expect(await screen.findAllByText('Hall closed this week')).toHaveLength(1);
    expect(
      screen.getByText('We will meet at the community center instead.'),
    ).toBeTruthy();
  });

  // The inverse: a body whose first line genuinely differs from the subject
  // is not a duplicate, and must keep showing in full underneath it.
  it('still shows the body in full when its first line is not the subject', async () => {
    fetchThreadMessages.mockResolvedValueOnce([
      {
        id: 'm9',
        author_id: 'other',
        body: 'Please note the new schedule below.\nSaturday games move to 10am.',
        subject: 'Hall closed this week',
        is_announcement: true,
        created_at: '2026-08-25T10:00:00Z',
        profiles: { display_name: 'Alice Ng' },
        reply_to_id: null,
        reply_to: null,
      },
    ]);
    render(<ThreadScreen />);
    expect(await screen.findByText('Hall closed this week')).toBeTruthy();
    expect(
      screen.getByText(
        'Please note the new schedule below. Saturday games move to 10am.',
      ),
    ).toBeTruthy();
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

  // A thread with no messages used to render an enormous blank region
  // between the title and the composer -- the dashed-border empty card this
  // app already uses (app/messages/index.tsx, app/friends.tsx) instead of
  // silence.
  //
  // One line for every kind now. The club thread's own bespoke copy ("Post
  // the first one below") went with the redirect above: the branch that
  // chose it could only ever be reached by a club thread, and a club thread
  // never renders this screen. Its test went with it rather than being
  // reseeded onto a kind that would only have re-asserted the generic line
  // this test already covers.
  it('shows an empty state, not a blank scroller, for a thread with no messages', async () => {
    fetchThreadMessages.mockResolvedValueOnce([]);
    render(<ThreadScreen />);
    expect(
      await screen.findByText('No messages yet. Say hello to start the conversation.'),
    ).toBeTruthy();
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

  // The owner's fix for the loudest thing on the old screen: a permanent
  // orange "Reply" link on every single bubble. The iOS/WhatsApp convention
  // replaces it with a long press on the bubble itself -- no visible control
  // survives, and the same reply-target selection the old link performed
  // fires from holding the bubble down instead.
  it('picks the reply target with a long press on the bubble, with no visible Reply control on screen', async () => {
    render(<ThreadScreen />);
    const bubble = await screen.findByTestId('bubble-m1');
    // The loudest thing about the old screen: gone. Nothing on screen reads
    // "Reply" any more, visibly or otherwise as plain text content.
    expect(screen.queryByText('Reply')).toBeNull();

    // A held press: mousedown, hold past the long-press delay, mouseup --
    // react-native-web's own responder system schedules onLongPress off of
    // real DOM mousedown/touchstart, listened for at the document level, so
    // fireEvent.mouseDown here is a faithful stand-in for a real touch/mouse
    // hold. Fake timers hold the clock still across the delay rather than
    // waiting ~500ms of real test time; the state update from the timer's
    // callback is wrapped in act() so React commits it before the
    // assertions below run.
    vi.useFakeTimers();
    act(() => {
      fireEvent.mouseDown(bubble);
      vi.advanceTimersByTime(600);
    });
    fireEvent.mouseUp(bubble);
    vi.useRealTimers();

    // The identical stub the old "Reply" link produced -- only how it gets
    // picked has changed.
    expect(
      await screen.findByText('Sara Lindqvist: We are one short for Tuesday.'),
    ).toBeTruthy();
  });

  // Discoverability is the accepted cost of moving off a visible control --
  // but assistive-technology users cannot long-press meaningfully, so the
  // action must stay reachable another way. Each bubble keeps a real,
  // always-present control with the exact accessible name the old visible
  // link carried; it is only painted off-screen (a true 1x1 clip, not
  // aria-hidden/display:none, which would also remove it from screen
  // readers). A plain click -- what a screen reader's "activate" gesture or
  // a keyboard Enter on a focused element both amount to -- still reaches
  // it.
  it('keeps a real, accessibly-named reply control reachable without a long press', async () => {
    render(<ThreadScreen />);
    const replyControl = await screen.findByLabelText('Reply to Sara Lindqvist');
    fireEvent.click(replyControl);
    expect(
      await screen.findByText('Sara Lindqvist: We are one short for Tuesday.'),
    ).toBeTruthy();
  });

  // The design specifies an asymmetric, tail-clipped corner on the person
  // bubbles -- `22px 22px 22px 8px` for an incoming message, mirrored to
  // `22px 22px 8px 22px` for your own -- so they read as speech rather than
  // plain rounded boxes. Asserted on the literal longhand corner properties
  // react-native-web emits (jsdom does not synthesize the `border-radius`
  // shorthand back up from them), the same pattern the Send button's own
  // corner test above already uses.
  it('gives incoming and outgoing bubbles an asymmetric, tail-clipped corner', async () => {
    render(<ThreadScreen />);
    await screen.findByText('We are one short for Tuesday.');
    const theirs = getComputedStyle(screen.getByTestId('bubble-m1'));
    expect(theirs.borderTopLeftRadius).toBe('28px');
    expect(theirs.borderTopRightRadius).toBe('28px');
    expect(theirs.borderBottomRightRadius).toBe('28px');
    expect(theirs.borderBottomLeftRadius).toBe('8px');

    const mine = getComputedStyle(screen.getByTestId('bubble-m2'));
    expect(mine.borderTopLeftRadius).toBe('28px');
    expect(mine.borderTopRightRadius).toBe('28px');
    expect(mine.borderBottomRightRadius).toBe('8px');
    expect(mine.borderBottomLeftRadius).toBe('28px');
  });

  // The announcement bubble is full-width and addressed to everyone -- there
  // is no side for a tail to point from, so unlike the two person bubbles
  // just above it stays symmetric on all four corners rather than picking a
  // side to mis-tail.
  it('keeps the announcement bubble symmetric, not tailed like a person bubble', async () => {
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
    await screen.findByText('Announcement');
    const style = getComputedStyle(screen.getByTestId('bubble-m9'));
    expect(style.borderTopLeftRadius).toBe('28px');
    expect(style.borderTopRightRadius).toBe('28px');
    expect(style.borderBottomRightRadius).toBe('28px');
    expect(style.borderBottomLeftRadius).toBe('28px');
  });

  // iOS Messages puts no time inside a bubble at all -- the per-bubble
  // timestamp this screen used to render (in the incoming bubble's own
  // corner, the mine bubble's, and the announcement's) is gone. Time now
  // lives only in the centred separator between groups, covered below.
  it('shows no time inside an ordinary or mine bubble', async () => {
    render(<ThreadScreen />);
    const theirs = await screen.findByTestId('bubble-m1');
    const mine = screen.getByTestId('bubble-m2');
    const timePattern = /\d{1,2}:\d{2}\s?(am|pm)/i;
    expect(within(theirs).queryByText(timePattern)).toBeNull();
    expect(within(mine).queryByText(timePattern)).toBeNull();
  });

  it('shows no time inside an announcement bubble', async () => {
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
    const announcement = await screen.findByTestId('bubble-m9');
    expect(
      within(announcement).queryByText(/\d{1,2}:\d{2}\s?(am|pm)/i),
    ).toBeNull();
  });

  // MESSAGES' two rows are 5 minutes apart on the same day, well under the
  // grouping threshold -- so the group they form gets exactly one separator,
  // above the FIRST message, not one per message and not one before the
  // second. `groupSeparatorLabel` (already this app's one formatter for the
  // separator's text, reused rather than re-deriving it here) is called with
  // the real clock, exactly as the component itself does; faking only `Date`
  // pins `now` so the expectation is deterministic regardless of what day
  // this suite actually runs on.
  describe('group separators', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-25T20:00:00Z'));
    });

    it('shows one separator above the first message and none before the second, same-group message', async () => {
      render(<ThreadScreen />);
      await screen.findByText('We are one short for Tuesday.');
      expect(
        screen.getByText(groupSeparatorLabel(MESSAGES[0].created_at)),
      ).toBeTruthy();
      expect(
        screen.queryByText(groupSeparatorLabel(MESSAGES[1].created_at)),
      ).toBeNull();
    });

    // A third message an hour-plus after the second starts a new group of
    // its own -- a second separator appears, distinct from the first.
    it('adds a second separator once the gap crosses the threshold', async () => {
      fetchThreadMessages.mockResolvedValueOnce([
        ...MESSAGES,
        {
          id: 'm5',
          author_id: 'other',
          body: 'Still there?',
          subject: null,
          is_announcement: false,
          created_at: '2026-08-25T11:30:00Z',
          profiles: { display_name: 'Sara Lindqvist' },
          reply_to_id: null,
          reply_to: null,
        },
      ]);
      render(<ThreadScreen />);
      await screen.findByText('Still there?');
      expect(
        screen.getByText(groupSeparatorLabel(MESSAGES[0].created_at)),
      ).toBeTruthy();
      expect(
        screen.getByText(groupSeparatorLabel('2026-08-25T11:30:00Z')),
      ).toBeTruthy();
    });

    // Centred and muted -- `colors.textMuted` on `colors.bg`, the same
    // already-pinned 5.15:1 pairing lib/theme.test.ts holds for helper text
    // on the page background, reused rather than a new pin for a fresh one.
    it('centres the separator text in the already-pinned muted colour', async () => {
      render(<ThreadScreen />);
      const separator = await screen.findByText(
        groupSeparatorLabel(MESSAGES[0].created_at),
      );
      expect(getComputedStyle(separator).color).toBe('rgb(103, 97, 88)');
      expect(getComputedStyle(separator).textAlign).toBe('center');
    });
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
    //
    // A GAME thread rather than a club one: the rule is `club_id !== null`
    // and a game thread carries a club_id too, so this still tests exactly
    // what it tested -- on the only kind with derived membership that this
    // screen still renders.
    it('offers no Members control on a game thread', async () => {
      fetchThread.mockResolvedValueOnce(GAME_THREAD);
      render(<ThreadScreen />);
      await screen.findByText('Tuesday night mahjong');
      expect(screen.queryByLabelText(/view members/i)).toBeNull();
    });

    // react-native-web's aria-label REPLACES the accessible name computed
    // from a Pressable's children -- it does not merge with it. A test that
    // only looks for a "Members" control (as the previous round's tests did)
    // would pass even when the control's accessibilityLabel is the bare
    // string "Members", which is exactly the regression: the heading is the
    // only place the thread's title appears, so a screen-reader user who
    // never learns the label carries the title never learns which
    // conversation they are in. This asserts the accessible NAME itself
    // carries the title, not merely that some control exists.
    it("composes the thread title into the members control's accessible name", async () => {
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      await screen.findByText('Sara, Peter');
      expect(screen.queryByLabelText('Members')).toBeNull();
      expect(
        await screen.findByLabelText(/^Sara, Peter,.*view members$/),
      ).toBeTruthy();
    });

    it('opens a members panel listing the roster, for a group thread', async () => {
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
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

  // TabBar navigates with router.replace off an entry route that is itself
  // a Redirect, so the history stack is typically one deep. A thread screen
  // with no bar would be a dead end on native short of relaunching the app.
  it('carries the tab bar with Messages marked', async () => {
    render(<ThreadScreen />);
    await screen.findByText('Sara, Peter');
    expect(
      screen.getByRole('button', { name: 'Messages' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('carries the tab bar when the thread cannot be loaded', async () => {
    fetchThread.mockResolvedValueOnce(null);
    render(<ThreadScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Messages' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  // The iOS Messages convention the owner asked for: a compact back chevron
  // top-left, a circular avatar for the conversation, and its name in a
  // pill beneath it. The owner is knowingly reinstating a back control the
  // tab bar's own "Messages" tab made this screen drop a round ago -- but a
  // compact header chevron reads very differently from the text link that
  // was removed, so it is not the same regression coming back.
  describe('header', () => {
    it('shows a back chevron, distinctly named from the Messages tab, that returns to /messages', async () => {
      render(<ThreadScreen />);
      await screen.findByText('Sara, Peter');
      // Still exactly one control literally named "Messages" -- the tab
      // bar's own tab. The back chevron carries its own distinct accessible
      // name, so the two can never collapse into the same control the way
      // the old text back link once did.
      expect(screen.getAllByRole('button', { name: 'Messages' })).toHaveLength(1);
      fireEvent.click(screen.getByLabelText('Back to Messages'));
      expect(push).toHaveBeenCalledWith('/messages');
    });

    // The same per-kind treatment components/ThreadRow.tsx's list row already
    // renders, reused rather than a second copy that can drift -- see
    // components/ThreadAvatar.tsx. A group has no single person to initial,
    // so it gets the people glyph; the initials half of that treatment is
    // asserted by the direct-thread test just below, and the header-sized
    // CLUB avatar (unreachable from this screen now) keeps its own coverage
    // in components/__tests__/ThreadAvatar.test.tsx.
    it("renders the thread's avatar in the header", async () => {
      render(<ThreadScreen />);
      await screen.findByText('Sara, Peter');
      expect(screen.getByTestId('thread-header-avatar-group')).toBeTruthy();
    });

    it('shows the other member’s initials in the header avatar for a direct thread', async () => {
      fetchThread.mockResolvedValueOnce(DIRECT_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      await screen.findByText('Bob Reyes');
      expect(screen.getByTestId('thread-header-avatar-direct').textContent).toBe(
        'BR',
      );
    });

    // The name pill replaces the old pressable heading as the way into the
    // members view -- same accessible name, same panel, just a new control
    // carrying it.
    it('opens the members panel from the name pill for a group thread', async () => {
      fetchThread.mockResolvedValueOnce(GROUP_THREAD);
      fetchThreadMessages.mockResolvedValueOnce([]);
      render(<ThreadScreen />);
      fireEvent.click(await screen.findByLabelText(GROUP_MEMBERS_LABEL));
      expect(await screen.findByText('Sara Lindqvist')).toBeTruthy();
    });

    // A club or game thread has no members view to open -- rendering the
    // pill as a Pressable with a chevron anyway would be a control that
    // LOOKS tappable and does nothing, which is worse than one that plainly
    // isn't. It stays a plain, non-interactive label instead. On a GAME
    // thread here, for the reason the members-control test above records.
    it('gives the name pill no tap affordance on a game thread', async () => {
      fetchThread.mockResolvedValueOnce(GAME_THREAD);
      render(<ThreadScreen />);
      await screen.findByText('Tuesday night mahjong');
      expect(
        screen.queryByRole('button', { name: /Tuesday night mahjong/ }),
      ).toBeNull();
    });
  });
});
