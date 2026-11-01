import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors, invitedAvatar, shadow, type } from './theme';

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

/*
 * The "measured at" ratios quoted in the comments below were taken against
 * the original Organic palette. Re-measured on Linen & Jade (2026-10-21):
 * colors.bg on accent[700] 5.77:1 (was 5.72), on accent2[700] 5.89:1 (was
 * 5.43), accent[700] on surface 5.16:1 (was 5.08), bg on accent[600]
 * 3.84:1, on accent2[600] 3.98:1, accent2[800] on accent2[100] 8.73:1,
 * neutral[700] 5.51:1 on bg and 4.92:1 on surface. Every assertion still
 * holds; the assertions, not these numbers, are what is enforced.
 */

/** WCAG AA for body text. Most of the app's text is 16pt or larger, so the
 *  large-text allowance of 3:1 does not apply -- the one known exception is
 *  components/MahjongTile.tsx's tab label, at 12pt, which is still checked
 *  against this same 4.5:1 bar below ("selected tab tile clears AA on its
 *  fill") rather than the weaker one it would technically be entitled to. */
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
// Linen & Jade: a direct avatar is a person, so it now takes that person's
// soft avatar pair (pinned in "avatar initials clear AA on their tint"
// below) instead of accent2[700]. The accent2[700] pin stays: it is still
// the Send button's armed fill and HomeHeader's own profile button.
//
// club and direct render INITIALS -- real text -- so they need AA's 4.5:1,
// not the 3:1 non-text allowance; accent[700] was already pinned above (the
// unread badge's own colour) at 5.72:1, reused rather than re-pinned. game
// and group render an SVG glyph instead (CalendarIcon / PeopleIcon), which
// WCAG 1.4.11 governs at 3:1, not 4.5:1 -- but both measure comfortably past
// even the higher bar, so there was no reason to pick a paler shade just
// because the rule allowed it.
//
// The thread screen used to also put a per-message timestamp inside the
// mine bubble, in accent[200] on accent[700] (5.49:1) -- pinned here for
// exactly that pairing. The redesign to iOS Messages' centred separator
// (app/messages/[threadId].tsx) removed the per-bubble timestamp entirely,
// and accent[200] is not drawn on accent[700] anywhere else in the app
// (accent[200] elsewhere is only ever a BACKGROUND -- Tag, Button,
// ErrorBanner -- never text on accent[700]), so the pin went with it rather
// than staying as an assertion for a colour combination nothing renders.
// The separator's own text reuses `colors.textMuted` on `colors.bg`,
// already pinned above ("muted text clears AA on both grounds").

