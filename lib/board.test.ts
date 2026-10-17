import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
const { store, storage } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
  return { store, storage };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import {
  commentCountLabel, fetchClubFeed, loadFeedOrder, mergeFeedPages, postTimeLabel,
  saveFeedOrder, togglePostHeart, type FeedPost,
} from './board';

const ROW = {
  id: 'p1', author_id: 'u1', author_name: 'Ann', author_role: 'host', body: 'Hi',
  subject: null, is_announcement: false, created_at: '2026-10-01T15:00:00Z',
  reply_count: 3, last_reply_at: '2026-10-02T15:00:00Z', last_activity_at: '2026-10-02T15:00:00Z',
  unread: 2, heart_count: 2, hearted_by_me: true,
  attachments: [{ id: 'a1', storage_path: 'x/y.jpg', width: 10, height: 20, sort_order: 0 }],
  recent_comments: [{ id: 'c1', author_id: 'u2', author_name: 'Bo', body: 'Yo', created_at: '2026-10-02T15:00:00Z' }],
};

beforeEach(() => { rpc.mockReset(); store.clear(); storage.getItem.mockClear(); storage.setItem.mockClear(); });

describe('fetchClubFeed', () => {
  it('calls fetch_club_feed with order and null cursor, maps rows', async () => {
    rpc.mockResolvedValueOnce({ data: [ROW], error: null });
    const posts = await fetchClubFeed('t1', 'recent');
    expect(rpc).toHaveBeenCalledWith('fetch_club_feed', {
      target_thread: 't1', p_order: 'recent', p_before: null, p_before_id: null,
    });
    expect(posts).toEqual([{
      id: 'p1', authorId: 'u1', authorName: 'Ann', authorRole: 'host', body: 'Hi', subject: null,
      isAnnouncement: false, createdAt: '2026-10-01T15:00:00Z', lastActivityAt: '2026-10-02T15:00:00Z',
      replyCount: 3, unread: true, heartCount: 2, heartedByMe: true,
      attachments: [{ id: 'a1', storage_path: 'x/y.jpg', width: 10, height: 20 }],
      recentComments: [{ id: 'c1', authorId: 'u2', authorName: 'Bo', body: 'Yo', createdAt: '2026-10-02T15:00:00Z' }],
    }]);
  });

  it('passes the keyset cursor and activity order', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await fetchClubFeed('t1', 'activity', { at: '2026-10-01T00:00:00Z', id: 'p9' });
    expect(rpc).toHaveBeenCalledWith('fetch_club_feed', {
      target_thread: 't1', p_order: 'activity', p_before: '2026-10-01T00:00:00Z', p_before_id: 'p9',
    });
  });

  it('sends p_limit only when a limit is given', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await fetchClubFeed('t1', 'recent', undefined, 75);
    expect(rpc).toHaveBeenCalledWith('fetch_club_feed', {
      target_thread: 't1', p_order: 'recent', p_before: null, p_before_id: null, p_limit: 75,
    });
  });

  it('tolerates null jsonb arrays and missing names', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...ROW, author_name: null, author_role: null, attachments: null, recent_comments: null }],
      error: null,
    });
    const [p] = (await fetchClubFeed('t1', 'recent'))!;
    expect(p.attachments).toEqual([]);
    expect(p.recentComments).toEqual([]);
    expect(p.authorRole).toBeNull();
    expect(p.authorName).toBe('');
  });

  it('maps unread count to a boolean', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, unread: 0 }], error: null });
    expect((await fetchClubFeed('t1', 'recent'))![0].unread).toBe(false);
  });

  it('returns null on error or throw', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await fetchClubFeed('t1', 'recent')).toBeNull();
    rpc.mockRejectedValueOnce(new Error('net'));
    expect(await fetchClubFeed('t1', 'recent')).toBeNull();
  });
});

describe('togglePostHeart', () => {
  it('maps data to hearted', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await togglePostHeart('p1')).toEqual({ hearted: true, error: null });
    expect(rpc).toHaveBeenCalledWith('toggle_post_heart', { p_post: 'p1' });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await togglePostHeart('p1')).toEqual({ hearted: false, error: null });
  });
  it('reports error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_a_post' } });
    expect(await togglePostHeart('p1')).toEqual({ hearted: null, error: 'not_a_post' });
    rpc.mockRejectedValueOnce(new Error('net'));
    const r = await togglePostHeart('p1');
    expect(r.hearted).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe('postTimeLabel', () => {
  // 2026-10-17 10:00 EDT
  const now = new Date('2026-10-17T14:00:00Z');
  it('Today', () => expect(postTimeLabel('2026-10-17T12:35:00Z', now)).toBe('Today, 8:35 AM'));
  it('Yesterday across midnight', () => {
    expect(postTimeLabel('2026-10-17T03:59:00Z', now)).toBe('Yesterday, 11:59 PM');
    expect(postTimeLabel('2026-10-16T23:59:00Z', now)).toBe('Yesterday, 7:59 PM');
  });
  it('Older uses weekday, day, month', () => {
    expect(postTimeLabel('2026-09-29T23:59:00Z', now)).toBe('Tue 29 Sept, 7:59 PM');
  });
  it('Dec 31 post is Yesterday on Jan 1', () => {
    const jan1 = new Date('2027-01-01T15:00:00Z');
    expect(postTimeLabel('2027-01-01T03:30:00Z', jan1)).toBe('Yesterday, 10:30 PM');
    expect(postTimeLabel('2026-12-31T20:00:00Z', jan1)).toBe('Yesterday, 3:00 PM');
  });
  it('noon and midnight', () => {
    expect(postTimeLabel('2026-10-17T16:00:00Z', new Date('2026-10-17T20:00:00Z'))).toBe('Today, 12:00 PM');
    expect(postTimeLabel('2026-10-17T04:05:00Z', now)).toBe('Today, 12:05 AM');
  });
});

describe('commentCountLabel', () => {
  it('pluralises', () => {
    expect(commentCountLabel(0)).toBe('Comment');
    expect(commentCountLabel(1)).toBe('1 comment');
    expect(commentCountLabel(2)).toBe('2 comments');
  });
});

describe('mergeFeedPages', () => {
  const p = (id: string, body = id) => ({ id, body }) as unknown as FeedPost;
  it('appends and keeps first occurrence', () => {
    const out = mergeFeedPages([p('a'), p('b')], [p('b', 'dup'), p('c')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out[1].body).toBe('b');
  });
});

describe('feed order preference', () => {
  it('defaults to recent, round-trips, ignores junk', async () => {
    expect(await loadFeedOrder()).toBe('recent');
    await saveFeedOrder('activity');
    expect(storage.setItem).toHaveBeenCalledWith('board:order', 'activity');
    expect(await loadFeedOrder()).toBe('activity');
    store.set('board:order', 'junk');
    expect(await loadFeedOrder()).toBe('recent');
  });
  it('is safe when storage throws', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('x'));
    expect(await loadFeedOrder()).toBe('recent');
    storage.setItem.mockRejectedValueOnce(new Error('x'));
    await expect(saveFeedOrder('activity')).resolves.toBeUndefined();
  });
});
