import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventPageScreen from '../e/[token]';
import type { EventPage } from '../../lib/mahj-nights';

const push = vi.fn();
const setParams = vi.fn();
const replace = vi.fn();
const params: { token: string; r?: string; created?: string } = { token: 'tok_abcdefghijklmnopqrstuvwx' };

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  useRouter: () => ({ push, setParams, replace }),
}));
vi.mock('expo-router/head', () => ({ default: () => null }));

const SESSION: { session: unknown; loading: boolean } = { session: null, loading: false };
vi.mock('../../lib/session', () => ({ useSession: () => SESSION }));

const fetchEventPage = vi.fn();
const submitRsvp = vi.fn();
const claimMyRsvps = vi.fn();
const saveRsvpSecret = vi.fn();
const loadRsvpSecret = vi.fn();
const setRsvpTable = vi.fn(async () => true);
vi.mock('../../lib/mahj-nights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mahj-nights')>()),
  fetchEventPage: (...a: unknown[]) => fetchEventPage(...a),
  submitRsvp: (...a: unknown[]) => submitRsvp(...a),
  claimMyRsvps: (...a: unknown[]) => claimMyRsvps(...a),
  saveRsvpSecret: (...a: unknown[]) => saveRsvpSecret(...a),
  loadRsvpSecret: (...a: unknown[]) => loadRsvpSecret(...a),
  setRsvpTable: (...a: unknown[]) => setRsvpTable(...(a as [])),
}));

const PUBLIC: EventPage = {
  tier: 'public',
  title: 'Friday Mahj',
  host_first_name: 'Priya',
  starts_at: '2026-12-05T00:00:00Z',
  ends_at: '2026-12-05T03:00:00Z',
  timezone: 'America/New_York',
  area: 'Suwanee',
  status: 'published',
  theme_id: 'peony',
  beginners_welcome: true,
  tables: 2,
  seats: 8,
  going_count: 3,
  money_norm: 'quarters',
  money_note: '',
  table_counts: [3, 0],
  table_capacities: [4, 4],
  my_rsvp: null,
};

const GUEST: EventPage = {
  ...PUBLIC,
  tier: 'guest',
  club_id: 'c1',
  event_id: 'e1',
  note: 'Bring snacks',
  address: '12 Oak Lane, Suwanee, GA',
  going_names: ['Ana', 'Ben'],
  my_rsvp: {
    name: 'Ana Lopez', email: 'ana@example.com', status: 'going', is_beginner: false,
    can_teach: false, brings_set: false, has_card: false,
  },
  my_table: 1,
};

