import { GENERIC_ERROR } from './constants';
import { formatEventWhen } from './events';
import { supabase } from './supabase';

export type ThreadKind = 'club' | 'game' | 'group' | 'direct';

/**
 * One `fetch_my_threads` row.
 *
 * `thread_id` is null for a club thread nobody has opened yet — the row is
 * still listed regardless, because every active membership gets a club
 * thread row whether it has ever been opened or not, and the client calls
 * `openThreadForClub(club_id)` on tap. Every caller navigates that way,
 * existing row or not, so there is one path rather than two.
 */
export type ThreadListRow = {
  thread_id: string | null;
  kind: ThreadKind;
  /**
   * Honestly nullable. `fetch_my_threads`' SQL names an untitled group from
   * `string_agg(...) filter (where p.id <> auth.uid())`, which answers NULL
   * when that filter matches nobody — the caller is the thread's only
   * member, the state `leave_group_thread` leaves behind right before the
   * last-member-out delete. It can also arrive as '' for a direct thread
   * whose only other member never set a display name: `profiles.display_name`
   * is `text not null default ''`, not null, so the SQL's `other_name`
   * comes back empty rather than absent. `rowTitle` below is the fallback
   * for both; a bare `string` type here would have this lying about the one
   * it never got tested against.
   */
  title: string | null;
  club_id: string | null;
  club_name: string | null;
  member_count: number;
  last_body: string | null;
  last_author: string | null;
  last_is_announcement: boolean;
  last_message_at: string | null;
  unread: number;
  event_id: string | null;
  event_starts_at: string | null;
  event_timezone: string | null;
};

export type ThreadMessage = {
  id: string;
  author_id: string;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  profiles: { display_name: string } | null;
  reply_to_id: string | null;
  /**
   * The quoted message, embedded by PostgREST through `reply_to_id`'s
   * foreign key. Null when nothing was quoted — and also null if the parent
   * was ever removed, since the key is `on delete set null`. The bubble
   * renders as an ordinary message in both cases rather than as an empty
   * quote.
   */
  reply_to: { id: string; body: string; profiles: { display_name: string } | null } | null;
};

export type ThreadDetail = {
  id: string;
  club_id: string | null;
  event_id: string | null;
  title: string | null;
  clubs: { name: string; timezone: string } | null;
  events: { title: string; starts_at: string } | null;
  thread_members: { profile_id: string; profiles: { display_name: string } | null }[];
};

/**
 * The exact select lists the client relies on, named once so
 * lib/schema-contract.test.ts can assert the database really answers with
 * the shape the types above claim — the pattern PROFILE_COLUMNS records in
 * lib/profile.ts. A column dropped here without the contract test noticing
 * is exactly the drift that suite exists to catch.
 *
 * This is a plain select rather than an RPC because the thread screen must
 * open a thread `fetch_my_threads` has already dropped from the list — a
 * finished game's thread stays readable from the game screen. RLS still
 * governs: `messages_select` and `message_threads_select` both call
 * `can_read_thread`.
 *
 * Both embeds below carry a `!constraint_name` hint, and neither hint is
 * decorative — verified against a real PostgREST (v14.15, the version this
 * project's local stack runs), not assumed from the migrations:
 *
 *   - `events!message_threads_event_id_fkey`: message_threads carries TWO
 *     foreign keys into events — the plain `event_id references events(id)`
 *     and the composite `(event_id, club_id) references events(id,
 *     club_id)` that makes a thread pointing at another club's event
 *     unstateable (20260829000000's own comment). PostgREST refuses the
 *     embed with PGRST201 ("more than one relationship was found") without
 *     a hint naming which one to use.
 *   - `profiles!thread_members_profile_id_fkey`: thread_members carries two
 *     foreign keys into profiles — `profile_id` (who is in the group) and
 *     `added_by` (who added them). Same PGRST201 without the hint.
 *
 * That `profiles` embed is also self-only RLS (20260822180000): it names
 * the caller and nobody else. fetchThread below patches the co-members'
 * names back in from `thread_roster` (20260829080000), a security definer
 * RPC that re-asks `can_read_thread` itself rather than going through
 * `profiles`' policy — the same shape `club_roster` uses for a club, for
 * the one thread kind `club_roster` cannot serve.
 *
 * `post_reads` (20260830000000) makes `messages`-to-`profiles` an ambiguous
 * embed too (see MESSAGE_COLUMNS below) but does not touch this select:
 * this query selects from `message_threads`, not `messages`, and its own
 * `profiles` embed hangs off `thread_members`, not `messages` — a table
 * `post_reads`'s two foreign keys never mention. No third relationship
 * PostgREST could confuse this embed for.
 */
