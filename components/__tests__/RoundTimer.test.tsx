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

  it('offers the four durations, 15 minutes preselected, and a Start button', () => {
    render(<RoundTimer roundNumber={3} />);
    for (const minutes of [10, 15, 20, 30]) {
      expect(screen.getByRole('radio', { name: `${minutes} minutes` })).toBeTruthy();
    }
    expect(
      screen.getByRole('radio', { name: '15 minutes' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText('Start round 3 · 15 min')).toBeTruthy();
  });

  it('drops the round number when it has none', () => {
    render(<RoundTimer />);
    expect(screen.getByText('Start round · 15 min')).toBeTruthy();
  });

  it('starts the picked duration inline and counts down', () => {
    render(<RoundTimer roundNumber={3} />);
    fireEvent.click(screen.getByRole('radio', { name: '20 minutes' }));
    expect(screen.getByText('Start round 3 · 20 min')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start round 3, 20-minute timer' }));

    expect(screen.getByText('Round 3 in progress')).toBeTruthy();
    expect(screen.getByText('20:00')).toBeTruthy();
    // The idle controls are gone while it runs.
    expect(screen.queryByRole('radio', { name: '20 minutes' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('19:00')).toBeTruthy();
  });

  it('shows the record hint only when asked to', () => {
    const { rerender } = render(<RoundTimer roundNumber={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start round 1, 15-minute timer' }));
    expect(screen.queryByText("Tap the winner's seat to record the win.")).toBeNull();
    rerender(<RoundTimer roundNumber={1} showRecordHint />);
    expect(screen.getByText("Tap the winner's seat to record the win.")).toBeTruthy();
  });

  it('says time is up at zero, not a negative number', () => {
    render(<RoundTimer />);
    fireEvent.click(screen.getByRole('radio', { name: '10 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start round, 10-minute timer' }));

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

  it('End round returns to the idle bar, with the timer gone entirely', () => {
    render(<RoundTimer roundNumber={2} />);
    fireEvent.click(screen.getByRole('radio', { name: '10 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start round 2, 10-minute timer' }));
    fireEvent.click(screen.getByRole('button', { name: 'End round' }));

    expect(screen.queryByText('Round 2 in progress')).toBeNull();
    expect(screen.getByText('Start round 2 · 10 min')).toBeTruthy();

    // Genuinely gone, not just hidden -- letting time pass raises nothing.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('9:00')).toBeNull();
  });

  it('pauses the countdown, then resumes it from where it left off', () => {
    render(<RoundTimer roundNumber={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start round 1, 15-minute timer' }));
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
    expect(screen.getByText('Round 1 paused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('offers no Pause once time is up -- only End round', () => {
    render(<RoundTimer />);
    fireEvent.click(screen.getByRole('radio', { name: '10 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start round, 10-minute timer' }));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End round' })).toBeTruthy();
  });
});
