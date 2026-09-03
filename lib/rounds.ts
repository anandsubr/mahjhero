import { bookingErrorMessage } from './bookings';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type TableRound = {
  id: string;
  event_table_id: string;
  winner_profile_id: string;
  points: number;
  recorded_by: string;
  created_at: string;
};

/**
 * Every round across an event's tables, newest first. Fetched per-event
 * (not per-table) because the event screen already loads once per event
 * and TableCard filters to its own `event_table_id` client-side, the same
 * pattern `seating`/`tableOccupants` already use one level up.
 *
 * A plain RLS-scoped select, not an RPC: `table_rounds_select_member`
 * (20260902060000) is exactly the audience this needs -- any club member
 * -- so there is no organizer-only asymmetry the way `check_ins` has, and
 * no name-resolution to do server-side either (winner display names are
 * joined against the roster the event screen already fetches).
 */
export async function fetchTableRounds(
  eventId: string,
): Promise<TableRound[] | null> {
  try {
    const { data, error } = await supabase
      .from('table_rounds')
      .select('id, event_table_id, winner_profile_id, points, recorded_by, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchTableRounds failed', error);
      return null;
    }
    return (data ?? []) as TableRound[];
  } catch (cause) {
    console.error('fetchTableRounds failed', cause);
    return null;
  }
}

export async function recordRound(input: {
  tableId: string;
  winnerProfileId: string;
  points: number;
}): Promise<{ round: TableRound | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('record_round', {
      target_table: input.tableId,
      winner_profile: input.winnerProfileId,
      target_points: input.points,
    });
    if (error) {
      console.error('recordRound failed', error);
      return { round: null, error: bookingErrorMessage(error) };
    }
    return { round: data as TableRound, error: null };
  } catch (cause) {
    console.error('recordRound failed', cause);
    return { round: null, error: GENERIC_ERROR };
  }
}

export async function deleteRound(
  roundId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('delete_round', {
      target_round: roundId,
    });
    if (error) {
      console.error('deleteRound failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('deleteRound failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * Sums points per winner, in first-seen order (the order they appear in
 * `rounds`, not sorted by total) -- the running-totals line on a table
 * card. Pure, no I/O, so unlike the three functions above this needs no
 * supabase double to test.
 */
export function roundTotals(
  rounds: TableRound[],
): { profileId: string; points: number }[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const r of rounds) {
    if (!totals.has(r.winner_profile_id)) {
      order.push(r.winner_profile_id);
      totals.set(r.winner_profile_id, 0);
    }
    totals.set(r.winner_profile_id, totals.get(r.winner_profile_id)! + r.points);
  }
  return order.map((profileId) => ({ profileId, points: totals.get(profileId)! }));
}
