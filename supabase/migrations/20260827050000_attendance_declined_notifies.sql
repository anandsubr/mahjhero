/*
 * Why this kind needs its own expiry branch.
 *
 * outbox_expires_at's default for an event-bound kind is starts_at:
 * nothing about a game is worth saying once it has begun. This kind is the
 * exception that proves it -- it exists precisely BECAUSE the game has
 * begun and plan 4 refuses cancellation at that point. Queued at 7:02pm for
 * a 7:00pm game, it would otherwise be born expired and swept without ever
 * being sent.
 *
 * 24 hours from creation, matching event_cancelled and broadcast, and for
 * the same reason those two have it: the message is worth knowing after the
 * slot passes -- that is when the host is standing there wondering -- but
 * not a week later.
 *
 * Signature unchanged, so `create or replace` is correct here and the
 * grants allowlist needs no edit.
 */
create or replace function public.outbox_expires_at(
  p_kind       public.outbox_kind,
  p_created_at timestamptz,
  p_starts_at  timestamptz
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('event_cancelled', 'broadcast', 'attendance_declined')
      then p_created_at + interval '24 hours'
    when p_starts_at is not null then p_starts_at
    else p_created_at + interval '24 hours'
  end;
$$;

/*
 * outbox_quiet_class needs no change: its `else 'never_held'` default
 * already covers the new kind, which is correct -- a message that exists
 * because the game is happening right now must never be held for quiet
 * hours.
 *
 * record_attendance's signature is unchanged, so `create or replace` is
 * correct here too. The body below is copied verbatim from
 * 20260827030000_attendance_mutations.sql -- including the security-fix
 * clamp on occurred_at -- with one addition: the notification queue block
 * immediately before the final `end;`.
 */
create or replace function public.record_attendance(
  target_event   uuid,
  target_profile uuid,
  new_state      public.attendance_state,
  occurred_at    timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        public.events;
  caller    uuid := auth.uid();
  organizer boolean;
  applied   int;
begin
  ev := public.assert_attendance_writable(target_event);
  organizer := public.is_club_organizer(ev.club_id);

  if not organizer and target_profile <> caller then
    raise exception 'you can only check yourself in' using errcode = '42501';
  end if;

  if not public.attendance_window_open(ev.starts_at, ev.ends_at, organizer)
  then
    raise exception 'check-in is not open for this event'
      using errcode = '23514';
  end if;

  -- Whoever is being recorded has to be on the roster. For an organizer
  -- this is the walk-in path's only limit: guest attendance is deferred
  -- indefinitely on the roadmap, so the picker searches members only.
  if not exists (
    select 1 from public.club_members m
     where m.club_id = ev.club_id
       and m.profile_id = target_profile
       and m.status = 'active')
  then
    raise exception 'that person is not a member of this club'
      using errcode = '23514', detail = target_profile::text;
  end if;

  -- A member checking themselves in needs a seat. Without this, anybody on
  -- the roster could mark themselves present at a game they never booked,
  -- and the walk-in path -- a host observing a physical fact -- becomes
  -- self-service.
  if not organizer and not exists (
    select 1 from public.bookings b
     where b.event_id = target_event
       and b.profile_id = caller
       and b.status = 'confirmed')
  then
    raise exception 'you do not have a seat at this game'
      using errcode = '23514';
  end if;

  /*
   * Newest-wins. `where excluded.recorded_at > check_ins.recorded_at` makes
   * a stale write a silent no-op rather than an error: it represents a
   * decision that has since been superseded, and reporting that as a
   * failure would be a lie. Online, occurred_at is always now() and this
   * never fires.
   *
   * `least(coalesce(occurred_at, now()), now())` clamps the stored value to
   * the present, never to the past. The clamp is one-sided on purpose. A
   * future occurred_at is never legitimate -- nobody can report what will
   * happen next -- and without the clamp a caller can mint a recorded_at
   * that no later write will ever beat (e.g. 'infinity'), permanently
   * freezing this row against every future organizer correction while the
   * function still returns success. A past occurred_at is different: it is
   * the entire reason the parameter exists, since a later offline plan
   * queues a write on a phone and replays it with the timestamp of the
   * moment the host actually tapped, which is legitimately behind now().
   * Rejecting that would break the feature the parameter is for, so only
   * the future side is clamped.
   */
  insert into public.check_ins
    (event_id, club_id, profile_id, state, recorded_by, recorded_at)
  values
    (target_event, ev.club_id, target_profile, new_state, caller,
     least(coalesce(occurred_at, now()), now()))
  on conflict (event_id, profile_id) do update
    set state       = excluded.state,
        recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at
    where excluded.recorded_at > check_ins.recorded_at;

  -- `applied` is 0 when the upsert's own `where excluded.recorded_at >
  -- check_ins.recorded_at` filtered the conflicting row out -- i.e. this
  -- write was a stale no-op, superseded by a decision already on record.
  -- On a fresh insert (no conflict) this is 1 unconditionally. Read
  -- immediately after the INSERT statement, before anything else can reset
  -- it.
  get diagnostics applied = row_count;

  /*
   * The one notification in this plan.
   *
   * Only a MEMBER'S OWN no_show is worth sending. A host marking a no-show
   * already knows, and ordinary arrivals would be a stream of noise on a
   * busy night -- sixteen messages for one game that told the host nothing
   * they were not already watching happen.
   *
   * `caller = target_profile` rather than `not organizer`: a host who
   * cannot make their own club's game is reporting the same fact as
   * anybody else, and the other organizers want to hear it.
   *
   * `applied > 0` gates this against exactly the case the staleness rule
   * above exists for: a stale write that lands as a no-op must not still
   * tell the organizers "Jane can't make it" while the stored row says
   * something else (e.g. 'arrived', recorded by the host after Jane's
   * queued no_show was stamped). Unreachable online today, since
   * occurred_at is always now() and no write can ever be stale against
   * itself -- reachable the moment a deferred offline replay ships, which
   * is the entire reason occurred_at is a parameter at all.
   *
   * The dedupe key holds one notice per (event, member, recipient), so a
   * member who declines, undoes, and declines again does not tell the host
   * twice. clear_attendance sends nothing at all: once "Jane can't make it"
   * is delivered there is no recalling it, and a second message saying she
   * can after all is worth less than the confusion it causes. The host sees
   * the live truth on the door screen, which is the surface that matters.
   */
  if new_state = 'no_show' and caller = target_profile and applied > 0 then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select m.profile_id, ev.club_id, target_event, 'attendance_declined',
           jsonb_build_object('declined_by', target_profile),
           'attendance_declined:' || target_event::text || ':'
             || target_profile::text || ':' || m.profile_id::text
      from public.club_members m
     where m.club_id = ev.club_id
       and m.status = 'active'
       and m.role in ('host', 'co_organizer')
       and m.profile_id <> target_profile
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;
