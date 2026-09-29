import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MyGamesList from '../home/MyGamesList';
import MyGamesCalendar from '../home/MyGamesCalendar';
import JoinClubCard from '../home/JoinClubCard';
import ClubCard from '../home/ClubCard';
import type { MyGame } from '../../lib/my-games';

const joinClubByCode = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clubs')>()),
  joinClubByCode: (...a: unknown[]) => joinClubByCode(...a),
}));

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

describe('JoinClubCard', () => {
  it('disables Join until text is entered, uppercases input', () => {
    render(<JoinClubCard onJoined={() => {}} />);
    const join = screen.getByRole('button', { name: 'Join' });
    expect(join.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'oak 2' } });
    expect((screen.getByLabelText('Club code') as HTMLInputElement).value).toBe('OAK2');
    expect(screen.getByRole('button', { name: 'Join' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('calls onJoined with the club id', async () => {
    joinClubByCode.mockResolvedValueOnce({ clubId: 'c1', alreadyMember: false, error: null });
    const onJoined = vi.fn();
    render(<JoinClubCard onJoined={onJoined} />);
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'OAK2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByRole('button', { name: 'Join' });
    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledWith('c1'));
  });

  it('shows the error inline', async () => {
    joinClubByCode.mockResolvedValueOnce({ clubId: null, alreadyMember: false, error: 'No club with that code.' });
    render(<JoinClubCard onJoined={() => {}} />);
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('No club with that code.')).toBeTruthy();
  });
});

describe('ClubCard', () => {
  it('shows name, subline and unread', () => {
    render(
      <ClubCard
        club={{ id: 'c1', name: 'Test Club', slug: 't', rhythm: '', visibility: 'private',
          timezone: 'UTC', default_game_mode: 'open_play', code: 'TEST1' }}
        role="member"
        nextStartsAt={null}
        unread={3}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText('Test Club')).toBeTruthy();
    expect(screen.getByText('Member · No games scheduled')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
