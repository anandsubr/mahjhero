import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
// fetchThread's first query -- `from('message_threads').select(THREAD_COLUMNS)
// .eq('id', ...).single()`. Modelled as the real chain, the same reasoning
// lib/broadcasts.test.ts gives: a test exercising this should fail on a
// wrong VALUE, not on a TypeError from a missing chain method.
const singleMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: singleMock })),
      })),
    })),
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  addToGroupThread,
  createGroupThread,
  deriveSubject,
  fetchThread,
  fetchThreadMessages,
  fetchMyThreads,
  kindLabel,
  leaveGroupThread,
  messagePreview,
  postMessage,
  quoteStub,
  rowTitle,
  sectionThreads,
  sortThreads,
  threadTitleFor,
  unreadLabel,
  unreadSuffix,
  type ThreadDetail,
  type ThreadListRow,
} from './messages';

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

describe('deriveSubject', () => {
  // Mirrors post_message's SQL exactly. Drift here means the confirmation
  // shows the organizer one subject and the email carries another.
  it('takes the first line', () => {
    expect(deriveSubject('Hall is closed Friday\nUse the side door.')).toBe(
      'Hall is closed Friday',
    );
  });

  it('takes the whole body when there is no newline', () => {
    expect(deriveSubject('Door code is 4321')).toBe('Door code is 4321');
  });

  // A CR or LF here would let an organizer inject an SMTP header -- an extra
  // Bcc:, for one. Written as escapes deliberately: \u000b is an ASCII
  // control and \u0085 is in the C1 range, which Postgres's [[:cntrl:]]
  // covers under en_US.UTF-8 and a JS pattern stopping at \x7f misses
  // entirely. lib/broadcasts.ts records the same trap.
  it('strips control characters, C1 range included', () => {
    expect(deriveSubject('Hall\u000bclosed\u0085Friday')).toBe('HallclosedFriday');
  });

  it('ellipsizes past 120 characters', () => {
    const subject = deriveSubject('x'.repeat(200));
    expect(subject).toHaveLength(120);
    expect(subject.endsWith('…')).toBe(true);
  });

  it('is empty for a body with no usable first line', () => {
    expect(deriveSubject('   \n\nreal content')).toBe('');
  });

  // Postgres's `length()`/`left()` count characters, not UTF-16 code units.
  // `.length`/`.slice` count UTF-16 units, so an astral character (outside
  // the BMP, encoded as a surrogate pair) counts as ONE character server-side
  // and TWO client-side -- a mismatched truncation point, and `.slice` can
  // land exactly between the two halves of a pair. Each 😀 below is one
  // codepoint but two UTF-16 units, so this body is 130 codepoints / 260
  // units: a `.slice`-based truncation would cut at unit 119, inside a
  // surrogate pair, and disagree with Postgres about where 120 characters
  // ends.
  it('truncates by codepoint, not UTF-16 unit, so a surrogate pair is never split', () => {
    const subject = deriveSubject('😀'.repeat(130));
    expect(Array.from(subject)).toHaveLength(120);
    expect(subject.endsWith('…')).toBe(true);
    // Every UTF-16 unit pairs up correctly -- a split surrogate would leave
    // a lone low or high surrogate as its own "character" here.
    expect(Array.from(subject).every((ch) => ch !== '�')).toBe(true);
  });
});

describe('unreadLabel', () => {
  it('caps at 99+', () => {
    expect(unreadLabel(5)).toBe('5');
    expect(unreadLabel(99)).toBe('99');
    expect(unreadLabel(140)).toBe('99+');
  });
});

describe('quoteStub', () => {
  it('names the author and the quoted line', () => {
    expect(
      quoteStub({ body: 'Anyone free Tuesday?', profiles: { display_name: 'Sara' } }),
    ).toBe('Sara: Anyone free Tuesday?');
  });

  it('truncates a long quote -- the stub is a reminder, not a second copy', () => {
    const stub = quoteStub({ body: 'x'.repeat(200), profiles: null });
    expect(stub).toHaveLength(80);
    expect(stub?.endsWith('…')).toBe(true);
  });

  // Null covers both "nothing was quoted" and "the parent is gone", since
  // reply_to_id is `on delete set null`. The bubble renders as an ordinary
  // message either way rather than as an empty quote.
  it('is null when there is nothing to quote', () => {
    expect(quoteStub(null)).toBeNull();
  });
});

describe('kindLabel', () => {
  // The artboard's "club - kind" line. The club thread reads "Announcement"
  // there because that is what it is for, even though anyone can post in it.
  it('names each kind the way the design does', () => {
    expect(kindLabel('club')).toBe('Announcement');
    expect(kindLabel('game')).toBe('Game');
    expect(kindLabel('group')).toBe('Group');
    expect(kindLabel('direct')).toBe('Direct');
  });
});

