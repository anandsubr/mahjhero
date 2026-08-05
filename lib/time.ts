/**
 * Conversion between the "HH:MM" strings the rest of the app stores (see
 * lib/profile.ts's TIME_PATTERN) and the `Date` objects the native and web
 * time pickers work in. TimeField (components/TimeField.tsx and
 * components/TimeField.web.tsx) is the only caller — everything else in the
 * app keeps circulating plain HH:MM strings, exactly as before.
 *
 * Deliberately independent of lib/profile.ts: this module doesn't validate
 * quiet-hours business rules (that's isValidQuietWindow's job), it only
 * converts a wall-clock time between two representations. A malformed or
 * incomplete string — which a web <input type="time"> can transiently hand
 * back mid-edit — falls back to midnight rather than throwing, so a picker
 * never crashes the screen over a value it will overwrite on the next
 * keystroke anyway.
 */

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A fixed, arbitrary calendar date used as the anchor for every Date this
 * module produces. Only the hour/minute ever round-trip through TimeField;
 * the date portion is never read by dateToTimeString, isValidQuietWindow, or
 * anything stored in Postgres. Fixing it (rather than defaulting to
 * `new Date()`) keeps timeStringToDate pure and its output deterministic,
 * and sidesteps any DST-transition-day edge case a "today" anchor could hit.
 */
const ANCHOR_DATE = new Date(2000, 0, 1);

/**
 * "21:00" -> a Date at hour 21, minute 0, on the fixed anchor date, in the
 * device's local time zone. Quiet hours are always local time (see the
 * notifications screen's help text), so this intentionally uses the local
 * setHours rather than any UTC conversion.
 *
 * Falls back to local midnight for a string that isn't a strict HH:MM match
 * — see the module doc for why that's the right failure mode here.
 */
export function timeStringToDate(value: string): Date {
  const match = HH_MM.exec(value);
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const date = new Date(ANCHOR_DATE);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Inverse of timeStringToDate: reads the Date's local hour/minute (matching
 * the local setHours above) and zero-pads both, so an hour like 9 becomes
 * "09" — the shape TIME_PATTERN in lib/profile.ts requires.
 */
export function dateToTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
