import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import ThreadRow from '../ThreadRow';
import UnreadBadge from '../UnreadBadge';
import type { ThreadListRow } from '../../lib/messages';

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    thread_id: 't1',
    kind: 'club',
    title: 'Riverside',
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

describe('ThreadRow', () => {
  it('shows the title, the club and kind line, and the preview', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    expect(screen.getByText('Riverside')).toBeTruthy();
    expect(screen.getByText('Alice Ng: See you Tuesday')).toBeTruthy();
  });

  // The title already IS the club's name ("Riverside") for a club row, so
  // the subtitle beneath it should not say the club's name again -- just
  // what the title doesn't already carry (the kind label).
  it('does not repeat the club name in a club row’s subtitle', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    expect(screen.getByText('Announcement')).toBeTruthy();
    expect(screen.queryByText('Riverside · Announcement')).toBeNull();
  });

  // A group or direct has no club, so the subtitle is the kind alone rather
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

  // Flat, uniform circular avatars replace the old card + DateTile
  // treatment. A club row's avatar carries the club's own initials.
  it('shows the club’s initials in the avatar for a club thread', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    const avatar = screen.getByTestId('thread-avatar-club');
    expect(avatar.textContent).toBe('R');
  });

  // A direct row's avatar carries the OTHER person's initials -- the row's
  // own title, since fetch_my_threads names a direct thread after its other
  // member.
  it('shows the other person’s initials in the avatar for a direct thread', () => {
    render(
      <ThreadRow
        row={row({ kind: 'direct', club_id: null, club_name: null, title: 'Bob Reyes' })}
        onPress={vi.fn()}
      />,
    );
    const avatar = screen.getByTestId('thread-avatar-direct');
    expect(avatar.textContent).toBe('BR');
  });

  // A group has no single person to show initials for, so it gets a people
  // glyph instead -- no initials text in that avatar.
  it('shows a people glyph rather than initials for a group thread', () => {
    render(
      <ThreadRow
        row={row({ kind: 'group', club_id: null, club_name: null, title: 'Weekend crew' })}
        onPress={vi.fn()}
      />,
    );
    const avatar = screen.getByTestId('thread-avatar-group');
    expect(avatar.textContent).toBe('');
  });

  // The date tile (components/DateTile.tsx, 52x70) does not fit a circular
  // avatar row, so a game thread gets a calendar glyph avatar instead, and
  // its date moves into the subtitle line via formatEventWhen.
  it('shows a calendar glyph and the formatted date in the subtitle for a game thread', () => {
    render(
      <ThreadRow
        row={row({
          kind: 'game',
          title: 'Tuesday Night',
          event_id: 'e1',
          event_starts_at: '2026-08-27T22:00:00Z',
          event_timezone: 'America/New_York',
        })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByTestId('thread-avatar-game')).toBeTruthy();
    expect(screen.queryByTestId('thread-date-tile')).toBeNull();
    expect(screen.getByText(/Riverside · .*6:00 pm/)).toBeTruthy();
  });

  it('reports a press', () => {
    const onPress = vi.fn();
    render(<ThreadRow row={row()} onPress={onPress} />);
    fireEvent.click(screen.getByLabelText('Riverside'));
    expect(onPress).toHaveBeenCalled();
  });

  // fetch_my_threads' SQL can answer title as NULL (an untitled group whose
  // only member left is the caller) or '' (a direct thread whose only other
  // member never set a display name, since profiles.display_name defaults
  // to '' rather than null). Both used to render a blank row and an
  // accessibilityLabel of null/''; rowTitle falls back to the kind label.
  it('shows the kind label instead of a blank row when title is missing', () => {
    render(
      <ThreadRow
        row={row({ title: null, kind: 'group', club_id: null, club_name: null })}
        onPress={vi.fn()}
      />,
    );
    // "Group" legitimately appears twice here -- once as the fallback
    // title, once as the subtitle's kind label (club_name is null too) -- so
    // this asserts there IS a title rather than a blank one, not that the
    // two happen to differ.
    expect(screen.getAllByText('Group')).toHaveLength(2);
    expect(screen.getByLabelText('Group')).toBeTruthy();
  });

  it('shows the kind label instead of a blank row when title is empty', () => {
    render(
      <ThreadRow
        row={row({ title: '', kind: 'direct', club_id: null, club_name: null })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Direct')).toBeTruthy();
  });

  // UnreadBadge's own <Text> never reaches assistive tech here:
  // accessibilityLabel on this Pressable emits aria-label on
  // react-native-web, which REPLACES the accessible name computed from
  // children rather than merging with it. The count has to be composed into
  // this same label instead.
  it('composes the unread count into the accessible name', () => {
    render(<ThreadRow row={row({ unread: 4 })} onPress={vi.fn()} />);
    expect(screen.getByLabelText('Riverside, 4 unread')).toBeTruthy();
  });

  it('carries no unread suffix when nothing is unread', () => {
    render(<ThreadRow row={row({ unread: 0 })} onPress={vi.fn()} />);
    expect(screen.getByLabelText('Riverside')).toBeTruthy();
  });

  // The trailing timestamp, in the viewer's own local time -- this suite
  // runs under TZ=America/New_York (package.json's `test` script).
  it('shows a relative timestamp for a thread with a last message', () => {
    render(
      <ThreadRow row={row({ last_message_at: '2026-08-01T09:05:00Z' })} onPress={vi.fn()} />,
    );
    expect(screen.getByText('1 Aug')).toBeTruthy();
  });

  // A club thread nobody has posted in has no last_message_at, so the
  // trailing column carries no timestamp at all rather than a misleading one.
  it('shows no timestamp for a thread nobody has posted in', () => {
    render(<ThreadRow row={row({ last_message_at: null })} onPress={vi.fn()} />);
    expect(screen.queryByTestId('thread-timestamp')).toBeNull();
  });

  // The hairline divider is inset to start at the text column, not the
  // screen edge -- react-native-web atomises StyleSheet.create into CSS
  // classes, so this must read the computed style rather than element.style.
  it('insets the divider past the avatar rather than running it to the screen edge', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    const divider = screen.getByTestId('thread-divider');
    expect(parseFloat(getComputedStyle(divider).left)).toBeGreaterThan(0);
  });

  // The list's last row passes showDivider={false} so the hairline does not
  // trail the final row.
  it('omits the divider when told this is the last row', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} showDivider={false} />);
    expect(screen.queryByTestId('thread-divider')).toBeNull();
  });

  // iOS Messages, the reference this row is modelled on, puts the timestamp
  // on the TITLE's line, right-aligned, rather than in a full-height
  // trailing column that steals width from every line of text. Asserted by
  // DOM containment (the title and the timestamp share one row container)
  // rather than by pixel position, since react-native-web atomises styles
  // into classes that a plain style-object comparison can't read.
  it('puts the timestamp on the title’s line rather than a separate column', () => {
    render(
      <ThreadRow row={row({ last_message_at: '2026-08-25T10:00:00Z' })} onPress={vi.fn()} />,
    );
    const titleRow = screen.getByTestId('thread-title-row');
    expect(within(titleRow).getByText('Riverside')).toBeTruthy();
    expect(within(titleRow).getByTestId('thread-timestamp')).toBeTruthy();
  });

  // The subtitle and preview run the FULL row width beneath the title line
  // -- they must not be nested inside the title/timestamp row, or they'd
  // inherit its cramped width instead of the whole row's.
  it('keeps the subtitle and preview out of the title row, spanning the full width', () => {
    render(<ThreadRow row={row()} onPress={vi.fn()} />);
    const titleRow = screen.getByTestId('thread-title-row');
    expect(within(titleRow).queryByText('Announcement')).toBeNull();
    expect(within(titleRow).queryByText('Alice Ng: See you Tuesday')).toBeNull();
  });

  // The unread badge reads best right beside the timestamp, at a glance,
  // rather than stranded on a lower line with nothing else in its row.
  it('places the unread badge on the title’s line, beside the timestamp', () => {
    render(<ThreadRow row={row({ unread: 4 })} onPress={vi.fn()} />);
    const titleRow = screen.getByTestId('thread-title-row');
    expect(within(titleRow).getByText('4')).toBeTruthy();
  });
});
