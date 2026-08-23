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
