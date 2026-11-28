import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import ErrorBanner from '../../components/ErrorBanner';
import DateField from '../../components/DateField';
import TimeField from '../../components/TimeField';
import ThemeArt from '../../components/night/ThemeArt';
import {
  ActionBar,
  ChipsRow,
  Segmented,
  FormCard,
  FormHeader,
  FormSection,
  FormTitle,
  SmallChip,
  StartTimeRow,
  TextRow,
  ToggleRow,
  formStyles,
} from '../../components/GameForm';
import Screen from '../../components/Screen';
import { createMahjNight, type MoneyNorm } from '../../lib/mahj-nights';
import { DEFAULT_THEME_ID, NIGHT_THEMES } from '../../lib/themes';
import { useSession } from '../../lib/session';
import { dateToDateString } from '../../lib/time';
import { colors, type } from '../../lib/theme';

const DURATIONS = [120, 180, 240];
const TABLE_CHOICES = [1, 2, 3, 4, 5];
const SET_CHOICES = [0, 1, 2, 3, 4, 5];
const MONEY_OPTIONS: { value: MoneyNorm; label: string }[] = [
  { value: 'none', label: 'No money' },
  { value: 'quarters', label: 'Quarters' },
  { value: 'host_choice', label: "Host's choice" },
];

/**
 * Host a Mahj Night (pivot batch 2): one screen, then straight to the event
 * page with Share link and Copy link. Under the hood it makes a hidden
 * group with one game (create_mahj_night), so none of this needs a group
 * first.
 */
