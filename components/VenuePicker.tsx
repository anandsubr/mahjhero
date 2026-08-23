import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import TextField from './TextField';
import Toggle from './Toggle';
import { createVenue, searchVenues, type VenueMatch } from '../lib/venues';
import { colors, space, type } from '../lib/theme';

type VenuePickerProps = {
  clubId: string;
  /** The selected venue id, or null when nothing is chosen yet. */
  value: string | null;
  /** Its name, so the field can show a selection without a second fetch. */
  valueName: string;
  onChange: (venueId: string, venueName: string) => void;
  disabled?: boolean;
};

/**
 * Select-or-create over the venue master.
 *
 * "Add <what you typed>" is offered whenever the query is non-empty, NOT
 * only when nothing matches. A host adding a second, similarly-named hall is
 * exactly the person who needs it, and hiding it behind "no results" is
 * hiding it from them.
 *
 * The sharing switch defaults OFF and carries a caption saying what turning
 * it on means. A great deal of mahjong is played in members' homes, and a
 * venue master built with future public discovery in mind must not publish
 * "Marie's place, 42 Elm Street" as a side effect of someone scheduling
 * Tuesday's game. There is deliberately no un-publish path once another club
 * has started using a shared venue, so this default is the only guard.
 */
export default function VenuePicker({
  clubId,
  value: _value,
  valueName,
  onChange,
  disabled,
}: VenuePickerProps) {
  const [query, setQuery] = useState(valueName);
  const [matches, setMatches] = useState<VenueMatch[]>([]);
  const [adding, setAdding] = useState(false);
  const [addressLine, setAddressLine] = useState('');
  const [locality, setLocality] = useState('');
  const [sharePublicly, setSharePublicly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const showResults =
    !disabled && !adding && trimmed.length > 0 && trimmed !== valueName;

  useEffect(() => {
    if (!showResults) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    // Debounced: a typeahead that fires per keystroke turns a three-letter
    // hall name into three round trips and renders them out of order.
    const timer = setTimeout(() => {
      searchVenues(clubId, trimmed).then((result) => {
        if (!cancelled) setMatches(result ?? []);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clubId, trimmed, showResults]);

  function select(match: VenueMatch) {
    setQuery(match.name);
    setMatches([]);
    onChange(match.id, match.name);
  }

  function startAdding() {
    setError(null);
    setAdding(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await createVenue({
      clubId,
      name: trimmed,
      addressLine: addressLine.trim() || undefined,
      locality: locality.trim() || undefined,
      sharePublicly,
    });
    setSaving(false);

    if (result.error || !result.venueId) {
      // lib/venues.ts never rejects — a failure comes back as { error }, so
      // that string (already tailored for the duplicate-name case) is what
      // gets shown, not a message invented here.
      setError(result.error ?? 'Could not save this venue.');
      return;
    }
    setAdding(false);
    setMatches([]);
    onChange(result.venueId, trimmed);
  }

  const own = matches.filter((m) => m.is_own_club);
  const shared = matches.filter((m) => !m.is_own_club);

  if (adding) {
    return (
      <Card>
        <Text style={styles.groupLabel}>New venue</Text>
        <Text style={styles.name}>{trimmed}</Text>
        <TextField
          label="Address (optional)"
          value={addressLine}
          onChangeText={setAddressLine}
          accessibilityLabel="Address"
        />
        <TextField
          label="Town or city (optional)"
          value={locality}
          onChangeText={setLocality}
          accessibilityLabel="Town or city"
        />
        <View style={styles.shareRow}>
          <Toggle
            value={sharePublicly}
            onValueChange={setSharePublicly}
            accessibilityLabel="Other clubs can use this venue"
          />
          <Text style={styles.help}>
            Other clubs can use this venue. Leave this off for a home or
            anywhere private — once another club starts using a shared venue,
            it cannot be made private again.
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button onPress={save} loading={saving} accessibilityLabel="Save venue">
          Save venue
        </Button>
        <Button
          variant="ghost"
          onPress={() => setAdding(false)}
          accessibilityLabel="Cancel adding a venue"
        >
          Cancel
        </Button>
      </Card>
    );
  }

  return (
    <View>
      <TextField
        label="Venue"
        value={query}
        onChangeText={setQuery}
        editable={!disabled}
        accessibilityLabel="Venue"
        placeholder="Where are you playing?"
      />

      {showResults ? (
        <Card>
          {own.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>This club</Text>
              {own.map((match) => (
                <Button
                  key={match.id}
                  variant="ghost"
                  bodyFace
                  onPress={() => select(match)}
                  accessibilityLabel={match.name}
                >
                  {match.name}
                </Button>
              ))}
            </>
          ) : null}

          {shared.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Public venues</Text>
              {shared.map((match) => (
                <Button
                  key={match.id}
                  variant="ghost"
                  bodyFace
                  onPress={() => select(match)}
                  accessibilityLabel={match.name}
                >
                  {match.name}
                </Button>
              ))}
            </>
          ) : null}

          <Button
            variant="secondary"
            onPress={startAdding}
            accessibilityLabel={`Add “${trimmed}”`}
          >
            {`Add “${trimmed}”`}
          </Button>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
    marginTop: space[3],
  },
  name: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    marginVertical: space[4],
  },
  help: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[700],
    marginBottom: space[3],
  },
});
