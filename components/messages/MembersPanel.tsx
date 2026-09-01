import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../Button';
import ErrorBanner from '../ErrorBanner';
import { GENERIC_ERROR } from '../../lib/constants';
import { fetchAddablePeople, fetchFriends } from '../../lib/friends';
import { addToGroupThread, leaveGroupThread, type ThreadDetail } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

/** A candidate for Add people -- the same shape app/messages/new.tsx's own
 *  People picker uses for its candidate list. */
type Candidate = { profile_id: string; display_name: string; meta: string };

type Props = {
  thread: ThreadDetail;
  /** Called after a change the caller's own roster needs to reflect (an
   *  add). Leaving does not reload -- it navigates away instead. The
   *  caller passes its own `load` here, which is async; awaited below so
   *  a successful add doesn't resolve before the roster it should show
   *  has actually landed. */
  onChanged: () => void | Promise<void>;
  /**
   * A leave refusal surfaces through the CALLER's top-level error banner,
   * not a panel-local one -- that is where app/messages/[threadId].tsx
   * already put it, the same banner a failed send uses, while `addError`
   * below (panel-local) is reserved for the Add flow. This callback is how
   * that refusal reaches the caller's `error` state unchanged; passed
   * `null` at the start of every leave attempt, the same as the screen's
   * own `setError(null)` did.
   */
  onLeaveError: (message: string | null) => void;
};

/**
 * The `1C thread` artboard's members panel: roster, Add people, and Leave.
 *
 * Extracted verbatim from app/messages/[threadId].tsx. `membersOpen` itself
 * stays with the caller as the mount switch -- this only exists while the
 * caller renders it. GROUP and DIRECT threads only; a club or game thread's
 * membership is derived from club_members/bookings, not stored, so there is
 * nothing here to manage -- the caller is what decides whether to mount
 * this at all.
 */
