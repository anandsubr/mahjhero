import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BringSomeoneSheet from '../BringSomeoneSheet';

const roster = [
  { profile_id: 'me', role: 'member' as const, display_name: 'You', skill_level: null },
  { profile_id: 'p2', role: 'member' as const, display_name: 'Jane P.', skill_level: null },
  { profile_id: 'p3', role: 'member' as const, display_name: 'Mei L.', skill_level: null },
];

const propose = vi.fn();
const commit = vi.fn();

beforeEach(() => {
  propose.mockReset();
  commit.mockReset();
  // Every test below that reaches a commit step only asserts that commit was
  // called, not what it resolves to — but the component always awaits and
  // destructures its result (matching commitBooking's real, never-undefined
  // shape). Leaving this unset makes `onCommit()` resolve to `undefined`,
  // which throws inside the component's async handler as an unhandled
  // rejection once the click handler returns. Defaulting it here keeps that
  // failure mode out of every test's flight path.
  commit.mockResolvedValue({ result: null, error: null });
});

function renderSheet(extra = {}) {
  return render(
    <BringSomeoneSheet
      roster={roster}
      booked={['p3']}
      youId="me"
      tables={[
        { id: 't1', label: 'Table 1', skill_tier: 'mixed', capacity: 4, position: 1 },
        { id: 't2', label: 'Table 2', skill_tier: 'advanced', capacity: 4, position: 2 },
      ]}
      initialTableId="t2"
      onPropose={propose}
      onCommit={commit}
      onClose={vi.fn()}
      {...extra}
    />,
  );
}

