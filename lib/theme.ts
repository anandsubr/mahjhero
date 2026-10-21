/**
 * The "Organic" design system, translated from the CSS custom properties in
 * .superpowers/design (1C-variant.html / the design system doc) into plain
 * TypeScript. React Native has no CSS custom properties and no
 * `color-mix()`, so every derived colour below is pre-resolved to a concrete
 * hex/rgba value — see the comment on each one for how it was computed.
 *
 * This is the single source of truth for colour, spacing, radius, shadow and
 * type tokens across the app. Screens and components should pull from here
 * rather than hardcoding values, so the palette can move in one place.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

// Linen & Jade (docs/design/linen-jade/theme-linen-jade.css). Every ramp
// step is copied verbatim from that file; lib/theme.test.ts reads the CSS
// and asserts each one, so the two cannot drift apart.
const neutral = {
  100: '#fcf8f4',
  200: '#f3ece4',
  300: '#e5dbd0',
  400: '#cbbfb2',
  500: '#ab9f93',
  600: '#8b8075',
  700: '#6b6259',
  800: '#4c453f',
  900: '#302b27',
} as const;

// Terracotta, a notch brighter, with a blush top end.
const accent = {
  100: '#fff3ee',
  200: '#ffe0d4',
  300: '#ffc3ad',
  400: '#f49c7c',
  500: '#df7a55',
  600: '#c45f3b',
  700: '#9e4626',
  800: '#72311a',
  900: '#4a2011',
} as const;

// Jade, replacing olive.
const accent2 = {
  100: '#e9f7f1',
  200: '#d2ede2',
  300: '#aedcc9',
  400: '#7fc2a8',
  500: '#55a588',
  600: '#3b876c',
  700: '#2a6a54',
  800: '#1d4d3d',
  900: '#123328',
} as const;

/** A person's initials avatar: a light tint behind a deep initial. */
export type AvatarPair = { readonly bg: string; readonly fg: string };

// The six soft avatar pairs (--avatar-1..6-bg/fg). Picked per person by
// lib/friends.ts's avatarColorsFor, a stable hash of their id. Every pair
// clears AA (6.37:1 at worst, avatar-3); lib/theme.test.ts pins each.
const avatar: readonly AvatarPair[] = [
  { bg: '#ffe0d4', fg: '#72311a' },
  { bg: '#d2ede2', fg: '#1d4d3d' },
  { bg: '#fbefc8', fg: '#6b5312' },
  { bg: '#ece6f6', fg: '#4d3f73' },
  { bg: '#e2eef6', fg: '#2c4f66' },
  { bg: '#f6e1e6', fg: '#7a3348' },
];

export const colors = {
  bg: '#faf5ee',
  surface: '#f1e8dc',
  text: '#2a2321',
  // The design's muted tone is `color-mix(in srgb, text 55%, transparent)`,
  // which flattens over --color-bg to #88827d -- and measures 3.50:1 there,
  // under AA's 4.5:1 for the 16px helper text this app uses it for. The
  // dashboard also puts it on cards (surface), where it would be worse.
  //
  // So it is darkened to a 65% mix of text over --color-surface:
  // 0.65*(42,35,33) + 0.35*(241,232,220) = (112,104,98) = #706862. One value
  // covers both grounds -- 5.03:1 on bg (#faf5ee), 4.50:1 on surface
  // (#f1e8dc, 4.503 unrounded) -- so every screen clears AA, not only the
  // ones a card was added to. Still plainly muted against text (#2a2321).
  // lib/theme.test.ts holds both ratios, so the next move of this palette
  // cannot quietly drop below them.
  textMuted: '#706862',
  // .field > label { color: color-mix(in srgb, text 70%, transparent) }.
  // Same flattening approach as textMuted: 0.70*text + 0.30*bg per channel
  // = 0.70*(42,35,33) + 0.30*(250,245,238) = (104,98,95) = #68625f.
  // 5.53:1 on bg, 4.95:1 on surface.
  textLabel: '#68625f',
  accentColor: '#df7a55',
  accent2Color: '#3b876c',
  // 13% of --color-text (#2a2321) -- `color-mix(in srgb, text 13%,
  // transparent)` -- kept as rgba (rather than flattened to a hex) because
  // it is only ever used as a hairline/border overlay, where alpha
  // composites correctly regardless of what's underneath.
  divider: 'rgba(42, 35, 33, 0.13)',
  avatar,
  neutral,
  accent,
  accent2,
} as const;

// ---------------------------------------------------------------------------
// Spacing (design system's --space-1..8, in px)
// ---------------------------------------------------------------------------

export const space = {
  1: 4.4,
  2: 8.8,
  3: 13.2,
  4: 17.6,
  5: 22,
  6: 26.4,
  7: 30.8,
  8: 35.2,
} as const;

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------

export const radius = {
  sm: 8,
  md: 16,
  lg: 28,
  // Cards and dialogs: radius-lg * 1.15 ≈ 32, per the design system spec.
  card: 32,
  // Buttons, inputs, tags and segmented controls are fully pill-shaped.
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Shadow (RN has no box-shadow; these are shadow* + elevation equivalents)
// ---------------------------------------------------------------------------

// --shadow-sm/md/lg: `color-mix(in srgb, #302b27 10/12/18%, transparent)`.
// The ink is neutral-900; the mix percentage becomes shadowOpacity.

type ShadowToken = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export const shadow: { sm: ShadowToken; md: ShadowToken; lg: ShadowToken } = {
  sm: {
    shadowColor: '#302b27',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#302b27',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  lg: {
    shadowColor: '#302b27',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 8,
  },
};

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

// Font family names as registered by useFonts() in app/_layout.tsx. Screens
// reference these constants rather than the literal strings, and fall back
// to the system face automatically if the custom fonts failed to load (see
// FontProvider in app/_layout.tsx for how that fallback works).
//
// `heading` is DM Serif Display 400, for titles only: screen titles, the
// wordmark, club name, calendar month and big dates. Everything else,
// buttons included, is Figtree.
export const type = {
  heading: 'DMSerifDisplay_400Regular',
  bodyRegular: 'Figtree_400Regular',
  bodySemiBold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
  // Sizes used across the restyled screens. The design's 15px "muted" text
  // is raised to 16 everywhere in this app: 18pt is the app-wide minimum
  // body text size, with 16pt as the sole sanctioned exception for
  // helper/secondary text (this player base skews older).
  size: {
    display: 50,
    h1: 40,
    h2: 34,
    h3: 28,
    body: 18,
    bodyLarge: 19,
    helper: 16,
  },
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const layout = {
  // The source design is a 390px phone frame with 28px horizontal padding,
  // so its content column is ~334px — but that's a mobile viewport, not a
  // target width. The web build is a permanent target (club invite links
  // open it directly in a desktop browser), so on wide viewports the
  // content needs its own comfortable column rather than stretching
  // edge-to-edge or staying phone-narrow. 440 sits in the middle of the
  // ~430–480px range the design's proportions suggest once you allow the
  // extra breathing room a desktop pointer (vs. a thumb) affords, and it's
  // roomy enough for this app's "big" 58px controls without feeling like a
  // form crammed into a phone-shaped column.
  contentMaxWidth: 440,
} as const;

export const theme = { colors, space, radius, shadow, type, layout };
export default theme;
