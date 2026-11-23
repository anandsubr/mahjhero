import { describe, expect, it } from 'vitest';
import { FakeSender } from '../../_shared/sender';
import { handleNotifyReport, type NotifyReportDeps } from '../handler';

type Tables = Record<string, Record<string, unknown>[]>;

function setup(opts: { tables?: Partial<Tables>; user?: string | null; failSend?: boolean; signFail?: boolean } = {}) {
  const tables: Tables = {
    content_reports: [
      { id: 'r1', reporter_id: 'u1', kind: 'message', message_id: 'm1', media_id: null, reported_profile_id: null, club_id: 'c1', reason: 'harassment', details: 'rude <b>' },
      { id: 'r2', reporter_id: 'u1', kind: 'club_media', message_id: null, media_id: 'md1', reported_profile_id: null, club_id: 'c1', reason: 'spam', details: null },
      { id: 'r3', reporter_id: 'u1', kind: 'profile', message_id: null, media_id: null, reported_profile_id: 'u3', club_id: null, reason: 'other', details: null },
    ],
    messages: [{ id: 'm1', author_id: 'u2', body: 'x'.repeat(400) + '<script>' }],
    club_media: [{ id: 'md1', uploaded_by: 'u2', file_name: 'pic.png', storage_path: 'c1/pic.png' }],
    message_attachments: [
      { message_id: 'm1', storage_path: 'a.png', sort_order: 0 },
      { message_id: 'm1', storage_path: 'b.png', sort_order: 1 },
    ],
    profiles: [
      { id: 'u1', display_name: 'Rita' },
      { id: 'u2', display_name: 'Bob <Evil>' },
      { id: 'u3', display_name: 'Cam' },
    ],
    clubs: [{ id: 'c1', name: 'Dragons' }],
    ...opts.tables,
  };
  const sender = new FakeSender(() => (opts.failSend ? 'smtp down' : null));
  const signed: string[] = [];
  const deps: NotifyReportDeps = {
    userClient: {
      auth: {
        getUser: async () =>
          opts.user === null
            ? { data: { user: null }, error: { message: 'bad' } }
            : { data: { user: { id: opts.user ?? 'u1' } }, error: null },
      },
    },
    adminClient: {
      from: (t: string) => ({
        select: () => ({
          eq: (col: string, val: string) => {
            const rows = (tables[t] ?? []).filter((r) => r[col] === val);
            return Object.assign(Promise.resolve({ data: rows, error: null }), {
              maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            });
          },
        }),
      }),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, ttl: number) => {
            signed.push(`${bucket}:${path}:${ttl}`);
            return opts.signFail
              ? { data: null, error: { message: 'no' } }
              : { data: { signedUrl: `https://s/${bucket}/${path}?t=1` }, error: null };
          },
        }),
      },
    },
    sender,
    adminEmail: 'admin@x.com',
    appUrl: 'https://app.x.com',
  };
  return { deps, sender, signed };
}

const req = (id: string | undefined, auth = true) =>
  new Request('https://x/notify-report', {
    method: 'POST',
    headers: auth ? { Authorization: 'Bearer t' } : {},
    body: JSON.stringify(id ? { report_id: id } : {}),
  });

describe('handleNotifyReport', () => {
  it('401s without Authorization or a valid user', async () => {
    expect((await handleNotifyReport(req('r1', false), setup().deps)).status).toBe(401);
    expect((await handleNotifyReport(req('r1'), setup({ user: null }).deps)).status).toBe(401);
  });

  it('400s without a report_id', async () => {
    expect((await handleNotifyReport(req(undefined), setup().deps)).status).toBe(400);
  });

  it('403s for someone else\'s report and sends nothing', async () => {
    const { deps, sender } = setup({ user: 'u9' });
    expect((await handleNotifyReport(req('r1'), deps)).status).toBe(403);
    expect(sender.sent).toHaveLength(0);
  });

  it('403s for an unknown report', async () => {
    expect((await handleNotifyReport(req('nope'), setup().deps)).status).toBe(403);
  });

  it('emails the admin about a message report, escaped and truncated, with attachment links', async () => {
    const { deps, sender, signed } = setup();
    const res = await handleNotifyReport(req('r1'), deps);
    expect(await res.json()).toEqual({ sent: true });
    const m = sender.sent[0];
    expect(m.to).toBe('admin@x.com');
    expect(m.subject).toBe('Report: Harassment or bullying in Dragons');
    expect(m.text).toContain('Rita reported Bob <Evil> in Dragons');
    expect(m.text).toContain('https://app.x.com/admin/reports');
    expect(m.text).toContain('x'.repeat(300) + '…');
    expect(m.text).not.toContain('x'.repeat(301));
    expect(m.html).toContain('Bob &lt;Evil&gt;');
    expect(m.html).toContain('rude &lt;b&gt;');
    expect(m.html).not.toContain('<b>');
    expect(signed).toEqual(['message-images:a.png:604800', 'message-images:b.png:604800']);
    expect(m.text).toContain('https://s/message-images/a.png?t=1');
  });

  it('includes a signed media link and file name for media reports', async () => {
    const { deps, sender, signed } = setup();
    await handleNotifyReport(req('r2'), deps);
    expect(signed).toEqual(['club-media:c1/pic.png:604800']);
    expect(sender.sent[0].text).toContain('pic.png');
    expect(sender.sent[0].subject).toBe('Report: Spam in Dragons');
  });

  it('skips signed URL failures silently', async () => {
    const { deps, sender } = setup({ signFail: true });
    const res = await handleNotifyReport(req('r2'), deps);
    expect(await res.json()).toEqual({ sent: true });
    expect(sender.sent[0].text).not.toContain('https://s/');
  });

  it('uses a direct-conversation label for clubless profile reports', async () => {
    const { deps, sender } = setup();
    await handleNotifyReport(req('r3'), deps);
    expect(sender.sent[0].subject).toBe('Report: Something else in a direct conversation');
    expect(sender.sent[0].text).toContain('Rita reported Cam');
  });

  it('returns sent:false on SMTP failure', async () => {
    const res = await handleNotifyReport(req('r1'), setup({ failSend: true }).deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false });
  });
});
