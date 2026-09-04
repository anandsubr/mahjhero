import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageBubble from '../MessageBubble';
import type { ThreadMessage } from '../../../lib/messages';

// Unlike an earlier round, MessageBubble's own tests need nothing mocked for
// lib/attachments any more: AttachmentGrid no longer calls `getSignedUrls`
// itself (that batching now happens once per screen load, above this
// component -- see AttachmentGrid's own `urls` prop docstring), and
// MessageBubble just forwards whatever `attachmentUrls` map its caller
// passes straight down as a prop.

// A pure presentational component: no session, router, or focus-effect
// dependency to mock -- unlike app/messages/[threadId].tsx (see that
// screen's own test for why those need care), MessageBubble reads nothing
// but its own props.
function message(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    author_id: 'a1',
    body: 'Anyone free Thursday?',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-30T10:00:00.000Z',
    profiles: { display_name: 'Alice Chen' },
    reply_to_id: null,
    reply_to: null,
    attachments: [],
    ...over,
  };
}

describe('MessageBubble', () => {
  it('renders the body', () => {
    render(<MessageBubble message={message()} mine={false} onReply={() => {}} />);
    expect(screen.getByText('Anyone free Thursday?')).toBeTruthy();
  });

  it("names the author on somebody else's message", () => {
    render(<MessageBubble message={message()} mine={false} onReply={() => {}} />);
    expect(screen.getByText('Alice Chen')).toBeTruthy();
  });

  it('does not name the author on your own message', () => {
    render(<MessageBubble message={message()} mine onReply={() => {}} />);
    expect(screen.queryByText('Alice Chen')).toBeNull();
  });

  it('renders an announcement with its subject, dropping a body that only repeats it', () => {
    render(
      <MessageBubble
        message={message({
          is_announcement: true,
          subject: 'Doors at seven',
          body: 'Doors at seven',
        })}
        mine={false}
        onReply={() => {}}
      />,
    );
    // ONCE, stated. This test's name is about DE-DUPLICATION -- the bug was
    // the subject printed, then the body repeating it -- and `getByText`
    // only caught that as a side effect of its own "found multiple elements"
    // throw, which reads as a broken query rather than as the claim failing.
    // The count is the claim, so it is what the test asserts.
    expect(screen.getAllByText('Doors at seven')).toHaveLength(1);
    expect(screen.getByText('Announcement')).toBeTruthy();
  });

  it('renders the quoted stub for a reply', () => {
    render(
      <MessageBubble
        message={message({
          reply_to_id: 'm0',
          reply_to: { id: 'm0', body: 'See you Tuesday', profiles: { display_name: 'Sara' } },
        })}
        mine={false}
        onReply={() => {}}
      />,
    );
    expect(screen.getByTestId('quote-stub')).toBeTruthy();
  });

  // The iOS/WhatsApp convention this bubble follows: a long press picks the
  // reply target, with no visible "Reply" control on screen. Same
  // mousedown-hold-mouseup stand-in app/__tests__/thread.test.tsx already
  // uses for react-native-web's timer-driven onLongPress.
  it('offers reply on long press, with no visible Reply control on screen', () => {
    const onReply = vi.fn();
    const m = message();
    render(<MessageBubble message={m} mine={false} onReply={onReply} />);
    expect(screen.queryByText('Reply')).toBeNull();

    const bubble = screen.getByTestId('bubble-m1');
    vi.useFakeTimers();
    act(() => {
      fireEvent.mouseDown(bubble);
      vi.advanceTimersByTime(600);
    });
    fireEvent.mouseUp(bubble);
    vi.useRealTimers();

    expect(onReply).toHaveBeenCalledWith(m);
  });

  // The accessible, always-reachable twin of the long press above: same
  // action, reachable by a plain click (what a screen reader's activate
  // gesture or a keyboard Enter both amount to), no long press required.
  it('keeps a real, accessibly-named reply control reachable without a long press', () => {
    const onReply = vi.fn();
    const m = message();
    render(<MessageBubble message={m} mine={false} onReply={onReply} />);
    fireEvent.click(screen.getByLabelText('Reply to Alice Chen'));
    expect(onReply).toHaveBeenCalledWith(m);
  });

  // The wiring this task adds: AttachmentGrid actually renders when a
  // message carries attachments (not just that the prop compiles).
  it('renders the attachment grid for a message that carries attachments', async () => {
    render(
      <MessageBubble
        message={message({
          attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
        })}
        mine={false}
        onReply={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('attachment-grid')).toBeTruthy());
  });

  // ThreadMessage.body can now be '' for an image-only message (Task 3/5).
  // AttachmentGrid renders null for an empty array, so the ordinary case
  // (no attachments, no body) must keep showing neither -- and an
  // image-only message must show the images with no empty gap where the
  // body text would have been.
  it('renders an image-only message (empty body) with its images and no empty body element', async () => {
    render(
      <MessageBubble
        message={message({
          body: '',
          attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
        })}
        mine={false}
        onReply={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('attachment-grid')).toBeTruthy());
    expect(screen.queryByText('Anyone free Thursday?')).toBeNull();
  });

  it('renders no attachment grid when the message carries none', () => {
    render(<MessageBubble message={message()} mine={false} onReply={() => {}} />);
    expect(screen.queryByTestId('attachment-grid')).toBeNull();
  });

  // The wiring finding #3's fix adds: `attachmentUrls` is the caller's
  // once-per-screen-load signed URL map (app/messages/[threadId].tsx,
  // app/messages/club/[threadId]/[postId].tsx), and MessageBubble's only job
  // is to forward it to AttachmentGrid untouched -- proven here by an actual
  // <img> appearing when the message's own path is a key in that map.
  it('forwards attachmentUrls to AttachmentGrid so a resolved path renders as an image', () => {
    render(
      <MessageBubble
        message={message({
          attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
        })}
        mine={false}
        onReply={() => {}}
        attachmentUrls={{ 't1/a.jpg': 'https://signed.example/a.jpg' }}
      />,
    );
    const img = document.body.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://signed.example/a.jpg');
  });
});