export default function MembersPanel({ thread, onChanged, onLeaveError }: Props) {
  const router = useRouter();

  const [addingOpen, setAddingOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pickedToAdd, setPickedToAdd] = useState<string[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Guards the add_to_group_thread RPC itself, the same shape as
  // sendingRef on the caller: `addBusy` state is read from the render
  // closure, so a second activation landing before React re-renders with
  // the disabled button would otherwise double the call.
  const addBusyRef = useRef(false);

  // Leaving a group is irreversible -- the last member out deletes the
  // thread and its messages (leave_group_thread's own comment). Asks once,
  // the same two-step shape this file's own `leave()` button below uses.
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const leaveBusyRef = useRef(false);

  // Friends first, then people from your clubs -- the identical shape and
  // ordering app/messages/new.tsx's own People picker uses (see that
  // screen's docstring on why: a friend acquired in a club one of you has
  // since left appears in neither club list). Reused here rather than a
  // second way of gathering who is addable to a conversation.
  const openAdding = useCallback(async () => {
    setAddError(null);
    setAddBusy(true);
    const [friends, people] = await Promise.all([fetchFriends(), fetchAddablePeople()]);
    setAddBusy(false);
    if (friends === null || people === null) {
      setAddError(GENERIC_ERROR);
      return;
    }
    // Already-in-the-thread people have nothing to be added to twice.
    const already = new Set(thread.thread_members.map((m) => m.profile_id));
    setCandidates([
      ...friends
        .filter((f) => !already.has(f.profile_id))
        .map((f) => ({ profile_id: f.profile_id, display_name: f.display_name, meta: 'Friend' })),
      ...people
        .filter((p) => !already.has(p.profile_id))
        .map((p) => ({ profile_id: p.profile_id, display_name: p.display_name, meta: p.club_name })),
    ]);
    setAddingOpen(true);
  }, [thread]);

  const addPicked = useCallback(async () => {
    if (addBusyRef.current || pickedToAdd.length === 0) return;
    addBusyRef.current = true;
    setAddBusy(true);
    setAddError(null);
    const { error: refusal } = await addToGroupThread(thread.id, pickedToAdd);
    addBusyRef.current = false;
    setAddBusy(false);
    if (refusal) {
      setAddError(refusal);
      return;
    }
    setPickedToAdd([]);
    setAddingOpen(false);
    // The roster shown has to include who was just added.
    await onChanged();
  }, [thread.id, pickedToAdd, onChanged]);

  const leave = useCallback(async () => {
    if (leaveBusyRef.current) return;
    leaveBusyRef.current = true;
    setLeaveBusy(true);
    onLeaveError(null);
    const { error: refusal } = await leaveGroupThread(thread.id);
    leaveBusyRef.current = false;
    setLeaveBusy(false);
    if (refusal) {
      setLeaveConfirming(false);
      onLeaveError(refusal);
      return;
    }
    // Nothing left here to come back to -- the last member out takes the
    // thread with them, and even short of that, staying would show a
    // conversation this screen no longer has a roster row for.
    router.replace('/messages');
  }, [thread.id, router, onLeaveError]);

  return (
    <View style={styles.membersPanel}>
      {thread.thread_members.map((m) => (
        <Text key={m.profile_id} style={styles.memberName}>
          {m.profiles?.display_name ?? 'Member'}
        </Text>
      ))}

      {addError ? <ErrorBanner message={addError} /> : null}

      {addingOpen ? (
        <>
          {candidates.length === 0 ? (
            <Text style={styles.membersHint}>Nobody else to add.</Text>
          ) : (
            candidates.map((c) => {
              const picked = pickedToAdd.includes(c.profile_id);
              return (
                <Pressable
                  key={c.profile_id}
                  onPress={() =>
                    setPickedToAdd((cur) =>
                      cur.includes(c.profile_id)
                        ? cur.filter((x) => x !== c.profile_id)
                        : [...cur, c.profile_id],
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={c.display_name}
                  aria-selected={picked}
                  style={[styles.candidateRow, picked ? styles.candidateRowOn : null]}
                >
                  <Text style={styles.candidateName}>{c.display_name}</Text>
                  <Text style={styles.candidateMeta}>{c.meta}</Text>
                </Pressable>
              );
            })
          )}
          <Button
            big={false}
            accessibilityLabel="Add"
            disabled={addBusy || pickedToAdd.length === 0}
            loading={addBusy}
            onPress={() => void addPicked()}
          >
            Add
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          big={false}
          accessibilityLabel="Add people"
          disabled={addBusy}
          loading={addBusy}
          onPress={() => void openAdding()}
        >
          Add people
        </Button>
      )}

      {/*
        Irreversible: the last member out deletes the thread and its
        messages (leave_group_thread's own comment). Asks once, arm-then-
        confirm -- the shape Send's announcement arming used before that
        toggle was removed from this screen (see
        app/messages/[threadId].tsx's own docstring). Leave is now the only
        action here that cannot be undone, and still gets the two-step.
      */}
      <Button
        variant="destructive"
        big={false}
        accessibilityLabel={leaveConfirming ? 'Confirm leave' : 'Leave'}
        disabled={leaveBusy}
        loading={leaveBusy}
        onPress={() => {
          if (!leaveConfirming) {
            setLeaveConfirming(true);
            return;
          }
          void leave();
        }}
      >
        {leaveConfirming ? 'Confirm' : 'Leave'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  membersPanel: {
    gap: space[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space[4],
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  membersHint: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: space[3],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // accent[700], not the artboard's accentColor: colors.bg on accentColor
  // measures 3.030:1, a 0.03 margin over the 3:1 non-text bar that
  // lib/theme.test.ts had no pin for. Selection is also conveyed by
  // aria-selected, so this was never a correctness bug, but a margin that
  // thin is exactly what the existing pins exist to prevent. accent[700] on
  // colors.bg reads 5.72:1 and is already pinned there (the same pairing
  // MessageBubble's `mine` bubble and Composer's `send` button use), so this
  // reuses headroom that exists rather than adding a new pin for a fresh
  // pairing.
  candidateRowOn: { borderColor: colors.accent[700] },
  candidateName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  candidateMeta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
