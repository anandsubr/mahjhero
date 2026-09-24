import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WaitlistPanel from '../WaitlistPanel';

const NOW = new Date('2026-08-23T12:00:00Z');

const UNSEATED = {
  booking_id: 'b1',
  group_id: 'g1',
  profile_id: 'p1',
  display_name: 'Mei L.',
  skill_level: null,
  event_table_id: null,
  status: 'confirmed' as const,
  booked_by: 'p1',
  booked_by_name: 'Mei L.',
  group_status: 'confirmed' as const,
  waitlist_position: null,
  created_at: '2026-08-20T10:00:00Z',
};

const TABLES = [
  { id: 't1', label: 'Table 1' },
  { id: 't2', label: 'Table 2' },
];

describe('WaitlistPanel: "Coming, not yet seated"', () => {
  it('lists an unplaced booking exactly once', () => {
    render(
      <WaitlistPanel
        unseated={[UNSEATED]}
        waiting={[]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getAllByText('Mei L.')).toHaveLength(1);
  });

  // The member-facing default: no `tables`/`onSeat`, so no seat action --
  // just the read-only line explaining what happens next.
  it('offers no seat action and reads "the host will place them" without tables/onSeat', () => {
    render(
      <WaitlistPanel
        unseated={[UNSEATED]}
        waiting={[]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(
      screen.getByText('The host will place them at a table.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Seat Mei L. at Table 1')).toBeNull();
  });

  // Host view: one "Seat at …" option per table, from this single row --
  // this IS the fix for the bug where an unplaced booking used to appear
  // once per table's own HostSeating.
  it('offers one "Seat at …" button per table when tables/onSeat are supplied, and calls onSeat', () => {
    const onSeat = vi.fn();
    render(
      <WaitlistPanel
        unseated={[UNSEATED]}
        waiting={[]}
        youId="someone-else"
        offer={null}
        now={NOW}
        tables={TABLES}
        onSeat={onSeat}
      />,
    );
    expect(screen.getByLabelText('Seat Mei L. at Table 1')).toBeTruthy();
    expect(screen.getByLabelText('Seat Mei L. at Table 2')).toBeTruthy();
    expect(
      screen.queryByText('The host will place them at a table.'),
    ).toBeNull();

    fireEvent.click(screen.getByLabelText('Seat Mei L. at Table 2'));
    expect(onSeat).toHaveBeenCalledWith('b1', 't2');
  });

  it('pluralises the read-only line for more than one unplaced booking', () => {
    render(
      <WaitlistPanel
        unseated={[UNSEATED, { ...UNSEATED, booking_id: 'b2', display_name: 'Sam T.' }]}
        waiting={[]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(
      screen.getByText('The host will place these players at a table.'),
    ).toBeTruthy();
  });

  it("shows 'You' rather than the display name for the signed-in member's own unplaced booking", () => {
    render(
      <WaitlistPanel
        unseated={[{ ...UNSEATED, profile_id: 'me' }]}
        waiting={[]}
        youId="me"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('Mei L.')).toBeNull();
  });
});

describe('WaitlistPanel: table-less invites', () => {
  const INVITED = {
    ...UNSEATED,
    booking_id: 'b9',
    profile_id: 'p9',
    display_name: 'Jane P.',
    status: 'invited' as const,
    booked_by: 'p1',
    booked_by_name: 'Mei L.',
    invite_holds_seat: false,
  };

  it('renders with nothing but a pending invite', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[INVITED]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.getByText('Invited — would join the waitlist')).toBeTruthy();
  });

  it('says a held any-table invite holds a seat', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[{ ...INVITED, invite_holds_seat: true }]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Invited — seat held')).toBeTruthy();
  });

  it('names nobody on an anonymous invite', () => {
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[{ ...INVITED, profile_id: null, display_name: null }]}
        youId="someone-else"
        offer={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('Someone')).toBeTruthy();
  });

  it('offers Withdraw invite only where canWithdraw allows it', () => {
    const onWithdrawInvite = vi.fn();
    render(
      <WaitlistPanel
        unseated={[]}
        waiting={[]}
        invited={[INVITED, { ...INVITED, booking_id: 'b10', display_name: 'Kim S.' }]}
        youId="p1"
        offer={null}
        now={NOW}
        canWithdraw={(o) => o.booking_id === 'b9'}
        onWithdrawInvite={onWithdrawInvite}
      />,
    );
    expect(screen.queryByLabelText('Withdraw the invite to Kim S.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Jane P.'));
    expect(onWithdrawInvite).toHaveBeenCalledWith('b9');
  });
});
