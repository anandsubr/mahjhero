/*
 * Photos & Files: check the stored object, not the caller's description of it.
 *
 * 20261017110000_club_media.sql had add_club_media validate p_size_bytes and
 * p_mime_type, both caller-supplied, and left the club-media bucket with no
 * size or type limit. A member could upload any content (an HTML page, say)
 * straight through the Storage API and register it as "league-rules.pdf, 1 KB".
 * This migration (that one is already applied on hosted dev, so it is not
 * edited):
 *
 *   1. add_club_media reads the object's own Storage metadata. Storage
 *      writes `size` (a JSON number, the byte count it received) and
 *      `mimetype` (the upload's Content-Type, verbatim) into
 *      storage.objects.metadata for every upload (checked against the local
 *      stack). For a file, the extension of p_file_name picks the canonical
 *      mime, and both p_mime_type and the object's mimetype must equal it.
 *      For a photo, both must be image/jpeg. Either kind is capped at
 *      10 MB by the object's real size.
 *
 *      Size: the row records the OBJECT's size; p_size_bytes is still
 *      required and must be non-negative (the signature and the client stay
 *      as they are), but it is no longer trusted for anything else. Recording
 *      the real size rather than refusing a mismatch means a client whose
 *      byte count differs from what Storage received still gets a correct
 *      row instead of an opaque failure.
 *
 *      Error codes are unchanged (file_not_allowed, file_too_large,
 *      invalid_media, invalid_path, …).
 *
 *   2. The bucket gets file_size_limit = 10 MB and allowed_mime_types =
 *      image/jpeg plus the nine canonical file types, so Storage itself also
 *      refuses a raw upload of anything else, row or no row.
 *      supabase/config.toml declares no [storage.buckets.*], so this
 *      migration is the bucket's only definition and nothing re-seeds it
 *      with other limits.
 *
 *   3. The storage insert policy refuses a path that a club_media row
 *      already references, so a row whose object was deleted out from under
 *      it cannot be re-filled by someone else and shown under the original
 *      uploader's name. Paths are never reused by the client (fresh uuid
 *      per upload), so the real flow never hits this.
 */

create or replace function public.add_club_media(
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
  caller    uuid := (select auth.uid());
  prefix    text;
  obj_size  bigint;
  obj_mime  text;
  canonical text;
  new_id    uuid;
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
  -- every upload. Its size and mimetype are what Storage recorded, not what
  -- the caller says.
  select case when jsonb_typeof(o.metadata->'size') = 'number'
              then (o.metadata->>'size')::bigint end,
         o.metadata->>'mimetype'
    into obj_size, obj_mime
    from storage.objects o
   where o.bucket_id = 'club-media'
     and o.name = p_storage_path
     and o.owner_id = caller::text;
  if not found then
    raise exception 'invalid_path' using errcode = '22023';
  end if;

  if p_file_name is null
     or char_length(p_file_name) not between 1 and 255
     or p_size_bytes is null
     or p_size_bytes < 0
     or obj_size is null
     or obj_size < 0
     or (p_width is not null and p_width <= 0)
     or (p_height is not null and p_height <= 0) then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  if p_kind = 'photo' then
    -- Photos are always compressed to JPEG client-side before upload.
    canonical := 'image/jpeg';
  else
    -- The same extension -> mime table as CANONICAL_MIME in lib/club-media.ts.
    canonical := case lower(substring(p_file_name from '\.([^.]*)$'))
      when 'pdf'  then 'application/pdf'
      when 'doc'  then 'application/msword'
      when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when 'xls'  then 'application/vnd.ms-excel'
      when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      when 'csv'  then 'text/csv'
      when 'ppt'  then 'application/vnd.ms-powerpoint'
      when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      when 'txt'  then 'text/plain'
    end;
  end if;

  if canonical is null
     or p_mime_type is distinct from canonical
     or obj_mime is distinct from canonical then
    raise exception 'file_not_allowed' using errcode = '22023';
  end if;

  if obj_size > 10485760 then
    raise exception 'file_too_large' using errcode = '22023';
  end if;

  insert into public.club_media
    (club_id, kind, storage_path, file_name, mime_type, size_bytes, width, height, uploaded_by)
  values
    (target_club, p_kind, p_storage_path, p_file_name, canonical, obj_size::int,
     p_width, p_height, caller)
  returning id into new_id;

  return new_id;
end;
$$;
revoke execute on function public.add_club_media(uuid, text, text, text, text, int, int, int)
  from public, anon;
grant execute on function public.add_club_media(uuid, text, text, text, text, int, int, int)
  to authenticated;

-- Keep this list in step with the canonical mimes above and CANONICAL_MIME
-- in lib/club-media.ts.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/jpeg',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain'
       ]
 where id = 'club-media';

-- A member of the folder's club, at a path no club_media row references.
-- The subquery runs under the caller's RLS, which shows every row of a club
-- they are an active member of -- exactly the club the folder check already
-- requires, and add_club_media only records paths under the row's own club.
alter policy club_media_objects_insert on storage.objects
  with check (
    bucket_id = 'club-media'
    and public.is_club_member((storage.foldername(name))[1]::uuid)
    and not exists (
      select 1 from public.club_media cm
      where cm.storage_path = storage.objects.name
    )
  );
