import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./Text";
import Toggle from "./Toggle";
import type { BookingOutcome } from "../lib/bookings";
import type { EventTable } from "../lib/events";
import type { ClubMember } from "../lib/clubs";
import { colors, layout, radius, shadow, type } from "../lib/theme";

// Shared by the visible label and the Toggle's `accessibilityLabel` so a
// sighted reader and a screen reader are never told two different things.
const SPLIT_TOGGLE_LABEL = "Split us up if we can't sit together";

type Props = {
  roster: ClubMember[];
  /** profile ids already holding a live booking or a pending invite for this game. */
  booked: string[];
  youId: string;
  tables: EventTable[];
  initialTableId: string | null;
  onPropose: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ plan: BookingOutcome | null; error: string | null }>;
  onCommit: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ result: BookingOutcome | null; error: string | null }>;
  onClose: () => void;
};

/**
 * The only place propose_booking is used.
 *
 * Rendered as a bottom sheet over a scrim, the same shell as SeatSheet (the
 * record-a-win panel), so both game-screen panels look and dismiss alike.
 *
 * A group can be split across tables, and the parent spec is explicit that
 * the app shows exactly who sits where and asks. A solo booking skips this
 * entirely — there is nothing to show, so the round trip would buy a dialog
 * nobody needs.
 */
