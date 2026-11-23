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
