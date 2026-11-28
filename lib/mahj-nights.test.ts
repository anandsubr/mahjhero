import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Share: { share: vi.fn() } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));
const rpc = vi.fn();
const invoke = vi.fn();
const from = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...a),
  },
}));

import {
  createMahjNight,
  fetchEventPage,
  fetchMyMahjNights,
  googleCalendarUrl,
  icsFile,
  rsvpErrorMessage,
  submitRsvp,
} from './mahj-nights';

beforeEach(() => vi.clearAllMocks());

const FACTS = {
  title: 'Friday Mahj',
  startsAt: '2026-12-05T00:00:00Z',
  endsAt: '2026-12-05T03:00:00Z',
  address: '12 Oak Lane, Suwanee',
  details: 'Bring snacks',
  url: 'https://app.mahjhero.com/e/tok',
};

describe('calendar links', () => {
  it('builds a Google Calendar template link in UTC', () => {
    const url = new URL(googleCalendarUrl(FACTS));
    expect(url.searchParams.get('dates')).toBe('20261205T000000Z/20261205T030000Z');
    expect(url.searchParams.get('text')).toBe('Friday Mahj');
    expect(url.searchParams.get('location')).toBe('12 Oak Lane, Suwanee');
  });

  it('builds a one-event .ics with escaped text', () => {
    const ics = icsFile(FACTS, 'e1');
    expect(ics).toContain('DTSTART:20261205T000000Z');
    expect(ics).toContain('LOCATION:12 Oak Lane\\, Suwanee');
    expect(ics).toContain('UID:e1@mahjhero.com');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('createMahjNight', () => {
  it('sends the form to create_mahj_night with the device timezone', async () => {
    rpc.mockResolvedValue({ data: { club_id: 'c1', event_id: 'e1', link_token: 't' }, error: null });
    const result = await createMahjNight({
      name: 'Friday', date: '2026-12-04', startTime: '19:00', durationMinutes: 180,
      address: '12 Oak Lane', area: 'Suwanee', tables: 2, themeId: 'jade',
      beginnersWelcome: true, note: '',
    });
    expect(result).toEqual({ data: { clubId: 'c1', eventId: 'e1', linkToken: 't' }, error: null });
    expect(rpc).toHaveBeenCalledWith('create_mahj_night', expect.objectContaining({
      night_name: 'Friday', table_count: 2, theme: 'jade',
      night_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
  });

  it('turns a past start into a sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'that start time has already passed' } });
    const result = await createMahjNight({
      name: '', date: '2020-01-01', startTime: '19:00', durationMinutes: 180,
      address: 'x', area: '', tables: 1, themeId: 'jade', beginnersWelcome: false, note: '',
    });
    expect(result.error).toBe('That start time has already passed.');
  });
});

describe('the edge function calls', () => {
  it('fetches the page by token and secret', async () => {
    invoke.mockResolvedValue({ data: { page: { title: 'x' } }, error: null });
    await fetchEventPage('tok', 'sec');
    expect(invoke).toHaveBeenCalledWith('mahj-night?token=tok&r=sec', { method: 'GET' });
  });

  it('reads a 404 as not found', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    expect(await fetchEventPage('tok', null)).toEqual({ page: null, error: 'not_found' });
  });

  it('maps an RSVP refusal to a sentence', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'full' }) } },
    });
    const result = await submitRsvp({
      token: 'tok', name: 'A', email: 'a@b.co', status: 'going', isBeginner: false, secret: null,
    });
    expect(result).toEqual({ outcome: 'error', message: rsvpErrorMessage('full') });
  });
});

describe('fetchMyMahjNights', () => {
  it('lists upcoming nights soonest first and drops finished ones', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        { id: 'c2', name: 'Later', link_token: 't2', theme_id: 'peony', timezone: 'UTC',
          events: [{ id: 'e2', title: null, starts_at: '2026-12-20T00:00:00Z', ends_at: '2026-12-20T03:00:00Z',
            public_area: '', status: 'published', event_type: 'mahj_night' }] },
        { id: 'c1', name: 'Soon', link_token: 't1', theme_id: null, timezone: 'UTC',
          events: [{ id: 'e1', title: 'Soon night', starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-01T03:00:00Z',
            public_area: 'Suwanee', status: 'cancelled', event_type: 'mahj_night' }] },
        { id: 'c0', name: 'Past', link_token: 't0', theme_id: null, timezone: 'UTC',
          events: [{ id: 'e0', title: null, starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-01T03:00:00Z',
            public_area: '', status: 'published', event_type: 'mahj_night' }] },
      ],
      error: null,
    });
    from.mockReturnValue({ select: () => ({ eq }) });
    const nights = await fetchMyMahjNights(new Date('2026-11-28T00:00:00Z'));
    expect(eq).toHaveBeenCalledWith('kind', 'event');
    expect(nights?.map((n) => [n.title, n.linkToken, n.cancelled])).toEqual([
      ['Soon night', 't1', true],
      ['Later', 't2', false],
    ]);
  });
});
