import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import TextField from '../../components/TextField';
import { ChevronLeftIcon } from '../../components/icons';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  addGreeting,
  deleteGreeting,
  fetchGreetings,
  updateGreeting,
  type Greeting,
} from '../../lib/greetings';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

/**
 * The admin-only screen behind Profile's "Greetings" card
 * (app/profile.tsx), gated there on `profile.is_admin` — this screen
 * itself does not re-check that flag, since RLS (greetings_admin_write,
 * 20260903090000_create_greetings.sql) is the real backstop: a non-admin
 * who navigates here directly gets a clean, worded refusal from `addGreeting`
 * etc. rather than a silently-broken form.
 */
export default function AdminGreetingsScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [greetings, setGreetings] = useState<Greeting[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // The one greeting currently open for editing, if any -- only one at a
  // time, matching this screen's own single add-field affordance below.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    const result = await fetchGreetings();
    setGreetings(result);
    if (result === null) setError(GENERIC_ERROR);
    setReady(true);
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  async function onAdd() {
    if (busyRef.current || newText.trim().length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await addGreeting(newText.trim());
    if (refusal) {
      setError(refusal);
    } else {
      setNewText('');
      await load();
    }
    busyRef.current = false;
    setBusy(false);
  }

  async function onDelete(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await deleteGreeting(id);
    if (refusal) setError(refusal);
    else await load();
    busyRef.current = false;
    setBusy(false);
  }

  function onStartEdit(g: Greeting) {
    setEditingId(g.id);
    setEditText(g.text);
  }

  function onCancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function onSaveEdit() {
    if (busyRef.current || !editingId || editText.trim().length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: refusal } = await updateGreeting(editingId, editText.trim());
    if (refusal) {
      setError(refusal);
    } else {
      setEditingId(null);
      setEditText('');
      await load();
    }
    busyRef.current = false;
    setBusy(false);
  }

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="profile" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/profile')}
        accessibilityLabel="Back to profile"
        style={styles.backButton}
      >
        Profile
      </Button>

      <Text style={styles.heading}>Greetings</Text>
      <Text style={styles.intro}>
        Shown once per day at the top of the Dashboard. Use {'{name}'} anywhere
        you want the signed-in member's own name.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : (
        (greetings ?? []).map((g) =>
          editingId === g.id ? (
            <Card key={g.id} style={styles.row}>
              <TextField
                label="Edit greeting text"
                value={editText}
                onChangeText={setEditText}
              />
              <View style={styles.editActions}>
                <Button variant="secondary" big={false} disabled={busy} onPress={() => void onSaveEdit()}>
                  Save
                </Button>
                <Button variant="ghost" big={false} disabled={busy} onPress={onCancelEdit}>
                  Cancel
                </Button>
              </View>
            </Card>
          ) : (
            <Card key={g.id} row style={styles.row}>
              <Text style={styles.greetingText}>{g.text}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${g.text}`}
                disabled={busy}
                onPress={() => onStartEdit(g)}
              >
                <Text style={styles.edit}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${g.text}`}
                disabled={busy}
                onPress={() => void onDelete(g.id)}
              >
                <Text style={styles.remove}>Delete</Text>
              </Pressable>
            </Card>
          ),
        )
      )}

      <TextField
        label="New greeting"
        value={newText}
        onChangeText={setNewText}
        placeholder="Ready to shuffle, {name}?"
      />
      <Button variant="secondary" disabled={busy} onPress={() => void onAdd()}>
        Add
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h1,
    color: colors.text,
  },
  intro: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  row: { alignItems: 'center', gap: space[3] },
  greetingText: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  edit: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
  remove: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
  editActions: {
    flexDirection: 'row',
    gap: space[2],
  },
});
