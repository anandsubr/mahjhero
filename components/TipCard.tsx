import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, radius, space, type } from '../lib/theme';
import Button from './Button';
import Card from './Card';
import Tag from './Tag';

/**
 * The one card every first-run guide renders through — the dashboard's
 * host checklist and player intro, and each screen's one-time tip — so they
 * all read as the same kind of thing. Styled like app/welcome.tsx's Invites
 * card: accent2-100 ground with accent2-800 body text (textMuted is only
 * measured against bg and surface, not this ground).
 */
export function TipText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export default function TipCard({
  tag,
  title,
  children,
  action,
  onDismiss,
  testID,
}: {
  tag?: string;
  title: string;
  children: ReactNode;
  action?: { label: string; onPress: () => void };
  onDismiss: () => void;
  testID?: string;
}) {
  return (
    <View testID={testID}>
      <Card background={colors.accent2[100]} style={styles.card}>
        {tag ? <Tag variant="accent2">{tag}</Tag> : null}
        <Text style={styles.title}>{title}</Text>
        {children}
        <View style={styles.actions}>
          {action ? (
            <Button big={false} onPress={action.onPress} accessibilityLabel={action.label}>
              {action.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            big={false}
            onPress={onDismiss}
            accessibilityLabel={`Got it: ${title}`}
          >
            Got it
          </Button>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[4],
    gap: space[2],
    borderRadius: radius.card,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.accent2[800],
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
  },
});
