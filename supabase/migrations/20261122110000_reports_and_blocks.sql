/*
 * Content reports and user blocks (App Store Guideline 1.2).
 *
 * Spec: docs/superpowers/specs/2026-11-22-app-store-1-0-design.md,
 * "Report and block".
 *
 *   1. Tables: user_blocks, content_reports. RLS on, no client grants;
 *      every read and write goes through the definer RPCs below.
 *   2. Helpers: is_admin() (internal), is_blocked_by_me(uuid) (named by the
 *      messages / club_media select policies, so granted to authenticated
 *      -- it only ever answers about the CALLER's own blocks).
 *   3. RPCs: report_content, block_user, unblock_user, fetch_my_blocks;
 *      admin-only fetch_reports, resolve_report.
 *   4. The effect of a block -- symmetric for contact, one-way for
 *      visibility:
 *        - can_reach (20260828000000) and can_post_thread (20260829010000)
 *          are false across a block in either direction, so neither person
 *          can start a DM with, add to a group, or post in a two-person
 *          thread with the other;
 *        - the blocker stops seeing the blocked person's messages, posts,
 *          replies and media: every read RPC the client uses is copied from
 *          its LATEST definition with only a block filter added (marked
 *          `-- CHANGED (blocks)`), and the messages / club_media select
 *          policies get the same filter so a direct table read (or a
 *          realtime INSERT payload, which RLS also gates) cannot leak what
 *          the RPCs hide.
 *      Nothing tells the blocked person: their own reads are unchanged, and
 *      create_group_thread's refusal is the existing "you can only message
 *      people from your clubs or your friends".
 *
 * Deliberately unchanged: stored reply_count / last_reply_at, and unread
 * counts (fetch_my_threads, my_unread_counts, the feed's per-post unread).
 * Opening the thread clears a hidden message's unread the normal way.
 */

-- ---------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- The primary key serves "who have I blocked"; this one serves "who blocked
-- me" (the either-direction check) and the cascade from profiles.
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table public.content_reports (
  id                  uuid primary key default gen_random_uuid(),
  reporter_id         uuid references public.profiles(id) on delete set null,
  kind                text not null
                        check (kind in ('message', 'club_media', 'profile')),
  message_id          uuid references public.messages(id) on delete set null,
  media_id            uuid references public.club_media(id) on delete set null,
  reported_profile_id uuid references public.profiles(id) on delete set null,
  club_id             uuid references public.clubs(id) on delete set null,
  reason              text not null
                        check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details             text check (char_length(details) <= 500),
  status              text not null default 'open'
                        check (status in ('open', 'removed', 'dismissed')),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid references public.profiles(id) on delete set null
);

create index content_reports_status_created_idx
  on public.content_reports (status, created_at desc);
-- One per set-null foreign key, so deleting a message, a media row or a
-- profile does not scan the table.
create index content_reports_message_idx  on public.content_reports (message_id);
create index content_reports_media_idx    on public.content_reports (media_id);
create index content_reports_reporter_idx on public.content_reports (reporter_id);
create index content_reports_reported_idx on public.content_reports (reported_profile_id);
create index content_reports_club_idx     on public.content_reports (club_id);
create index content_reports_resolver_idx on public.content_reports (resolved_by);

alter table public.user_blocks enable row level security;
alter table public.content_reports enable row level security;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke all on public.user_blocks from public, anon, authenticated;
revoke all on public.content_reports from public, anon, authenticated;
-- notify-report (Task 5) loads a report with the service role. Stated here
-- rather than relying on 20260822180200's default privileges.
grant select, insert, update, delete on public.user_blocks to service_role;
grant select, insert, update, delete on public.content_reports to service_role;

-- ---------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------

-- The caller's profiles.is_admin (20260903080000). Internal: the client
-- already reads its own flag from profiles.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false);
$$;
revoke execute on function public.is_admin() from public, anon, authenticated;

