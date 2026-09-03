import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BellIcon, HomeIcon, MessageIcon, PersonIcon } from './icons';
import UnreadBadge from './UnreadBadge';
import { unreadSuffix } from '../lib/messages';
import { colors, space, type } from '../lib/theme';
import { useNotificationsUnread } from '../lib/use-notifications-unread';
import { useUnreadCounts } from '../lib/use-unread';

export type TabKey = 'club' | 'messages' | 'profile' | 'alerts';

const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: 'club', label: 'Club', href: '/clubs' },
  { key: 'messages', label: 'Messages', href: '/messages' },
  { key: 'profile', label: 'Profile', href: '/profile' },
  { key: 'alerts', label: 'Alerts', href: '/alerts' },
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
 *
 * `active` and "already at this tab's route" are different questions, and
 * conflating them was a bug. `active` drives the highlight for a whole
 * section: the club detail screen (`/clubs/[id]`) and the venue screen
 * (`/clubs/[id]/venues`) both pass `active="club"` so the bar still reads
 * as "you're in Club" while browsing under a specific club. But the press
 * handler used to treat "highlighted" and "here" as the same fact and
 * return early whenever the tab was selected — which made the Club button
 * a dead press on both of those screens, since neither one's actual route
 * is `/clubs`. That was a real trap on the club detail screen in
 * particular: its `← Clubs` back link was removed on the premise that the
 * Club tab reached the same place, leaving that screen with no way back to
 * the dashboard at all. The handler below asks the right question instead —
 * compare the current pathname to the tab's own href — so a tab stays inert
 * only on its own screen, and still navigates from every other screen in
 * its section.
 */
export default function TabBar({ active }: { active: TabKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const { total } = useUnreadCounts();
  const alertsUnread = useNotificationsUnread();

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
        // Messages and Alerts both carry a badge; the other two tabs'
        // suffix is always empty.
        const badgeCount =
          tab.key === 'messages' ? total : tab.key === 'alerts' ? alertsUnread : 0;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (pathname === tab.href) return;
              router.replace(tab.href);
            }}
            accessibilityRole="button"
            // The count is composed in here rather than left on
            // UnreadBadge's own <Text>: react-native-web's aria-label
            // REPLACES the accessible name computed from a Pressable's
            // children, it does not merge with it, so the badge nested
            // below would otherwise never reach assistive tech.
            accessibilityLabel={`${tab.label}${unreadSuffix(badgeCount)}`}
            aria-selected={selected}
            style={styles.tab}
          >
            <View style={styles.iconWrap}>
              {icon(tab.key, tint)}
              {tab.key === 'messages' || tab.key === 'alerts' ? (
                <View style={styles.badge}>
                  <UnreadBadge count={badgeCount} />
                </View>
              ) : null}
            </View>
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
  iconWrap: {
    // Positions the badge relative to the icon alone, not the whole tab —
    // an absolutely-positioned child otherwise anchors to the nearest
    // positioned ancestor, which would be this Pressable's full width.
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -space[2],
    right: -space[3],
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
  },
});
