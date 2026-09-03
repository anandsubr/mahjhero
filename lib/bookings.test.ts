import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  bookingErrorMessage,
  callForAFourth,
  cancelBooking,
  commitBooking,
  fetchEventSeating,
  needsAFourth,
  offerCountdown,
  seatsRemaining,
  tierWarning,
  waitlistLabel,
} from './bookings';
import { GENERIC_ERROR } from './constants';

beforeEach(() => rpc.mockReset());

describe('tierWarning', () => {
  it('says nothing when the tier and the level agree', () => {
    expect(tierWarning('advanced', 'advanced', 'Table 2')).toBeNull();
  });

  it('says nothing about a mixed table, whoever is booking', () => {
    expect(tierWarning('mixed', 'beginner', 'Table 1')).toBeNull();
  });

  // A null skill level is the common case for a member who has never
  // opened their profile. Warning them about a mismatch they have not
  // declared would be an interruption with nothing behind it.
  it('says nothing when the member has no skill level set', () => {
    expect(tierWarning('advanced', null, 'Table 2')).toBeNull();
  });

  it('names the table and the tier when they disagree', () => {
    expect(tierWarning('advanced', 'beginner', 'Table 2')).toBe(
      'Table 2 is set up for advanced players. Book anyway?',
    );
  });
});

describe('needsAFourth', () => {
  const start = new Date('2026-08-25T23:00:00Z');

  it('is true at one seat short, inside 48 hours', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false two seats short', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 2, start, now)).toBe(false);
  });

  it('is false when the table is full', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 4, start, now)).toBe(false);
  });

  it('is false more than 48 hours out', () => {
    const now = new Date('2026-08-22T22:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });

  // The boundary itself, because "within 48 hours" and "48 hours or more"
  // differ by exactly the case a host looks at two days ahead.
  it('is true exactly 48 hours out', () => {
    const now = new Date('2026-08-23T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false once the game has started', () => {
    const now = new Date('2026-08-25T23:00:01Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });
});

describe('seatsRemaining', () => {
  it('counts the seats a table has left', () => {
    expect(seatsRemaining(4, 3)).toBe(1);
  });

  // Removing a table lowers capacity without ejecting anybody, so a table
  // can hold more than it seats. Never render a negative.
  it('never goes below zero', () => {
    expect(seatsRemaining(2, 3)).toBe(0);
  });
});

describe('waitlistLabel', () => {
  it('reads as an ordinal', () => {
    expect(waitlistLabel(1)).toBe('1st on the waitlist');
    expect(waitlistLabel(2)).toBe('2nd on the waitlist');
    expect(waitlistLabel(3)).toBe('3rd on the waitlist');
    expect(waitlistLabel(4)).toBe('4th on the waitlist');
  });

  // 11th, 12th and 13th are the ones every naive ordinal function gets
  // wrong. A club big enough to reach them is a club we want.
  it('handles the teens', () => {
    expect(waitlistLabel(11)).toBe('11th on the waitlist');
    expect(waitlistLabel(12)).toBe('12th on the waitlist');
    expect(waitlistLabel(13)).toBe('13th on the waitlist');
    expect(waitlistLabel(21)).toBe('21st on the waitlist');
  });
});

describe('offerCountdown', () => {
  const expires = new Date('2026-08-24T16:15:00Z');

  it('reads in whole minutes under an hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T15:45:00Z'))).toBe(
      '30 minutes left',
    );
  });

  it('reads in hours and minutes above one hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T14:30:00Z'))).toBe(
      '1 hour 45 minutes left',
    );
  });

  it('singularises one minute', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:14:10Z'))).toBe(
      '1 minute left',
    );
  });

  it('is explicit once it has run out rather than counting backwards', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:16:00Z'))).toBe(
      'Expired',
    );
  });
});