export const THREAD_COLUMNS =
  'id, club_id, event_id, title, clubs(name, timezone), ' +
  'events!message_threads_event_id_fkey(title, starts_at), ' +
  'thread_members(profile_id, profiles!thread_members_profile_id_fkey(display_name))';

/*
 * Does NOT embed reply_to, and that is a finding, not an oversight.
 *
 * The brief this module was built from specified a named embed —
 * `reply_to:reply_to_id(id, body, profiles(display_name))` — reasoning that
 * `messages` has two foreign-key paths to itself once thread_id and
 * reply_to_id both exist. That reasoning about AMBIGUITY was right, but the
 * conclusion was wrong: `messages` has exactly ONE foreign key into itself,
 * `messages_reply_to_id_thread_id_fkey`, a COMPOSITE key on
 * (reply_to_id, thread_id) — the same key 20260829000000's own docstring
 * argues for at length, because it is what makes a cross-thread quote
 * unstateable. Verified directly against the local stack's PostgREST
 * (v14.15) with curl, every hint form PostgREST documents fails the same
 * way: `reply_to:reply_to_id(...)`, `reply_to:messages!<constraint>(...)`,
 * and the bare column-name hint all answer PGRST200, "Could not find a
 * relationship between 'messages' and 'messages' in the schema cache" — not
 * an ambiguity (PGRST201, which DOES fire for the two THREAD_COLUMNS cases
 * above, proving the schema cache sees those fine). PostgREST's schema-cache
 * introspection does not expose a composite SELF-referential foreign key as
 * an embeddable relationship at all, for any table in this schema, at this
 * version. There is no view, no second single-column FK, and no alternate
 * hint syntax that recovers it — see the task report for the full curl
 * transcript.
 *
 * fetchThreadMessages below does not use this select at all — it calls
 * `fetch_thread_messages` (20260829080000), a security definer RPC that
 * resolves the quoted parent with a plain self-join instead, the same
 * composite-key guarantee this docstring argues for, asked once rather
 * than through a second query. That RPC also sidesteps this select's OTHER
 * gap: the `profiles` embed here is self-only RLS (20260822180000), so on a
 * raw select of this column list a sender who is not the caller comes back
 * with `profiles: null` — the FK hint added below picks WHICH relationship
 * is meant, and does nothing about which rows RLS will hand back. MESSAGE_COLUMNS stays exported and tested
 * directly (lib/schema-contract.test.ts) because both findings are still
 * true of a raw select — the RPC is the fix, not a change to what
 * PostgREST itself can do with this list.
 *
 * The `profiles` embed below carries a `!messages_author_id_fkey` hint, and
 * as with THREAD_COLUMNS' two hints above, it is load-bearing, not
 * decorative. `post_reads` (20260830000000) has two foreign keys —
 * `root_id references messages(id)` and `profile_id references
 * profiles(id)` — under a PRIMARY KEY that is exactly those two columns,
 * `(root_id, profile_id)`. A composite primary key spanning two
 * foreign-key columns is precisely the shape PostgREST reads as a
 * many-to-many JUNCTION TABLE, so it infers a second `messages`-to-
 * `profiles` relationship — through `post_reads` — alongside the direct
 * `messages_author_id_fkey`. A bare `profiles(display_name)` on `messages`
 * is therefore ambiguous the same way `events` and the members' `profiles`
 * are above (PGRST201), even though `post_reads` has nothing to do with
 * who sent a message. The hint says which of the two PostgREST now sees is
 * meant.
 */
export const MESSAGE_COLUMNS =
  'id, author_id, body, subject, is_announcement, created_at, reply_to_id, ' +
  'profiles!messages_author_id_fkey(display_name)';

/** Mirrors messages.body's check constraint exactly. */
export const BODY_MAX = 2000;
/** Mirrors messages.subject's, and broadcasts.subject's before it. */
export const SUBJECT_MAX = 120;

/**
 * Mirrors Postgres's `[[:cntrl:]]` under en_US.UTF-8, which is not merely
 * 0x00-0x1F and 0x7F — it also carries the C1 range, U+0080-U+009F, which a
 * pattern stopping at \x7f misses entirely. lib/broadcasts.ts records the
 * same range and the same reason: a subject that picked up a C1 character
 * from a bad Windows-1252 round-trip would sail through a narrower check
 * and hit the database constraint anyway.
 */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Mirrors Postgres's `trim(x)` with no explicit character list -- which
 * strips only the literal ASCII space, U+0020, from each end. Confirmed
 * live against a local Postgres: `trim(U&'\00A0Doors at seven\00A0')`
 * comes back unchanged, length 16. JS's `.trim()` strips the whole
 * ECMAScript whitespace/line-terminator set instead -- U+00A0, the other
 * Unicode space separators, U+FEFF -- so using it here would let
 * `deriveSubject` silently disagree with what `post_message`'s
 * `subj := trim(subj)` actually stores the moment a pasted first line was
 * bounded by anything other than a plain space: the preview would read
 * "Doors at seven" while the stored, emailed subject still carried an
 * invisible trailing non-breaking space.
 */
