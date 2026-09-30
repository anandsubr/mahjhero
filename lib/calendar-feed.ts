import { supabase } from './supabase';

/** The calendar-feed edge function's URL for a given subscription token. */
export function calendarFeedUrl(token: string): string {
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-feed?token=${token}`;
}

/**
 * Turns an https(s) URL into a `webcal://` one, which is what makes iOS and
 * most desktop calendar apps offer to subscribe rather than just download
 * the file once.
 */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, 'webcal://');
}

export async function getMyCalendarFeedUrl(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('my_calendar_feed_token');
    if (error) {
      console.error('getMyCalendarFeedUrl failed', error);
      return null;
    }
    return calendarFeedUrl(data as string);
  } catch (cause) {
    console.error('getMyCalendarFeedUrl failed', cause);
    return null;
  }
}

/** Replaces the member's token, invalidating any calendar subscription already set up with the old one. */
export async function resetCalendarFeed(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('reset_calendar_feed_token');
    if (error) {
      console.error('resetCalendarFeed failed', error);
      return null;
    }
    return calendarFeedUrl(data as string);
  } catch (cause) {
    console.error('resetCalendarFeed failed', cause);
    return null;
  }
}
