import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import {
  MAX_ROSTER_ROWS,
  importRoster,
  parseRoster,
  sendClubInviteEmail,
} from '../../../lib/clubs';
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

  // The <Redirect> branch below is the deliberate exception among these
  // early returns -- it renders nothing, and a signed-out visitor belongs at
  // sign-in.
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
    const { invites, error: importError } = await importRoster(id, rows);
    if (importError) {
      setImporting(false);
      setError(importError);
      return;
    }
    // Capped at 5 concurrent sends rather than one unbounded Promise.all --
    // a roster can be up to MAX_ROSTER_ROWS (500) rows, and 500 simultaneous
    // SMTP connections would very likely get throttled or blocked by the
    // relay (see _shared/smtp.ts's own docstring on connection-attempt
    // throttling). Failures are intentionally not surfaced per-row here --
    // the organizer's invite list (with its per-row "Resend invite email"
    // action) is the recovery path, matching how a single failed send is
    // already handled on the other two invite screens.
    const CONCURRENCY = 5;
    for (let i = 0; i < invites.length; i += CONCURRENCY) {
      await Promise.all(
        invites.slice(i, i + CONCURRENCY).map((invite) => sendClubInviteEmail(invite.id)),
      );
    }
    setImporting(false);
    router.replace(`/clubs/${id}/members?imported=${invites.length}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      {/*
        Back to Club settings, the only way into this screen: popping when
        there is history returns to that same settings screen rather than
        stacking a second copy; a cold open (a URL, a reload) replaces.
      */}
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(`/clubs/${id}/settings`)
        }
        accessibilityLabel="Back to club settings"
      >
        Club settings
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
