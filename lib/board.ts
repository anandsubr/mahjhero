import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClubRole } from './clubs';
import { MONTHS } from './home';
import type { MessageAttachment } from './messages';
import { supabase } from './supabase';

export type FeedOrder = 'recent' | 'activity';

export type FeedComment = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: ClubRole | null;
  body: string;
  subject: string | null;
  isAnnouncement: boolean;
  createdAt: string;
  lastActivityAt: string;
  replyCount: number;
  unread: boolean;
  heartCount: number;
  heartedByMe: boolean;
  attachments: MessageAttachment[];
  recentComments: FeedComment[];
};

type AttachmentRow = { id: string; storage_path: string; width: number; height: number };
type CommentRow = {
  id: string; author_id: string; author_name: string | null; body: string; created_at: string;
};
type FeedRow = {
  id: string;
  author_id: string;
  author_name: string | null;
  author_role: ClubRole | null;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  reply_count: number;
  last_activity_at: string;
  unread: boolean;
  heart_count: number;
  hearted_by_me: boolean;
  attachments: AttachmentRow[] | null;
  recent_comments: CommentRow[] | null;
};

function mapRow(r: FeedRow): FeedPost {
  return {
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name ?? '',
    authorRole: r.author_role ?? null,
    body: r.body,
    subject: r.subject,
    isAnnouncement: r.is_announcement,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
    replyCount: r.reply_count,
    unread: r.unread,
    heartCount: r.heart_count,
    heartedByMe: r.hearted_by_me,
    attachments: (r.attachments ?? []).map((a) => ({
      id: a.id, storage_path: a.storage_path, width: a.width, height: a.height,
    })),
    recentComments: (r.recent_comments ?? []).map((c) => ({
      id: c.id,
      authorId: c.author_id,
      authorName: c.author_name ?? '',
      body: c.body,
      createdAt: c.created_at,
    })),
  };
}

/** One page (30) of the club board. `before` is the last row's sort key + id. */
export async function fetchClubFeed(
  threadId: string,
  order: FeedOrder,
  before?: { at: string; id: string },
): Promise<FeedPost[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_club_feed', {
      target_thread: threadId,
      p_order: order,
      p_before: before?.at ?? null,
      p_before_id: before?.id ?? null,
    });
    if (error) return null;
    return ((data ?? []) as FeedRow[]).map(mapRow);
  } catch {
    return null;
  }
}

export async function togglePostHeart(
  postId: string,
): Promise<{ hearted: boolean | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('toggle_post_heart', { p_post: postId });
    if (error) return { hearted: null, error: error.message };
    return { hearted: data === true, error: null };
  } catch (e) {
    return { hearted: null, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function clock(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Today, 8:35 AM" / "Yesterday, 7:59 PM" / "Tue 29 Sept, 7:59 PM" — device-local. */
export function postTimeLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(now).getTime() - startOf(d).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${clock(d)}`;
  if (days === 1) return `Yesterday, ${clock(d)}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(d)}`;
}

export function commentCountLabel(n: number): string {
  if (n <= 0) return 'Comment';
  return n === 1 ? '1 comment' : `${n} comments`;
}

/** Append `page` to `existing`, dropping ids already present (first wins). */
export function mergeFeedPages(existing: FeedPost[], page: FeedPost[]): FeedPost[] {
  const seen = new Set(existing.map((p) => p.id));
  const out = [...existing];
  for (const p of page) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

const ORDER_KEY = 'board:order';

export async function loadFeedOrder(): Promise<FeedOrder> {
  try {
    const v = await AsyncStorage.getItem(ORDER_KEY);
    return v === 'activity' ? 'activity' : 'recent';
  } catch {
    return 'recent';
  }
}

export async function saveFeedOrder(o: FeedOrder): Promise<void> {
  try {
    await AsyncStorage.setItem(ORDER_KEY, o);
  } catch {
    // preference only; losing it is harmless
  }
}
