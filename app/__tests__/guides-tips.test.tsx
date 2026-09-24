import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// This file's mocks combine app/__tests__/events-detail.test.tsx's (for
// EventScreen) and app/__tests__/events-new.test.tsx's (for NewEventScreen)
// preambles into one shared setup, since both screens' tips are exercised
// here rather than in their own files. Each `expo-router`/`../../lib/*`
// specifier is mocked exactly once, with every function either source file
// mocks folded into that one factory, so both screens can render off the
// same module graph. Task 7 extends this same file with the check-in and
// club-page tips — new describes and mocks should slot in alongside these
// rather than duplicating the preamble again.

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn();

// Shared by both screens: EventScreen reads `id`/`eventId`, NewEventScreen
// reads only `id`. Extra keys present and unused are harmless.
const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

const pathname = '/clubs/club-1/events/event-1';

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace, back, canGoBack }),
  usePathname: () => pathname,
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render -- see events-detail.test.tsx's identical
  // comment: `(cb) => cb()` would refire `useUnreadCounts`'s fetch (pulled
  // in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const isVisible = vi.fn((_key: string) => true);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

// events-detail.test.tsx's own lib/clubs mock: fetchClub/fetchRoster for
// EventScreen, plus the event-scoped guest invite pair.
const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const createInvite = vi.fn();
const sendClubInviteEmail = vi.fn();
// events-new.test.tsx's own lib/clubs mock: fetchMyRoles, for NewEventScreen.
const fetchMyRoles = vi.fn();
// clubs.test.tsx's own club-detail-screen lib/clubs mock: the invite list,
// for ClubDetailScreen.
const fetchPendingInvites = vi.fn();
const deleteInvite = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    createInvite: (...args: unknown[]) => createInvite(...args),
    sendClubInviteEmail: (...args: unknown[]) => sendClubInviteEmail(...args),
    fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
    deleteInvite: (...args: unknown[]) => deleteInvite(...args),
  };
});

const fetchEvent = vi.fn();
const fetchEventTables = vi.fn();
const fetchSeries = vi.fn();
const cancelEvent = vi.fn();
const addEventTable = vi.fn();
const removeEventTable = vi.fn();
const resetEventToSeries = vi.fn();
const createEvent = vi.fn();
const createEventSeries = vi.fn();

vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
    fetchEventTables: (...args: unknown[]) => fetchEventTables(...args),
    fetchSeries: (...args: unknown[]) => fetchSeries(...args),
    cancelEvent: (...args: unknown[]) => cancelEvent(...args),
    addEventTable: (...args: unknown[]) => addEventTable(...args),
    removeEventTable: (...args: unknown[]) => removeEventTable(...args),
    resetEventToSeries: (...args: unknown[]) => resetEventToSeries(...args),
    createEvent: (...args: unknown[]) => createEvent(...args),
    createEventSeries: (...args: unknown[]) => createEventSeries(...args),
  };
});

const fetchEventSeating = vi.fn();
const fetchOpenOffer = vi.fn();
const placeBooking = vi.fn();
const cancelBooking = vi.fn();
const callForAFourth = vi.fn();
const fetchEventAcceptedCount = vi.fn();
const commitBooking = vi.fn();

vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchEventSeating: (...args: unknown[]) => fetchEventSeating(...args),
    fetchOpenOffer: (...args: unknown[]) => fetchOpenOffer(...args),
    placeBooking: (...args: unknown[]) => placeBooking(...args),
    cancelBooking: (...args: unknown[]) => cancelBooking(...args),
    callForAFourth: (...args: unknown[]) => callForAFourth(...args),
    fetchEventAcceptedCount: (...args: unknown[]) => fetchEventAcceptedCount(...args),
    commitBooking: (...args: unknown[]) => commitBooking(...args),
  };
});

const fetchMyCheckIn = vi.fn();
const recordAttendance = vi.fn();
const clearAttendance = vi.fn();
// check-in.test.tsx's own lib/attendance mock: the door list's own read, for
// CheckInScreen.
const fetchEventAttendance = vi.fn();

