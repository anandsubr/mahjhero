import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Composer from '../Composer';
import type { ThreadMessage } from '../../../lib/messages';

// A pure presentational component: no session, router, or focus-effect
// dependency to mock -- the same reasoning MessageBubble.test.tsx's own
// header gives. app/__tests__/thread.test.tsx still exercises this through
// the real screen end to end; these tests exist so Tasks 11-12 can render
// Composer on its own with confidence.
function reply(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    author_id: 'other',
    body: 'We are one short for Tuesday.',
    subject: null,
    is_announcement: false,
    created_at: '2026-08-25T10:00:00.000Z',
    profiles: { display_name: 'Sara Lindqvist' },
    reply_to_id: null,
    reply_to: null,
    ...over,
  };
}

describe('Composer', () => {
  it('reports draft changes', () => {
    const onDraftChange = vi.fn();
    render(
      <Composer
        draft=""
        onDraftChange={onDraftChange}
        replyTo={null}
        onClearReply={() => {}}
        onSend={() => {}}
        sending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'On my way' },
    });
    expect(onDraftChange).toHaveBeenCalledWith('On my way');
  });

  // The screen never gated Send on draft content client-side -- postMessage
  // itself refuses an empty body ("Write something first.") and the screen
  // surfaces that refusal. Gating here too would be a second, disagreeing
  // opinion about what counts as sendable, so a plain click always calls
  // through when not already sending.
  it('calls onSend on a plain click, regardless of draft content', () => {
    const onSend = vi.fn();
    render(
      <Composer
        draft="   "
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={onSend}
        sending={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalled();
  });

  // `sending` is the caller's synchronously-written sendingRef surfaced as
  // a prop -- the caller still holds the ref (see [threadId].tsx's own
  // comment on sendingRef for why a render-state boolean alone is not a
  // sound guard). This only proves the prop disables the control; the
  // ref-based double-activation guard itself is covered on the real screen
  // in app/__tests__/thread.test.tsx.
  it('does not call onSend while sending', () => {
    const onSend = vi.fn();
    render(
      <Composer
        draft="hello"
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={onSend}
        sending
      />,
    );
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders no reply preview when there is nothing to reply to', () => {
    render(
      <Composer
        draft=""
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={() => {}}
        sending={false}
      />,
    );
    expect(screen.queryByLabelText('Cancel reply')).toBeNull();
  });

  it('shows the quoted stub and clears it on cancel', () => {
    const onClearReply = vi.fn();
    render(
      <Composer
        draft=""
        onDraftChange={() => {}}
        replyTo={reply()}
        onClearReply={onClearReply}
        onSend={() => {}}
        sending={false}
      />,
    );
    expect(
      screen.getByText('Sara Lindqvist: We are one short for Tuesday.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(onClearReply).toHaveBeenCalled();
  });

  // The artboard's composer is a 58x58 circular icon button beside a
  // 58-tall input -- the same assertion app/__tests__/thread.test.tsx
  // already carries for the full screen, repeated here since this is now
  // where that layout actually lives.
  it("matches the input's resting height to the send button's", () => {
    render(
      <Composer
        draft=""
        onDraftChange={() => {}}
        replyTo={null}
        onClearReply={() => {}}
        onSend={() => {}}
        sending={false}
      />,
    );
    const input = screen.getByLabelText('Message');
    expect(getComputedStyle(input).height).toBe('58px');
    const send = screen.getByLabelText('Send');
    expect(getComputedStyle(send).width).toBe('58px');
    expect(getComputedStyle(send).height).toBe('58px');
  });
});
