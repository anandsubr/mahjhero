/*
 * fetch_thread_messages and fetch_post_messages learn to return each
 * message's attachments, resolved with a lateral aggregate rather than a
 * second round trip -- the same choice fetch_thread_messages already made
 * for the quoted-parent join (20260829080000).
 *
 * DROP then CREATE: both functions' RETURNS TABLE shape changes (a new
 * trailing column), which is a signature change for grants.test.sql
 * purposes exactly as post_message's parameter change was -- both entries
 * there change from `(uuid)` to the same `(uuid)`, since the return type is
 * not part of a function's identity in pg_proc/regprocedure. Confirmed: no
 * grants.test.sql edit is needed for THIS migration, only Task 3's.
 */
drop function public.fetch_thread_messages(uuid);
drop function public.fetch_post_messages(uuid);

create function public.fetch_thread_messages(target_thread uuid)
returns table (
  id              uuid,
  author_id       uuid,
  author_name     text,
  body            text,
  subject         text,
  is_announcement boolean,
  created_at      timestamptz,
  reply_to_id     uuid,
  reply_to_body   text,
  reply_to_author text,
  attachments     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name,
           coalesce(att.attachments, '[]'::jsonb)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height
                 ) order by a.sort_order
               ) as attachments
          from public.message_attachments a
         where a.message_id = m.id and a.thread_id = m.thread_id
      ) att on true
     where m.thread_id = target_thread
     order by m.created_at, m.id;
end;
$$;

create function public.fetch_post_messages(p_root uuid)
returns table (
  id              uuid,
  author_id       uuid,
  author_name     text,
  body            text,
  subject         text,
  is_announcement boolean,
  created_at      timestamptz,
  reply_to_id     uuid,
  reply_to_body   text,
  reply_to_author text,
  attachments     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  th uuid;
begin
  select m.thread_id into th
    from public.messages m
   where m.id = p_root and m.root_id is null;

  if th is null then
    raise exception 'that post is no longer here' using errcode = '22023';
  end if;

  if not public.can_read_thread(th) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name,
           coalesce(att.attachments, '[]'::jsonb)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height
                 ) order by a.sort_order
               ) as attachments
          from public.message_attachments a
         where a.message_id = m.id and a.thread_id = m.thread_id
      ) att on true
     where m.id = p_root or m.root_id = p_root
     order by m.created_at, m.id;
end;
$$;

revoke execute on function public.fetch_thread_messages(uuid) from public, anon;
revoke execute on function public.fetch_post_messages(uuid) from public, anon;
grant execute on function public.fetch_thread_messages(uuid) to authenticated;
grant execute on function public.fetch_post_messages(uuid) to authenticated;
