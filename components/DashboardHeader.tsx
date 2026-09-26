import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import CompactHeader from './CompactHeader';
import { colors, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header.
 *
 * Two shapes. The all-clubs scope and app/clubs/[id]/venues.tsx's "Venues"
 * scope draw a flat kicker/name/meta block, with no ⊕ of any kind —
 * starting a club lives in the chip row now (components/ClubChips.tsx's own
 * trailing "New club" tile), not here. The single-club scope —
 * `kicker === 'Your club'`, the one value lib/dashboard.ts's `headerScope`
 * and app/clubs/[id]/index.tsx ever pass for it — instead draws the club's
 * own identity in the compact one-row header (components/CompactHeader.tsx)
 * the conversation screens and the club board use: chevron, the club's
 * tile, its name over its rhythm, and the ⊕. venues.tsx
 * passes the club's own name as its kicker, never the literal string 'Your
 * club', so it always draws the flat shape.
 *
 * `onPressScope`, only meaningful in the "Your club" shape, makes the name
 * tappable, with a pencil beside it, and opens the club's roster, invites, venues and import —
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
 * `onPressBack`, also only meaningful in the "Your club" shape, draws the
 * top row's chevron -- and the chevron now does double duty rather than
 * meaning one fixed thing everywhere. app/clubs/index.tsx passes it to clear
 * its club filter back to "All clubs" — client state, not navigation, with
 * `backLabel` left at its default "Clear club filter". app/clubs/[id]/index.tsx
 * and the game screen (app/clubs/[id]/events/[eventId]/index.tsx) both pass
 * it as real navigation instead, each with `backLabel="Back to your clubs"`
 * — there is no separate ghost Button any more; the chevron is that screen's
 * only way back.
 *
 * `titleAccessory`, only meaningful in the flat kicker/name/meta shape: an
 * optional element rendered inline immediately before `name` (e.g. the
 * clubs dashboard's own small decorative tile-before-the-title, matching
 * every other tab-root screen's inline treatment). The "Your club" shape
 * ignores it entirely -- that shape draws its own tile itself, in
 * its compact header, so there is nothing left for a second, inline
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
  backLabel = 'Clear club filter',
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
  /** Accessibility label for the chevron `onPressBack` draws. Defaults to
   *  today's "Clear club filter" (app/clubs/index.tsx's own filter-clear
   *  chevron) — app/clubs/[id]/index.tsx passes "Back to your clubs"
   *  instead, since its own chevron is real navigation, not a filter
   *  clear, and the hardcoded label would misdescribe it. */
  backLabel?: string;
}) {
  if (kicker === 'Your club') {
    // The compact one-row header the conversation screens use: chevron,
    // the club's tile, its name (tap to manage, with a pencil) over its
    // rhythm, and the ⊕ on the right.
    return (
      <CompactHeader
        variant="inset"
        onBack={onPressBack}
        backLabel={backLabel}
        kind="club"
        clubId={clubId}
        avatarTestID={clubId ? 'thread-avatar-club-tile' : undefined}
        title={name}
        subtitle={meta.length > 0 ? meta : null}
        onOpenDetails={onPressScope}
        // accessibilityLabel replaces the accessible name react-native-web
        // would otherwise compute from the children, so the rhythm in the
        // subtitle goes unheard unless it rides along here too.
        detailsLabel={meta.length > 0 ? `Manage ${name}, ${meta}` : `Manage ${name}`}
        detailsHint="pencil"
        action={
          onPressAddGame
            ? { icon: 'plus', label: 'Add a game', onPress: onPressAddGame }
            : undefined
        }
      />
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
});
