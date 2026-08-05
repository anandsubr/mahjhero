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

const neutral = {
  100: '#f9f4ed',
  200: '#eee7db',
  300: '#dcd3c4',
  400: '#c0b6a5',
  500: '#a19786',
  600: '#82796a',
  700: '#645c50',
  800: '#474238',
  900: '#2e2b25',
} as const;

const accent = {
  100: '#fff2eb',
  200: '#ffe1d0',
  300: '#ffc6a5',
  400: '#f6a06b',
  500: '#d67f48',
  600: '#b2622d',
  700: '#8c491a',
  800: '#643312',
  900: '#402310',
} as const;

const accent2 = {
  100: '#f0fae1',
  200: '#e1eecc',
  300: '#ccdbb2',
  400: '#aebf92',
  500: '#8fa073',
  600: '#728157',
  700: '#56633f',
  800: '#3d472b',
  900: '#272e1b',
} as const;

export const colors = {
  bg: '#f5ead8',
  surface: '#ebddc5',
  text: '#201e1d',
  // color-mix(in srgb, text 55%, transparent) over --color-bg, flattened to
  // a concrete hex: 0.55*text + 0.45*bg per channel = 0.55*(32,30,29) +
  // 0.45*(245,234,216) = (128,122,113). Flattening (rather than rgba) is
  // safe here because muted text is only ever placed directly on the page
  // background, never on a card or accent surface.
  textMuted: '#807a71',
  // .field > label { color: color-mix(in srgb, text 70%, transparent) }.
  // Same flattening approach as textMuted: 0.70*text + 0.30*bg per channel
  // = 0.70*(32,30,29) + 0.30*(245,234,216) = (96,91,85).
  textLabel: '#605b55',
  accentColor: '#c67139',
  accent2Color: '#7a8a5e',
  // 16% of --color-text (#201e1d) over the background — kept as rgba
  // (rather than flattened to a hex) because it is only ever used as a
  // hairline/border overlay, where alpha composites correctly regardless of
  // what's underneath.
  divider: 'rgba(32, 30, 29, 0.16)',
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

type ShadowToken = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export const shadow: { sm: ShadowToken; md: ShadowToken; lg: ShadowToken } = {
  sm: {
    shadowColor: '#2e2b25',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#2e2b25',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 3,
  },
  lg: {
    shadowColor: '#2e2b25',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
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
export const type = {
  heading: 'Caprasimo_400Regular',
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
