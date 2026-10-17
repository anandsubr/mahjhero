import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text, TextInput } from './Text';
import Button from './Button';
import Card from './Card';
import ErrorBanner from './ErrorBanner';
import Tag from './Tag';
import TextField from './TextField';
import TipCard, { TipText } from './TipCard';
import MemberRow from './hub/MemberRow';
import { SearchIcon, SendIcon, TrashIcon, UserPlusIcon } from './icons';
import {
  canInvite,
  createInvite,
  deleteInvite,
  fetchPendingInvites,
  fetchRoster,
  sendClubInviteEmail,
} from '../lib/clubs';
import type { Club, ClubInvite, ClubMember, ClubRole } from '../lib/clubs';
import { isValidEmail } from '../lib/auth';
import { GENERIC_ERROR } from '../lib/constants';
import { addFriend, fetchFriends } from '../lib/friends';
import { filterMembers, orderMembers } from '../lib/members';
import { createGroupThread } from '../lib/messages';
import { useSession } from '../lib/session';
import { useGuides } from '../lib/use-guides';
import { colors, radius, space, type } from '../lib/theme';

export type ClubMembersHandle = {
  /** Refetches the roster, pending invites and friends -- what HubSection's pull-to-refresh calls. */
  reload: () => Promise<void>;
};

type Props = {
  club: Club;
  /** The caller's role in this club; null if they are not an active member. */
  role: ClubRole | null;
  /**
   * Set by the Members section route from the `?imported=N` the import
   * screen's redirect carries -- see app/clubs/[id]/import.tsx and
   * app/clubs/[id]/(hub)/members.tsx. Null/undefined shows nothing.
   */
  importedCount?: number | null;
};

/**
 * The club hub's Members section (club-hub phase 3, frame 1e): a search pill
 * and, for organizers, a 48pt invite button that reveals the invite-by-email
 * form; a "Show: Everyone / Hosts" filter; then MemberRow per person with
 * Add friend and Message. Below the list, unchanged from phase 2: pending
 * invites, the "Bringing people in" tip and the post-import confirmation.
 *
 * Phase 2 history: roster, pending invites and the invite form were moved out of the old club
 * page (club-hub phase 2, Task 10), verbatim apart from what that page no
 * longer owns. The club code row, Leaderboard button, "Open the club
 * thread", Import/Venues buttons and the default-game-mode toggle all
 * stayed behind on the old club page; they belong to Settings (Task 11),
 * not to a plain member/invite list. `role` comes from the hub's own
 * useClubHub(), not a roster lookup of the viewer's own row the way
 * legacy.tsx computed it -- the hub already loaded it once for every
 * section, so there is nothing to duplicate here.
 */
