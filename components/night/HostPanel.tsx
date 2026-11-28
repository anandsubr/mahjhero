import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Button from '../Button';
import { ConfirmSheet } from '../GameForm';
import {
  copyEventLink,
  resetNightLink,
  setNightLinkEnabled,
  setRsvpTable,
  setsWarning,
  shareEventLink,
  type EventPage,
  type HostRsvp,
  type StoredRsvpStatus,
} from '../../lib/mahj-nights';
import { colors, type } from '../../lib/theme';

const GROUPS: { status: StoredRsvpStatus; label: string }[] = [
  { status: 'going', label: 'Going' },
  { status: 'waitlist', label: 'Waitlist' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'no', label: "Can't go" },
];

function tags(r: HostRsvp): string {
  return [
    r.is_beginner ? 'New' : r.can_teach ? 'Can teach' : '',
    r.brings_set ? 'Bringing a set' : '',
    r.has_card ? 'Has the card' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

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
  const hostSets = page.host_sets ?? 0;
  const guestSets = page.guest_sets ?? 0;
  const sets = hostSets + guestSets;
  const warning = setsWarning(page.going_count, page.tables, sets);

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
          {page.teacher_count ? ` · ${page.teacher_count} can teach` : ''}
        </Text>
        <Text style={styles.body} testID="host-sets">
          {`Sets: ${sets} (${hostSets} yours, ${guestSets} from guests)`}
          {page.card_count ? ` · ${page.card_count} with this year's card` : ''}
        </Text>
        {warning ? (
          <Text style={styles.warning} accessibilityLiveRegion="polite">
            {warning}
          </Text>
        ) : null}
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
                      {r.status === 'going' && r.table ? (
                        <Text style={styles.tag}>{`  Table ${r.table}`}</Text>
                      ) : null}
                    </Text>
                    {tags(r) ? <Text style={styles.personTags}>{tags(r)}</Text> : null}
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

      <SeatingPlan page={page} onChanged={() => onLinkChanged(null)} />

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
  personTags: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.accent2[700] },
  warning: { fontFamily: type.bodyBold, fontSize: 14, lineHeight: 20, color: colors.accent[700] },
  tableBlock: { gap: 6, paddingTop: 6 },
  tableHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tableName: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  seatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seat: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.bg,
    justifyContent: 'center',
  },
  seatSelected: { backgroundColor: colors.accent2[600] },
  seatText: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text },
  seatTextSelected: { color: colors.neutral[100] },
  tag: { fontFamily: type.bodyBold, fontSize: 12, color: colors.accent2[700] },
});

/**
 * The suggested seating (pivot batch 2b): who sits where, from
 * supabase/functions/_shared/seating.ts. Tap a guest, then "Move here" on
 * another table; a guest the host moved stays put (marked "moved") until
 * "Back to the plan". This plan is for the night itself -- signed-in
 * guests still pick their own seat on the game screen.
 */
function SeatingPlan({ page, onChanged }: { page: EventPage; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const going = (page.rsvps ?? []).filter((r) => r.status === 'going' && r.table);
  const caps = page.table_capacities ?? [];
  if (caps.length === 0) return null;
  const chosen = going.find((r) => r.id === selected) ?? null;

  async function move(table: number | null) {
    if (!chosen || busy) return;
    setBusy(true);
    const ok = await setRsvpTable(chosen.id, table);
    setBusy(false);
    if (ok) {
      setSelected(null);
      onChanged();
    }
  }

  return (
    <View style={styles.card} testID="seating-plan">
      <Text style={styles.heading} accessibilityRole="header">
        Seating plan
      </Text>
      <Text style={styles.body}>
        {chosen
          ? `Moving ${chosen.name}. Pick a table.`
          : 'A suggestion: someone experienced at each table, new players spread out. Tap a guest to move them.'}
      </Text>
      {caps.map((cap, i) => {
        const t = i + 1;
        const here = going.filter((r) => r.table === t);
        const count = (page.table_counts ?? [])[i] ?? 0;
        const canMoveHere = chosen && chosen.table !== t && count < cap;
        return (
          <View key={t} style={styles.tableBlock} testID={`plan-table-${t}`}>
            <View style={styles.tableHead}>
              <Text style={styles.tableName}>{`Table ${t} · ${count} of ${cap}`}</Text>
              {canMoveHere ? (
                <Button variant="secondary" big={false} onPress={() => move(t)} disabled={busy} accessibilityLabel={`Move to Table ${t}`}>
                  Move here
                </Button>
              ) : null}
            </View>
            <View style={styles.seatRow}>
              {t === 1 ? (
                <View style={styles.seat}>
                  <Text style={styles.seatText}>You</Text>
                </View>
              ) : null}
              {here.map((r) => {
                const isSel = r.id === selected;
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => setSelected(isSel ? null : r.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.name}${r.table_pinned ? ', moved by you' : ''}`}
                    aria-selected={isSel}
                    style={[styles.seat, isSel && styles.seatSelected]}
                  >
                    <Text style={[styles.seatText, isSel && styles.seatTextSelected]}>
                      {`${r.name.split(' ')[0]}${r.is_beginner ? ' (new)' : r.can_teach ? ' (teaches)' : ''}${r.table_pinned ? ' · moved' : ''}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      {chosen?.table_pinned ? (
        <Button variant="ghost" big={false} onPress={() => move(null)} disabled={busy} accessibilityLabel="Back to the plan">
          Back to the plan
        </Button>
      ) : null}
    </View>
  );
}