vi.mock('../../lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance')>();
  return {
    ...actual,
    fetchMyCheckIn: (...args: unknown[]) => fetchMyCheckIn(...args),
    recordAttendance: (...args: unknown[]) => recordAttendance(...args),
    clearAttendance: (...args: unknown[]) => clearAttendance(...args),
    fetchEventAttendance: (...args: unknown[]) => fetchEventAttendance(...args),
  };
});

// check-in.test.tsx's own lib/payments mock, for CheckInScreen's paid chip.
const fetchEventPayments = vi.fn();
const setPaymentStatus = vi.fn();

vi.mock('../../lib/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payments')>();
  return {
    ...actual,
    fetchEventPayments: (...args: unknown[]) => fetchEventPayments(...args),
    setPaymentStatus: (...args: unknown[]) => setPaymentStatus(...args),
  };
});

const fetchTableRounds = vi.fn();
const recordRound = vi.fn();
const deleteRound = vi.fn();

vi.mock('../../lib/rounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/rounds')>();
  return {
    ...actual,
    fetchTableRounds: (...args: unknown[]) => fetchTableRounds(...args),
    recordRound: (...args: unknown[]) => recordRound(...args),
    deleteRound: (...args: unknown[]) => deleteRound(...args),
  };
});

const fetchUnreadCounts = vi.fn(async () => []);
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

// events-new.test.tsx's own VenuePicker stub -- irrelevant to these tests,
// but NewEventScreen renders it unconditionally.
vi.mock('../../components/VenuePicker', () => ({
  default: ({ onChange }: { onChange: (id: string, name: string) => void }) => (
    <button onClick={() => onChange('venue-1', 'The Annexe')}>Pick venue (test stub)</button>
  ),
}));

import EventScreen from '../clubs/[id]/events/[eventId]/index';
import NewEventScreen from '../clubs/[id]/events/new';
import CheckInScreen from '../clubs/[id]/events/[eventId]/check-in';
import ClubDetailScreen from '../clubs/[id]/index';

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

const EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null as string | null,
  title: 'Thursday Mahjong',
  venue_id: 'venue-1',
  venue_name: 'The Annexe',
  notes: '',
  // Relative to Date.now(), matching events-detail.test.tsx's own fixture --
  // keeps `canBook` true and `gameLive` false no matter when this suite runs.
  starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  ends_at: new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString(),
  status: 'published' as const,
  occurrence_date: null as string | null,
  overrides: [] as string[],
  table_count: 1,
  check_in_required: false,
  game_mode: 'open_play' as const,
};

const TABLE_1 = {
  id: 'table-1',
  label: 'Table 1',
  skill_tier: 'mixed' as const,
  capacity: 4,
  position: 1,
};

const MEMBER_ROLE = [
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
];
const HOST_ROLE = [
  { profile_id: 'test-user', role: 'host' as const, display_name: 'Ada', skill_level: null },
];

// check-in.test.tsx's own EVENT fixture: a window that is open right now
// (starts_at an hour ago, inside the 1-hour early-arrival lead; ends_at two
// hours from now), real-clock based so the suite keeps passing regardless
// of when it runs.
const CHECK_IN_NOW = Date.now();
const CHECK_IN_EVENT = {
  id: 'event-1',
  starts_at: new Date(CHECK_IN_NOW - 30 * 60_000).toISOString(),
  ends_at: new Date(CHECK_IN_NOW + 2 * 60 * 60_000).toISOString(),
  check_in_required: true,
  seating_mode: 'assigned_tables' as const,
  fee_cents: 0,
  bookings: [] as { profile_id: string; status: string; group_id: string }[],
};

