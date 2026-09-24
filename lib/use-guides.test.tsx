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
});
