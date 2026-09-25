import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import TextField from './TextField';
import Toggle from './Toggle';
import { MapPinIcon, PlusIcon, XIcon } from './icons';
import { createVenue, searchVenues, type VenueMatch } from '../lib/venues';
import { colors, radius, shadow, space, type } from '../lib/theme';

type VenuePickerProps = {
  clubId: string;
  /** The selected venue id, or null when nothing is chosen yet. */
  value: string | null;
  /** Its name, so the field can show a selection without a second fetch. */
  valueName: string;
  onChange: (venueId: string, venueName: string) => void;
  disabled?: boolean;
  /**
   * `row`: the game form's borderless card row (pin icon, a small label
   * over a plain input) instead of the full-width labelled pill. Search
   * results and the add-a-venue form render under it the same way.
   */
  variant?: 'field' | 'row';
  /** Heads the own-club group ("Test Club venues"); "This club" without. */
  clubName?: string;
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
  variant = 'field',
  clubName,
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
      {variant === 'row' ? (
        <View style={styles.row}>
          <MapPinIcon size={18} color={colors.accent2[700]} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Venue</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              editable={!disabled}
              accessibilityLabel="Venue"
              placeholder="Where are you playing?"
              placeholderTextColor={colors.neutral[600]}
              style={styles.rowInput}
            />
          </View>
          {query.length > 0 && !disabled ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear venue"
              style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
            >
              <XIcon size={16} color={colors.neutral[800]} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <TextField
          label="Venue"
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
          accessibilityLabel="Venue"
          placeholder="Where are you playing?"
        />
      )}

      {showResults ? (
        <View style={styles.results} testID="venue-results">
          {own.length > 0 ? (
            <>
              <Text style={styles.resultsGroup}>
                {clubName ? `${clubName} venues` : 'This club'}
              </Text>
              {own.map((match) => (
                <VenueRow key={match.id} match={match} query={trimmed} onPress={() => select(match)} />
              ))}
            </>
          ) : null}

          {shared.length > 0 ? (
            <>
              <Text style={styles.resultsGroup}>Public venues</Text>
              {shared.map((match) => (
                <VenueRow key={match.id} match={match} query={trimmed} onPress={() => select(match)} />
              ))}
            </>
          ) : null}

          {own.length + shared.length > 0 ? <View style={styles.resultsDivider} /> : null}

          <Pressable
            onPress={startAdding}
            accessibilityRole="button"
            accessibilityLabel={`Add “${trimmed}”`}
            style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
          >
            <View style={styles.addBadge}>
              <PlusIcon size={18} color={colors.accent[600]} />
            </View>
            <View style={styles.resultText}>
              <Text numberOfLines={1} style={styles.addTitle}>{`Add “${trimmed}”`}</Text>
              <Text style={styles.resultMeta}>Save as a new venue for this club</Text>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** "Used for 3 games", else where it is, else nothing to say yet. */
function venueMeta(match: VenueMatch): string {
  const count = match.game_count ?? 0;
  if (count > 0) return `Used for ${count} ${count === 1 ? 'game' : 'games'}`;
  const place = [match.address_line, match.locality].filter(Boolean).join(', ');
  return place || 'No games here yet';
}

/** A match, with the typed text picked out in the name. */
function VenueRow({
  match,
  query,
  onPress,
}: {
  match: VenueMatch;
  query: string;
  onPress: () => void;
}) {
  const at = match.name.toLowerCase().indexOf(query.toLowerCase());
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={match.name}
      style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
    >
      <View style={styles.pinBadge}>
        <MapPinIcon size={18} color={colors.accent2[700]} />
      </View>
      <View style={styles.resultText}>
        <Text numberOfLines={1} style={styles.resultName}>
          {at < 0 ? (
            match.name
          ) : (
            <>
              {match.name.slice(0, at)}
              <Text style={styles.resultMatch}>{match.name.slice(at, at + query.length)}</Text>
              {match.name.slice(at + query.length)}
            </>
          )}
        </Text>
        <Text numberOfLines={1} style={styles.resultMeta}>
          {venueMeta(match)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  rowInput: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 2,
    backgroundColor: 'transparent',
    outlineStyle: 'none' as never,
  },
  clear: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearPressed: { backgroundColor: colors.neutral[400] },
  results: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: colors.bg,
    ...shadow.md,
  },
  resultsGroup: {
    fontFamily: type.bodyBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[700],
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  resultRowPressed: { backgroundColor: colors.surface },
  pinBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent2[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { flex: 1, minWidth: 0, gap: 1 },
  resultName: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
  resultMatch: { fontFamily: type.bodyBold, color: colors.accent[700] },
  resultMeta: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  addTitle: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
  resultsDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginHorizontal: 16,
    marginVertical: 6,
  },
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
