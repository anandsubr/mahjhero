import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import GameRow from '../GameRow';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import {
  buildMonthGrid, clubColor, dayHeading, gameCountLabel, gameDateKey, monthLabel,
} from '../../lib/home';
import type { MyGame } from '../../lib/my-games';
import { colors, radius, type } from '../../lib/theme';

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Month card + the selected day's games (Design V3 2a, Calendar). */
export default function MyGamesCalendar({
  year,
  monthIndex,
  todayKey,
  games,
  selectedKey,
  onSelect,
  onPrev,
  onNext,
  onOpen,
}: {
  year: number;
  monthIndex: number;
  todayKey: string;
  games: MyGame[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (game: MyGame) => void;
}) {
  const byDay = new Map<string, MyGame[]>();
  for (const g of games) {
    const key = gameDateKey(g.startsAt, g.timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), g]);
  }
  const grid = buildMonthGrid(year, monthIndex, todayKey);
  const dayGames = byDay.get(selectedKey) ?? [];
  const heading = dayHeading(selectedKey);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.monthRow}>
          <Text style={styles.monthLabel}>{monthLabel(year, monthIndex)}</Text>
          <View style={styles.navButtons}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={onPrev} style={styles.navButton}>
              <ChevronLeftIcon size={20} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={onNext} style={styles.navButton}>
              <ChevronRightIcon size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text key={i} style={styles.weekday}>{d}</Text>
          ))}
        </View>
        <View style={styles.grid}>
          {grid.map((cell, i) => {
            if (!cell) return <View key={`blank-${i}`} style={styles.cell} />;
            const list = byDay.get(cell.key) ?? [];
            const dots = [...new Set(list.map((g) => g.clubId))].slice(0, 3);
            const selected = cell.key === selectedKey;
            return (
              <Pressable
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={`${cell.day} ${monthLabel(year, monthIndex).split(' ')[0]}${
                  list.length ? `, ${gameCountLabel(list.length)}` : ''
                }`}
                accessibilityState={{ selected }}
                onPress={() => onSelect(cell.key)}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.circle,
                    cell.isToday && !selected && styles.today,
                    selected && styles.selected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      cell.isPast && styles.pastText,
                      list.length > 0 && styles.hasGames,
                      selected && styles.selectedText,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {dots.map((clubId) => (
                    <View key={clubId} style={[styles.dot, { backgroundColor: clubColor(clubId) }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {dayGames.length > 0 ? (
        <View>
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle} accessibilityRole="header">{heading}</Text>
            <Text style={styles.dayCount}>{gameCountLabel(dayGames.length)}</Text>
          </View>
          {dayGames.map((game, i) => (
            <GameRow
              key={game.eventId}
              game={game}
              showClub
              past={gameDateKey(game.startsAt, game.timezone) < todayKey}
              last={i === dayGames.length - 1}
              onPress={onOpen}
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{`Nothing on ${heading}.`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  monthLabel: { fontFamily: type.heading, fontSize: 20, color: colors.text },
  navButtons: { flexDirection: 'row', gap: 4 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  weekday: {
    flex: 1, textAlign: 'center', fontFamily: type.bodyBold, fontSize: 12, color: colors.neutral[700],
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.accentColor },
  selected: { backgroundColor: colors.accent[700] },
  dayNum: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  pastText: { color: colors.neutral[600] },
  hasGames: { fontFamily: type.bodyBold },
  selectedText: { color: '#fff' },
  dots: { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: 4, paddingBottom: 4,
  },
  dayTitle: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  dayCount: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
  empty: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.neutral[400],
    borderRadius: 20, padding: 20, alignItems: 'center',
  },
  emptyText: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.neutral[700] },
});
