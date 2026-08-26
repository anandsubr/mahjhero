import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's call for a fourth: an accent card with a red-dragon tile,
 * the club it belongs to, and one button that takes the seat.
 *
 * The glyph is 中 on a background-coloured tile, exactly as drawn. No custom
 * font is shipped for it — iOS and Android both cover the character in their
 * system fallback stack, and the design's own stack (Hiragino Mincho ProN,
 * Songti SC, Noto Serif SC) is a web nicety rather than a requirement.
 *
 * The card's background is `colors.accent[700]`, not the artboard's
 * `colors.accentColor` — the artboard's cream-on-accent pairing measures
 * 3.03:1 (2.75:1 for the kicker) and fails WCAG AA at this text size.
 * `accent[700]` brings cream text up to 5.72:1. The tile glyph and the
 * "I'm in" button follow the same darker tone for coherence with the card.
 */
export default function NeedAFourthCard({
  clubName,
  text,
  busy,
  onTake,
}: {
  clubName: string;
  text: string;
  busy: boolean;
  onTake: () => void;
}) {
  return (
    <Card row elevated background={colors.accent[700]} style={styles.card}>
      <View style={styles.tile}>
        <Text style={styles.glyph}>中</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.kicker}>{`Need a 4th · ${clubName}`}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
      <Button
        big={false}
        variant="secondary"
        disabled={busy}
        onPress={onTake}
        accessibilityLabel={`I'm in — ${text}`}
        style={styles.action}
      >
        I&apos;m in
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  tile: {
    width: 38,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.sm * 1.4,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.accent[700],
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.bg,
  },
  text: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.bg,
    marginTop: 2,
  },
  action: {
    flexShrink: 0,
    minHeight: 46,
    backgroundColor: colors.bg,
  },
});
