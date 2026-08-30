import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as lib/venues.test.ts's mock: every function under test here is
// just `.rpc(name, args)`, so the mock models that directly.
const rpcMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { GENERIC_ERROR } from './constants';
import {
  addFriend,
  fetchAddablePeople,
  fetchFriends,
  removeFriend,
  sharedClubsLabel,
} from './friends';

describe('sharedClubsLabel', () => {
  it('joins several clubs for the artboard’s muted line', () => {
    expect(sharedClubsLabel(['Riverside', 'Oakfield'])).toBe(
      'Riverside · Oakfield',
    );
  });

  // The friend you acquired in a club one of you has since left. An empty
  // array is a real answer from fetch_friends, not a failure, and a blank
  // line under their name would read as a rendering bug.
  it('says so plainly when nothing is shared any more', () => {
    expect(sharedClubsLabel([])).toBe('No clubs in common');
  });
});

describe('fetchFriends', () => {
  beforeEach(() => rpcMock.mockReset());

  it('returns the rows', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { profile_id: 'p1', display_name: 'Bob Reyes', club_names: ['Riverside'] },
      ],
      error: null,
    });
    await expect(fetchFriends()).resolves.toEqual([
      { profile_id: 'p1', display_name: 'Bob Reyes', club_names: ['Riverside'] },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_friends');
  });

  it('resolves an empty array, not null, when there are no friends', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchFriends()).resolves.toEqual([]);
  });

  // null is reserved for "we could not ask" so the screen can tell that
  // apart from "you have no friends" and show an error instead of an empty
  // state. Same contract as fetchThreadMessages in lib/messages.ts.
  it('resolves null on failure rather than rejecting', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchFriends()).resolves.toBeNull();
  });

  it('never rejects, even when the client throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchFriends()).resolves.toBeNull();
  });
});

describe('fetchAddablePeople', () => {
  beforeEach(() => rpcMock.mockReset());

  it('returns the rows', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Oakfield' }],
      error: null,
    });
    await expect(fetchAddablePeople()).resolves.toEqual([
      { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Oakfield' },
    ]);
    expect(rpcMock).toHaveBeenCalledWith('fetch_addable_people');
  });

  it('resolves null on failure', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchAddablePeople()).resolves.toBeNull();
  });
});

describe('addFriend', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls the RPC and reports success', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(addFriend('p2')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('add_friend', { target: 'p2' });
  });

  // add_friend's refusal is written to be read by a member — "you can only
  // add someone from one of your clubs" — so it is relayed verbatim rather
  // than flattened to GENERIC_ERROR. Same contract lib/messages.ts records
  // for postMessage.
  it('relays the refusal verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'you can only add someone from one of your clubs' },
    });
    await expect(addFriend('p9')).resolves.toEqual({
      error: 'you can only add someone from one of your clubs',
    });
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(addFriend('p2')).resolves.toEqual({ error: GENERIC_ERROR });
  });
});

describe('removeFriend', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls the RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(removeFriend('p2')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('remove_friend', { target: 'p2' });
  });

  it('never rejects', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await expect(removeFriend('p2')).resolves.toEqual({ error: GENERIC_ERROR });
  });
});
