import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import { blockUser, fetchMyBlocks, REPORT_REASONS, reportContent, unblockUser } from './moderation';

const rpc = vi.mocked(supabase.rpc);
const invoke = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  invoke.mockResolvedValue({ data: { sent: true }, error: null } as never);
});

describe('reportContent', () => {
  it('files the report, then asks notify-report to email the admin', async () => {
    rpc.mockResolvedValue({ data: 'r1', error: null } as never);
    const result = await reportContent({
      kind: 'message',
      targetId: 'm1',
      reason: 'spam',
      details: '  buy now  ',
    });
    expect(result).toEqual({ data: 'r1', error: null });
    expect(rpc).toHaveBeenCalledWith('report_content', {
      p_kind: 'message',
      p_target_id: 'm1',
      p_reason: 'spam',
      p_details: 'buy now',
    });
    expect(invoke).toHaveBeenCalledWith('notify-report', {
      body: { report_id: 'r1' },
    });
  });

  it('sends empty details as null', async () => {
    rpc.mockResolvedValue({ data: 'r1', error: null } as never);
    await reportContent({
      kind: 'profile',
      targetId: 'p1',
      reason: 'other',
      details: '   ',
    });
    expect(rpc).toHaveBeenCalledWith('report_content', expect.objectContaining({ p_details: null }));
  });

  it('never surfaces a failed email', async () => {
    rpc.mockResolvedValue({ data: 'r1', error: null } as never);
    invoke.mockRejectedValue(new Error('down'));
    expect(
      await reportContent({
        kind: 'club_media',
        targetId: 'x',
        reason: 'inappropriate',
      }),
    ).toEqual({
      data: 'r1',
      error: null,
    });
  });

  it('resolves even when notify-report never settles', async () => {
    rpc.mockResolvedValue({ data: 'r1', error: null } as never);
    invoke.mockReturnValue(new Promise(() => {}) as never);
    await expect(
      reportContent({ kind: 'message', targetId: 'm1', reason: 'spam' }),
    ).resolves.toEqual({ data: 'r1', error: null });
    expect(invoke).toHaveBeenCalled();
  });

  it('maps a refusal to the generic error and sends no email', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'you cannot report this' },
    } as never);
    expect(await reportContent({ kind: 'message', targetId: 'm1', reason: 'spam' })).toEqual({
      error: GENERIC_ERROR,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('lists the four reasons with their exact labels', () => {
    expect(REPORT_REASONS.map((r) => r.label)).toEqual([
      'Spam',
      'Harassment or bullying',
      'Inappropriate content',
      'Something else',
    ]);
  });
});

describe('blockUser / unblockUser', () => {
  it('calls the RPCs with the target', async () => {
    rpc.mockResolvedValue({ data: null, error: null } as never);
    expect(await blockUser('p2')).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith('block_user', { p_target: 'p2' });
    expect(await unblockUser('p2')).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith('unblock_user', { p_target: 'p2' });
  });

  it('maps a failure to the generic error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'no such person' },
    } as never);
    expect(await blockUser('p2')).toEqual({ error: GENERIC_ERROR });
  });
});

describe('fetchMyBlocks', () => {
  it('maps rows to people, naming an unnamed one', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          blocked_id: 'p2',
          display_name: 'Bea',
          created_at: '2026-11-01T00:00:00Z',
        },
        {
          blocked_id: 'p3',
          display_name: '',
          created_at: '2026-11-02T00:00:00Z',
        },
      ],
      error: null,
    } as never);
    expect(await fetchMyBlocks()).toEqual({
      data: [
        { id: 'p2', name: 'Bea', blockedAt: '2026-11-01T00:00:00Z' },
        { id: 'p3', name: 'Unnamed member', blockedAt: '2026-11-02T00:00:00Z' },
      ],
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith('fetch_my_blocks');
  });

  it('returns the generic error when the fetch fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
    expect(await fetchMyBlocks()).toEqual({ error: GENERIC_ERROR });
  });
});
