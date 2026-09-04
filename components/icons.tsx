import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../lib/theme';

/** Back-navigation chevron, matching the design's ghost "Back" buttons. */
export function ChevronLeftIcon({ size = 20, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m12 19-7-7 7-7" />
      <Path d="M19 12H5" />
    </Svg>
  );
}

/** The thread screen's name pill (app/messages/[threadId].tsx) -- signals
 *  that pressing it opens something further, the mirror of ChevronLeftIcon
 *  above. */
export function ChevronRightIcon({ size = 16, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

/** Pencil for the clubs dashboard header (components/DashboardHeader.tsx),
 *  where pressing the club in scope opens that club's roster, invites,
 *  venues and import — management, not a form. */
export function PencilIcon({ size = 16, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

/** Plus for the clubs dashboard header's "start a club" control
 *  (components/DashboardHeader.tsx). */
export function PlusIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14" />
      <Path d="M5 12h14" />
    </Svg>
  );
}

/** Envelope glyph for the "check your email" screen. */
export function MailIcon({ size = 40, color = colors.accent2[700] }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={2} y={4} width={20} height={16} rx={2} />
      <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Svg>
  );
}

/** Checkmark glyph — success confirmations. */
export function CheckIcon({ size = 20, color = colors.accent2[700] }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

/** Two overlapping rectangles -- the club edit page's "copy this invite
 *  link" control (app/clubs/[id]/index.tsx). */
export function CopyIcon({ size = 18, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={8} y={8} width={13} height={13} rx={2} />
      <Path d="M4 16V5a1 1 0 0 1 1-1h11" />
    </Svg>
  );
}

/** The club edit page's "revoke this pending invite" control
 *  (app/clubs/[id]/index.tsx). */
export function TrashIcon({ size = 18, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18" />
      <Path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}

/**
 * Two overlapping heads -- a group thread's avatar glyph. Distinct from a
 * lone stick figure (a direct thread's glyph is the other member's initials,
 * not an icon) so a group still reads as "more than one person" at a glance
 * in the messages list's otherwise-uniform circular avatars.
 */
export function PeopleIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <Circle cx={9} cy={7} r={4} />
      <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}

/** A game thread's avatar glyph, in the messages list -- see ThreadRow.tsx. */
export function CalendarIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={4} width={18} height={18} rx={2} />
      <Path d="M16 2v4" />
      <Path d="M8 2v4" />
      <Path d="M3 10h18" />
    </Svg>
  );
}

/**
 * The thread composer's Send glyph -- a paper plane, matching the `1C
 * thread` artboard's icon-only circular Send button exactly (same two paths,
 * same 22x22/24-viewBox proportions the artboard's SVG uses).
 */
export function SendIcon({ size = 22, color = colors.bg }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <Path d="m21.854 2.147-10.94 10.939" />
    </Svg>
  );
}

/** Filled star, for the leading player's point badge on a seat tile
 *  (components/SeatGrid.tsx). Filled, not stroked, unlike every other icon
 *  in this file -- a badge needs a solid shape to sit text on top of. */
export function StarIcon({
  size = 24,
  color = colors.accentColor,
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Path d="M12 2l2.9 6.9L22 9.6l-5.5 4.9L18 22l-6-3.9L6 22l1.5-7.5L2 9.6l7.1-.7z" />
    </Svg>
  );
}
