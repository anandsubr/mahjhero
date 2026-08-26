import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BellIcon, HomeIcon, MessageIcon, PersonIcon } from './icons';
import { colors, space, type } from '../lib/theme';

export type TabKey = 'club' | 'messages' | 'profile' | 'alerts';

const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: 'club', label: 'Club', href: '/clubs' },
  { key: 'messages', label: 'Messages', href: '/messages' },
  { key: 'profile', label: 'Profile', href: '/profile' },
  { key: 'alerts', label: 'Alerts', href: '/notifications' },
];

function icon(key: TabKey, color: string) {
  if (key === 'club') return <HomeIcon color={color} />;
  if (key === 'messages') return <MessageIcon color={color} />;
  if (key === 'profile') return <PersonIcon color={color} />;
  return <BellIcon color={color} />;
}

/**
 * The artboard's four-tab bottom bar, rendered by each tab screen rather
 * than installed as an expo-router route group.
 *
 * A `(tabs)` group would put `app/(tabs)/clubs/index.tsx` in the same URL
 * namespace as the existing `app/clubs/[id]/` tree, and would move files that
 * several test files import by relative path. This carries the same bar with
 * no route restructuring. Migrating to expo-router's own `Tabs` is a
 * follow-up, not a prerequisite.
 *
 * `replace`, not `push`: tabs are peers, and pushing would grow a back stack
 * of every tab the member has ever tapped.
 */
export default function TabBar({ active }: { active: TabKey }) {
  const router = useRouter();

  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        // `accent[700]`, not the artboard's `accentColor`: on this bar's
        // `surface` background accentColor measures 2.69:1, which made the
        // SELECTED tab less legible than the unselected one (neutral-700,
        // 4.92:1) — the one tab a member is looking for. accent[700] reads
        // 5.09:1 and clears AA. Same failure, and the same fix, as
        // components/NeedAFourthCard.tsx's own card background.
        const tint = selected ? colors.accent[700] : colors.neutral[700];
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (selected) return;
              router.replace(tab.href);
            }}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            aria-selected={selected}
            style={styles.tab}
          >
            {icon(tab.key, tint)}
            <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: space[2],
    paddingBottom: space[4],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: 58,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
  },
});
