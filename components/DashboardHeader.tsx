import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PersonIcon } from './icons';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header: scope on the left, the member on the
 * right.
 *
 * The artboard draws an up/down chevron beside the kicker, tapping through to
 * a separate "Your clubs" screen. This app keeps that list on this same
 * screen, so there is nowhere for the chevron to go and it is not drawn — an
 * affordance that does nothing is worse than none. The chips do the
 * switching.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  initials,
  onPressAvatar,
}: {
  kicker: string;
  name: string;
  meta: string;
  initials: string;
  onPressAvatar: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.scope}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.name}>{name}</Text>
        {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        style={styles.avatar}
      >
        {initials.length > 0 ? (
          <Text style={styles.initials}>{initials}</Text>
        ) : (
          <View testID="avatar-fallback">
            <PersonIcon size={26} color={colors.bg} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  scope: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accentColor,
  },
  name: {
    fontFamily: type.heading,
    fontSize: 30,
    lineHeight: 35,
    color: colors.text,
    marginTop: 3,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 3,
  },
  avatar: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.pill,
    // `accent2[700]`, not the artboard's `accent2[500]`: cream initials on
    // accent2-500 measure 2.37:1, and these are 18px bold text (AA needs
    // 4.5:1) with a PersonIcon fallback that needs 3:1 as a graphic.
    // accent2-700 brings the same cream to 5.43:1. Same failure, and the same
    // fix, as components/NeedAFourthCard.tsx's own card background.
    backgroundColor: colors.accent2[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.bg,
  },
});