export default function NewMahjNightScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [today] = useState(() => dateToDateString(new Date()));
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('19:00');
  const [duration, setDuration] = useState(180);
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [tables, setTables] = useState(2);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [beginners, setBeginners] = useState(true);
  const [note, setNote] = useState('');
  const [sets, setSets] = useState(1);
  const [money, setMoney] = useState<MoneyNorm>('none');
  const [moneyNote, setMoneyNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <Screen center>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const canCreate = address.trim().length > 0;

  async function onCreate() {
    if (saving) return;
    if (!canCreate) {
      setError('Add where it is.');
      return;
    }
    setError(null);
    setSaving(true);
    const { data, error: createError } = await createMahjNight({
      name,
      date,
      startTime,
      durationMinutes: duration,
      address,
      area,
      tables,
      themeId,
      beginnersWelcome: beginners,
      note,
      sets,
      money,
      moneyNote,
    });
    setSaving(false);
    if (createError || !data) {
      setError(createError ?? 'Could not create the night. Try again.');
      return;
    }
    router.replace(`/e/${data.linkToken}?created=1`);
  }

  return (
    <Screen
      scroll
      contentStyle={formStyles.body}
      footer={
        <ActionBar
          primaryLabel="Create the night"
          primaryAccessibilityLabel="Create the night"
          onPrimary={onCreate}
          busy={saving}
          disabled={!canCreate}
        />
      }
    >
      <FormHeader clubName="Mahj Night" closeLabel="Back to Home" onClose={() => router.push('/home')} />
      <View style={styles.intro}>
        <FormTitle>Host a Mahj Night</FormTitle>
        <Text style={styles.introText}>
          Pick a night and a place. You'll get a link to text your friends, and they can RSVP
          without the app.
        </Text>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <FormSection label="The night">
        <FormCard>
          <TextRow
            label="Name (optional)"
            value={name}
            onChangeText={setName}
            accessibilityLabel="Name the night"
            placeholder="Ellie's holiday Mahj Night"
          />
          <StartTimeRow>
            <DateField value={date} onChange={setDate} label="Date" minimum={today} compact />
            <TimeField value={startTime} onChange={setStartTime} label="Start time" compact />
          </StartTimeRow>
          <ChipsRow label="How long?">
            {DURATIONS.map((minutes) => (
              <SmallChip
                key={minutes}
                label={`${minutes / 60} hours`}
                selected={duration === minutes}
                onPress={() => setDuration(minutes)}
              />
            ))}
          </ChipsRow>
        </FormCard>
      </FormSection>

      <FormSection
        label="Where"
        helper="Everyone with the link sees the area. Only people who say yes see the address."
      >
        <FormCard>
          <TextRow
            label="Address"
            value={address}
            onChangeText={(v) => {
              setAddress(v);
              setError(null);
            }}
            accessibilityLabel="Address"
            placeholder="12 Oak Lane, Suwanee, GA"
          />
          <TextRow
            label="Area to show on the invite (optional)"
            value={area}
            onChangeText={(v) => setArea(v.slice(0, 40))}
            accessibilityLabel="Area to show on the invite"
            placeholder="Suwanee"
          />
        </FormCard>
      </FormSection>

      <FormSection
        label="How many tables?"
        helper={`Four players a table: ${tables * 4} seats, including you.`}
      >
        <FormCard>
          <View style={styles.chips}>
            {TABLE_CHOICES.map((n) => (
              <SmallChip
                key={n}
                label={String(n)}
                accessibilityLabel={`${n} ${n === 1 ? 'table' : 'tables'}`}
                selected={tables === n}
                onPress={() => setTables(n)}
              />
            ))}
          </View>
        </FormCard>
      </FormSection>

      <FormSection
        label="How many sets do you have?"
        helper={
          sets >= tables
            ? 'Enough for every table. Guests can say they will bring one too.'
            : `${tables - sets} more ${tables - sets === 1 ? 'set' : 'sets'} needed for ${tables} tables. Guests can offer to bring one when they RSVP.`
        }
      >
        <FormCard>
          <View style={styles.chips}>
            {SET_CHOICES.map((n) => (
              <SmallChip
                key={n}
                label={String(n)}
                accessibilityLabel={`${n} ${n === 1 ? 'set' : 'sets'}`}
                selected={sets === n}
                onPress={() => setSets(n)}
              />
            ))}
          </View>
        </FormCard>
      </FormSection>

      <FormSection
        label="Playing for money?"
        helper="Shown on the invite so nobody's surprised. MahjHero never handles money."
      >
        <Segmented options={MONEY_OPTIONS} value={money} onChange={setMoney} />
        {money === 'host_choice' ? (
          <FormCard>
            <TextRow
              label="What are you playing for?"
              value={moneyNote}
              onChangeText={(v) => setMoneyNote(v.slice(0, 60))}
              accessibilityLabel="What are you playing for?"
              placeholder="A dollar a game"
            />
          </FormCard>
        ) : null}
      </FormSection>

      <FormSection label="Theme">
        <View style={styles.themes}>
          {NIGHT_THEMES.map((t) => {
            const selected = t.id === themeId;
            return (
              <Pressable
                key={t.id}
                onPress={() => setThemeId(t.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t.name} theme`}
                aria-selected={selected}
                style={[styles.themeCard, selected && styles.themeSelected]}
              >
                <ThemeArt theme={t} height={84} style={styles.themeArt} />
                <Text style={styles.themeName}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </FormSection>

      <FormSection label="For your guests">
        <FormCard>
          <ToggleRow
            icon={null}
            title="Beginners welcome"
            helper="Shows a badge on the invite. The seating plan puts someone who can teach at each table."
            value={beginners}
            onValueChange={setBeginners}
          />
          <TextRow
            label="Note for guests (optional)"
            value={note}
            onChangeText={setNote}
            accessibilityLabel="Note for guests"
            placeholder="Parking, what to bring, house rules…"
            multiline
          />
        </FormCard>
      </FormSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  introText: {
    fontFamily: type.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[700],
    paddingHorizontal: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14 },
  themes: { flexDirection: 'row', gap: 12 },
  themeCard: {
    flex: 1,
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeSelected: { borderColor: colors.accent2[600] },
  themeArt: { borderRadius: 16 },
  themeName: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text, paddingHorizontal: 4, paddingBottom: 2 },
});
