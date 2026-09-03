import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SeatGrid from '../SeatGrid';

const seats = [
  { bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false },
  { bookingId: 'b2', profileId: 'p2', name: 'Mei L.', isYou: false },
  { bookingId: 'b3', profileId: 'p3', name: 'You', isYou: true },
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

// Formerly HostSeating's job: a per-person list under the grid, one row per
// occupant with a "Move to {table}" button per OTHER table plus "Remove
// from game" — visible for EVERY occupant at once. That component is gone
// (.superpowers/sdd/seat-tap-host-controls.md); the same two actions now
// live here, revealed one person at a time by tapping their own seat.
describe('SeatGrid: organizer seat management', () => {
  const otherTables = [{ id: 't2', label: 'Table 2' }];

  // A small stateful harness, standing in for the event screen: SeatGrid
  // itself is fully controlled (`openBookingId` is a prop, not local state —
  // see the component's own docstring for why: exclusivity has to be owned
  // ABOVE every table, not inside any one of them), so exercising the
  // toggle-open/toggle-closed/switch-to-another-seat behaviour needs
  // something playing that role in the test.
  function Harness({
    onMove,
    onRemove,
  }: {
    onMove: (bookingId: string, tableId: string) => void;
    onRemove: (bookingId: string) => void;
  }) {
    const [openBookingId, setOpenBookingId] = useState<string | null>(null);
    return (
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={seats}
        otherTables={otherTables}
        openBookingId={openBookingId}
        onToggleManage={(id) =>
          setOpenBookingId((current) => (current === id ? null : id))
        }
        onMove={onMove}
        onRemove={onRemove}
      />
    );
  }

  it('reveals a tapped occupant\'s actions, and closes them when a different seat is tapped', () => {
    render(<Harness onMove={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByLabelText('Move Jane P. to Table 2')).toBeNull();
    expect(
      screen.getByLabelText("Manage Jane P.'s seat").getAttribute('aria-expanded'),
    ).toBe('false');

    fireEvent.click(screen.getByLabelText("Manage Jane P.'s seat"));
    expect(screen.getByLabelText('Move Jane P. to Table 2')).toBeTruthy();
    expect(screen.getByLabelText('Remove Jane P. from this game')).toBeTruthy();
    expect(
      screen.getByLabelText("Manage Jane P.'s seat").getAttribute('aria-expanded'),
    ).toBe('true');

    // Tapping Mei L.'s seat, not Jane's again -- Jane's panel must close.
    fireEvent.click(screen.getByLabelText("Manage Mei L.'s seat"));
    expect(screen.queryByLabelText('Move Jane P. to Table 2')).toBeNull();
    expect(
      screen.getByLabelText("Manage Jane P.'s seat").getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByLabelText('Move Mei L. to Table 2')).toBeTruthy();
  });

  it('tapping the same seat again closes its own panel', () => {
    render(<Harness onMove={vi.fn()} onRemove={vi.fn()} />);
    const manage = () => screen.getByLabelText("Manage Jane P.'s seat");

    fireEvent.click(manage());
    expect(screen.getByLabelText('Move Jane P. to Table 2')).toBeTruthy();

    fireEvent.click(manage());
    expect(screen.queryByLabelText('Move Jane P. to Table 2')).toBeNull();
    expect(manage().getAttribute('aria-expanded')).toBe('false');
  });

  it('calls onMove with the tapped occupant\'s booking id and the chosen table', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Manage Jane P.'s seat"));
    fireEvent.click(screen.getByLabelText('Move Jane P. to Table 2'));
    expect(onMove).toHaveBeenCalledWith('b1', 't2');
  });

  it('calls onRemove with the tapped occupant\'s booking id', () => {
    const onRemove = vi.fn();
    render(<Harness onMove={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Manage Jane P.'s seat"));
    fireEvent.click(screen.getByLabelText('Remove Jane P. from this game'));
    expect(onRemove).toHaveBeenCalledWith('b1');
  });

  // The member-facing fallback: without all four host props, an occupied
  // seat is exactly what it always was — a plain, non-interactive `<View>`.
  // No accessibilityRole, no aria-expanded, no label, nothing to click.
  //
  // MUTATION-TESTED: removing the `manageable` gate in SeatGrid.tsx (so an
  // occupied seat is always a manageable Pressable) turns this red —
  // `queryByLabelText` finds "Manage Jane P.'s seat" where it should find
  // nothing. Confirmed by hand while building this component, then reverted.
  it('offers no seat management when the host props are not supplied', () => {
    render(<SeatGrid tableLabel="Table 1" capacity={4} seats={seats} />);
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.queryByLabelText("Manage Jane P.'s seat")).toBeNull();
    expect(screen.queryByText('Move to Table 2')).toBeNull();
  });

  // An organizer's OWN occupied seat still gets the organizer panel, never
  // the member self-service one below, even when a caller supplies both
  // bundles on the same render (exactly what the event screen now does —
  // `onLeaveSeat` is gated only on `canBook`, not on `!isOrganizer`). See
  // SeatGrid.tsx's "A member's own seat" docstring section for why
  // `organizerManageable || selfManageable` checks in that order.
  it("keeps the organizer's own seat on the organizer panel even when onLeaveSeat is also supplied", () => {
    const onRemove = vi.fn();
    const onLeaveSeat = vi.fn();
    function Harness() {
      const [openBookingId, setOpenBookingId] = useState<string | null>(null);
      return (
        <SeatGrid
          tableLabel="Table 1"
          capacity={4}
          seats={seats}
          otherTables={otherTables}
          openBookingId={openBookingId}
          onToggleManage={(id) =>
            setOpenBookingId((current) => (current === id ? null : id))
          }
          onMove={vi.fn()}
          onRemove={onRemove}
          onLeaveSeat={onLeaveSeat}
        />
      );
    }
    render(<Harness />);
    // seats[2] is the organizer's own seat (`isYou: true`, name "You").
    fireEvent.click(screen.getByLabelText("Manage You's seat"));
    expect(screen.getByLabelText('Move You to Table 2')).toBeTruthy();
    expect(screen.getByLabelText('Remove You from this game')).toBeTruthy();
    expect(screen.queryByLabelText('Leave this game')).toBeNull();

    fireEvent.click(screen.getByLabelText('Remove You from this game'));
    expect(onRemove).toHaveBeenCalledWith('b3');
    expect(onLeaveSeat).not.toHaveBeenCalled();
  });
});

// The other half of the gap this task closes: a member who holds a
// confirmed seat has to be able to give it up themselves, not only via a
// host's Remove. `cancel_booking` has accepted the booking's own occupant
// since Task 4; only the UI never offered it. See
// .superpowers/sdd/member-leave-seat.md.
describe('SeatGrid: member self-service (leave own seat)', () => {
  // Deliberately real names, not the top-level fixture's own-seat entry
  // (whose `name` field is literally the string "You", an artifact of that
  // describe block never rendering its own label off `seat.name`). The
  // accessibility label here is built from `seat.name`, exactly like the
  // organizer panel's, so a realistic name keeps the assertions readable.
  const selfSeats = [
    { bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false },
    { bookingId: 'b3', profileId: 'p3', name: 'Ada', isYou: true },
  ];

  function Harness({
    onLeaveSeat,
  }: {
    onLeaveSeat: (bookingId: string) => void;
  }) {
    const [openBookingId, setOpenBookingId] = useState<string | null>(null);
    return (
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={selfSeats}
        openBookingId={openBookingId}
        onToggleManage={(id) =>
          setOpenBookingId((current) => (current === id ? null : id))
        }
        onLeaveSeat={onLeaveSeat}
      />
    );
  }

  it('opens a panel with the give-up action when you tap your own seat', () => {
    render(<Harness onLeaveSeat={vi.fn()} />);
    expect(
      screen.getByLabelText("Manage Ada's seat").getAttribute('aria-expanded'),
    ).toBe('false');

    fireEvent.click(screen.getByLabelText("Manage Ada's seat"));
    expect(screen.getByLabelText('Leave this game')).toBeTruthy();
    expect(
      screen.getByLabelText("Manage Ada's seat").getAttribute('aria-expanded'),
    ).toBe('true');
  });

  // MUTATION-TESTED (member/leave-seat pass): changed the self-panel
  // Button's onPress from `onLeaveSeat!(seat.bookingId)` to
  // `onLeaveSeat!(seat.bookingId + '-wrong')`. This test went red
  // (`toHaveBeenCalledWith('b3')` failed, actual call was
  // `'b3-wrong'`). Reverted; suite green again.
  it("calls onLeaveSeat with your own booking id", () => {
    const onLeaveSeat = vi.fn();
    render(<Harness onLeaveSeat={onLeaveSeat} />);
    fireEvent.click(screen.getByLabelText("Manage Ada's seat"));
    fireEvent.click(screen.getByLabelText('Leave this game'));
    expect(onLeaveSeat).toHaveBeenCalledWith('b3');
  });

  it('offers no Move or Remove-someone-else in the self-service panel', () => {
    render(<Harness onLeaveSeat={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Manage Ada's seat"));
    expect(screen.queryByText(/^Move to /)).toBeNull();
    expect(screen.queryByLabelText('Remove Ada from this game')).toBeNull();
  });

  // MUTATION-TESTED (member/leave-seat pass): removed the `seat.isYou`
  // conjunct from `selfManageable`'s derivation in SeatGrid.tsx (so any
  // occupied seat became self-manageable once `onLeaveSeat` was supplied,
  // not just your own). This test went red —
  // `queryByLabelText("Manage Jane P.'s seat")` found a button where it
  // should find none. Reverted; suite green again.
  it("does not let you manage somebody else's seat", () => {
    render(<Harness onLeaveSeat={vi.fn()} />);
    expect(screen.getByText('Jane P.')).toBeTruthy();
    expect(screen.queryByLabelText("Manage Jane P.'s seat")).toBeNull();
  });

  it('offers no self-service panel at all without onLeaveSeat supplied', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={selfSeats}
        openBookingId={null}
        onToggleManage={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Manage Ada's seat")).toBeNull();
  });
});

// Each occupied seat's own running point total, plus a star badge for
// whoever is currently tied for the lead. Display-only -- see TableCard's
// own tests for how the totals/leader are actually computed from rounds.
describe('SeatGrid: the point badge', () => {
  it('shows no badge for a seat with no recorded points', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: null, isLeader: false }]}
      />,
    );
    // No badge means no point number is rendered at all.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows a plain round badge with the point total for a non-leading winner', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: 30, isLeader: false }]}
      />,
    );
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('shows a star badge for the current leader', () => {
    render(
      <SeatGrid
        tableLabel="Table 1"
        capacity={4}
        seats={[{ bookingId: 'b1', profileId: 'p1', name: 'Jane P.', isYou: false, points: 75, isLeader: true }]}
      />,
    );
    expect(screen.getByText('75')).toBeTruthy();
    // The star and plain-round badges are distinct testIDs -- this fails if
    // the star path were ever removed or collapsed into the round one.
    expect(screen.getByTestId('badge-star-b1')).toBeTruthy();
    expect(screen.queryByTestId('badge-round-b1')).toBeNull();
  });
});