describe('thread row avatars clear contrast on their own fill', () => {
  it('clears AA on accent2[700] (formerly direct avatar initials)', () => {
    expect(contrast(colors.bg, colors.accent2[700])).toBeGreaterThanOrEqual(AA);
  });

  it('clears WCAG 1.4.11 (3:1) on accent[600] (game avatar glyph)', () => {
    expect(contrast(colors.bg, colors.accent[600])).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('clears WCAG 1.4.11 (3:1) on accent2[600] (group avatar glyph)', () => {
    expect(contrast(colors.bg, colors.accent2[600])).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

// app/alerts.tsx's own club-initials avatar first shipped with accent[500]
// filling the circle behind colors.bg text -- 2.52:1, well under AA. Real
// text (club initials, same as ThreadRow's club/direct avatars above) needs
// the 4.5:1 bar, not a decorative fill's 3:1. Fixed to accent[700] -- the
// exact same pairing already measured at 5.72:1 above ("unread badge text
// clears AA on its background"), not a new number. Given its own describe
// block anyway, rather than left to be found by inference from an unrelated
// component's test: a future change to this avatar's fill (or a palette
// change to accent[700] itself) should fail a test named for the avatar it
// actually breaks, not force someone hunting for "why is my alerts avatar
// suddenly unreadable" to realize the relevant assertion lives under a
// badge's own describe block three components away.
describe('alerts feed avatar initials clear AA on their fill', () => {
  it('clears AA on accent[700]', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });
});

// components/SeatGrid.tsx's per-seat scoring UI first shipped both its round
// point badge (`badgeRound`) and its point-value chips (`pointChip`) with
// `colors.bg` text directly on `colors.accentColor` -- the exact 3.03:1
// failing pair this file already pins a regression against above ("unread
// badge text clears AA on its background"). Fixed the same way: both switched
// to `colors.accent[700]` (5.72:1). Given their own describe block, same
// reasoning as the alerts avatar above -- so a future palette change (or a
// SeatGrid edit that reverts to `accentColor`) fails a test named for the
// seat badge/chip it actually breaks, not just the unrelated unread badge.
describe('seat grid round badge and point chips clear AA on their fill', () => {
  it('clears AA on accent[700] (round badge text)', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });

  it('clears AA on accent[700] (point chip text)', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });
});

// components/MahjongTile.tsx's selected tab tile (the bottom bar's own
// highlighted tab, active on every one of the app's 24 screens) first
// shipped with the same failing pair this file already pins a regression
// against above ("unread badge text clears AA on its background") --
// `colors.bg` glyph/label directly on `colors.accentColor`, 3.03:1, and this
// text is 12px, nowhere near the 3:1 large-text allowance. Fixed the same
// way: the tile's fill moved to `colors.accent[700]` (5.72:1, reused rather
// than re-pinned) and its lip one step darker still, to `colors.accent[800]`,
// so the raised-edge illusion TileHero's own accent tile (app/welcome.tsx)
// established still reads. Given its own describe block, same reasoning as
// the alerts avatar and seat grid blocks above -- so a future palette change
// to accent[700] itself fails a test named for the primary navigation it
// actually breaks. This assertion only re-checks the raw token pair, though
// -- it neither imports nor renders MahjongTile, so it would NOT catch
// MahjongTile.tsx's own `styles.selected.backgroundColor` being edited back
// to `colors.accentColor` directly; only a change to the `accent[700]` token
// itself trips it, same as every other pin in this file.
describe('selected tab tile clears AA on its fill', () => {
  it('clears AA on accent[700] (selected tile glyph/label)', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });
});

// The conversation screen (Messages 2a handoff): its small text all sits on
// colors.bg -- the "**Today** 7:26 pm" separator and Reply chip in
// neutral[700], the sender name and a group's member count in accent2[700],
// and the camera glyph in neutral[700]. At 12-15px none of it qualifies for
// the large-text allowance, so each needs the full 4.5:1.
describe('conversation screen text clears AA on the page background', () => {
  it('neutral[700] (separator, Reply chip, camera) on bg', () => {
    expect(contrast(colors.neutral[700], colors.bg)).toBeGreaterThanOrEqual(AA);
  });
  it('neutral[700] (camera glyph) on the composer pill (surface)', () => {
    expect(contrast(colors.neutral[700], colors.surface)).toBeGreaterThanOrEqual(3);
  });
  it('accent2[700] (sender name, member count) on bg', () => {
    expect(contrast(colors.accent2[700], colors.bg)).toBeGreaterThanOrEqual(AA);
  });
});

// ---------------------------------------------------------------------------
// Linen & Jade: the tokens must equal docs/design/linen-jade/
// theme-linen-jade.css, the design handoff's source of truth. Read from the
// file itself rather than copied into this test, so a value typed wrong in
// lib/theme.ts cannot also be typed wrong here and agree with itself.
// ---------------------------------------------------------------------------

const css = readFileSync(
  join(__dirname, '..', 'docs', 'design', 'linen-jade', 'theme-linen-jade.css'),
  'utf8',
);

function cssVar(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`--${name} not found in theme-linen-jade.css`);
  return match[1].toLowerCase();
}

describe('Linen & Jade tokens equal the CSS', () => {
  it('base colours', () => {
    expect(colors.bg).toBe(cssVar('color-bg'));
    expect(colors.surface).toBe(cssVar('color-surface'));
    expect(colors.text).toBe(cssVar('color-text'));
    expect(colors.accentColor).toBe(cssVar('color-accent'));
    expect(colors.accent2Color).toBe(cssVar('color-accent-2'));
  });

  it.each([100, 200, 300, 400, 500, 600, 700, 800, 900] as const)(
    'every ramp step %i',
    (step) => {
      expect(colors.neutral[step]).toBe(cssVar(`color-neutral-${step}`));
      expect(colors.accent[step]).toBe(cssVar(`color-accent-${step}`));
      expect(colors.accent2[step]).toBe(cssVar(`color-accent-2-${step}`));
    },
  );

  it('six soft avatar pairs, in order', () => {
    expect(colors.avatar).toHaveLength(6);
    colors.avatar.forEach((pair, i) => {
      expect(pair.bg).toBe(cssVar(`avatar-${i + 1}-bg`));
      expect(pair.fg).toBe(cssVar(`avatar-${i + 1}-fg`));
    });
  });

  // color-mix(in srgb, #2a2321 13%, transparent): the text colour at 13%.
  it('divider is text at 13%', () => {
    expect(colors.divider).toBe('rgba(42, 35, 33, 0.13)');
  });

  // color-mix(in srgb, #302b27 10/12/18%, transparent): ink is neutral-900.
  it('shadows are ink at 10/12/18%', () => {
    for (const s of [shadow.sm, shadow.md, shadow.lg]) {
      expect(s.shadowColor).toBe(cssVar('color-neutral-900'));
    }
    expect(shadow.sm.shadowOpacity).toBe(0.1);
    expect(shadow.md.shadowOpacity).toBe(0.12);
    expect(shadow.lg.shadowOpacity).toBe(0.18);
  });

  it('heading face is DM Serif Display 400', () => {
    expect(type.heading).toBe('DMSerifDisplay_400Regular');
  });
});

// Every avatar pair is a deep initial on a light tint: real text, so AA.
describe('avatar initials clear AA on their tint', () => {
  it.each([0, 1, 2, 3, 4, 5])('avatar-%i', (i) => {
    const { bg, fg } = colors.avatar[i];
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  // HomeHeader's own profile button: white initial on accent2[700].
  it('the current user\'s profile button: white on accent2[700]', () => {
    expect(contrast('#ffffff', colors.accent2[700])).toBeGreaterThanOrEqual(AA);
  });
});

// Linen & Jade ruling (Task 1 review): the brighter accent (#df7a55) carries
// cream text at only 2.75:1, so Button's primary fill and ghost label move
// to accent[700] -- the README's "accent text / primary buttons" step.
// These pin the token pairs; components/__tests__/Button.test.tsx pins that
// Button actually renders them.
describe('button text/fill pairs clear AA', () => {
  it('primary: colors.bg label on the accent[700] fill', () => {
    expect(contrast(colors.bg, colors.accent[700])).toBeGreaterThanOrEqual(AA);
  });

  it('ghost: accent[700] label on bg and on surface', () => {
    expect(contrast(colors.accent[700], colors.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.accent[700], colors.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('secondary: text on surface', () => {
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('dark: colors.bg on neutral[900]', () => {
    expect(contrast(colors.bg, colors.neutral[900])).toBeGreaterThanOrEqual(AA);
  });

  it('destructive: accent[800] on accent[200]', () => {
    expect(contrast(colors.accent[800], colors.accent[200])).toBeGreaterThanOrEqual(AA);
  });
});

// components/SeatGrid.tsx's invited-seat sheet: not the invitee's own tint
// (the viewer may not be allowed to know who it is), but still a real
// initial, so AA.
describe('invited seat avatar clears AA', () => {
  it('fg on bg', () => {
    expect(contrast(invitedAvatar.fg, invitedAvatar.bg)).toBeGreaterThanOrEqual(AA);
  });
});

// State indicators -- Toggle's and GameForm's on tracks, the notifications
// radio ring and dot, TierPicker's selected pill -- are graphics whose fill
// IS the state, so WCAG 1.4.11's 3:1 applies against the ground they sit on.
// accentColor is 2.75:1 on bg; accent[600] is used instead. The knobs drawn
// on the track (colors.bg in Toggle, '#fff' in GameForm) are checked too.
// lib/focus-ring.ts's keyboard ring is drawn on the page and on cards. The
// spec's accent (accentColor) measured 2.75:1 on bg and 2.46:1 on surface,
// under WCAG 1.4.11's 3:1, so it uses accent[600] like the state indicators.
describe('the focus ring clears non-text contrast', () => {
  it('clears 3:1 on bg and on surface', () => {
    expect(contrast(colors.accent[600], colors.bg)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast(colors.accent[600], colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

// components/TipCard.tsx: accent2[800] body text on the blush accent[100]
// ground (Linen & Jade §4).
describe('TipCard body text clears AA on its ground', () => {
  it('clears AA for accent2[800] on accent[100]', () => {
    expect(contrast(colors.accent2[800], colors.accent[100])).toBeGreaterThanOrEqual(AA);
  });
});

// components/hub/MemberRow.tsx's Beginner skill chip: accent2[800] text on
// an accent2[200] fill.
describe('Beginner skill chip clears AA', () => {
  it('clears AA for accent2[800] on accent2[200]', () => {
    expect(contrast(colors.accent2[800], colors.accent2[200])).toBeGreaterThanOrEqual(AA);
  });
});

describe('state indicators clear non-text contrast', () => {
  it('accent[600] clears 3:1 on bg and on surface', () => {
    expect(contrast(colors.accent[600], colors.bg)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast(colors.accent[600], colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('the knob clears 3:1 on the accent[600] track', () => {
    expect(contrast(colors.bg, colors.accent[600])).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast('#ffffff', colors.accent[600])).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
