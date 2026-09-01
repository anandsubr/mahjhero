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

/**
 * An invite that has been sent but not yet redeemed. Distinct from
 * `ClubMember`: nobody is behind it yet, so there is no profile id and the
 * email may be all the club knows about them.
 */
export type ClubInvite = {
  id: string;
  email: string | null;
  display_name: string | null;
  skill_level: SkillLevel | null;
};

export type RosterRow = {
  display_name: string;
  email: string;
  skill_level: SkillLevel | null;
};

export type RosterError = { row: number; message: string };

const CLUB_COLUMNS = 'id, name, slug, rhythm, visibility, timezone';
const INVITE_COLUMNS = 'id, email, display_name, skill_level';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

/**
 * Refused rather than truncated, so a host who pastes the wrong thing is told
 * so instead of quietly importing a prefix of it. The number is a guard
 * against a single unbounded INSERT, not a product limit — a real club roster
 * is tens of people, and a paste in the thousands is a mistake.
 */
export const MAX_ROSTER_ROWS = 500;

/**
 * Client-side precheck only — "does this name have at least one letter or
 * number" — not the URL a club actually lives at. The stored slug is
 * generated server-side in `create_club` with a different punctuation rule
 * (it turns punctuation into '-' rather than stripping it) plus a random
 * suffix, so for "Nana's Tiles!" this returns "nanas-tiles" while the row
 * that gets created has a slug like "nana-s-tiles-<hash>". Harmless for
 * `createClub`'s emptiness check, its only caller, but do not use this to
 * predict or display a club's real URL.
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
 * Only hosts and co-organizers may flip a post's Announcement toggle — the
 * UI-side mirror of `assert_club_organizer`, which `post_message` calls
 * before honouring `p_announce` and refuses with a 42501 otherwise.
 *
 * Computes the same thing `canInvite` does today, on purpose kept as its
 * own export rather than reused: inviting and announcing are different
 * permissions that happen to coincide for every role this app has right
 * now. Collapsing them into one boolean would read fine until the day one
 * of them changes without the other, at which point whichever call site
 * kept sharing the wrong predicate breaks silently.
 */
export function canAnnounce(role: ClubRole): boolean {
  return role === 'host' || role === 'co_organizer';
}

/**
 * Splits one CSV line into cells, honouring quoted fields.
 *
 * `line.split(',')` was wrong for the actual input this screen exists to
 * accept. Google Sheets and Excel quote any field containing a comma, and
 * `"Last, First"` is the single most common way a roster spreadsheet stores a
 * name — so every affected row parsed one cell short, the email landed in the
 * wrong column, and the host was told their file was broken when it was the
 * parser that was. A `""` pair inside a quoted field is an escaped quote.
 *
 * Deliberately not a CSV dependency: this grammar is a dozen lines and fully
 * specified, while a package here is another install to keep working across
 * web, iOS and Android.
 *
 * The one part of RFC 4180 this does not implement is a newline *inside* a
 * quoted field, because `parseRoster` splits on newlines before calling this.
 * A name or email never contains one, and supporting it would mean a
 * character-level parser over the whole document for no case that occurs.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }

  cells.push(cell);
  return cells;
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

  // Before parsing, not after: the point is to never build the array at all.
  if (lines.length - 1 > MAX_ROSTER_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message:
            `That is ${lines.length - 1} rows. Import at most ` +
            `${MAX_ROSTER_ROWS} people at a time.`,
        },
      ],
    };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
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
    const cells = splitCsvLine(lines[i]).map((c) => c.trim());
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

/**
 * Reads the roster through the `club_roster` security definer function rather
 * than selecting `club_members` with an embedded `profiles(...)` join.
 *
 * The join worked because the `profiles` select policy had been widened to
 * "own row OR any co-member's row" — but a policy is per-row and cannot be
 * per-column, so that let a co-member read the *whole* profile: quiet hours,
 * notification channel, timezone. Anyone in your club learned what hours you
 * sleep. Column-level grants cannot fix it either; grants are per-role, and
 * `authenticated` is both the self-reader and the co-member reader.
 *
 * So `profiles` is self-only again, and the four columns a roster actually
 * needs are named in the function's return type — where widening them is a
 * deliberate edit rather than the default for every column anyone adds next.
 */
export async function fetchRoster(clubId: string): Promise<ClubMember[] | null> {
  try {
    const { data, error } = await supabase.rpc('club_roster', {
      target_club: clubId,
    });

    if (error) {
      console.error('fetchRoster failed', error);
      return null;
    }

    return (data ?? []) as ClubMember[];
  } catch (cause) {
    console.error('fetchRoster failed', cause);
    return null;
  }
}

