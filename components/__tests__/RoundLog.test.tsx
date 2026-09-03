import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoundLog from '../RoundLog';

const players = [
  { profileId: 'p1', name: 'Ann' },
  { profileId: 'p2', name: 'You' },
];

const rounds = [
  { id: 'r2', winner_profile_id: 'p2', winner_name: 'You', points: 5 },
  { id: 'r1', winner_profile_id: 'p1', winner_name: 'Ann', points: 8 },
];

describe('RoundLog', () => {
  it('says nothing has been recorded yet when the log is empty', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('lists rounds newest first with the winner and points', () => {
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('You · 5 pts')).toBeTruthy();
    expect(screen.getByText('Ann · 8 pts')).toBeTruthy();
  });

  it('shows a running total per player', () => {
    render(
      <RoundLog
        rounds={[
          ...rounds,
          { id: 'r3', winner_profile_id: 'p1', winner_name: 'Ann', points: 2 },
        ]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Ann: 10 · You: 5')).toBeTruthy();
  });

  it('hides the record form when canRecord is false', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord={false}
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Record a round')).toBeNull();
  });

  it('records a round for the tapped winner with the entered points', () => {
    const onRecord = vi.fn();
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord
        canDelete={false}
        onRecord={onRecord}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Winner: Ann' }));
    fireEvent.change(screen.getByLabelText('Points'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record a round' }));

    expect(onRecord).toHaveBeenCalledWith('p1', 8);
  });

  it('disables the record button until a winner and valid points are set', () => {
    render(
      <RoundLog
        rounds={[]}
        players={players}
        canRecord
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Record a round' }),
    ).toHaveProperty('disabled', true);
  });

  it('shows delete affordances only when canDelete is true', () => {
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: "Delete You's round for 5 points" }),
    ).toBeTruthy();
  });

  it('calls onDelete with the round id', () => {
    const onDelete = vi.fn();
    render(
      <RoundLog
        rounds={rounds}
        players={players}
        canRecord={false}
        canDelete
        onRecord={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: "Delete You's round for 5 points" }),
    );
    expect(onDelete).toHaveBeenCalledWith('r2');
  });

  it('explains why recording is unavailable when nobody is seated yet', () => {
    render(
      <RoundLog
        rounds={[]}
        players={[]}
        canRecord
        canDelete={false}
        onRecord={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Seat players before recording a round.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Points')).toBeNull();
  });
});
