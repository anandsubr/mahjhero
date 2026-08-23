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

  // See SeatGrid.tsx's docstring for the full mechanics. Short version:
  // `accessibilityState` never reaches the DOM on any platform (RNW's
  // createDOMProps doesn't read it), and the `disabled` prop below is what
  // actually drives `Pressable`'s own `aria-disabled` output — an explicit
  // `aria-disabled` prop is overridden by Pressable regardless of its value.
  // Asserted as the rendered attribute (getAttribute), not just the absence
  // of a click, because a passing "callback didn't fire" test is not
  // evidence the attribute exists.
  //
  // react-native-web only emits `aria-disabled` when it is true (unlike
  // `aria-checked`, which it emits for both states) — so the not-disabled
  // case is legitimately no attribute at all, not the string "false".
  it('renders no aria-disabled on a pressable empty seat', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={vi.fn()}
      />,
    );
    const seat = screen.getByLabelText('Take a seat at Table 1');
    expect(seat.getAttribute('aria-disabled')).toBeNull();
  });

  it('renders aria-disabled="true" on the empty seat while busy', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        onTakeSeat={vi.fn()}
        busy
      />,
    );
    const seat = screen.getByLabelText('Take a seat at Table 1');
    expect(seat.getAttribute('aria-disabled')).toBe('true');
  });
});
