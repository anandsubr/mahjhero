import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchDismissedGuides = vi.fn();
const saveDismissedGuides = vi.fn();
vi.mock('./guides', () => ({
  fetchDismissedGuides: (id: string) => fetchDismissedGuides(id),
  saveDismissedGuides: (id: string, keys: string[]) => saveDismissedGuides(id, keys),
}));

// Module-scoped: a fresh object per render would look like an account switch.
const SIGNED_IN = { session: { user: { id: 'u1' } }, loading: false };
let current: { session: { user: { id: string } } | null; loading: boolean } = SIGNED_IN;
vi.mock('./session', () => ({ useSession: () => current }));

import { GuidesProvider, useGuides } from './use-guides';

// A promise plus its own resolve(), for tests that need to control exactly
// when an async call settles relative to other actions.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Probe() {
  const guides = useGuides();
  return (
    <div>
      <span data-testid="event">{String(guides.isVisible('tip:event'))}</span>
      <button onClick={() => guides.dismiss('tip:event')}>dismiss</button>
      <button onClick={() => void guides.reset()}>reset</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  current = SIGNED_IN;
  saveDismissedGuides.mockResolvedValue(true);
});

describe('useGuides', () => {
  it('shows nothing without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows nothing until the dismissed list has loaded', () => {
    fetchDismissedGuides.mockReturnValue(new Promise(() => {}));
    render(<GuidesProvider><Probe /></GuidesProvider>);
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows nothing when the dismissed list could not be read', async () => {
    fetchDismissedGuides.mockResolvedValue(null);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(fetchDismissedGuides).toHaveBeenCalled());
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('shows a guide that is not dismissed', async () => {
    fetchDismissedGuides.mockResolvedValue([]);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
  });

  it('hides a dismissed guide at once and saves the new list', async () => {
    fetchDismissedGuides.mockResolvedValue(['player-intro']);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('event').textContent).toBe('false');
    expect(saveDismissedGuides).toHaveBeenCalledWith('u1', ['player-intro', 'tip:event']);
  });

  it('keeps a dismissed guide hidden even if the save fails', async () => {
    fetchDismissedGuides.mockResolvedValue([]);
    saveDismissedGuides.mockResolvedValue(false);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));
    await act(async () => fireEvent.click(screen.getByText('dismiss')));
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('reset clears the list and shows guides again', async () => {
    fetchDismissedGuides.mockResolvedValue(['tip:event']);
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(fetchDismissedGuides).toHaveBeenCalled());
    await act(async () => fireEvent.click(screen.getByText('reset')));
    expect(saveDismissedGuides).toHaveBeenCalledWith('u1', []);
    expect(screen.getByTestId('event').textContent).toBe('true');
  });

  it('shows nothing when signed out', () => {
    current = { session: null, loading: false };
    render(<GuidesProvider><Probe /></GuidesProvider>);
    expect(fetchDismissedGuides).not.toHaveBeenCalled();
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  // Regression: reset() awaits a server round trip. Two things can happen
  // while it's in flight — the signed-in account can change, or the user
  // can dismiss a guide — and reset's resolution must not clobber either.

  it('does not apply a reset meant for the account that was signed in when it started', async () => {
    fetchDismissedGuides.mockResolvedValueOnce(Promise.resolve(['g1']));
    const { rerender } = render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));

    const resetSave = deferred<boolean>();
    saveDismissedGuides.mockReturnValueOnce(resetSave.promise);
    fireEvent.click(screen.getByText('reset'));

    // Account switches to u2 before the reset's save resolves. u2's own
    // dismissed list hasn't loaded yet, so guides are hidden.
    const u2Fetch = deferred<string[] | null>();
    fetchDismissedGuides.mockReturnValueOnce(u2Fetch.promise);
    current = { session: { user: { id: 'u2' } }, loading: false };
    rerender(<GuidesProvider><Probe /></GuidesProvider>);
    expect(screen.getByTestId('event').textContent).toBe('false');

    // u1's reset now resolves. It must not touch u2's (still-loading) state.
    await act(async () => {
      resetSave.resolve(true);
      await Promise.resolve();
    });
    expect(screen.getByTestId('event').textContent).toBe('false');

    // u2's own load then completes normally, unaffected by u1's reset.
    await act(async () => {
      u2Fetch.resolve(['tip:event']);
      await Promise.resolve();
    });
    expect(screen.getByTestId('event').textContent).toBe('false');
  });

  it('keeps a dismissal made while a reset is in flight, and re-saves it', async () => {
    fetchDismissedGuides.mockResolvedValueOnce(Promise.resolve([]));
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));

    const resetSave = deferred<boolean>();
    saveDismissedGuides.mockReturnValueOnce(resetSave.promise);
    fireEvent.click(screen.getByText('reset'));

    // A dismissal lands while the reset's save is still in flight.
    saveDismissedGuides.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('event').textContent).toBe('false');

    // The reset's save now resolves ok. It must not revive the guide, and
    // must re-save so the server ends up holding the dismissal too.
    await act(async () => {
      resetSave.resolve(true);
      await Promise.resolve();
    });
    expect(screen.getByTestId('event').textContent).toBe('false');
    const lastCall = saveDismissedGuides.mock.calls[saveDismissedGuides.mock.calls.length - 1];
    expect(lastCall).toEqual(['u1', ['tip:event']]);
  });

  // Regression: the generation-mismatch branch used to re-save
  // `latest.current` as-is, which still carried whatever was dismissed
  // BEFORE reset even started -- silently reverting the reset for those
  // keys while `reset()` still resolved true. Starting from a non-empty
  // dismissed list makes that distinguishable from "reset cleared nothing
  // yet": only the key dismissed DURING the reset should survive.
  it('does not revive pre-reset dismissals when a dismissal lands mid-reset', async () => {
    fetchDismissedGuides.mockResolvedValueOnce(Promise.resolve(['tip:club', 'tip:new-game']));
    render(<GuidesProvider><Probe /></GuidesProvider>);
    await waitFor(() => expect(screen.getByTestId('event').textContent).toBe('true'));

    const resetSave = deferred<boolean>();
    saveDismissedGuides.mockReturnValueOnce(resetSave.promise);
    fireEvent.click(screen.getByText('reset'));

    // A dismissal of a DIFFERENT guide lands while the reset's save for
    // ['tip:club', 'tip:new-game'] -> [] is still in flight.
    saveDismissedGuides.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('event').textContent).toBe('false');

    // The reset's save now resolves ok. The final state must show only the
    // guide dismissed during the reset -- not the two pre-reset ones, which
    // reset was clearing -- and the server must end up holding exactly that.
    await act(async () => {
      resetSave.resolve(true);
      await Promise.resolve();
    });
    expect(screen.getByTestId('event').textContent).toBe('false');
    const lastCall = saveDismissedGuides.mock.calls[saveDismissedGuides.mock.calls.length - 1];
    expect(lastCall).toEqual(['u1', ['tip:event']]);
  });
});
