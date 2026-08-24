import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkillTierPips from '../SkillTierPips';

describe('SkillTierPips', () => {
  it('fills one pip for beginner, two outlined', () => {
    render(<SkillTierPips tier="beginner" />);
    expect(screen.getAllByTestId('pip-filled')).toHaveLength(1);
    expect(screen.getAllByTestId('pip-outline')).toHaveLength(2);
    expect(screen.queryByTestId('pip-dash')).toBeNull();
  });

  it('fills two pips for intermediate, one outlined', () => {
    render(<SkillTierPips tier="intermediate" />);
    expect(screen.getAllByTestId('pip-filled')).toHaveLength(2);
    expect(screen.getAllByTestId('pip-outline')).toHaveLength(1);
  });

  it('fills all three pips for advanced', () => {
    render(<SkillTierPips tier="advanced" />);
    expect(screen.getAllByTestId('pip-filled')).toHaveLength(3);
    expect(screen.queryByTestId('pip-outline')).toBeNull();
  });

  // The design's explicit instruction: mixed/"any level" reads as a dash,
  // NOT as zero filled pips -- zero pips would look identical to "no tier
  // set", where a dash reads as "all levels welcome". Asserts both halves:
  // the dash is there, and no pip of either kind renders alongside it.
  it('renders a dash for mixed, not zero pips', () => {
    render(<SkillTierPips tier="mixed" />);
    expect(screen.getByTestId('pip-dash')).toBeTruthy();
    expect(screen.queryAllByTestId('pip-filled')).toHaveLength(0);
    expect(screen.queryAllByTestId('pip-outline')).toHaveLength(0);
  });
});