const EDGE_SPACE_PATTERN = /^ +| +$/g;

/**
 * The announcement subject, derived rather than typed.
 *
 * An email needs a subject line and the compose artboard has one input, so
 * the body's first line becomes the subject — and the screen shows this
 * value back in the confirmation, so it is disclosed rather than invented
 * silently.
 *
 * This MUST agree with post_message's SQL character for character. Drift
 * means the organizer confirms one subject and the email carries another.
 *
 * Two agreements to keep, not one:
 *
 *   - The INPUT must already be the same string post_message derives from.
 *     post_message computes `body := trim(coalesce(p_body, ''))` FIRST and
 *     only then takes that trimmed body's first line — so a body starting
 *     with a blank line loses the blank line before the split, not after.
 *     This function takes the first line of whatever it is GIVEN, so the
 *     caller must pass the trimmed draft, not the raw one: see the call
 *     site in app/messages/club/new.tsx, which used to pass the untrimmed
 *     draft and show an empty subject for a body that was about to mail a
 *     real one.
 *   - The TRUNCATION must count characters the way Postgres's `length()`/
 *     `left()` do, which is codepoints, not `.length`/`.slice`'s UTF-16
 *     units. An astral character (outside the BMP) is one codepoint but a
 *     surrogate PAIR — two units — so a unit-counting truncation disagrees
 *     with Postgres about where 120 characters ends, and `.slice` can cut
 *     a pair in half outright. `Array.from` (and `for...of`) iterate a
 *     string by codepoint, which is what the split and slice below use
 *     instead.
 *   - The TRIM must strip what Postgres's bare `trim()` strips, not what
 *     JS's `.trim()` strips — see EDGE_SPACE_PATTERN above. `subj := trim(subj)`
 *     in post_message runs on the first line only, after it has already been
 *     split off and its control characters stripped, so this is the one step
 *     where a pasted, Unicode-padded first line (a paste out of Word or a web
 *     page is the plausible source) would otherwise survive to the stored
 *     subject invisibly while the preview quietly trimmed it away.
 */
export function deriveSubject(body: string): string {
  const firstLine = (body ?? '').split('\n')[0] ?? '';
  const cleaned = firstLine.replace(CONTROL_CHAR_PATTERN, '').replace(EDGE_SPACE_PATTERN, '');
  const codepoints = Array.from(cleaned);
  if (codepoints.length > SUBJECT_MAX) {
    return `${codepoints.slice(0, SUBJECT_MAX - 1).join('')}…`;
  }
  return cleaned;
}

/**
 * The announcement bubble's body, with a leading line dropped when it only
 * repeats the subject.
 *
 * `deriveSubject` takes the body's own first line as the subject -- so for a
 * single-line-then-body announcement, the stored subject IS the body's
 * opening line, character for character. Rendering the subject above the
 * bubble AND the untouched body below it says the same thing twice. The fix
 * belongs here, in what the screen prints, not in `deriveSubject`: the
 * subject genuinely is the email's subject line and must keep being derived
 * and stored exactly as it is; this function only decides what the BODY
 * shows once that subject already said its opening line once.
 *
 * The comparison is whitespace-normalized (collapsed internal runs, trimmed
 * ends) rather than exact, the same normalization `quoteStub` and
 * `messagePreview` already use -- `deriveSubject` trims what it stores, so a
 * body whose first line differs from the stored subject only in leading/
 * trailing space is still the same duplicate in substance.
 *
 * A body whose first line genuinely differs from the subject (an organizer
 * who wrote a real subject separate from their opening sentence) is
 * returned untouched -- this function only ever drops a line that repeats
 * the subject, never anything else. A single-line body that IS the subject
 * comes back as `''`, not a lone leftover newline, so the caller can render
 * nothing rather than an empty gap where the body used to be.
 */
export function announcementBody(subject: string | null, body: string): string {
  if (subject == null) return body;
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedSubject = normalize(subject);
  if (!normalizedSubject) return body;
  const lines = body.split('\n');
  if (normalize(lines[0] ?? '') !== normalizedSubject) return body;
  return lines.slice(1).join('\n');
}

/** The artboard's "club - kind" line. */
export function kindLabel(kind: ThreadKind): string {
  if (kind === 'club') return 'Announcement';
  if (kind === 'game') return 'Game';
  if (kind === 'direct') return 'Direct';
  return 'Group';
}

