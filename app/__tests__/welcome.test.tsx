import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: null,
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({ useSession: () => useSessionMock() }));

import Welcome from '../welcome';

describe('welcome screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({ session: null, loading: false });
  });

  it('leads with the headline and the promise under it', () => {
    render(<Welcome />);
    expect(screen.getByText("Your club's table, always set.")).toBeTruthy();
    expect(screen.getByText(/Find a game, keep your seat/)).toBeTruthy();
  });

  // The artboard's card names a person and a club that do not exist. This
  // one explains what an invite link does and names nobody.
  it('explains invite links without inventing an invitation', () => {
    render(<Welcome />);
    expect(screen.getByText('Invites')).toBeTruthy();
    expect(screen.getByText('Got an invite link?')).toBeTruthy();
    expect(screen.queryByText(/Sara Lindqvist/)).toBeNull();
    expect(screen.queryByText(/Riverside/)).toBeNull();
  });

  it('sends both buttons to sign in', () => {
    render(<Welcome />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
    push.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: 'I already have an account' }),
    );
    expect(push).toHaveBeenCalledWith('/sign-in');
  });

  // Redirects to "/" rather than a fixed destination: app/index.tsx is the
  // one place that knows whether a club invite is parked in storage and the
  // member must be sent to /join/<token> instead of /clubs.
  it('gets out of the way once a session appears', () => {
    useSessionMock.mockReturnValue({
      session: { user: { id: 'test-user' } },
      loading: false,
    });
    render(<Welcome />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/');
  });

  it('waits rather than redirecting while auth is still resolving', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    render(<Welcome />);
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.getByText("Your club's table, always set.")).toBeTruthy();
  });

  // accessibilityElementsHidden / importantForAccessibility are native-only
  // props react-native-web silently drops (see its
  // forwardedProps/index.js). aria-hidden is the flat prop it actually
  // forwards, so that's what a web screen reader sees.
  it('hides the decorative tile hero from web assistive tech', () => {
    render(<Welcome />);
    expect(screen.getByTestId('welcome-hero').getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
