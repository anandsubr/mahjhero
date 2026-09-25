import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type VenueVisibility = 'club' | 'public';

export type Venue = {
  id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  visibility: VenueVisibility;
};

/** A `search_venues` row. `is_own_club` drives the grouping in the picker. */
export type VenueMatch = {
  id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  visibility: VenueVisibility;
  is_own_club: boolean;
};

/**
 * The exact select list the client relies on, named once so the schema
 * contract test (lib/schema-contract.test.ts) can import it directly rather
 * than retyping it — see lib/profile.ts's PROFILE_COLUMNS for the pattern
 * this follows. A column dropped here without the test noticing is exactly
 * the drift the contract suite exists to catch.
 */
export const VENUE_COLUMNS =
  'id, name, address_line, locality, region, postal_code, visibility';

/**
 * The typeahead's only data source. Goes through the RPC rather than a
 * filtered select because the ordering — own club first, then public — is the
 * function's job, and because the function checks that the caller is actually
 * a member of the club it is searching on behalf of.
 */
export async function searchVenues(
  clubId: string,
  query: string,
): Promise<VenueMatch[] | null> {
  try {
    const { data, error } = await supabase.rpc('search_venues', {
      target_club: clubId,
      q: query,
    });

    if (error) {
      console.error('searchVenues failed', error);
      return null;
    }
    return (data ?? []) as VenueMatch[];
  } catch (cause) {
    console.error('searchVenues failed', cause);
    return null;
  }
}

/**
 * The management screen's list: this club's own venues, archived ones
 * excluded. Deliberately not `searchVenues` with an empty query — that also
 * returns public venues from other clubs, which this club cannot edit and
 * should not be offered edit controls for.
 */
export async function fetchClubVenues(
  clubId: string,
): Promise<Venue[] | null> {
  try {
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_COLUMNS)
      .eq('added_by_club_id', clubId)
      .is('archived_at', null)
      .order('name');

    if (error) {
      console.error('fetchClubVenues failed', error);
      return null;
    }
    return data as Venue[];
  } catch (cause) {
    console.error('fetchClubVenues failed', cause);
    return null;
  }
}

export async function createVenue(input: {
  clubId: string;
  name: string;
  addressLine?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  sharePublicly?: boolean;
}): Promise<{ venueId: string | null; error: string | null }> {
  try {
    if (input.name.trim().length === 0) {
      return { venueId: null, error: 'Give the venue a name.' };
    }
    const { data, error } = await supabase.rpc('create_venue', {
      venue_name: input.name.trim(),
      address_line: input.addressLine ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
      target_club: input.clubId,
      share_publicly: input.sharePublicly ?? false,
    });

    if (error || !data) {
      console.error('createVenue failed', error);
      // A duplicate public venue is a real answer, not a system fault, and
      // the host can act on it — so it does not get the generic message.
      if (error?.code === '23505') {
        return {
          venueId: null,
          error: 'A shared venue with that name already exists here.',
        };
      }
      return { venueId: null, error: GENERIC_ERROR };
    }
    return { venueId: data as string, error: null };
  } catch (cause) {
    console.error('createVenue failed', cause);
    return { venueId: null, error: GENERIC_ERROR };
  }
}

export async function updateVenue(
  venueId: string,
  input: {
    name?: string | null;
    addressLine?: string | null;
    locality?: string | null;
    region?: string | null;
    postalCode?: string | null;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_venue', {
      target_venue: venueId,
      venue_name: input.name ?? null,
      address_line: input.addressLine ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
    });

    if (error) {
      console.error('updateVenue failed', error);
      // The same mapping createVenue has carried since it was written, and
      // for the same reason: renaming a public venue onto a name another
      // public venue already holds trips the partial unique index, which is
      // a real answer the host can act on, not a system fault. Without this,
      // the rename reported "Could not reach MahjHero. Check your
      // connection" — a false statement about a request that arrived and was
      // refused on purpose — so the create and edit paths disagreed about
      // one rule.
      if (error.code === '23505') {
        return { error: 'A shared venue with that name already exists here.' };
      }
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateVenue failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function archiveVenue(
  venueId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('archive_venue', {
      target_venue: venueId,
    });
    if (error) {
      console.error('archiveVenue failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('archiveVenue failed', cause);
    return { error: GENERIC_ERROR };
  }
}
