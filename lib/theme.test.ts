import { describe, expect, it } from 'vitest';
import { colors } from './theme';

/**
 * WCAG 2.1 relative luminance and contrast ratio, written out rather than
 * pulled from a package: it is a dozen lines, and a dependency for two
 * assertions is not worth the supply chain.
 *
 * This file exists because a comment claimed a ratio nobody had measured.
 * `textMuted` was documented as safe "because muted text is only ever placed
 * directly on the page background" — while measuring 3.57:1 there, below
 * AA's 4.5:1. Prose cannot hold a number honest; a test can.
 */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. The app's smallest text is 16pt, so the large-text
 *  allowance of 3:1 never applies to it. */
const AA = 4.5;

describe('contrast', () => {
  // The helper is doing real work for the assertions below, so it gets its
  // own anchor: black on white is 21:1 exactly, by definition.
  it('measures the two ends of the scale', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('muted text clears AA on both grounds it is drawn on', () => {
  it('clears AA on the page background', () => {
    expect(contrast(colors.textMuted, colors.bg)).toBeGreaterThanOrEqual(AA);
  });

  // The dashboard puts helper text inside cards, which are `surface`, not
  // `bg`. This is the ground the old value failed worst on (3.17:1).
  it('clears AA on a card', () => {
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(AA);
  });
});

describe('field labels clear AA on both grounds', () => {
  it('clears AA on the page background', () => {
    expect(contrast(colors.textLabel, colors.bg)).toBeGreaterThanOrEqual(AA);
  });

  it('clears AA on a card', () => {
    expect(contrast(colors.textLabel, colors.surface)).toBeGreaterThanOrEqual(AA);
  });
});

// UnreadBadge is the only signal an ordinary message produces — ordinary
// messages never email. `colors.bg` on `accentColor` measured 3.03:1, which
// fails AA at this weight (16px bold, below the 14pt-bold large-text
// threshold); accent[700] fixed it at 5.72:1. Pinned here so a future
// palette change that reopens the hole fails a test instead of shipping.
//
// The thread screen (app/messages/[threadId].tsx) hit the same 3.03:1
// failure twice more — the viewer's own bubble and the Send button both put
// `colors.bg` text on what would have been `accentColor` (18px regular body
// text there, needing AA's 4.5:1, not the 3:1 large-text allowance) — and
// took the same accent[700] fix. Same pair, so this one assertion already
// guards all three call sites; a regression here fails for the badge, the
// bubble, and the button at once.
describe('unread badge text clears AA on its background', () => {
  it('clears AA on accent[700]', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });
});