beforeEach(() => {
  vi.clearAllMocks();
  isVisible.mockImplementation(() => true);
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  searchParams.eventId = 'event-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });

  // EventScreen fixtures.
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  createInvite.mockResolvedValue({ id: 'new-invite', error: null });
  sendClubInviteEmail.mockResolvedValue({ error: null });
  fetchEvent.mockResolvedValue(EVENT);
  fetchEventTables.mockResolvedValue([TABLE_1]);
  fetchSeries.mockResolvedValue(null);
  cancelEvent.mockResolvedValue({ error: null });
  addEventTable.mockResolvedValue({ error: null });
  removeEventTable.mockResolvedValue({ error: null });
  resetEventToSeries.mockResolvedValue({ error: null });
  fetchEventSeating.mockResolvedValue([]);
  fetchOpenOffer.mockResolvedValue(null);
  fetchEventAcceptedCount.mockResolvedValue(null);
  placeBooking.mockResolvedValue({ error: null });
  cancelBooking.mockResolvedValue({ error: null });
  callForAFourth.mockResolvedValue({ error: null });
  commitBooking.mockResolvedValue({
    result: {
      outcome: 'seated',
      split: false,
      group_id: 'group-new',
      waitlist_position: null,
      offer: null,
      placements: [],
    },
    error: null,
  });
  fetchMyCheckIn.mockResolvedValue(null);
  recordAttendance.mockResolvedValue({ error: null });
  clearAttendance.mockResolvedValue({ error: null });
  fetchTableRounds.mockResolvedValue([]);
  recordRound.mockResolvedValue({ round: null, error: null });
  deleteRound.mockResolvedValue({ error: null });

  // NewEventScreen fixtures.
  fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
  createEvent.mockResolvedValue({ eventId: 'event-1', error: null });
  createEventSeries.mockResolvedValue({ seriesId: 'series-1', error: null });
  canGoBack.mockReturnValue(true);

  // CheckInScreen fixtures.
  fetchEventAttendance.mockResolvedValue([]);
  fetchEventPayments.mockResolvedValue([]);
  setPaymentStatus.mockResolvedValue({ error: null });

  // ClubDetailScreen fixtures.
  fetchPendingInvites.mockResolvedValue([]);
  deleteInvite.mockResolvedValue({ error: null });
});

function renderEventAsMember() {
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  return render(<EventScreen />);
}

function renderEventAsOrganizer() {
  fetchRoster.mockResolvedValue(HOST_ROLE);
  return render(<EventScreen />);
}

function renderNewGameAsHost() {
  return render(<NewEventScreen />);
}

function renderCheckInAsHost() {
  fetchRoster.mockResolvedValue(HOST_ROLE);
  fetchEvent.mockResolvedValue(CHECK_IN_EVENT);
  return render(<CheckInScreen />);
}

function renderClubAsHost() {
  fetchRoster.mockResolvedValue(HOST_ROLE);
  return render(<ClubDetailScreen />);
}

function renderClubAsMember() {
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  return render(<ClubDetailScreen />);
}

