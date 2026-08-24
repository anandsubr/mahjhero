/*
 * Push is wired but dark, and this function is the whole of the wiring.
 *
 * Every branch returns 'email' today. That is not an oversight and it is
 * not dead code — the two decision points (what did the member ask for,
 * and do they have a device registered) are the two the later push plan
 * needs, and having them here means that plan changes two return values
 * rather than inventing a resolver under live traffic.
 */
create function public.resolve_notify_channel(p_profile uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref     public.notify_channel;
  has_push boolean;
begin
  select notify_channel into pref from public.profiles where id = p_profile;
  -- No profile, no channel. The caller expires the row rather than
  -- retrying something that cannot succeed.
  if pref is null then return null; end if;

  select exists (
    select 1 from public.push_tokens t where t.profile_id = p_profile
  ) into has_push;

  if pref = 'email' then return 'email'; end if;
  -- A member who asked for push and has no device gets email. This stays
  -- true after the push plan lands; it is the fallback, not the stopgap.
  if not has_push then return 'email'; end if;

  -- The one line the push plan changes: `return pref::text`.
  return 'email';
end;
$$;

/*
 * An id-only payload, joined into something a template can read.
 *
 * The Edge Function could fetch this itself under the service role, and
 * that is precisely the design being avoided: it would need read access
 * across the whole schema and would re-implement tenancy rules that already
 * live inside security definer functions. One RPC returning render-ready
 * rows keeps the function a renderer with no business logic in it — which
 * is also what makes it testable without a database.
 *
 * Every join is LEFT except profiles, auth.users and clubs. A club-wide
 * broadcast has no event; an event-cancelled message has no booking; only
 * some kinds involve a table. A single INNER join anywhere here would
 * silently drop whole classes of message from every batch.
 */
create function public.outbox_render_context(p_ids uuid[])
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  recipient_id      uuid,
  recipient_name    text,
  recipient_email   text,
  channel           text,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
  -- Whoever did the thing this message is about: booked the seat, declined
  -- it, or cancelled it. "Alice saved you a seat" is a different email from
  -- "someone saved you a seat".
  actor_name        text,
  broadcast_subject text,
  broadcast_body    text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.kind,
         o.payload,
         o.recipient_id,
         p.display_name,
         u.email,
         public.resolve_notify_channel(o.recipient_id),
         o.club_id,
         c.name,
         o.event_id,
         e.title,
         e.starts_at,
         c.timezone,
         t.label,
         pa.display_name,
         bc.subject,
         bc.body,
         o.created_at
    from public.notification_outbox o
    join public.profiles p on p.id = o.recipient_id
    join auth.users      u on u.id = o.recipient_id
    join public.clubs    c on c.id = o.club_id
    left join public.events e on e.id = o.event_id
    /*
     * Compared as text, deliberately. Casting `payload->>'booking_id'` to
     * uuid would raise 22P02 for any kind whose payload has no such key or
     * whose value is not a uuid — killing the whole batch because one
     * message had a differently shaped payload. Text comparison simply
     * misses instead.
     */
    left join public.bookings bk
           on bk.id::text = o.payload->>'booking_id'
    left join public.event_tables t
           on t.id::text = coalesce(o.payload->>'event_table_id',
                                    bk.event_table_id::text)
    left join public.broadcasts bc
           on bc.id::text = o.payload->>'broadcast_id'
    /*
     * The actor, whichever key this kind uses to name them. coalesce rather
     * than three joins because exactly one of these is ever present and the
     * templates only ever want "who did this".
     */
    left join public.profiles pa
           on pa.id::text = coalesce(o.payload->>'booked_by',
                                     o.payload->>'declined_by',
                                     o.payload->>'cancelled_by')
   where o.id = any(p_ids);
$$;

revoke execute on function public.resolve_notify_channel(uuid)
  from public, anon, authenticated;
revoke execute on function public.outbox_render_context(uuid[])
  from public, anon, authenticated;
