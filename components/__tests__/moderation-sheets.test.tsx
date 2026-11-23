import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Platform } from 'react-native';

const reportContent = vi.fn();
const blockUser = vi.fn();
vi.mock('../../lib/moderation', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/moderation')>('../../lib/moderation');
  return {
    ...actual,
    reportContent: (...a: unknown[]) => reportContent(...a),
    blockUser: (...a: unknown[]) => blockUser(...a),
  };
});

import ActionSheet from '../moderation/ActionSheet';
import ReportSheet from '../moderation/ReportSheet';
import { CONFIRM_DISMISS_MS, useModeration } from '../moderation/useModeration';
import { GENERIC_ERROR } from '../../lib/constants';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActionSheet', () => {
  const realOS = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = realOS;
    vi.useRealTimers();
  });

  it('closes, then runs the chosen action', () => {
    const order: string[] = [];
    render(
      <ActionSheet
        actions={[{ label: 'Report', onPress: () => order.push('report') }]}
        onClose={() => order.push('close')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(order).toEqual(['close', 'report']);
  });

  it('closes without running anything on Cancel or the scrim', () => {
    const onPress = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<ActionSheet actions={[{ label: 'Report', onPress }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    unmount();
    render(<ActionSheet actions={[{ label: 'Report', onPress }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onPress).not.toHaveBeenCalled();
  });

  // iOS cannot present the next sheet until this one has gone, so the action
  // waits for the dismissal -- or a fallback timer if iOS never reports it.
  it('on iOS, runs the action only once the sheet has gone', () => {
    (Platform as { OS: string }).OS = 'ios';
    vi.useFakeTimers();
    const onPress = vi.fn();
    const onClose = vi.fn();
    render(<ActionSheet actions={[{ label: 'Report', onPress }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(onPress).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ReportSheet', () => {
  it('lists the four reasons and keeps Submit disabled until one is picked', () => {
    render(<ReportSheet kind="message" targetId="m1" onClose={vi.fn()} />);
    for (const label of ['Spam', 'Harassment or bullying', 'Inappropriate content', 'Something else']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(reportContent).not.toHaveBeenCalled();
  });

  it('submits the reason and details, then shows the confirmation', async () => {
    reportContent.mockResolvedValue({ data: 'r1', error: null });
    const onClose = vi.fn();
    render(<ReportSheet kind="profile" targetId="p2" onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value: 'Fake account' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText("Thanks. We'll review this within 24 hours.")).toBeTruthy();
    expect(reportContent).toHaveBeenCalledWith({
      kind: 'profile',
      targetId: 'p2',
      reason: 'other',
      details: 'Fake account',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a failure and lets the reporter try again', async () => {
    reportContent.mockResolvedValueOnce({ error: GENERIC_ERROR });
    reportContent.mockResolvedValueOnce({ data: 'r1', error: null });
    render(<ReportSheet kind="message" targetId="m1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByText("Thanks. We'll review this within 24 hours.")).toBeTruthy());
  });
});

describe('useModeration block failures', () => {
  const realOS = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = realOS;
    vi.useRealTimers();
  });

  function Harness() {
    const m = useModeration();
    return (
      <>
        <button onClick={() => m.startBlock('p2', 'Bea')}>start</button>
        {m.sheets}
      </>
    );
  }

  async function blockOnce() {
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Block' }));
  }

  it('shows the OK sheet again on a second identical failure', async () => {
    blockUser.mockResolvedValue({ error: GENERIC_ERROR });
    render(<Harness />);
    await blockOnce();
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
    await blockOnce();
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(blockUser).toHaveBeenCalledTimes(2);
  });

  it('clears a standing failure before the next attempt', async () => {
    blockUser.mockResolvedValueOnce({ error: GENERIC_ERROR });
    let settle!: (v: { error: string | null }) => void;
    blockUser.mockReturnValueOnce(new Promise((r) => (settle = r)));
    render(<Harness />);
    await blockOnce();
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    await blockOnce();
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
    await act(async () => settle({ error: GENERIC_ERROR }));
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
  });

  it('on iOS, holds a fast failure until the confirm sheet has gone', async () => {
    blockUser.mockResolvedValue({ error: GENERIC_ERROR });
    render(<Harness />);
    fireEvent.click(screen.getByText('start'));
    const confirm = screen.getByTestId('confirm-sheet');
    // Only the block's own timing is under test; set iOS once the sheet is up.
    (Platform as { OS: string }).OS = 'ios';
    const started = Date.now();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Block' }));
    });
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
    await waitFor(() => expect(screen.getByText(GENERIC_ERROR)).toBeTruthy(), { timeout: 2000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(CONFIRM_DISMISS_MS - 20);
  });
});
