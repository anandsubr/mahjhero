import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MyGamesList from '../home/MyGamesList';
import MyGamesCalendar from '../home/MyGamesCalendar';
import type { MyGame } from '../../lib/my-games';

const base: MyGame = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Tuesday game',
  gameMode: 'open_play', seatingMode: 'open_seating', startsAt: '2026-09-29T15:30:00Z',
  timezone: 'America/New_York', venueName: 'Sample Venue', seatsTaken: 4, capacity: 8,
  myStatus: 'going', waitlistPosition: null, tableLabel: null,
};
const games: MyGame[] = [
  base,
  { ...base, eventId: 'e2', title: 'Next Monday', startsAt: '2026-10-05T15:30:00Z' },
  { ...base, eventId: 'e3', title: 'Much later', startsAt: '2026-10-20T15:30:00Z' },
];

describe('MyGamesList', () => {
  it('groups into This week / Next week / Later with counts', () => {
    render(<MyGamesList games={games} todayKey="2026-09-29" onOpen={() => {}} />);
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('Next week')).toBeTruthy();
    expect(screen.getByText('Later')).toBeTruthy();
    expect(screen.getAllByText('1 game')).toHaveLength(3);
  });

  it('omits empty groups and past games', () => {
    render(
      <MyGamesList
        games={[{ ...base, startsAt: '2026-09-20T15:30:00Z' }, games[2]]}
        todayKey="2026-09-29"
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.getByText('Later')).toBeTruthy();
  });
});

describe('MyGamesCalendar', () => {
  const props = {
    year: 2026, monthIndex: 8, todayKey: '2026-09-29', games,
    onPrev: vi.fn(), onNext: vi.fn(), onOpen: vi.fn(),
  };

  it("lists the selected day's games under its heading", () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={() => {}} />);
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(screen.getByText('Tuesday 29 Sept')).toBeTruthy();
    expect(screen.getByText('Tuesday game')).toBeTruthy();
  });

  it('shows the empty-day card', () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-30" onSelect={() => {}} />);
    expect(screen.getByText('Nothing on Wednesday 30 Sept.')).toBeTruthy();
  });

  it('selects a day when tapped', () => {
    const onSelect = vi.fn();
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^15 September/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-09-15');
  });

  it('navigates months', () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(props.onPrev).toHaveBeenCalled();
    expect(props.onNext).toHaveBeenCalled();
  });
});
