import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PostRow from '../PostRow';
import type { ClubPost } from '../../../lib/messages';

// A pure presentational component: no session, router, or focus-effect
// dependency to mock -- the same reasoning MessageBubble.test.tsx (this
// row's closest sibling) already records for itself.
const post: ClubPost = {
  id: 'p1',
  author_id: 'a1',
  author_name: 'Alice Chen',
  body: 'Anyone free Thursday?\nI have a table.',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:00:00.000Z',
  reply_count: 3,
  last_reply_at: '2026-08-30T12:00:00.000Z',
  last_activity_at: '2026-08-30T12:00:00.000Z',
  unread: 2,
};

describe('PostRow', () => {
  it('shows the first line as the title', () => {
    render(<PostRow post={post} onPress={() => {}} />);
    expect(screen.getByText('Anyone free Thursday?')).toBeTruthy();
  });

  it('shows an announcement by its subject and labels it', () => {
    render(
      <PostRow
        post={{ ...post, is_announcement: true, subject: 'Doors at seven' }}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText('Doors at seven')).toBeTruthy();
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('composes title, author, replies and unread into ONE label', () => {
    // accessibilityLabel on a Pressable REPLACES the name computed from its
    // children in react-native-web. It does not merge. Everything a screen
    // reader needs has to be in this one string.
    render(<PostRow post={post} onPress={() => {}} />);
    const label = screen.getByLabelText(/Anyone free Thursday\?/);
    expect(label.getAttribute('aria-label')).toContain('Alice Chen');
    expect(label.getAttribute('aria-label')).toContain('3 replies');
    expect(label.getAttribute('aria-label')).toContain('2 unread');
  });
});