describe('threadTitleFor', () => {
  function thread(over: Partial<ThreadDetail> = {}): ThreadDetail {
    return {
      id: 't1',
      club_id: null,
      event_id: null,
      title: null,
      clubs: null,
      events: null,
      thread_members: [
        { profile_id: 'me', profiles: { display_name: 'You' } },
        { profile_id: 'other', profiles: { display_name: 'Sara Lindqvist' } },
      ],
      ...over,
    };
  }

  it('names a direct thread from the other member', () => {
    expect(threadTitleFor(thread(), 'me')).toBe('Sara Lindqvist');
  });

  // profiles.display_name is `text not null default ''`, so a counterpart
  // who never set a name comes back as '' -- not null -- and `??` does not
  // catch an empty string. This is the direct-thread half of the same hole
  // ThreadListRow.title has in fetch_my_threads' SQL.
  it('falls back to Direct when the other member has no display name', () => {
    expect(
      threadTitleFor(
        thread({
          thread_members: [
            { profile_id: 'me', profiles: { display_name: 'You' } },
            { profile_id: 'other', profiles: { display_name: '' } },
          ],
        }),
        'me',
      ),
    ).toBe('Direct');
  });

  it('joins first names for a group', () => {
    expect(
      threadTitleFor(
        thread({
          thread_members: [
            { profile_id: 'me', profiles: { display_name: 'You' } },
            { profile_id: 'other', profiles: { display_name: 'Sara Lindqvist' } },
            { profile_id: 'third', profiles: { display_name: 'Peter Ng' } },
          ],
        }),
        'me',
      ),
    ).toBe('Sara, Peter');
  });

  // Every other member nameless -- `.filter(Boolean)` drops each empty first
  // name, and joining an empty array reads as a blank header instead of a
  // meaningful one.
  it('falls back to Group when every other member has no display name', () => {
    expect(
      threadTitleFor(
        thread({
          thread_members: [
            { profile_id: 'me', profiles: { display_name: 'You' } },
            { profile_id: 'other', profiles: { display_name: '' } },
            { profile_id: 'third', profiles: null },
          ],
        }),
        'me',
      ),
    ).toBe('Group');
  });
});

describe('rowTitle', () => {
  // fetch_my_threads' SQL can answer an untitled group's title with NULL
  // (string_agg over zero rows -- the caller is the thread's only member),
  // and ThreadListRow.title is typed to admit that honestly.
  it('falls back to the kind label when title is null', () => {
    expect(rowTitle(row({ title: null, kind: 'group' }))).toBe('Group');
  });

  // profiles.display_name defaults to '' (not null), so a direct thread
  // with a nameless counterpart answers '' rather than NULL -- a second,
  // reachable-today path to the same blank row.
  it('falls back to the kind label when title is empty', () => {
    expect(rowTitle(row({ title: '', kind: 'direct' }))).toBe('Direct');
  });

  it('uses the title when there is one', () => {
    expect(rowTitle(row({ title: 'Everyone at Riverside', kind: 'club' }))).toBe(
      'Everyone at Riverside',
    );
  });
});

describe('unreadSuffix', () => {
  // Composed onto an existing accessibilityLabel rather than read
  // separately: react-native-web's aria-label REPLACES the accessible name
  // computed from a Pressable's children, so UnreadBadge's own <Text> never
  // reaches assistive tech on any of its three parents unless the count is
  // folded into that same label.
  it('is empty at zero, so it can always be appended without a conditional', () => {
    expect(unreadSuffix(0)).toBe('');
  });

  it('names the count', () => {
    expect(unreadSuffix(5)).toBe(', 5 unread');
  });

  it('caps a large count the same way the badge does', () => {
    expect(unreadSuffix(140)).toBe(', 99+ unread');
  });
});

describe('addToGroupThread', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls add_to_group_thread with the thread and the picked members', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(addToGroupThread('t1', ['p1', 'p2'])).resolves.toEqual({
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('add_to_group_thread', {
      target_thread: 't1',
      p_members: ['p1', 'p2'],
    });
  });

  it('relays a refusal verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'you can only message people from your clubs or your friends' },
    });
    await expect(addToGroupThread('t1', ['p1'])).resolves.toEqual({
      error: 'you can only message people from your clubs or your friends',
    });
  });
});

describe('leaveGroupThread', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls leave_group_thread with the thread', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(leaveGroupThread('t1')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('leave_group_thread', {
      target_thread: 't1',
    });
  });
});