/*
 * Has the CALLER blocked this person? Named by the select policies below,
 * which run as the querying user -- user_blocks has no client grants, so
 * the policies cannot read it directly. Granted to authenticated for that
 * reason (the can_read_thread posture, 20260829010000); it only ever
 * answers about the caller's own blocks, which fetch_my_blocks lists anyway.
 */
create function public.is_blocked_by_me(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks ub
     where ub.blocker_id = (select auth.uid())
       and ub.blocked_id = target);
$$;
revoke execute on function public.is_blocked_by_me(uuid) from public, anon;
grant execute on function public.is_blocked_by_me(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3a. report_content: report a message, a club photo/file, or a person.
--
-- The caller must be able to read the target: a message in a thread they
-- can read, media in a club they belong to, or a person they share an
-- active club, a friendship (either direction) or a conversation with. An
-- unknown id gets the same refusal as an unreadable one, so ids cannot be
-- probed. Returns the report id (the client hands it to notify-report).
-- ---------------------------------------------------------------------
create function public.report_content(
  p_kind      text,
  p_target_id uuid,
  p_reason    text,
  p_details   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caller   uuid := (select auth.uid());
  clean    text := nullif(trim(coalesce(p_details, '')), '');
  msg      public.messages;
  media    public.club_media;
  subject  uuid;
  club     uuid;
  readable boolean := false;
  rid      uuid;
begin
  if caller is null then
    raise exception 'you cannot report this' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('message', 'club_media', 'profile') then
    raise exception 'unknown report kind' using errcode = '22023';
  end if;

  if p_reason is null
     or p_reason not in ('spam', 'harassment', 'inappropriate', 'other') then
    raise exception 'unknown report reason' using errcode = '22023';
  end if;

  if char_length(clean) > 500 then
    raise exception 'report details are too long' using errcode = '22023';
  end if;

  if p_kind = 'message' then
    select * into msg from public.messages where id = p_target_id;
    if found and public.can_read_thread(msg.thread_id) then
      readable := true;
      subject := msg.author_id;
      select t.club_id into club
        from public.message_threads t where t.id = msg.thread_id;
    end if;
  elsif p_kind = 'club_media' then
    select * into media from public.club_media where id = p_target_id;
    if found and public.is_club_member(media.club_id) then
      readable := true;
      subject := media.uploaded_by;
      club := media.club_id;
    end if;
  else
    subject := p_target_id;
    readable := p_target_id is not null and (
      p_target_id = caller
      or exists (
        select 1 from public.friendships f
         where (f.profile_id = caller and f.friend_id = p_target_id)
            or (f.profile_id = p_target_id and f.friend_id = caller))
      or exists (
        select 1
          from public.club_members m1
          join public.club_members m2 on m2.club_id = m1.club_id
         where m1.profile_id = caller and m1.status = 'active'
           and m2.profile_id = p_target_id and m2.status = 'active')
      or exists (
        select 1
          from public.thread_members t1
          join public.thread_members t2 on t2.thread_id = t1.thread_id
         where t1.profile_id = caller and t2.profile_id = p_target_id));
  end if;

  if not readable then
    raise exception 'you cannot report this' using errcode = '42501';
  end if;

  if subject = caller then
    raise exception 'you cannot report yourself' using errcode = '22023';
  end if;

  insert into public.content_reports
    (reporter_id, kind, message_id, media_id, reported_profile_id, club_id,
     reason, details)
  values
    (caller, p_kind,
     case when p_kind = 'message' then p_target_id end,
     case when p_kind = 'club_media' then p_target_id end,
     subject, club, p_reason, clean)
  returning id into rid;

  return rid;
end;
$$;
revoke execute on function public.report_content(text, uuid, text, text)
  from public, anon;
grant execute on function public.report_content(text, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 3b. block_user / unblock_user / fetch_my_blocks.
-- ---------------------------------------------------------------------
create function public.block_user(p_target uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_target is null or p_target = caller then
    raise exception 'you cannot block yourself' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'no such person' using errcode = '22023';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (caller, p_target)
  on conflict do nothing;
end;
$$;
revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Unblocking someone you have not blocked is a no-op, not an error.
create function public.unblock_user(p_target uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  delete from public.user_blocks
   where blocker_id = caller and blocked_id = p_target;
end;
$$;
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

create function public.fetch_my_blocks()
returns table (
  blocked_id   uuid,
  display_name text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
    select ub.blocked_id, p.display_name, ub.created_at
      from public.user_blocks ub
      join public.profiles p on p.id = ub.blocked_id
     where ub.blocker_id = caller
     order by lower(p.display_name), ub.blocked_id;
end;
$$;
revoke execute on function public.fetch_my_blocks() from public, anon;
grant execute on function public.fetch_my_blocks() to authenticated;

-- ---------------------------------------------------------------------
-- 3c. fetch_reports (admin): reports in one status, newest first, with
-- everything the admin screen needs to judge them. Content columns are null
-- once the content itself is gone.
-- ---------------------------------------------------------------------
create function public.fetch_reports(p_status text default 'open')
returns table (
  id                  uuid,
  kind                text,
  reason              text,
  details             text,
  status              text,
  created_at          timestamptz,
  resolved_at         timestamptz,
  resolved_by         uuid,
  reporter_id         uuid,
  reporter_name       text,
  reported_profile_id uuid,
  reported_name       text,
  message_id          uuid,
  message_body        text,
  message_thread_id   uuid,
  message_root_id     uuid,
  media_id            uuid,
  media_kind          text,
  media_path          text,
  media_name          text,
  club_id             uuid,
  club_name           text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if coalesce(p_status, 'open') not in ('open', 'removed', 'dismissed') then
    raise exception 'unknown report status' using errcode = '22023';
  end if;

  return query
    select r.id, r.kind, r.reason, r.details, r.status, r.created_at,
           r.resolved_at, r.resolved_by,
           r.reporter_id, rp.display_name,
           r.reported_profile_id, tp.display_name,
           r.message_id, m.body, m.thread_id, m.root_id,
           r.media_id, cm.kind, cm.storage_path, cm.file_name,
           r.club_id, c.name
      from public.content_reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles tp on tp.id = r.reported_profile_id
      left join public.messages m on m.id = r.message_id
      left join public.club_media cm on cm.id = r.media_id
      left join public.clubs c on c.id = r.club_id
     where r.status = coalesce(p_status, 'open')
     order by r.created_at desc, r.id desc;
end;
$$;
revoke execute on function public.fetch_reports(text) from public, anon;
grant execute on function public.fetch_reports(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3d. resolve_report (admin): 'remove' deletes the reported message (a
-- board root's replies with it -- root_id is `on delete set null`, so they
-- would otherwise surface as top-level posts; the rule delete_account_data
-- (20261122100000) follows) or the media row, then marks the report
-- removed; 'dismiss' only marks it dismissed. Other open reports on the
-- same content are resolved with it.
--
-- Returns the storage objects the removal orphaned -- (bucket,
-- storage_path) rows, the delete_account_data shape: 'message-images' for
-- the deleted messages' attachments, 'club-media' for a media row. The
-- database cannot delete Storage objects; a caller that wants them gone
-- deletes them with the service role (an admin is not necessarily a member
-- of the club, so the storage delete policies would refuse them).
--
-- A profile report has nothing to remove and can only be dismissed. Content
-- already gone (deleted by its author or its account) removes nothing and
-- just marks the report removed.
-- ---------------------------------------------------------------------
create function public.resolve_report(p_report uuid, p_action text)
returns table (bucket text, storage_path text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caller  uuid := (select auth.uid());
  r       public.content_reports;
  target  public.messages;
  doomed  uuid[] := '{}'::uuid[];
  path    text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('remove', 'dismiss') then
    raise exception 'unknown report action' using errcode = '22023';
  end if;

  select * into r from public.content_reports where id = p_report for update;
  if not found then
    raise exception 'no such report' using errcode = '22023';
  end if;

  if r.status <> 'open' then
    raise exception 'that report is already resolved' using errcode = '22023';
  end if;

  if p_action = 'dismiss' then
    update public.content_reports
       set status = 'dismissed', resolved_at = now(), resolved_by = caller
     where id = r.id;
    return;
  end if;

  if r.kind = 'profile' then
    raise exception 'a profile report can only be dismissed' using errcode = '22023';
  end if;

  if r.kind = 'message' and r.message_id is not null then
    select * into target from public.messages where id = r.message_id for update;

    if found then
      -- The message, and if it is a board root, every reply under it.
      doomed := array(
        select m.id from public.messages m
         where m.id = target.id
            or (target.root_id is null and m.root_id = target.id));

      -- Every open report on anything being deleted is resolved by this
      -- removal; done before the delete nulls their message_id.
      update public.content_reports
         set status = 'removed', resolved_at = now(), resolved_by = caller
       where status = 'open' and message_id = any(doomed);

      return query
        select 'message-images'::text, a.storage_path
          from public.message_attachments a
         where a.message_id = any(doomed);

      delete from public.messages where root_id = target.id;
      delete from public.messages where id = target.id;

      -- A removed reply stops counting toward (and sorting) its post: the
      -- same rebuild delete_account_data does (20261122100000).
      if target.root_id is not null then
        update public.messages a
           set reply_count = (select count(*)::int from public.messages y
                               where y.root_id = a.id),
               last_reply_at = (select max(y.created_at) from public.messages y
                                 where y.root_id = a.id)
         where a.id = target.root_id;
      end if;

      -- The thread sorts by what is left in it.
      update public.message_threads t
         set last_message_at = (
           select max(m.created_at) from public.messages m
            where m.thread_id = t.id)
       where t.id = target.thread_id;
    end if;
  elsif r.kind = 'club_media' and r.media_id is not null then
    update public.content_reports
       set status = 'removed', resolved_at = now(), resolved_by = caller
     where status = 'open' and media_id = r.media_id;

    delete from public.club_media where id = r.media_id
      returning club_media.storage_path into path;
    if path is not null then
      bucket := 'club-media';
      storage_path := path;
      return next;
    end if;
  end if;

  -- Covers content that was already gone (no rows matched above).
  update public.content_reports
     set status = 'removed', resolved_at = now(), resolved_by = caller
   where id = r.id and status = 'open';

  return;
end;
$$;
revoke execute on function public.resolve_report(uuid, text) from public, anon;
grant execute on function public.resolve_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4a. Contact: can_reach and can_post_thread.
-- ---------------------------------------------------------------------

-- Copied from 20260828000000_friendships.sql (its only definition).
create or replace function public.can_reach(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (exists (
    select 1 from public.friendships f
     where f.profile_id = a and f.friend_id = b
  ) or exists (
    select 1
      from public.club_members m1
      join public.club_members m2 on m2.club_id = m1.club_id
     where m1.profile_id = a and m1.status = 'active'
       and m2.profile_id = b and m2.status = 'active'
  ))
  -- CHANGED (blocks): never across a block, in either direction.
  and not exists (
    select 1 from public.user_blocks ub
     where (ub.blocker_id = a and ub.blocked_id = b)
        or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

-- Copied from 20260829010000_thread_predicates.sql (its only definition;
-- 20260905030000 only granted it). create or replace keeps that grant.
create or replace function public.can_post_thread(t uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := (select auth.uid());
  th     public.message_threads;
begin
  if viewer is null then return false; end if;

  select * into th from public.message_threads where id = t;
  if not found then return false; end if;

  if th.club_id is null then
    return exists (
      select 1 from public.thread_members m
       where m.thread_id = t and m.profile_id = viewer
    )
    -- CHANGED (blocks): a two-person thread (a DM) is closed to both people
    -- once either has blocked the other.
    and not (
      (select count(*) from public.thread_members m where m.thread_id = t) = 2
      and exists (
        select 1
          from public.thread_members o
          join public.user_blocks ub
            on (ub.blocker_id = viewer and ub.blocked_id = o.profile_id)
            or (ub.blocker_id = o.profile_id and ub.blocked_id = viewer)
         where o.thread_id = t and o.profile_id <> viewer
      )
    );
  end if;

  if th.event_id is not null then
    return exists (
      select 1 from public.bookings b
       where b.event_id = th.event_id
         and b.profile_id = viewer
         and b.status = 'confirmed'
    ) or public.is_club_organizer_of(th.club_id, viewer);
  end if;

  return exists (
    select 1 from public.club_members cm
     where cm.club_id = th.club_id
       and cm.profile_id = viewer
       and cm.status = 'active'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4b. Visibility: the select policies.
-- ---------------------------------------------------------------------

-- 20260829010000's messages_select, plus the block filter.
alter policy messages_select on public.messages
  using (public.can_read_thread(thread_id)
         and not public.is_blocked_by_me(author_id));  -- CHANGED (blocks)

-- 20261017110000's club_media_select_member, plus the block filter.
alter policy club_media_select_member on public.club_media
  using (public.is_club_member(club_id)
         and not public.is_blocked_by_me(uploaded_by));  -- CHANGED (blocks)

-- ---------------------------------------------------------------------
-- 4c. Visibility: the read RPCs. Each copied from its latest definition;
-- return shapes unchanged, so create or replace keeps the grants.
-- ---------------------------------------------------------------------

-- Copied from 20260905050000_message_reads_attachments.sql.
create or replace function public.fetch_thread_messages(target_thread uuid)
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
       -- CHANGED (blocks): a quote of a blocked person shows no text.
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = (select auth.uid())
            and ub.blocked_id = q.author_id)
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
       -- CHANGED (blocks)
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = (select auth.uid())
            and ub.blocked_id = m.author_id)
     order by m.created_at, m.id;
end;
$$;

-- Copied from 20260905050000_message_reads_attachments.sql.
create or replace function public.fetch_post_messages(p_root uuid)
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

  -- CHANGED (blocks): a blocked person's post reads, to the blocker, as a
  -- post that is no longer here -- not as its replies with no post above.
  if exists (
    select 1 from public.messages m
      join public.user_blocks ub
        on ub.blocker_id = (select auth.uid()) and ub.blocked_id = m.author_id
     where m.id = p_root
  ) then
    raise exception 'that post is no longer here' using errcode = '22023';
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
       -- CHANGED (blocks): a quote of a blocked person shows no text.
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = (select auth.uid())
            and ub.blocked_id = q.author_id)
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
     where (m.id = p_root or m.root_id = p_root)
       -- CHANGED (blocks)
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = (select auth.uid())
            and ub.blocked_id = m.author_id)
     order by m.created_at, m.id;
end;
$$;

-- Copied from 20260830021000_board_posts_are_club_only.sql.
create or replace function public.fetch_club_posts(
  target_thread uuid,
  p_limit       int default 30,
  p_before      timestamptz default null
)
returns table (
  id               uuid,
  author_id        uuid,
  author_name      text,
  body             text,
  subject          text,
  is_announcement  boolean,
  created_at       timestamptz,
  reply_count      int,
  last_reply_at    timestamptz,
  last_activity_at timestamptz,
  unread           int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller   uuid := (select auth.uid());
  floor_at timestamptz;
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.message_threads t
     where t.id = target_thread
       and t.club_id is not null
       and t.event_id is null
  ) then
    raise exception 'only a club has posts to list' using errcode = '22023';
  end if;

  select cm.joined_at into floor_at
    from public.message_threads t
    join public.club_members cm
      on cm.club_id = t.club_id
     and cm.profile_id = caller
     and cm.status = 'active'
   where t.id = target_thread;

  floor_at := coalesce(floor_at, 'infinity'::timestamptz);

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_count, m.last_reply_at,
           greatest(m.created_at, coalesce(m.last_reply_at, m.created_at)),
           coalesce(u.n, 0)
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join lateral (
        select count(*)::int as n
          from public.messages r
         where (r.id = m.id or r.root_id = m.id)
           and r.author_id <> caller
           and r.created_at > greatest(
                 floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = m.id
                              and pr.profile_id = caller),
                          floor_at))
      ) u on true
     where m.thread_id = target_thread
       and m.root_id is null
       -- CHANGED (blocks)
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = caller and ub.blocked_id = m.author_id)
       and (p_before is null
            or greatest(m.created_at, coalesce(m.last_reply_at, m.created_at))
                 < p_before)
     order by greatest(m.created_at, coalesce(m.last_reply_at, m.created_at)) desc,
              m.id desc
     limit least(coalesce(p_limit, 30), 100);
end;
$$;

-- Copied from 20261017100000_board_feed.sql (its only definition).
create or replace function public.fetch_club_feed(
  target_thread uuid,
  p_limit       int default 30,
  p_before      timestamptz default null,
  p_before_id   uuid default null,
  p_order       text default 'recent'
)
returns table (
  id               uuid,
  author_id        uuid,
  author_name      text,
  body             text,
  subject          text,
  is_announcement  boolean,
  created_at       timestamptz,
  reply_count      int,
  last_reply_at    timestamptz,
  last_activity_at timestamptz,
  unread           int,
  author_role      public.club_role,
  heart_count      int,
  hearted_by_me    boolean,
  attachments      jsonb,
  recent_comments  jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller    uuid := (select auth.uid());
  floor_at  timestamptz;
  thread_club uuid;
  by_activity boolean;
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  select t.club_id into thread_club
    from public.message_threads t
   where t.id = target_thread
     and t.club_id is not null
     and t.event_id is null;
  if thread_club is null then
    raise exception 'only a club has posts to list' using errcode = '22023';
  end if;

  case coalesce(p_order, 'recent')
    when 'recent'   then by_activity := false;
    when 'activity' then by_activity := true;
    else raise exception 'unknown feed order' using errcode = '22023';
  end case;

  select cm.joined_at into floor_at
    from public.club_members cm
   where cm.club_id = thread_club
     and cm.profile_id = caller
     and cm.status = 'active';

  floor_at := coalesce(floor_at, 'infinity'::timestamptz);

  return query
    with posts as (
      select m.*,
             greatest(m.created_at, coalesce(m.last_reply_at, m.created_at))
               as activity_at
        from public.messages m
       where m.thread_id = target_thread
         and m.root_id is null
         -- CHANGED (blocks)
         and not exists (
           select 1 from public.user_blocks ub
            where ub.blocker_id = caller and ub.blocked_id = m.author_id)
    ), keyed as (
      select po.*,
             case when by_activity then po.activity_at else po.created_at end
               as order_key
        from posts po
    )
    select k.id, k.author_id, p.display_name, k.body, k.subject,
           k.is_announcement, k.created_at, k.reply_count, k.last_reply_at,
           k.activity_at,
           coalesce(u.n, 0),
           am.role,
           coalesce(h.n, 0),
           coalesce(h.mine, false),
           coalesce(att.items, '[]'::jsonb),
           coalesce(rc.items, '[]'::jsonb)
      from keyed k
      join public.profiles p on p.id = k.author_id
      left join public.club_members am
        on am.club_id = thread_club
       and am.profile_id = k.author_id
       and am.status = 'active'
      left join lateral (
        select count(*)::int as n
          from public.messages r
         where (r.id = k.id or r.root_id = k.id)
           and r.author_id <> caller
           and r.created_at > greatest(
                 floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = k.id
                              and pr.profile_id = caller),
                          floor_at))
      ) u on true
      left join lateral (
        select count(*)::int as n,
               bool_or(ph.profile_id = caller) as mine
          from public.post_hearts ph
         where ph.message_id = k.id
      ) h on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', a.id, 'storage_path', a.storage_path,
                   'width', a.width, 'height', a.height,
                   'sort_order', a.sort_order
                 ) order by a.sort_order
               ) as items
          from public.message_attachments a
         where a.message_id = k.id and a.thread_id = k.thread_id
      ) att on true
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', last2.id, 'author_id', last2.author_id,
                   'author_name', last2.display_name, 'body', last2.body,
                   'created_at', last2.created_at
                 ) order by last2.created_at, last2.id
               ) as items
          from (
            select r.id, r.author_id, rp.display_name, r.body, r.created_at
              from public.messages r
              join public.profiles rp on rp.id = r.author_id
             where r.root_id = k.id
               -- CHANGED (blocks)
               and not exists (
                 select 1 from public.user_blocks ub
                  where ub.blocker_id = caller and ub.blocked_id = r.author_id)
             order by r.created_at desc, r.id desc
             limit 2
          ) last2
      ) rc on true
     where p_before is null
        or (p_before_id is null and k.order_key < p_before)
        or (p_before_id is not null and (k.order_key, k.id) < (p_before, p_before_id))
     order by k.order_key desc, k.id desc
     limit least(coalesce(p_limit, 30), 100);