describe('fetchEventSeating', () => {
  it('returns null rather than an empty list when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    // null and [] mean different things to the screen: "could not load"
    // versus "nobody has booked". Plan 3 shipped a screen that read a
    // failed fetch as "none" and said so out loud.
    expect(await fetchEventSeating('e1')).toBeNull();
  });

  it('returns an empty list when nobody has booked', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchEventSeating('e1')).toEqual([]);
  });
});

describe('commitBooking', () => {
  it('passes the arguments the RPC expects', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'seated' }, error: null });
    await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(rpc).toHaveBeenCalledWith('commit_booking', {
      target_event: 'e1',
      players: ['p1'],
      preferred: 't1',
      allow_split: true,
    });
  });

  it('reports a full game as a full game, not as a connection problem', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'already booked' },
    });
    const { error } = await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(error).toBe('You or someone in your group already has a seat at this game.');
    expect(error).not.toBe(GENERIC_ERROR);
  });
});

describe('bookingErrorMessage', () => {
  it('falls back to the generic message for a refusal it does not know', async () => {
    expect(bookingErrorMessage({ code: '23514', message: 'mystery' })).toBe(
      GENERIC_ERROR,
    );
  });
});

/**
 * Pins the exact client-facing copy for all eight distinct refusals raised
 * by record_attendance/clear_attendance and their shared guard
 * assert_attendance_writable (20260827030000_attendance_mutations.sql).
 *
 * The self-audit below ('BOOKING_REFUSALS (self-audit against the
 * migrations)') only proves each message resolves to SOMETHING other than
 * GENERIC_ERROR — it does not check WHICH sentence. That is exactly how the
 * ordering bug shipped: 'that person is not a member of this club' resolved
 * to a real, mapped sentence ('You are no longer a member of this club.')
 * because it fell through to the pre-existing 'not a member of this club'
 * entry — the self-audit was satisfied and gave no signal that the
 * resolved sentence was wrong. Pinning the exact text here is what would
 * have caught it.
 *
 * Mutation evidence: with the new 'that person is not a member of this
 * club' entry removed from BOOKING_REFUSALS (reverting to the pre-fix
 * ordering), the first assertion below fails, showing the received value
 * 'You are no longer a member of this club.' instead of the expected
 * 'That person is no longer a member of this club.' — see
 * .superpowers/sdd/final-review-fixes-report.md.
 */
describe('attendance refusals (record_attendance/clear_attendance)', () => {
  it('names the walk-in target, not the caller, when they have left the club', () => {
    expect(
      bookingErrorMessage({
        code: '23514',
        message: 'that person is not a member of this club',
      }),
    ).toBe('That person is no longer a member of this club.');
  });

  it('reports a cancelled event via assert_attendance_writable', () => {
    expect(
      bookingErrorMessage({ code: '23514', message: 'event not open for check-in' }),
    ).toBe('This game was cancelled.');
  });

  it('reports check_in_required = false via assert_attendance_writable', () => {
    expect(
      bookingErrorMessage({
        code: '23514',
        message: 'check-in is not enabled for this event',
      }),
    ).toBe('This game does not use check-in.');
  });

  it('reports a member trying to check someone else in', () => {
    expect(
      bookingErrorMessage({ code: '42501', message: 'you can only check yourself in' }),
    ).toBe('Only an organizer can check someone else in.');
  });

  it('reports a write outside the attendance window', () => {
    expect(
      bookingErrorMessage({
        code: '23514',
        message: 'check-in is not open for this event',
      }),
    ).toBe('Check-in is not open for this game right now.');
  });

  it('reports a member self-checking-in without a confirmed seat', () => {
    expect(
      bookingErrorMessage({
        code: '23514',
        message: 'you do not have a seat at this game',
      }),
    ).toBe("You don't have a confirmed seat at this game.");
  });

  it('reports a member trying to clear someone else’s check-in', () => {
    expect(
      bookingErrorMessage({
        code: '42501',
        message: 'you can only clear your own check-in',
      }),
    ).toBe('You can only undo your own check-in.');
  });

  it('reports assert_attendance_writable’s tenancy refusal via the shared "no such event" mapping', () => {
    // assert_attendance_writable folds "no such event" and "an event you
    // cannot see" into the same 'no such event' raise (see the migration's
    // own comment). This module already maps that string for
    // cancel_event/add_event_table; the eighth attendance-related raise
    // site reuses it rather than needing its own entry.
    expect(bookingErrorMessage({ code: '42501', message: 'no such event' })).toBe(
      'This game is no longer listed.',
    );
  });
});

