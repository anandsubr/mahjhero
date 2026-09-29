import { StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import GameRow from '../GameRow';
import { gameCountLabel, gameDateKey, weekBucket } from '../../lib/home';
import type { MyGame } from '../../lib/my-games';
import { colors, type } from '../../lib/theme';

const GROUPS = ['This week', 'Next week', 'Later'] as const;

/** Upcoming games grouped into Monday-start weeks (Design V3 2a, List). */
export default function MyGamesList({
  games,
  todayKey,
  onOpen,
}: {
  games: MyGame[];
  todayKey: string;
  onOpen: (game: MyGame) => void;
}) {
  const grouped = GROUPS.map((title) => ({
    title,
    rows: games.filter((g) => weekBucket(gameDateKey(g.startsAt, g.timezone), todayKey) === title),
  })).filter((g) => g.rows.length > 0);

  return (
    <View style={styles.list}>
      {grouped.map((group) => (
        <View key={group.title}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{group.title}</Text>
            <Text style={styles.count}>{gameCountLabel(group.rows.length)}</Text>
          </View>
          {group.rows.map((game, i) => (
            <GameRow
              key={game.eventId}
              game={game}
              showClub
              last={i === group.rows.length - 1}
              onPress={onOpen}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: 4, paddingBottom: 4,
  },
  title: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  count: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
});
