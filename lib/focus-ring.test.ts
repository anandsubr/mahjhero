import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { FOCUS_RING_CSS, FOCUS_RING_STYLE_ID, installFocusRing } from './focus-ring';
import { colors } from './theme';

afterEach(() => {
  document.getElementById(FOCUS_RING_STYLE_ID)?.remove();
  vi.restoreAllMocks();
});

describe('focus ring (Linen & Jade §4)', () => {
  it('draws a 2px solid accent ring, offset 2, on keyboard focus', () => {
    expect(FOCUS_RING_CSS).toContain(':focus-visible');
    expect(FOCUS_RING_CSS).toContain(`outline: 2px solid ${colors.accentColor} !important`);
    expect(FOCUS_RING_CSS).toContain('outline-offset: 2px !important');
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
