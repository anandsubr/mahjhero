import { Platform } from 'react-native';
import { colors } from './theme';

/**
 * The app's one keyboard-focus style on web (Linen & Jade §4): a 2px solid
 * ring, offset 2 -- react-native-web renders a Pressable as a `tabindex`
 * element and a TextInput as an `<input>`/`<textarea>`, so a global
 * `:focus-visible` rule reaches both. It replaces the browser's default blue
 * ring. Mouse and touch focus on a button shows no ring (`:focus-visible`
 * is false there).
 *
 * Two strengths, on purpose:
 * - Buttons, links and every other non-text element get the ring
 *   `!important`, so no component style can hide keyboard focus on them.
 * - Text fields get it at zero specificity (`:where`) and without
 *   `!important`. A text field matches `:focus-visible` for every kind of
 *   focus, mouse and touch included, so a field that sets
 *   `outlineStyle: 'none'` and draws its own focus on a wrapping pill
 *   (the Composer, the Friends and Check-in search pills, ...) must win;
 *   react-native-web's atomic class for that style beats a zero-specificity
 *   rule. A plain field with no outline style of its own still gets the
 *   ring.
 *
 * Colour: accent[600], not the spec's accent. accentColor measures 2.75:1
 * on bg and 2.46:1 on surface, under WCAG 1.4.11's 3:1 -- the same ruling
 * as the state indicators; lib/theme.test.ts pins the ratio.
 *
 * React Native has no CSS, so this is web-only: native is untouched.
 */
export const FOCUS_RING_STYLE_ID = 'mahjhero-focus-ring';

export const FOCUS_RING_COLOR = colors.accent[600];

export const FOCUS_RING_CSS =
  `:focus:not(:focus-visible) { outline: none; }\n` +
  `:focus-visible:not(input):not(textarea) { outline: 2px solid ${FOCUS_RING_COLOR} !important; outline-offset: 2px !important; }\n` +
  `:where(input:focus-visible, textarea:focus-visible) { outline: 2px solid ${FOCUS_RING_COLOR}; outline-offset: 2px; }\n`;

/** Adds the focus-ring stylesheet to the page once. No-op on native and during static rendering. */
export function installFocusRing(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(FOCUS_RING_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FOCUS_RING_STYLE_ID;
  style.textContent = FOCUS_RING_CSS;
  document.head.appendChild(style);
}
