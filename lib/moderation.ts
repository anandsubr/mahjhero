import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type ReportKind = 'message' | 'club_media' | 'profile';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';

/** The report sheet's reasons, in the order it lists them. */
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Something else' },
];

/** report_content's own cap; the sheet's input stops at it too. */
export const REPORT_DETAILS_MAX = 500;

export const REPORT_THANKS = "Thanks. We'll review this within 24 hours.";

export type BlockedPerson = { id: string; name: string; blockedAt: string };

/**
 * Files a report, then asks `notify-report` to email the admin. The email
 * is fire-and-forget: the report is stored either way, so a failed or slow
 * email never fails (or delays) the answer.
 *
 * Every refusal is shown as GENERIC_ERROR: the raw messages
 * ('you cannot report this', ...) are lowercase server text, and the UI
 * already hides Report where the server would refuse it.
 */
export async function reportContent({
  kind,
  targetId,
  reason,
  details,
}: {
  kind: ReportKind;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
}): Promise<{ data?: string; error: string | null }> {
  try {
    const trimmed = (details ?? '').trim();
    const { data, error } = await supabase.rpc('report_content', {
      p_kind: kind,
      p_target_id: targetId,
      p_reason: reason,
      p_details: trimmed === '' ? null : trimmed.slice(0, REPORT_DETAILS_MAX),
    });
    if (error) {
      console.error('reportContent failed', error);
      return { error: GENERIC_ERROR };
    }
    const reportId = data as string;
    void notifyReport(reportId);
    return { data: reportId, error: null };
  } catch (cause) {
    console.error('reportContent failed', cause);
    return { error: GENERIC_ERROR };
  }
}

async function notifyReport(reportId: string) {
  try {
    const { error } = await supabase.functions.invoke('notify-report', {
      body: { report_id: reportId },
    });
    if (error) console.error('notify-report failed', error);
  } catch (cause) {
    console.error('notify-report failed', cause);
  }
}

async function voidRpc(name: string, args: Record<string, unknown>): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc(name, args);
    if (error) {
      console.error(`${name} failed`, error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error(`${name} failed`, cause);
    return { error: GENERIC_ERROR };
  }
}

export function blockUser(id: string) {
  return voidRpc('block_user', { p_target: id });
}

export function unblockUser(id: string) {
  return voidRpc('unblock_user', { p_target: id });
}

type BlockRow = {
  blocked_id: string;
  display_name: string | null;
  created_at: string;
};

/** The people the caller has blocked, by name. */
export async function fetchMyBlocks(): Promise<{
  data?: BlockedPerson[];
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('fetch_my_blocks');
    if (error) {
      console.error('fetchMyBlocks failed', error);
      return { error: GENERIC_ERROR };
    }
    return {
      data: ((data ?? []) as BlockRow[]).map((r) => ({
        id: r.blocked_id,
        name: r.display_name?.trim() || 'Unnamed member',
        blockedAt: r.created_at,
      })),
      error: null,
    };
  } catch (cause) {
    console.error('fetchMyBlocks failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export const ADMIN_ONLY_ERROR = 'Only admins can see reports.';
export const REPORT_EXCERPT_MAX = 300;

export type AdminReport = {
  id: string;
  kind: ReportKind;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  reporterName: string;
  reportedName: string;
  /** Message body, or the file/photo name; null once the content is gone. */
  excerpt: string | null;
  mediaKind: 'photo' | 'file' | null;
  clubName: string | null;
};

type ReportRow = {
  id: string;
  kind: ReportKind;
  reason: ReportReason;
  details: string | null;
  created_at: string;
  reporter_name: string | null;
  reported_name: string | null;
  message_id: string | null;
  message_body: string | null;
  media_id: string | null;
  media_kind: 'photo' | 'file' | null;
  media_name: string | null;
  club_name: string | null;
};

function clip(text: string): string {
  return text.length > REPORT_EXCERPT_MAX ? `${text.slice(0, REPORT_EXCERPT_MAX).trimEnd()}…` : text;
}

function mapReport(r: ReportRow): AdminReport {
  let excerpt: string | null = null;
  if (r.kind === 'message' && r.message_id) excerpt = clip(r.message_body ?? '');
  else if (r.kind === 'club_media' && r.media_id) excerpt = clip(r.media_name ?? '');
  return {
    id: r.id,
    kind: r.kind,
    reason: r.reason,
    details: r.details,
    createdAt: r.created_at,
    reporterName: r.reporter_name?.trim() || 'Former member',
    reportedName: r.reported_name?.trim() || 'Former member',
    excerpt,
    mediaKind: r.media_kind,
    clubName: r.club_name,
  };
}

/** Open reports, newest first. Admin only: anyone else gets ADMIN_ONLY_ERROR. */
export async function fetchReports(): Promise<{ data?: AdminReport[]; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('fetch_reports', { p_status: 'open' });
    if (error) {
      if (error.code === '42501') return { error: ADMIN_ONLY_ERROR };
      console.error('fetchReports failed', error);
      return { error: GENERIC_ERROR };
    }
    return { data: ((data ?? []) as ReportRow[]).map(mapReport), error: null };
  } catch (cause) {
    console.error('fetchReports failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * Removes the reported content or dismisses the report. The storage paths
 * resolve_report returns are ignored: an admin cannot delete the objects.
 */
export async function resolveReport(
  id: string,
  action: 'remove' | 'dismiss',
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('resolve_report', { p_report: id, p_action: action });
    if (error) {
      if (error.code === '42501') return { error: ADMIN_ONLY_ERROR };
      console.error('resolveReport failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('resolveReport failed', cause);
    return { error: GENERIC_ERROR };
  }
}
