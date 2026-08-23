import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HostSeating from '../HostSeating';

const place = vi.fn();
const remove = vi.fn();
const call = vi.fn();

// `position` is a required EventTable field (lib/events.ts) — the brief's
// own fixture omitted it, which does not typecheck against the real type.
const tables = [
  { id: 't1', label: 'Table 1', skill_tier: 'mixed' as const, capacity: 4, position: 1 },
  { id: 't2', label: 'Table 2', skill_tier: 'advanced' as const, capacity: 4, position: 2 },
];

const seated = {
  booking_id: 'b1',
  group_id: 'g1',
  profile_id: 'p1',
  display_name: 'Ravi K.',
  skill_level: null,
  event_table_id: 't1',
  status: 'confirmed' as const,
  booked_by: 'p1',
  booked_by_name: 'Ravi K.',
  group_status: 'confirmed' as const,
  waitlist_position: null,
  created_at: '2026-08-20T10:00:00Z',
};

const unplaced = {
  ...seated,
  booking_id: 'b2',
  profile_id: 'p2',
  display_name: 'Mei L.',
  event_table_id: null,
  booked_by: 'p2',
  booked_by_name: 'Mei L.',
};

beforeEach(() => {
  place.mockReset();
  remove.mockReset();
  call.mockReset();
});

describe('HostSeating', () => {
  it('moves a player to another table', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move Ravi K. to Table 2'));
    await waitFor(() => expect(place).toHaveBeenCalledWith('b1', 't2'));
  });

  it('unseats a player without removing them from the game', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Unseat Ravi K.'));
    await waitFor(() => expect(place).toHaveBeenCalledWith('b1', null));
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a player from the game entirely', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Remove Ravi K. from this game'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('b1'));
  });

  // The RPC refuses a table that needs two players, so a button shown
  // unconditionally would exist only to produce an error. `canCallForAFourth`
  // is computed by the caller (the event screen) from the occupancy rule;
  // this asserts HostSeating itself actually honours that prop rather than
  // showing the button unconditionally.
  it('offers no early call at a table that needs more than one player', () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    expect(screen.queryByText('Call for a 4th now')).toBeNull();
  });

  it('offers the early call when the table is one short', async () => {
    render(
      <HostSeating
        occupants={[seated]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth
      />,
    );
    fireEvent.click(screen.getByText('Call for a 4th now'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('t1'));
  });

  // Not in the brief's five, but the `unseated` prop — a host seating an
  // "any table" booking, the first thing the task description lists a host
  // can do here — had no coverage in the five given tests at all.
  it('seats an unplaced booking at this table', async () => {
    render(
      <HostSeating
        occupants={[]}
        unseated={[unplaced]}
        tables={tables}
        table={tables[0]}
        onPlace={place}
        onRemove={remove}
        onCallForAFourth={call}
        canCallForAFourth={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Seat Mei L. at Table 1'));
    await waitFor(() => expect(place).toHaveBeenCalledWith('b2', 't1'));
  });
});
