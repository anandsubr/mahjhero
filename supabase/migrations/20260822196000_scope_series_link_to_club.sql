/*
 * Two fixes to the events schema, one a regression introduced by
 * 20260822195000 and one the bug class that regression made dangerous.
 *
 * Both are forward-only; neither earlier migration is edited.
 */

/*
 * Critical: 20260822195000's `before delete` trigger on event_series broke
 * club deletion.
 *
 * `delete from clubs` cascades to event_series (created before events, so
 * its cascade always runs first -- this is deterministic, not ordering
 * luck), the cascade fires the trigger, and the trigger's UPDATE re-checks
 * events_club_id_fkey against a clubs row that no longer exists:
 *
 *   ERROR:  insert or update on table "events" violates foreign key
 *           constraint "events_club_id_fkey"
 *   DETAIL: Key (club_id)=(...) is not present in table "clubs".
 *   CONTEXT: SQL statement "update public.events set series_id = null,
 *            occurrence_date = null where series_id = old.id"
 *
 * Deleting such a club worked before the trigger and stopped working after
 * it. The fix is to skip occurrences whose club is itself being deleted:
 * they are about to be cascade-deleted by events_club_id_fkey in the same
 * statement, so there is nothing to preserve them for. This is not a
 * workaround for the FK error -- detaching a row that is about to cease
 * existing is meaningless work, and the FK is only telling us so.
 *
 * The composite foreign key added below is what makes the skip provably
 * safe rather than merely observed to work: it guarantees every event
 * referencing this series carries this series' club_id, so "the club is
 * gone" is now equivalent to "this event is in the set the club cascade is
 * deleting". Before that FK existed, a cross-club occurrence could have
 * been skipped and then stranded pointing at a deleted series.
 */
create or replace function public.event_series_detach_occurrences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events e
  set series_id = null,
      occurrence_date = null
  where e.series_id = old.id
    and exists (select 1 from public.clubs c where c.id = e.club_id);

  return old;
end;
$$;

-- `create or replace` preserves the existing ACL, but the revoke is
-- restated rather than assumed: this function runs with definer rights and
-- is only ever reached through the trigger.
revoke execute on function public.event_series_detach_occurrences()
  from public, anon;

/*
 * Important: events -> event_series was a single-column foreign key, so a
 * cross-tenant series link was representable.
 *
 * event_tables got the composite `(event_id, club_id) -> events(id,
 * club_id)` treatment in 20260822194000 precisely so a child whose club_id
 * disagrees with its parent's cannot exist. The events -> event_series edge
 * never got it, and an event in club B could reference club A's series.
 * Deleting that series in club A then rewrote the club-B row through a
 * `security definer` trigger -- a cross-tenant write with definer rights,
 * not merely a mislabelled row. No `authenticated` DML grant makes it
 * reachable today; it is closed at the schema level anyway, because this is
 * the bug class that keeps recurring here and because the club-cascade skip
 * above depends on it.
 */
alter table public.event_series
  add constraint event_series_id_club_unique unique (id, club_id);

alter table public.events
  drop constraint events_series_id_fkey;

/*
 * `on delete no action`, chosen by experiment against the live database
 * rather than by argument. Every alternative was built and every delete
 * path run against it; each of the four rejected itself on evidence:
 *
 *   on delete set null            -- SET NULL on a composite FK nulls EVERY
 *                                    column of the key, club_id included:
 *                                    "null value in column club_id of
 *                                    relation events violates not-null
 *                                    constraint" (23502).
 *   on delete set null (series_id) -- nulls series_id and leaves
 *                                    occurrence_date populated, which is
 *                                    exactly the 23514 on
 *                                    events_occurrence_requires_series that
 *                                    20260822195000 existed to fix.
 *   ... deferrable initially deferred (either action)
 *                                 -- defers the FK's INSERT check too, so
 *                                    the cross-club occurrence above is
 *                                    accepted by the INSERT and only
 *                                    rejected at COMMIT. The constraint
 *                                    that exists to make a cross-tenant row
 *                                    unrepresentable must fail the
 *                                    statement that writes it.
 *
 * NO ACTION was the only one that both rejects the cross-club link at the
 * INSERT and survives every delete path. It is also the honest choice for
 * what it means: with the trigger in front of it, the referential action
 * never has live rows to act on -- a direct series delete has already had
 * both columns cleared, and a club cascade has already deleted the events.
 * If it ever does fire, a 23503 naming the real dangling reference beats
 * either alternative's misdirected error.
 */
alter table public.events
  add constraint events_series_id_fkey
  foreign key (series_id, club_id)
  references public.event_series (id, club_id)
  on delete no action;