const ClubMembers = forwardRef<ClubMembersHandle, Props>(function ClubMembers(
  { club, role, importedCount = null },
  ref,
) {
  const guides = useGuides();
  const router = useRouter();
  const { session } = useSession();
  const selfId = session?.user.id ?? null;

  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [hostsOnly, setHostsOnly] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(() => new Set());
  // Message: state drives the spinner; the ref is the double-tap guard,
  // since a second tap can land before React re-renders with the state.
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const messagingRef = useRef(false);
  // Add friend is per row: one in flight doesn't block another row.
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  // A refused Add friend shows its (member-readable) reason under that row.
  const [friendError, setFriendError] = useState<{ id: string; message: string } | null>(null);
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Shown under the top row: invite-form and member-row (Message) failures.
  const [error, setError] = useState<string | null>(null);
  // Shown under the pending invites list: resend/delete failures there.
  const [inviteListError, setInviteListError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviting, setInviting] = useState(false);
  // Which pending invite's email was just resent -- shown as inline "Sent"
  // feedback on that one row for a couple seconds, matching the "Copied"
  // feedback the old copy-link row used to show.
  const [resentInviteId, setResentInviteId] = useState<string | null>(null);
  const resentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Disables just the one row's icons mid-delete, not the whole screen --
  // deleting one invite has no bearing on any other row.
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!club.id || loadingRef.current) return;
    loadingRef.current = true;
    const [r, i, f] = await Promise.all([
      fetchRoster(club.id),
      fetchPendingInvites(club.id),
      fetchFriends(),
    ]);
    // `i` is null only on a real failure. A plain member gets `[]` --
    // `club_invites_select_organizer` filters them out -- which is the
    // right answer, not an error.
    if (r === null || i === null) {
      setLoadFailed(true);
    } else {
      setLoadFailed(false);
      setRoster(r);
      setInvites(i);
    }
    // Friends failing to load doesn't hide the roster: the rows just offer
    // Add friend (add_friend is idempotent, so re-adding a friend is
    // harmless). A failed refresh keeps the set we already had.
    if (f !== null) setFriendIds(new Set(f.map((friend) => friend.profile_id)));
    setReady(true);
    loadingRef.current = false;
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Exposes a way for HubSection's pull-to-refresh (in the Members section)
  // to trigger the same `load` this component runs on mount -- the same
  // pattern ClubBoard and ClubLeaderboard use.
  useImperativeHandle(ref, () => ({ reload: load }), [load]);

  const mayInvite = role ? canInvite(role) : false;

  async function onInvite() {
    if (!isValidEmail(inviteEmail.trim())) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setInviting(true);
    const { id: inviteId, error: inviteError } = await createInvite(
      club.id,
      inviteEmail.trim(),
      inviteDisplayName.trim(),
    );
    if (inviteError || !inviteId) {
      setInviting(false);
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    const { error: sendError } = await sendClubInviteEmail(inviteId);
    setInviting(false);
    if (sendError) {
      // The invite exists even though the email didn't go out -- "Resend
      // invite email" on the new row (below) is the recovery path, not a
      // retry loop here.
      setError('Invite created, but the email could not be sent. You can resend it below.');
    }
    setInvites((prev) => [
      ...prev,
      {
        id: inviteId,
        email: inviteEmail.trim(),
        display_name: inviteDisplayName.trim() || null,
        skill_level: null,
        declined_at: null,
      },
    ]);
    setInviteEmail('');
    setInviteDisplayName('');
  }

  async function onMessage(member: ClubMember) {
    if (messagingRef.current) return;
    messagingRef.current = true;
    setMessagingId(member.profile_id);
    setError(null);
    // Returns the existing two-person thread when there is one.
    const { id, error: threadError } = await createGroupThread('', [member.profile_id]);
    messagingRef.current = false;
    setMessagingId(null);
    if (threadError || !id) {
      setError(GENERIC_ERROR);
      return;
    }
    router.push(`/messages/${id}`);
  }

  async function onAddFriend(member: ClubMember) {
    const memberId = member.profile_id;
    if (addingIds.has(memberId)) return;
    setFriendError(null);
    setAddingIds((prev) => new Set(prev).add(memberId));
    const { error: addError } = await addFriend(memberId);
    setAddingIds((prev) => {
      const next = new Set(prev);
      next.delete(memberId);
      return next;
    });
    if (addError) {
      setFriendError({ id: memberId, message: addError });
      return;
    }
    setFriendIds((prev) => new Set(prev).add(memberId));
  }

  async function onResendInvite(invite: ClubInvite) {
    setInviteListError(null);
    const { error: sendError } = await sendClubInviteEmail(invite.id);
    if (sendError) {
      setInviteListError(sendError);
      return;
    }
    if (resentTimeoutRef.current) clearTimeout(resentTimeoutRef.current);
    setResentInviteId(invite.id);
    resentTimeoutRef.current = setTimeout(() => setResentInviteId(null), 2000);
  }

  async function onDeleteInvite(invite: ClubInvite) {
    setInviteListError(null);
    setDeletingInviteId(invite.id);
    const { error: deleteError } = await deleteInvite(invite.id);
    setDeletingInviteId(null);
    if (deleteError) {
      setInviteListError(deleteError);
      return;
    }
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  if (!ready) {
    return <ActivityIndicator style={styles.loading} color={colors.accentColor} />;
  }

  if (loadFailed) {
    return <ErrorBanner message={GENERIC_ERROR} />;
  }

  const trimmedSearch = memberSearch.trim();
  const visibleMembers = filterMembers(orderMembers(roster), memberSearch, hostsOnly);
  let emptyLine: string | null = null;
  if (visibleMembers.length === 0) {
    emptyLine =
      trimmedSearch.length > 0
        ? `No members match “${trimmedSearch}”.`
        : hostsOnly
          ? 'No hosts in this club yet.'
          : null;
  }

  return (
    <View style={styles.root}>
      {importedCount !== null && importedCount !== undefined && importedCount > 0 ? (
        <Card>
          <Text style={styles.confirmation}>
            {importedCount === 1
              ? '1 invitation sent.'
              : `${importedCount} invitations sent.`}{' '}
            They appear under Invited until each person joins.
          </Text>
        </Card>
      ) : null}

      <View style={styles.topRow}>
        <View style={styles.searchPill}>
          <SearchIcon size={18} color={colors.neutral[700]} />
          <TextInput
            style={styles.searchInput}
            value={memberSearch}
            onChangeText={setMemberSearch}
            placeholder={`Search ${roster.length} ${roster.length === 1 ? 'member' : 'members'}`}
            placeholderTextColor={colors.neutral[700]}
            accessibilityLabel="Search members"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {mayInvite ? (
          <Pressable
            onPress={() => setShowInvite((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Invite someone by email"
            accessibilityState={{ expanded: showInvite }}
            style={styles.inviteButton}
          >
            <UserPlusIcon size={22} color="#fff" />
          </Pressable>
        ) : null}
      </View>

      {mayInvite && showInvite ? (
        <View style={styles.inviteForm}>
          <TextField
            label="Invite by email"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="them@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Email address to invite"
          />
          <TextField
            label="Name (optional)"
            value={inviteDisplayName}
            onChangeText={setInviteDisplayName}
            placeholder="Their name"
            accessibilityLabel="Name of the person you're inviting"
          />
          <Button
            variant="secondary"
            onPress={onInvite}
            disabled={inviting}
            loading={inviting}
            accessibilityLabel="Send invite"
          >
            Send invite
          </Button>
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      <Pressable
        onPress={() => setHostsOnly((on) => !on)}
        accessibilityRole="button"
        style={styles.filterButton}
      >
        <Text style={styles.filterText}>{hostsOnly ? 'Show: Hosts' : 'Show: Everyone'}</Text>
      </Pressable>

      {/*
        Every row here is somebody who has signed in. `club_members` rows are
        written only by `create_club` and `accept_club_invite`, both of which
        require `auth.uid()`, so there is no such thing as a roster row for a
        person who has not. Genuinely-invited people are the separate section
        below, read from `club_invites`.
      */}
      <View>
        {emptyLine ? <Text style={styles.help}>{emptyLine}</Text> : null}
        {visibleMembers.map((member) => (
          <View key={member.profile_id}>
            <MemberRow
              member={member}
              isSelf={member.profile_id === selfId}
              isFriend={friendIds.has(member.profile_id)}
              onMessage={() => onMessage(member)}
              onAddFriend={() => onAddFriend(member)}
              messaging={messagingId === member.profile_id}
              adding={addingIds.has(member.profile_id)}
            />
            {friendError?.id === member.profile_id ? (
              <Text style={styles.rowError} accessibilityRole="alert">
                {friendError.message}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {/*
        Keyed on invite id, not email: `club_invites.email` is nullable (a
        plain "create an invite link" invite has none) and nothing stops a
        host inviting the same address twice.
      */}
      {invites.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>{invites.length} invited</Text>
          {invites.map((invite) => {
            const inviteLabel =
              invite.display_name && invite.display_name.trim().length > 0
                ? invite.display_name
                : invite.email;
            const busy = deletingInviteId === invite.id;
            return (
              <Card key={invite.id}>
                <View style={styles.row}>
                  <Text style={styles.memberName}>{inviteLabel}</Text>
                  <Tag>{invite.declined_at ? 'Declined' : 'Invited'}</Tag>
                </View>
                <View style={styles.inviteMetaRow}>
                  <Text style={styles.inviteMetaText} numberOfLines={1}>
                    {resentInviteId === invite.id ? 'Sent' : invite.email}
                  </Text>
                  <View style={styles.inviteActions}>
                    {!invite.declined_at ? (
                      <Pressable
                        onPress={() => onResendInvite(invite)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Resend the invite email to ${inviteLabel}`}
                        hitSlop={8}
                      >
                        <SendIcon size={18} color={colors.accentColor} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => onDeleteInvite(invite)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete the invite for ${inviteLabel}`}
                      hitSlop={8}
                    >
                      <TrashIcon size={18} color={busy ? colors.textMuted : colors.text} />
                    </Pressable>
                  </View>
                </View>
              </Card>
            );
          })}
          {inviteListError ? <ErrorBanner message={inviteListError} /> : null}
        </>
      ) : null}

      {mayInvite && guides.isVisible('tip:club') ? (
        <TipCard tag="Tip" title="Bringing people in" onDismiss={() => guides.dismiss('tip:club')}>
          <TipText>
            Use Invite by email for one person, or Import a roster in Club settings for a whole list.
          </TipText>
          <TipText>
            They'll see the invite on their Home screen once they sign in with that email.
          </TipText>
        </TipCard>
      ) : null}
    </View>
  );
});

export default ClubMembers;

const styles = StyleSheet.create({
  // The old club page spaced these through its Screen container (gap
  // space[4]); the section scroller has no gap, so the list carries its own.
  root: {
    gap: space[4],
  },
  loading: { marginTop: space[6] },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.neutral[400],
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.text,
  },
  inviteButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent[700],
  },
  inviteForm: {
    gap: space[4],
  },
  filterButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  filterText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.accent[700],
  },
  rowError: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[800],
    paddingLeft: 58,
    paddingBottom: space[2],
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  inviteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  inviteMetaText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
    flex: 1,
    minWidth: 0,
  },
  inviteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  row: {
    flexDirection: 'row',
    // Wrap, not truncate-and-cram: a host/co-organizer's role tag sharing
    // this row with a long name plus a skill level would otherwise force
    // the name to over-truncate and the tag's own text to wrap mid-word --
    // letting the tag drop to its own line instead keeps both readable. The
    // common case (a plain member, no tag) still renders as one line.
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  confirmation: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    lineHeight: 24,
  },
});
