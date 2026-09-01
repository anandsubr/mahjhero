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
  announcementBody,
  createGroupThread,
  deriveSubject,
  fetchClubPosts,
  fetchPostMessages,
  fetchThread,
  fetchThreadMessages,
  fetchMyThreads,
  groupSeparatorLabel,
  kindLabel,
  leaveGroupThread,
  markPostRead,
  messagePreview,
  orderThreadsForList,
  postMessage,
  postTitle,
  quoteStub,
  relativeTimestamp,
  replyCountLabel,
  rowSubtitle,
  rowTitle,
  sortThreads,
  startsNewGroup,
  threadKindFor,
  threadTitleFor,
  unreadLabel,
  unreadSuffix,
  type ClubPost,
  type ThreadDetail,
  type ThreadListRow,
} from './messages';

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    thread_id: 't1',
    kind: 'club',
    title: 'Riverside',
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

  // Postgres's bare `trim(x)` strips only the literal ASCII space, U+0020 --
  // confirmed live: `trim(U&'\00A0Doors at seven\00A0')` comes back
  // unchanged, length 16. JS's `.trim()` strips the whole ECMAScript
  // whitespace set, U+00A0 included, so a `.trim()` here would silently
  // disagree with what `subj := trim(subj)` actually stores: the preview
  // would read "Doors at seven" while the stored, emailed subject still
  // carried the trailing non-breaking space. The character must survive.
  it('keeps a non-breaking space Postgres would not trim', () => {
    expect(deriveSubject(' Doors at seven ')).toBe(' Doors at seven ');
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
    // Splitting a surrogate pair never produces U+FFFD -- it leaves a lone
    // \uD83D (or similar) in the string, which `ch !== '�'` can never catch
    // no matter what `subject` holds. Check for an actual unpaired
    // surrogate instead: a high surrogate not immediately followed by its
    // low half, or a low surrogate not immediately preceded by its high
    // half. A naive `.slice(0, 119)` truncation (by UTF-16 unit, not
    // codepoint) leaves exactly this at the cut point.
    const lonelySurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    expect(lonelySurrogate.test(subject)).toBe(false);
  });
});

