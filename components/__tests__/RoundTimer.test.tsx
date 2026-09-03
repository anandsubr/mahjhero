import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoundTimer from '../RoundTimer';

describe('RoundTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers a duration picker before it is started', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    expect(
      screen.getByRole('button', {
        name: 'Start a 15-minute timer for Table 1',
      }),
    ).toBeTruthy();
  });

  it('counts down once started', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );
    expect(screen.getByText('15:00')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('14:00')).toBeTruthy();
  });

  it('says time is up at zero, not a negative number', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText("Time's up")).toBeTruthy();
    expect(screen.queryByText('0:00')).toBeNull();

    // A tick past zero does not go negative.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Time's up")).toBeTruthy();
  });

  it('resets back to the duration picker', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }));
    expect(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    ).toBeTruthy();
  });
});
