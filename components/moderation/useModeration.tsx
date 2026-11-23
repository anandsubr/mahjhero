import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ConfirmSheet } from '../GameForm';
import ActionSheet from './ActionSheet';
import ReportSheet from './ReportSheet';
import { blockUser, type ReportKind } from '../../lib/moderation';

export const BLOCK_BODY =
  "You won't see their messages, posts or photos, and you can't message each other. They won't be told.";

/** "Block Alice Chen", or "Block" when the name is missing. */
export function blockLabel(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `Block ${n}` : 'Block';
}

/**
 * How long the ConfirmSheet takes to slide away on iOS. The sheet is
 * unmounted rather than hidden, so its Modal never reports `onDismiss`;
 * a failure's OK sheet presented before this would be dropped by iOS.
 */
export const CONFIRM_DISMISS_MS = 350;

/**
 * The Report and Block flows any screen can start: a ReportSheet, or a
 * ConfirmSheet that blocks on confirm and then calls `onBlocked` so the
 * screen refetches (the server already hides the person's content).
 * Render `sheets` somewhere in the screen.
 */
export function useModeration({ onBlocked }: { onBlocked?: (personId: string) => void } = {}) {
  const [report, setReport] = useState<{
    kind: ReportKind;
    targetId: string;
    title?: string;
  } | null>(null);
  const [block, setBlock] = useState<{
    id: string;
    name: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );

  async function confirmBlock(target: { id: string; name: string | null }) {
    const confirmedAt = Date.now();
    setBlock(null);
    // A previous failure's sheet must not linger into this attempt.
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(null);
    const { error: failed } = await blockUser(target.id);
    if (failed) {
      // On iOS, wait out whatever is left of the ConfirmSheet's dismissal
      // so the OK sheet is actually presented.
      const wait = Platform.OS === 'ios' ? Math.max(0, CONFIRM_DISMISS_MS - (Date.now() - confirmedAt)) : 0;
      if (wait === 0) setError(failed);
      else errorTimer.current = setTimeout(() => setError(failed), wait);
      return;
    }
    onBlockedRef.current?.(target.id);
  }

  const sheets = (
    <>
      {report ? (
        <ReportSheet
          kind={report.kind}
          targetId={report.targetId}
          title={report.title}
          onClose={() => setReport(null)}
        />
      ) : null}
      {block ? (
        <ConfirmSheet
          title={`${blockLabel(block.name)}?`}
          body={BLOCK_BODY}
          confirmLabel="Block"
          cancelLabel="Cancel"
          onConfirm={() => void confirmBlock(block)}
          onCancel={() => setBlock(null)}
        />
      ) : null}
      {error ? (
        <ActionSheet title={error} actions={[]} cancelLabel="OK" onClose={() => setError(null)} />
      ) : null}
    </>
  );

  return {
    startReport: (kind: ReportKind, targetId: string, title?: string) => setReport({ kind, targetId, title }),
    startBlock: (id: string, name: string | null) => setBlock({ id, name }),
    sheets,
  };
}