/**
 * The row's muted subtitle line, above the message preview.
 *
 * Game and group/direct read "<club> · <kind>" (or bare "<kind>" with no
 * club -- a group or direct has none). A game thread has no date tile in the
 * flat list (components/DateTile.tsx is 52x70 and does not fit a circular
 * avatar row, and uniform rows are the point of this treatment), so its
 * date moves in here instead: "<club> · <when it starts>", through
 * formatEventWhen -- the one function that renders an event's instant in the
 * CLUB's timezone rather than the device's, so this must not grow a second
 * date formatter.
 *
 * A club row is the exception: `rowTitle` already renders it as "Everyone
 * at <club>", so joining the club's name on here too would say it twice
 * while both lines fight for width at narrow viewports. The kind label
 * alone ("Announcement") is all this line adds.
 */
export function rowSubtitle(row: ThreadListRow): string {
  if (row.kind === 'game' && row.event_starts_at) {
    const when = formatEventWhen(row.event_starts_at, row.event_timezone ?? 'UTC');
    return row.club_name ? `${row.club_name} · ${when}` : when;
  }
  if (row.kind === 'club') return kindLabel(row.kind);
  return row.club_name ? `${row.club_name} · ${kindLabel(row.kind)}` : kindLabel(row.kind);
}

/**
 * The row's one-line preview. Newlines are collapsed here rather than left
 * to `numberOfLines`, which clips at the first break — so a message that
 * begins with one would render an empty preview.
 */
export function messagePreview(row: ThreadListRow): string {
  if (!row.last_body) return 'No messages yet';
  const body = row.last_body.replace(/\s+/g, ' ').trim();
  if (!row.last_author) return body;
  return `${row.last_author}: ${body}`;
}

/**
 * The row's trailing timestamp, in the viewer's own local time -- not the
 * club's. Unlike `formatEventWhen` (which renders a GAME'S instant in the
 * club's timezone, because every member must see the same start time
 * regardless of where they are sitting), an ordinary message's send time is
 * about when the VIEWER read it, so their own device clock is the right
 * frame for it. Deliberately a different rule from `formatEventWhen`, not an
 * oversight of it.
 *
 * Empty for a club thread nobody has posted in yet (`last_message_at` is
 * null), so the row's trailing column shows nothing rather than a
 * misleading date. `now` defaults to the real clock and is only ever
 * overridden by a test.
 */
export function relativeTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';

  if (when.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(when);
  }

  const diffDays = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (diffDays >= 0 && diffDays < 7) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(when);
  }
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(when);
}

/**
 * The gap, in milliseconds, beyond which two consecutive messages in a
 * thread start a new "group" -- iOS Messages' own rough rule of thumb, and
 * roughly what this app follows too. An hour is long enough that the seeded
 * fixture's messages (e2e/session.ts's `seedPopulatedThread`, minutes apart)
 * stay one group with one separator, and short enough that a genuine gap in
 * the conversation -- somebody replying after lunch, or the next morning --
 * still gets its own marker rather than reading as one unbroken exchange.
 */
export const GROUP_GAP_MS = 60 * 60 * 1000;

/**
 * Whether the message at `createdAt` starts a new group -- and so gets a
 * centred separator above it (app/messages/[threadId].tsx) -- relative to
 * the message immediately before it, `previousCreatedAt` (null for the
 * thread's first message, which always starts a group).
 *
 * Pure and exported so the boundary can be reasoned about, and tested,
 * without rendering anything -- the same reason `eventStatusLine`
 * (lib/events.ts) is exported rather than inlined into a screen.
 *
 * Two independent triggers, either one sufficient:
 *   - the calendar day differs (checked with `toDateString`, the viewer's
 *     own local day -- the same frame `relativeTimestamp` above already
 *     reads a message's time in, not the club's), so a two-minute gap that
 *     straddles midnight still gets a marker; and
 *   - the gap is at least `GROUP_GAP_MS`, even on the same calendar day.
 *
 * A timestamp that fails to parse is treated as starting a new group --
 * the safe default, since there is nothing sound to compare it against, and
 * `groupSeparatorLabel` below degrades an unparseable instant to an empty
 * label rather than throwing.
 */
export function startsNewGroup(
  createdAt: string,
  previousCreatedAt: string | null,
): boolean {
  if (!previousCreatedAt) return true;
  const current = new Date(createdAt);
  const previous = new Date(previousCreatedAt);
  if (Number.isNaN(current.getTime()) || Number.isNaN(previous.getTime())) {
    return true;
  }
  if (current.toDateString() !== previous.toDateString()) return true;
  return current.getTime() - previous.getTime() >= GROUP_GAP_MS;
}

