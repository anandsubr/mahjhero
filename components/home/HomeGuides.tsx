import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Text } from '../Text';
import TipCard, { TipText } from '../TipCard';
import { canInvite, type Club, type ClubRole } from '../../lib/clubs';
import {
  hostChecklist,
  hostChecklistKey,
  type HostChecklistCounts,
} from '../../lib/guides';
import { type } from '../../lib/theme';
import { useGuides } from '../../lib/use-guides';

type Roles = { club_id: string; role: ClubRole }[];
type Guides = ReturnType<typeof useGuides>;
type Router = ReturnType<typeof useRouter>;

/**
 * The Clubs view's first-run guidance, carried over from the old dashboard:
 * the welcome card (no clubs yet), each hosted club's getting-started
 * checklist, and the player intro for members who organize nothing.
 */
export default function HomeGuides({
  clubs,
  roles,
  checklist,
  email,
  guides,
  router,
}: {
  clubs: Club[] | null;
  roles: Roles | null;
  checklist: Record<string, HostChecklistCounts | null>;
  email: string | undefined;
  guides: Guides;
  router: Router;
}) {
  const list = clubs ?? [];
  return (
    <>
      {clubs !== null && list.length === 0 && guides.isVisible('welcome') ? (
        <TipCard
          testID="welcome-card"
          tag="New here?"
          title="Welcome to MahjHero"
          onDismiss={() => guides.dismiss('welcome')}
        >
          <TipText>
            Organizing games? Start a club below, then schedule a game and invite your players.
          </TipText>
          <TipText>
            Joining a club? Enter its club code above, or ask its organizer to invite{' '}
            <Text style={styles.welcomeEmail}>{email || 'the email you signed in with'}</Text>.
          </TipText>
        </TipCard>
      ) : null}
      {list
        .filter((c) => roles?.some((r) => r.club_id === c.id && r.role === 'host'))
        .map((club) => {
          const key = hostChecklistKey(club.id);
          const counts = checklist[club.id];
          if (!counts || !guides.isVisible(key)) return null;
          const { steps, complete } = hostChecklist(counts);
          if (complete) return null;
          const next = steps.find((s) => !s.done);
          // 'hello' is never reached: it is the only optional step, and the
          // card hides once every required step is done.
          const action =
            next?.key === 'game'
              ? { label: 'Add a game', onPress: () => router.push(`/clubs/${club.id}/events/new`) }
              : next?.key === 'invite'
                ? { label: 'Invite players', onPress: () => router.push(`/clubs/${club.id}/members`) }
                : undefined;
          return (
            <TipCard
              key={key}
              testID={`host-checklist-${club.id}`}
              tag="Getting started"
              title={`Get ${club.name} going`}
              action={action}
              onDismiss={() => guides.dismiss(key)}
            >
              {steps.map((s) => (
                <TipText key={s.key}>
                  {s.done ? '✓ ' : '○ '}
                  <Text>{s.label}</Text>
                </TipText>
              ))}
            </TipCard>
          );
        })}
      {roles !== null && !roles.some((r) => canInvite(r.role)) && guides.isVisible('player-intro') ? (
        <TipCard
          testID="player-intro"
          tag="New here?"
          title="How MahjHero works"
          onDismiss={() => guides.dismiss('player-intro')}
        >
          <TipText>1. Join a club with its code, or accept an invite.</TipText>
          <TipText>2. When you’re invited to a game, accept it here on Home.</TipText>
          <TipText>3. Your games show up here under My games.</TipText>
        </TipCard>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  welcomeEmail: { fontFamily: type.bodyBold },
});
