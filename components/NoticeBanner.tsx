import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { CheckIcon } from './icons';
import { colors, space, type } from '../lib/theme';

/** The artboard's confirmation strip, raised after taking a seat. */
export default function NoticeBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <Card row background={colors.accent2[100]} style={styles.card}>
      <CheckIcon size={20} color={colors.accent2[700]} />
      <View style={styles.body}>
        <Text style={styles.text}>{message}</Text>
      </View>
      <Button
        variant="ghost"
        big={false}
        onPress={onDismiss}
        accessibilityLabel="Dismiss"
      >
        Dismiss
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  text: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 25,
    color: colors.accent2[800],
  },
});
