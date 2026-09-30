import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import Button from './Button';
import Card from './Card';
import ErrorBanner from './ErrorBanner';
import SkillLevelPips from './SkillLevelPips';
import Tag from './Tag';
import TextField from './TextField';
import TipCard, { TipText } from './TipCard';
import { SendIcon, TrashIcon } from './icons';
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
import { useGuides } from '../lib/use-guides';
import { colors, space, type } from '../lib/theme';

export type ClubMembersHandle = {
  /** Refetches the roster and pending invites -- what HubSection's pull-to-refresh calls. */
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
 * The club hub's Members section: roster, pending invites, and (for a host
 * or co-organizer) the invite-by-email form -- moved out of
 * app/clubs/[id]/legacy.tsx (club-hub phase 2, Task 10), verbatim apart from
 * what that page no longer owns. The club code row, Leaderboard button,
 * "Open the club thread", Import/Venues buttons and the default-game-mode
 * toggle all stayed behind in legacy.tsx; they belong to Settings (Task 11),
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

  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const [r, i] = await Promise.all([fetchRoster(club.id), fetchPendingInvites(club.id)]);
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

  async function onResendInvite(invite: ClubInvite) {
    setError(null);
    const { error: sendError } = await sendClubInviteEmail(invite.id);
    if (sendError) {
      setError(sendError);
      return;
    }
    if (resentTimeoutRef.current) clearTimeout(resentTimeoutRef.current);
    setResentInviteId(invite.id);
    resentTimeoutRef.current = setTimeout(() => setResentInviteId(null), 2000);
  }

  async function onDeleteInvite(invite: ClubInvite) {
    setError(null);
    setDeletingInviteId(invite.id);
    const { error: deleteError } = await deleteInvite(invite.id);
    setDeletingInviteId(null);
    if (deleteError) {
      setError(deleteError);
      return;
    }
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  // The same fallback the roster row itself displays -- a member with no
  // display name is still findable by typing "member", matching what a
  // host actually sees on screen rather than an internal, always-blank field.
  function memberLabel(member: ClubMember): string {
    return member.display_name.trim().length > 0 ? member.display_name : 'Member';
  }

  if (!ready) {
    return <ActivityIndicator style={styles.loading} color={colors.accentColor} />;
  }

  if (loadFailed) {
    return <ErrorBanner message={GENERIC_ERROR} />;
  }

  const trimmedSearch = memberSearch.trim().toLowerCase();
  const filteredRoster =
    trimmedSearch.length === 0
      ? roster
      : roster.filter((member) => memberLabel(member).toLowerCase().includes(trimmedSearch));

  return (
    <>
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

      <Text style={styles.sectionTitle}>
        {roster.length} {roster.length === 1 ? 'member' : 'members'}
      </Text>

      {roster.length > 0 ? (
        <TextField
          label="Search members"
          value={memberSearch}
          onChangeText={setMemberSearch}
          placeholder="Search by name"
        />
      ) : null}

      {/*
        Every row here is somebody who has signed in. `club_members` rows are
        written only by `create_club` and `accept_club_invite`, both of which
        require `auth.uid()`, so there is no such thing as a roster row for a
        person who has not. Genuinely-invited people are the separate section
        below, read from `club_invites`.
      */}
      {roster.length > 0 && filteredRoster.length === 0 ? (
        <Text style={styles.help}>No members match "{memberSearch.trim()}".</Text>
      ) : null}

      {filteredRoster.map((member) => (
        <Card key={member.profile_id}>
          <View style={styles.row}>
            {/*
              Name and skill level share one row now, not two -- the pip
              glyph beside the word, not instead of it (the word is what
              carries the meaning; SkillLevelPips is aria-hidden, same as
              SkillTierPips it wraps -- see that component's own docstring).
              Nothing renders at all for a member with no skill_level: null
              means "not set", which is not a fourth level and must never
              draw as a dash.
            */}
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName} numberOfLines={1}>
                {memberLabel(member)}
              </Text>
              {member.skill_level ? (
                <View style={styles.skillRow}>
                  <SkillLevelPips level={member.skill_level} />
                  <Text style={styles.help}>
                    {member.skill_level.charAt(0).toUpperCase() + member.skill_level.slice(1)}
                  </Text>
                </View>
              ) : null}
            </View>
            {member.role !== 'member' ? (
              <Tag>{member.role === 'host' ? 'Host' : 'Co-organizer'}</Tag>
            ) : null}
          </View>
        </Card>
      ))}

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
        </>
      ) : null}

      {mayInvite ? (
        <>
          {guides.isVisible('tip:club') ? (
            <TipCard tag="Tip" title="Bringing people in" onDismiss={() => guides.dismiss('tip:club')}>
              <TipText>
                Use Invite by email for one person, or Import a roster in Club settings for a whole list.
              </TipText>
              <TipText>
                They'll see the invite on their Home screen once they sign in with that email.
              </TipText>
            </TipCard>
          ) : null}
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
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
    </>
  );
});

export default ClubMembers;

const styles = StyleSheet.create({
  loading: { marginTop: space[6] },
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
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    flexShrink: 1,
    flexGrow: 1,
    minWidth: '60%',
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexShrink: 0,
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
