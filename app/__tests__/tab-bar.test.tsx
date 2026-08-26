import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TabBar from '../../components/TabBar';

const replace = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  Redirect: ({ href }: { href: string }) => <div data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  replace.mockClear();
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
    render(<TabBar active="club" />);
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).not.toHaveBeenCalled();
  });
});
