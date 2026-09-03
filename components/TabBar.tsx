import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import MahjongTile, { type MahjongSuit } from './MahjongTile';
import UnreadBadge from './UnreadBadge';
import { unreadSuffix } from '../lib/messages';
import { space } from '../lib/theme';
import { useNotificationsUnread } from '../lib/use-notifications-unread';
import { useUnreadCounts } from '../lib/use-unread';

export type TabKey = 'club' | 'messages' | 'profile' | 'alerts';

const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: 'club', label: 'Club', href: '/clubs' },
  { key: 'messages', label: 'Messages', href: '/messages' },
  { key: 'profile', label: 'Profile', href: '/profile' },
  { key: 'alerts', label: 'Alerts', href: '/alerts' },
];

// Exported so app/__tests__/nav-glyph-parity.test.tsx can check the bar's own
// mapping against the suit prop each landing screen's own section tile
// carries, rather than duplicating this mapping as a second hardcoded list
// that could itself drift from this one.
export function suitFor(key: TabKey): MahjongSuit {
  if (key === 'club') return 'dots';
  if (key === 'messages') return 'bamboo';
  if (key === 'profile') return 'red-dragon';
  return 'green-dragon';
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
            <View style={styles.tileWrap}>
              <MahjongTile
                suit={suitFor(tab.key)}
                size="tab"
                selected={selected}
                label={tab.label}
              />
              {tab.key === 'messages' || tab.key === 'alerts' ? (
                <View style={styles.badge}>
                  <UnreadBadge count={badgeCount} />
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileWrap: {
    // Positions the badge relative to the tile alone, not the whole tab --
    // an absolutely-positioned child otherwise anchors to the nearest
    // positioned ancestor, which would be this Pressable's full width.
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -space[2],
    right: -space[2],
  },
});
