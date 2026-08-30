import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import { MAX_ROSTER_ROWS, importRoster, parseRoster } from '../../../lib/clubs';
import type { RosterError, RosterRow } from '../../../lib/clubs';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function ImportRosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [errors, setErrors] = useState<RosterError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Every state below carries the tab bar, the same rule
  // app/clubs/[id]/index.tsx and app/clubs/[id]/venues.tsx already follow:
  // TabBar navigates with router.replace off an entry route that is itself
  // a <Redirect>, so the history stack is typically one deep, and a state
  // with no bar strands a host with no way out but relaunching the app. The
  // <Redirect> branch below is the deliberate exception -- it renders
  // nothing, and a signed-out visitor belongs at sign-in, not in a tab bar.
  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  function onPreview() {
    setError(null);
    const result = parseRoster(csv);
    setRows(result.rows);
    setErrors(result.errors);
  }

  async function onImport() {
    if (!session || !id || !rows || importing) return;
    setError(null);
    setImporting(true);
    const { created, error: importError } = await importRoster(id, rows);
    setImporting(false);
    if (importError) {
      setError(importError);
      return;
    }
    router.replace(`/clubs/${id}?imported=${created}`);
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      {/*
        Kept, not dropped: this goes to /clubs/${id}, a specific club, which
        is a different destination from the Club tab's own /clubs (see
        app/clubs/[id]/venues.tsx's identical "Back to the club" button for
        the same reasoning, and app/clubs/[id]/index.tsx for the contrasting
        case where a back link WAS dropped because its destination and the
        tab's were the same place).
      */}
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${id}`)}
        accessibilityLabel="Back to the club"
      >
        Club
      </Button>

      <Text style={styles.heading}>Import a roster</Text>
      <Text style={styles.help}>
        Paste your spreadsheet, including the header row. It needs an email
        column; name and skill are used if present. Up to {MAX_ROSTER_ROWS}{' '}
        people at a time.
      </Text>

      <TextField
        label="Roster"
        value={csv}
        onChangeText={(value) => {
          setCsv(value);
          setRows(null);
          setErrors([]);
        }}
        placeholder={'name,email,skill\nJane Doe,jane@example.com,beginner'}
        multiline
        accessibilityLabel="Roster CSV"
      />

      <Button
        variant="secondary"
        onPress={onPreview}
        disabled={csv.trim().length === 0}
        accessibilityLabel="Check the file"
      >
        Check the file
      </Button>

      {rows !== null ? (
        <>
          <Text style={styles.sectionTitle}>
            {rows.length} {rows.length === 1 ? 'person' : 'people'} ready
            {errors.length > 0
              ? `, ${errors.length} ${errors.length === 1 ? 'row' : 'rows'} skipped`
              : ''}
          </Text>

          {rows.map((row) => (
            <Card key={row.email}>
              <Text style={styles.name}>
                {row.display_name.trim().length > 0 ? row.display_name : row.email}
              </Text>
              <Text style={styles.help}>
                {row.email}
                {row.skill_level ? ` · ${row.skill_level}` : ''}
              </Text>
            </Card>
          ))}

          {errors.map((rowError) => (
            <Card key={`error-${rowError.row}`}>
              {/*
                Row 0 is the sentinel for a whole-file problem (empty paste,
                too many rows) rather than a specific line, so it renders
                without the "Row 0:" prefix a spreadsheet has no counterpart
                for.
              */}
              <Text style={styles.rowError}>
                {rowError.row > 0
                  ? `Row ${rowError.row}: ${rowError.message}`
                  : rowError.message}
              </Text>
            </Card>
          ))}

          {rows.length > 0 ? (
            <Button
              onPress={onImport}
              disabled={importing}
              accessibilityLabel={`Invite these ${rows.length} people`}
            >
              {importing ? 'Importing…' : `Invite these ${rows.length} people`}
            </Button>
          ) : null}
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[4],
  },
  centered: {
    alignItems: 'center',
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  rowError: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
});
