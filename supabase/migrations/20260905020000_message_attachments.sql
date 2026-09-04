/*
 * Images attached to a message, up to four, ordered.
 *
 * Same shape as messages.reply_to_id and root_id, and the same reason: a
 * bare `references messages(id)` would be a disclosure bug. A member of two
 * clubs could otherwise cause an attachment row to reference a message in a
 * thread they cannot read, and nothing downstream asks whether the reader
 * may see it -- can_read_thread is asked about a row's OWN thread_id, and a
 * bare message_id carries none of its own to be asked about. See decision
 * #4 in docs/messaging.md.
 *
 * width/height are captured client-side at pick time, not recomputed here --
 * MessageBubble needs them to lay out a correctly-aspect-ratioed placeholder
 * before the signed URL resolves, and asking Postgres to introspect a file
 * it never decodes is unnecessary work.
 */
create table public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null,
  thread_id     uuid not null,
  storage_path  text not null,
  width         int not null check (width > 0),
  height        int not null check (height > 0),
  sort_order    smallint not null check (sort_order between 0 and 3),
  created_at    timestamptz not null default now(),

  unique (message_id, sort_order),

  foreign key (message_id, thread_id)
    references public.messages (id, thread_id) on delete cascade
);

-- The reply screen's read: every attachment for the messages on one page,
-- resolved by lib/messages.ts's batched signed-URL fetch.
create index message_attachments_message on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

-- revoke all first, not belt-and-braces: Supabase grants ALL on every new
-- table in `public` to `authenticated` by default, and ALL includes
-- TRUNCATE, which RLS does not govern. See 20260829000000's own comment.
revoke all on public.message_attachments from authenticated;
grant select on public.message_attachments to authenticated;

-- Rows are written only by post_message (20260905040000), inside the same
-- transaction as the message itself -- never a direct client insert.
create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (public.can_read_thread(thread_id));
