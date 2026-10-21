import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Tag from '../Tag';
import { MessageCircleIcon, UserPlusIcon } from '../icons';
import type { ClubMember } from '../../lib/clubs';
import { avatarColorsFor } from '../../lib/friends';
import { memberInitials, memberName, skillLabel } from '../../lib/members';
import type { SkillLevel } from '../../lib/profile';
import { colors, radius, type, type AvatarPair } from '../../lib/theme';

type Props = {
  member: ClubMember;
  /** The viewer's own row: "{name} (you)" and no buttons. */
  isSelf: boolean;
  isFriend: boolean;
  onMessage: () => void;
  onAddFriend: () => void;
  /** Message is in flight for this row: spinner, disabled. */
  messaging: boolean;
  /** Add friend is in flight for this row: spinner, disabled. */
  adding: boolean;
};

const AVATAR_SIZE = 46;
const ICON_BUTTON_SIZE = 44;

/** Skill chip colours per level (Linen & Jade §4); Intermediate is avatar-3. */
const SKILL_CHIP: Record<SkillLevel, AvatarPair> = {
  beginner: { bg: colors.accent2[200], fg: colors.accent2[800] },
  intermediate: colors.avatar[2],
  advanced: { bg: colors.accent[200], fg: colors.accent[800] },
};

/**
 * One person in the club hub's Members section (frame 1e): initials avatar,
 * name with a Host/Co-organizer tag, skill level as a coloured chip, and on the right
 * Add friend (or a "Friend" tag) before Message. Presentational -- the
 * section owns the calls and busy state.
 */
export default function MemberRow({
  member,
  isSelf,
  isFriend,
  onMessage,
  onAddFriend,
  messaging,
  adding,
}: Props) {
  const name = memberName(member);
  const pair = avatarColorsFor(member.profile_id);
  const skill = skillLabel(member.skill_level);
  const roleTag =
    member.role === 'host' ? 'Host' : member.role === 'co_organizer' ? 'Co-organizer' : null;

  return (
    <View style={styles.row}>
      <View
        style={[styles.avatar, { backgroundColor: pair.bg }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.initials, { color: pair.fg }]}>{memberInitials(name)}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.text}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {isSelf ? `${name} (you)` : name}
            </Text>
            {roleTag ? <Tag size="small">{roleTag}</Tag> : null}
          </View>
          {skill && member.skill_level ? (
            <View style={[styles.skillChip, { backgroundColor: SKILL_CHIP[member.skill_level].bg }]}>
              <Text style={[styles.skill, { color: SKILL_CHIP[member.skill_level].fg }]}>{skill}</Text>
            </View>
          ) : null}
        </View>
        {isSelf ? null : (
          <View style={styles.actions}>
            {isFriend ? (
              <View style={styles.friendTag}>
                <Tag size="small" variant="accent2">
                  Friend
                </Tag>
              </View>
            ) : (
              <Pressable
                onPress={onAddFriend}
                disabled={adding}
                accessibilityRole="button"
                accessibilityLabel={`Add ${name} as a friend`}
                accessibilityState={{ disabled: adding, busy: adding }}
                style={styles.iconButton}
              >
                {adding ? (
                  <ActivityIndicator size="small" color={colors.neutral[700]} />
                ) : (
                  <UserPlusIcon size={22} color={colors.neutral[700]} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={onMessage}
              disabled={messaging}
              accessibilityRole="button"
              accessibilityLabel={`Message ${name}`}
              accessibilityState={{ disabled: messaging, busy: messaging }}
              style={styles.iconButton}
            >
              {messaging ? (
                <ActivityIndicator size="small" color={colors.accent[700]} />
              ) : (
                <MessageCircleIcon size={22} color={colors.accent[700]} />
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    gap: 12,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: type.bodyBold,
    fontSize: 16,
  },
  // The divider runs under the text block and buttons, not under the avatar.
  body: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingVertical: 10,
    gap: 4,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    color: colors.text,
    flexShrink: 1,
  },
  skillChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  skill: {
    fontFamily: type.bodyBold,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  friendTag: {
    minHeight: ICON_BUTTON_SIZE,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: ICON_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
