import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('goes straight to a full-screen overlay once started, and counts down', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );

    const overlay = screen.getByTestId('timer-overlay');
    expect(within(overlay).getByText('15:00')).toBeTruthy();
    // No smaller inline state left behind -- the duration picker is gone.
    expect(
      screen.queryByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    ).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(overlay).getByText('14:00')).toBeTruthy();
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

  it('stops and returns to the duration picker, with the timer gone entirely', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(screen.queryByTestId('timer-overlay')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    ).toBeTruthy();

    // Genuinely gone, not just hidden -- letting time pass raises nothing.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('9:00')).toBeNull();
  });

  it('pauses the countdown, then resumes it from where it left off', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 15-minute timer for Table 1' }),
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('14:00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    // Frozen -- time passing while paused does not decrement it.
    expect(screen.getByText('14:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('offers no Pause once time is up -- only Stop', () => {
    render(<RoundTimer tableLabel="Table 1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a 10-minute timer for Table 1' }),
    );
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  // `onRequestClose` (Escape / Android back) is wired to `stop`, same as the
  // Stop button -- not exercised here because react-native-web's Modal only
  // engages that listener once a real CSS `animationend` event fires marking
  // it "active", which jsdom never dispatches on its own; verified live in
  // a real browser instead (fires correctly on Escape, matches Stop).
});
