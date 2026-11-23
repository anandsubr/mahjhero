import { useCallback, useEffect, useRef, useState } from 'react';
import ActionSheet from './ActionSheet';
import { blockLabel, useModeration } from './useModeration';
import { fetchMyBlocks, unblockUser } from '../../lib/moderation';

type Person = { id: string; name: string | null };

/** "Unblock Alice Chen", or "Unblock" when the name is missing. */
export function unblockLabel(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `Unblock ${n}` : 'Unblock';
}

/**
 * A person's "…" sheet on a roster row: Report, then Block {name} (confirmed)
 * or Unblock {name} (immediate). Knows who the viewer has blocked, so the
 * row can say which one it offers. `onChanged` runs after a block or
 * unblock, for the screen to refetch.
 */
export function usePersonActions({ onChanged }: { onChanged?: () => void } = {}) {
  const [blockedIds, setBlockedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionsFor, setActionsFor] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const { data } = await fetchMyBlocks();
    if (data && mounted.current) setBlockedIds(new Set(data.map((p) => p.id)));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const moderation = useModeration({
    onBlocked: (id) => {
      setBlockedIds((prev) => new Set(prev).add(id));
      onChangedRef.current?.();
    },
  });

  async function unblock(person: Person) {
    const { error: failed } = await unblockUser(person.id);
    if (!mounted.current) return;
    if (failed) {
      setError(failed);
      return;
    }
    setBlockedIds((prev) => {
      const next = new Set(prev);
      next.delete(person.id);
      return next;
    });
    onChangedRef.current?.();
  }

  const sheets = (
    <>
      {actionsFor ? (
        <ActionSheet
          title={actionsFor.name?.trim() || undefined}
          actions={[
            {
              label: 'Report',
              onPress: () => moderation.startReport('profile', actionsFor.id, `Report ${actionsFor.name?.trim() || 'this person'}`),
            },
            blockedIds.has(actionsFor.id)
              ? { label: unblockLabel(actionsFor.name), onPress: () => void unblock(actionsFor) }
              : {
                  label: blockLabel(actionsFor.name),
                  destructive: true,
                  onPress: () => moderation.startBlock(actionsFor.id, actionsFor.name),
                },
          ]}
          onClose={() => setActionsFor(null)}
        />
      ) : null}
      {moderation.sheets}
      {error ? <ActionSheet title={error} actions={[]} cancelLabel="OK" onClose={() => setError(null)} /> : null}
    </>
  );

  return {
    blockedIds,
    open: (person: Person) => setActionsFor(person),
    sheets,
  };
}