export default function BringSomeoneSheet({
  roster,
  booked,
  youId,
  tables,
  initialTableId,
  onPropose,
  onCommit,
  onClose,
}: Props) {
  // The opener may already hold a seat at this game — "I'm in, and Jane
  // wants to come too" is plausibly the commonest reason to open this sheet
  // at all. Seeding `players` with `youId` unconditionally would mean every
  // confirm for an already-seated opener re-proposes themselves alongside
  // their friend, and the database (commit_booking's assert_players_bookable)
  // refuses the whole group because one member of it already has a seat.
  // So: only seed (and only show the non-removable "You" chip) when the
  // opener is not already seated. An already-seated opener sees just the
  // friends they pick.
  const alreadySeated = booked.includes(youId);
  // Whether the club has anyone else to offer at all, independent of who is
  // already coming to this specific game -- distinguishes the two reasons
  // `available` below can be empty (see its empty state, rendered further
  // down).
  const soloClub = roster.length <= 1;
  const [players, setPlayers] = useState<string[]>(
    alreadySeated ? [] : [youId],
  );
  const [tableId, setTableId] = useState<string | null>(initialTableId);
  const [allowSplit, setAllowSplit] = useState(true);
  const [plan, setPlan] = useState<BookingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Anybody already coming is not offered. The database refuses them
  // anyway; not offering them is what stops a member meeting a refusal
  // they had no way to predict.
  const available = roster.filter(
    (m) => m.profile_id !== youId && !booked.includes(m.profile_id),
  );

  // Anyone besides the opener makes this an invitation (commit_booking
  // books only the caller; everyone else is invited and must accept), so
  // the buttons say so. A You-only sheet is still a plain booking.
  const invitingOthers = players.some((id) => id !== youId);

  const nameOf = (id: string) =>
    id === youId
      ? "You"
      : (roster.find((m) => m.profile_id === id)?.display_name ?? "Someone");

  function toggle(id: string) {
    setPlan(null);
    setPlayers((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
    );
  }

  async function confirm() {
    // An already-seated opener with nobody picked has nothing to propose --
    // proposing an empty group either round-trips for nothing or (worse)
    // hits the database's own "at least one player" shape unexpectedly.
    // The Confirm button is also disabled in this state (see below); this
    // guard is the one that actually matters, since it holds regardless of
    // how the press reached here.
    if (players.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const { plan: proposed, error: failed } = await onPropose({
      players,
      preferredTableId: tableId,
      allowSplit,
    });
    setBusy(false);
    if (failed || !proposed) {
      setError(failed);
      return;
    }
    // Nothing to show: seat them without a second tap.
    if (proposed.outcome === "seated" && !proposed.split) {
      await commit(allowSplit);
      return;
    }
    setPlan(proposed);
  }

  async function commit(split: boolean) {
    setBusy(true);
    setError(null);
    const { error: failed } = await onCommit({
      players,
      preferredTableId: tableId,
      allowSplit: split,
    });
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={busy ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          testID="bring-someone-scrim"
        />
        <View style={styles.sheet} testID="bring-someone-sheet">
          <View style={styles.grabber} />
          <Text style={styles.heading}>Who's coming?</Text>

          <View style={styles.people}>
            {alreadySeated ? null : (
              <View style={[styles.person, styles.personOn]}>
                <Text style={styles.personTextOn}>You</Text>
              </View>
            )}
            {available.map((member) => {
              const on = players.includes(member.profile_id);
              return (
                <Pressable
                  key={member.profile_id}
                  style={[styles.person, on && styles.personOn]}
                  onPress={() => toggle(member.profile_id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${on ? "Remove" : "Add"} ${member.display_name}`}
                  aria-selected={on}
                  aria-disabled={busy}
                >
                  <Text style={on ? styles.personTextOn : styles.personText}>
                    {member.display_name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/*
        Without this, an opener who already holds a seat -- the "You" chip
        above is correctly omitted for them -- combined with nobody else in
        `available` renders the "Who's coming?" heading over nothing: no
        chips, no explanation, just Confirm sitting there disabled (see
        `confirm`'s own guard) for a reason the member has no way to guess.
        Two distinct reasons `available` can be empty, told apart so the
        copy is actually true rather than a generic "nobody available":
        the club itself has nobody else yet, versus everybody it does have
        is already coming to this game.
      */}
          {available.length === 0 ? (
            <Text style={styles.helper}>
              {soloClub
                ? "You're the only member of this club so far. Invite people from the club page to fill a table."
                : "Everyone else in the club already has a seat at this game."}
            </Text>
          ) : null}

          <Text style={styles.heading}>Where?</Text>
          <View style={styles.people}>
            {tables.map((table) => {
              const on = tableId === table.id;
              return (
                <Pressable
                  key={table.id}
                  style={[styles.person, on && styles.personOn]}
                  onPress={() => {
                    setPlan(null);
                    setTableId(table.id);
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Sit at ${table.label}`}
                  aria-selected={on}
                  aria-disabled={busy}
                >
                  <Text style={on ? styles.personTextOn : styles.personText}>
                    {table.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.person, tableId === null && styles.personOn]}
              onPress={() => {
                setPlan(null);
                setTableId(null);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Any table"
              aria-selected={tableId === null}
              aria-disabled={busy}
            >
              <Text
                style={
                  tableId === null ? styles.personTextOn : styles.personText
                }
              >
                Any table
              </Text>
            </Pressable>
          </View>

          {/*
        Hidden for "any table": nobody in an any-table group is placed, so
        there is nothing to split, and offering the choice would be
        offering one that changes nothing.
      */}
          {tableId !== null ? (
            <View style={styles.splitRow}>
              {/*
            Toggle takes only value/onValueChange/accessibilityLabel (see
            its own docstring) -- it draws no visible text of its own, so
            without this the switch renders bare, with nothing beside it
            explaining what it does. `accessibilityLabel` below is the
            exact same string, so a screen reader and a sighted reader are
            told the same thing.
          */}
              <Text style={styles.splitLabel}>{SPLIT_TOGGLE_LABEL}</Text>
              <Toggle
                value={allowSplit}
                onValueChange={(next) => {
                  setPlan(null);
                  setAllowSplit(next);
                }}
                accessibilityLabel={SPLIT_TOGGLE_LABEL}
              />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {plan === null ? (
            <SheetButton
              busy={busy}
              disabled={players.length === 0}
              onPress={confirm}
              accessibilityLabel={
                invitingOthers ? "Send invites" : "Confirm this booking"
              }
            >
              {invitingOthers ? "Send invites" : "Confirm"}
            </SheetButton>
          ) : plan.outcome === "seated" ? (
            <>
              <Text style={styles.heading}>They can't all sit together</Text>
              {plan.placements.map((placement) => (
                <Text key={placement.profile_id} style={styles.placement}>
                  {nameOf(placement.profile_id)} → {placement.table_label}
                </Text>
              ))}
              <SheetButton
                busy={busy}
                onPress={() => commit(true)}
                accessibilityLabel={
                  invitingOthers ? "Send invites this way" : "Book it this way"
                }
              >
                {invitingOthers ? "Send invites this way" : "Book it this way"}
              </SheetButton>
              {invitingOthers ? null : (
                <SheetButton
                  secondary
                  busy={busy}
                  onPress={() => commit(false)}
                  accessibilityLabel="Wait together instead"
                >
                  Wait together instead
                </SheetButton>
              )}
            </>
          ) : (
            <>
              <Text style={styles.placement}>
                {invitingOthers
                  ? "The game is full — anyone who accepts joins the waitlist."
                  : "There is no room for all of you right now."}
              </Text>
              <SheetButton
                busy={busy}
                onPress={() => commit(allowSplit)}
                accessibilityLabel={
                  invitingOthers
                    ? "Send invites — they'd join the waitlist"
                    : "Wait together"
                }
              >
                {invitingOthers
                  ? "Send invites — they'd join the waitlist"
                  : "Wait together"}
              </SheetButton>
            </>
          )}

          <Pressable
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>Never mind</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** SeatSheet's primary / secondary pill, plus a spinner while a request is in flight. */
function SheetButton({
  children,
  secondary = false,
  busy,
  disabled = false,
  onPress,
  accessibilityLabel,
}: {
  children: string;
  secondary?: boolean;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        secondary ? styles.secondary : styles.primary,
        disabled && !secondary ? styles.primaryDisabled : null,
        busy ? styles.dimmed : null,
      ]}
    >
      {busy && !secondary ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : null}
      <Text style={secondary ? styles.secondaryText : styles.primaryText}>
        {children}
      </Text>
    </Pressable>
  );
}

// Shell, buttons and type sizes copied from SeatSheet so the two game-screen
// sheets match; the fixed sizes are that design's own, not the theme scale.
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // neutral-900 at 40%.
    backgroundColor: "rgba(46, 43, 37, 0.4)",
  },
  sheet: {
    width: "100%",
    maxWidth: layout.contentMaxWidth,
    alignSelf: "center",
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 10,
    ...shadow.lg,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral[400],
    marginBottom: 6,
  },
  heading: {
    fontFamily: type.bodyBold,
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  people: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  person: {
    height: 40,
    justifyContent: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
  },
  personOn: { backgroundColor: colors.accent[700] },
  personText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  personTextOn: { fontFamily: type.bodyBold, fontSize: 15, color: "#ffffff" },
  placement: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  helper: {
    fontFamily: type.bodyRegular,
    fontSize: 14,
    color: colors.neutral[700],
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  splitLabel: {
    fontFamily: type.bodyRegular,
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: 14,
    color: colors.accent[700],
  },
  primary: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  primaryDisabled: { backgroundColor: colors.neutral[400] },
  primaryText: { fontFamily: type.bodyBold, fontSize: 16, color: "#ffffff" },
  secondary: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dimmed: { opacity: 0.5 },
  secondaryText: {
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: colors.accent[700],
  },
  cancel: { height: 44, alignItems: "center", justifyContent: "center" },
  cancelText: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: colors.neutral[700],
  },
});
