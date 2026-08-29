import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { GENERIC_ERROR } from './constants';
import {
  createGroupThread,
  deriveSubject,
  fetchMyThreads,
  kindLabel,
  messagePreview,
  postMessage,
  quoteStub,
  sectionThreads,
  sortThreads,
  unreadLabel,
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
  // Same deliberate contract as sendBroadcast in lib/broadcasts.ts.
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
