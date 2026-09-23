import { describe, expect, it } from 'vitest';
import { detectInAppBrowserLabel } from './in-app-browser';

const YAHOO_MAIL_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YahooMobileMail/6.30.2';

const SAFARI_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36';

describe('detectInAppBrowserLabel', () => {
  it('identifies the Yahoo Mail app', () => {
    expect(detectInAppBrowserLabel(YAHOO_MAIL_IOS_UA)).toBe('the Yahoo Mail app');
  });

  it('identifies Instagram, Facebook, and other known in-app browsers', () => {
    expect(detectInAppBrowserLabel('... Instagram 123.0 ...')).toBe('the Instagram app');
    expect(detectInAppBrowserLabel('... FBAN/FB4A;FBAV/400 ...')).toBe('the Facebook app');
    expect(detectInAppBrowserLabel('... LinkedInApp ...')).toBe('the LinkedIn app');
  });

  it('returns null for a real browser', () => {
    expect(detectInAppBrowserLabel(SAFARI_IOS_UA)).toBeNull();
    expect(detectInAppBrowserLabel(CHROME_ANDROID_UA)).toBeNull();
  });
});
