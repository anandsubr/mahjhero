import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * A render test of `app/index.tsx` itself, not of `resolveIndexRedirect`.
 *
 * That distinction is the whole point of this file. `resolveIndexRedirect` is
 * correct, and `app/__tests__/index.test.ts` proves it: given `undefined` for
 * a signed-in member it returns `null`, so the caller waits rather than
 * redirecting. The bug was that the component never gave it `undefined` to
 * work with.
 *
 * On the first render `useSession` reports `{ loading: true, session: null }`.
 * The effect's `!session` branch fired on that, setting `pendingInvite` to
 * `null` — "checked, nothing parked" — before anything had been checked. When
 * the session then resolved, the sentinel was already gone and the member was
 * sent straight to `/clubs`, past a real parked invite that stayed in
 * AsyncStorage forever.
 *
 * No test over the pure function can see this: every input it receives is
 * already wrong by the time it is called. Only a render that drives the
 * `loading: true -> false` transition can, which is why this file exists
 * alongside the other one rather than replacing it.
 */

const getItem = vi.fn(async () => null as string | null);

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: (...a: unknown[]) => getItem(...(a as [])) },
}));

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: null,
    loading: true,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

import Index from '../index';

const SESSION = { user: { id: 'test-user' } };

beforeEach(() => {
  vi.clearAllMocks();
  getItem.mockResolvedValue(null);
});

describe('Index, across the loading transition', () => {
  it('does not redirect to /clubs on the render where auth resolves', async () => {
    // The cold-launch sequence: mount while auth is still loading, then a
    // session appears. Park a token so the wrong answer is observable.
    getItem.mockResolvedValue('parked-token');
    useSessionMock.mockReturnValue({ session: null, loading: true });

    const { rerender } = render(<Index />);
    expect(screen.queryByTestId('redirect')).toBeNull();

    useSessionMock.mockReturnValue({ session: SESSION, loading: false });
    rerender(<Index />);

    // The failing assertion before the fix: `pendingInvite` was already
    // `null`, so this render redirected to `/clubs` and the parked invite was
    // never read.
    expect(screen.queryByTestId('redirect')?.getAttribute('data-href')).not.toBe(
      '/clubs',
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe(
        '/join/parked-token',
      );
    });
    expect(getItem).toHaveBeenCalled();
  });

  it('still sends a signed-in member with nothing parked to their clubs', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    const { rerender } = render(<Index />);

    useSessionMock.mockReturnValue({ session: SESSION, loading: false });
    rerender(<Index />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe(
        '/clubs',
      );
    });
  });

  it('sends a member who resolves signed-out to the welcome screen without reading storage', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    const { rerender } = render(<Index />);

    useSessionMock.mockReturnValue({ session: null, loading: false });
    rerender(<Index />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe(
        '/welcome',
      );
    });
    expect(getItem).not.toHaveBeenCalled();
  });
});
