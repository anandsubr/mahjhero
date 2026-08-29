/*
 * Broadcasts become the announcements they always were.
 *
 * app/clubs/[id]/broadcast.tsx and broadcasts.tsx are deleted in this same
 * plan. The sent-history screen going away is only acceptable because the
 * thread replaces it — so nothing may be lost here.
 *
 * Written as a FUNCTION rather than a bare statement so it can be tested,
 * and so it is idempotent: `where not exists` keyed on broadcast_id means a
 * second run inserts nothing. The migration calls it once; the function
 * then stays as the thing the fixture exercises.
 */
create function public.backfill_broadcasts_into_threads()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Every club that ever broadcast needs its club thread to exist.
  insert into public.message_threads (club_id)
  select distinct b.club_id from public.broadcasts b
  on conflict (club_id) where event_id is null and club_id is not null
  do nothing;

  -- And every event that was ever targeted needs its game thread.
  insert into public.message_threads (club_id, event_id)
  select distinct b.club_id, b.event_id
    from public.broadcasts b
   where b.event_id is not null
  on conflict (event_id) where event_id is not null
  do nothing;

  /*
   * subject and body carried verbatim, created_at carried over so ordering
   * is preserved and a three-month-old announcement does not surface as
   * today's news.
   */
  insert into public.messages
    (thread_id, author_id, body, subject, is_announcement, broadcast_id, created_at)
  select t.id, b.author_id, b.body, b.subject, true, b.id, b.created_at
    from public.broadcasts b
    join public.message_threads t
      on t.club_id = b.club_id
     and t.event_id is not distinct from b.event_id
   where not exists (
     select 1 from public.messages m where m.broadcast_id = b.id
   );

  -- last_message_at from the newest message in each touched thread, so the
  -- Recent sort places a backfilled thread where its history says it goes.
  update public.message_threads t
     set last_message_at = newest.at
    from (
      select m.thread_id, max(m.created_at) as at
        from public.messages m
       group by m.thread_id
    ) newest
   where newest.thread_id = t.id
     and t.last_message_at is distinct from newest.at;
end;
$$;

select public.backfill_broadcasts_into_threads();

-- Internal, and the reason it is named explicitly rather than left to
-- `revoke … from public`: Supabase's hosted bootstrap grants execute to
-- `authenticated` at function-creation time, and this repository has been
-- bitten by that four times.
revoke execute on function public.backfill_broadcasts_into_threads()
  from public, anon, authenticated;
