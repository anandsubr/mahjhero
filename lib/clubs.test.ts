// fetchMyRoles' read path is `.from('club_members').select(...).eq(...).eq(...).order(...)`
// — the same eq-then-eq-then-terminal shape other lib/*.test.ts files already
// model for a plain filtered select with no .single()/.maybeSingle().
const orderAfterEq = vi.fn();
const eqAfterEq = vi.fn(() => ({ order: orderAfterEq }));
// fetchPendingInvites' read path: `.from('club_invites').select(...)
// .eq('club_id', ...).is('accepted_at', null).order('created_at')` — same
// terminal `orderAfterEq`, but a one-eq-then-is shape instead of
// eq-then-eq, since this filters on a nullable timestamp rather than a
// second equality. Named separately from `eqAfterEq` so tests can assert
// the exact arguments each filter step was called with.
const isAfterEq = vi.fn(() => ({ order: orderAfterEq }));
const eqAfterSelect = vi.fn(() => ({ eq: eqAfterEq, is: isAfterEq }));
// deleteInvite's write path: `.from('club_invites').delete().eq(...).select(...)`
// — the same shape lib/greetings.test.ts already models for deleteGreeting.
const deleteResult = vi.fn();
// acceptClubInvite, declineClubInvite, setDefaultGameMode, createInvite,
// fetchMyPendingInvites: `.rpc()` calls
const rpcMock = vi.fn();
// sendClubInviteEmail: `.functions.invoke()` call. No other test in this
// codebase mocks `functions` yet, so this follows the same
// vi.fn()-per-method convention `rpc` and `from` already use above rather
// than introducing a different pattern.
const functionsInvokeMock = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: eqAfterSelect,
      })),
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ select: deleteResult })) })),
    })),
    functions: {
      invoke: (...args: unknown[]) => functionsInvokeMock(...args),
    },
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ERROR } from './constants';
import {
  MAX_ROSTER_ROWS,
  acceptClubInvite,
  canAnnounce,
  canInvite,
  createInvite,
  declineClubInvite,
  deleteInvite,
  fetchMyPendingInvites,
  fetchMyRoles,
  fetchPendingInvites,
  importRoster,
  parseRoster,
  sendClubInviteEmail,
  setDefaultGameMode,
  slugify,
} from './clubs';

