import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import MahjongTile from '../MahjongTile';
import UnreadBadge from '../UnreadBadge';
import { ChevronRightIcon } from '../icons';
import type { Club, ClubRole } from '../../lib/clubs';
import { glyphForClub } from '../../lib/dashboard';
import { clubSubline } from '../../lib/home';
import { unreadSuffix } from '../../lib/messages';
import { colors, type } from '../../lib/theme';

/** A club row on the Clubs landing screen (Design V3 2a). 52pt glyph tile,
 *  radius 20 card, name, sub-line, unread badge and chevron. `MahjongTile`
 *  has no 52pt size of its own -- `"chip"` (48x60) is the closest existing
 *  size, used here undecorated (no `label`) rather than adding a new one. */
export default function ClubCard({
  club,
  role,
  nextStartsAt,
  unread,
  onPress,
}: {
  club: Club;
  role: ClubRole;
  nextStartsAt: string | null;
  unread: number;
  onPress: () => void;
}) {
  const subline = clubSubline(role, nextStartsAt, club.timezone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${club.name}. ${subline}${unreadSuffix(unread)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <MahjongTile suit={glyphForClub(club.id)} size="chip" />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{club.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>{subline}</Text>
      </View>
      <UnreadBadge count={unread} />
      <ChevronRightIcon size={18} color={colors.neutral[700]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80,
    backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12,
  },
  pressed: { opacity: 0.85 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  sub: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
});
