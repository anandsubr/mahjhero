import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type Greeting = {
  id: string;
  text: string;
  created_at: string;
};

export const GREETING_COLUMNS = 'id, text, created_at';

/** Never rejects — same contract as lib/profile.ts's fetchProfile. */
export async function fetchGreetings(): Promise<Greeting[] | null> {
  try {
    const { data, error } = await supabase
      .from('greetings')
      .select(GREETING_COLUMNS)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('fetchGreetings failed', error);
      return null;
    }
    return (data ?? []) as Greeting[];
  } catch (cause) {
    console.error('fetchGreetings failed', cause);
    return null;
  }
}

/** Never rejects — same contract as lib/profile.ts's updateProfile. */
export async function addGreeting(text: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('greetings').insert({ text });
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('addGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Never rejects. `.select('id')` is what turns a zero-row RLS denial into
 *  an observable failure, the same reason lib/profile.ts's updateProfile
 *  carries it. */
export async function updateGreeting(
  id: string,
  text: string,
): Promise<{ error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('greetings')
      .update({ text })
      .eq('id', id)
      .select('id');
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: GENERIC_ERROR };
    return { error: null };
  } catch (cause) {
    console.error('updateGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Never rejects. */
export async function deleteGreeting(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('greetings').delete().eq('id', id);
    if (error) return { error: error.message };
    return { error: null };
  } catch (cause) {
    console.error('deleteGreeting failed', cause);
    return { error: GENERIC_ERROR };
  }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** No fairness/collision-resistance requirement, same reasoning as
 *  lib/dashboard.ts's glyphForClub — this is decoration, not a security
 *  boundary, just "stable across a day, spreads reasonably". */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic, not re-rolled per render: every member sees the same
 * greeting all day (device-local calendar date), and it changes at local
 * midnight. `null` for an empty list — the dashboard simply shows no
 * greeting line in that case, not an error state.
 */
export function pickDailyGreeting(greetings: Greeting[], date: Date): Greeting | null {
  if (greetings.length === 0) return null;
  const index = hashString(localDateKey(date)) % greetings.length;
  return greetings[index];
}

/**
 * Substitutes the signed-in member's own display name for every `{name}`
 * token in a greeting template. Falls back to "Member" for a blank display
 * name — a real, reachable state (a magic-link signup starts with
 * `display_name = ''`), matching the same fallback word
 * app/clubs/[id]/index.tsx's own roster rendering already uses.
 */
export function applyGreetingTemplate(template: string, displayName: string): string {
  const name = displayName.trim().length > 0 ? displayName.trim() : 'Member';
  return template.replaceAll('{name}', name);
}
