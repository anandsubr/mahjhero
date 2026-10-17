import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout } from '../../lib/theme';

/**
 * A club hub section's scrolling body, beneath the fixed ClubHubHeader.
 * Mirrors `Screen`'s scroll + pinned-footer shape, with one deliberate
 * difference: no top safe-area inset, because the header above it already
 * owns that inset -- adding it again would leave a notch-sized gap between
 * the header and the section.
 */
export default function HubSection({
  children,
  footer,
  onRefresh,
}: {
  children: ReactNode;
  /** Pinned below the scroller, capped and centred like Screen's footer. */
  footer?: ReactNode;
  /** Native pull-to-refresh; HubSection owns the spinner flag. */
  onRefresh?: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = onRefresh
    ? async () => {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
    : undefined;

  return (
    <View style={styles.fill}>
      <View style={styles.body}>
        <ScrollView
          testID="hub-section-scroll"
          keyboardShouldPersistTaps="handled"
          style={styles.fill}
          refreshControl={
            handleRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accentColor}
                colors={[colors.accentColor]}
              />
            ) : undefined
          }
        >
          <View style={styles.content}>{children}</View>
        </ScrollView>
      </View>
      {footer ? <View style={styles.footerColumn}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%', backgroundColor: colors.bg },
  body: { flex: 1, minHeight: 0 },
  content: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    padding: 16,
  },
  footerColumn: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
});
