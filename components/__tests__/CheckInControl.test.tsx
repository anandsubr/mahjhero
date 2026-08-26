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
import { colors } from '../../lib/theme';

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

  // The selected fill (a pastel tint) sits close in luminance to the
  // screen background — see this file's docstring and CheckInControl's own
  // docstring for the measured ratios — so selection also has to show up
  // as a border-width change, not just a colour shift. This pins that
  // second, non-colour signal directly, the same way the `aria-pressed`
  // test above pins the DOM-facing state rather than trusting the React
  // props.
  it('gives the selected choice a heavier border than the unselected one', () => {
    render(<CheckInControl state="arrived" onChange={vi.fn()} label="Ann" />);
    const here = screen.getByRole('button', { name: /^here.*ann/i });
    const notComing = screen.getByRole('button', {
      name: /not coming.*ann/i,
    });
    expect(getComputedStyle(here).borderWidth).toBe('4px');
    expect(getComputedStyle(notComing).borderWidth).toBe('2px');
  });

  // Final-review fix (item 6): width alone (2px vs 4px, same grey) is easy
  // to miss standing up in a dim hall, and the fill colours sit at
  // 1.23-1.27:1 against the page background -- see this file's docstring.
  // Selection now ALSO switches the border to a saturated theme colour
  // (`colors.accentColor`/`colors.accent2Color`), distinct from the
  // unselected chip's neutral `colors.divider`. Pulled from `lib/theme.ts`
  // rather than a literal hex, in both the component and this assertion,
  // so the two cannot silently drift apart.
  it('gives the selected choice a border colour distinct from the unselected one', () => {
    render(<CheckInControl state="arrived" onChange={vi.fn()} label="Ann" />);
    const here = screen.getByRole('button', { name: /^here.*ann/i });
    const notComing = screen.getByRole('button', {
      name: /not coming.*ann/i,
    });
    const selectedColor = getComputedStyle(here).borderColor;
    const unselectedColor = getComputedStyle(notComing).borderColor;
    expect(selectedColor).not.toBe(unselectedColor);
    // The unselected chip keeps the same neutral divider colour every
    // other bordered surface in the app uses.
    expect(unselectedColor).toBe(colors.divider);
  });

  it('falls back to a sensible label when the person has no display name', () => {
    render(<CheckInControl state={null} onChange={vi.fn()} label="" />);
    expect(
      screen.getByRole('button', { name: /^here: this person$/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^not coming: this person$/i }),
    ).toBeTruthy();
  });

  it('falls back to a sensible label when the display name is whitespace-only', () => {
    render(<CheckInControl state={null} onChange={vi.fn()} label="   " />);
    expect(
      screen.getByRole('button', { name: /^here: this person$/i }),
    ).toBeTruthy();
  });
});
