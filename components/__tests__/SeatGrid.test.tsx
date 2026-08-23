import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SeatGrid from '../SeatGrid';

const seats = [
  { bookingId: 'b1', name: 'Jane P.', isYou: false },
  { bookingId: 'b2', name: 'Mei L.', isYou: false },
  { bookingId: 'b3', name: 'You', isYou: true },
];

describe('SeatGrid', () => {
  it('draws every seat the table has, filled and empty', () => {
    render(<SeatGrid tableLabel="Table 1" capacity={4} seats={seats} />);
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.getByText('Mei L.')).toBeTruthy();
    expect(screen.getAllByLabelText('Take a seat at Table 1')).toHaveLength(1);
  });

  it('offers no empty seat when the table is full', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={3}
        seats={seats}
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
  });

  // Removing a table lowers capacity without ejecting anybody, so a table
  // can legitimately hold more people than it seats. Rendering -1 empty
  // seats, or crashing, are both worse than rendering none.
  it('survives a table holding more people than it seats', () => {
    render(<SeatGrid tableLabel="Table 1" capacity={2} seats={seats} />);
    expect(screen.queryByLabelText('Take a seat at Table 1')).toBeNull();
    expect(screen.getByText('Jane P.')).toBeTruthy();
  });

  it('calls back when an empty seat is taken', () => {
    const onTakeSeat = vi.fn();
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={onTakeSeat}
      />,
    );
    fireEvent.click(screen.getByLabelText('Take a seat at Table 1'));
    expect(onTakeSeat).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to press while a booking is in flight', () => {
    const onTakeSeat = vi.fn();
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={onTakeSeat}
        busy
      />,
    );
    fireEvent.click(screen.getByLabelText('Take a seat at Table 1'));
    expect(onTakeSeat).not.toHaveBeenCalled();
  });

  it('marks the last empty seat as the one being called for', () => {
    render(
      <SeatGrid
        tableLabel="Table 3"
        capacity={4}
        seats={seats}
        needsFourth
        onTakeSeat={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Take the last seat at Table 3')).toBeTruthy();
  });
});
