import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeartPill from '../board/HeartPill';
import CommentsPeek from '../board/CommentsPeek';
import PostCard from '../board/PostCard';
import type { FeedComment, FeedPost } from '../../lib/board';

const comment = (i: number): FeedComment => ({
  id: `c${i}`,
  authorId: `p${i}`,
  authorName: `Commenter ${i}`,
  body: `comment body ${i}`,
  createdAt: '2026-10-10T10:00:00Z',
});

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: 'post1',
  authorId: 'a1',
  authorName: 'Ann Lee',
  authorRole: 'member',
  body: 'Hello club',
  subject: null,
  isAnnouncement: false,
  createdAt: '2026-10-10T10:00:00Z',
  lastActivityAt: '2026-10-10T10:00:00Z',
  replyCount: 0,
  unread: false,
  heartCount: 0,
  heartedByMe: false,
  attachments: [],
  recentComments: [],
  ...over,
} as FeedPost);

const baseProps = { attachmentUrls: {}, onOpen: () => {}, onToggleHeart: () => {}, hearting: false };

describe('HeartPill', () => {
  it('labels, counts and presses', () => {
    const onPress = vi.fn();
    const { rerender } = render(<HeartPill count={3} hearted={false} busy={false} onPress={onPress} />);
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Heart this post' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<HeartPill count={4} hearted busy={false} onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Remove your heart' })).toBeTruthy();
  });

  it('is disabled while busy', () => {
    const onPress = vi.fn();
    render(<HeartPill count={1} hearted={false} busy onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Heart this post' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('CommentsPeek', () => {
  it('shows two comments and View all when total exceeds them', () => {
    const onPress = vi.fn();
    render(<CommentsPeek comments={[comment(1), comment(2)]} total={5} onPress={onPress} />);
    expect(screen.getByText('comment body 1')).toBeTruthy();
    expect(screen.getByText('Commenter 2')).toBeTruthy();
    fireEvent.click(screen.getByText('View all 5 comments'));
    expect(onPress).toHaveBeenCalled();
  });

  it('omits View all when everything is shown', () => {
    render(<CommentsPeek comments={[comment(1), comment(2)]} total={2} onPress={() => {}} />);
    expect(screen.queryByText(/View all/)).toBeNull();
  });

  it('clips comment text to two lines', () => {
    render(<CommentsPeek comments={[{ ...comment(1), body: 'x '.repeat(500) }]} total={1} onPress={() => {}} />);
    const el = screen.getByText(/^x x/);
    expect(el.style.webkitLineClamp || el.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
  });
});

describe('PostCard', () => {
  it('shows name, time and no Host tag for a member', () => {
    render(<PostCard post={post()} {...baseProps} />);
    expect(screen.getByText('Ann Lee')).toBeTruthy();
    expect(screen.queryByText('Host')).toBeNull();
    expect(screen.queryByText('Announcement')).toBeNull();
    expect(screen.getByText(/Oct/)).toBeTruthy();
  });

  it('shows Host for host and co_organizer only', () => {
    const { rerender } = render(<PostCard post={post({ authorRole: 'host' })} {...baseProps} />);
    expect(screen.getByText('Host')).toBeTruthy();
    rerender(<PostCard post={post({ authorRole: 'co_organizer' })} {...baseProps} />);
    expect(screen.getByText('Host')).toBeTruthy();
  });

  it('shows the Announcement tag', () => {
    render(<PostCard post={post({ isAnnouncement: true })} {...baseProps} />);
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('comment link opens the post; label follows the count', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<PostCard post={post({ replyCount: 3, recentComments: [comment(1), comment(2)] })} {...baseProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('3 comments'));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText('View all 3 comments')).toBeTruthy();
    rerender(<PostCard post={post()} {...baseProps} onOpen={onOpen} />);
    expect(screen.getByText('Comment')).toBeTruthy();
  });

  it('shows More for a long body and not a short one', () => {
    const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const { rerender } = render(<PostCard post={post({ body: long })} {...baseProps} />);
    expect(screen.getByText('More')).toBeTruthy();
    rerender(<PostCard post={post({ body: 'a\nb' })} {...baseProps} />);
    expect(screen.queryByText('More')).toBeNull();
    rerender(<PostCard post={post({ body: 'y'.repeat(700) })} {...baseProps} />);
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('renders the attachment grid when attachments exist', () => {
    const attachments = [{ id: 'm1', storage_path: 'p/1.jpg', width: 4, height: 3 }];
    render(<PostCard post={post({ attachments })} {...baseProps} attachmentUrls={{ 'p/1.jpg': 'http://x/1.jpg' }} />);
    expect(screen.getByTestId('attachment-grid')).toBeTruthy();
  });

  it('heart pill toggles', () => {
    const onToggleHeart = vi.fn();
    render(<PostCard post={post({ heartCount: 2 })} {...baseProps} onToggleHeart={onToggleHeart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Heart this post' }));
    expect(onToggleHeart).toHaveBeenCalled();
  });
});
