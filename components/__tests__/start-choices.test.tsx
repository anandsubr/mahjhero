import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));

const joinClubByCode = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clubs')>()),
  joinClubByCode: (...a: unknown[]) => joinClubByCode(...a),
}));

import StartChoices from '../home/StartChoices';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StartChoices', () => {
  it('offers the four ways in', () => {
    render(<StartChoices />);
    expect(screen.getByText('What brings you here?')).toBeTruthy();
    for (const name of ['Host a Mahj Night', 'Start a group', 'I got an invite', "I'm new to mahjong"]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('opens a pasted invite link inside the app', () => {
    render(<StartChoices />);
    fireEvent.click(screen.getByRole('button', { name: 'I got an invite' }));
    fireEvent.change(screen.getByLabelText('Invite link'), {
      target: { value: 'https://app.mahjhero.com/clubs/c1/events/e1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e1');
  });

  it('says so when the pasted text is not a MahjHero link', () => {
    render(<StartChoices />);
    fireEvent.click(screen.getByRole('button', { name: 'I got an invite' }));
    fireEvent.change(screen.getByLabelText('Invite link'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(screen.getByText(/doesn't look like a MahjHero link/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('still takes a group code', () => {
    render(<StartChoices />);
    fireEvent.click(screen.getByRole('button', { name: 'I got an invite' }));
    expect(screen.getByLabelText('Group code')).toBeTruthy();
  });

  it('points a new player at How it works', () => {
    render(<StartChoices />);
    fireEvent.click(screen.getByRole('button', { name: "I'm new to mahjong" }));
    expect(screen.getByRole('button', { name: 'Ask a friend to host' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    expect(push).toHaveBeenCalledWith('/how-it-works');
  });
});
