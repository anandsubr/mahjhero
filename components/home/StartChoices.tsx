import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import Button from '../Button';
import JoinClubCard from './JoinClubCard';
import { inAppPathFromLink, shareAskAFriendToHost } from '../../lib/start';
import { colors, radius, type } from '../../lib/theme';

type Choice = 'invite' | 'new';

/**
 * "What brings you here?" (pivot batch 1, first run): Home for someone with
 * no groups yet. No carousel -- each choice goes straight into the product.
 *
 * - Host a Mahj Night: the create flow (for now Start a group's form worded
 *   for a night, then that group's New game form; batch 2 replaces it).
 * - Start a group: Start a group.
 * - I got an invite: open the link, paste it here, or type a group code.
 * - I'm new to mahjong: How it works, and "Ask a friend to host".
 */
export default function StartChoices() {
  const router = useRouter();
  const [open, setOpen] = useState<Choice | null>(null);

  return (
    <View style={styles.wrap} testID="start-choices">
      <Text style={styles.heading} accessibilityRole="header">
        What brings you here?
      </Text>

      <ChoiceRow
        title="Host a Mahj Night"
        body="Invite friends to a night of mahjong. We'll seat everyone at tables of four."
        onPress={() => router.push('/clubs/new?for=night')}
      />
      <ChoiceRow
        title="Start a group"
        body="For a regular game with the same friends."
        onPress={() => router.push('/clubs/new')}
      />
      <ChoiceRow
        title="I got an invite"
        body="Join a game or group someone sent you."
        expanded={open === 'invite'}
        onPress={() => setOpen(open === 'invite' ? null : 'invite')}
      />
      {open === 'invite' ? (
        <InvitePanel
          onOpenPath={(path) => router.push(path as never)}
          onJoined={(clubId) => router.push(`/clubs/${clubId}/games`)}
        />
      ) : null}
      <ChoiceRow
        title="I'm new to mahjong"
        body="See how a game night works, or ask a friend to host one."
        expanded={open === 'new'}
        onPress={() => setOpen(open === 'new' ? null : 'new')}
      />
      {open === 'new' ? <NewPlayerPanel onHowItWorks={() => router.push('/how-it-works')} /> : null}
    </View>
  );
}

function ChoiceRow({
  title,
  body,
  onPress,
  expanded,
}: {
  title: string;
  body: string;
  onPress: () => void;
  expanded?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      aria-expanded={expanded}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceBody}>{body}</Text>
      </View>
      <Text style={styles.chevron}>{expanded === undefined ? '›' : expanded ? '−' : '+'}</Text>
    </Pressable>
  );
}

function InvitePanel({
  onOpenPath,
  onJoined,
}: {
  onOpenPath: (path: string) => void;
  onJoined: (clubId: string) => void;
}) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openLink() {
    const path = inAppPathFromLink(link);
    if (!path) {
      setError("That doesn't look like a MahjHero link. Try opening it from your text or email.");
      return;
    }
    onOpenPath(path);
  }

  return (
    <View style={styles.panel} testID="start-invite-panel">
      <Text style={styles.panelBody}>
        Open the link from your text or email. It brings you straight to the game. Or paste it
        here:
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Invite link"
          placeholder="Paste the link"
          placeholderTextColor={colors.neutral[600]}
          value={link}
          onChangeText={(t) => {
            setLink(t);
            setError(null);
          }}
          onSubmitEditing={openLink}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Button big={false} onPress={openLink} disabled={link.trim().length === 0} accessibilityLabel="Open link">
          Open
        </Button>
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <JoinClubCard onJoined={onJoined} />
    </View>
  );
}

function NewPlayerPanel({ onHowItWorks }: { onHowItWorks: () => void }) {
  const [shared, setShared] = useState<'shared' | 'copied' | 'failed' | null>(null);
  return (
    <View style={styles.panel} testID="start-new-panel">
      <Text style={styles.panelBody}>
        The easiest way to learn is a Mahj Night with friends. Beginners are welcome, and nobody
        needs to know the rules before they arrive.
      </Text>
      <View style={styles.buttons}>
        <Button
          big={false}
          onPress={async () => setShared(await shareAskAFriendToHost())}
          accessibilityLabel="Ask a friend to host"
        >
          Ask a friend to host
        </Button>
        <Button variant="secondary" big={false} onPress={onHowItWorks} accessibilityLabel="How it works">
          How it works
        </Button>
      </View>
      {shared === 'copied' ? (
        <Text style={styles.panelBody} accessibilityLiveRegion="polite">
          Copied. Paste it into a text to a friend.
        </Text>
      ) : shared === 'failed' ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          Could not share. Try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  heading: { fontFamily: type.heading, fontSize: 24, color: colors.text, paddingHorizontal: 4 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 64,
  },
  pressed: { opacity: 0.85 },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  choiceBody: { fontFamily: type.bodyRegular, fontSize: 14, lineHeight: 20, color: colors.neutral[700] },
  chevron: { fontFamily: type.bodyBold, fontSize: 22, color: colors.accent[700] },
  panel: { gap: 10, paddingHorizontal: 4, paddingBottom: 6 },
  panelBody: { fontFamily: type.bodyRegular, fontSize: 14, lineHeight: 20, color: colors.neutral[700] },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontFamily: type.bodyRegular,
    fontSize: 15,
    color: colors.text,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[700] },
});