beforeEach(() => {
  deleteResult.mockReset();
  deleteResult.mockRejectedValue(new Error('network down'));
  rpcMock.mockReset();
  functionsInvokeMock.mockReset();
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Riverside Mah Jongg')).toBe('riverside-mah-jongg');
  });

  it('strips punctuation rather than encoding it', () => {
    expect(slugify("Nana's Tiles!")).toBe('nanas-tiles');
  });

  it('collapses runs of separators', () => {
    expect(slugify('Oakfield   --  Tiles')).toBe('oakfield-tiles');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('canInvite', () => {
  it('allows a host', () => {
    expect(canInvite('host')).toBe(true);
  });

  it('allows a co-organizer', () => {
    expect(canInvite('co_organizer')).toBe(true);
  });

  it('refuses a plain member', () => {
    expect(canInvite('member')).toBe(false);
  });
});

describe('canAnnounce', () => {
  it('allows a host', () => {
    expect(canAnnounce('host')).toBe(true);
  });

  it('allows a co-organizer', () => {
    expect(canAnnounce('co_organizer')).toBe(true);
  });

  it('refuses a plain member', () => {
    expect(canAnnounce('member')).toBe(false);
  });
});

describe('fetchMyRoles', () => {
  beforeEach(() => {
    orderAfterEq.mockReset();
  });

  it('returns the rows on success', async () => {
    orderAfterEq.mockResolvedValue({
      data: [{ club_id: 'club-1', role: 'host' }],
      error: null,
    });
    const result = await fetchMyRoles('user-1');
    expect(result).toEqual([{ club_id: 'club-1', role: 'host' }]);
  });

  it('returns an empty array, not null, when the member is in no clubs', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    const result = await fetchMyRoles('user-1');
    expect(result).toEqual([]);
  });

  it('returns null on a failed read', async () => {
    orderAfterEq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await fetchMyRoles('user-1');
    expect(result).toBeNull();
  });
});

describe('parseRoster', () => {
  it('reads name, email, and skill level from a header row', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,beginner';
    expect(parseRoster(csv)).toEqual({
      rows: [
        { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: 'beginner' },
      ],
      errors: [],
    });
  });

  it('tolerates columns in any order and ignores unknown ones', () => {
    const csv = 'Email,Nickname,Name\njane@example.com,jd,Jane Doe';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
    ]);
  });

  it('reports the row number for a bad email rather than dropping it', () => {
    const csv = 'name,email\nJane Doe,not-an-email';
    const result = parseRoster(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: 'Not a valid email address' }]);
  });

  it('rejects a file with no email column', () => {
    const result = parseRoster('name\nJane Doe');
    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(/email column/i);
  });

  it('ignores an unrecognised skill level rather than guessing', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,expert';
    expect(parseRoster(csv).rows[0].skill_level).toBeNull();
  });

  /*
   * The parser used `line.split(',')`, which cannot read the file this screen
   * exists to accept. Google Sheets and Excel quote any field containing a
   * comma, and `"Last, First"` is the most common way a roster spreadsheet
   * stores a name — so the name split into two cells, every column after it
   * shifted left, the email column held a surname, and each affected row came
   * back as "Not a valid email address". The host was told their export was
   * broken when it was the only correct thing in the exchange.
   */
  it('reads a quoted name containing a comma as one field', () => {
    const csv = 'name,email\n"Doe, Jane",jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Doe, Jane', email: 'jane@example.com', skill_level: null },
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const csv = 'name,email\n"Jane ""JD"" Doe",jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      {
        display_name: 'Jane "JD" Doe',
        email: 'jane@example.com',
        skill_level: null,
      },
    ]);
  });

  it('reads a quoted header cell and a quoted email', () => {
    const csv = '"name","email","skill"\n"Doe, Jane","jane@example.com","beginner"';
    expect(parseRoster(csv).rows).toEqual([
      {
        display_name: 'Doe, Jane',
        email: 'jane@example.com',
        skill_level: 'beginner',
      },
    ]);
  });

  it('keeps a comma-free row parsing exactly as before', () => {
    const csv = 'name,email\nJane Doe,jane@example.com';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
    ]);
  });

  // A pasted export can be arbitrarily large; without a cap it becomes one
  // unbounded INSERT. Refused rather than truncated, so a host who pastes the
  // wrong file is told so instead of silently importing a prefix of it.
  it('refuses a paste larger than the row cap without building the rows', () => {
    const body = Array.from(
      { length: MAX_ROSTER_ROWS + 1 },
      (_, i) => `Person ${i},p${i}@example.com`,
    ).join('\n');
    const result = parseRoster(`name,email\n${body}`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(new RegExp(`${MAX_ROSTER_ROWS}`));
  });

  it('accepts a paste exactly at the row cap', () => {
    const body = Array.from(
      { length: MAX_ROSTER_ROWS },
      (_, i) => `Person ${i},p${i}@example.com`,
    ).join('\n');
    expect(parseRoster(`name,email\n${body}`).rows).toHaveLength(MAX_ROSTER_ROWS);
  });
});

