import { useRouter } from 'expo-router';
import { Text } from '../Text';
import TipCard, { TipText } from '../TipCard';
import { canInvite, type Club, type ClubRole } from '../../lib/clubs';
import {
  hostChecklist,
  hostChecklistKey,
  type HostChecklistCounts,
} from '../../lib/guides';
import { useGuides } from '../../lib/use-guides';

type Roles = { club_id: string; role: ClubRole }[];
type Guides = ReturnType<typeof useGuides>;
type Router = ReturnType<typeof useRouter>;

/**
 * The Groups view's first-run guidance: each hosted group's getting-started
 * checklist, and the player intro for members who host nothing. Someone with
 * no groups at all sees StartChoices instead, which replaced the old
 * welcome card.
 */
export default function HomeGuides({
  clubs,
  roles,
  checklist,
  guides,
  router,
}: {
  clubs: Club[] | null;
  roles: Roles | null;
  checklist: Record<string, HostChecklistCounts | null>;
  guides: Guides;
  router: Router;
}) {
  const list = clubs ?? [];
  return (
    <>
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
          <TipText>1. Join a group with its code, or accept an invite.</TipText>
          <TipText>2. When you’re invited to a game, accept it here on Home.</TipText>
          <TipText>3. Your games show up here under Games.</TipText>
        </TipCard>
      ) : null}
    </>
  );
}
