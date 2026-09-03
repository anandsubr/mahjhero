import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { GENERIC_ERROR } from '../lib/constants';
import { initialsFrom } from '../lib/dashboard';
import {
  describeNotification,
  fetchMyNotifications,
  markNotificationsRead,
  type NotificationRow,
} from '../lib/notifications';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';

/**
 * A notification's own "when" is about the moment it reached this device,
 * not a game's schedule -- so unlike every other date in this app
 * (lib/events.ts's `formatEventWhen`, deliberately rendered in the CLUB's
 * timezone), this one is rendered with no `timeZone` override at all, which
 * makes `Intl.DateTimeFormat` read it in whatever zone the device itself is
 * set to. A reviewer skimming for the "renders a date in the wrong
 * timezone" bug class this app otherwise guards hard against should read
 * this as the deliberate exception, not a lapse.
 */
function formatReceivedAt(createdAt: string): string {
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(when);
}

/**
 * The Alerts tab's own feed, reading `notification_outbox` from the client
 * for the first time -- see
 * docs/superpowers/specs/2026-09-02-alerts-feed-design.md. A genuine tab
 * root, like Messages and the Club dashboard, so unlike app/friends.tsx (a
 * screen reached FROM Profile) this carries no back link.
 */
export default function AlertsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await fetchMyNotifications();
    setRows(next);
    // `null` is "we could not ask" and `[]` is "you have no notifications".
    // Showing the empty state for a failed read would tell the member
    // something false about themselves.
    setError(next === null ? GENERIC_ERROR : null);
    setReady(true);
    // A successful read is itself the moment the member has "seen" this
    // batch -- fire-and-forget, off the render path: a failed read-mark just
    // means the badge doesn't clear this time, which isn't worth an error
    // banner of its own, and isn't worth making the member wait for either.
    if (next !== null) void markNotificationsRead();
  }, []);

  /*
   * Refetch on focus rather than only on mount, the same reasoning as
   * app/messages/index.tsx: coming back to this tab has to be enough to see
   * something new.
   *
   * Keyed on the viewer's id, not the `session` OBJECT -- lib/session.tsx
   * hands out a fresh `Session` on every onAuthStateChange (TOKEN_REFRESHED
   * included, hourly, and on web tab focus), and none of that changes who is
   * asking. `load` is already stable.
   */
  useFocusEffect(
    useCallback(() => {
      if (!session?.user.id) return;
      void load();
    }, [session?.user.id, load]),
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="alerts" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="alerts" />}>
      <Text style={styles.heading}>Alerts</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : rows !== null && rows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No notifications yet. We will let you know when something needs your
            attention.
          </Text>
        </View>
      ) : (
        (rows ?? []).map((row) => <NotificationCard key={row.id} row={row} />)
      )}
    </Screen>
  );
}

/**
 * One row of the feed -- the row itself is the one press target, matching
 * app/clubs/index.tsx's `GameRow` pattern.
 */
function NotificationCard({ row }: { row: NotificationRow }) {
  const router = useRouter();
  const { headline, detail, href } = describeNotification(row);

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${headline}. ${detail}`}
        style={styles.row}
        onPress={() => router.push(href)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFrom(row.club_name)}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
          <Text style={styles.timestamp}>{formatReceivedAt(row.created_at)}</Text>
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h1,
    color: colors.text,
  },
  emptyCard: {
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.bg,
  },
  rowBody: { flex: 1, minWidth: 0 },
  headline: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  detail: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 22,
    color: colors.textMuted,
    marginTop: 1,
  },
  timestamp: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[1],
  },
});
