/*
 * The app's first use of Realtime, and scoped to one table on purpose.
 *
 * `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what messages_select — and therefore
 * can_read_thread — allows, and nothing more. There is no second
 * authorization surface to keep in step.
 *
 * Only INSERT matters to the thread screen; messages are never edited or
 * deleted in this plan. The publication carries all operations because
 * Supabase's own publication is defined that way and narrowing it here
 * would be a difference to explain rather than a benefit.
 *
 * `replica identity full` is NOT set: the thread screen reads the new row
 * from the INSERT payload, which carries every column regardless. Setting
 * it would put the full old row into WAL for updates this table never
 * performs.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
