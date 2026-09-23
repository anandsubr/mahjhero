-- accept_club_invite's parameter changes from a bearer token (text) to an
-- id (uuid) -- security no longer comes from the token being secret, it
-- comes from the email match below, so there is nothing left for a secret
-- string to protect. Postgres cannot `create or replace` across a
-- parameter-type change, so the old signature is dropped outright (this
-- codebase has hit exactly this before -- see
-- 20260905180200_accept_invite_revoke_public.sql's own comment on why a
-- signature change resets EXECUTE to PUBLIC and needs fresh grants).
--
-- Everything from the membership insert through the seating attempt
-- (including the booking_groups/bookings column lists and the best-effort
-- exception handler) is carried over byte-for-byte from
-- 20260905170000_accept_invite_seating_log_warning.sql's
-- accept_club_invite(text) body -- only the invite lookup (token -> id) and
-- the validity gate (declined_at / email-match added) change.
drop function if exists public.accept_club_invite(text);

create function public.accept_club_invite(invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite       public.club_invites%rowtype;
  caller       uuid := auth.uid();
  caller_email text;
  seat_event   public.events%rowtype;
  new_group    uuid;
  seating      jsonb;
  placement    jsonb;
begin
  if caller is null then
    return null;
  end if;

  select email into caller_email from auth.users where id = caller;

  select * into invite
  from public.club_invites
  where id = invite_id
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.declined_at is not null
     or invite.expires_at < now()
     or caller_email is null
     or lower(invite.email) <> lower(caller_email) then
    return null;
  end if;

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  insert into public.club_members (club_id, profile_id, role)
  values (invite.club_id, caller, 'member')
  on conflict (club_id, profile_id) do update
    set status = 'active'
    where club_members.status = 'removed';

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  if invite.event_id is not null then
    begin
      select * into seat_event
      from public.events where id = invite.event_id for update;

      if seat_event.id is not null
         and seat_event.status = 'published'
         and seat_event.starts_at > now() then
        perform public.assert_players_bookable(
          invite.club_id, invite.event_id, array[caller]);

        seating := public.plan_seating(invite.event_id, array[caller], null, true);

        insert into public.booking_groups
          (event_id, club_id, created_by, preferred_table_id, allow_split,
           status, waitlisted_at)
        values (
          invite.event_id, invite.club_id, caller, null, true,
          case when seating->>'outcome' = 'seated'
               then 'confirmed'::public.booking_group_status
               else 'waitlisted'::public.booking_group_status end,
          case when seating->>'outcome' = 'seated' then null else now() end)
        returning id into new_group;

        if seating->>'outcome' = 'seated' then
          for placement in select * from jsonb_array_elements(seating->'placements')
          loop
            insert into public.bookings
              (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
            values (new_group, invite.event_id, invite.club_id,
                    (placement->>'event_table_id')::uuid, caller, caller);
          end loop;
        else
          insert into public.bookings
            (group_id, event_id, club_id, profile_id, booked_by, status)
          values (new_group, invite.event_id, invite.club_id, caller, caller,
                  'waitlisted');
        end if;
      end if;
    exception when others then
      raise warning 'invite seating skipped for event %: %', invite.event_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'club_id', invite.club_id,
    'event_id', case when new_group is not null then invite.event_id else null end);
end;
$$;

revoke execute on function public.accept_club_invite(uuid) from public, anon;
grant execute on function public.accept_club_invite(uuid) to authenticated;

create function public.decline_club_invite(invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invite       public.club_invites%rowtype;
  caller       uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    return false;
  end if;

  select email into caller_email from auth.users where id = caller;

  select * into invite
  from public.club_invites
  where id = invite_id
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.declined_at is not null
     or invite.expires_at < now()
     or caller_email is null
     or lower(invite.email) <> lower(caller_email) then
    return false;
  end if;

  update public.club_invites
  set declined_at = now()
  where id = invite.id;

  return true;
end;
$$;

revoke execute on function public.decline_club_invite(uuid) from public, anon;
grant execute on function public.decline_club_invite(uuid) to authenticated;

create function public.fetch_my_pending_invites()
returns table (
  id uuid,
  club_id uuid,
  club_name text,
  event_id uuid,
  event_title text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    return;
  end if;

  select email into caller_email from auth.users where id = caller;
  if caller_email is null then
    return;
  end if;

  return query
    select
      ci.id,
      ci.club_id,
      c.name as club_name,
      ci.event_id,
      e.title as event_title
    from public.club_invites ci
    join public.clubs c on c.id = ci.club_id
    left join public.events e on e.id = ci.event_id
    where lower(ci.email) = lower(caller_email)
      and ci.accepted_at is null
      and ci.declined_at is null
      and ci.expires_at > now()
    order by ci.created_at;
end;
$$;

revoke execute on function public.fetch_my_pending_invites() from public, anon;
grant execute on function public.fetch_my_pending_invites() to authenticated;
