import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TextField from '../TextField';

describe('TextField', () => {
  it('renders a single-line pill by default', () => {
    render(<TextField label="Subject" value="" onChangeText={() => {}} />);
    const input = screen.getByLabelText('Subject');
    expect(input.tagName.toLowerCase()).toBe('input');
  });

  // A 2000-character broadcast body in a 58px pill is unusable. `rows`
  // switches to a textarea sized to fit, and is the only way to get one —
  // the component omits `style` from its props on purpose.
  it('renders a sized textarea when asked for rows', () => {
    render(<TextField label="Message" rows={6} value="" onChangeText={() => {}} />);
    const input = screen.getByLabelText('Message');
    expect(input.tagName.toLowerCase()).toBe('textarea');
  });
});
