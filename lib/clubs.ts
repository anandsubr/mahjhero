import { GENERIC_ERROR } from './constants';
import type { SkillLevel } from './profile';
import { supabase } from './supabase';

export type ClubRole = 'host' | 'co_organizer' | 'member';
export type ClubVisibility = 'public' | 'private';

export type Club = {
  id: string;
  name: string;
  slug: string;
  rhythm: string;
  visibility: ClubVisibility;
  timezone: string;
};

export type ClubMember = {
  profile_id: string;
  role: ClubRole;
  display_name: string;
  skill_level: SkillLevel | null;
};

export type RosterRow = {
  display_name: string;
  email: string;
  skill_level: SkillLevel | null;
};

export type RosterError = { row: number; message: string };

const CLUB_COLUMNS = 'id, name, slug, rhythm, visibility, timezone';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

/**
 * URL-safe form of a club name. May return '' — callers must handle that.
 *
 * Punctuation like apostrophes is stripped outright rather than turned into a
 * separator ("Nana's Tiles" -> "nanas-tiles", not "nana-s-tiles"); whitespace
 * and existing hyphens are what collapse into a single '-'.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Only hosts and co-organizers may invite. Plain members may not. */
export function canInvite(role: ClubRole): boolean {
  return role === 'host' || role === 'co_organizer';
}

/**
 * Parses a roster CSV into rows plus per-row errors.
 *
 * Returns errors rather than throwing, and never silently drops a row: a host
 * who imports forty members and receives thirty-four has no way to find the
 * missing six. Row numbers are 1-based and count the header, so they match
 * what a spreadsheet shows.
 */
export function parseRoster(csv: string): { rows: RosterRow[]; errors: RosterError[] } {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'The file is empty' }] };
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  const nameIdx = header.indexOf('name');
  const skillIdx = header.indexOf('skill');

  if (emailIdx === -1) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'No email column found in the header row' }],
    };
  }

  const rows: RosterRow[] = [];
  const errors: RosterError[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((c) => c.trim());
    const email = cells[emailIdx] ?? '';

    if (!EMAIL_PATTERN.test(email)) {
      errors.push({ row: i + 1, message: 'Not a valid email address' });
      continue;
    }

    const rawSkill = skillIdx === -1 ? '' : (cells[skillIdx] ?? '').toLowerCase();
    const skill = SKILL_LEVELS.find((s) => s === rawSkill) ?? null;

    rows.push({
      display_name: nameIdx === -1 ? '' : (cells[nameIdx] ?? ''),
      email,
      skill_level: skill,
    });
  }

  return { rows, errors };
}

/**
 * Every function below never rejects. They catch internally, log the original
 * cause for diagnosis, and report failure through `{ error }` — the screens
 * await them directly and an escaping rejection would strand the member with
 * a spinner and no message.
 */

export async function fetchMyClubs(): Promise<Club[] | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select(CLUB_COLUMNS)
      .order('name');

    if (error) {
      console.error('fetchMyClubs failed', error);
      return null;
    }
    return data as Club[];
  } catch (cause) {
    console.error('fetchMyClubs failed', cause);
    return null;
  }
}

export async function fetchClub(clubId: string): Promise<Club | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select(CLUB_COLUMNS)
      .eq('id', clubId)
      .single();

    if (error) {
      console.error('fetchClub failed', error);
      return null;
    }
    return data as Club;
  } catch (cause) {
    console.error('fetchClub failed', cause);
    return null;
  }
}

export async function fetchRoster(clubId: string): Promise<ClubMember[] | null> {
  try {
    const { data, error } = await supabase
      .from('club_members')
      .select('profile_id, role, profiles ( display_name, skill_level )')
      .eq('club_id', clubId)
      .eq('status', 'active');

    if (error) {
      console.error('fetchRoster failed', error);
      return null;
    }

    return (data ?? []).map((row: Record<string, unknown>) => {
      const profile = row.profiles as { display_name: string; skill_level: SkillLevel | null };
      return {
        profile_id: row.profile_id as string,
        role: row.role as ClubRole,
        display_name: profile?.display_name ?? '',
        skill_level: profile?.skill_level ?? null,
      };
    });
  } catch (cause) {
    console.error('fetchRoster failed', cause);
    return null;
  }
}

