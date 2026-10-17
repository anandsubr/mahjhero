import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptBookingInvite,
  acceptPromotionOffer,
  commitBooking,
  declineBooking,
  declinePromotionOffer,
  fetchMyUpcomingBookings,
  waitlistLabel,
  type BookingOutcome,
  type MyBooking,
} from './bookings';
import {
  acceptClubInvite as acceptClubInviteRpc,
  declineClubInvite as declineClubInviteRpc,
  fetchMyPendingInvites,
  type Club,
  type PendingInvite,
} from './clubs';
import { needAFourthAlerts, pendingGameInvites, type FourthAlert } from './dashboard';
import { fetchUpcomingEvents, type ClubEvent } from './events';

export type NeedsYou = {
  clubInvites: PendingInvite[];
  gameInvites: MyBooking[];
  offers: MyBooking[];
  alerts: FourthAlert[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  dismissNotice: () => void;
  acceptClubInvite: (i: PendingInvite) => void;
  declineClubInvite: (i: PendingInvite) => void;
  acceptGameInvite: (b: MyBooking) => void;
  declineGameInvite: (b: MyBooking) => void;
  acceptOffer: (b: MyBooking) => void;
  declineOffer: (b: MyBooking) => void;
  takeSeat: (a: FourthAlert) => void;
  reload: () => Promise<void>;
};

/**
 * The waitlist half of a `commit_booking` outcome, worded as the event screen
 * words it (`waitlistLabel`) and naming the game it is about. A waitlisted
 * outcome can carry a null `waitlist_position` — "waiting, position unknown",
 * worded "Waiting for a seat".
 *
 * `description` is not optional: the seated notice has always named its game
 * ("You're in — Thu 4 Sep, 7:00 pm — Club Night"), and a waitlist notice
 * that named none, on a screen listing several games, told the member
 * nothing. Requiring the argument stops the two halves drifting apart.
 */
function waitlistNotice(result: BookingOutcome | null, description: string): string | null {
  if (!result || result.outcome !== 'waitlisted') return null;
  const position =
    result.waitlist_position !== null
      ? waitlistLabel(result.waitlist_position)
      : 'Waiting for a seat';
  return `${position} — ${description}`;
}

/**
 * A live, unanswered seat offer. The offer's OWN expiry decides, not the
 * game's start: `my_upcoming_bookings` joins offers on `responded_at is null`
 * alone and `sweep_promotion_offers` only clears lapsed ones every five
 * minutes, while `accept_promotion_offer` re-checks `expires_at` under lock —
 * so a lapsed offer's buttons could only ever produce a refusal.
 */
function isLiveOffer(b: MyBooking): boolean {
  return (
    b.offer_id !== null &&
    b.offer_seats !== null &&
    b.offer_expires_at !== null &&
    new Date(b.offer_expires_at).getTime() > Date.now()
  );
}

/**
 * Everything on Home that asks the member to act: club invites, game
 * invites, waitlist seat offers and need-a-fourth calls. Ported from the old
 * dashboard (app/clubs/index.tsx); check-in, "Can't make it" and leaving a
 * waitlist now live only on Game detail.
 *
 * need-a-fourth still needs each club's events with tables and bookings, so
 * this is the one place on Home that still reads fetchUpcomingEvents per club.
 */
export function useNeedsYou(
  userId: string | undefined,
  clubs: Club[] | null,
  onSeatChanged: () => void,
): NeedsYou {
  const router = useRouter();
  const [clubInvites, setClubInvites] = useState<PendingInvite[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `busy` is read from the render closure, so `if (busy) return` is blind to
  // a tap landing in the same tick as an earlier `setBusy(true)` — a queued
  // tap, a screen-reader activation, a native double-tap. This ref is written
  // synchronously alongside `setBusy`, which is what makes the guard sound;
  // `busy` itself only re-renders the buttons into their disabled look.
  const busyRef = useRef(false);

  // Every write awaits the network and then sets state; navigating away
  // mid-write must not set state on an unmounted component. Set to true on
  // mount rather than relying on the initial value: under StrictMode the
  // effect runs, cleans up and runs again.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only the newest reload may write state: a mount-time read (or one fired
  // by the club set changing) resolving after a post-write reload would
  // otherwise overwrite it with a snapshot from before the write.
  const reloadSeq = useRef(0);

  // A stable primitive summary of `clubs`, not the array itself: the caller
  // hands a fresh array on many renders, and depending on its identity would
  // refetch every render, forever.
  const clubList = clubs ?? [];
  const clubKey = clubList
    .map((c) => c.id)
    .sort()
    .join(',');

  const reload = useCallback(async () => {
    if (!userId) return;
    const seq = ++reloadSeq.current;
    const [invites, mine, perClub] = await Promise.all([
      fetchMyPendingInvites(),
      fetchMyUpcomingBookings(),
      Promise.all(clubList.map((c) => fetchUpcomingEvents(c.id))),
    ]);
    if (!mounted.current || seq !== reloadSeq.current) return;
    // A null read is a failed fetch, not "nothing to do": keep what is on
    // screen rather than hiding every other invite or offer over a blip.
    if (invites !== null) setClubInvites(invites);
    if (mine !== null) setBookings(mine);
    const loaded = perClub.filter((e): e is ClubEvent[] => e !== null);
    // Keep the previous events only when every per-club read failed; a club
    // set that is now empty legitimately clears them.
    if (perClub.length === 0 || loaded.length > 0) setEvents(loaded.flat());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clubKey` is `clubs`'s stable summary; a new array with the same ids reads the same clubs.
  }, [userId, clubKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // One flag for every write, held across the write AND its reload: the
  // reload is the half that writes `bookings`/`events`, so releasing the flag
  // after the write alone let an earlier action's reload land after a later
  // one's and overwrite it with a stale snapshot. The data layer's refusal is
  // shown verbatim, and nothing reloads unless the write succeeded. Any
  // standing notice describes an earlier action, so it is cleared first —
  // `takeSeat` sets its own inside the action, after this clear.
  async function run(action: () => Promise<{ error: string | null }>, seatChange: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: actionError } = await action();
    if (!mounted.current) return;
    if (actionError) {
      busyRef.current = false;
      setBusy(false);
      setError(actionError);
      return;
    }
    await reload();
    if (!mounted.current) return;
    if (seatChange) onSeatChanged();
    busyRef.current = false;
    setBusy(false);
  }

  const alerts = needAFourthAlerts({ events, clubs: clubList, userId: userId ?? '' });

  return {
    clubInvites,
    gameInvites: pendingGameInvites(bookings),
    offers: bookings.filter(isLiveOffer),
    alerts,
    busy,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    acceptClubInvite: (invite) =>
      void run(async () => {
        const { clubId, eventId, error: e } = await acceptClubInviteRpc(invite.id);
        if (e) return { error: e };
        // Accepting changes which club/event the member can see at all, so
        // going there is simpler and more correct than reconciling local
        // state for a club that was not in `clubs` a moment ago.
        router.push(eventId ? `/clubs/${clubId}/events/${eventId}` : `/clubs/${clubId}/games`);
        return { error: null };
      }, false),
    declineClubInvite: (invite) => void run(() => declineClubInviteRpc(invite.id), false),
    acceptGameInvite: (b) => void run(() => acceptBookingInvite(b.booking_id), true),
    declineGameInvite: (b) => void run(() => declineBooking(b.booking_id), true),
    acceptOffer: (b) => {
      if (!b.offer_id) return;
      const offerId = b.offer_id;
      void run(() => acceptPromotionOffer(offerId), true);
    },
    declineOffer: (b) => {
      if (!b.offer_id) return;
      const offerId = b.offer_id;
      void run(() => declinePromotionOffer(offerId), true);
    },
    // `preferredTableId` is the very table the alert counted as one short, so
    // the member lands with the three people they were shown.
    takeSeat: (alert) =>
      void run(async () => {
        const { result, error: e } = await commitBooking({
          eventId: alert.eventId,
          players: [userId ?? ''],
          preferredTableId: alert.tableId,
          allowSplit: false,
        });
        if (e) return { error: e };
        // Told from this attempt's own result: the card advertises ONE seat
        // to every eligible member at once, so `error: null` with
        // `outcome: 'waitlisted'` (someone else got there first) is ordinary
        // and must not be reported as "You're in".
        setNotice(waitlistNotice(result, alert.text) ?? `You're in — ${alert.text}.`);
        return { error: null };
      }, true),
    reload,
  };
}
