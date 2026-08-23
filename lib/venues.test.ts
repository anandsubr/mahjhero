import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as lib/events.test.ts's mock: every function under test here is
// just `.rpc(name, args)`, so the mock models that directly.
const rpcMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { GENERIC_ERROR } from './constants';
import { createVenue, updateVenue } from './venues';

describe('createVenue', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const validInput = {
    clubId: 'club-1',
    name: 'Contract Test Hall',
  };

  it('rejects a blank name with a friendly message, before ever calling the RPC', async () => {
    await expect(createVenue({ ...validInput, name: '   ' })).resolves.toEqual({
      venueId: null,
      error: 'Give the venue a name.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // MINOR 7: name is validated with `.trim()` before the RPC call. lib/'s
  // never-rejects convention (see the block comment above toClubEvent in
  // lib/events.ts) means an untyped caller handing this a `null` must come
  // back as `{ error }`, not an unhandled rejection that strands the
  // create-venue screen on a spinner with no message.
  it('never rejects, even when name is not actually a string at runtime', async () => {
    await expect(
      createVenue({ ...validInput, name: null as unknown as string }),
    ).resolves.toEqual({ venueId: null, error: GENERIC_ERROR });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('creates a venue and maps a duplicate-name conflict to a friendly message', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'venue-1', error: null });
    await expect(createVenue(validInput)).resolves.toEqual({
      venueId: 'venue-1',
      error: null,
    });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await expect(createVenue(validInput)).resolves.toEqual({
      venueId: null,
      error: 'A shared venue with that name already exists here.',
    });
  });
});

describe('updateVenue', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('maps a duplicate public name to the same message createVenue uses, not a network error', async () => {
    // Renaming a public venue onto a name another public venue already holds
    // trips the same partial unique index `createVenue` maps. Before this,
    // `updateVenue` had no mapping at all and the rename reported "Could not
    // reach MahjHero. Check your connection and try again." — a false
    // statement about a request that arrived and was deliberately refused,
    // and one that made the create and edit paths disagree about a single
    // rule.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "venues_public_name_unique"',
      },
    });
    const result = await updateVenue('venue-1', { name: 'The Hall' });
    expect(result.error).toBe('A shared venue with that name already exists here.');
    expect(result.error).not.toBe(GENERIC_ERROR);
  });

  it('still reports an unrecognised failure as the generic message', async () => {
    // The mapping is for the one code that has a real answer behind it.
    // Anything else must keep falling back — a vague message is worse than a
    // precise one and much better than a wrong one.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });
    await expect(updateVenue('venue-1', { name: 'The Hall' })).resolves.toEqual({
      error: GENERIC_ERROR,
    });
  });

  it('reports success as no error at all', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await expect(updateVenue('venue-1', { name: 'The Hall' })).resolves.toEqual({
      error: null,
    });
  });
});