const HOST: EventPage = {
  ...GUEST,
  tier: 'host',
  my_rsvp: null,
  link_token: 'tok_abcdefghijklmnopqrstuvwx',
  link_enabled: true,
  beginner_count: 1,
  host_sets: 1,
  guest_sets: 1,
  card_count: 0,
  rsvps: [
    { id: 'r1', name: 'Ana Lopez', email: 'ana@example.com', status: 'going', is_beginner: true, can_teach: false, brings_set: true, has_card: false, signed_in: false, created_at: '', table: 1, table_pinned: false },
    { id: 'r2', name: 'Cat Wu', email: 'cat@example.com', status: 'maybe', is_beginner: false, can_teach: false, brings_set: false, has_card: false, signed_in: false, created_at: '', table: null, table_pinned: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  delete params.r;
  delete params.created;
  SESSION.session = null;
  loadRsvpSecret.mockResolvedValue(null);
  fetchEventPage.mockResolvedValue({ page: PUBLIC, error: null });
});

describe('the event page', () => {
  it('shows the public view: no address, no guest list, an RSVP form', async () => {
    render(<EventPageScreen />);
    expect(await screen.findByText('Friday Mahj')).toBeTruthy();
    expect(screen.getByText('Hosted by Priya')).toBeTruthy();
    expect(screen.getByText('Suwanee')).toBeTruthy();
    expect(screen.getByText('Beginners welcome')).toBeTruthy();
    expect(screen.getByText('Tables · 3 going')).toBeTruthy();
    expect(screen.getByText('Table 1: 3 of 4 · Table 2: open')).toBeTruthy();
    expect(screen.getByText('1 more makes a full table')).toBeTruthy();
    expect(screen.getByText('Quarters')).toBeTruthy();
    expect(screen.queryByText(/Oak Lane/)).toBeNull();
    expect(screen.getByTestId('rsvp-form')).toBeTruthy();
    expect(screen.queryByTestId('add-to-calendar')).toBeNull();
  });

  it('keeps the secret from an email link in this browser', async () => {
    params.r = 's'.repeat(32);
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    expect(saveRsvpSecret).toHaveBeenCalledWith(params.token, 's'.repeat(32));
    expect(fetchEventPage).toHaveBeenCalledWith(params.token, 's'.repeat(32));
  });

  it('sends an RSVP and reloads with the new secret', async () => {
    submitRsvp.mockResolvedValue({ outcome: 'created', secret: 'n'.repeat(32) });
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana Lopez' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: "I'm new" }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I can bring a set (with racks)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send RSVP' }));
    await waitFor(() =>
      expect(submitRsvp).toHaveBeenCalledWith({
        token: params.token, name: 'Ana Lopez', email: 'ana@example.com',
        status: 'going', isBeginner: true, isTeacher: false, bringsSet: true, hasCard: false,
        secret: null,
      }),
    );
    await waitFor(() => expect(saveRsvpSecret).toHaveBeenCalledWith(params.token, 'n'.repeat(32)));
    expect(fetchEventPage).toHaveBeenLastCalledWith(params.token, 'n'.repeat(32));
  });

  it('says so when that email already RSVP\'d', async () => {
    submitRsvp.mockResolvedValue({ outcome: 'exists' });
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Someone' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send RSVP' }));
    expect(await screen.findByText(/already RSVP'd with that email/)).toBeTruthy();
  });

  it('offers the waitlist when every seat is taken', async () => {
    fetchEventPage.mockResolvedValue({
      page: { ...PUBLIC, going_count: 8, table_counts: [4, 4] },
      error: null,
    });
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    expect(screen.getByText('Table 1 full · Table 2 full')).toBeTruthy();
    expect(screen.getByText(/Every seat is taken/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join the waitlist' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(screen.queryByText(/Every seat is taken/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send RSVP' })).toBeTruthy();
  });

  it('lets a waitlisted guest claim a seat once one opens', async () => {
    submitRsvp.mockResolvedValue({ outcome: 'updated', secret: 's'.repeat(32), status: 'going' });
    loadRsvpSecret.mockResolvedValue('s'.repeat(32));
    fetchEventPage.mockResolvedValue({
      page: {
        ...PUBLIC,
        going_count: 7,
        table_counts: [4, 3],
        my_rsvp: { name: 'Wes', email: 'wes@example.com', status: 'waitlist', is_beginner: false, can_teach: true, brings_set: true, has_card: false },
      },
      error: null,
    });
    render(<EventPageScreen />);
    expect(await screen.findByText("You're on the waitlist")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Count me in' }));
    await waitFor(() =>
      expect(submitRsvp).toHaveBeenCalledWith({
        token: params.token, name: 'Wes', email: 'wes@example.com', status: 'going',
        isBeginner: false, isTeacher: true, bringsSet: true, hasCard: false, secret: 's'.repeat(32),
      }),
    );
  });

  it("tells a guest who said yes their table", async () => {
    fetchEventPage.mockResolvedValue({ page: GUEST, error: null });
    render(<EventPageScreen />);
    expect(await screen.findByText("You're at Table 1")).toBeTruthy();
  });

  it('shows the host the sets, the warning and the seating plan, and moves a guest', async () => {
    fetchEventPage.mockResolvedValue({
      page: { ...HOST, going_count: 10, tables: 3, guest_sets: 1, table_counts: [4, 4, 2], table_capacities: [4, 4, 4] },
      error: null,
    });
    render(<EventPageScreen />);
    expect(await screen.findByText('Sets: 2 (1 yours, 1 from guests)')).toBeTruthy();
    expect(screen.getByText('You have 10 going and 2 sets. Ask someone to bring a set, or cap at 8.')).toBeTruthy();
    expect(screen.getByText('New · Bringing a set')).toBeTruthy();
    expect(screen.getByTestId('seating-plan')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ana Lopez' }));
    expect(screen.getByText('Moving Ana Lopez. Pick a table.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Table 3' }));
    await waitFor(() => expect(setRsvpTable).toHaveBeenCalledWith('r1', 3));
  });

  it('shows a guest who said yes the address, the note, who is going and the calendar', async () => {
    fetchEventPage.mockResolvedValue({ page: GUEST, error: null });
    render(<EventPageScreen />);
    expect(await screen.findByText('12 Oak Lane, Suwanee, GA')).toBeTruthy();
    expect(screen.getByText('Bring snacks')).toBeTruthy();
    expect(screen.getByText('Priya, Ana, Ben')).toBeTruthy();
    expect(screen.getByText("You're going")).toBeTruthy();
    expect(screen.getByTestId('add-to-calendar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }));
    expect(push).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent(`/e/${params.token}`)}`);
  });

  it('claims RSVPs before loading for a signed-in guest, and offers the game', async () => {
    SESSION.session = { user: { id: 'u1' } };
    fetchEventPage.mockResolvedValue({ page: GUEST, error: null });
    render(<EventPageScreen />);
    await screen.findByText('12 Oak Lane, Suwanee, GA');
    expect(claimMyRsvps).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open the game' }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e1');
  });

  it('shows the host the guest list and link controls, not the RSVP form', async () => {
    params.created = '1';
    fetchEventPage.mockResolvedValue({ page: HOST, error: null });
    render(<EventPageScreen />);
    expect(await screen.findByText('Your night is ready')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText('Going (1)')).toBeTruthy();
    expect(screen.getByText('Maybe (1)')).toBeTruthy();
    expect(screen.getByText(/1 new to mahjong/)).toBeTruthy();
    expect(screen.queryByTestId('rsvp-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the night' }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e1/edit');
  });

  it('gives a signed-out visitor the wordmark and a Sign in that comes back here', async () => {
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    fireEvent.click(screen.getByRole('link', { name: 'About MahjHero' }));
    expect(push).toHaveBeenCalledWith('/welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(push).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent(`/e/${params.token}`)}`);
  });

  it('gives a signed-in visitor a way back to Home', async () => {
    SESSION.session = { user: { id: 'u1' } };
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(replace).toHaveBeenCalledWith('/home');
  });

  it('keeps the header on the not-found page', async () => {
    fetchEventPage.mockResolvedValue({ page: null, error: 'not_found' });
    render(<EventPageScreen />);
    await screen.findByText("This invite isn't open");
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('says the invite is not open for an unknown or switched-off link', async () => {
    fetchEventPage.mockResolvedValue({ page: null, error: 'not_found' });
    render(<EventPageScreen />);
    expect(await screen.findByText("This invite isn't open")).toBeTruthy();
  });
});