/**
 * Invites that have been sent and not yet redeemed or expired.
 *
 * The club detail screen needs this to tell the truth about who is on the
 * roster. `club_members` rows are only ever written by functions that require
 * `auth.uid()`, so a roster row *always* represents someone who has signed
 * in — meanwhile `importRoster` writes forty rows to `club_invites` that the
 * roster never read, so a host pasting a spreadsheet saw no change at all.
 *
 * `club_invites_select_organizer` limits this to hosts and co-organizers, so
 * a plain member gets an empty list rather than an error — which is the right
 * answer for them: who has been invited but not joined is organizer business.
 */
export async function fetchPendingInvites(
  clubId: string,
): Promise<ClubInvite[] | null> {
  try {
    const { data, error } = await supabase
      .from('club_invites')
      .select(INVITE_COLUMNS)
      .eq('club_id', clubId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at');

    if (error) {
      console.error('fetchPendingInvites failed', error);
      return null;
    }
    return (data ?? []) as ClubInvite[];
  } catch (cause) {
    console.error('fetchPendingInvites failed', cause);
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

/**
 * The token is never chosen client-side: it is a bearer credential — whoever
 * holds it can join the club via `acceptInvite` — so `club_invites.token`
 * defaults to `encode(gen_random_bytes(24), 'hex')` in the database. Sending
 * one from here would mean trusting `Math.random()`, which is not a CSPRNG,
 * for a security token. `.select('token')` reads back what the default
 * actually generated.
 *
 * There is no `userId` argument, for the same reason `createClub` has none:
 * `club_invites.invited_by` now defaults to `auth.uid()` and its insert
 * policy checks `invited_by = auth.uid()`, so attribution is decided by the
 * session rather than by whatever the client claims. Passing it from here was
 * unchecked — a host could have signed a whole imported batch with somebody
 * else's profile id.
 */
export async function createInvite(
  clubId: string,
  target?: { email: string; display_name: string; skill_level: SkillLevel | null },
): Promise<{ token: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('club_invites')
      .insert({
        club_id: clubId,
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
 * Where `app/join/[token].tsx` parks an invite token for a signed-out
 * member, and where `app/index.tsx` looks for one after sign-in completes.
 *
 * Most people opening an invite link have never used MahjHero: they arrive
 * signed out, so the token is stored under this key, they sign in, and
 * `app/index.tsx` sends them back to `/join/<token>` to redeem it. Losing
 * the invite across sign-in would mean asking the host to send another.
 *
 * Lives here (not in `app/join/[token].tsx`) so `app/index.tsx` can import
 * just the string without pulling in the whole route module.
 */
export const PENDING_INVITE_KEY = 'mahjhero.pending-invite';

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

/**
 * Deliberately all-or-nothing, not partial-success-with-a-report.
 *
 * `rows` has already passed through `parseRoster`, so every email is
 * regex-valid and every skill level is one of the three enum values or null;
 * tokens are no longer client-supplied (see `createInvite`), so there is no
 * client-chosen value that could collide or fail a check. That leaves no
 * plausible cause for one row in the batch to fail while its siblings
 * succeed — the remaining failure modes (the caller is not host/co-organizer
 * and the `with check` on `club_invites` rejects the insert, or the
 * connection drops mid-request) both fail the whole statement identically
 * regardless of which row triggered them. So a single `{ created, error }`
 * is the honest shape here: unlike `parseRoster`, there is nothing per-row
 * left to report.
 */
export async function importRoster(
  clubId: string,
  rows: RosterRow[],
): Promise<{ created: number; error: string | null }> {
  // Zero rows is a failure, not a no-op success. Returning
  // `{ created: 0, error: null }` sent the host to `/clubs/<id>?imported=0`
  // — a success redirect for an import that invited nobody.
  if (rows.length === 0) {
    return { created: 0, error: 'There is nobody in that file to invite.' };
  }
  if (rows.length > MAX_ROSTER_ROWS) {
    return {
      created: 0,
      error: `Import at most ${MAX_ROSTER_ROWS} people at a time.`,
    };
  }

  try {
    const invites = rows.map((row) => ({
      club_id: clubId,
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
    // Same reasoning as `.select('id')` in updateProfile: an insert that wrote
    // nothing must not be reported as a success. `rows` is non-empty here, so
    // an empty `data` means the write did not land.
    if (!data || data.length === 0) {
      console.error('importRoster failed', 'insert returned no rows');
      return { created: 0, error: GENERIC_ERROR };
    }
    return { created: data.length, error: null };
  } catch (cause) {
    console.error('importRoster failed', cause);
    return { created: 0, error: GENERIC_ERROR };
  }
}
