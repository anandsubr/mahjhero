import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MembersPanel from '../MembersPanel';
import type { ThreadDetail } from '../../../lib/messages';

const replace = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace }),
}));

const addToGroupThread = vi.fn();
const leaveGroupThread = vi.fn();

vi.mock('../../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/messages')>('../../../lib/messages');
  return {
    ...actual,
    addToGroupThread: (...a: unknown[]) => addToGroupThread(...a),
    leaveGroupThread: (...a: unknown[]) => leaveGroupThread(...a),
  };
});

const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();

vi.mock('../../../lib/friends', () => ({
  fetchFriends: (...a: unknown[]) => fetchFriends(...a),
  fetchAddablePeople: (...a: unknown[]) => fetchAddablePeople(...a),
}));

const THREAD: ThreadDetail = {
  id: 't1',
  club_id: null,
  event_id: null,
  title: null,
  clubs: null,
  events: null,
  thread_members: [
    { profile_id: 'me', profiles: { display_name: 'You' } },
    { profile_id: 'other', profiles: { display_name: 'Sara Lindqvist' } },
  ],
};

beforeEach(() => {
  addToGroupThread.mockReset().mockResolvedValue({ error: null });
  leaveGroupThread.mockReset().mockResolvedValue({ error: null });
  fetchFriends.mockReset().mockResolvedValue([]);
  fetchAddablePeople.mockReset().mockResolvedValue([
    { profile_id: 'p1', display_name: 'Bob Reyes', club_name: 'Riverside' },
  ]);
  replace.mockReset();
});

describe('MembersPanel', () => {
  it('lists the roster', () => {
    render(<MembersPanel thread={THREAD} onChanged={() => {}} onLeaveError={() => {}} />);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Sara Lindqvist')).toBeTruthy();
    expect(screen.getByLabelText('Add people')).toBeTruthy();
    expect(screen.getByLabelText('Leave')).toBeTruthy();
  });

  it('adds the picked people and reports the change', async () => {
    const onChanged = vi.fn();
    render(<MembersPanel thread={THREAD} onChanged={onChanged} onLeaveError={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Add people'));
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Add'));
    await waitFor(() => expect(addToGroupThread).toHaveBeenCalledWith('t1', ['p1']));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  // Guards against the same bug class as sendingRef -- addBusy state is
  // read from the render closure, so a second activation landing before
  // React re-renders with the disabled button would otherwise double the
  // RPC call.
  it('adds only once when Add is activated twice before it settles', async () => {
    let resolveAdd!: (value: { error: string | null }) => void;
    addToGroupThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        }),
    );
    render(<MembersPanel thread={THREAD} onChanged={() => {}} onLeaveError={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Add people'));
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    const add = screen.getByLabelText('Add');

    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
    });

    expect(addToGroupThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAdd({ error: null });
      await Promise.resolve();
    });
  });

  it('leaves on confirm and navigates back to the messages list', async () => {
    render(<MembersPanel thread={THREAD} onChanged={() => {}} onLeaveError={() => {}} />);
    fireEvent.click(screen.getByLabelText('Leave'));
    expect(leaveGroupThread).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByLabelText('Confirm leave'));
    await waitFor(() => expect(leaveGroupThread).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages'));
  });

  // The leave refusal surfaces through the screen's own top-level error
  // banner, not a panel-local one -- addError (rendered inside this panel)
  // is reserved for the Add flow. This is why the panel takes onLeaveError
  // rather than rendering its own banner for this case.
  it('reports a leave refusal to the caller instead of navigating away', async () => {
    leaveGroupThread.mockResolvedValueOnce({ error: 'you are not in this conversation' });
    const onLeaveError = vi.fn();
    render(<MembersPanel thread={THREAD} onChanged={() => {}} onLeaveError={onLeaveError} />);
    fireEvent.click(screen.getByLabelText('Leave'));
    fireEvent.click(await screen.findByLabelText('Confirm leave'));
    await waitFor(() =>
      expect(onLeaveError).toHaveBeenCalledWith('you are not in this conversation'),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves only once when Confirm is activated twice before it settles', async () => {
    let resolveLeave!: (value: { error: string | null }) => void;
    leaveGroupThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLeave = resolve;
        }),
    );
    render(<MembersPanel thread={THREAD} onChanged={() => {}} onLeaveError={() => {}} />);
    fireEvent.click(screen.getByLabelText('Leave'));
    const confirm = await screen.findByLabelText('Confirm leave');

    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(leaveGroupThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLeave({ error: null });
      await Promise.resolve();
    });
  });
});
