import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

/** A `fetch_friends` row. `club_names` is the clubs you STILL share — it is
 *  empty for a friend you acquired in a club one of you has since left, which
 *  is the ordinary cross-club case and not a failure. */
export type Friend = {
  profile_id: string;
  display_name: string;
  club_names: string[];
};

/** A `fetch_addable_people` row: somebody in one of your clubs who is not
 *  you and not already a friend. `club_name` is the alphabetically first
 *  club you share, chosen by the RPC's `distinct on`. */
export type AddablePerson = {
  profile_id: string;
  display_name: string;
  club_name: string;
};

/**
 * The artboard's muted line under a friend's name.
 *
 * Pure, so it is tested without a database. The empty case is the one worth
 * having: fetch_friends legitimately returns `{}` and a blank line would
 * read as a rendering bug rather than a fact about the friendship.
 */
export function sharedClubsLabel(clubNames: string[]): string {
  if (clubNames.length === 0) return 'No clubs in common';
  return clubNames.join(' · ');
}

/**
 * Never rejects — the friends screen awaits this directly, and an escaping
 * rejection would leave it spinning with no message. Same contract as
 * fetchProfile in lib/profile.ts.
 *
 * `null` means "we could not ask", `[]` means "you have no friends". The
 * screen shows an error for the first and the artboard's dashed empty card
 * for the second, and collapsing them would make a network failure look
 * like a fact about the member.
 */
export async function fetchFriends(): Promise<Friend[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_friends');
    if (error) {
      console.error('fetchFriends failed', error);
      return null;
    }
    return (data ?? []) as Friend[];
  } catch (cause) {
    console.error('fetchFriends failed', cause);
    return null;
  }
}

/** Same contract as fetchFriends above. */
export async function fetchAddablePeople(): Promise<AddablePerson[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_addable_people');
    if (error) {
      console.error('fetchAddablePeople failed', error);
      return null;
    }
    return (data ?? []) as AddablePerson[];
  } catch (cause) {
    console.error('fetchAddablePeople failed', cause);
    return null;
  }
}

/**
 * Relays `error.message` from `add_friend` verbatim rather than mapping it
 * through a refusal table. Its two refusals — 'you can only add someone
 * from one of your clubs' and 'you cannot add yourself' — are already
 * written to be read by a member. Same deliberate contract lib/messages.ts
 * records for postMessage.
 */
export async function addFriend(
  targetId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('add_friend', { target: targetId });
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('addFriend failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function removeFriend(
  targetId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('remove_friend', { target: targetId });
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('removeFriend failed', cause);
    return { error: GENERIC_ERROR };
  }
}
