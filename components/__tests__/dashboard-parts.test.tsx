import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateTile from '../DateTile';
import Skeleton from '../Skeleton';
import ClubChips from '../ClubChips';
import { ALL_CLUBS } from '../../lib/dashboard';

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

  it('renders placeholders rather than throwing when the date cannot be read', () => {
    render(<DateTile startsAt="not-a-date" timezone="America/New_York" />);
    expect(screen.getAllByText('--')).toHaveLength(2);
  });
});

describe('Skeleton', () => {
  it('renders a block that assistive tech ignores', () => {
    render(<Skeleton />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders one block per call so a stack can stagger them', () => {
    render(
      <>
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </>,
    );
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });
});

const CHIPS = [
  { id: ALL_CLUBS, label: 'All clubs' },
  { id: 'club-1', label: 'Riverside Mah Jongg' },
];

describe('ClubChips', () => {
  it('marks the selected chip and only that one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    // Plain getAttribute, not jest-dom's toHaveAttribute: this repo does not
    // depend on @testing-library/jest-dom, and vitest.setup.ts records that
    // `globals: true` is deliberately off so no matcher package can
    // auto-extend `expect`.
    expect(
      screen
        .getByRole('button', { name: 'Riverside Mah Jongg' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'All clubs' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('reports the chip that was pressed', () => {
    const onSelect = vi.fn();
    render(<ClubChips chips={CHIPS} selected={ALL_CLUBS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Riverside Mah Jongg' }));
    expect(onSelect).toHaveBeenCalledWith('club-1');
  });
});

import DashboardHeader from '../DashboardHeader';

describe('DashboardHeader', () => {
  it('shows the scope kicker, name and meta', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="All your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('All your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.getByText('JW')).toBeTruthy();
  });

  it('routes to the profile from the avatar', () => {
    const onPressAvatar = vi.fn();
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={onPressAvatar}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(onPressAvatar).toHaveBeenCalled();
  });

  it('falls back to a glyph rather than inventing a letter', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="All your clubs"
        meta="1 club"
        initials=""
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByTestId('avatar-fallback')).toBeTruthy();
  });
});

import NoticeBanner from '../NoticeBanner';
import NeedAFourthCard from '../NeedAFourthCard';

describe('NoticeBanner', () => {
  it('shows the message and dismisses', () => {
    const onDismiss = vi.fn();
    render(<NoticeBanner message="You're in — Thursday night." onDismiss={onDismiss} />);
    expect(screen.getByText("You're in — Thursday night.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('NeedAFourthCard', () => {
  it('names the club in the kicker and carries the call text', () => {
    render(
      <NeedAFourthCard
        clubName="Riverside Mah Jongg"
        text="Thu, 3 Sep, 7:00 pm — Thursday night"
        busy={false}
        onTake={() => {}}
      />,
    );
    expect(screen.getByText('Need a 4th · Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thu, 3 Sep, 7:00 pm — Thursday night')).toBeTruthy();
  });

  it('takes the seat', () => {
    const onTake = vi.fn();
    render(<NeedAFourthCard clubName="Riverside" text="Tonight" busy={false} onTake={onTake} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm in — Tonight" }));
    expect(onTake).toHaveBeenCalled();
  });

  it('does not fire while a take is in flight', () => {
    const onTake = vi.fn();
    render(<NeedAFourthCard clubName="Riverside" text="Tonight" busy onTake={onTake} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm in — Tonight" }));
    expect(onTake).not.toHaveBeenCalled();
  });
});