describe('importRoster', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  // The plan's own constraint is "treat zero rows as failure", but the
  // function returned `{ created: 0, error: null }` — a success — so the
  // import screen redirected to `/clubs/<id>?imported=0` and told the host
  // their import had worked when it had invited nobody.
  it('treats an empty row list as a failure, not a silent success', async () => {
    const result = await importRoster('club-1', []);
    expect(result.invites).toEqual([]);
    expect(result.error).not.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // Belt to parseRoster's braces: nothing stops a future caller assembling
  // rows some other way, and the cap protects an unbounded loop of RPC calls.
  it('refuses more rows than the cap without reaching the network', async () => {
    const rows = Array.from({ length: MAX_ROSTER_ROWS + 1 }, (_, i) => ({
      display_name: `Person ${i}`,
      email: `p${i}@example.com`,
      skill_level: null,
    }));
    const result = await importRoster('club-1', rows);
    expect(result.invites).toEqual([]);
    expect(result.error).toMatch(new RegExp(`${MAX_ROSTER_ROWS}`));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // Direct table INSERT on club_invites is revoked (Task 2); creation now
  // goes through create_club_invite, one call per row.
  it('calls create_club_invite once per row and returns every created invite', async () => {
    const rows = [
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: 'beginner' as const },
      { display_name: 'John Roe', email: 'john@example.com', skill_level: null },
    ];
    rpcMock.mockResolvedValueOnce({ data: 'invite-1', error: null });
    rpcMock.mockResolvedValueOnce({ data: 'invite-2', error: null });

    const result = await importRoster('club-1', rows);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'create_club_invite', {
      target_club_id: 'club-1',
      target_email: 'jane@example.com',
      target_display_name: 'Jane Doe',
      target_event_id: null,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'create_club_invite', {
      target_club_id: 'club-1',
      target_email: 'john@example.com',
      target_display_name: 'John Roe',
      target_event_id: null,
    });
    expect(result).toEqual({
      invites: [
        { id: 'invite-1', email: 'jane@example.com', display_name: 'Jane Doe' },
        { id: 'invite-2', email: 'john@example.com', display_name: 'John Roe' },
      ],
      error: null,
    });
  });

  // The old bulk INSERT was one statement, so it was genuinely all-or-nothing.
  // A loop of per-row RPC calls can't offer that same atomicity, so one row
  // failing (e.g. "already a member") must not sink the rows that already
  // succeeded -- this is the deliberate non-atomic contract the new
  // implementation adopts instead of a false all-or-nothing guarantee.
  it('keeps the rows that succeeded when one row fails', async () => {
    const rows = [
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
      { display_name: 'Already Member', email: 'existing@example.com', skill_level: null },
      { display_name: 'John Roe', email: 'john@example.com', skill_level: null },
    ];
    rpcMock.mockResolvedValueOnce({ data: 'invite-1', error: null });
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'That person is already in this club.' },
    });
    rpcMock.mockResolvedValueOnce({ data: 'invite-3', error: null });

    const result = await importRoster('club-1', rows);

    expect(rpcMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      invites: [
        { id: 'invite-1', email: 'jane@example.com', display_name: 'Jane Doe' },
        { id: 'invite-3', email: 'john@example.com', display_name: 'John Roe' },
      ],
      error: null,
    });
  });

  it('returns a generic error when every row fails', async () => {
    const rows = [{ display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null }];
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });

    const result = await importRoster('club-1', rows);

    expect(result).toEqual({ invites: [], error: GENERIC_ERROR });
  });
});

describe('deleteInvite', () => {
  it('returns no error on success', async () => {
    deleteResult.mockResolvedValue({ data: [{ id: 'invite-1' }], error: null });
    expect(await deleteInvite('invite-1')).toEqual({ error: null });
  });

  it('returns an error when the delete itself fails', async () => {
    deleteResult.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await deleteInvite('invite-1')).toEqual({ error: GENERIC_ERROR });
  });

  // RLS denies a delete it disallows by matching zero rows, not by
  // erroring -- club_invites_delete_organizer would otherwise report
  // success for an invite the caller was never allowed to touch.
  it('treats a zero-row result as failure, not silent success', async () => {
    deleteResult.mockResolvedValue({ data: [], error: null });
    expect(await deleteInvite('invite-1')).toEqual({ error: GENERIC_ERROR });
  });

  it('returns an error rather than throwing on a network failure', async () => {
    deleteResult.mockRejectedValue(new Error('network down'));
    expect(await deleteInvite('invite-1')).toEqual({ error: GENERIC_ERROR });
  });
});

