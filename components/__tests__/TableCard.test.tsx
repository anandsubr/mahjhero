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
  });

  it('says how many seats are left', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('3 seats free')).toBeTruthy();
  });

  it('singularises one seat', () => {
    render(
      <TableCard
        table={{ ...table, capacity: 2 }}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('1 seat free')).toBeTruthy();
  });

  it('says Full rather than "0 seats free"', () => {
    render(
      <TableCard
        table={{ ...table, capacity: 1 }}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.queryByText('0 seats free')).toBeNull();
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
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('Ravi K.')).toBeNull();
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

  it('still offers a round timer when rounds is not supplied', () => {
    // RoundTimer is pure local UI state, independent of whether the rounds
    // fetch succeeded -- a transient fetch failure (rounds undefined)
    // should not take away an otherwise-workable, unrelated control.
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Start a 15-minute timer for Table 2',
      }),
    ).toBeTruthy();
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
    expect(screen.getByText('Ravi K. · 8 pts')).toBeTruthy();
  });

  it('shows a round badge for a seated player with recorded points, and a star for the leader', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[
          { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ravi K.', points: 30 },
        ]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(screen.getByTestId('badge-star-b1')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
  });

  // canRecordRound alone never opens a panel that wasn't already
  // open-able -- see SeatGrid's own docstring: recording rides on the SAME
  // organizer/self panel-access rule as Move/Remove/Leave, with no separate
  // per-seat gate of its own. So this test pairs canRecordRound with the
  // organizer bundle (otherTables/onMove/onRemove/openBookingId/
  // onToggleManage), matching how the event screen actually calls this --
  // canRecordRound is only ever true for an organizer or for your own seat,
  // both of which are already manageable seats by then.
  it('offers "Record a win" on an occupied seat once canRecordRound is true', () => {
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
    expect(screen.getByLabelText('Record a win for Ravi K.')).toBeTruthy();
  });

  it('offers a round timer', () => {
    render(
      <TableCard
        table={table}
        occupants={occupants}
        youId="p9"
        onTakeSeat={vi.fn()}
        rounds={[]}
        canRecordRound={false}
        canDeleteRound={false}
        onRecordRound={vi.fn()}
        onDeleteRound={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Start a 15-minute timer for Table 2',
      }),
    ).toBeTruthy();
  });
});
