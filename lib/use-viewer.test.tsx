import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const fetchProfile = vi.fn();

vi.mock('./profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('./session', () => ({ useSession: () => useSessionMock() }));

import { useViewerInitials } from './use-viewer';

/**
 * A probe rather than renderHook: this repo has no
 * @testing-library/react-hooks, and the hook's whole contract is one string,
 * which a one-line component reports perfectly well.
 */
function Probe() {
  return <span data-testid="initials">{useViewerInitials()}</span>;
}

function initials() {
  return screen.getByTestId('initials').textContent;
}

describe('useViewerInitials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({
      session: { user: { id: 'test-user' } },
      loading: false,
    });
  });

  it('reports the signed-in member initials once the profile arrives', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: 'Pat Chen',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<Probe />);
    await waitFor(() => expect(initials()).toBe('PC'));
    expect(fetchProfile).toHaveBeenCalledWith('test-user');
  });

  // A magic-link signup starts with display_name = '' and nothing forces
  // one. Empty is a real answer here, not a failure: DashboardHeader draws a
  // person glyph for it rather than inventing a letter the member never
  // chose.
  it('reports empty for a member who never set a name', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: '',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<Probe />);
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    expect(initials()).toBe('');
  });

  // fetchProfile resolves null on any failure rather than rejecting, so this
  // is the same shape as the case above and must not throw or hang.
  it('reports empty when the profile cannot be read', async () => {
    fetchProfile.mockResolvedValue(null);
    render(<Probe />);
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    expect(initials()).toBe('');
  });

  it('does not read a profile when nobody is signed in', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<Probe />);
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(initials()).toBe('');
  });
});