describe('BringSomeoneSheet', () => {
  it('offers the roster, minus anybody already coming', () => {
    renderSheet();
    expect(screen.getByLabelText('Add Jane P.')).toBeTruthy();
    expect(screen.queryByLabelText('Add Mei L.')).toBeNull();
  });

  it('defaults to splitting the group up rather than making them wait', () => {
    renderSheet();
    const toggle = screen.getByLabelText("Split us up if we can't sit together");
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  /**
   * The regression this fix pass exists for: the split toggle used to
   * carry only `accessibilityLabel`, with no visible text anywhere near
   * it -- a bare switch floating under the table chips with nothing
   * explaining what it does. `getByLabelText` alone would not have caught
   * this (it also matches `accessibilityLabel`, which was correct the
   * whole time), so this asserts the visible copy specifically, the way a
   * sighted member actually reads the screen.
   */
  it('labels the split toggle with visible text, not just an accessibility label', () => {
    renderSheet();
    expect(
      screen.getByText("Split us up if we can't sit together"),
    ).toBeTruthy();
  });

  describe('the "Who\'s coming?" empty state', () => {
    it('explains that the club has nobody else yet, when it is solo', () => {
      renderSheet({
        roster: [
          { profile_id: 'me', role: 'member' as const, display_name: 'You', skill_level: null },
        ],
        booked: [],
      });
      expect(
        screen.getByText(
          "You're the only member of this club so far. Invite people from the club page to fill a table.",
        ),
      ).toBeTruthy();
    });

    it('explains that everyone else is already booked, when the club has other members', () => {
      renderSheet({ booked: ['p2', 'p3'] });
      expect(
        screen.getByText('Everyone else in the club already has a seat at this game.'),
      ).toBeTruthy();
    });

    it('renders neither empty-state message when somebody is available', () => {
      renderSheet();
      expect(
        screen.queryByText(
          "You're the only member of this club so far. Invite people from the club page to fill a table.",
        ),
      ).toBeNull();
      expect(
        screen.queryByText('Everyone else in the club already has a seat at this game.'),
      ).toBeNull();
    });
  });

  it('shows exactly who sits where before committing a split', async () => {
    propose.mockResolvedValue({
      plan: {
        outcome: 'seated',
        split: true,
        placements: [
          { profile_id: 'me', event_table_id: 't2', table_label: 'Table 2' },
          { profile_id: 'p2', event_table_id: 't1', table_label: 'Table 1' },
        ],
      },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));

    expect(await screen.findByText('You → Table 2')).toBeTruthy();
    expect(screen.getByText('Jane P. → Table 1')).toBeTruthy();
    // Nothing is written until the member says yes to the split they saw.
    expect(commit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Book it this way'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it('commits without a second step when nobody is split up', async () => {
    propose.mockResolvedValue({
      plan: { outcome: 'seated', split: false, placements: [] },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it('offers the waitlist when the group does not fit', async () => {
    propose.mockResolvedValue({
      plan: { outcome: 'waitlisted', split: false, placements: [] },
      error: null,
    });
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(
      await screen.findByText('There is no room for all of you right now.'),
    ).toBeTruthy();
    expect(screen.getByText('Wait together')).toBeTruthy();
  });

  it('hides the split toggle once "any table" is chosen', () => {
    renderSheet({ initialTableId: null });
    expect(
      screen.queryByLabelText("Split us up if we can't sit together"),
    ).toBeNull();
  });

  /**
   * Constraint 1 (flat aria-* props, never accessibilityState) is only real
   * if the rendered attribute is asserted, not just the callback firing —
   * the same lesson Toggle.test.tsx and Button.test.tsx encode for this
   * codebase. The person/table chips have no other source for
   * `aria-selected` (unlike a Pressable's own `disabled` prop, which drives
   * `aria-disabled` on its own — see SeatGrid.test.tsx), so this is the one
   * assertion that would actually catch a regression back to
   * accessibilityState.
   */
  it('marks the preselected table chip, and only that one, as aria-selected', () => {
    renderSheet();
    expect(
      screen.getByLabelText('Sit at Table 2').getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByLabelText('Sit at Table 1').getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('flips a person chip to aria-selected="true" once added, with its label following', () => {
    renderSheet();
    const chip = screen.getByLabelText('Add Jane P.');
    expect(chip.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(chip);
    // The accessible name changes with the state (Add -> Remove), so the
    // element has to be re-queried by its new label.
    const after = screen.getByLabelText('Remove Jane P.');
    expect(after.getAttribute('aria-selected')).toBe('true');
  });

  /**
   * The regression this fix pass exists for: `booked` is checked with
   * `me` (`youId`) already in it -- the shape a member who is already
   * coming to this game actually has. Before this fix, `players` was
   * always seeded with `youId`, so this same setup would call `onPropose`
   * with `['me', 'p2']` and the database would refuse the whole group
   * because `me` already holds a seat.
   */
  describe('when the opener already holds a seat', () => {
    function renderAlreadySeated(extra = {}) {
      return renderSheet({ booked: ['me', 'p3'], ...extra });
    }

    it('renders no "You" chip', () => {
      renderAlreadySeated();
      expect(screen.queryByText('You')).toBeNull();
    });

    it('proposes just the friend picked, not [you, friend]', async () => {
      propose.mockResolvedValue({
        plan: { outcome: 'seated', split: false, placements: [] },
        error: null,
      });
      renderAlreadySeated();
      fireEvent.click(screen.getByLabelText('Add Jane P.'));
      fireEvent.click(screen.getByText('Confirm'));
      await waitFor(() => expect(propose).toHaveBeenCalled());
      expect(propose).toHaveBeenCalledWith(
        expect.objectContaining({ players: ['p2'] }),
      );
    });

    it('does not propose an empty group when nobody is picked', () => {
      renderAlreadySeated();
      const confirmButton = screen.getByText('Confirm').closest('[aria-disabled]');
      expect(confirmButton?.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(screen.getByText('Confirm'));
      expect(propose).not.toHaveBeenCalled();
    });
  });

  it('still seeds and shows "You", non-removable, when the opener is not already seated', () => {
    renderSheet({ booked: ['p3'] });
    expect(screen.getByText('You')).toBeTruthy();
    // "You" is a plain View, not a Pressable -- there is no accessible
    // "Remove You" control to find.
    expect(screen.queryByLabelText('Remove You')).toBeNull();
  });

  it('marks the chips aria-disabled while a proposal is in flight', async () => {
    let resolvePropose: (value: {
      plan: { outcome: 'seated'; split: false; placements: never[] };
      error: null;
    }) => void = () => {};
    propose.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePropose = resolve;
        }),
    );
    renderSheet();
    fireEvent.click(screen.getByLabelText('Add Jane P.'));
    expect(
      screen.getByLabelText('Remove Jane P.').getAttribute('aria-disabled'),
    ).toBeNull();

    fireEvent.click(screen.getByText('Confirm'));
    expect(
      screen.getByLabelText('Remove Jane P.').getAttribute('aria-disabled'),
    ).toBe('true');

    resolvePropose({
      plan: { outcome: 'seated', split: false, placements: [] },
      error: null,
    });
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });
});
