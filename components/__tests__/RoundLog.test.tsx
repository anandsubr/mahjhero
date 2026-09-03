import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoundLog from '../RoundLog';

const rounds = [
  { id: 'r2', winner_profile_id: 'p2', winner_name: 'You', points: 25 },
  { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ann', points: 30 },
];

describe('RoundLog', () => {
  it('says nothing has been recorded yet when the log is empty', () => {
    render(<RoundLog rounds={[]} canDelete={false} onDelete={vi.fn()} />);
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('lists rounds newest first with the winner and points', () => {
    render(<RoundLog rounds={rounds} canDelete={false} onDelete={vi.fn()} />);
    expect(screen.getByText('You · 25 pts')).toBeTruthy();
    expect(screen.getByText('Ann · 30 pts')).toBeTruthy();
  });

  it('shows delete affordances only when canDelete is true', () => {
    render(<RoundLog rounds={rounds} canDelete onDelete={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: "Delete You's round for 25 points" }),
    ).toBeTruthy();
  });

  it('hides delete affordances when canDelete is false', () => {
    render(<RoundLog rounds={rounds} canDelete={false} onDelete={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: "Delete You's round for 25 points" }),
    ).toBeNull();
  });

  it('calls onDelete with the round id', () => {
    const onDelete = vi.fn();
    render(<RoundLog rounds={rounds} canDelete onDelete={onDelete} />);
    fireEvent.click(
      screen.getByRole('button', { name: "Delete You's round for 25 points" }),
    );
    expect(onDelete).toHaveBeenCalledWith('r2');
  });
});