describe('cancelBooking', () => {
  it('reports a started game plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'event already started' },
    });
    expect((await cancelBooking('b1')).error).toBe(
      'This game has already started.',
    );
  });
});

describe('callForAFourth', () => {
  // A member's organizer role can be revoked between render and tap, or the
  // screen can simply be stale — either way, assert_club_organizer refuses,
  // and the member deserves the real sentence, not "check your connection".
  it('reports a non-organizer refusal plainly, not as a connection failure', async () => {
    rpc.mockResolvedValue({
      error: { code: '42501', message: 'not an organizer of this club' },
    });
    const { error } = await callForAFourth('t1');
    expect(error).toBe('Only a club organizer can do that.');
    expect(error).not.toBe(GENERIC_ERROR);
  });
});

/**
 * The self-auditing test for BOOKING_REFUSALS.
 *
 * A hand-maintained refusal vocabulary rots the moment somebody adds a new
 * `raise exception` and forgets the client-side entry — which is exactly how
 * the SQLSTATE-keyed bug this file's other tests now guard against shipped
 * in the first place. This test reads the actual migration SQL rather than
 * trusting a second hand-written list, so a future raise site with no
 * mapping fails loudly here instead of silently reporting GENERIC_ERROR to
 * a member.
 *
 * The glob covers EVERY migration, not just the day-8 ones: the original
 * `20260825*` filter meant a raise site added on any earlier day (most of
 * lib/events.ts's own vocabulary, all of clubs/venues) was never read by
 * this audit at all, so the ALLOWLIST below used to be able to claim
 * "lib/events.ts owns its own vocabulary for these" without that claim ever
 * being checked. It is checked now, which is also why the allowlist grew —
 * every refusal anywhere in the schema now needs a mapping or a true reason
 * this module is not the one responsible for it.
 *
 * Mutation evidence: run with BOOKING_REFUSALS reverted to the pre-fix,
 * code-AND-message-keyed version (single 23514 'no such table' entry, no
 * 'not a member of this club' entry), this test fails and names both
 * strings — see the task-8 report's "Fix pass" section for the transcript.
 */
