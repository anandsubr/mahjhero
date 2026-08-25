/**
 * CheckInControl's selected state has to reach the DOM, not just the React
 * tree — same trap Toggle.test.tsx guards against (see that file's
 * docstring). `aria-pressed`, not `accessibilityState={{ selected }}`:
 * react-native-web's createDOMProps never forwards `accessibilityState`, so
 * that prop would reach no platform this app ships to and a screen reader
 * would announce two identical unlabelled buttons instead of which choice
 * (if any) is active.
 *
 * The "announces which choice is selected" test below asserts an explicit
 * `getAttribute('aria-pressed')` comparison against the literal string
 * `'true'`, not a truthy/falsy check — a missing attribute (the actual
 * defect `accessibilityState` produces) would pass a laxer assertion.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CheckInControl from '../CheckInControl';

describe('CheckInControl', () => {
  it('reports arrived when Here is pressed', () => {
    const onChange = vi.fn();
    render(<CheckInControl state={null} onChange={onChange} label="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: /here.*ann/i }));
    expect(onChange).toHaveBeenCalledWith('arrived');
  });

  it('reports no_show when Not coming is pressed', () => {
    const onChange = vi.fn();
    render(<CheckInControl state={null} onChange={onChange} label="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: /not coming.*ann/i }));
    expect(onChange).toHaveBeenCalledWith('no_show');
  });

  it('clears when the active choice is pressed again', () => {
    const onChange = vi.fn();
    render(
      <CheckInControl state="arrived" onChange={onChange} label="Ann" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /here.*ann/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clears when the active no_show choice is pressed again', () => {
    const onChange = vi.fn();
    render(
      <CheckInControl state="no_show" onChange={onChange} label="Ann" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /not coming.*ann/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('announces which choice is selected', () => {
    render(<CheckInControl state="no_show" onChange={vi.fn()} label="Ann" />);
    const notComing = screen.getByRole('button', {
      name: /not coming.*ann/i,
    });
    const here = screen.getByRole('button', { name: /^here.*ann/i });
    // Not `not.toBe('false')` or a truthy check: a missing attribute (the
    // actual defect an `accessibilityState` regression would produce) would
    // satisfy those too. Both buttons are pinned against their literal
    // expected strings.
    expect(notComing.getAttribute('aria-pressed')).toBe('true');
    expect(here.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(
      <CheckInControl state={null} onChange={onChange} label="Ann" disabled />,
    );
    fireEvent.click(screen.getByRole('button', { name: /here.*ann/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not fire when busy', () => {
    const onChange = vi.fn();
    render(
      <CheckInControl state={null} onChange={onChange} label="Ann" busy />,
    );
    fireEvent.click(screen.getByRole('button', { name: /here.*ann/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
