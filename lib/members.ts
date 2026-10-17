import type { ClubMember, ClubRole } from './clubs';
import type { SkillLevel } from './profile';

const BLANK_NAME_LABEL = 'Member';

const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** Trimmed display name, or "Member" when the name is blank. */
export function memberName(m: ClubMember): string {
  const name = m.display_name.trim();
  return name === '' ? BLANK_NAME_LABEL : name;
}

/** Up to two uppercase initials from the first and last words; "?" when blank. */
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Host or co-organizer. */
export function isHostRole(role: ClubRole): boolean {
  return role === 'host' || role === 'co_organizer';
}

/**
 * Hosts and co-organizers first, then everyone else. Within each group,
 * sorted by display name (case and accent insensitive); blank names last in
 * their group; ties broken by profile_id so the order is stable.
 */
export function orderMembers(members: ClubMember[]): ClubMember[] {
  return [...members].sort((a, b) => {
    const rank = Number(!isHostRole(a.role)) - Number(!isHostRole(b.role));
    if (rank !== 0) return rank;

    const aBlank = a.display_name.trim() === '';
    const bBlank = b.display_name.trim() === '';
    if (aBlank !== bBlank) return aBlank ? 1 : -1;

    const byName = memberName(a).localeCompare(memberName(b), undefined, {
      sensitivity: 'base',
    });
    if (byName !== 0) return byName;

    return a.profile_id.localeCompare(b.profile_id);
  });
}

/**
 * Case-insensitive substring match on the trimmed query against the member
 * name. When `hostsOnly` is true, keeps only hosts and co-organizers.
 * Preserves input order.
 */
export function filterMembers(
  members: ClubMember[],
  query: string,
  hostsOnly: boolean,
): ClubMember[] {
  const needle = query.trim().toLowerCase();
  return members.filter((m) => {
    if (hostsOnly && !isHostRole(m.role)) return false;
    if (needle && !memberName(m).toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Display label for a skill level, or null when there is none. */
export function skillLabel(level: SkillLevel | null): string | null {
  return level === null ? null : SKILL_LABELS[level];
}
