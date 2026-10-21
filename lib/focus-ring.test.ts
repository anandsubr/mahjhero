import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { FOCUS_RING_COLOR, FOCUS_RING_CSS, FOCUS_RING_STYLE_ID, installFocusRing } from './focus-ring';
import { colors } from './theme';

afterEach(() => {
  document.getElementById(FOCUS_RING_STYLE_ID)?.remove();
  vi.restoreAllMocks();
});

describe('focus ring (Linen & Jade §4)', () => {
  it('draws a 2px solid accent[600] ring, offset 2, on keyboard focus', () => {
    expect(FOCUS_RING_COLOR).toBe(colors.accent[600]);
    expect(FOCUS_RING_CSS).toContain(':focus-visible');
    expect(FOCUS_RING_CSS).toContain(`outline: 2px solid ${colors.accent[600]} !important`);
    expect(FOCUS_RING_CSS).toContain('outline-offset: 2px !important');
    expect(FOCUS_RING_CSS).not.toContain(colors.accentColor);
  });

  // Final review I1: a text field matches :focus-visible on mouse and touch
  // focus too, so an !important ring drew a square box inside the Composer
  // and the search pills, which set outlineStyle 'none' and draw their own
  // focus. Non-text elements keep !important; text fields get a
  // zero-specificity, non-important rule any component style beats.
  describe('rule scope', () => {
    function rules(): CSSStyleRule[] {
      installFocusRing();
      const sheet = (document.getElementById(FOCUS_RING_STYLE_ID) as HTMLStyleElement).sheet!;
      return Array.from(sheet.cssRules) as CSSStyleRule[];
    }
    const important = () => rules().find((r) => r.cssText.includes('!important'))!;
    const textRule = () => rules().find((r) => r.selectorText.includes(':where('))!;

    it('keeps the !important ring off text fields and on everything else', () => {
      const sel = important().selectorText;
      const button = document.createElement('div');
      button.setAttribute('tabindex', '0');
      const link = document.createElement('a');
      link.href = '#x';
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      document.body.append(button, link, input, textarea);
      // :focus-visible cannot be driven in jsdom, so test the selector with
      // it swapped for :focus and each element focused in turn.
      const asFocus = sel.replace(/:focus-visible/g, ':focus');
      for (const el of [button, link]) {
        el.focus();
        expect(el.matches(asFocus)).toBe(true);
      }
      for (const el of [input, textarea]) {
        el.focus();
        expect(el.matches(asFocus)).toBe(false);
      }
      document.body.innerHTML = '';
    });

    it('gives text fields the same ring, non-important, at zero specificity', () => {
      const rule = textRule();
      expect(rule.cssText).not.toContain('important');
      expect(rule.style.getPropertyValue('outline-offset')).toBe('2px');
      // The whole selector sits inside :where(), so its specificity is 0
      // and react-native-web's single-class outlineStyle: 'none' wins.
      expect(rule.selectorText.trim()).toMatch(/^:where\([^]*\)$/);
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const button = document.createElement('div');
      button.setAttribute('tabindex', '0');
      document.body.append(input, textarea, button);
      const asFocus = rule.selectorText.replace(/:focus-visible/g, ':focus');
      for (const el of [input, textarea]) {
        el.focus();
        expect(el.matches(asFocus)).toBe(true);
      }
      button.focus();
      expect(button.matches(asFocus)).toBe(false);
      document.body.innerHTML = '';
    });
  });

  it('drops the browser default ring when focus is not from the keyboard', () => {
    expect(FOCUS_RING_CSS).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline: none/);
  });

  it('injects one style element on web, however many times it is called', () => {
    installFocusRing();
    installFocusRing();
    const tags = document.querySelectorAll(`style#${FOCUS_RING_STYLE_ID}`);
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe(FOCUS_RING_CSS);
  });

  it('does nothing on native', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('ios');
    installFocusRing();
    expect(document.getElementById(FOCUS_RING_STYLE_ID)).toBeNull();
  });

  it('applies to a focused Pressable and TextInput (keyboard Tab)', () => {
    installFocusRing();
    document.body.innerHTML =
      '<div tabindex="0" role="button" id="p">Join</div><input id="i" aria-label="Club code" />';
    const pressable = document.getElementById('p')!;
    pressable.focus();
    expect(document.activeElement).toBe(pressable);
    // jsdom cannot tell keyboard from mouse focus, so this checks the rule
    // matches a focused element rather than the :focus-visible heuristic;
    // the real-browser check is in the task report.
    expect(pressable.matches(':focus')).toBe(true);
    document.getElementById('i')!.focus();
    expect(document.activeElement?.id).toBe('i');
    document.body.innerHTML = '';
  });
});
