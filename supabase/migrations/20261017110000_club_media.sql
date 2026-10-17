/*
 * Photos & Files (club-hub phase 5): a club's shared media library.
 *
 * Objects live in the private `club-media` bucket under
 *   {club_id}/photos/{uuid}.jpg
 *   {club_id}/files/{uuid}/{sanitised file name}
 * and each one gets a `club_media` row recording who added it and what it
 * is. Members read rows through RLS; rows are written only by the two RPCs
 * below. The client uploads the object first, then calls add_club_media; on
 * removal it calls remove_club_media, then deletes the object at the path
 * that RPC returns.
 */

create table public.club_media (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id) on delete cascade,
  kind         text not null check (kind in ('photo', 'file')),
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int  not null,
  width        int,
  height       int,
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index club_media_club_kind_created_idx
  on public.club_media (club_id, kind, created_at desc);
create index club_media_uploaded_by_idx on public.club_media (uploaded_by);

alter table public.club_media enable row level security;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke all on public.club_media from public, anon, authenticated;
grant select on public.club_media to authenticated;

create policy club_media_select_member on public.club_media
  for select to authenticated
  using (public.is_club_member(club_id));

-- ---------------------------------------------------------------------
-- add_club_media: record an object the caller has just uploaded.
-- ---------------------------------------------------------------------
create function public.add_club_media(
  target_club    uuid,
  p_kind         text,
  p_storage_path text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   int,
  p_width        int default null,
  p_height       int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  prefix text;
  new_id uuid;
begin
  if caller is null or not public.is_club_member(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('photo', 'file') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  -- starts_with, not LIKE: a club id has no wildcards, but the rest of a
  -- caller-supplied prefix check should never be pattern-interpreted. A bare
  -- prefix with nothing after it, and any `..`, are refused outright.
  prefix := target_club::text || case p_kind when 'photo' then '/photos/' else '/files/' end;
  if p_storage_path is null
     or not starts_with(p_storage_path, prefix)
     or char_length(p_storage_path) <= char_length(prefix)
     or position('..' in p_storage_path) > 0 then
    raise exception 'invalid_path' using errcode = '22023';
  end if;

  -- The object must already be uploaded, and by the caller: a member cannot
  -- claim another member's object (or a path nothing was uploaded to) as
  -- their own media. owner_id is the text uid the Storage API stamps on
  -- every upload.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'club-media'
      and o.name = p_storage_path
      and o.owner_id = caller::text
  ) then
    raise exception 'invalid_path' using errcode = '22023';
  end if;

  if p_file_name is null
     or char_length(p_file_name) not between 1 and 255
     or p_size_bytes is null
     or p_size_bytes < 0
     or (p_width is not null and p_width <= 0)
     or (p_height is not null and p_height <= 0) then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  -- Photos are always compressed to JPEG client-side before upload.
  if p_kind = 'photo' and p_mime_type is distinct from 'image/jpeg' then
    raise exception 'file_not_allowed' using errcode = '22023';
  end if;

  if p_kind = 'file' then
    if p_mime_type is null or p_mime_type not in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain'
    ) then
      raise exception 'file_not_allowed' using errcode = '22023';
    end if;
    if p_size_bytes > 10485760 then
      raise exception 'file_too_large' using errcode = '22023';
    end if;
  end if;

  insert into public.club_media
    (club_id, kind, storage_path, file_name, mime_type, size_bytes, width, height, uploaded_by)
  values
    (target_club, p_kind, p_storage_path, p_file_name, p_mime_type, p_size_bytes,
     p_width, p_height, caller)
  returning id into new_id;

  return new_id;
end;
$$;
revoke execute on function public.add_club_media(uuid, text, text, text, text, int, int, int)
  from public, anon;
grant execute on function public.add_club_media(uuid, text, text, text, text, int, int, int)
  to authenticated;

-- ---------------------------------------------------------------------
-- remove_club_media: delete a row (uploader who is still an active member,
-- or an organizer) and return its
-- storage path so the client can delete the object. An unknown id gets the
-- same refusal as someone else's, so ids cannot be probed.
-- ---------------------------------------------------------------------
create function public.remove_club_media(media_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  m      public.club_media;
begin
  if caller is not null then
    select * into m from public.club_media where id = media_id for update;
  end if;

  if m.id is null
     or not ((m.uploaded_by = caller and public.is_club_member(m.club_id))
             or public.is_club_organizer(m.club_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  delete from public.club_media where id = m.id;
  return m.storage_path;
end;
$$;
revoke execute on function public.remove_club_media(uuid) from public, anon;
grant execute on function public.remove_club_media(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket, folder-scoped to the club.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('club-media', 'club-media', false);

create policy club_media_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'club-media'
    and public.is_club_member((storage.foldername(name))[1]::uuid)
  );

create policy club_media_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'club-media'
    and public.is_club_member((storage.foldername(name))[1]::uuid)
  );

/*
 * Delete: an organizer of the folder's club; or, while still an active
 * member of that club, the uploader of a club_media row at that path or the
 * object's own uploader (owner_id). A removed member can do neither. The last clause is what lets a plain member finish removing
 * their own media — remove_club_media deletes the row before the client
 * deletes the object, so the row clause no longer matches by then — and
 * clean up an object whose add_club_media call failed (no row ever existed).
 */
create policy club_media_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'club-media'
    and (
      public.is_club_organizer((storage.foldername(name))[1]::uuid)
      or (
        public.is_club_member((storage.foldername(name))[1]::uuid)
        and (
          owner_id = (select auth.uid())::text
          or exists (
            select 1 from public.club_media cm
            where cm.storage_path = storage.objects.name
              and cm.uploaded_by = (select auth.uid())
          )
        )
      )
    )
  );
