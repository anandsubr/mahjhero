import { Redirect, useLocalSearchParams } from 'expo-router';

/** The club's own URL lands on the hub's default section, Games. */
export default function ClubIndex() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/clubs/${id}/games`} />;
}
