/*
 * The host writes once and everybody hears it.
 *
 * A broadcast is a stored record rather than a fire-and-forget fan-out for
 * three reasons: the host's first question after mailing fifty people is
 * whether it went; the broadcast id anchors a per-recipient dedupe key, so
 * one insert statement fanning out to many recipients cannot collapse onto
 * a single outbox row (see the note on send_broadcast's insert); and the
 * body has to survive somewhere for the Edge Function to render, since the
 * outbox payload carries ids and never prose.
 */
create table public.broadcasts (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  -- Null means the whole roster. Not a separate table and not an enum: the
  -- two targets differ only in who they resolve to.
  event_id        uuid references public.events(id) on delete cascade,
  author_id       uuid not null references public.profiles(id),
  subject         text not null check (length(trim(subject)) between 1 and 120),
  body            text not null check (length(trim(body)) between 1 and 2000),
  -- Written by the fan-out in the same transaction, so the sent history can
  -- say "went to 14 members" without counting outbox rows at read time.
  recipient_count int not null default 0,
  created_at      timestamptz not null default now(),

  /*
   * Composite, so a broadcast cannot point at an event belonging to a
   * different club. Plan 3's tenancy bugs were all of this shape and plan 4
   * put the same guard on `bookings`. The runtime check in send_broadcast
   * is the friendly error; this is the one that makes the state
   * unrepresentable.
   */
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade
);

create index broadcasts_club_recent
  on public.broadcasts (club_id, created_at desc);

-- ---------------------------------------------------------------------
-- Who hears it.
-- ---------------------------------------------------------------------

/*
 * One function, both targets, so the count the compose screen previews and
 * the set the fan-out writes can never disagree. They disagree the moment
 * this is two queries in two places.
 *
 * The author is NOT excluded here — send_broadcast excludes them and
 * broadcast_recipient_count does too, but each does it against its own
 * caller. Putting it here would make the function lie to any future caller
 * that is not the author.
 */
create function public.broadcast_recipients(
  target_club  uuid,
  target_event uuid
)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select cm.profile_id
    from public.club_members cm
   where target_event is null
     and cm.club_id = target_club
     and cm.status = 'active'
  union
  select b.profile_id
    from public.bookings b
   where target_event is not null
     and b.event_id = target_event
     and b.status = 'confirmed';
$$;

/*
 * `union`, not `union all` — kept as a defensive choice, not because a
 * duplicate profile_id is reachable today. The two branches are mutually
 * exclusive per call (`target_event is null` vs `is not null`), so they
 * never both contribute rows to the same result. And within the bookings
 * branch alone, `bookings_one_active_per_person_idx` (a unique index on
 * (event_id, profile_id) where status in ('confirmed', 'waitlisted'),
 * defined in 20260825000000_create_bookings.sql) already makes it
 * impossible for one profile to hold two confirmed bookings at the same
 * event. `union` costs nothing here and outlives a future relaxation of
 * that index better than `union all` would.
 */

create function public.broadcast_recipient_count(
  target_club  uuid,
  target_event uuid
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform public.assert_club_organizer(target_club);

  if target_event is not null then
    perform 1 from public.events
      where id = target_event and club_id = target_club;
    if not found then
      raise exception 'event does not belong to this club'
        using errcode = '42501';
    end if;
  end if;

  select count(*)::int into n
    from public.broadcast_recipients(target_club, target_event) r
   where r.profile_id <> (select auth.uid());
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Sending.
-- ---------------------------------------------------------------------
create function public.send_broadcast(
  target_club  uuid,
  target_event uuid,
  p_subject    text,
  p_body       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  new_id uuid;
  told   int;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Raises 42501 for anyone who is not host or co-organizer. Reused rather
  -- than reimplemented, so the UI's `canInvite` gate and this one cannot
  -- drift apart.
  perform public.assert_club_organizer(target_club);

  if target_event is not null then
    perform 1 from public.events
      where id = target_event and club_id = target_club;
    if not found then
      raise exception 'event does not belong to this club'
        using errcode = '42501';
    end if;
  end if;

  insert into public.broadcasts (club_id, event_id, author_id, subject, body)
  values (target_club, target_event, caller, p_subject, p_body)
  returning id into new_id;

  /*
   * The dedupe key carries the recipient, not just the broadcast. A
   * multi-row INSERT ... ON CONFLICT DO NOTHING checks each row against the
   * unique index as it is inserted, including rows the same statement has
   * already placed — so a key of `broadcast:<id>` alone would keep exactly
   * ONE row for the entire fan-out and tell one person. Plan 4's
   * announce_table_fourth has the same note for the same reason.
   *
   * `on conflict ... do nothing` is a belt-and-braces guard here, not a
   * resume mechanism: new_id is generated fresh inside this same
   * transaction on every call, so no later call can ever collide with an
   * earlier one's keys. It only protects against this one statement
   * producing duplicate keys for itself, which broadcast_recipients'
   * `union` (not `union all`) already prevents.
   */
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select r.profile_id, target_club, target_event, 'broadcast',
         jsonb_build_object('broadcast_id', new_id),
         'broadcast:' || new_id::text || ':' || r.profile_id::text
    from public.broadcast_recipients(target_club, target_event) r
   -- You do not need mailing about the thing you just wrote.
   where r.profile_id <> caller
  on conflict (dedupe_key) do nothing;

  get diagnostics told = row_count;
  update public.broadcasts set recipient_count = told where id = new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------
alter table public.broadcasts enable row level security;

/*
 * Organizers of the club, and nobody else. Not the roster: a broadcast
 * arrives by email, and a member browsing every announcement a host ever
 * sent — including ones sent to a different event they were not part of —
 * is a feature nobody asked for.
 *
 * Goes through is_club_organizer rather than assert_club_organizer: the
 * latter raises on failure, which a policy cannot use — a policy wants
 * false, not an exception.
 */
create policy broadcasts_select_organizer on public.broadcasts
  for select using (
    public.is_club_organizer(broadcasts.club_id)
  );

revoke all on public.broadcasts from anon, authenticated;
grant select on public.broadcasts to authenticated;

/*
 * The `authenticated` revoke is the one that matters. Supabase's hosted
 * bootstrap grants EXECUTE to `authenticated` at function-creation time and
 * `revoke ... from public` never clears it — the gap that was retro-fixed
 * in 20260823020000, 20260823030000, 20260823060000 and 20260825061000, and
 * which is invisible against the local stack because it grants
 * `authenticated` nothing by default.
 */
revoke execute on function public.broadcast_recipients(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.broadcast_recipient_count(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.broadcast_recipient_count(uuid, uuid)
  to authenticated;

revoke execute on function public.send_broadcast(uuid, uuid, text, text)
  from public, anon, authenticated;
grant  execute on function public.send_broadcast(uuid, uuid, text, text)
  to authenticated;
