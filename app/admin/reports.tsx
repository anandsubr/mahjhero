import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import BackRow from '../../components/BackRow';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { ConfirmSheet } from '../../components/GameForm';
import { goBack } from '../../lib/navigation';
import { relativeTimestamp } from '../../lib/messages';
import {
  REPORT_REASONS,
  fetchReports,
  resolveReport,
  type AdminReport,
} from '../../lib/moderation';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));

/**
 * The admin-only screen behind Profile's "Reports" row. Like Greetings it
 * does not re-check is_admin: fetch_reports refuses a non-admin, and that
 * refusal is what the screen shows.
 */
export default function AdminReportsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminReport | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    const result = await fetchReports();
    if (result.error) setError(result.error);
    setReports(result.data ?? []);
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  async function resolve(report: AdminReport, action: 'remove' | 'dismiss') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await resolveReport(report.id, action);
    if (refusal) setError(refusal);
    else setReports((rows) => (rows ?? []).filter((r) => r.id !== report.id));
    busyRef.current = false;
    setBusy(false);
  }

  const backRow = (
    <BackRow
      label="Profile"
      onPress={() => goBack(router, '/profile')}
      accessibilityLabel="Back to Profile"
    />
  );

  if (loading) {
    return (
      <Screen contentStyle={[styles.container, styles.fill]}>
        {backRow}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container}>
      {backRow}
      <Text style={styles.heading}>Reports</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {reports === null ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : reports.length === 0 && !error ? (
        <Text style={styles.empty}>No open reports.</Text>
      ) : (
        reports.map((r) => {
          const gone = r.kind !== 'profile' && r.excerpt === null;
          const canRemove = r.kind !== 'profile' && !gone;
          return (
            <Card key={r.id} style={styles.card}>
              <Text style={styles.reason}>{REASON_LABEL[r.reason] ?? r.reason}</Text>
              <Text style={styles.meta}>
                {r.kind === 'profile' ? 'Profile' : r.kind === 'message' ? 'Message' : r.mediaKind === 'file' ? 'File' : 'Photo'}
                {' · '}
                {r.clubName ?? 'No group'}
                {' · '}
                {relativeTimestamp(r.createdAt)}
              </Text>
              <Text style={styles.meta}>Reported by {r.reporterName}</Text>
              <Text style={styles.meta}>About {r.reportedName}</Text>
              {r.details ? <Text style={styles.details}>“{r.details}”</Text> : null}
              {r.kind !== 'profile' ? (
                <Text style={styles.excerpt}>{gone ? 'Content already removed.' : r.excerpt}</Text>
              ) : null}
              <View style={styles.actions}>
                {canRemove ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove content"
                    disabled={busy}
                    onPress={() => setConfirming(r)}
                    style={styles.action}
                  >
                    <Text style={styles.remove}>Remove content</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                  disabled={busy}
                  onPress={() => void resolve(r, 'dismiss')}
                  style={styles.action}
                >
                  <Text style={styles.dismiss}>Dismiss</Text>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}

      {confirming ? (
        <ConfirmSheet
          title="Remove this content?"
          body="It is deleted for everyone, and cannot be undone."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            setConfirming(null);
            void resolve(target, 'remove');
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontFamily: type.heading, fontSize: type.size.h1, color: colors.text },
  empty: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
  },
  card: { gap: space[2] },
  reason: { fontFamily: type.bodySemiBold, fontSize: type.size.body, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: type.size.helper, color: colors.textMuted },
  details: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.text,
    fontStyle: 'italic',
  },
  excerpt: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  action: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: space[2] },
  remove: { fontFamily: type.bodySemiBold, fontSize: type.size.helper, color: colors.accent[800] },
  dismiss: { fontFamily: type.bodySemiBold, fontSize: type.size.helper, color: colors.accent[700] },
});
