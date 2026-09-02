import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MessageBubble from '../MessageBubble';
import type { ThreadMessage } from '../../../lib/messages';

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
});
