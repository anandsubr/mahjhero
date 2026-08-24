/*
 * The four decisions the claim query makes, pulled out where they can be
 * tested one case at a time.
 *
 * Everything genuinely fiddly in this plan lives here: a quiet window that
 * wraps midnight, a reminder for a game that starts during one, and a
 * backoff schedule. Inline in the claim query, each of those would need its
 * own fixture — clubs, events, bookings, profiles — to exercise one boolean.
 */

/*
 * Is `p_at` inside this member's quiet window?
 *
 * `stable`, not `immutable`: `at time zone <text>` depends on the timezone
 * database, which can be updated under a running server.
 *
 * Inclusive at the start, exclusive at the end. The default window is
 * 21:00-08:00, which wraps midnight — so the obvious `p_start <= t and t <
 * p_end` is wrong for every member who never touched the setting. The
 * wrapping branch is the common case here, not the edge case.
 */
create function public.in_quiet_window(
  p_tz    text,
  p_start time,
  p_end   time,
  p_at    timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    -- A zero-length window holds nothing. Without this the wrapping branch
    -- below would return true for every instant of the day.
    when p_start = p_end then false
    when p_start <  p_end then (p_at at time zone p_tz)::time >= p_start
                           and (p_at at time zone p_tz)::time <  p_end
    else                       (p_at at time zone p_tz)::time >= p_start
                            or (p_at at time zone p_tz)::time <  p_end
  end;
$$;

/*
 * How quiet hours treat each kind. Three classes, from the parent spec's
 * section 7 rule 2.
 *
 * `never_held` is not a loophole — it is the eight kinds that exist because
 * somebody else acted on your seat. A promotion offer has a two-hour fuse;
 * holding it overnight guarantees it lapses unseen, which is worse than a
 * notification at 11pm about a seat you asked to be told about.
 *
 * An explicit `else` rather than listing all eight: a kind added by a later
 * plan defaults to being delivered, and a message that arrives when it
 * should have waited is a smaller failure than one that never arrives.
 */
create function public.outbox_quiet_class(p_kind public.outbox_kind)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'need_a_fourth'  then 'suppressible'
    when 'broadcast'      then 'suppressible'
    when 'event_reminder' then 'exempt_near_event'
    else 'never_held'
  end;
$$;

/*
 * When a message stops being worth sending.
 *
 * Event-bound kinds die when the game starts: nothing about a game is worth
 * saying once it has begun, and plan 4 already refuses every seat mutation
 * at that moment for the same reason.
 *
 * `event_cancelled` and `broadcast` are the exceptions, at a day from
 * creation. A cancellation is worth knowing after the slot passes — that is
 * when somebody would otherwise turn up — but not a week later.
 *
 * This is also what makes the first deploy safe. Plan 4 has been writing
 * outbox rows through weeks of development and test runs; without a horizon,
 * turning the drain on would mail every member a backlog of announcements
 * about games that finished in August.
 */
create function public.outbox_expires_at(
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
    when p_kind in ('event_cancelled', 'broadcast')
      then p_created_at + interval '24 hours'
    when p_starts_at is not null then p_starts_at
    else p_created_at + interval '24 hours'
  end;
$$;

/*
 * 5, 10, 20, 40, 80 minutes. A permanently bad address costs five sends
 * over about two and a half hours and then stops consuming batch slots
 * forever.
 *
 * `greatest(p_attempts, 1)` because attempts is incremented at claim, so
 * the first failure already reports 1; a 0 would halve the first delay for
 * no reason.
 */
create function public.outbox_backoff(p_attempts int)
returns interval
language sql
immutable
as $$
  select interval '5 minutes' * power(2, greatest(p_attempts, 1) - 1);
$$;

/*
 * Named rather than inlined so the claim, the mark-failed path, and the
 * tests cannot disagree about where the ceiling is.
 */
create function public.outbox_max_attempts()
returns int
language sql
immutable
as $$
  select 5;
$$;

revoke execute on function
  public.in_quiet_window(text, time, time, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.outbox_quiet_class(public.outbox_kind)
  from public, anon, authenticated;
revoke execute on function
  public.outbox_expires_at(public.outbox_kind, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.outbox_backoff(int)
  from public, anon, authenticated;
revoke execute on function public.outbox_max_attempts()
  from public, anon, authenticated;