/**
 * The centred separator's own label -- the only place a time appears now
 * that the per-bubble timestamp is gone (app/messages/[threadId].tsx). Needs
 * day context `relativeTimestamp` above deliberately does not carry: that
 * formatter is built for the LIST rows, which already sit next to a row
 * whose subtitle and preview supply context, and a bare "10:00 am" is
 * enough there. A separator between groups is the ONLY place time appears on
 * this screen now, so it has to say which day too.
 *
 * Same house style `relativeTimestamp` and `formatEventWhen` (lib/events.ts)
 * already use -- 'en-GB', hour12 lowercase am/pm, short weekday -- so this
 * does not introduce a fourth date voice into an app that already has two
 * establishing one.
 *
 *   - Today / Yesterday, plus the time.
 *   - Within the week (but not yesterday): a bare short weekday, plus the
 *     time -- the same 7-day window `relativeTimestamp` uses for its own
 *     weekday-only bucket.
 *   - Beyond a week: the short weekday, day and month, plus the time --
 *     Intl's own comma between weekday and day/month ("Thu, 27 Aug") only
 *     appears once `year` joins the options below, which is also why the
 *     no-year case reads "Thu 27 Aug" without one.
 *   - A different year than `now`'s: the year joins the date, since "1 Aug"
 *     alone would misdescribe a message from a year-old thread as recent.
 *
 * `now` defaults to the real clock and is only ever overridden by a test --
 * the same contract `relativeTimestamp` already carries.
 */
export function groupSeparatorLabel(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(when);

  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(when)) / 86_400_000);

  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(when);
    return `${weekday} ${time}`;
  }

  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  };
  if (when.getFullYear() !== now.getFullYear()) dateOptions.year = 'numeric';
  const datePart = new Intl.DateTimeFormat('en-GB', dateOptions).format(when);
  return `${datePart}, ${time}`;
}

export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * The count, phrased to be composed onto an EXISTING accessibilityLabel
 * rather than read on its own.
 *
 * components/UnreadBadge.tsx renders a bare `<Text>`, and all three of its
 * parents (TabBar, ClubChips, ThreadRow) set `accessibilityLabel` on the
 * surrounding Pressable — which on react-native-web emits `aria-label` and
 * REPLACES the accessible name computed from children entirely, rather than
 * merging with it. The badge's own count never reached assistive tech at any
 * of the three sites. Composing `label + unreadSuffix(n)` into that one
 * label is the fix; a second, competing label on the badge itself would only
 * repeat how this got confusing in the first place.
 *
 * Empty at zero so a caller never needs a conditional, and capped at 99+
 * with `unreadLabel` so the spoken count never disagrees with the pill's
 * printed one.
 */
export function unreadSuffix(n: number): string {
  return n > 0 ? `, ${unreadLabel(n)} unread` : '';
}

/**
 * The one-line quoted stub above a reply, and in the composer while one is
 * being written. Truncated to 80 characters: the stub is a reminder of what
 * is being answered, not a second copy of it.
 */
export function quoteStub(
  quoted: { body: string; profiles: { display_name: string } | null } | null,
): string | null {
  if (!quoted) return null;
  const body = quoted.body.replace(/\s+/g, ' ').trim();
  const short = body.length > 80 ? `${body.slice(0, 79)}…` : body;
  const who = quoted.profiles?.display_name;
  return who ? `${who}: ${short}` : short;
}

/** One row of `fetch_club_posts` — a root post as the board renders it. */
export type ClubPost = {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  reply_count: number;
  last_reply_at: string | null;
  /** `greatest(created_at, last_reply_at)` — what the board sorts on. */
  last_activity_at: string;
  unread: number;
};

/** How long a post's title may run before the row wraps to three lines. */
export const POST_TITLE_MAX = 80;

/**
 * A post's display line.
 *
 * There is no title column, deliberately: an announcement already carries a
 * `subject` (derived by the same rule `post_message` uses), and a member
 * post shows its own first line. A separate title field for member posts is
 * one people leave blank, and a board of empty titles reads worse than a
 * board of first lines.
 */
export function postTitle(post: ClubPost): string {
  const raw = (post.subject ?? post.body.split('\n')[0] ?? '').trim();
  if (raw.length === 0) return 'Untitled post';
  if (raw.length <= POST_TITLE_MAX) return raw;
  return `${raw.slice(0, POST_TITLE_MAX - 1)}…`;
}

/**
 * The reply count as words. Composed into the row's accessibilityLabel
 * rather than sitting beside it, because accessibilityLabel on a Pressable
 * REPLACES the name computed from its children in react-native-web.
 */
