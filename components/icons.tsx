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

/**
 * Mahjong-tile dot glyphs for the skill-level picker: one dot for
 * Beginner, two for Intermediate, three for Advanced — echoing the dot
 * tiles (筒子) of the game itself.
 */
export function SkillDotsIcon({
  level,
  size = 18,
  color = colors.accentColor,
}: {
  level: 'beginner' | 'intermediate' | 'advanced';
  size?: number;
  color?: string;
}) {
  const dotPositions: Record<typeof level, { cy: number; r: number }[]> = {
    beginner: [{ cy: 14, r: 5 }],
    intermediate: [
      { cy: 8, r: 4 },
      { cy: 20, r: 4 },
    ],
    advanced: [
      { cy: 6, r: 3.4 },
      { cy: 14, r: 3.4 },
      { cy: 22, r: 3.4 },
    ],
  };

  return (
    <Svg width={size} height={(size * 28) / 18} viewBox="0 0 18 28" fill="none" stroke={color} strokeWidth={2.75}>
      {dotPositions[level].map((dot, index) => (
        <Circle key={index} cx={9} cy={dot.cy} r={dot.r} />
      ))}
    </Svg>
  );
}
