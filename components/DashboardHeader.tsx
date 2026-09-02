import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeftIcon, PencilIcon } from './icons';
import PlusButton from './PlusButton';
import ThreadAvatar from './ThreadAvatar';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header.
 *
 * Two shapes. The all-clubs scope and app/clubs/[id]/venues.tsx's "Venues"
 * scope draw a flat kicker/name/meta block, with no ⊕ of any kind —
 * starting a club lives in the chip row now (components/ClubChips.tsx's own
 * trailing "New club" tile), not here. The single-club scope —
 * `kicker === 'Your club'`, the one value lib/dashboard.ts's `headerScope`
 * and app/clubs/[id]/index.tsx ever pass for it — instead centres the
 * club's own identity: an avatar and a name pill, the same treatment the
 * messages board header uses for a club thread (app/messages/club/new.tsx).
 * venues.tsx passes the club's own name as its kicker, never the literal
 * string 'Your club', so it always draws the flat shape.
 *
 * `onPressScope`, only meaningful in the "Your club" shape, draws a pencil
 * beside the name and opens the club's roster, invites, venues and import —
 * management, not a form, hence "Manage", not "Edit". Omitted wherever there
 * is no destination for it: the all-clubs scope, and the two screens that
 * already render this same header for one particular club
 * (app/clubs/[id]/index.tsx, venues.tsx), where the scope IS the
 * destination. The flat branch below never reads it, so passing it there
 * has no effect — no error, no control drawn.
 *
 * `onPressAddGame`, also only meaningful in the "Your club" shape, draws the
 * top row's ⊕ — "add a game to the club currently in view", not "start a
 * new club" (that action lives in the chip row now, not here). Only
 * app/clubs/index.tsx ever passes it, gated on the same `scopeClubId` that
 * drives `onPressScope`, so a one-club member gets it too without any
 * special-casing — their header always shows this shape.
 *
 * `onPressBack`, also only meaningful in the "Your club" shape, draws a
 * chevron and is app/clubs/index.tsx's way to clear its club filter back to
 * "All clubs" — client state, not navigation. app/clubs/[id]/index.tsx
 * renders this same shape but never passes it: that screen's way back is
 * the separate ghost Button above this header
 * (2026-09-01-back-links-design.md), a real navigation rather than a filter
 * clear, so the two were kept apart rather than overloading one chevron
 * with both meanings.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  onPressScope,
  onPressAddGame,
  onPressBack,
}: {
  kicker: string;
  name: string;
  meta: string;
  onPressScope?: () => void;
  onPressAddGame?: () => void;
  onPressBack?: () => void;
}) {
  if (kicker === 'Your club') {
    return (
      <View style={styles.clubHeader}>
        {onPressBack || onPressAddGame ? (
          <View style={styles.clubTopRow}>
            {/* Fixed 44x44 footprint whether or not the chevron itself
                draws, so the ⊕ beside it stays in the same place either
                way — app/clubs/index.tsx passes both together except for a
                one-club member, who gets the ⊕ alone. */}
            <View style={styles.clubBack}>
              {onPressBack ? (
                <Pressable
                  onPress={onPressBack}
                  accessibilityRole="button"
                  accessibilityLabel="Clear club filter"
                  style={styles.clubBack}
                >
                  <ChevronLeftIcon color={colors.text} size={22} />
                </Pressable>
              ) : null}
            </View>
            {onPressAddGame ? (
              <PlusButton onPress={onPressAddGame} accessibilityLabel="Add a game" />
            ) : null}
          </View>
        ) : null}
        <View style={styles.clubCenter}>
          <ThreadAvatar kind="club" name={name} size={72} />
          {onPressScope ? (
            <Pressable
              onPress={onPressScope}
              accessibilityRole="button"
              // See this file's header comment for why the label composes
              // `meta` -- accessibilityLabel replaces the accessible name
              // react-native-web would otherwise compute from this
              // Pressable's children, so the rhythm visible in the meta
              // line below goes unheard unless it rides along here too.
              accessibilityLabel={
                meta.length > 0 ? `Manage ${name}, ${meta}` : `Manage ${name}`
              }
              style={styles.clubNamePill}
            >
              <Text numberOfLines={1} style={styles.clubNamePillText}>
                {name}
              </Text>
              <PencilIcon size={14} color={colors.accentColor} />
            </Pressable>
          ) : (
            <View style={styles.clubNamePill}>
              <Text numberOfLines={1} style={styles.clubNamePillText}>
                {name}
              </Text>
            </View>
          )}
          {meta.length > 0 ? <Text style={styles.clubMeta}>{meta}</Text> : null}
        </View>
      </View>
    );
  }

  // A View, not a fragment: these three Texts must stay one child of
  // whatever caller renders this header, or they'd inherit that caller's
  // own `gap` (every screen sets one) and spread apart instead of sitting
  // at the tight `marginTop: 3` each Text style already carries.
  return (
    <View>
      {kicker.length > 0 ? (
        <Text testID="scope-kicker" style={styles.kicker}>
          {kicker}
        </Text>
      ) : null}
      <Text style={styles.name}>{name}</Text>
      {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  clubHeader: { gap: space[3] },
  clubTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clubBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubCenter: { alignItems: 'center', gap: space[2] },
  // Same pill treatment as the messages board header's own name pill
  // (app/messages/club/new.tsx) — maxWidth, radius and padding copied
  // rather than re-derived.
  clubNamePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    maxWidth: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  clubNamePillText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  clubMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