describe('fetchPendingInvites', () => {
  beforeEach(() => {
    orderAfterEq.mockReset();
    eqAfterSelect.mockClear();
    isAfterEq.mockClear();
  });

  it('filters by club_id and unaccepted status, with no expires_at filter', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    await fetchPendingInvites('club-1');
    expect(eqAfterSelect).toHaveBeenCalledWith('club_id', 'club-1');
    expect(isAfterEq).toHaveBeenCalledWith('accepted_at', null);
    // `.is('accepted_at', null)`'s mocked return value only has `order` on
    // it -- if the source still called `.gt('expires_at', ...)` (the
    // filter Step 3 of this task removed), that call would hit a method
    // the mock doesn't provide, throw, and fetchPendingInvites' own catch
    // would turn the throw into a `null` result instead of the `[]` the
    // next assertion checks for.
    expect(isAfterEq.mock.results[0].value).toEqual({ order: orderAfterEq });
  });

  it('returns the rows, with declined_at intact, on success', async () => {
    orderAfterEq.mockResolvedValue({
      data: [
        {
          id: 'invite-1',
          email: 'jane@example.com',
          display_name: 'Jane Doe',
          skill_level: 'beginner',
          declined_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const result = await fetchPendingInvites('club-1');
    expect(result).toEqual([
      {
        id: 'invite-1',
        email: 'jane@example.com',
        display_name: 'Jane Doe',
        skill_level: 'beginner',
        declined_at: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns an empty array, not null, when there are no invites', async () => {
    orderAfterEq.mockResolvedValue({ data: [], error: null });
    const result = await fetchPendingInvites('club-1');
    expect(result).toEqual([]);
  });

  it('returns null on a failed read', async () => {
    orderAfterEq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await fetchPendingInvites('club-1');
    expect(result).toBeNull();
  });

  it('never rejects on a network failure', async () => {
    orderAfterEq.mockRejectedValue(new Error('network down'));
    const result = await fetchPendingInvites('club-1');
    expect(result).toBeNull();
  });
});

describe('acceptClubInvite', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns clubId and eventId on success with an event-tied invite', async () => {
    rpcMock.mockResolvedValue({
      data: { club_id: 'c1', event_id: 'e1' },
      error: null,
    });
    const result = await acceptClubInvite('invite-1');
    expect(result).toEqual({
      clubId: 'c1',
      eventId: 'e1',
      error: null,
    });
  });

  it('returns clubId and null eventId on success with a plain invite', async () => {
    rpcMock.mockResolvedValue({
      data: { club_id: 'c1', event_id: null },
      error: null,
    });
    const result = await acceptClubInvite('invite-1');
    expect(result).toEqual({
      clubId: 'c1',
      eventId: null,
      error: null,
    });
  });

  it('calls the RPC with invite_id, not invite_token', async () => {
    rpcMock.mockResolvedValue({
      data: { club_id: 'c1', event_id: null },
      error: null,
    });
    await acceptClubInvite('invite-1');
    expect(rpcMock).toHaveBeenCalledWith('accept_club_invite', {
      invite_id: 'invite-1',
    });
  });

  it('returns error when the RPC fails', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'some error' },
    });
    const result = await acceptClubInvite('invite-1');
    expect(result).toEqual({
      clubId: null,
      eventId: null,
      error: GENERIC_ERROR,
    });
  });

  it('returns an invalid-invite error when data is null', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });
    const result = await acceptClubInvite('invite-1');
    expect(result).toEqual({
      clubId: null,
      eventId: null,
      error: 'That invite is no longer valid.',
    });
  });

  it('never rejects on a network failure', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const result = await acceptClubInvite('invite-1');
    expect(result).toEqual({
      clubId: null,
      eventId: null,
      error: GENERIC_ERROR,
    });
  });
});

describe('declineClubInvite', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns no error on success', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const result = await declineClubInvite('invite-1');
    expect(result).toEqual({ error: null });
  });

  it('calls the RPC with invite_id', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await declineClubInvite('invite-1');
    expect(rpcMock).toHaveBeenCalledWith('decline_club_invite', {
      invite_id: 'invite-1',
    });
  });

  it('returns error when the RPC fails', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'some error' },
    });
    const result = await declineClubInvite('invite-1');
    expect(result).toEqual({ error: GENERIC_ERROR });
  });

  it('returns an invalid-invite error when data is null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await declineClubInvite('invite-1');
    expect(result).toEqual({ error: 'That invite is no longer valid.' });
  });

  it('never rejects on a network failure', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const result = await declineClubInvite('invite-1');
    expect(result).toEqual({ error: GENERIC_ERROR });
  });
});

