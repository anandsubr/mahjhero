import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  calendarFeedUrl,
  getMyCalendarFeedUrl,
  resetCalendarFeed,
  webcalUrl,
} from './calendar-feed';

beforeEach(() => rpc.mockReset());

describe('calendarFeedUrl', () => {
  it('builds the edge-function URL from the token', () => {
    expect(calendarFeedUrl('tok123')).toBe(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-feed?token=tok123`,
    );
  });

  it('percent-encodes a token with URL-significant characters', () => {
    expect(calendarFeedUrl('a+b/c=d')).toBe(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-feed` +
        `?token=${encodeURIComponent('a+b/c=d')}`,
    );
  });
});

describe('webcalUrl', () => {
  it('replaces a leading https:// with webcal://', () => {
    expect(webcalUrl('https://example.com/feed.ics')).toBe('webcal://example.com/feed.ics');
  });

  it('replaces a leading http:// with webcal://', () => {
    expect(webcalUrl('http://example.com/feed.ics')).toBe('webcal://example.com/feed.ics');
  });
});

describe('getMyCalendarFeedUrl', () => {
  it('calls my_calendar_feed_token and builds the URL', async () => {
    rpc.mockResolvedValueOnce({ data: 'tok123', error: null });
    const url = await getMyCalendarFeedUrl();
    expect(rpc).toHaveBeenCalledWith('my_calendar_feed_token');
    expect(url).toBe(calendarFeedUrl('tok123'));
  });

  it('returns null on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await getMyCalendarFeedUrl()).toBeNull();
  });
});

describe('resetCalendarFeed', () => {
  it('calls reset_calendar_feed_token and builds the URL', async () => {
    rpc.mockResolvedValueOnce({ data: 'tok456', error: null });
    const url = await resetCalendarFeed();
    expect(rpc).toHaveBeenCalledWith('reset_calendar_feed_token');
    expect(url).toBe(calendarFeedUrl('tok456'));
  });

  it('returns null on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await resetCalendarFeed()).toBeNull();
  });
});
