import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TabBar from '../../components/TabBar';

const replace = vi.fn();

// Controllable per test, the same way `replace` above is: TabBar's press
// handler now compares the current route to each tab's own href, so a test
// exercising that comparison needs to say what the current route is. Mutate
// this directly (`pathname = '/clubs/club-1'`) before rendering.
let pathname = '/dashboard-followups-under-test';

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  Redirect: ({ href }: { href: string }) => <div data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  replace.mockClear();
  // A route none of the four tabs' hrefs match, so a test that doesn't care
  // about the "already there" comparison (most of them) can't accidentally
  // pass because the default happens to coincide with a real tab route.
  pathname = '/dashboard-followups-under-test';
});

describe('TabBar', () => {
  it('renders all four destinations', () => {
    render(<TabBar active="club" />);
    for (const label of ['Club', 'Messages', 'Profile', 'Alerts']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('marks only the active tab', () => {
    render(<TabBar active="profile" />);
    expect(
      screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it.each([
    ['Club', '/clubs', 'alerts'],
    ['Messages', '/messages', 'club'],
    ['Profile', '/profile', 'club'],
    ['Alerts', '/notifications', 'club'],
  ] as const)('routes %s to %s', (label, href, otherActive) => {
    // Rendered with a different tab active than the one under test: the
    // active tab itself is a documented no-op (see the test below), so
    // testing routing for a tab requires it not already be selected.
    render(<TabBar active={otherActive} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(replace).toHaveBeenCalledWith(href);
  });

  it('does not navigate when the active tab is pressed', () => {
    // On the Club tab's own route, pressing it is still a documented no-op.
    pathname = '/clubs';
    render(<TabBar active="club" />);
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).not.toHaveBeenCalled();
  });

  // The regression this file exists to catch: the club detail screen
  // (route /clubs/[id]) renders `active="club"` so the bar still highlights
  // Club, but /clubs/club-1 is not the Club tab's own route (/clubs). A
  // press handler that short-circuits on `selected` alone — as this one
  // used to — never calls `replace` here, stranding the member on a screen
  // whose highlighted Club button does nothing.
  it('still navigates a highlighted tab when its route is not the current one', () => {
    pathname = '/clubs/club-1';
    render(<TabBar active="club" />);
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).toHaveBeenCalledWith('/clubs');
  });
});