export function replyCountLabel(n: number): string {
  if (n <= 0) return 'No replies';
  return n === 1 ? '1 reply' : `${n} replies`;
}

/** The Recent sort. Empty club threads have no `last_message_at` and sink. */
export function sortThreads(rows: ThreadListRow[]): ThreadListRow[] {
  return [...rows].sort((a, b) => {
    if (a.last_message_at === b.last_message_at) return 0;
    if (a.last_message_at === null) return 1;
    if (b.last_message_at === null) return -1;
    return a.last_message_at < b.last_message_at ? 1 : -1;
  });
}

/**
 * The messages screen's one and only order, replacing the old "Recent | By
 * club" choice. Club threads first -- there is exactly one per club the
 * member belongs to, and `fetch_my_threads` always lists it, empty or not --
 * then everything else (game, group and direct) interleaved, newest first.
 *
 * Sorting the whole list by recency FIRST and then partitioning by kind
 * (rather than filtering first and sorting each half separately) keeps the
 * partition stable: a club band still reads newest-active-club-first among
 * itself, for free, from the one sort. Pinning clubs at the top is what
 * makes a separate sort control redundant -- it already does the grouping
 * "By club" did and the recency "Recent" did, in the one list.
 */
export function orderThreadsForList(rows: ThreadListRow[]): ThreadListRow[] {
  const sorted = sortThreads(rows);
  const clubs = sorted.filter((r) => r.kind === 'club');
  const rest = sorted.filter((r) => r.kind !== 'club');
  return [...clubs, ...rest];
}

/**
 * The thread screen's header title.
 *
 * Computed here rather than read from `ThreadListRow.title` because the
 * thread screen must open a thread the list has already dropped — a
 * finished game's, reached from the game screen.
 */
export function threadTitleFor(thread: ThreadDetail, viewerId: string): string {
  if (thread.event_id) return thread.events?.title ?? 'Game';
  // The owner's call, made knowingly: the artboard renders
  // `'Everyone at ' + club.short` from a SHORT name its fixture carries
  // (`short: 'Riverside'`) that this app's `clubs` table has no column for.
  // Substituting the full name produced "Everyone at Riverside Mah Jongg" --
  // which wraps to two lines in this header and truncates in the list. A
  // club thread's title is just the club's own name instead, computed here
  // AND in fetch_my_threads' SQL (supabase/migrations/
  // 20260829090000_club_thread_title.sql) -- the same value from both
  // places is what keeps the list and this header from drifting apart.
  if (thread.club_id) return thread.clubs?.name ?? '';

  if (thread.title && thread.title.trim()) return thread.title.trim();
  const others = thread.thread_members.filter((m) => m.profile_id !== viewerId);
  if (others.length === 1) {
    // `??` alone does not catch this: `profiles.display_name` is `text not
    // null default ''`, so a counterpart who never set a name comes back as
    // '', not null, and `?? 'Direct'` would pass '' straight through.
    const name = others[0].profiles?.display_name?.trim();
    return name ? name : 'Direct';
  }
  const names = others
    .map((m) => (m.profiles?.display_name ?? '').split(' ')[0])
    .filter(Boolean)
    .join(', ');
  // Same hole, plural: every other member nameless empties the join, and a
  // blank header is worse than a generic one.
  return names || 'Group';
}

/**
 * The `ThreadKind` for a loaded `ThreadDetail` -- the same club_id/event_id/
 * other-member-count branches `threadTitleFor` just above already reads to
 * pick a title, exported here so the thread screen's header (app/messages/
 * [threadId].tsx, via components/ThreadAvatar.tsx) can pick the same kind
 * `ThreadRow.tsx`'s list row would have shown for this thread, rather than a
 * second copy of this branching at the call site.
 */
export function threadKindFor(thread: ThreadDetail, viewerId: string): ThreadKind {
  if (thread.event_id) return 'game';
  if (thread.club_id) return 'club';
  const others = thread.thread_members.filter((m) => m.profile_id !== viewerId);
  return others.length === 1 ? 'direct' : 'group';
}

/**
 * `row.title`'s fallback, for the one place it is rendered
 * (components/ThreadRow.tsx). See the field's own docstring in
 * `ThreadListRow` for the two ways it arrives blank -- NULL from
 * `fetch_my_threads`' SQL, or '' from a nameless direct counterpart. Falls
 * back to the row's kind label, the same word `kindLabel` already uses for
 * this row's kicker line, rather than inventing a second placeholder.
 */
export function rowTitle(row: ThreadListRow): string {
  const trimmed = row.title?.trim();
  return trimmed ? trimmed : kindLabel(row.kind);
}

