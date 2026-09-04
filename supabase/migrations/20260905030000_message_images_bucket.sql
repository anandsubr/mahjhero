-- The app's first Storage bucket. Private -- reads always go through a
-- short-lived signed URL (lib/attachments.ts), never the bucket's public
-- URL, because there is no public URL for a private bucket to leak.
--
-- Path convention: {thread_id}/{uuid}.jpg -- thread_id leads, and only that.
-- Not message_id: images upload before the message row exists (the client
-- uploads first, then calls post_message with the resulting paths). Not
-- author_id: the read policy only needs to answer "can this viewer see this
-- thread."
insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', false);

/*
 * can_read_thread and can_post_thread are already SECURITY DEFINER and
 * already granted to `authenticated` for exactly this reason (decision #2
 * in docs/messaging.md): an RLS USING/WITH CHECK expression runs as the
 * QUERYING USER, so a function it names must be callable by that user, not
 * only by the RPCs that use it internally.
 *
 * storage.foldername(name) splits the object path on '/' and returns it as
 * a text[]; [1] is the leading {thread_id} segment.
 */
create policy message_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-images'
    and public.can_read_thread((storage.foldername(name))[1]::uuid)
  );

create policy message_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images'
    and public.can_post_thread((storage.foldername(name))[1]::uuid)
  );

-- No update or delete policy: nothing in this design edits or removes an
-- attachment once posted, matching messages having no edit or delete.

-- Grant execute on can_post_thread to authenticated so it can be called from
-- RLS policies. (can_read_thread was already granted in thread_predicates.sql
-- because it's called from select policies; can_post_thread wasn't granted
-- there because it was only used inside RPCs, which call it as SECURITY
-- DEFINER. Now that an insert policy references it directly, we need to grant it.)
grant execute on function public.can_post_thread(uuid)
  to authenticated;