describe('messagePreview', () => {
  it('prefixes the author', () => {
    expect(messagePreview(row())).toBe('Alice Ng: See you Tuesday');
  });

  it('collapses newlines so a multi-line message stays one row', () => {
    expect(messagePreview(row({ last_body: 'One\nTwo' }))).toBe('Alice Ng: One Two');
  });

  // An empty club thread is listed before anybody posts. "No messages yet"
  // is a fact; a blank line reads as a rendering bug.
  it('says so when nothing has been posted', () => {
    expect(messagePreview(row({ last_body: null, last_author: null }))).toBe(
      'No messages yet',
    );
  });
});

describe('sortThreads', () => {
  const recent = row({ thread_id: 'a', last_message_at: '2026-08-26T10:00:00Z' });
  const older = row({ thread_id: 'b', last_message_at: '2026-08-20T10:00:00Z' });
  const never = row({ thread_id: 'c', last_message_at: null });

  it('puts the newest first and the never-posted-in last', () => {
    expect(sortThreads([older, never, recent]).map((t) => t.thread_id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('sectionThreads', () => {
  const clubThread = row({ thread_id: 'a', kind: 'club', club_name: 'Riverside' });
  const gameThread = row({
    thread_id: 'b',
    kind: 'game',
    club_name: 'Riverside',
    event_starts_at: '2026-08-27T18:00:00Z',
  });
  const direct = row({
    thread_id: 'c',
    kind: 'direct',
    club_id: null,
    club_name: null,
    title: 'Bob Reyes',
  });

  // Groups and directs are pinned above the clubs rather than filed under
  // one. A group's club is not a stable fact -- deriving it from the member
  // set would move the group between sections the moment somebody from
  // another club is added.
  it('pins People above the clubs', () => {
    const sections = sectionThreads([clubThread, gameThread, direct]);
    expect(sections[0].title).toBe('People');
    expect(sections[0].rows.map((r) => r.thread_id)).toEqual(['c']);
    expect(sections[1].title).toBe('Riverside');
  });

  it('puts the club thread before its games', () => {
    const sections = sectionThreads([gameThread, clubThread]);
    expect(sections[0].rows.map((r) => r.thread_id)).toEqual(['a', 'b']);
  });

  it('omits People entirely when there are no groups or directs', () => {
    const sections = sectionThreads([clubThread]);
    expect(sections.map((s) => s.title)).toEqual(['Riverside']);
  });

  it('carries each section total unread', () => {
    const sections = sectionThreads([
      { ...clubThread, unread: 2 },
      { ...gameThread, unread: 3 },
    ]);
    expect(sections[0].unread).toBe(5);
  });
});

describe('fetchMyThreads', () => {
  beforeEach(() => rpcMock.mockReset());

  it('returns the rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [row()], error: null });
    await expect(fetchMyThreads()).resolves.toEqual([row()]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_my_threads');
  });

  // null is "we could not ask"; [] is "you have no conversations". The list
  // shows an error for the first and an empty state for the second, and
  // collapsing them would make a network failure look like a fact about the
  // member.
  it('resolves null on failure rather than rejecting', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchMyThreads()).resolves.toBeNull();
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchMyThreads()).resolves.toBeNull();
  });
});

describe('fetchThreadMessages', () => {
  beforeEach(() => rpcMock.mockReset());

  // The fix, at the unit level: fetch_thread_messages (20260829080000) is
  // security definer, so it names a sender who is not the caller -- what a
  // raw `profiles(display_name)` embed cannot do, per MESSAGE_COLUMNS'
  // docstring. It also resolves the quoted parent inline, so there is no
  // second RPC call to assert here the way the old second-query shape had.
  it('maps sender names and the quoted parent from one RPC call', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: 'm1',
          author_id: 'u1',
          author_name: 'Alice Ng',
          body: 'Anyone free Tuesday?',
          subject: null,
          is_announcement: false,
          created_at: '2026-08-25T10:00:00Z',
          reply_to_id: null,
          reply_to_body: null,
          reply_to_author: null,
        },
        {
          id: 'm2',
          author_id: 'u2',
          author_name: 'Carol Chen',
          body: 'Yes, I am in.',
          subject: null,
          is_announcement: false,
          created_at: '2026-08-25T10:01:00Z',
          reply_to_id: 'm1',
          reply_to_body: 'Anyone free Tuesday?',
          reply_to_author: 'Alice Ng',
        },
      ],
      error: null,
    });

    await expect(fetchThreadMessages('t1')).resolves.toEqual([
      {
        id: 'm1',
        author_id: 'u1',
        body: 'Anyone free Tuesday?',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-25T10:00:00Z',
        profiles: { display_name: 'Alice Ng' },
        reply_to_id: null,
        reply_to: null,
      },
      {
        id: 'm2',
        author_id: 'u2',
        body: 'Yes, I am in.',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-25T10:01:00Z',
        profiles: { display_name: 'Carol Chen' },
        reply_to_id: 'm1',
        reply_to: { id: 'm1', body: 'Anyone free Tuesday?', profiles: { display_name: 'Alice Ng' } },
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_thread_messages', { target_thread: 't1' });
  });

  it('resolves null on failure rather than rejecting', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchThreadMessages('t1')).resolves.toBeNull();
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchThreadMessages('t1')).resolves.toBeNull();
  });
});

