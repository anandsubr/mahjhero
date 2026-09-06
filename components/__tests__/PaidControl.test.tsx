/**
 * The same trap CheckInControl.test.tsx and Toggle.test.tsx guard against,
 * for the door list's payment marker: the selected state has to reach the
 * DOM as `aria-pressed`, not `accessibilityState`, which react-native-web
 * never forwards — a screen reader would otherwise announce a chip that
 * gives no hint whether this person has paid.
 *
 * Every assertion below compares against the literal string 'true'/'false'
 * rather than checking truthiness, because a MISSING attribute (the exact
 * defect an `accessibilityState` regression produces) passes a laxer check.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PaidControl from '../PaidControl';

describe('PaidControl', () => {
  it('marks an unpaid person paid', () => {
    const onChange = vi.fn();
    render(<PaidControl paid={false} onChange={onChange} label="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: 'Paid: Ann' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // The correction path: `set_payment_status` accepts an unmark deliberately
  // (it deletes the row and skips the roster check on the way out), so a
  // mis-tap has to be fixable by tapping the same place again — the rule
  // CheckInControl already follows for a mis-tapped arrival.
  it('unmarks a person who was marked paid by mistake', () => {
    const onChange = vi.fn();
    render(<PaidControl paid onChange={onChange} label="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: 'Paid: Ann' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('announces whether this person has paid', () => {
    const { rerender } = render(
      <PaidControl paid={false} onChange={vi.fn()} label="Ann" />,
    );
    expect(
      screen.getByRole('button', { name: 'Paid: Ann' }).getAttribute('aria-pressed'),
    ).toBe('false');
    rerender(<PaidControl paid onChange={vi.fn()} label="Ann" />);
    expect(
      screen.getByRole('button', { name: 'Paid: Ann' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('swallows a tap while a write for this person is in flight', () => {
    const onChange = vi.fn();
    render(<PaidControl paid={false} busy onChange={onChange} label="Ann" />);
    const chip = screen.getByRole('button', { name: 'Paid: Ann' });
    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swallows a tap while disabled', () => {
    const onChange = vi.fn();
    render(<PaidControl paid={false} disabled onChange={onChange} label="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: 'Paid: Ann' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  // `display_name` has no non-empty constraint and defaults to '' — an
  // unnamed member's chip would otherwise announce "Paid: " and name nobody.
  it('names a nameless person rather than announcing nothing', () => {
    render(<PaidControl paid={false} onChange={vi.fn()} label="   " />);
    expect(screen.getByRole('button', { name: 'Paid: this person' })).toBeTruthy();
  });
});
