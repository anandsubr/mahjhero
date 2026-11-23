import { corsHeaders } from '../_shared/cors.ts';
import { renderShell } from '../_shared/email-shell.ts';
import { renderText, sanitizeSubject } from '../_shared/email-text.ts';
import type { Body } from '../_shared/email-types.ts';
import type { Sender } from '../_shared/sender.ts';

type Row = Record<string, unknown>;
type Result<T> = PromiseLike<{ data: T | null; error: unknown }>;

// Structural subset of the supabase-js client so tests can inject fakes.
export interface NotifyReportDeps {
  /** Client built from the caller's Authorization header (anon key). */
  userClient: {
    auth: {
      getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    };
  };
  /** Service-role client. */
  adminClient: {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): PromiseLike<{ data: Row[] | null; error: unknown }> & {
          maybeSingle(): Result<Row>;
        };
      };
    };
    storage: {
      from(bucket: string): {
        createSignedUrl(path: string, expiresIn: number): Result<{ signedUrl: string }>;
      };
    };
  };
  sender: Sender;
  adminEmail: string;
  appUrl: string;
}

export const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  inappropriate: 'Inappropriate content',
  other: 'Something else',
};

const SEVEN_DAYS = 604800;
const EXCERPT_MAX = 300;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function handleNotifyReport(
  request: Request,
  deps: NotifyReportDeps | (() => NotifyReportDeps),
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!request.headers.get('Authorization')) {
    return json({ error: 'missing Authorization header' }, 401);
  }

  let reportId: string | undefined;
  try {
    const body = (await request.json()) as { report_id?: unknown } | null;
    if (typeof body?.report_id === 'string' && body.report_id) reportId = body.report_id;
  } catch {
    // fall through to 400
  }
  if (!reportId) return json({ error: 'report_id required' }, 400);

  const d = typeof deps === 'function' ? deps() : deps;

  const { data: auth, error: userError } = await d.userClient.auth.getUser();
  const userId = auth?.user?.id;
  if (userError || !userId) return json({ error: 'unauthorized' }, 401);

  const one = async (table: string, cols: string, id: string | null): Promise<Row | null> => {
    if (!id) return null;
    const { data } = await d.adminClient.from(table).select(cols).eq('id', id).maybeSingle();
    return data ?? null;
  };

  const { data: report, error: reportError } = await d.adminClient
    .from('content_reports')
    .select('id, reporter_id, kind, message_id, media_id, reported_profile_id, club_id, reason, details')
    .eq('id', reportId)
    .maybeSingle();
  if (reportError) return json({ error: 'failed to load report' }, 500);
  // Same answer for "missing" and "someone else's", so ids can't be probed.
  if (!report || report.reporter_id !== userId) return json({ error: 'forbidden' }, 403);

  const kind = String(report.kind);
  const message = kind === 'message' ? await one('messages', 'id, author_id, body', str(report.message_id)) : null;
  const media =
    kind === 'club_media'
      ? await one('club_media', 'id, uploaded_by, file_name, storage_path', str(report.media_id))
      : null;

  const reportedId =
    kind === 'message'
      ? str(message?.author_id)
      : kind === 'club_media'
        ? str(media?.uploaded_by)
        : str(report.reported_profile_id);

  const [reporter, reported, club] = await Promise.all([
    one('profiles', 'id, display_name', userId),
    one('profiles', 'id, display_name', reportedId ?? str(report.reported_profile_id)),
    one('clubs', 'id, name', str(report.club_id)),
  ]);

  const reporterName = str(reporter?.display_name) ?? 'A member';
  const reportedName = str(reported?.display_name) ?? 'Unknown person';
  const clubName = str(club?.name);
  const where = clubName ?? 'a direct conversation';
  const reasonLabel = REASON_LABELS[String(report.reason)] ?? String(report.reason);

  let excerpt: string | null = null;
  const links: { label: string; url: string }[] = [];
  const sign = async (bucket: string, path: string, label: string) => {
    try {
      const { data, error } = await d.adminClient.storage.from(bucket).createSignedUrl(path, SEVEN_DAYS);
      if (!error && data?.signedUrl) links.push({ label, url: data.signedUrl });
    } catch {
      // Signed URL failures are skipped silently.
    }
  };

  if (message) {
    const text = String(message.body ?? '');
    excerpt = text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
    const { data: atts } = await d.adminClient
      .from('message_attachments')
      .select('storage_path, sort_order')
      .eq('message_id', String(message.id));
    const sorted = [...(atts ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    for (let i = 0; i < sorted.length; i++) {
      const p = str(sorted[i].storage_path);
      if (p) await sign('message-images', p, `Attachment ${i + 1}`);
    }
  } else if (media) {
    excerpt = `File: ${String(media.file_name ?? '')}`;
    const p = str(media.storage_path);
    if (p) await sign('club-media', p, 'View media');
  }

  const paragraphs = [
    `${reporterName} reported ${reportedName} in ${where}.`,
    `Reason: ${reasonLabel}.`,
  ];
  const details = str(report.details);
  if (details) paragraphs.push(`Details from reporter: ${details}`);
  if (excerpt) paragraphs.push(`Reported content: ${excerpt}`);
  for (const l of links) paragraphs.push(`${l.label} (link expires in 7 days): ${l.url}`);

  const adminUrl = `${d.appUrl}/admin/reports`;
  const body: Body = {
    subject: `Report: ${reasonLabel} in ${where}`,
    headline: 'New content report',
    paragraphs,
    cta: { label: 'Review reports', url: adminUrl },
    footerNote: 'Reports are reviewed within 24 hours.',
  };

  try {
    await d.sender.send({
      to: d.adminEmail,
      subject: sanitizeSubject(body.subject),
      html: renderShell(body, 'MahjHero', adminUrl),
      text: renderText(body, 'MahjHero', adminUrl),
    });
  } catch (cause) {
    console.error('notify-report: email failed', cause);
    return json({ sent: false }, 200);
  } finally {
    await d.sender.close?.();
  }
  return json({ sent: true }, 200);
}