end;
$$;

-- Copied from 20261017110000_club_media.sql (its only definition;
-- 20261017120000 redefined add_club_media, not this).
create or replace function public.fetch_club_media(
  target_club uuid,
  p_kind      text,
  p_before    timestamptz default null,
  p_limit     int default 60
)
returns table (
  id            uuid,
  club_id       uuid,
  kind          text,
  storage_path  text,
  file_name     text,
  mime_type     text,
  size_bytes    int,
  width         int,
  height        int,
  uploaded_by   uuid,
  uploader_name text,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not public.is_club_member(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('photo', 'file') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  return query
    select m.id, m.club_id, m.kind, m.storage_path, m.file_name, m.mime_type,
           m.size_bytes, m.width, m.height, m.uploaded_by, p.display_name,
           m.created_at
      from public.club_media m
      join public.profiles p on p.id = m.uploaded_by
     where m.club_id = target_club
       and m.kind = p_kind
       -- CHANGED (blocks)
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = caller and ub.blocked_id = m.uploaded_by)
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 60), 1), 500);
end;
$$;

-- Copied from 20261021100000_optional_game_name.sql (latest; its own
-- `-- CHANGED` marker is that migration's, kept verbatim). Only the preview
-- (`last`) changes: it skips messages by people the viewer has blocked.
create or replace function public.fetch_my_threads()
returns table (
  thread_id            uuid,
  kind                 text,
  title                text,
  club_id              uuid,
  club_name            text,
  member_count         int,
  last_body            text,
  last_author          text,
  last_is_announcement boolean,
  last_message_at      timestamptz,
  unread               int,
  event_id             uuid,
  event_starts_at      timestamptz,
  event_timezone       text
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (select (select auth.uid()) as id),

  /*
   * One row per thread the viewer should see, carrying the FLOOR that
   * unread counts from. The floor is never earlier than the moment they
   * joined — without it, a member joining a three-year-old club opens the
   * app to a badge reading 400, and somebody added to an old group inherits
   * a stranger's backlog as their own homework.
   */
  visible as (
    -- Club threads: one per active membership, row or no row.
    select c.id            as club_id,
           null::uuid      as event_id,
           t.id            as thread_id,
           'club'::text    as kind,
           cm.joined_at    as floor_at,
           t.title         as raw_title,
           t.last_message_at
      from viewer v
      join public.club_members cm
        on cm.profile_id = v.id and cm.status = 'active'
      join public.clubs c on c.id = cm.club_id
      left join public.message_threads t
        on t.club_id = c.id and t.event_id is null

    union all

    -- Game threads: with at least one message, until 24 hours after the
    -- game ends. Not deleted then — still readable from the game screen —
    -- it simply stops competing for attention in a list about what happens
    -- next.
    select t.club_id, t.event_id, t.id, 'game'::text,
           cm.joined_at, t.title, t.last_message_at
      from viewer v
      join public.message_threads t on t.event_id is not null
      join public.events e on e.id = t.event_id
      join public.club_members cm
        on cm.club_id = t.club_id
       and cm.profile_id = v.id
       and cm.status = 'active'
     where t.last_message_at is not null
       and now() < e.ends_at + interval '24 hours'
       and public.can_read_thread(t.id)

    union all

    -- Groups: always, from creation. joined_at is the floor here.
    select t.club_id, t.event_id, t.id, 'group'::text,
           tm.joined_at, t.title, t.last_message_at
      from viewer v
      join public.thread_members tm on tm.profile_id = v.id
      join public.message_threads t
        on t.id = tm.thread_id and t.club_id is null
  )

  select
    v.thread_id,
    -- A direct message is a group of two, decided here rather than stored.
    case when v.kind = 'group' and coalesce(g.member_count, 0) = 2
         then 'direct' else v.kind end,
    case
      -- Just the club's name -- see 20260829090000's header comment for why
      -- this no longer says "Everyone at " (this migration only reproduces
      -- that change verbatim; see this file's own header for why).
      when v.kind = 'club' then c.name
      when v.kind = 'game' then public.event_headline(e.title, e.game_mode)  -- CHANGED
      when coalesce(g.member_count, 0) = 2 then g.other_name
      -- An untitled group is named from its members at READ time. A name
      -- frozen at creation goes stale the moment somebody is added.
      else coalesce(nullif(trim(v.raw_title), ''), g.first_names)
    end,
    v.club_id,
    c.name,
    case
      when v.kind = 'club' then (
        select count(*)::int from public.club_members cm
         where cm.club_id = v.club_id and cm.status = 'active')
      when v.kind = 'game' then (
        select count(*)::int from public.bookings b
         where b.event_id = v.event_id and b.status = 'confirmed')
      else coalesce(g.member_count, 0)
    end,
    last.body,
    last.display_name,
    coalesce(last.is_announcement, false),
    v.last_message_at,
    coalesce(u.n, 0),
    v.event_id,
    e.starts_at,
    c.timezone
  from visible v
  left join public.clubs c on c.id = v.club_id
  left join public.events e on e.id = v.event_id

  left join lateral (
    select m.body, m.is_announcement, p.display_name
      from public.messages m
      join public.profiles p on p.id = m.author_id
     where m.thread_id = v.thread_id
       -- CHANGED (blocks)
       and not exists (
         select 1 from public.user_blocks ub
          where ub.blocker_id = (select auth.uid())
            and ub.blocked_id = m.author_id)
     order by m.created_at desc
     limit 1
  ) last on true

  left join lateral (
    select count(*)::int as member_count,
           string_agg(split_part(p.display_name, ' ', 1), ', '
                      order by p.display_name)
             filter (where p.id <> (select auth.uid())) as first_names,
           -- Only ever read when member_count = 2, where max() over one row
           -- is that row.
           max(p.display_name)
             filter (where p.id <> (select auth.uid())) as other_name
      from public.thread_members tm
      join public.profiles p on p.id = tm.profile_id
     where tm.thread_id = v.thread_id
  ) g on v.kind = 'group'

  left join lateral (
    /*
     * A club thread's watermark is per POST; every other kind's is the
     * single thread_reads row it has always been.
     *
     * The club branch reads each message's OWN post's marker — `coalesce(
     * m.root_id, m.id)` is the post a message belongs to, which for a root
     * is itself. That is what makes reading one announcement leave the
     * others' dots alone, and it is the whole reason post_reads exists.
     *
     * Both branches floor at v.floor_at, so a member joining an old club
     * still does not inherit a stranger's backlog as their own homework.
     */
    select case when v.kind = 'club' then (
        select count(*)::int
          from public.messages m
         where m.thread_id = v.thread_id
           and m.author_id <> (select auth.uid())
           and m.created_at > greatest(
                 v.floor_at,
                 coalesce((select pr.last_read_at
                             from public.post_reads pr
                            where pr.root_id = coalesce(m.root_id, m.id)
                              and pr.profile_id = (select auth.uid())),
                          v.floor_at))
      ) else (
        select count(*)::int
          from public.messages m
         where m.thread_id = v.thread_id
           and m.author_id <> (select auth.uid())
           and m.created_at > greatest(
                 v.floor_at,
                 coalesce((select tr.last_read_at
                             from public.thread_reads tr
                            where tr.thread_id = v.thread_id
                              and tr.profile_id = (select auth.uid())),
                          v.floor_at))
      ) end as n
  ) u on true

  order by v.last_message_at desc nulls last;
$$;
