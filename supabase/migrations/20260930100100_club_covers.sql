/*
 * Club cover (club-hub phase 2): an optional photo, else a host-chosen
 * colour from five dark palette tokens (white header text stays readable
 * on all of them). Both columns are written only through the organizer
 * RPCs below; direct UPDATEs are frozen like slug and code.
 */
alter table public.clubs
  add column cover_path text,
  add column cover_color text not null default 'accent2_800'
    constraint clubs_cover_color_check
    check (cover_color in ('accent2_800','accent2_700','accent_700','accent_800','neutral_800'));

-- create or replace, extending 20260929100000_club_codes.sql's definition
-- verbatim with the cover-column guard below; nothing else here changed.
create or replace function public.clubs_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'club slug cannot be changed' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'club created_by cannot be changed' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'club id cannot be changed' using errcode = '42501';
  end if;

  if new.code is distinct from old.code then
    raise exception 'club code cannot be changed directly' using errcode = '42501';
  end if;

  if new.cover_path is distinct from old.cover_path
     or new.cover_color is distinct from old.cover_color then
    raise exception 'club cover cannot be changed directly' using errcode = '42501';
  end if;

  return new;
end;
$$;

create function public.set_club_cover(target_club uuid, new_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  if auth.uid() is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_path is not null and new_path not like target_club::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  select cover_path into previous from public.clubs where id = target_club for update;
  update public.clubs set cover_path = new_path where id = target_club;
  return previous;
end;
$$;
revoke execute on function public.set_club_cover(uuid, text) from public, anon;
grant execute on function public.set_club_cover(uuid, text) to authenticated;

create function public.set_club_cover_color(target_club uuid, new_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.clubs set cover_color = new_color where id = target_club;
end;
$$;
revoke execute on function public.set_club_cover_color(uuid, text) from public, anon;
grant execute on function public.set_club_cover_color(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('club-covers', 'club-covers', false);

create policy club_covers_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'club-covers'
    and public.is_club_member((storage.foldername(name))[1]::uuid)
  );

create policy club_covers_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'club-covers'
    and public.is_club_organizer((storage.foldername(name))[1]::uuid)
  );

create policy club_covers_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'club-covers'
    and public.is_club_organizer((storage.foldername(name))[1]::uuid)
  );
