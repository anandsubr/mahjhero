import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Animated } from 'react-native';
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
    expect(screen.getByRole('button', { name: 'All clubs' })).toBeTruthy();
  });
});

import DashboardHeader from '../DashboardHeader';

describe('DashboardHeader', () => {
  // headerScope's all-clubs scope shortens its name to "Your clubs", which
  // makes a "YOUR CLUBS" kicker above it the same words twice — so that
  // scope passes no kicker at all. An empty string must draw nothing rather
  // than an empty line, the same way `meta` already does.
  it('draws no kicker when it is given none', () => {
    render(
      <DashboardHeader
        kicker=""
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.queryByTestId('scope-kicker')).toBeNull();
  });

  it('still draws a kicker when it is given one', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByTestId('scope-kicker')).toBeTruthy();
  });

  // The all-clubs scope: `headerScope` returns no kicker for it, "Your
  // clubs" for the name, and a plural count for the meta — `kicker="Your
  // clubs"` alongside `name="All your clubs"` was never a shape this screen
  // can actually produce.
  it('shows the scope name, meta and initials with no kicker', () => {
    render(
      <DashboardHeader
        kicker=""
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByText('Your clubs')).toBeTruthy();
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
        name="Your clubs"
        meta="2 clubs"
        initials=""
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByTestId('avatar-fallback')).toBeTruthy();
  });

  it('leaves the scope inert when there is nothing to open', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    // The avatar is still a button; the scope is not.
    expect(screen.getByRole('button', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
    expect(screen.queryByTestId('scope-glyph')).toBeNull();
  });

  it('opens the club in scope when the scope is pressed', () => {
    const onPressScope = vi.fn();
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={onPressScope}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Manage Riverside Mah Jongg, Thursdays, 7pm' }),
    );
    expect(onPressScope).toHaveBeenCalled();
    expect(screen.getByTestId('scope-glyph')).toBeTruthy();
  });

  // accessibilityLabel replaces the accessible name react-native-web would
  // otherwise compute from the Pressable's children, so the meta text
  // visible in the <Text> below the name — the club's rhythm — goes unheard
  // unless the label carries it too. Two shapes: a club with a rhythm gets
  // it appended, a club without one (meta === '') gets no trailing comma
  // rather than "Manage Riverside Mah Jongg, ".
  it('folds the rhythm into the scope label when there is one', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Manage Riverside Mah Jongg, Thursdays, 7pm' }),
    ).toBeTruthy();
  });

  it('leaves the scope label as just the name when there is no rhythm to lose', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta=""
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Manage Riverside Mah Jongg' }),
    ).toBeTruthy();
  });

  // The scope text has to stay reachable by content, not only by label:
  // the screen's own tests read the club name and rhythm straight off the
  // header now that the club cards below are gone.
  it('still shows the scope text when it is pressable', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
        onPressScope={() => {}}
      />,
    );
    expect(screen.getByText('Your club')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursdays, 7pm')).toBeTruthy();
  });

  // The chip row scrolls and this does not. "+ New club" used to trail the
  // row and was already off-screen at two clubs, which made it invisible to
  // exactly the member most likely to start another.
  it('starts a club from the header when it is given a way to', () => {
    const onPressNew = vi.fn();
    render(
      <DashboardHeader
        kicker=""
        name="Your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
        onPressNew={onPressNew}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(onPressNew).toHaveBeenCalled();
  });

  it('draws no way to start a club unless it is given one', () => {
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    // The avatar is untouched by the new control beside it.
    expect(screen.getByRole('button', { name: 'Your profile' })).toBeTruthy();
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
