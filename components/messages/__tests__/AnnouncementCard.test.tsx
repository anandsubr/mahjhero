import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AnnouncementCard from '../AnnouncementCard';
import type { ThreadMessage } from '../../../lib/messages';

function announcement(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'n1',
    author_id: 'a1',
    body: 'Doors at seven',
    subject: 'Doors at seven',
    is_announcement: true,
    created_at: '2026-08-30T10:00:00.000Z',
    profiles: { display_name: 'Alice Chen' },
    reply_to_id: null,
    reply_to: null,
    attachments: [],
    ...over,
  };
}

describe('AnnouncementCard', () => {
  it('renders its tag and subject once, dropping a body that only repeats it', () => {
    render(<AnnouncementCard message={announcement()} onReply={() => {}} />);
    expect(screen.getAllByText('Doors at seven')).toHaveLength(1);
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('keeps an accessibly-named reply control', () => {
    const onReply = vi.fn();
    const m = announcement();
    render(<AnnouncementCard message={m} onReply={onReply} />);
    fireEvent.click(screen.getByLabelText('Reply to Alice Chen'));
    expect(onReply).toHaveBeenCalledWith(m);
  });
});
