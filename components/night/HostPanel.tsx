import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Button from '../Button';
import { ConfirmSheet } from '../GameForm';
import {
  copyEventLink,
  resetNightLink,
  setNightLinkEnabled,
  shareEventLink,
  type EventPage,
  type RsvpStatus,
} from '../../lib/mahj-nights';
import { colors, type } from '../../lib/theme';

const GROUPS: { status: RsvpStatus; label: string }[] = [
  { status: 'going', label: 'Going' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'no', label: "Can't go" },
];

/**
 * What only the host sees on the event page: Share link and Copy link, the
 * full guest list with the beginner count, and the link's off and reset
 * switches. Editing the night itself is the normal Edit game form.
 */
export default function HostPanel({
  page,
  token,
  created,
  onEdit,
  onOpenGame,
  onLinkChanged,
}: {
  page: EventPage;
  token: string;
  created: boolean;
  onEdit: () => void;
  onOpenGame: () => void;
  onLinkChanged: (nextToken: string | null) => void;
}) {
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const rsvps = page.rsvps ?? [];
  const enabled = page.link_enabled !== false;

  async function onShare() {
    const result = await shareEventLink(page.title, token);
    setShareNote(result === 'copied' ? 'Link copied. Paste it into a text.' : result === 'failed' ? null : null);
  }
  async function onCopy() {
    const ok = await copyEventLink(token);
    setShareNote(ok ? 'Link copied.' : 'Could not copy the link.');
  }
  async function onToggleLink() {
    if (!page.club_id || busy) return;
    setBusy(true);
    const ok = await setNightLinkEnabled(page.club_id, !enabled);
    setBusy(false);
    if (ok) onLinkChanged(null);
  }
  async function onReset() {
    if (!page.club_id || busy) return;
    setBusy(true);
    const fresh = await resetNightLink(page.club_id);
    setBusy(false);
    setConfirmReset(false);
    if (fresh) onLinkChanged(fresh);
  }

  return (
    <View style={styles.wrap} testID="host-panel">
      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">
          {created ? 'Your night is ready' : 'Invite people'}
        </Text>
        <Text style={styles.body}>
          {enabled
            ? 'Send this link to your friends. They can RSVP without the app.'
            : 'The link is off. Nobody can open the invite until you turn it back on.'}
        </Text>
        {enabled ? (
          <View style={styles.row}>
            <Button big={false} onPress={onShare} accessibilityLabel="Share link">
              Share link
            </Button>
            <Button variant="secondary" big={false} onPress={onCopy} accessibilityLabel="Copy link">
              Copy link
            </Button>
          </View>
        ) : null}
        {shareNote ? (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {shareNote}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">
          Guest list
        </Text>
        <Text style={styles.body}>
          {`${page.going_count} going, you included · ${page.seats} seats`}
          {page.beginner_count ? ` · ${page.beginner_count} new to mahjong` : ''}
        </Text>
        {rsvps.length === 0 ? (
          <Text style={styles.body}>No RSVPs yet.</Text>
        ) : (
          GROUPS.map((g) => {
            const people = rsvps.filter((r) => r.status === g.status);
            if (people.length === 0) return null;
            return (
              <View key={g.status} style={styles.group}>
                <Text style={styles.groupLabel}>{`${g.label} (${people.length})`}</Text>
                {people.map((r) => (
                  <View key={r.id} style={styles.person}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {r.name}
                      {r.is_beginner ? <Text style={styles.tag}>{'  New'}</Text> : null}
                    </Text>
                    <Text style={styles.personEmail} numberOfLines={1}>
                      {r.email}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })
        )}
      </View>

      <View style={styles.row}>
        <Button variant="secondary" big={false} onPress={onEdit} accessibilityLabel="Edit the night">
          Edit the night
        </Button>
        <Button variant="secondary" big={false} onPress={onOpenGame} accessibilityLabel="Open the game">
          Open the game
        </Button>
      </View>
      <View style={styles.row}>
        <Button variant="ghost" big={false} onPress={onToggleLink} disabled={busy} accessibilityLabel={enabled ? 'Turn off link' : 'Turn link back on'}>
          {enabled ? 'Turn off link' : 'Turn link back on'}
        </Button>
        <Button variant="ghost" big={false} onPress={() => setConfirmReset(true)} disabled={busy} accessibilityLabel="Reset link">
          Reset link
        </Button>
      </View>

      {confirmReset ? (
        <ConfirmSheet
          title="Reset the link?"
          body="The old link stops working, including guests' saved links. Everyone keeps their RSVP, but you'll need to send the new link again."
          confirmLabel="Reset link"
          cancelLabel="Keep this link"
          onConfirm={onReset}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 10 },
  heading: { fontFamily: type.heading, fontSize: 22, color: colors.text },
  body: { fontFamily: type.bodyRegular, fontSize: 14, lineHeight: 20, color: colors.neutral[700] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  group: { gap: 6, paddingTop: 4 },
  groupLabel: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  person: { gap: 1 },
  personName: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
  personEmail: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  tag: { fontFamily: type.bodyBold, fontSize: 12, color: colors.accent2[700] },
});