// ---------------------------------------------------------------------
// Reads. All resolve null on failure rather than rejecting — the screens
// await these directly, and an escaping rejection would leave them
// spinning with no message. Same contract as fetchProfile in lib/profile.ts.
// ---------------------------------------------------------------------

export async function fetchMyThreads(): Promise<ThreadListRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_my_threads');
    if (error) {
      console.error('fetchMyThreads failed', error);
      return null;
    }
    return (data ?? []) as ThreadListRow[];
  } catch (cause) {
    console.error('fetchMyThreads failed', cause);
    return null;
  }
}

export async function fetchUnreadCounts(): Promise<
  { club_id: string | null; unread: number }[] | null
> {
  try {
    const { data, error } = await supabase.rpc('my_unread_counts');
    if (error) {
      console.error('fetchUnreadCounts failed', error);
      return null;
    }
    return (data ?? []) as { club_id: string | null; unread: number }[];
  } catch (cause) {
    console.error('fetchUnreadCounts failed', cause);
    return null;
  }
}

/** One row of `thread_roster`, keyed for the merge below. */
type RosterRow = { profile_id: string; display_name: string };

export async function fetchThread(threadId: string): Promise<ThreadDetail | null> {
  try {
    const { data, error } = await supabase
      .from('message_threads')
      .select(THREAD_COLUMNS)
      .eq('id', threadId)
      .single();
    if (error) {
      console.error('fetchThread failed', error);
      return null;
    }
    const thread = data as unknown as ThreadDetail;

    // thread_members' own profiles embed is a plain select, so it inherits
    // profiles' self-only RLS (20260822180000) and names only the caller.
    // thread_roster is security definer and re-asks can_read_thread itself,
    // the same shape club_roster uses for a club — the only path from one
    // member's name to another's in a thread that has no club to hand
    // club_roster instead. Empty for a club or game thread, whose
    // thread_members is already empty, so the merge below is a no-op there.
    const { data: roster, error: rosterError } = await supabase.rpc('thread_roster', {
      target_thread: threadId,
    });
    if (rosterError) {
      console.error('fetchThread failed', rosterError);
      return null;
    }
    const names = new Map(
      ((roster ?? []) as RosterRow[]).map((r) => [r.profile_id, r.display_name]),
    );

    return {
      ...thread,
      thread_members: thread.thread_members.map((m) => {
        const name = names.get(m.profile_id);
        return name ? { profile_id: m.profile_id, profiles: { display_name: name } } : m;
      }),
    };
  } catch (cause) {
    console.error('fetchThread failed', cause);
    return null;
  }
}

/** One row of `fetch_thread_messages`. */
type ThreadMessageRow = {
  id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  subject: string | null;
  is_announcement: boolean;
  created_at: string;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_author: string | null;
};

/**
 * Maps one `fetch_thread_messages` / `fetch_post_messages` row into a
 * `ThreadMessage` — shared by both, because the RPCs return the same ten
 * columns on purpose, so MessageBubble never learns a second row shape. One
 * copy of the mapping is what keeps that true; two copies is exactly the
 * drift a future edit to one and not the other would produce silently.
 */
function mapThreadMessageRow(r: ThreadMessageRow): ThreadMessage {
  return {
    id: r.id,
    author_id: r.author_id,
    body: r.body,
    subject: r.subject,
    is_announcement: r.is_announcement,
    created_at: r.created_at,
    profiles: r.author_name ? { display_name: r.author_name } : null,
    reply_to_id: r.reply_to_id,
    reply_to: r.reply_to_id
      ? {
          id: r.reply_to_id,
          body: r.reply_to_body ?? '',
          profiles: r.reply_to_author ? { display_name: r.reply_to_author } : null,
        }
      : null,
  };
}

export async function fetchThreadMessages(
  threadId: string,
): Promise<ThreadMessage[] | null> {
  try {
    // Sender names and the quoted parent, resolved in one call.
    // fetch_thread_messages is security definer for the same reason
    // thread_roster is: profiles' self-only RLS would otherwise null out
    // every sender but the caller. It also removes what used to be a
    // second query for the quoted parent — MESSAGE_COLUMNS' own docstring
    // records why PostgREST cannot embed reply_to at all (a composite
    // self-reference, not an RLS problem), and the RPC resolves it with a
    // plain self-join instead.
    const { data, error } = await supabase.rpc('fetch_thread_messages', {
      target_thread: threadId,
    });
    if (error) {
      console.error('fetchThreadMessages failed', error);
      return null;
    }
    const rows = (data ?? []) as ThreadMessageRow[];
    return rows.map(mapThreadMessageRow);
  } catch (cause) {
    console.error('fetchThreadMessages failed', cause);
    return null;
  }
}

