/**
 * The fixed (non-templated) guide keys — every one of `GuideKey` except
 * `host-checklist:${string}`, which is per-club rather than a static string.
 * e2e/session.ts's `setDismissedGuides('all', ...)` imports this rather than
 * hand-duplicating the list, so the two can't drift apart.
 *
 * Split out of lib/guides.ts on purpose: that module imports ./supabase,
 * which pulls in react-native-url-polyfill/AsyncStorage/react-native —
 * modules Playwright's Node-based test loader (e2e/*.ts) cannot parse. This
 * file has zero imports so e2e/session.ts can import it directly without
 * dragging the whole app runtime into the Playwright process. lib/guides.ts
 * re-exports both names below so every existing importer of them is
 * unaffected.
 */
export const STATIC_GUIDE_KEYS = [
  'player-intro',
  'tip:event',
  'tip:new-game',
  'tip:check-in',
  'tip:club',
] as const;

/**
 * First-run guidance (docs/superpowers/specs/2026-09-23-first-run-guidance-design.md).
 * Every tip and card is identified by one of these keys; a key present in
 * `profiles.dismissed_guides` means that person has dismissed it.
 */
export type GuideKey =
  | (typeof STATIC_GUIDE_KEYS)[number]
  | `host-checklist:${string}`;
