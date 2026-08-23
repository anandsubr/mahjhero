/*
 * `booking_groups`' FK to `event_tables` is composite --
 * (preferred_table_id, event_id) references (id, event_id) -- and an
 * unqualified `ON DELETE SET NULL` on a composite FK nulls EVERY
 * referencing column when it fires, not just the one that pointed at the
 * deleted row. `event_id` is NOT NULL, so any path that deletes an
 * event_tables row a group prefers, without first nulling
 * preferred_table_id itself, trips 23502 trying to null event_id into its
 * own NOT NULL constraint.
 *
 * remove_event_table (20260825040000) already works around this by nulling
 * preferred_table_id before its DELETE. But that is not the only path that
 * can delete an event_tables row a group prefers: series shortening
 * (20260824000000) deletes future `events` rows, which cascades via
 * event_tables' own `on delete cascade` FK to events (20260822194000) into
 * that occurrence's event_tables rows too. Nothing along that path nulls
 * preferred_table_id first, so correctness there would depend on which of
 * two triggers -- this SET NULL, or the events-to-event_tables cascade
 * removing the row event_tables pointed to -- happens to fire first. That
 * is not a property anybody should have to reason about, let alone rely
 * on for correctness.
 *
 * Postgres (9.5+, confirmed on 17.6 both locally and on the hosted
 * project) lets a composite FK's ON DELETE SET NULL name the specific
 * column(s) to null, rather than defaulting to all of them. Scoping it to
 * just preferred_table_id makes the correct behaviour the only possible
 * one: deleting the table always nulls exactly the column that pointed at
 * it, never event_id, regardless of trigger firing order or which caller
 * remembered to null it first.
 *
 * Drop and re-add in the same ALTER TABLE so there is no window where the
 * table has no FK on this pair at all.
 */
alter table public.booking_groups
  drop constraint booking_groups_preferred_table_id_event_id_fkey,
  add  constraint booking_groups_preferred_table_id_event_id_fkey
    foreign key (preferred_table_id, event_id)
    references public.event_tables (id, event_id)
    on delete set null (preferred_table_id);
