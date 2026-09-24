import { supabase } from './supabase';

/**
 * The fixed (non-templated) guide keys — every one of `GuideKey` except
 * `host-checklist:${string}`, which is per-club rather than a static string.
 * e2e/session.ts's `setDismissedGuides('all', ...)` imports this rather than
 * hand-duplicating the list, so the two can't drift apart.
 */
export const STATIC_GUIDE_KEYS = [
  'player-intro',
  'tip:event',
  'tip:new-game',
  'tip:check-in',
  'tip:club',
] as const;

/**
 * First-run guidance (docs/superpowers/specs/2026-09-23-first-run-guidance-design.md).
 * Every tip and card is identified by one of these keys; a key present in
 * `profiles.dismissed_guides` means that person has dismissed it.
 */
export type GuideKey =
  | (typeof STATIC_GUIDE_KEYS)[number]
  | `host-checklist:${string}`;

/** Per club: a host of two clubs dismisses each club's checklist separately. */
export function hostChecklistKey(clubId: string): GuideKey {
  return `host-checklist:${clubId}`;
}

/**
 * `null` means "unknown", not "nothing dismissed". Callers must treat unknown
 * as hidden: re-showing a card someone already dismissed is worse than
 * missing a tip.
 */
export async function fetchDismissedGuides(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('dismissed_guides')
      .eq('id', userId)
      .single();
    if (error) {
      console.error('fetchDismissedGuides failed', error);
      return null;
    }
    return ((data as { dismissed_guides: string[] | null }).dismissed_guides ?? []);
  } catch (cause) {
    console.error('fetchDismissedGuides failed', cause);
    return null;
  }
}

/**
 * Writes the whole list rather than appending server-side: two devices
 * dismissing different tips in the same second is the only race, and its
 * worst case is one tip showing once more.
 *
 * `.select('id')` for the same reason as lib/profile.ts's updateProfile —
 * without it a write that matched no rows answers 204 with no error.
 */
export async function saveDismissedGuides(userId: string, keys: string[]): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ dismissed_guides: keys, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id');
    if (error || !data || data.length === 0) {
      console.error('saveDismissedGuides failed', error ?? 'update matched no rows');
      return false;
    }
    return true;
  } catch (cause) {
    console.error('saveDismissedGuides failed', cause);
    return false;
  }
}

export type HostChecklistCounts = {
  events: number;
  members: number;
  pendingInvites: number;
  announcements: number;
};

async function headCount(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count, error } = await build();
  if (error || count === null) {
    console.error('fetchHostChecklistCounts failed', error);
    return null;
  }
  return count;
}

/**
 * Four head-only counts, readable by a host under existing policies:
 * events_select_member (organizers see drafts and invite-only games too),
 * club_members_select_member, club_invites_select_organizer and
 * broadcasts_select_organizer. A broadcasts row exists exactly when an
 * organizer posted with "Also email everyone" on — i.e. an announcement.
 *
 * Any failure resolves null, which hides the checklist: wrong progress is
 * worse than no checklist.
 */
export async function fetchHostChecklistCounts(
  clubId: string,
): Promise<HostChecklistCounts | null> {
  try {
    const opts = { count: 'exact' as const, head: true };
    const [events, members, pendingInvites, announcements] = await Promise.all([
      headCount(() => supabase.from('events').select('id', opts).eq('club_id', clubId)),
      headCount(() =>
        supabase.from('club_members').select('profile_id', opts)
          .eq('club_id', clubId).eq('status', 'active'),
      ),
      // Genuinely pending only — not accepted, not declined, and not yet
      // expired (`expires_at` is `not null default now() + 30 days`, so a
      // plain `.gt` is enough; there is no "no expiry" case to special-case).
      headCount(() =>
        supabase.from('club_invites').select('id', opts)
          .eq('club_id', clubId)
          .is('accepted_at', null)
          .is('declined_at', null)
          .gt('expires_at', new Date().toISOString()),
      ),
      headCount(() => supabase.from('broadcasts').select('id', opts).eq('club_id', clubId)),
    ]);
    if (events === null || members === null || pendingInvites === null || announcements === null) {
      return null;
    }
    return { events, members, pendingInvites, announcements };
  } catch (cause) {
    console.error('fetchHostChecklistCounts failed', cause);
    return null;
  }
}

export type ChecklistStepKey = 'club' | 'game' | 'invite' | 'hello';

export type ChecklistStep = {
  key: ChecklistStepKey;
  label: string;
  done: boolean;
  optional: boolean;
};

/**
 * "Create your club" is always done: the card only exists for a club's host.
 * "Say hello" is optional and never holds the card open.
 */
export function hostChecklist(counts: HostChecklistCounts): {
  steps: ChecklistStep[];
  complete: boolean;
} {
  const steps: ChecklistStep[] = [
    { key: 'club', label: 'Create your club', done: true, optional: false },
    { key: 'game', label: 'Schedule your first game', done: counts.events > 0, optional: false },
    {
      key: 'invite',
      label: 'Invite your players',
      done: counts.members > 1 || counts.pendingInvites > 0,
      optional: false,
    },
    { key: 'hello', label: 'Say hello (optional)', done: counts.announcements > 0, optional: true },
  ];
  return { steps, complete: steps.every((s) => s.optional || s.done) };
}
