/**
 * Some email and social apps render tapped links in their own restricted
 * WebView instead of handing off to the device's real browser -- Yahoo
 * Mail's is the one a real test surfaced, with no editable address bar and
 * no "open in Safari" option in its menu. Detected by user-agent substring,
 * matching the well-known tokens each app adds to its embedded WebView's UA
 * string. A miss here just means no banner shows, never a false positive
 * that blocks a real browser, so this stays a permissive substring list
 * rather than a strict allowlist.
 */
const KNOWN_IN_APP_BROWSERS: { pattern: RegExp; label: string }[] = [
  { pattern: /YahooMobileMail/i, label: 'the Yahoo Mail app' },
  { pattern: /FBAN|FBAV/i, label: 'the Facebook app' },
  { pattern: /Instagram/i, label: 'the Instagram app' },
  { pattern: /Line\//i, label: 'the LINE app' },
  { pattern: /LinkedInApp/i, label: 'the LinkedIn app' },
  { pattern: /TikTok|musical_ly/i, label: 'the TikTok app' },
  { pattern: /Twitter/i, label: 'the X (Twitter) app' },
  { pattern: /MicroMessenger/i, label: 'WeChat' },
];

/** Returns a friendly name for the host app if `userAgent` matches a known in-app browser, else null. */
export function detectInAppBrowserLabel(userAgent: string): string | null {
  const match = KNOWN_IN_APP_BROWSERS.find(({ pattern }) => pattern.test(userAgent));
  return match ? match.label : null;
}
