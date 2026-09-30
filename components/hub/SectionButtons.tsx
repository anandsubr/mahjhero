import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import {
  CalendarIcon,
  ImageIcon,
  MessageSquareIcon,
  PeopleIcon,
  TrophyIcon,
} from '../icons';
import { HUB_SECTIONS, type HubSection } from '../../lib/club-hub';
import { colors, type } from '../../lib/theme';

const ICONS: Record<HubSection, ComponentType<{ size?: number; color?: string }>> = {
  board: MessageSquareIcon,
  games: CalendarIcon,
  photos: ImageIcon,
  members: PeopleIcon,
  ranks: TrophyIcon,
};

/**
 * The club hub's five labelled section buttons (Board · Games · Photos ·
 * Members · Ranks). Labels stay: unlabelled icons were a usability problem
 * in the reference app. At 375pt with the header's 16pt side padding and
 * 6pt gaps each button is ~63.8pt wide; "Members", the widest label, is
 * ~55.6pt in Figtree Bold 13 (measured from the font's advance widths), so
 * all five fit on one line on a standard phone.
 */
export default function SectionButtons({
  active,
  onSelect,
}: {
  active: HubSection;
  onSelect: (s: HubSection) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.row}>
      {HUB_SECTIONS.map(({ key, label }) => {
        const selected = key === active;
        const Icon = ICONS[key];
        const fg = selected ? colors.accent[800] : '#fff';
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            // react-native-web drops accessibilityState.selected; the aria
            // prop is what reaches the DOM (same as HomeSwitch).
            aria-selected={selected}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.button,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Icon size={22} color={fg} />
            <Text
              style={[styles.label, { color: fg }]}
              numberOfLines={1}
              // Narrow phones (320pt) only; a no-op on web.
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  button: {
    flex: 1,
    minWidth: 0,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  selected: { backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
  label: { fontFamily: type.bodyBold, fontSize: 13 },
});
