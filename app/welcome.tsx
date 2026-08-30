import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Button from '../components/Button';
import Card from '../components/Card';
import Screen from '../components/Screen';
import Tag from '../components/Tag';
import { useSession } from '../lib/session';
import { colors, radius, shadow, space, type } from '../lib/theme';

/**
 * The artboard's three-tile hero: circles, bamboo, and the red dragon on an
 * accent tile, fanned by a few degrees each way.
 *
 * Hidden from assistive tech: it is decoration, and the headline beneath it
 * says what the app is. `accessibilityElementsHidden` /
 * `importantForAccessibility` cover iOS and Android; `aria-hidden` is the
 * flat prop react-native-web actually forwards (see its
 * forwardedProps/index.js — neither native prop is on that list), the same
 * way components/Button.tsx uses flat `aria-disabled`/`aria-busy` instead of
 * `accessibilityState`. Both are needed because neither covers both targets
 * on its own. The design draws each tile's lip with an inset box-shadow,
 * which React Native has no equivalent for — a bottom border is visually the
 * same thing at this size, the way DateTile already does it.
 */
function TileHero() {
  return (
    <View
      testID="welcome-hero"
      style={styles.hero}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      <View style={[styles.tile, styles.tileLeft]}>
        <Svg
          width={26}
          height={40}
          viewBox="0 0 26 40"
          fill="none"
          stroke={colors.accentColor}
          strokeWidth={2.75}
        >
          <Circle cx={13} cy={8} r={4.5} />
          <Circle cx={13} cy={20} r={4.5} />
          <Circle cx={13} cy={32} r={4.5} />
        </Svg>
      </View>
      <View style={styles.tile}>
        <Svg
          width={26}
          height={40}
          viewBox="0 0 26 40"
          fill="none"
          stroke={colors.accent2[600]}
          strokeWidth={2.75}
          strokeLinecap="round"
        >
          <Path d="M7 6v28M13 6v28M19 6v28" />
          <Path d="M4 14h6M10 14h6M16 14h6M4 26h6M10 26h6M16 26h6" />
        </Svg>
      </View>
      <View style={[styles.tile, styles.tileAccent, styles.tileRight]}>
        <Text style={styles.tileGlyph}>中</Text>
      </View>
    </View>
  );
}

/**
 * The app's front door, for a visitor with no session. `app/index.tsx` sends
 * signed-out visitors here rather than straight to `/sign-in`, which was a
 * form with no explanation of what it signs you in to.
 */
export default function Welcome() {
  const { session, loading } = useSession();
  const router = useRouter();

  // The same guard app/sign-in.tsx carries, for the same reason:
  // app/index.tsx has already unmounted by the time anyone is standing here,
  // so nothing else is watching for a session to appear.
  //
  // Redirects to "/" rather than a fixed destination: index is the one place
  // that knows whether a club invite is parked in storage (PENDING_INVITE_KEY)
  // and the member must be sent to `/join/<token>` instead of `/clubs`.
  // Hard-coding a destination here would either strand that invite or
  // duplicate index's decision.
  if (!loading && session) return <Redirect href="/" />;

  return (
    <Screen scroll contentStyle={styles.content}>
      <TileHero />

      <View>
        <Text style={styles.heading}>Your club&apos;s table, always set.</Text>
        <Text style={styles.body}>
          Find a game, keep your seat, and let the club know when you&apos;re in.
        </Text>
      </View>

      {/* The artboard fills this slot with a worked example — "Sara Lindqvist
          invited you to Riverside Mah Jongg · 42 members". Shipped literally
          that is a fabricated invitation, naming a person who does not
          exist, that a member would tap. This says the same useful thing
          about invite links and names nobody. */}
      <Card background={colors.accent2[100]} style={styles.inviteCard}>
        <Tag variant="accent2">Invites</Tag>
        <Text style={styles.inviteLead}>Got an invite link?</Text>
        <Text style={styles.inviteBody}>
          Open it on this device and you&apos;ll land straight in your club —
          no code to type.
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button
          block
          onPress={() => router.push('/sign-in')}
          accessibilityLabel="Get started"
        >
          Get started
        </Button>
        <Button
          variant="secondary"
          block
          onPress={() => router.push('/sign-in')}
          accessibilityLabel="I already have an account"
        >
          I already have an account
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space[6],
    gap: space[6],
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  tile: {
    width: 52,
    height: 70,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderBottomWidth: 5,
    borderBottomColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  tileLeft: {
    transform: [{ rotate: '-6deg' }],
  },
  tileRight: {
    transform: [{ rotate: '5deg' }],
  },
  tileAccent: {
    backgroundColor: colors.accentColor,
    borderBottomColor: colors.accent[700],
  },
  tileGlyph: {
    fontSize: 30,
    lineHeight: 34,
    color: colors.bg,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.display,
    lineHeight: 54,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    lineHeight: 28,
    color: colors.textMuted,
    marginTop: space[4],
  },
  inviteCard: {
    padding: space[4],
    gap: space[2],
    borderRadius: radius.card,
  },
  inviteLead: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  inviteBody: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    // accent2-800 on the card's accent2-100 ground. textMuted is measured
    // against bg and surface (lib/theme.test.ts), not against this one.
    color: colors.accent2[800],
  },
  actions: {
    gap: space[3],
  },
});