describe('BOOKING_REFUSALS (self-audit against the migrations)', () => {
  // Every distinct message ANY migration raises that deliberately has no
  // entry in BOOKING_REFUSALS, and the specific reason each one qualifies.
  // Three categories:
  //
  //   1. The plan's own refusal table (docs/superpowers/plans/
  //      2026-08-23-seating-and-booking.md, "Error handling") already
  //      documents these as unreachable from the UI and falls them back to
  //      GENERIC_ERROR on purpose.
  //   2. Raised by a function this module does not call, but that DOES have
  //      its own client-side mapping in the module that does call it —
  //      lib/events.ts's RPC_ERROR_MESSAGES. Each of these exact strings is
  //      individually asserted against a real sentence in lib/events.test.ts,
  //      spread across its "deliberate refusals are reported as refusals,
  //      not as network failures" and "the table/series mutations report
  //      their own refusals" describe blocks — not one single block.
  //   3. Raised by a function lib/clubs.ts or lib/venues.ts calls, or by an
  //      internal trigger/helper no lib/*.ts function calls at all. Neither
  //      is this module's responsibility either way; whether clubs.ts and
  //      venues.ts have completed their OWN vocabularies is a different,
  //      pre-existing gap (they do not, today — every one of their RPC
  //      errors still becomes GENERIC_ERROR) and out of scope for this file,
  //      which only audits bookingErrorMessage.
  const ALLOWLIST: Record<string, string> = {
    // The player picker cannot select the same person twice; this is a
    // server-side belt for a client that already has the suspenders.
    // Plan's refusal table: "Unreachable from the UI... Falls back to the
    // generic message deliberately."
    'duplicate player':
      'deliberate fallback (plan’s refusal table) — the picker cannot select one player twice',
    // The decline control only ever renders on a seat somebody else booked.
    // Plan's refusal table: "Unreachable — the decline control is only
    // rendered on a seat somebody else booked."
    'nothing to decline':
      'deliberate fallback (plan’s refusal table) — decline is never offered on your own booking',
    // announce_table_fourth is revoked from public and anon and never
    // granted to authenticated (20260825050000) — no client path calls
    // it directly. Its own comment states the guard is unreachable because
    // both its callers (announce_need_a_fourth, call_for_a_fourth) derive
    // the stage from need_a_fourth_stage, which only ever returns 'tier' or
    // 'wide'.
    'unrecognized stage: %':
      'only reachable from an internal, non-granted function (announce_table_fourth)',

    // --- Category 2: lib/events.ts's own functions, mapped by its own
    // RPC_ERROR_MESSAGES (lib/events.ts) and pinned by lib/events.test.ts. ---
    "a cancelled event's tables cannot be edited":
      'raised by add_event_table/remove_event_table/update_event_table — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'a cancelled event cannot be edited':
      'raised by update_event/reset_event_to_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'a past occurrence is history and cannot be reset':
      'raised by reset_event_to_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'an event must end after it starts':
      'raised by create_event/update_event — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'an event must have a date and a start time':
      'raised by create_event — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'an event must keep at least one table':
      'raised by remove_event_table — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'duration out of range':
      'raised by create_event/update_event — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'no games before that end date':
      'raised by create_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'no such series':
      'raised by end_event_series/update_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'table count out of range':
      'raised by create_event — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'that start time has already passed':
      'raised by create_event/update_event — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'this event is not part of a series':
      'raised by reset_event_to_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'title is required':
      'raised by create_event/create_event_series/update_event/update_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'too many tables':
      'raised by add_event_table — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'venue not available to this club':
      'raised (via assert_venue_available) by create_event/update_event/update_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'fee cannot be negative':
      'raised by create_event/update_event/create_event_series/update_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    'minimum spend cannot be negative':
      'raised by create_event/update_event/create_event_series/update_event_series — mapped by lib/events.ts’s own RPC_ERROR_MESSAGES, not this module’s',
    // 'not an organizer of this club' (assert_club_organizer) used to be
    // allowlisted here on the claim that lib/events.ts alone mapped it. That
    // was false: call_for_a_fourth (lib/bookings.ts's own callForAFourth)
    // raises it too, and this module never consulted lib/events.ts's
    // vocabulary. It is now a real entry in BOOKING_REFUSALS above, so it is
    // deliberately absent from this allowlist — the self-audit below covers
    // it for real.

    // --- Category 3: lib/clubs.ts's own functions. Neither this module nor
    // lib/clubs.ts maps these today — every clubs.ts RPC error still falls
    // to GENERIC_ERROR there (see lib/clubs.ts). Real gap, not this file's. ---
    'club name is required': 'raised by create_club — lib/clubs.ts’s function, not this module’s',
    'club name needs a letter or number':
      'raised by create_club — lib/clubs.ts’s function, not this module’s',
    'not signed in': 'raised by create_club — lib/clubs.ts’s function, not this module’s',
    // clubs_freeze_identity is an UPDATE trigger on public.clubs, revoked
    // from public/anon/authenticated execute (the grant a trigger fires
    // under is the table owner's, not the caller's, so the revoke does not
    // stop it firing) -- but no lib/*.ts function ever updates a club's
    // created_by/id/slug, so these three are unreached from any client path
    // today, not merely unmapped.
    'club created_by cannot be changed':
      'trigger (clubs_freeze_identity) on public.clubs UPDATE — no lib/*.ts function changes this column',
    'club id cannot be changed':
      'trigger (clubs_freeze_identity) on public.clubs UPDATE — no lib/*.ts function changes this column',
    'club slug cannot be changed':
      'trigger (clubs_freeze_identity) on public.clubs UPDATE — no lib/*.ts function changes this column',
    // clubs_validate_timezone is an INSERT/UPDATE trigger on public.clubs;
    // lib/clubs.ts only ever writes a timezone from a fixed picker of valid
    // IANA names, so this is defence in depth, not a reachable client path.
    'unrecognized timezone: %':
      'trigger (clubs_validate_timezone) on public.clubs — lib/clubs.ts only writes timezones from a fixed valid list',

    // --- Category 3, continued: lib/venues.ts's own functions. Also
    // unmapped there today (see lib/venues.ts). ---
    'venue name is required':
      'raised by create_venue — lib/venues.ts’s function, not this module’s',
    'no such venue':
      'raised by archive_venue/update_venue — lib/venues.ts’s function, not this module’s',

    // Raised by broadcast_recipient_count and send_broadcast
    // (20260826030000_broadcasts.sql) when the event id passed does not
    // belong to the club id passed. Neither function is called from
    // lib/bookings.ts. Task 15 absorbed the broadcast compose/history
    // screens into the message threads: lib/broadcasts.ts's
    // countBroadcastRecipients still calls broadcast_recipient_count, but
    // swallows every error to null rather than relaying `error.message`
    // (deliberately — see its own docstring), and send_broadcast itself
    // has no remaining client caller now that lib/broadcasts.ts's
    // sendBroadcast was removed in favour of lib/messages.ts's
    // postMessage. So this message is raised in the schema but currently
    // unreachable through any live client path — this module is not the
    // one responsible for it either way.
    'event does not belong to this club':
      'raised by broadcast_recipient_count/send_broadcast — lib/broadcasts.ts’s countBroadcastRecipients calls broadcast_recipient_count but swallows the error to null, and send_broadcast has no remaining caller since Task 15 removed sendBroadcast',

    // Raised by add_friend (20260828010000_friend_mutations.sql) when the
    // target is the caller or when they do not share a club. The compose
    // screen only ever offers people who share a club with the caller, and a
    // member cannot tap an "Add" control that points to themselves — so a
    // caller hitting these is malicious or buggy, not a member doing
    // something reasonable. Unlike booking refusals, though, it is not this
    // module's call to make: add_friend is not called from lib/bookings.ts,
    // and the module that DOES call it — lib/friends.ts — is designed to
    // relay `error.message` from add_friend verbatim rather than mapping
    // through a refusal table (see addFriend's docstring, which records this
    // deliberately). So these messages reaching a member are the plan's own
    // intended behaviour, not a gap — same as the broadcasts entry above,
    // this module is not the one responsible for it either way.
    'you cannot add yourself':
      'raised by add_friend — lib/friends.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    'you can only add someone from one of your clubs':
      'raised by add_friend — lib/friends.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',

    // series_occurrence_dates is revoked from public/anon/authenticated
    // (20260822197000, restated 20260823000000) and called only from inside
    // create_event_series/materialize_event_series's own plpgsql bodies —
    // never directly. `frequency` is `event_series.frequency`'s own enum
    // type, so every value the column can hold is one of the branches this
    // function already handles; the `raise` is an exhaustiveness guard
    // against a future enum member, matching 'unrecognized stage: %' above.
    'series_occurrence_dates: unhandled frequency %':
      'only reachable from an internal, non-granted function (series_occurrence_dates); frequency is a Postgres enum so every current value is handled',

    // Raised by open_thread_for_event (20260829020000_open_threads.sql) both
    // when the event does not exist and when the caller has no confirmed or
    // waitlisted seat and is not a club organizer. The two cases are
    // deliberately given the same message and errcode: distinguishing "no
    // such game" from "not your game" would let the event id be used to
    // probe which events exist. Neither function nor module is called from
    // lib/bookings.ts, and the module that DOES call it — lib/messages.ts
    // (Task 5, not yet created) — is designed to relay `error.message` from
    // this RPC verbatim rather than mapping through a refusal table, the
    // same shape as the broadcasts and add_friend entries above.
    'you are not part of this game':
      'raised by open_thread_for_event — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',

    // Raised by create_group_thread (20260829030000_group_threads.sql) when
    // p_members, after dropping the caller and nulls, is empty. The picker
    // that builds p_members never lets a caller submit with nobody chosen,
    // so a caller hitting this is maligned input, not a member doing
    // something reasonable — same shape as 'duplicate player' above. But it
    // is not this module's call to make: create_group_thread is not called
    // from lib/bookings.ts, and lib/messages.ts (Task 5, not yet created) is
    // designed to relay error.message from these RPCs verbatim rather than
    // mapping through a refusal table, the same as every other messages.ts
    // entry in this allowlist.
    'pick somebody to message':
      'raised by create_group_thread — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by create_group_thread and add_to_group_thread when a member
    // being added is neither a friend nor a club-mate of the caller. The
    // picker only ever offers people can_reach already allows, so a caller
    // hitting this is malicious or buggy. lib/messages.ts owns it, per the
    // note above.
    'you can only message people from your clubs or your friends':
      'raised by create_group_thread/add_to_group_thread — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by add_to_group_thread when the target thread is a club or
    // game thread rather than a group. The UI only ever offers "add people"
    // on a group thread screen, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it, per the note above.
    'only a group has people to add':
      'raised by add_to_group_thread — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by add_to_group_thread when the caller is not themselves a
    // member of the target group. The "add people" control only ever
    // renders inside a group thread the caller is already reading, so a
    // caller hitting this is malicious or buggy. lib/messages.ts owns it,
    // per the note above.
    'you are not in this conversation':
      'raised by add_to_group_thread — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',

    // Raised by post_message (20260829040000_post_message.sql) when
    // can_post_thread refuses the caller — a stranger to a club/game thread,
    // or a non-member of a group. The compose screen only ever renders on a
    // conversation already opened through can_read_thread, which is at least
    // as strict, so a caller hitting this is malicious or buggy. lib/messages.ts
    // owns it, per the note above.
    'you cannot post in this conversation':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when the trimmed body is empty. The composer's
    // send control is disabled on an empty/whitespace-only draft, so a
    // caller hitting this is malicious or buggy. lib/messages.ts owns it.
    'write something first':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when the trimmed body exceeds 2000 characters.
    // The composer enforces the same bound client-side, so a caller hitting
    // this is malicious or buggy. lib/messages.ts owns it.
    'that message is too long':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_reply_to points at a message outside the
    // target thread — the composite foreign key on messages already makes
    // this unstateable, so this is a readable-words wrapper around a 23503
    // that no reachable client path can trigger with a genuine reply-to id.
    // lib/messages.ts owns it.
    'you can only reply to a message in this conversation':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_root names a message that is not a root
    // in the target thread — a reply-to-a-reply, or a root from another
    // club. The composite foreign key already makes the cross-thread case
    // unstateable; this is the readable-words wrapper. The board only ever
    // offers Reply on a root, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it and relays it verbatim.
    'you can only reply to a post in this conversation':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_reply_to names a message that lives
    // under a different post than p_root on a club board — including when
    // p_root is null, since the message being posted is itself about to
    // become a new post and so has no "same post" a quote could match. The
    // board only ever offers Reply-with-quote inside the post the reader
    // has open, so a caller hitting this is malicious or buggy.
    // lib/messages.ts owns it.
    'you can only quote a message from the same post':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_root is passed on a game or group
    // thread, neither of which is a board. The composer only passes a root
    // from the club post screen, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it.
    'only a club has posts to reply to':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_announce is true on a reply. The
    // Announcement toggle only renders on the new-post screen, never in a
    // post's reply composer, so a caller hitting this is malicious or
    // buggy. lib/messages.ts owns it.
    'only a new post can be an announcement':
      'raised by post_message — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when p_announce is true on a group thread
    // (club_id is null). The announce control only ever renders on a club
    // thread, so a caller hitting this is malicious or buggy. lib/messages.ts
    // owns it.
    'a group has no roster to announce to':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by post_message when an announcement's derived subject (the
    // body's first line, control characters stripped) is empty after
    // trimming — reachable only when the first line is pure control
    // characters, since the earlier empty-body check already refuses a
    // blank body. lib/messages.ts owns it.
    'an announcement needs a first line to use as its subject':
      'raised by post_message — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by mark_thread_read when can_read_thread refuses the caller.
    // The read-watermark call only ever fires from a thread screen the
    // caller already opened via can_read_thread, so a caller hitting this is
    // malicious or buggy. lib/messages.ts owns it.
    'you cannot read this conversation':
      'raised by mark_thread_read — lib/messages.ts (Task 5, not yet created) is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by fetch_post_messages and mark_post_read when the id names no
    // root — a deleted post, or a reply id. Deliberately the same words for
    // both cases: distinguishing them would let a caller probe for message
    // ids. Reachable only by following a stale link. lib/messages.ts owns it.
    'that post is no longer here':
      'raised by fetch_post_messages and mark_post_read — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
    // Raised by fetch_club_posts when the target thread is not a genuine
    // club board (club_id null, or event_id set) — the read-side mirror of
    // post_message's 'only a club has posts to reply to'. The board screen
    // only ever calls fetch_club_posts with a thread it already knows is a
    // club board, so a caller hitting this is malicious or buggy.
    // lib/messages.ts owns it.
    'only a club has posts to list':
      'raised by fetch_club_posts — lib/messages.ts is the module responsible, and by design relays error.message rather than mapping through a refusal table',
  };

  function distinctRaisedMessages(): string[] {
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../supabase/migrations',
    );
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
    const messages = new Set<string>();
    const raisePattern = /raise exception\s+'((?:[^']|'')*)'/g;
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      for (const match of sql.matchAll(raisePattern)) {
        // '' is SQL's escape for a literal apostrophe inside a quoted
        // string (e.g. "event''s"); normalize it back to one, matching what
        // Postgres actually puts in the error message.
        messages.add(match[1].replace(/''/g, "'"));
      }
    }
    return [...messages];
  }

  it('found at least one raise site (guards against a broken glob or regex)', () => {
    // The whole-schema glob finds ~46 distinct messages today; a much lower
    // floor than that still catches the failure mode this guards against —
    // a glob or regex that silently matches nothing.
    expect(distinctRaisedMessages().length).toBeGreaterThan(30);
  });

  it('maps, or explicitly allowlists, every message the migrations raise', () => {
    const unmapped = distinctRaisedMessages().filter(
      (message) =>
        !(message in ALLOWLIST) &&
        bookingErrorMessage({ code: '00000', message }) === GENERIC_ERROR,
    );
    expect(
      unmapped,
      `BOOKING_REFUSALS has no entry for: ${JSON.stringify(unmapped)}. ` +
        'Add a sentence to BOOKING_REFUSALS in lib/bookings.ts, or add a ' +
        'justified entry to this test’s ALLOWLIST.',
    ).toEqual([]);
  });

  it('never allowlists a message BOOKING_REFUSALS actually maps', () => {
    // Guards the allowlist itself against rot the other way: an entry left
    // behind after somebody adds real coverage for it.
    const stale = Object.keys(ALLOWLIST).filter(
      (message) => bookingErrorMessage({ code: '00000', message }) !== GENERIC_ERROR,
    );
    expect(stale).toEqual([]);
  });
});