describe('event page tip', () => {
  it('explains Join, Invite and the waitlist to a player on an open_play game', async () => {
    renderEventAsMember();
    expect(await screen.findByText('Getting a seat')).toBeTruthy();
    expect(screen.getByText(/Tap Join, or an Empty seat/)).toBeTruthy();
    expect(screen.getByText(/Invite to bring someone along/)).toBeTruthy();
    expect(screen.getByText(/Join the waitlist/)).toBeTruthy();
  });

  it('omits the Invite line for a plain member on an invite_only game', async () => {
    const INVITE_ONLY_EVENT = { ...EVENT, game_mode: 'invite_only' as const };
    const UNPLACED_MEMBER = {
      booking_id: 'booking-unplaced',
      group_id: 'group-unplaced',
      profile_id: 'test-user',
      display_name: 'Ada',
      skill_level: null,
      event_table_id: null as string | null,
      status: 'confirmed' as const,
      booked_by: 'test-user',
      booked_by_name: 'Ada',
      group_status: 'confirmed' as const,
      waitlist_position: null,
      created_at: '2026-08-20T10:00:00Z',
    };

    fetchEvent.mockResolvedValue(INVITE_ONLY_EVENT);
    fetchEventSeating.mockResolvedValue([UNPLACED_MEMBER]);
    fetchEventAcceptedCount.mockResolvedValue(5);
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    renderEventAsMember();

    expect(await screen.findByText('Getting a seat')).toBeTruthy();
    expect(screen.getByText(/Tap Join, or an Empty seat/)).toBeTruthy();
    expect(screen.queryByText(/Invite to bring someone along/)).toBeNull();
    expect(screen.getByText(/Join the waitlist/)).toBeTruthy();
  });

  it('is not shown to an organizer', async () => {
    renderEventAsOrganizer();
    await screen.findByText(/Invite a guest by email/);
    expect(screen.queryByText('Getting a seat')).toBeNull();
  });

  it('dismisses with its key', async () => {
    renderEventAsMember();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Getting a seat' }));
    expect(dismiss).toHaveBeenCalledWith('tip:event');
  });

  it('is hidden once dismissed', async () => {
    isVisible.mockImplementation(() => false);
    renderEventAsMember();
    // Anchors on the event title, proving the screen finished loading,
    // rather than the brief's own loose `/to play|Join|Empty/` text match --
    // that text can appear elsewhere on the page regardless of the tip.
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Getting a seat')).toBeNull();
  });
});

describe('new game tip', () => {
  it('explains seating and cost to a host', async () => {
    renderNewGameAsHost();
    expect(await screen.findByText('Setting up a game')).toBeTruthy();
    expect(screen.getByText(/Assigned tables: players pick an Empty seat/)).toBeTruthy();
    expect(screen.getByText(/Open seating: players tap Join/)).toBeTruthy();
    // Not the bare /Cost to play/ the brief's sample code uses: the form's
    // own "Cost to play" field label (components/TextField.tsx renders
    // `label` as visible text) matches that too, so a plain substring match
    // is ambiguous between the tip and the field beneath it. Anchored to the
    // fuller phrase, unique to the tip's own copy.
    expect(screen.getByText(/Cost to play, and Minimum spend/)).toBeTruthy();
    expect(screen.getByText(/No money goes through the app/)).toBeTruthy();
  });

  it('dismisses with its key', async () => {
    renderNewGameAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Setting up a game' }));
    expect(dismiss).toHaveBeenCalledWith('tip:new-game');
  });
});

describe('check-in tip', () => {
  it('explains Here, Not coming and the $ control', async () => {
    renderCheckInAsHost();
    expect(await screen.findByText('Running the door')).toBeTruthy();
    expect(screen.getByText(/Tap Here when someone arrives, or Not coming/)).toBeTruthy();
    expect(screen.getByText(/Only organizers see who has paid/)).toBeTruthy();
  });

  it('dismisses with its key', async () => {
    renderCheckInAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Running the door' }));
    expect(dismiss).toHaveBeenCalledWith('tip:check-in');
  });
});

describe('club page tip', () => {
  it('explains inviting to an organizer', async () => {
    renderClubAsHost();
    expect(await screen.findByText('Bringing people in')).toBeTruthy();
    // Not the brief's own bare /Invite by email/ and /Import a roster/: the
    // "Invite by email" TextField label and the "Import a roster" Button's
    // own label (below the tip) render as their own visible text too, same
    // ambiguity the "new game tip" describe above hits with "Cost to play"
    // -- anchored to the fuller phrases, unique to the tip's own copy.
    expect(screen.getByText(/Use Invite by email for one person/)).toBeTruthy();
    expect(screen.getByText(/Import a roster for a whole list/)).toBeTruthy();
  });

  it('is not shown to a member', async () => {
    renderClubAsMember();
    await screen.findByText('Leaderboard');
    expect(screen.queryByText('Bringing people in')).toBeNull();
  });

  it('dismisses with its key', async () => {
    renderClubAsHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Bringing people in' }));
    expect(dismiss).toHaveBeenCalledWith('tip:club');
  });
});
