import type { ReactNode } from 'react';
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
 * and app/clubs/[id]/index.tsx ever pass for it — instead draws the club's
 * own identity: its mahjong tile sits in the top row (`clubTopRow`),
 * flanked by the back chevron and the ⊕, the same chevron-tile-plus
 * shape the messages board header uses for a club thread
 * (app/messages/club/[threadId]/index.tsx -- its own ⊕ opens a new post,
 * not a new game, but the layout is the same); a centred name pill and
 * meta line (`clubCenter`) sit below that row. venues.tsx
 * passes the club's own name as its kicker, never the literal string 'Your
 * club', so it always draws the flat shape.
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
 *
 * `titleAccessory`, only meaningful in the flat kicker/name/meta shape: an
 * optional element rendered inline immediately before `name` (e.g. the
 * clubs dashboard's own small decorative tile-before-the-title, matching
 * every other tab-root screen's inline treatment). The "Your club" shape
 * ignores it entirely -- that shape draws its own tile itself, in
 * `clubTopRow` above, so there is nothing left for a second, inline
 * accessory to add. app/clubs/index.tsx's empty-clubs-list branch is the
 * only current caller. Optional and defaulting to nothing rendered, so
 * app/clubs/[id]/index.tsx and venues.tsx -- which never pass it -- are
 * completely unaffected either way.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  titleAccessory,
  clubId,
  onPressScope,
  onPressAddGame,
  onPressBack,
}: {
  kicker: string;
  name: string;
  meta: string;
  titleAccessory?: ReactNode;
  /** The "Your club" shape's own club id -- required in practice for
   *  that shape to draw its tile (ThreadAvatar's asTile treatment needs
   *  it for the glyph hash). Ignored in the flat shape. */
  clubId?: string;
  onPressScope?: () => void;
  onPressAddGame?: () => void;
  onPressBack?: () => void;
}) {
  if (kicker === 'Your club') {
    return (
      <View style={styles.clubHeader}>
        <View style={styles.clubTopRow}>
          {/* Fixed 44x44 footprint whether or not the chevron itself
              draws, so the tile stays perfectly centred either way --
              same reasoning the ⊕'s own flanking box already used before
              this task, now applied symmetrically on both sides. */}
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
          {clubId ? (
            <ThreadAvatar kind="club" name={name} clubId={clubId} asTile size={72} />
          ) : null}
          <View style={styles.clubBack}>
            {onPressAddGame ? (
              <PlusButton onPress={onPressAddGame} accessibilityLabel="Add a game" />
            ) : null}
          </View>
        </View>
        <View style={styles.clubCenter}>
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
      {titleAccessory ? (
        <View style={styles.nameRow}>
          {titleAccessory}
          <Text style={[styles.name, styles.nameInRow]}>{name}</Text>
        </View>
      ) : (
        <Text style={styles.name}>{name}</Text>
      )}
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
  // `name`'s own `marginTop: 3` is right when it's the row's only child,
  // but doubles up oddly once it shares a row with `titleAccessory` --
  // moved onto `nameRow` itself below, so the accessory and the text stay
  // vertically centred against each other instead of the text sitting 3px
  // lower than its neighbour.
  nameInRow: {
    marginTop: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
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
