import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TierPicker from '../TierPicker';

describe('TierPicker', () => {
  it('spells out the current tier in words beside the pips', () => {
    render(
      <TierPicker tableLabel="Table 1" tier="intermediate" onChange={vi.fn()} />,
    );
    expect(screen.getByText('Intermediate')).toBeTruthy();
  });

  it('keeps a full word accessibilityLabel on every option, not just the current one', () => {
    render(<TierPicker tableLabel="Table 1" tier="mixed" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Table 1: Any level')).toBeTruthy();
    expect(screen.getByLabelText('Table 1: Beginner')).toBeTruthy();
    expect(screen.getByLabelText('Table 1: Intermediate')).toBeTruthy();
    expect(screen.getByLabelText('Table 1: Advanced')).toBeTruthy();
  });

  it('marks only the current tier as aria-selected, as a rendered attribute', () => {
    render(<TierPicker tableLabel="Table 1" tier="advanced" onChange={vi.fn()} />);
    expect(
      screen.getByLabelText('Table 1: Advanced').getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByLabelText('Table 1: Beginner').getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('calls onChange with the tapped tier', () => {
    const onChange = vi.fn();
    render(<TierPicker tableLabel="Table 1" tier="mixed" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Table 1: Advanced'));
    expect(onChange).toHaveBeenCalledWith('advanced');
  });

  it('renders aria-disabled on every option when disabled, as a rendered attribute', () => {
    render(
      <TierPicker tableLabel="Table 1" tier="mixed" disabled onChange={vi.fn()} />,
    );
    expect(
      screen.getByLabelText('Table 1: Beginner').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  // The mixed option's own pip glyph is a dash, not zero pips -- checked
  // here (not just in SkillTierPips.test.tsx) because this is where a
  // caller could plausibly wire the wrong tier into the wrong option.
  it("renders the mixed option's pips as a dash", () => {
    render(<TierPicker tableLabel="Table 1" tier="mixed" onChange={vi.fn()} />);
    const mixedOption = screen.getByLabelText('Table 1: Any level');
    expect(within(mixedOption).getByTestId('pip-dash')).toBeTruthy();
  });
});