/**
 * `fetch_club_posts` returns exactly `ClubPost`'s columns, no flattened or
 * nested fields to reshape — unlike `ThreadMessageRow` above, a distinct row
 * type here would duplicate `ClubPost` field for field and buy nothing. The
 * cast below trusts the RPC's compile-time shape; the explicit mapping is
 * what actually guards the client's rows — a column `fetch_club_posts` grows
 * later that `ClubPost` does not declare cannot leak into a `ClubPost` this
 * way, where a bare `{ ...r }` spread would have let it through.
 */
export async function fetchClubPosts(
  threadId: string,
  before: string | null = null,
): Promise<ClubPost[] | null> {
  try {
    // security definer for the same reason fetch_thread_messages is:
    // profiles' self-only RLS would otherwise null out every author name
    // but the caller's own.
    const { data, error } = await supabase.rpc('fetch_club_posts', {
      target_thread: threadId,
      p_before: before,
    });
    if (error) {
      console.error('fetchClubPosts failed', error);
      return null;
    }
    const rows = (data ?? []) as ClubPost[];
    return rows.map((r) => ({
      id: r.id,
      author_id: r.author_id,
      author_name: r.author_name,
      body: r.body,
      subject: r.subject,
      is_announcement: r.is_announcement,
      created_at: r.created_at,
      reply_count: r.reply_count,
      last_reply_at: r.last_reply_at,
      last_activity_at: r.last_activity_at,
      unread: r.unread,
    }));
  } catch (cause) {
    console.error('fetchClubPosts failed', cause);
    return null;
  }
}

/** One post's root and replies, mapped the same way fetchThreadMessages is. */
export async function fetchPostMessages(
  rootId: string,
): Promise<ThreadMessage[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_post_messages', {
      p_root: rootId,
    });
    if (error) {
      console.error('fetchPostMessages failed', error);
      return null;
    }
    const rows = (data ?? []) as ThreadMessageRow[];
    return rows.map(mapThreadMessageRow);
  } catch (cause) {
    console.error('fetchPostMessages failed', cause);
    return null;
  }
}

// ---------------------------------------------------------------------
// Writes. Refusals from the RPCs are relayed verbatim rather than mapped
// through a refusal table — they are already written to be read by a
// member. Same deliberate contract lib/friends.ts records for addFriend.
// ---------------------------------------------------------------------

async function idRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { id: null, error: error.message };
    return { id: (data as string) ?? null, error: null };
  } catch (cause) {
    console.error(`${name} failed`, cause);
    return { id: null, error: GENERIC_ERROR };
  }
}

async function voidRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc(name, args);
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error(`${name} failed`, cause);
    return { error: GENERIC_ERROR };
  }
}

export function openThreadForClub(clubId: string) {
  return idRpc('open_thread_for_club', { target_club: clubId });
}

export function openThreadForEvent(eventId: string) {
  return idRpc('open_thread_for_event', { target_event: eventId });
}

export function createGroupThread(title: string, memberIds: string[]) {
  if (memberIds.length === 0) {
    return Promise.resolve({ id: null, error: 'Pick somebody to message.' });
  }
  // An empty title is sent as NULL, not '': fetch_my_threads names an
  // untitled group from its members at read time, and '' would defeat that.
  return idRpc('create_group_thread', {
    p_title: title.trim() || null,
    p_members: memberIds,
  });
}

export function addToGroupThread(threadId: string, memberIds: string[]) {
  return voidRpc('add_to_group_thread', {
    target_thread: threadId,
    p_members: memberIds,
  });
}

export function leaveGroupThread(threadId: string) {
  return voidRpc('leave_group_thread', { target_thread: threadId });
}

export async function postMessage(
  threadId: string,
  body: string,
  announce = false,
  replyToId: string | null = null,
  // Null in a game or direct thread, and null for a NEW post on a club
  // board. Set only when replying inside a post.
  rootId: string | null = null,
): Promise<{ id: string | null; error: string | null }> {
  const trimmed = (body ?? '').trim();
  // Checked here as well as in post_message so a member who taps Send on an
  // empty composer gets an answer without a round trip.
  if (trimmed.length === 0) {
    return { id: null, error: 'Write something first.' };
  }
  if (trimmed.length > BODY_MAX) {
    return { id: null, error: 'That message is too long.' };
  }
  return idRpc('post_message', {
    target_thread: threadId,
    p_body: trimmed,
    p_announce: announce,
    p_reply_to: replyToId,
    p_root: rootId,
  });
}

export function markThreadRead(threadId: string) {
  return voidRpc('mark_thread_read', { target_thread: threadId });
}

export function markPostRead(rootId: string) {
  return voidRpc('mark_post_read', { p_root: rootId });
}
