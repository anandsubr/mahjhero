import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import { importRoster, parseRoster } from '../../../lib/clubs';
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

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
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
    const { created, error: importError } = await importRoster(
      id,
      session.user.id,
      rows,
    );
    setImporting(false);
    if (importError) {
      setError(importError);
      return;
    }
    router.replace(`/clubs/${id}?imported=${created}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
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
        column; name and skill are used if present.
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
              <Text style={styles.rowError}>
                Row {rowError.row}: {rowError.message}
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
