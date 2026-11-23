import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BlockedScreen from '../blocked';
import { GENERIC_ERROR } from '../../lib/constants';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn(() => true);

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace, back, canGoBack }),
  usePathname: () => '/blocked',
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchMyBlocks = vi.fn();
const unblockUser = vi.fn();
vi.mock('../../lib/moderation', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/moderation')>('../../lib/moderation');
  return {
    ...actual,
    fetchMyBlocks: (...a: unknown[]) => fetchMyBlocks(...a),
    unblockUser: (...a: unknown[]) => unblockUser(...a),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  unblockUser.mockResolvedValue({ error: null });
});

describe('Blocked people', () => {
  it('says so when nobody is blocked', async () => {
    fetchMyBlocks.mockResolvedValue({ data: [], error: null });
    render(<BlockedScreen />);
    expect(await screen.findByText("You haven't blocked anyone.")).toBeTruthy();
    expect(screen.getByText('Blocked people')).toBeTruthy();
  });

  it('lists each blocked person with Unblock, which removes them without a confirmation', async () => {
    fetchMyBlocks.mockResolvedValue({
      data: [
        { id: 'p2', name: 'Bea Ortiz', blockedAt: '2026-11-01T00:00:00Z' },
        { id: 'p3', name: 'Cal Ng', blockedAt: '2026-11-02T00:00:00Z' },
      ],
      error: null,
    });
    render(<BlockedScreen />);
    expect(await screen.findByText('Bea Ortiz')).toBeTruthy();
    expect(screen.getByText('Cal Ng')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unblock Bea Ortiz' }));
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith('p2'));
    await waitFor(() => expect(screen.queryByText('Bea Ortiz')).toBeNull());
    expect(screen.getByText('Cal Ng')).toBeTruthy();
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
  });

  it('keeps the person listed and shows the error when Unblock fails', async () => {
    fetchMyBlocks.mockResolvedValue({
      data: [{ id: 'p2', name: 'Bea Ortiz', blockedAt: '2026-11-01T00:00:00Z' }],
      error: null,
    });
    unblockUser.mockResolvedValue({ error: GENERIC_ERROR });
    render(<BlockedScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unblock Bea Ortiz' }));
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(screen.getByText('Bea Ortiz')).toBeTruthy();
  });

  it('shows an error rather than the empty state when the load fails', async () => {
    fetchMyBlocks.mockResolvedValue({ error: GENERIC_ERROR });
    render(<BlockedScreen />);
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(screen.queryByText("You haven't blocked anyone.")).toBeNull();
  });

  it('goes back to Profile', async () => {
    fetchMyBlocks.mockResolvedValue({ data: [], error: null });
    canGoBack.mockReturnValue(false);
    render(<BlockedScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Profile' }));
    expect(replace).toHaveBeenCalledWith('/profile');
  });
});