describe('createInvite', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns the id on success', async () => {
    rpcMock.mockResolvedValue({ data: 'invite-1', error: null });
    const result = await createInvite('club-1', 'jane@example.com');
    expect(result).toEqual({
      id: 'invite-1',
      error: null,
    });
  });

  it('calls the RPC with the target_* argument names', async () => {
    rpcMock.mockResolvedValue({ data: 'invite-1', error: null });
    await createInvite('club-1', 'jane@example.com', 'Jane Doe', 'event-1');
    expect(rpcMock).toHaveBeenCalledWith('create_club_invite', {
      target_club_id: 'club-1',
      target_email: 'jane@example.com',
      target_display_name: 'Jane Doe',
      target_event_id: 'event-1',
    });
  });

  it('trims the email and display name before sending them', async () => {
    rpcMock.mockResolvedValue({ data: 'invite-1', error: null });
    await createInvite('club-1', ' jane@example.com ', ' Jane Doe ');
    expect(rpcMock).toHaveBeenCalledWith('create_club_invite', {
      target_club_id: 'club-1',
      target_email: 'jane@example.com',
      target_display_name: 'Jane Doe',
      target_event_id: null,
    });
  });

  it('defaults target_display_name to an empty string and target_event_id to null when not provided', async () => {
    rpcMock.mockResolvedValue({ data: 'invite-1', error: null });
    await createInvite('club-1', 'jane@example.com');
    expect(rpcMock).toHaveBeenCalledWith('create_club_invite', {
      target_club_id: 'club-1',
      target_email: 'jane@example.com',
      target_display_name: '',
      target_event_id: null,
    });
  });

  it('returns a friendly error when the person is already in the club', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'That person is already in this club.' },
    });
    const result = await createInvite('club-1', 'jane@example.com');
    expect(result).toEqual({
      id: null,
      error: 'That person is already in this club.',
    });
  });

  it('returns a generic error for any other RPC failure', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'some other error' },
    });
    const result = await createInvite('club-1', 'jane@example.com');
    expect(result).toEqual({
      id: null,
      error: GENERIC_ERROR,
    });
  });

  it('never rejects on a network failure', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const result = await createInvite('club-1', 'jane@example.com');
    expect(result).toEqual({
      id: null,
      error: GENERIC_ERROR,
    });
  });
});

describe('fetchMyPendingInvites', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('maps club_id/club_name/event_id/event_title to the camelCase shape on success', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 'invite-1',
          club_id: 'club-1',
          club_name: 'Riverside Mah Jongg',
          event_id: 'event-1',
          event_title: 'Friday Night',
        },
      ],
      error: null,
    });
    const result = await fetchMyPendingInvites();
    expect(result).toEqual([
      {
        id: 'invite-1',
        clubId: 'club-1',
        clubName: 'Riverside Mah Jongg',
        eventId: 'event-1',
        eventTitle: 'Friday Night',
      },
    ]);
  });

  // Matches this function's own code, not `fetchMyRoles`' empty-array
  // convention: an RPC error here resolves to `null`, same as
  // `fetchPendingInvites`.
  it('returns null on an RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await fetchMyPendingInvites();
    expect(result).toBeNull();
  });

  it('never rejects on a network failure', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const result = await fetchMyPendingInvites();
    expect(result).toBeNull();
  });
});

describe('setDefaultGameMode', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns no error on success', async () => {
    rpcMock.mockResolvedValue({ error: null });
    const result = await setDefaultGameMode('club-1', 'invite_only');
    expect(result).toEqual({ error: null });
  });

  it('returns GENERIC_ERROR when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'some error' } });
    const result = await setDefaultGameMode('club-1', 'invite_only');
    expect(result).toEqual({ error: GENERIC_ERROR });
  });

  it('never rejects on a network failure', async () => {
    rpcMock.mockRejectedValue(new Error('network down'));
    const result = await setDefaultGameMode('club-1', 'invite_only');
    expect(result).toEqual({ error: GENERIC_ERROR });
  });
});

describe('sendClubInviteEmail', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    functionsInvokeMock.mockRejectedValueOnce(new Error('network down'));
    await expect(
      sendClubInviteEmail({ to: 'a@example.com', clubName: 'Tiles Club' }),
    ).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it('returns GENERIC_ERROR when the edge function reports an error', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const result = await sendClubInviteEmail({ to: 'a@example.com', clubName: 'Tiles Club' });
    expect(result).toEqual({ error: GENERIC_ERROR });
  });

  it('passes the payload through to the edge function unchanged', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await sendClubInviteEmail({
      to: 'a@example.com',
      clubName: 'Tiles Club',
      inviteeDisplayName: 'Ann',
    });
    expect(functionsInvokeMock).toHaveBeenCalledWith('send-club-invite', {
      body: { to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' },
    });
  });

  it('resolves with no error on success', async () => {
    functionsInvokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const result = await sendClubInviteEmail({ to: 'a@example.com', clubName: 'Tiles Club' });
    expect(result).toEqual({ error: null });
  });
});
