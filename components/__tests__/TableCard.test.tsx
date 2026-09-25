import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TableCard from '../TableCard';

const table = {
  id: 't1',
  label: 'Table 2',
  skill_tier: 'advanced' as const,
  capacity: 4,
};

const occupants = [
  {
    booking_id: 'b1',
    group_id: 'g1',
    profile_id: 'p1',
    display_name: 'Ravi K.',
    skill_level: 'advanced' as const,
    event_table_id: 't1',
    status: 'confirmed' as const,
    booked_by: 'p1',
    booked_by_name: 'Ravi K.',
    group_status: 'confirmed' as const,
    waitlist_position: null,
    created_at: '2026-08-20T10:00:00Z',
  },
];

describe('TableCard', () => {
  it('names the table and its tier', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('Table 2')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
    expect(screen.getByText('1/4 seated')).toBeTruthy();
    // Assert that seats-free text is no longer rendered
    expect(screen.queryByText(/seats? free/)).toBeNull();
  });

  it('shows your own seat as yours', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p1"
        onTakeSeat={vi.fn()}
      />,
    );
    // Your own name, with "You" on the seat's second line.
    expect(screen.getByText('Ravi K.')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('says who booked a seat for somebody else', () => {
    render(
      <TableCard
        table={table}
        occupants={[
          { ...occupants[0], profile_id: 'p9', display_name: 'You',
            booked_by: 'p1', booked_by_name: 'Ravi K.' },
        ]}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('Ravi K. booked this for you')).toBeTruthy();
  });

  it('calls for a fourth when it is one short and close', () => {
    render(
      <TableCard
        table={table}
        occupants={[occupants[0], { ...occupants[0], booking_id: 'b2', profile_id: 'p2', display_name: 'Dot M.' }, { ...occupants[0], booking_id: 'b3', profile_id: 'p3', display_name: 'Sue T.' }]}
        youId="p9"
        needsFourth
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('Needs a 4th')).toBeTruthy();
  });

  it('omits the rounds section when rounds is not supplied', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.queryByText('No rounds recorded yet.')).toBeNull();
  });

  it('shows the round log when rounds is supplied', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 8 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByText('Rounds')).toBeTruthy();
    expect(screen.getByText('1 played')).toBeTruthy();
    expect(screen.getByLabelText('Ravi K. won 8 points')).toBeTruthy();
  });

  it("shows each seated player's points, and badges the last round's winner", () => {
    render(
      <TableCard
        table={table}
        youId="p9"
        onTakeSeat={vi.fn()}
        occupants={[
          occupants[0],
          { ...occupants[0], booking_id: 'b2', profile_id: 'p2', display_name: 'Dot M.' },
        ]}
        rounds={[
          // Newest first: Dot won the latest round, Ravi both earlier ones.
          { id: 'r3', winner_profile_id: 'p2', winner_name: 'Dot M.', points: 25 },
          { id: 'r2', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 30 },
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 40 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByText('70 pts')).toBeTruthy();
    expect(screen.getByText('25 pts')).toBeTruthy();
    expect(screen.getByTestId('badge-winner-b2')).toBeTruthy();
    expect(screen.queryByTestId('badge-winner-b1')).toBeNull();
    // Round numbers count up from the oldest.
    expect(screen.getByText('Round 3')).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
  });

  // canRecordRound alone never opens a panel that wasn't already
  // open-able -- see SeatGrid's own docstring: recording rides on the SAME
  // organizer/self panel-access rule as Move/Remove/Leave, with no separate
  // per-seat gate of its own. So this test pairs canRecordRound with the
  // organizer bundle (otherTables/onMove/onRemove/openBookingId/
  // onToggleManage), matching how the event screen actually calls this --
  // canRecordRound is only ever true for an organizer or for your own seat,
  // both of which are already manageable seats by then.
  it('offers the win recorder on an occupied seat once canRecordRound is true', () => {
    function Harness() {
      const [openBookingId, setOpenBookingId] = useState<string | null>(null);
      return (
        <TableCard
          table={table}
          occupants={occupants}
          youId="p9"
          onTakeSeat={vi.fn()}
          rounds={[]}
          canRecordRound
          canDeleteRound={false}
          onRecordRound={vi.fn()}
          onDeleteRound={vi.fn()}
          otherTables={[{ id: 't2', label: 'Table 2' }]}
          onMove={vi.fn()}
          onRemove={vi.fn()}
          openBookingId={openBookingId}
          onToggleManage={(id) =>
            setOpenBookingId((current) => (current === id ? null : id))
          }
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Manage Ravi K.'s seat"));
    expect(screen.getByText('Winner of round 1')).toBeTruthy();
    expect(screen.getByLabelText('25 points')).toBeTruthy();
  });

  it('hides the round log and the points once the game is not live', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 8 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
        gameLive={false}
      />,
    );
    expect(screen.queryByText('Rounds')).toBeNull();
    expect(screen.queryByLabelText('Ravi K. won 8 points')).toBeNull();
    expect(screen.queryByText(/pts$/)).toBeNull();
  });
});

describe('TableCard: held seats (game invites)', () => {
  const heldInvite = {
    ...occupants[0],
    booking_id: 'b9',
    profile_id: 'p5',
    display_name: 'Owen B.',
    status: 'invited' as const,
    booked_by: 'p1',
    booked_by_name: 'Ravi K.',
    invite_holds_seat: true,
  };

  it('draws a held seat after the confirmed ones, named, with an Invited tag', () => {
    render(<TableCard table={table} occupants={[...occupants, heldInvite]} youId="p9" />);
    expect(screen.getByText('Owen B.')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.getAllByText('Empty')).toHaveLength(2);
  });

  it('draws an anonymous held seat for a viewer who may not see the name', () => {
    render(
      <TableCard
        table={table}
        occupants={[...occupants, { ...heldInvite, profile_id: null, display_name: null }]}
        youId="p9"
      />,
    );
    expect(screen.getAllByText('Invited')).toHaveLength(1);
    expect(screen.getAllByText('Empty')).toHaveLength(2);
  });

  it('lets an organizer withdraw a held seat', () => {
    const onWithdrawInvite = vi.fn();
    function Harness() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <TableCard
          table={table}
          occupants={[...occupants, heldInvite]}
          youId="p9"
          isOrganizer
          openBookingId={open}
          onToggleManage={(id) => setOpen((cur) => (cur === id ? null : id))}
          onWithdrawInvite={onWithdrawInvite}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Manage the invite for Owen B.'));
    fireEvent.click(screen.getByLabelText('Withdraw the invite to Owen B.'));
    expect(onWithdrawInvite).toHaveBeenCalledWith('b9');
  });

  it('lets the non-organizer sender withdraw it, but nobody else', () => {
    const { unmount } = render(
      <TableCard
        table={table}
        occupants={[...occupants, heldInvite]}
        youId="p1"
        openBookingId={null}
        onToggleManage={vi.fn()}
        onWithdrawInvite={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Manage the invite for Owen B.')).toBeTruthy();
    unmount();

    render(
      <TableCard
        table={table}
        occupants={[...occupants, heldInvite]}
        youId="p9"
        openBookingId={null}
        onToggleManage={vi.fn()}
        onWithdrawInvite={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Manage the invite for Owen B.')).toBeNull();
  });
});
