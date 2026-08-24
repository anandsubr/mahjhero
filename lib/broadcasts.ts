import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type Broadcast = {
  id: string;
  club_id: string;
  // Null means the whole roster; a uuid means that event's booked members.
  event_id: string | null;
  subject: string;
  body: string;
  recipient_count: number;
  created_at: string;
};

/**
 * Named once so lib/schema-contract.test.ts can assert the database really
 * answers with the shape `Broadcast` claims. Plan 1's Critical 1 — a `time`
 * column arriving as `21:00:00` where the client assumed `21:00` — was
 * invisible to both suites precisely because nothing crossed this boundary.
 */
export const BROADCAST_COLUMNS =
  'id, club_id, event_id, subject, body, recipient_count, created_at';

/**
 * These match the check constraints in 20260826030000 exactly. Drift here
 * means a member types a message the screen accepts and the database
 * rejects with a 23514 they can do nothing about.
 */
export const SUBJECT_MAX = 120;
export const BODY_MAX = 2000;

/**
 * Mirrors Postgres's `[[:cntrl:]]` class, which 20260826030000's `subject`
 * check constraint rejects on top of its length bound. POSIX `cntrl`
 * under `en_US.UTF-8` (the collation this database runs under) is not
 * just 0x00-0x1F and 0x7F — it also carries the C1 control range,
 * U+0080-U+009F, which a JS pattern stopping at `\x7f` misses entirely.
 * Without the wider range here, a subject that picked up a C1 character
 * from a bad Windows-1252 round-trip sailed through this check and hit
 * the database constraint anyway — and because sendBroadcast relays
 * `error.message` verbatim (see its own docstring below), the host saw a
 * raw `violates check constraint "broadcasts_subject_check1"` instead of
 * a refusal this screen could have caught first.
 *
 * The Edge Function drops the subject straight into an SMTP header when
 * it mails the broadcast (render.ts's sanitizeSubject) — a CR or LF here
 * would let a host inject an arbitrary header, an extra `Bcc:` for one.
 * Rejecting here, before the message is ever typed at the database, is
 * the same belt-and-braces posture as that constraint itself.
 */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f-\x9f]/;

export function isValidBroadcast(subject: string, body: string): boolean {
  const s = subject.trim();
  const b = body.trim();
  return (
    s.length > 0 &&
    s.length <= SUBJECT_MAX &&
    // Tested against the trimmed value: sendBroadcast sends s.trim(), and
    // trim() strips \t \n \v \f \r — all inside this pattern's range. A
    // subject with a leading/trailing newline would fail here against the
    // raw value while sailing through to the database unchanged, refusing
    // a host for no reason. A control character in the MIDDLE of the
    // subject survives trimming and still hits this check, which is the
    // header-injection case the database constraint exists for.
    !CONTROL_CHAR_PATTERN.test(s) &&
    b.length > 0 &&
    b.length <= BODY_MAX
  );
}

/**
 * Never rejects — the history screen awaits this directly, and an escaping
 * rejection would leave it spinning with no message. Same contract as
 * fetchProfile in lib/profile.ts.
 */
export async function fetchBroadcasts(clubId: string): Promise<Broadcast[] | null> {
  try {
    const { data, error } = await supabase
      .from('broadcasts')
      .select(BROADCAST_COLUMNS)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('fetchBroadcasts failed', error);
      return null;
    }
    return (data ?? []) as Broadcast[];
  } catch (cause) {
    console.error('fetchBroadcasts failed', cause);
    return null;
  }
}

/**
 * Asked of the database rather than counted from a locally-held roster.
 * The compose screen shows this number in a confirmation before sending,
 * and a count derived from stale client state would make that confirmation
 * a lie. `broadcast_recipient_count` and `send_broadcast` resolve their
 * recipients through the same function, so they cannot disagree.
 *
 * Resolves null on failure rather than 0: "this goes to 0 members" is a
 * statement, and a failed count has nothing to say.
 */
export async function countBroadcastRecipients(
  clubId: string,
  eventId: string | null,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('broadcast_recipient_count', {
      target_club: clubId,
      target_event: eventId,
    });
    if (error) {
      console.error('countBroadcastRecipients failed', error);
      return null;
    }
    return typeof data === 'number' ? data : null;
  } catch (cause) {
    console.error('countBroadcastRecipients failed', cause);
    return null;
  }
}

/**
 * Relays `error.message` from `send_broadcast` verbatim rather than mapping
 * it through a refusal table — deliberate, not an oversight. See
 * lib/bookings.test.ts's BOOKING_REFUSALS allowlist entry for
 * 'event does not belong to this club', which names this module as the one
 * responsible for that message and records this exact contract.
 */
export async function sendBroadcast(
  clubId: string,
  eventId: string | null,
  subject: string,
  body: string,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('send_broadcast', {
      target_club: clubId,
      target_event: eventId,
      p_subject: subject.trim(),
      p_body: body.trim(),
    });
    // The refusal from assert_club_organizer arrives here. Surfaced as
    // words rather than swallowed — a silent failure on a send button
    // reads as success to the person who pressed it.
    if (error) return { id: null, error: error.message };
    return { id: (data as string) ?? null, error: null };
  } catch (cause) {
    console.error('sendBroadcast failed', cause);
    return { id: null, error: GENERIC_ERROR };
  }
}
