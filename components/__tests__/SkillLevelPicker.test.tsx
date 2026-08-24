import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkillLevelPicker from '../SkillLevelPicker';

describe('SkillLevelPicker', () => {
  // Each tile's own glyph -- not the selected one's -- matches its level:
  // one filled pip for Beginner, two for Intermediate, three for Advanced.
  // This is the same SkillTierPips/SkillLevelPips language TableCard and
  // TierPicker use, unified here in place of the old SkillDotsIcon, whose
  // dot COUNT alone carried the level with no sense of how many levels
  // exist at all.
  it('renders the right number of filled pips per level', () => {
    render(<SkillLevelPicker value="intermediate" onChange={vi.fn()} />);

    const beginner = screen.getByRole('radio', { name: 'Beginner' });
    expect(within(beginner).getAllByTestId('pip-filled')).toHaveLength(1);
    expect(within(beginner).getAllByTestId('pip-outline')).toHaveLength(2);

    const intermediate = screen.getByRole('radio', { name: 'Intermediate' });
    expect(within(intermediate).getAllByTestId('pip-filled')).toHaveLength(2);
    expect(within(intermediate).getAllByTestId('pip-outline')).toHaveLength(1);

    const advanced = screen.getByRole('radio', { name: 'Advanced' });
    expect(within(advanced).getAllByTestId('pip-filled')).toHaveLength(3);
    expect(within(advanced).queryByTestId('pip-outline')).toBeNull();
  });

  // The selected tile's `aria-selected` must be a rendered attribute, not
  // just something `accessibilityState` claims -- react-native-web's
  // `createDOMProps` drops `accessibilityState` entirely (see this
  // component's own docstring and Toggle.tsx's).
  it('exposes aria-selected as a rendered attribute on the selected tile', () => {
    render(<SkillLevelPicker value="advanced" onChange={vi.fn()} />);
    expect(
      screen.getByRole('radio', { name: 'Advanced' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('radio', { name: 'Beginner' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  // A person can never be "any level" -- that is a table's `mixed`, a
  // different type entirely (the parent spec's own reason `skill_tier` and
  // `skill_level` are separate). No tile here may ever render the dash
  // glyph, selected or not, set or unset.
  it('never renders the mixed-tier dash anywhere in the group', () => {
    render(<SkillLevelPicker value={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId('pip-dash')).toBeNull();
  });

  // With no saved level, no tile is the current one -- checked as a
  // rendered attribute on all three, the same way a set value is.
  it('marks no tile as selected when the member has not set a level', () => {
    render(<SkillLevelPicker value={null} onChange={vi.fn()} />);
    for (const name of ['Beginner', 'Intermediate', 'Advanced']) {
      expect(
        screen.getByRole('radio', { name }).getAttribute('aria-selected'),
      ).toBe('false');
    }
  });
});
