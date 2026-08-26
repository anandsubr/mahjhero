import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DateTile from '../DateTile';

describe('DateTile', () => {
  it('shows the weekday and date in the club timezone', () => {
    // 2026-09-03T01:00:00Z is still Wednesday the 2nd in New York.
    render(<DateTile startsAt="2026-09-03T01:00:00Z" timezone="America/New_York" />);
    expect(screen.getByText('WED')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('respects a different timezone for the same instant', () => {
    render(<DateTile startsAt="2026-09-03T01:00:00Z" timezone="Europe/London" />);
    expect(screen.getByText('THU')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