describe('announcementBody', () => {
  // deriveSubject takes the body's own first line as the subject, so a
  // single-line-then-body announcement stores a subject that IS the body's
  // opening line, character for character. Rendering both the subject and
  // the full body says the same thing twice on screen. The fix is in the
  // rendering, not the derivation -- the subject genuinely is stored and
  // mailed as-is; only what the bubble prints changes.
  it('drops the first line when it repeats the subject', () => {
    expect(
      announcementBody(
        'Hall closed this week',
        'Hall closed this week\nWe will meet at the community center instead.',
      ),
    ).toBe('We will meet at the community center instead.');
  });

  // The comparison must survive whitespace differences -- deriveSubject
  // trims the subject it stores, so a body whose first line carries
  // different leading/trailing space (or internal double-spacing) from the
  // stored subject is still the same duplicate in substance.
  it('still treats it as a duplicate across whitespace differences', () => {
    expect(
      announcementBody(
        'Hall  closed   this week',
        '  Hall closed this week  \nSee you there.',
      ),
    ).toBe('See you there.');
  });

  // A body whose first line genuinely differs from the subject (an
  // organizer who wrote a proper subject line separate from the opening
  // sentence) must keep showing in full -- this is not a duplicate.
  it('keeps the body in full when the first line is not the subject', () => {
    expect(announcementBody('Hall is closed Friday', 'We open again Monday.')).toBe(
      'We open again Monday.',
    );
  });

  // A single-line announcement whose one line IS the subject has nothing
  // left to show once the duplicate is dropped -- an empty string, not a
  // lone leftover newline, so the caller can render nothing rather than a
  // blank gap.
  it('is empty when the body is only the subject, nothing more', () => {
    expect(announcementBody('Hall closed this week', 'Hall closed this week')).toBe('');
  });

  // A null subject (deriveSubject can produce one for a body with no
  // usable first line) can never legitimately match a real body line --
  // the body always renders in full.
  it('never drops anything when there is no subject to compare against', () => {
    expect(announcementBody(null, 'Hall closed this week\nSee you there.')).toBe(
      'Hall closed this week\nSee you there.',
    );
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

  // The owner's call: the artboard renders 'Everyone at ' + club.short from
  // a short name this app's clubs table has no column for, so substituting
  // the full name wrapped to two lines in the header and truncated in the
  // list ("Everyone at Riverside Mah Jongg"). A club thread's title is just
  // the club's own name instead -- one place this is decided, so the list
  // (fetch_my_threads' SQL) and the header (this function) cannot drift.
  it('names a club thread after its club, with no "Everyone at" prefix', () => {
    expect(
      threadTitleFor(
        thread({
          club_id: 'c1',
          clubs: { name: 'Riverside Mah Jongg', timezone: 'America/New_York' },
        }),
        'me',
      ),
    ).toBe('Riverside Mah Jongg');
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

describe('threadKindFor', () => {
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

  // The header avatar (app/messages/[threadId].tsx, via
  // components/ThreadAvatar.tsx) needs the same kind ThreadRow.tsx's list
  // row would have shown for this thread -- mirroring the same
  // club_id/event_id/other-member-count branches threadTitleFor already
  // reads, rather than a second copy of that branching at the call site.
  it('is game when the thread carries an event', () => {
    expect(threadKindFor(thread({ club_id: 'c1', event_id: 'e1' }), 'me')).toBe(
      'game',
    );
  });

  it('is club when the thread carries a club but no event', () => {
    expect(threadKindFor(thread({ club_id: 'c1' }), 'me')).toBe('club');
  });

  it('is direct when exactly one other member is in the thread', () => {
    expect(threadKindFor(thread(), 'me')).toBe('direct');
  });

  it('is group when more than one other member is in the thread', () => {
    expect(
      threadKindFor(
        thread({
          thread_members: [
            { profile_id: 'me', profiles: { display_name: 'You' } },
            { profile_id: 'other', profiles: { display_name: 'Sara Lindqvist' } },
            { profile_id: 'third', profiles: { display_name: 'Peter Ng' } },
          ],
        }),
        'me',
      ),
    ).toBe('group');
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
    expect(rowTitle(row({ title: 'Riverside', kind: 'club' }))).toBe('Riverside');
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

describe('orderThreadsForList', () => {
  // Replaces the old "Recent | By club" choice with the one order the
  // messages screen now uses: clubs first, then everything else newest
  // first. Pinning clubs at the top does both jobs the sort control used to
  // -- grouping ("By club") and floating active conversations up
  // ("Recent") -- so a member never sees a non-club thread ahead of a club
  // one, no matter how old the club thread is.
  it('puts every club thread ahead of every non-club thread, regardless of recency', () => {
    const staleClub = row({
      thread_id: 'club-old',
      kind: 'club',
      last_message_at: '2020-01-01T00:00:00Z',
    });
    const freshDirect = row({
      thread_id: 'direct-new',
      kind: 'direct',
      club_id: null,
      club_name: null,
      last_message_at: '2026-08-28T00:00:00Z',
    });
    expect(
      orderThreadsForList([freshDirect, staleClub]).map((r) => r.thread_id),
    ).toEqual(['club-old', 'direct-new']);
  });

  // Within the second band, newest last_message_at first and never-posted
  // (null) last -- sortThreads' own rule, reused rather than reimplemented.
  it('orders the non-club band newest first, nulls last', () => {
    const game = row({
      thread_id: 'game',
      kind: 'game',
      club_id: null,
      club_name: null,
      last_message_at: '2026-08-20T00:00:00Z',
    });
    const group = row({
      thread_id: 'group',
      kind: 'group',
      club_id: null,
      club_name: null,
      last_message_at: '2026-08-27T00:00:00Z',
    });
    const neverPosted = row({
      thread_id: 'direct-never',
      kind: 'direct',
      club_id: null,
      club_name: null,
      last_message_at: null,
    });
    expect(
      orderThreadsForList([game, neverPosted, group]).map((r) => r.thread_id),
    ).toEqual(['group', 'game', 'direct-never']);
  });

  // Club threads are always listed (one per club, empty or not), and among
  // themselves they still read newest-active-first -- a side effect of
  // sorting the whole list by recency before partitioning by kind, not a
  // second sort.
  it('keeps club threads newest first among themselves too', () => {
    const quietClub = row({
      thread_id: 'club-quiet',
      kind: 'club',
      club_id: 'c1',
      last_message_at: null,
    });
    const activeClub = row({
      thread_id: 'club-active',
      kind: 'club',
      club_id: 'c2',
      last_message_at: '2026-08-27T00:00:00Z',
    });
    expect(
      orderThreadsForList([quietClub, activeClub]).map((r) => r.thread_id),
    ).toEqual(['club-active', 'club-quiet']);
  });
});

describe('rowSubtitle', () => {
  // A club row's title already IS the club's name (rowTitle / fetch_my_threads),
  // so joining the club name onto the subtitle too says it twice while both
  // lines fight for width at narrow viewports. The kind label alone still
  // tells the member what this line is.
  it('drops the club name for a club row since the title already carries it', () => {
    expect(rowSubtitle(row({ kind: 'club', club_name: 'Riverside' }))).toBe('Announcement');
  });

  it('is just the kind label when there is no club', () => {
    expect(
      rowSubtitle(row({ kind: 'direct', club_id: null, club_name: null })),
    ).toBe('Direct');
  });

  // The flat list drops the game row's date tile (components/DateTile.tsx
  // does not fit a circular-avatar row), so the date moves in here instead,
  // through formatEventWhen -- the same function the dashboard and the
  // event screen use, rendered in the club's own timezone.
  it('carries a game thread’s formatted date instead of the kind label', () => {
    expect(
      rowSubtitle(
        row({
          kind: 'game',
          club_name: 'Riverside',
          event_starts_at: '2026-09-08T02:00:00Z',
          event_timezone: 'America/New_York',
        }),
      ),
    ).toBe('Riverside · Mon 7 Sept, 10:00 pm');
  });

  it('is just the date when a game thread somehow has no club', () => {
    expect(
      rowSubtitle(
        row({
          kind: 'game',
          club_id: null,
          club_name: null,
          event_starts_at: '2026-09-08T02:00:00Z',
          event_timezone: 'America/New_York',
        }),
      ),
    ).toBe('Mon 7 Sept, 10:00 pm');
  });

  // A game row with no starts_at (should not happen, but ThreadListRow
  // types it as nullable) falls back to the ordinary kind label rather than
  // rendering an empty date.
  it('falls back to the kind label when a game thread has no start time', () => {
    expect(
      rowSubtitle(row({ kind: 'game', club_name: 'Riverside', event_starts_at: null })),
    ).toBe('Riverside · Game');
  });
});

describe('relativeTimestamp', () => {
  const now = new Date('2026-08-27T12:00:00Z');

  it('is empty for a thread nobody has posted in', () => {
    expect(relativeTimestamp(null, now)).toBe('');
  });

  // Deliberately the VIEWER's local time (this suite runs under
  // TZ=America/New_York, per package.json's `test` script), not the club's
  // -- unlike formatEventWhen, which is always club-local because a game
  // has one real start time every member must agree on. An ordinary
  // message has no such shared instant to agree on.
  it('shows the time for a message sent today', () => {
    expect(relativeTimestamp('2026-08-27T09:05:00Z', now)).toBe('5:05 am');
  });

  it('shows the weekday for a message from earlier this week', () => {
    expect(relativeTimestamp('2026-08-24T09:05:00Z', now)).toBe('Mon');
  });

  it('shows the date for anything older than a week', () => {
    expect(relativeTimestamp('2026-08-01T09:05:00Z', now)).toBe('1 Aug');
  });
});

// The thread screen's per-bubble timestamp is gone (iOS Messages shows no
// time inside a bubble at all) -- in its place, a centred separator line
// appears above the first message of a new "group". `startsNewGroup`
// decides the boundary, pure and unit-tested here rather than inline in the
// screen, so the rule can be reasoned about without rendering anything.
describe('startsNewGroup', () => {
  it('is true for the first message in a thread', () => {
    expect(startsNewGroup('2026-08-27T09:00:00Z', null)).toBe(true);
  });

  it('is false for a message minutes after the previous one, same day', () => {
    expect(
      startsNewGroup('2026-08-27T09:05:00Z', '2026-08-27T09:00:00Z'),
    ).toBe(false);
  });

  // The gap threshold itself: roughly an hour, the iOS Messages rule of
  // thumb. Anything under it, same calendar day, stays one group.
  it('is false for a same-day gap just under the threshold', () => {
    expect(
      startsNewGroup('2026-08-27T09:59:59Z', '2026-08-27T09:00:00Z'),
    ).toBe(false);
  });

  it('is true for a same-day gap at or over the threshold', () => {
    expect(
      startsNewGroup('2026-08-27T10:00:00Z', '2026-08-27T09:00:00Z'),
    ).toBe(true);
  });

  // A new calendar day starts a new group even when the clock gap is tiny --
  // 03:58Z/04:02Z straddle midnight in America/New_York (this suite's TZ),
  // four minutes apart but on different local days.
  it('is true across a calendar-day boundary regardless of how small the gap is', () => {
    expect(
      startsNewGroup('2026-08-24T04:02:00Z', '2026-08-24T03:58:00Z'),
    ).toBe(true);
  });

  it('is true when either timestamp fails to parse', () => {
    expect(startsNewGroup('not-a-date', '2026-08-27T09:00:00Z')).toBe(true);
    expect(startsNewGroup('2026-08-27T09:00:00Z', 'not-a-date')).toBe(true);
  });
});

// The separator's own label -- the only place a time appears now that the
// per-bubble timestamp is gone, so it needs day context `relativeTimestamp`
// deliberately omits (that formatter is built for the LIST rows' bare
// "today" time). Mirrors `relativeTimestamp`'s and `formatEventWhen`'s
// (lib/events.ts) house style: 'en-GB', short weekday, hour12 lowercase
// am/pm.
describe('groupSeparatorLabel', () => {
  const now = new Date('2026-08-27T12:00:00Z');

  it('reads "Today" plus the time for a message sent today', () => {
    expect(groupSeparatorLabel('2026-08-27T09:05:00Z', now)).toBe('Today 5:05 am');
  });

  it('reads "Yesterday" plus the time for a message sent the day before', () => {
    expect(groupSeparatorLabel('2026-08-26T09:05:00Z', now)).toBe(
      'Yesterday 5:05 am',
    );
  });

  it('reads a bare weekday plus the time for a message within the week', () => {
    expect(groupSeparatorLabel('2026-08-24T09:05:00Z', now)).toBe('Mon 5:05 am');
  });

  it('reads the full date plus the time for anything older than a week', () => {
    expect(groupSeparatorLabel('2026-08-01T09:05:00Z', now)).toBe(
      'Sat 1 Aug, 5:05 am',
    );
  });

  // A year boundary: the date alone ("1 Aug") would misdescribe a message
  // from a different year as if it were recent, so the year joins the date
  // whenever it differs from `now`'s.
  it('adds the year when the message is from a different year than now', () => {
    expect(groupSeparatorLabel('2025-08-01T09:05:00Z', now)).toBe(
      'Fri, 1 Aug 2025, 5:05 am',
    );
  });

  it('is empty for a timestamp that fails to parse', () => {
    expect(groupSeparatorLabel('not-a-date', now)).toBe('');
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
      p_root: null,
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
      p_root: null,
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

describe('postTitle', () => {
  const base: ClubPost = {
    id: 'p1',
    author_id: 'a1',
    author_name: 'Alice',
    body: 'body',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-30T10:00:00.000Z',
    reply_count: 0,
    last_reply_at: null,
    last_activity_at: '2026-08-30T10:00:00.000Z',
    unread: 0,
  };

  it('uses the subject when the post has one', () => {
    expect(postTitle({ ...base, subject: 'Doors at seven' })).toBe('Doors at seven');
  });

  it('falls back to the first line of the body', () => {
    expect(postTitle({ ...base, body: 'Anyone free?\nI have a table.' }))
      .toBe('Anyone free?');
  });

  it('truncates a long first line rather than wrapping the whole row', () => {
    const long = 'x'.repeat(200);
    const title = postTitle({ ...base, body: long });
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
  });

  it('never returns an empty string', () => {
    expect(postTitle({ ...base, body: '   ' })).toBe('Untitled post');
  });
});

describe('replyCountLabel', () => {
  it('says nothing about a post with no replies', () => {
    expect(replyCountLabel(0)).toBe('No replies');
  });

  it('is singular at one', () => {
    expect(replyCountLabel(1)).toBe('1 reply');
  });

  it('is plural above one', () => {
    expect(replyCountLabel(4)).toBe('4 replies');
  });
});

describe('fetchClubPosts', () => {
  beforeEach(() => rpcMock.mockReset());

  it('resolves null when the RPC fails, never throws', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchClubPosts('t1')).resolves.toBeNull();
    expect(rpcMock).toHaveBeenCalledWith('fetch_club_posts', {
      target_thread: 't1',
      p_before: null,
    });
  });

  it('resolves an empty array when there are no posts', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchClubPosts('t1', '2026-08-20T10:00:00Z')).resolves.toEqual([]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_club_posts', {
      target_thread: 't1',
      p_before: '2026-08-20T10:00:00Z',
    });
  });
});

describe('fetchPostMessages', () => {
  beforeEach(() => rpcMock.mockReset());

  // Same mapping fetchThreadMessages produces -- mapThreadMessageRow is the
  // one function both call, so a break in either RPC's row shape is caught
  // here the same way it is caught for fetchThreadMessages above.
  it('maps sender names and the quoted parent, the same shape fetchThreadMessages produces', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: 'p1',
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
          id: 'p2',
          author_id: 'u2',
          author_name: 'Carol Chen',
          body: 'Yes, I am in.',
          subject: null,
          is_announcement: false,
          created_at: '2026-08-25T10:01:00Z',
          reply_to_id: 'p1',
          reply_to_body: 'Anyone free Tuesday?',
          reply_to_author: 'Alice Ng',
        },
      ],
      error: null,
    });

    await expect(fetchPostMessages('p1')).resolves.toEqual([
      {
        id: 'p1',
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
        id: 'p2',
        author_id: 'u2',
        body: 'Yes, I am in.',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-25T10:01:00Z',
        profiles: { display_name: 'Carol Chen' },
        reply_to_id: 'p1',
        reply_to: {
          id: 'p1',
          body: 'Anyone free Tuesday?',
          profiles: { display_name: 'Alice Ng' },
        },
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_post_messages', { p_root: 'p1' });
  });

  it('resolves null when the RPC fails, never throws', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchPostMessages('p1')).resolves.toBeNull();
  });

  // null is "we could not ask"; [] is "this post has no replies" -- the same
  // distinction fetchMyThreads' own tests pin above.
  it('resolves an empty array, not null, when the post has no messages', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchPostMessages('p1')).resolves.toEqual([]);
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchPostMessages('p1')).resolves.toBeNull();
  });
});

describe('markPostRead', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls mark_post_read with the post', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(markPostRead('p1')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('mark_post_read', { p_root: 'p1' });
  });

  // mark_post_read's refusals are already written to be read by a member --
  // "that post is no longer here" -- so they are relayed verbatim, the same
  // deliberate contract postMessage and addToGroupThread carry above.
  it('relays a refusal verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'that post is no longer here' },
    });
    await expect(markPostRead('p1')).resolves.toEqual({
      error: 'that post is no longer here',
    });
  });

  it('resolves rather than rejecting when the RPC throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(markPostRead('p1')).resolves.toEqual({ error: GENERIC_ERROR });
  });
});

describe('postMessage with a root', () => {
  beforeEach(() => rpcMock.mockReset());

  it('passes p_root through to the RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm1', error: null });
    await postMessage('t1', 'I am', false, null, 'root1');
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'I am',
      p_announce: false,
      p_reply_to: null,
      p_root: 'root1',
    });
  });

  it('still sends p_root: null for a flat thread', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm1', error: null });
    await postMessage('t1', 'hello');
    expect(rpcMock).toHaveBeenCalledWith('post_message', {
      target_thread: 't1',
      p_body: 'hello',
      p_announce: false,
      p_reply_to: null,
      p_root: null,
    });
  });
});
