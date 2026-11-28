import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EventPageScreen from '../e/[token]';
import type { EventPage } from '../../lib/mahj-nights';

const push = vi.fn();
const setParams = vi.fn();
const params: { token: string; r?: string; created?: string } = { token: 'tok_abcdefghijklmnopqrstuvwx' };

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  useRouter: () => ({ push, setParams }),
}));
vi.mock('expo-router/head', () => ({ default: () => null }));

const SESSION: { session: unknown; loading: boolean } = { session: null, loading: false };
vi.mock('../../lib/session', () => ({ useSession: () => SESSION }));

const fetchEventPage = vi.fn();
const submitRsvp = vi.fn();
const claimMyRsvps = vi.fn();
const saveRsvpSecret = vi.fn();
const loadRsvpSecret = vi.fn();
vi.mock('../../lib/mahj-nights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mahj-nights')>()),
  fetchEventPage: (...a: unknown[]) => fetchEventPage(...a),
  submitRsvp: (...a: unknown[]) => submitRsvp(...a),
  claimMyRsvps: (...a: unknown[]) => claimMyRsvps(...a),
  saveRsvpSecret: (...a: unknown[]) => saveRsvpSecret(...a),
  loadRsvpSecret: (...a: unknown[]) => loadRsvpSecret(...a),
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
  my_rsvp: { name: 'Ana Lopez', email: 'ana@example.com', status: 'going', is_beginner: false },
};

const HOST: EventPage = {
  ...GUEST,
  tier: 'host',
  my_rsvp: null,
  link_token: 'tok_abcdefghijklmnopqrstuvwx',
  link_enabled: true,
  beginner_count: 1,
  rsvps: [
    { id: 'r1', name: 'Ana Lopez', email: 'ana@example.com', status: 'going', is_beginner: true, signed_in: false, created_at: '' },
    { id: 'r2', name: 'Cat Wu', email: 'cat@example.com', status: 'maybe', is_beginner: false, signed_in: false, created_at: '' },
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
    expect(screen.getByText('2 tables of four · 3 going')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('checkbox', { name: "I'm new, save me a learning-table seat" }));
    fireEvent.click(screen.getByRole('button', { name: 'Send RSVP' }));
    await waitFor(() =>
      expect(submitRsvp).toHaveBeenCalledWith({
        token: params.token, name: 'Ana Lopez', email: 'ana@example.com',
        status: 'going', isBeginner: true, secret: null,
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

  it('refuses a yes when every seat is taken', async () => {
    fetchEventPage.mockResolvedValue({ page: { ...PUBLIC, going_count: 8 }, error: null });
    render(<EventPageScreen />);
    await screen.findByText('Friday Mahj');
    expect(screen.getByText(/It's full/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(screen.queryByText(/It's full/)).toBeNull();
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

  it('says the invite is not open for an unknown or switched-off link', async () => {
    fetchEventPage.mockResolvedValue({ page: null, error: 'not_found' });
    render(<EventPageScreen />);
    expect(await screen.findByText("This invite isn't open")).toBeTruthy();
  });
});
