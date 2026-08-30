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

// The thread screen's Send button, ARMED for a two-step announcement
// confirmation (app/messages/[threadId].tsx's `sendArmed`), swaps its fill
// from accent[700] (pinned just above) to accent2[700] -- the same family
// this screen already uses everywhere else for "this involves email" (the
// announcement Tag, the announcement bubble, MailIcon's default colour) --
// so the SendIcon glyph (colors.bg) needs its own pin against this new
// ground. Measured at 5.43:1, clearing AA (this is a 22px SVG glyph, not
// text, so only the 3:1 non-text bar strictly applies, but it clears the
// higher bar too).
describe('armed send button clears AA on its background', () => {
  it('clears AA on accent2[700]', () => {
    expect(contrast(colors.bg, colors.accent2[700])).toBeGreaterThanOrEqual(AA);
  });
});

// The badge's own shape — accent[700] — sits on colors.surface, the tab
// bar's ground and the club chips' ground. That pairing is not text, so AA's
// 4.5:1 does not govern it; it is a filled shape against its background, so
// WCAG 1.4.11 non-text contrast applies, which sets 3:1. Measured at 5.08:1,
// comfortably clear. Pinned here so a future palette change that lets the
// badge fade into the bar fails a test instead of shipping invisible.
const NON_TEXT = 3;

describe('unread badge shape clears non-text contrast against its ground', () => {
  it('clears WCAG 1.4.11 (3:1) on surface', () => {
    expect(contrast(colors.accent[700], colors.surface)).toBeGreaterThanOrEqual(
      NON_TEXT,
    );
  });
});

// The thread screen's announcement bubble (app/messages/[threadId].tsx) put
// its subject in accent2[800] on the bubble's accent2[100] background, but
// the body text and quote-stub/Reply text followed `mine` instead --
// cream (colors.bg) on accent2[100] measures 1.10:1 when the viewer is the
// announcement's own author, which happens on every announcement its
// author looks at. All three now share accent2[800], pinned here so a
// future palette change cannot quietly reopen the hole.
describe('announcement text clears AA on the announcement background', () => {
  it('clears AA on accent2[800]', () => {
    expect(contrast(colors.accent2[800], colors.accent2[100])).toBeGreaterThanOrEqual(
      AA,
    );
  });
});

// components/ThreadRow.tsx's flat messages list gives every kind a uniform
// circular avatar, distinguished by fill: club and game share the accent
// family, direct and group the accent2 family, a shade apart within each
// pair. All four put `colors.bg` (cream) glyph/initials on a saturated fill.
//
// club and direct render INITIALS -- real text -- so they need AA's 4.5:1,
// not the 3:1 non-text allowance; accent[700] was already pinned above (the
// unread badge's own colour) at 5.72:1, reused rather than re-pinned. game
// and group render an SVG glyph instead (CalendarIcon / PeopleIcon), which
// WCAG 1.4.11 governs at 3:1, not 4.5:1 -- but both measure comfortably past
// even the higher bar, so there was no reason to pick a paler shade just
// because the rule allowed it.
// The thread screen's per-message timestamp (app/messages/[threadId].tsx)
// needs to read as small and muted on BOTH bubble grounds, which the
// bubble's own body-text colours cannot do double duty for: `colors.bg` is
// already the mine-bubble's own body text colour (bodyMine), so reusing it
// for the timestamp would make the time read at the same weight as the
// message rather than receding from it, and `colors.textMuted` (the
// incoming-bubble timestamp's own colour, already pinned above) measures
// only 1.11:1 on accent[700] -- nowhere close to AA. accent[200], the pale
// peach a step down from the mine bubble's own cream body text, reads
// 5.49:1 on accent[700] and is visibly a different (muted) tone from
// `colors.bg`'s full-strength cream, so the incoming and mine timestamps
// end up as two distinct tokens rather than one value pressed into two
// jobs.
describe('mine-bubble timestamp clears AA on its background', () => {
  it('clears AA on accent[700]', () => {
    expect(contrast(colors.accent[200], colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });
});

describe('thread row avatars clear contrast on their own fill', () => {
  it('clears AA on accent2[700] (direct avatar initials)', () => {
    expect(contrast(colors.bg, colors.accent2[700])).toBeGreaterThanOrEqual(AA);
  });

  it('clears WCAG 1.4.11 (3:1) on accent[600] (game avatar glyph)', () => {
    expect(contrast(colors.bg, colors.accent[600])).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('clears WCAG 1.4.11 (3:1) on accent2[600] (group avatar glyph)', () => {
    expect(contrast(colors.bg, colors.accent2[600])).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
