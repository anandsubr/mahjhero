import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PencilIcon, PersonIcon, PlusIcon } from './icons';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header: scope on the left, the member on the
 * right.
 *
 * The artboard draws a chevron beside the kicker, tapping through to a
 * separate "Your clubs" screen. This screen used to keep that list on itself,
 * so the chevron had nowhere to go and was not drawn — an affordance that
 * does nothing is worse than none. The club list is now the chip row alone,
 * and the way into a club is this header, so the glyph has a destination
 * again: `onPressScope` opens the club currently in scope.
 *
 * It is a pencil, not the artboard's chevron. The destination is the club's
 * roster, invites, venues and import — management — and a chevron says only
 * "somewhere else". "Manage", not "Edit", for the same reason: there is no
 * single form behind it.
 *
 * Both call-to-action props below are optional. `onPressScope` goes missing
 * whenever there is no single club to open into — the all-clubs scope, where
 * there is nothing single to open, and the two screens that already render
 * this same header for one particular club, `app/clubs/[id]/index.tsx` and
 * `app/clubs/[id]/venues.tsx`, where the scope IS the destination rather
 * than a link to it. `onPressNew` goes missing at those same two screens for
 * a different reason: there is no club list there to add to. See each
 * prop's own comment below for what its control actually draws.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  initials,
  onPressAvatar,
  onPressNew,
  onPressScope,
}: {
  kicker: string;
  name: string;
  meta: string;
  initials: string;
  onPressAvatar: () => void;
  /** Draws the "start a club" control. Omitted where there is no club list
   *  to add to — the club detail and venues screens render this same header. */
  onPressNew?: () => void;
  onPressScope?: () => void;
}) {
  const scope = (
    <>
      <View style={styles.kickerRow}>
        {kicker.length > 0 ? (
          <Text testID="scope-kicker" style={styles.kicker}>
            {kicker}
          </Text>
        ) : null}
        {onPressScope ? (
          <View testID="scope-glyph">
            <PencilIcon size={14} color={colors.accentColor} />
          </View>
        ) : null}
      </View>
      <Text style={styles.name}>{name}</Text>
      {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
    </>
  );

  return (
    <View style={styles.row}>
      {onPressScope ? (
        <Pressable
          onPress={onPressScope}
          accessibilityRole="button"
          // The name, not the kicker: "Manage Riverside Mah Jongg" says what
          // this acts on, where "Manage Your club" says nothing. See this
          // file's header comment for why the label has to carry it — aria-label
          // replaces the name computed from the children below, so a screen
          // reader never hears the club name from the <Text> itself. The
          // same replacement swallows `meta` (the club's rhythm, e.g.
          // "Thursday evenings"): it is visible right below the name, but
          // without it in the label a VoiceOver user would hear the name and
          // nothing else, while the all-clubs scope (a plain View, no label
          // override) still reads its meta normally. So the label composes
          // both, guarding on the same `meta.length > 0` the visible <Text>
          // below already uses — an empty rhythm gets no trailing comma.
          accessibilityLabel={
            meta.length > 0 ? `Manage ${name}, ${meta}` : `Manage ${name}`
          }
          style={styles.scope}
        >
          {scope}
        </Pressable>
      ) : (
        <View style={styles.scope}>{scope}</View>
      )}
      <View style={styles.actions}>
        {onPressNew ? (
          <Pressable
            onPress={onPressNew}
            accessibilityRole="button"
            accessibilityLabel="Start a club"
            style={styles.newClub}
          >
            <PlusIcon size={24} color={colors.text} />
          </Pressable>
        ) : null}
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
  // The kicker and its glyph sit on one line. A plain <Text> cannot hold
  // the icon without the icon inheriting text layout, so the row is a View
  // and the kicker keeps its own type styles. The glyph is a pencil now —
  // see this file's header comment for why it stopped being a chevron.
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
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
  // The header's right-hand controls. `flexShrink: 0` so a long club name in
  // the scope block on the left cannot squeeze them — `scope` is the flexible
  // half, these are fixed.
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 0,
    gap: space[2],
  },
  // The avatar's shape, outlined rather than filled: it sits beside the
  // avatar and must not read as a second member. textMuted for the boundary
  // — #676158 on the page background measures 5.15:1 (lib/theme.ts records
  // the ratio), past the 3:1 a control boundary needs.
  newClub: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
