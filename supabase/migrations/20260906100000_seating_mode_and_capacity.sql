/*
 * Optional tables, for the 60-70 player event.
 *
 * An organizer running that many people cannot pre-assign tables — who
 * turns up is not known until the door — but still needs signup, check-in
 * and payment. So seating becomes a per-event mode carried the same way
 * check_in_required, fee_cents and game_mode already are: template
 * (event_series) -> materialization (events) -> per-occurrence override
 * tracked in events.overrides.
 *
 * Deliberately NO clubs.default_seating_mode. game_mode has a club default
 * because a club is either an open-play club or an invite-only one; how a
 * given night seats people is a property of that night, and the design
 * research found it genuinely varies event to event within one club.
 *
 * `capacity` is nullable and means "the headcount limit", used ONLY when
 * seating_mode = 'open_seating' (assigned_tables keeps deriving capacity by
 * summing event_tables, exactly as today). Null means uncapped. It is
 * deliberately NOT constrained to open-seating rows: an organizer who
 * toggles to assigned_tables and back should find their number still there
 * rather than having it destroyed by a mode switch.
 */
create type public.seating_mode as enum ('assigned_tables', 'open_seating');

alter table public.event_series
  add column seating_mode public.seating_mode not null
    default 'assigned_tables',
  add column capacity int check (capacity is null or capacity > 0);

alter table public.events
  add column seating_mode public.seating_mode not null
    default 'assigned_tables',
  add column capacity int check (capacity is null or capacity > 0);

/*
 * Two more override keys. Dropped and re-added rather than altered: a check
 * constraint's expression cannot be modified in place (same reasoning
 * 20260827000000 already documents for this exact constraint).
 */
alter table public.events
  drop constraint events_overrides_known_keys;

alter table public.events
  add constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at',
                       'check_in_required', 'fee_cents', 'min_spend_cents',
                       'game_mode', 'seating_mode', 'capacity']
    and array_ndims(overrides) = 1
  );

/*
 * An open-seating series may materialize zero tables. The original check was
 * written inline and unnamed, so Postgres auto-named it
 * event_series_table_count_check; it is dropped by that name and replaced
 * with a mode-aware table-level constraint. assigned_tables keeps its
 * "at least one" floor untouched.
 */
alter table public.event_series
  drop constraint event_series_table_count_check;

alter table public.event_series
  add constraint event_series_table_count_check check (
    case when seating_mode = 'open_seating'
         then table_count between 0 and 20
         else table_count between 1 and 20
    end
  );