describe('fetchThread', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    singleMock.mockReset();
  });

  function thread(over: Partial<ThreadDetail> = {}): ThreadDetail {
    return {
      id: 't1',
      club_id: null,
      event_id: null,
      title: 'Cross-club Group',
      clubs: null,
      events: null,
      thread_members: [
        { profile_id: 'caller', profiles: { display_name: 'Caller' } },
        { profile_id: 'other', profiles: null },
      ],
      ...over,
    };
  }

  // The fix, at the unit level: thread_members' own profiles embed names
  // only the caller (profiles is self-only RLS, 20260822180000), so
  // fetchThread patches every other member's name back in from
  // thread_roster (20260829080000) -- a security definer RPC, gated the
  // same way club_roster is, for the one thread kind club_roster cannot
  // serve.
  it('merges thread_roster names into thread_members, including a co-member', async () => {
    singleMock.mockResolvedValueOnce({ data: thread(), error: null });
    rpcMock.mockResolvedValueOnce({
      data: [
        { profile_id: 'caller', display_name: 'Caller' },
        { profile_id: 'other', display_name: 'Other Member' },
      ],
      error: null,
    });

    await expect(fetchThread('t1')).resolves.toEqual(
      thread({
        thread_members: [
          { profile_id: 'caller', profiles: { display_name: 'Caller' } },
          { profile_id: 'other', profiles: { display_name: 'Other Member' } },
        ],
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith('thread_roster', { target_thread: 't1' });
  });

  // thread_roster answers empty for a club or game thread -- their
  // membership is derived, never materialised in thread_members -- so the
  // merge is a no-op and the (already empty) list passes through unchanged.
  it('leaves an empty thread_members list alone for a club or game thread', async () => {
    singleMock.mockResolvedValueOnce({
      data: thread({ club_id: 'c1', thread_members: [] }),
      error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await expect(fetchThread('t1')).resolves.toEqual(
      thread({ club_id: 'c1', thread_members: [] }),
    );
  });

  it('resolves null when the thread query fails', async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchThread('t1')).resolves.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('resolves null when thread_roster fails', async () => {
    singleMock.mockResolvedValueOnce({ data: thread(), error: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchThread('t1')).resolves.toBeNull();
  });

  it('never rejects', async () => {
    singleMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchThread('t1')).resolves.toBeNull();
  });
});

describe('postMessage', () => {
  beforeEach(() => rpcMock.mockReset());

  it('posts, defaulting announce to false', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm1', error: null });
    await expect(postMessage('t1', ' hello ')).resolves.toEqual({
      id: 'm1',
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'hello',
      p_announce: false,
      p_reply_to: null,
    });
  });

  it('carries the quoted message when replying', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm4', error: null });
    await postMessage('t1', 'Yes', false, 'm1');
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'Yes',
      p_announce: false,
      p_reply_to: 'm1',
    });
  });

  it('refuses an empty body before ever calling the RPC', async () => {
    await expect(postMessage('t1', '   ')).resolves.toEqual({
      id: null,
      error: 'Write something first.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // post_message's refusals are already written to be read by a member --
  // "you cannot post in this conversation" -- so they are relayed verbatim.
  // Same deliberate contract as addFriend in lib/friends.ts.
  it('relays a refusal verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'you cannot post in this conversation' },
    });
    await expect(postMessage('t1', 'hi')).resolves.toEqual({
      id: null,
      error: 'you cannot post in this conversation',
    });
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(postMessage('t1', 'hi')).resolves.toEqual({
      id: null,
      error: GENERIC_ERROR,
    });
  });
});

describe('createGroupThread', () => {
  beforeEach(() => rpcMock.mockReset());

  it('sends a null title for an unnamed group', async () => {
    rpcMock.mockResolvedValueOnce({ data: 't9', error: null });
    await expect(createGroupThread('  ', ['p1'])).resolves.toEqual({
      id: 't9',
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('create_group_thread', {
      p_title: null,
      p_members: ['p1'],
    });
  });

  it('refuses an empty member list before calling the RPC', async () => {
    await expect(createGroupThread('Anything', [])).resolves.toEqual({
      id: null,
      error: 'Pick somebody to message.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
