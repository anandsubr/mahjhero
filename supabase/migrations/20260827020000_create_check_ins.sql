/*
 * Attendance: one row per person per event.
 *
 * Four shapes carry the design and are worth reading before changing
 * anything:
 *
 *   1. There is no booking_id. The row is keyed on (event_id, profile_id).
 *      A walk-in — a member who turns up without a seat — has no booking to
 *      hang a record off, and keying on the person makes them the same row
 *      shape as everybody else rather than a special case. It also means
 *      the record survives a booking being cancelled before the start.
 *
 *   2. `unique (event_id, profile_id)` is what makes the write idempotent.
 *      A replayed write cannot duplicate because there is nowhere for a
 *      second row to go. Plan 5 ships online-only, but the offline follow-up
 *      needs exactly this and it costs nothing to have now.
 *
 *   3. `recorded_at` is caller-supplied, defaulting to now(), and
 *      record_attendance applies a write only when it is NEWER than the
 *      stored value. Online this is invisible. It is what stops a write that
 *      sat in a phone's queue for ten minutes clobbering a decision the host
 *      has made since.
 *
 *   4. ABSENCE OF A ROW MEANS "NOT DETERMINED". It is never backfilled to
 *      no_show. A host who tried check-in for twenty minutes and gave up
 *      would otherwise generate a night of fabricated no-shows, and absence
 *      of a judgment is not a judgment.
 */
create type public.attendance_state as enum ('arrived', 'no_show');

create table public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  club_id     uuid not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  state       public.attendance_state not null,
  -- The member themselves for a self check-in, an organizer otherwise.
  -- Task 5 reads this to decide whether the write is worth telling the
  -- organizers about: a host marking a no-show already knows.
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),

  -- Composite, so a row whose club disagrees with its event's is
  -- unrepresentable rather than merely unlikely. Plan 4 uses this shape
  -- throughout for the same reason.
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,

  unique (event_id, profile_id)
);

-- The door screen's read: every row for one event.
create index check_ins_event_idx on public.check_ins (event_id);
-- The member's own read, which the policy below scopes to.
create index check_ins_profile_idx on public.check_ins (profile_id);

alter table public.check_ins enable row level security;

/*
 * Self-only select, and NO write policy at all.
 *
 * This one policy is the entire member read path — "have I checked in?" —
 * so no function is needed for it. Writes are a different matter: the
 * window rules, the role split and the walk-in path are not expressible as
 * a policy, and every one of them has to hold. So `authenticated` gets
 * select and nothing else, and Task 4's definer functions are the only way
 * a row is ever created, changed or removed.
 *
 * `(select auth.uid())` matches push_tokens (20260826020000). The bare
 * `auth.uid()` used by older policies is semantically identical.
 */
create policy check_ins_select_own on public.check_ins
  for select using (profile_id = (select auth.uid()));

/*
 * `revoke all` first, and it is not belt-and-braces. Supabase grants ALL on
 * every table in `public` to `authenticated` by default; ALL includes
 * TRUNCATE, which is NOT subject to row-level security. Without this line
 * the policy above stops nothing — any signed-in member could empty the
 * table. supabase/tests/database/portable/grants.test.sql exists entirely
 * because of this.
 */
revoke all on public.check_ins from anon, authenticated;
grant select on public.check_ins to authenticated;