/**
 * Creates the club and seats the caller as its host.
 *
 * Goes through the `create_club` database function rather than two client
 * writes, because there is deliberately no insert policy on `clubs` or
 * `club_members`. The only workable client-side policy for the membership
 * insert — `with check (auth.uid() = profile_id)` — constrains who the row is
 * about and nothing about which club or what role, so anyone holding a club's
 * uuid could insert themselves into it as host. Letting the function decide
 * both means that is not expressible from a client at all.
 *
 * It also makes the two inserts one transaction, so a club can never exist
 * without a host — which would leave it unreachable by every
 * membership-scoped policy and its unique slug squatted permanently.
 *
 * Note there is no `userId` argument: the function reads `auth.uid()` itself,
 * so a caller cannot create a club on someone else's behalf.
 */
export async function createClub(
  name: string,
  rhythm: string,
): Promise<{ clubId: string | null; error: string | null }> {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { clubId: null, error: 'Give the club a name.' };
  }
  if (slugify(trimmed).length === 0) {
    return { clubId: null, error: 'That name needs at least one letter or number.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_club', {
      club_name: trimmed,
      club_rhythm: rhythm.trim(),
    });

    if (error || !data) {
      console.error('createClub failed', error);
      return { clubId: null, error: GENERIC_ERROR };
    }
    return { clubId: data as string, error: null };
  } catch (cause) {
    console.error('createClub failed', cause);
    return { clubId: null, error: GENERIC_ERROR };
  }
}

export async function createInvite(
  clubId: string,
  userId: string,
  target?: { email: string; display_name: string; skill_level: SkillLevel | null },
): Promise<{ token: string | null; error: string | null }> {
  try {
    const token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    const { data, error } = await supabase
      .from('club_invites')
      .insert({
        club_id: clubId,
        token,
        invited_by: userId,
        email: target?.email ?? null,
        display_name: target?.display_name ?? null,
        skill_level: target?.skill_level ?? null,
      })
      .select('token')
      .single();

    if (error || !data) {
      console.error('createInvite failed', error);
      return { token: null, error: GENERIC_ERROR };
    }
    return { token: data.token as string, error: null };
  } catch (cause) {
    console.error('createInvite failed', cause);
    return { token: null, error: GENERIC_ERROR };
  }
}

/**
 * Redeems an invite token.
 *
 * The RPC is a `security definer` function (Task 3) because the member is by
 * definition not yet in the club, so no membership-scoped policy can let them
 * read the invite or write the membership row.
 */
export async function acceptInvite(
  token: string,
): Promise<{ clubId: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_club_invite', {
      invite_token: token,
    });

    if (error) {
      console.error('acceptInvite failed', error);
      return { clubId: null, error: GENERIC_ERROR };
    }
    if (!data) {
      return {
        clubId: null,
        error: 'That invite link has expired or has already been used.',
      };
    }
    return { clubId: data as string, error: null };
  } catch (cause) {
    console.error('acceptInvite failed', cause);
    return { clubId: null, error: GENERIC_ERROR };
  }
}

export async function importRoster(
  clubId: string,
  userId: string,
  rows: RosterRow[],
): Promise<{ created: number; error: string | null }> {
  try {
    const invites = rows.map((row) => ({
      club_id: clubId,
      token: `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      invited_by: userId,
      email: row.email,
      display_name: row.display_name,
      skill_level: row.skill_level,
    }));

    const { data, error } = await supabase
      .from('club_invites')
      .insert(invites)
      .select('id');

    if (error) {
      console.error('importRoster failed', error);
      return { created: 0, error: GENERIC_ERROR };
    }
    return { created: data?.length ?? 0, error: null };
  } catch (cause) {
    console.error('importRoster failed', cause);
    return { created: 0, error: GENERIC_ERROR };
  }
}
