import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageGroup from '../MessageGroup';
import type { ThreadMessage } from '../../../lib/messages';

// Pure presentational: nothing but props, so nothing to mock.
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

function theirs(messages: ThreadMessage[], onReply = vi.fn(), urls?: Record<string, string>) {
  return render(
    <MessageGroup
      messages={messages}
      mine={false}
      authorName="Alice Chen"
      onReply={onReply}
      attachmentUrls={urls}
    />,
  );
}

function mine(messages: ThreadMessage[], onReply = vi.fn()) {
  return render(
    <MessageGroup messages={messages} mine authorName="Me" onReply={onReply} />,
  );
}

describe('MessageGroup', () => {
  it("names somebody else once for a whole run, with one avatar", () => {
    theirs([message(), message({ id: 'm2', body: 'Or Friday' })]);
    expect(screen.getAllByText('Alice Chen')).toHaveLength(1);
    expect(screen.getAllByTestId('sender-avatar')).toHaveLength(1);
    expect(screen.getByText('Anyone free Thursday?')).toBeTruthy();
    expect(screen.getByText('Or Friday')).toBeTruthy();
  });

  it('draws your own run with no name and no avatar', () => {
    mine([message({ profiles: { display_name: 'Me' } })]);
    expect(screen.queryByText('Me')).toBeNull();
    expect(screen.queryByTestId('sender-avatar')).toBeNull();
  });

  it('shows a visible Reply chip under the last message of their run only, replying to that one', () => {
    const onReply = vi.fn();
    const last = message({ id: 'm2', body: 'Or Friday' });
    theirs([message(), last], onReply);
    expect(screen.getAllByText('Reply')).toHaveLength(1);
    fireEvent.click(screen.getByText('Reply'));
    expect(onReply).toHaveBeenCalledWith(last);
  });

  it('keeps an accessibly-named reply control for every message, chip or not', () => {
    const onReply = vi.fn();
    const first = message();
    theirs([first, message({ id: 'm2', body: 'Or Friday' })], onReply);
    const controls = screen.getAllByLabelText('Reply to Alice Chen');
    expect(controls).toHaveLength(2);
    fireEvent.click(controls[0]);
    expect(onReply).toHaveBeenCalledWith(first);
  });

  it('shows no visible Reply chip on your own messages', () => {
    mine([message()]);
    expect(screen.queryByText('Reply')).toBeNull();
  });

  // Same mousedown-hold-mouseup stand-in app/__tests__/thread.test.tsx uses
  // for react-native-web's timer-driven onLongPress.
  it('quotes any message in the run on long press', () => {
    const onReply = vi.fn();
    const first = message();
    theirs([first, message({ id: 'm2', body: 'Or Friday' })], onReply);
    const bubble = screen.getByTestId('bubble-m1');
    vi.useFakeTimers();
    act(() => {
      fireEvent.mouseDown(bubble);
      vi.advanceTimersByTime(600);
    });
    fireEvent.mouseUp(bubble);
    vi.useRealTimers();
    expect(onReply).toHaveBeenCalledWith(first);
  });

  it('renders the quoted stub for a reply, on either side', () => {
    const quoted = message({
      reply_to_id: 'm0',
      reply_to: { id: 'm0', body: 'See you Tuesday', profiles: { display_name: 'Sara' } },
    });
    const { unmount } = theirs([quoted]);
    expect(screen.getByTestId('quote-stub').textContent).toBe('Sara: See you Tuesday');
    unmount();
    mine([quoted]);
    expect(screen.getByTestId('quote-stub').textContent).toBe('Sara: See you Tuesday');
  });

  it('gives your first bubble the tail corner and tightens the top-right on the ones after it', () => {
    mine([message(), message({ id: 'm2', body: 'Or Friday' })]);
    const first = getComputedStyle(screen.getByText('Anyone free Thursday?').parentElement!);
    const second = getComputedStyle(screen.getByText('Or Friday').parentElement!);
    expect(first.borderTopRightRadius).toBe('20px');
    expect(first.borderBottomRightRadius).toBe('6px');
    expect(second.borderTopRightRadius).toBe('6px');
    expect(second.borderBottomRightRadius).toBe('6px');
  });

  it('renders images for an image-only message with no empty body', async () => {
    theirs([
      message({
        body: '',
        attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId('attachment-grid')).toBeTruthy());
    expect(screen.queryByText('Anyone free Thursday?')).toBeNull();
  });

  it('draws no bubble for your own image-only message', () => {
    const { container } = mine([
      message({
        body: '',
        attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
      }),
    ]);
    const bubbles = Array.from(container.querySelectorAll('div')).filter(
      (d) => getComputedStyle(d).backgroundColor === 'rgb(140, 73, 26)',
    );
    expect(bubbles).toHaveLength(0);
  });

  it('forwards attachmentUrls so a resolved path renders as an image', () => {
    theirs(
      [
        message({
          attachments: [{ id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 }],
        }),
      ],
      vi.fn(),
      { 't1/a.jpg': 'https://signed.example/a.jpg' },
    );
    const img = document.body.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://signed.example/a.jpg');
  });
});
