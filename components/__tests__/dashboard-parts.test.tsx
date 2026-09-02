import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Animated } from 'react-native';
import DateTile from '../DateTile';
import Skeleton from '../Skeleton';
import ClubChips from '../ClubChips';

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

  // The `delay` prop is passed by three call sites on the dashboard and was
  // asserted by none, so the stagger could have silently collapsed to three
  // blocks pulsing in unison. Spying the Animated call is the only handle:
  // the phase shift is not observable in the rendered DOM.
  it('staggers each block by the delay it was given', () => {
    const delay = vi.spyOn(Animated, 'delay');
    render(
      <>
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </>,
    );
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([0, 150, 300]);
    delay.mockRestore();
  });
});

const CHIPS = [
  { id: 'club-1', label: 'Riverside Mah Jongg' },
  { id: 'club-2', label: 'Harbour Tiles' },
];

describe('ClubChips', () => {
  it('marks the selected chip and only that one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(
      screen
        .getByRole('button', { name: 'Riverside Mah Jongg' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Harbour Tiles' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('reports the chip that was pressed', () => {
    const onSelect = vi.fn();
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Harbour Tiles' }));
    expect(onSelect).toHaveBeenCalledWith('club-2');
  });

  // UnreadBadge's own <Text> never reaches assistive tech: this Pressable's
  // accessibilityLabel emits aria-label on react-native-web, which REPLACES
  // the accessible name computed from children (the badge included) rather
  // than merging with it. The count has to be composed into the chip's own
  // label for a screen-reader user to ever hear it.
  it('composes the unread count into the chip’s accessible name', () => {
    render(
      <ClubChips
        chips={CHIPS}
        selected="club-1"
        onSelect={() => {}}
        unreadByClub={{ 'club-1': 4 }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Riverside Mah Jongg, 4 unread' }),
    ).toBeTruthy();
  });

  it('shows each club’s initials in its tile', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(screen.getByText('RM')).toBeTruthy();
    expect(screen.getByText('HT')).toBeTruthy();
  });

  it('draws a trailing New club tile when given a way to start one', () => {
    const onPressNewClub = vi.fn();
    render(
      <ClubChips
        chips={CHIPS}
        selected="club-1"
        onSelect={() => {}}
        onPressNewClub={onPressNewClub}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(onPressNewClub).toHaveBeenCalled();
    expect(screen.getByText('New club')).toBeTruthy();
  });

  it('draws no New club tile unless it is given a way to start one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    expect(screen.queryByText('New club')).toBeNull();
  });
});

import DashboardHeader from '../DashboardHeader';

describe('DashboardHeader', () => {
  it('draws no kicker when it is given none', () => {
    render(<DashboardHeader kicker="" name="Your clubs" meta="2 clubs" />);
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.queryByTestId('scope-kicker')).toBeNull();
  });

  // A kicker the flat layout can actually be given in production --
  // app/clubs/[id]/venues.tsx passes the club's own name here. "Your club"
  // is the one value that instead takes the variant below.
  it('still draws a kicker when it is given one', () => {
    render(<DashboardHeader kicker="Riverside Mah Jongg" name="Venues" meta="" />);
    expect(screen.getByTestId('scope-kicker')).toBeTruthy();
    expect(screen.getByText('Venues')).toBeTruthy();
  });

  it('shows the scope name and meta with no kicker', () => {
    render(<DashboardHeader kicker="" name="Your clubs" meta="2 clubs" />);
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
  });

  describe('the "Your club" variant', () => {
    it('shows the club’s avatar, name and rhythm instead of a kicker', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.getByTestId('thread-avatar-club')).toBeTruthy();
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
      expect(screen.getByText('Thursdays, 7pm')).toBeTruthy();
      expect(screen.queryByTestId('scope-kicker')).toBeNull();
      expect(screen.queryByText('Your club')).toBeNull();
    });

    it('draws no rhythm line when there is none to show', () => {
      render(<DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="" />);
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
      expect(screen.queryByText('Thursdays, 7pm')).toBeNull();
    });

    it('opens the club’s management screen when the name pill is pressed', () => {
      const onPressScope = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressScope={onPressScope}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Manage Riverside Mah Jongg, Thursdays, 7pm' }),
      );
      expect(onPressScope).toHaveBeenCalled();
    });

    it('folds the rhythm into the manage label, and drops it when there is none', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta=""
          onPressScope={() => {}}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Manage Riverside Mah Jongg' }),
      ).toBeTruthy();
    });

    it('draws no manage button unless it is given a way to manage', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
      // The name still renders, as plain text this time.
      expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    });

    it('clears the club filter when the back chevron is pressed', () => {
      const onPressBack = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressBack={onPressBack}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Clear club filter' }));
      expect(onPressBack).toHaveBeenCalled();
    });

    it('draws no chevron unless it is given one', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
    });

    it('adds a game for this club when the + is pressed', () => {
      const onPressAddGame = vi.fn();
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressAddGame={onPressAddGame}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
      expect(onPressAddGame).toHaveBeenCalled();
    });

    it('draws no way to add a game unless it is given one', () => {
      render(
        <DashboardHeader
          kicker="Your club"
          name="Riverside Mah Jongg"
          meta="Thursdays, 7pm"
          onPressBack={() => {}}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
    });

    it('draws no top row at all when given neither a chevron nor a way to add a game', () => {
      render(
        <DashboardHeader kicker="Your club" name="Riverside Mah Jongg" meta="Thursdays, 7pm" />,
      );
      expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
    });
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
