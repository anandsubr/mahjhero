import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SegmentedControl from '../SegmentedControl';
import ThreadRow from '../ThreadRow';
import UnreadBadge from '../UnreadBadge';
import type { ThreadListRow } from '../../lib/messages';

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    thread_id: 't1',
    kind: 'club',
    title: 'Everyone at Riverside',
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

describe('UnreadBadge', () => {
  it('shows the count', () => {
    render(<UnreadBadge count={3} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  // Zero is not "0" in a pill. A badge that renders at zero is a permanent
  // dot on the tab bar saying nothing.
  it('renders nothing at zero', () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container.textContent).toBe('');
  });

  it('caps a large count', () => {
    render(<UnreadBadge count={250} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { key: 'recent', label: 'Recent' },
    { key: 'club', label: 'By club' },
  ];

  it('marks the selected option and reports a change', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={options} value="recent" onChange={onChange} />,
    );
    expect(screen.getByText('Recent').closest('[aria-selected="true"]')).toBeTruthy();
    fireEvent.click(screen.getByText('By club'));
    expect(onChange).toHaveBeenCalledWith('club');
  });

  // Tapping the option you are already on must not churn the list.
  it('stays quiet when the selected option is tapped again', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={options} value="recent" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('Recent'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ThreadRow', () => {
  it('shows the title, the club and kind line, and the preview', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    expect(screen.getByText('Everyone at Riverside')).toBeTruthy();
    expect(screen.getByText('Riverside · Announcement')).toBeTruthy();
    expect(screen.getByText('Alice Ng: See you Tuesday')).toBeTruthy();
  });

  // A group or direct has no club, so the kicker is the kind alone rather
  // than a stray separator.
  it('drops the separator when there is no club', () => {
    render(
      <ThreadRow
        row={row({ kind: 'direct', club_id: null, club_name: null, title: 'Bob Reyes' })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText('Direct')).toBeTruthy();
  });

  it('carries an unread badge only when there is something unread', () => {
    const { rerender } = render(<ThreadRow row={row()} onPress={vi.fn()} />);
    expect(screen.queryByText('0')).toBeNull();
    rerender(<ThreadRow row={row({ unread: 4 })} onPress={vi.fn()} />);
    expect(screen.getByText('4')).toBeTruthy();
  });

  // The date tile is what makes a game thread readable as a game at a
  // glance, and it is the existing component rather than a second 52x70
  // tile drawn here.
  it('shows a date tile for a game thread and not for a club thread', () => {
    const { rerender } = render(
      <ThreadRow
        row={row({
          kind: 'game',
          title: 'Tuesday Night',
          event_id: 'e1',
          event_starts_at: '2026-08-27T22:00:00Z',
        })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByTestId('thread-date-tile')).toBeTruthy();
    rerender(<ThreadRow row={row()} onPress={vi.fn()} />);
    expect(screen.queryByTestId('thread-date-tile')).toBeNull();
  });

  it('reports a press', () => {
    const onPress = vi.fn();
    render(<ThreadRow row={row()} onPress={onPress} />);
    fireEvent.click(screen.getByLabelText('Everyone at Riverside'));
    expect(onPress).toHaveBeenCalled();
  });
});
