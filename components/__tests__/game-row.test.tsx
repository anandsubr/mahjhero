import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GameRow, { seatsLabel, statusTag } from '../GameRow';
import type { MyGame } from '../../lib/my-games';

const GAME: MyGame = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: '', gameMode: 'open_play',
  seatingMode: 'open_seating', startsAt: '2026-09-29T15:30:00Z', timezone: 'America/New_York',
  venueName: 'Sample Venue', seatsTaken: 14, capacity: 24, myStatus: 'going',
  waitlistPosition: null, tableLabel: null,
};

describe('statusTag', () => {
  it('shows the table for a seated player', () => {
    expect(statusTag({ ...GAME, seatingMode: 'assigned_tables', tableLabel: 'Table 2' }))
      .toEqual({ label: 'Table 2', tone: 'going' });
  });
  it('shows Open seating for open seating', () => {
    expect(statusTag(GAME)).toEqual({ label: 'Open seating', tone: 'going' });
  });
  it("shows You're going for an unassigned table seat", () => {
    expect(statusTag({ ...GAME, seatingMode: 'assigned_tables' }))
      .toEqual({ label: "You're going", tone: 'going' });
  });
  it('shows the waitlist position', () => {
    expect(statusTag({ ...GAME, myStatus: 'waitlisted', waitlistPosition: 2 }))
      .toEqual({ label: 'Waitlist #2', tone: 'neutral' });
    expect(statusTag({ ...GAME, myStatus: 'waitlisted' }))
      .toEqual({ label: 'Waitlist', tone: 'neutral' });
  });
  it("shows You're hosting and Not going", () => {
    expect(statusTag({ ...GAME, myStatus: 'hosting' }))
      .toEqual({ label: "You're hosting", tone: 'hosting' });
    expect(statusTag({ ...GAME, myStatus: 'not' }))
      .toEqual({ label: 'Not going', tone: 'neutral' });
  });
  it('shows Invited in the accent pill, like hosting', () => {
    expect(statusTag({ ...GAME, myStatus: 'invited' }))
      .toEqual({ label: 'Invited', tone: 'hosting' });
  });
});

describe('seatsLabel', () => {
  it('shows taken/capacity, or a count when uncapped', () => {
    expect(seatsLabel(GAME)).toBe('14/24');
    expect(seatsLabel({ ...GAME, capacity: null })).toBe('14 going');
  });
});

describe('GameRow', () => {
  it('renders the fallback headline, time · venue, club line and date column', () => {
    render(<GameRow game={GAME} showClub onPress={() => {}} />);
    expect(screen.getByText('Open play')).toBeTruthy();
    expect(screen.getByText('11:30 am · Sample Venue')).toBeTruthy();
    expect(screen.getByText('Test Club')).toBeTruthy();
    expect(screen.getByText('SEP')).toBeTruthy();
    expect(screen.getByText('29')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
  });

  it('hides the club line unless asked', () => {
    render(<GameRow game={GAME} onPress={() => {}} />);
    expect(screen.queryByText('Test Club')).toBeNull();
  });

  it('calls onPress with the game', () => {
    const onPress = vi.fn();
    render(<GameRow game={GAME} onPress={onPress} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(GAME);
  });
});
