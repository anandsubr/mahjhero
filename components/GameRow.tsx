import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import MahjongTile from './MahjongTile';
import { CheckIcon, ChevronRightIcon, PeopleIcon } from './icons';
import { glyphForClub } from '../lib/dashboard';
import { formatEventTime } from '../lib/events';
import { dateColumn, gameHeadline } from '../lib/home';
import type { MyGame } from '../lib/my-games';
import { colors, radius, type } from '../lib/theme';

export function statusTag(game: MyGame): { label: string; tone: 'going' | 'hosting' | 'neutral' } {
  switch (game.myStatus) {
    case 'hosting':
      return { label: "You're hosting", tone: 'hosting' };
    case 'waitlisted':
      return {
        label: game.waitlistPosition ? `Waitlist #${game.waitlistPosition}` : 'Waitlist',
        tone: 'neutral',
      };
    case 'not':
      return { label: 'Not going', tone: 'neutral' };
    case 'invited':
      return { label: 'Invited', tone: 'hosting' };
    case 'going':
      if (game.tableLabel) return { label: game.tableLabel, tone: 'going' };
      if (game.seatingMode === 'open_seating') return { label: 'Open seating', tone: 'going' };
      return { label: "You're going", tone: 'going' };
  }
}

export function seatsLabel(game: MyGame): string {
  return game.capacity === null
    ? `${game.seatsTaken} going`
    : `${game.seatsTaken}/${game.capacity}`;
}

/**
 * One game in a list (Design V3 "shared game row"): date column, optional
 * club line, headline (title or its fallback), "time · venue", optional
 * description, tags, chevron. Used by Home's My games and, in phase 2, the
 * club Games section.
 */
export default function GameRow({
  game,
  showClub = false,
  description,
  past = false,
  last = false,
  onPress,
}: {
  game: MyGame;
  showClub?: boolean;
  description?: string | null;
  past?: boolean;
  last?: boolean;
  onPress: (game: MyGame) => void;
}) {
  const headline = gameHeadline(game.title, game.gameMode);
  const date = dateColumn(game.startsAt, game.timezone);
  const time = formatEventTime(game.startsAt, game.timezone);
  const tag = statusTag(game);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${headline}, ${game.clubName}, ${date.weekday} ${date.day} ${date.month}, ${time}`}
      onPress={() => onPress(game)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        !last && styles.divider,
        (pressed || hovered) && styles.pressed,
        past && styles.past,
      ]}
    >
      <View style={styles.dateCol} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.month}>{date.month}</Text>
        <Text style={styles.day}>{date.day}</Text>
        <Text style={styles.weekday}>{date.weekday}</Text>
      </View>

      <View style={styles.body}>
        {showClub ? (
          <View style={styles.clubLine}>
            <MahjongTile suit={glyphForClub(game.clubId)} size="mini" />
            <Text style={styles.clubName} numberOfLines={1}>{game.clubName}</Text>
          </View>
        ) : null}
        <Text style={styles.headline} numberOfLines={1}>{headline}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`${time} · ${game.venueName}`}</Text>
        {description ? (
          <Text style={styles.description} numberOfLines={1}>{description}</Text>
        ) : null}
        <View style={styles.tags}>
          <View style={[styles.pill, styles.pillNeutral]}>
            <PeopleIcon size={13} color={colors.neutral[800]} />
            <Text style={[styles.pillText, { color: colors.neutral[800] }]}>{seatsLabel(game)}</Text>
          </View>
          <View
            style={[
              styles.pill,
              tag.tone === 'going' ? styles.pillGoing
                : tag.tone === 'hosting' ? styles.pillHosting
                : styles.pillMuted,
            ]}
          >
            {tag.tone === 'going' ? <CheckIcon size={13} color={colors.accent2[800]} /> : null}
            <Text
              style={[
                styles.pillText,
                {
                  color: tag.tone === 'going' ? colors.accent2[800]
                    : tag.tone === 'hosting' ? colors.accent[800]
                    : colors.neutral[800],
                },
              ]}
            >
              {tag.label}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.chevron}>
        <ChevronRightIcon size={18} color={colors.neutral[700]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  pressed: { backgroundColor: colors.surface },
  past: { opacity: 0.6 },
  dateCol: { width: 56, alignItems: 'center' },
  month: {
    fontFamily: type.bodyBold, fontSize: 12, color: colors.accent[700],
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  day: { fontFamily: type.heading, fontSize: 30, lineHeight: 34, color: colors.text },
  weekday: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  body: { flex: 1, minWidth: 0, gap: 3 },
  clubLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clubName: { fontFamily: type.bodyBold, fontSize: 12, color: colors.text, flexShrink: 1 },
  headline: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.neutral[800] },
  description: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  pillNeutral: { backgroundColor: 'transparent', paddingHorizontal: 0 },
  pillGoing: { backgroundColor: colors.accent2[200] },
  pillHosting: { backgroundColor: colors.accent[200] },
  pillMuted: { backgroundColor: colors.neutral[300] },
  pillText: { fontFamily: type.bodyBold, fontSize: 12 },
  chevron: { width: 18, alignItems: 'center' },
});
