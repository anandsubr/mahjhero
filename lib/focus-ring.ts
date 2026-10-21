import { Platform } from 'react-native';
import { colors } from './theme';

/**
 * The app's one keyboard-focus style on web (Linen & Jade §4): a 2px solid
 * accent ring, offset 2, on every focusable element -- react-native-web
 * renders a Pressable as a `tabindex` element and a TextInput as an
 * `<input>`/`<textarea>`, so a global `:focus-visible` rule reaches both.
 * It replaces the browser's default blue ring, and is `!important` so it
 * wins over the few inputs that set `outlineStyle: 'none'` inline. Mouse
 * and touch focus on a button shows no ring (`:focus-visible` is false
 * there); a text field always shows it while focused, which is how
 * browsers treat text entry.
 *
 * React Native has no CSS, so this is web-only: native is untouched.
 */
export const FOCUS_RING_STYLE_ID = 'mahjhero-focus-ring';

export const FOCUS_RING_CSS =
  `:focus:not(:focus-visible) { outline: none; }\n` +
  `:focus-visible { outline: 2px solid ${colors.accentColor} !important; outline-offset: 2px !important; }\n`;

/** Adds the focus-ring stylesheet to the page once. No-op on native and during static rendering. */
export function installFocusRing(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(FOCUS_RING_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FOCUS_RING_STYLE_ID;
  style.textContent = FOCUS_RING_CSS;
  document.head.appendChild(style);
}
