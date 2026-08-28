/*
 * Ad-hoc groups: a set of people, no club, no admin.
 *
 * Anyone in the group can add somebody THEY can reach; anyone can leave;
 * nobody can remove anybody. An admin role on a four-person mahjong group
 * is overkill, and the alternative — a fixed membership — is the thing
 * people complain about most in group chat.
 *
 * A DIRECT message is not a kind. It is a group of two, and everything
 * below treats it as one. The only special case is the dedupe in
 * create_group_thread, which is a creation-time CONVENIENCE and not an
 * invariant: a group of four that people leave until two remain stays its
 * own thread. Enforcing "one thread per pair" would need a unique index
 * over a member set — which Postgres cannot express without a maintained
 * digest column — and leave_group_thread could violate it anyway.
 */

create function public.create_group_thread(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  others uuid[];
  m      uuid;
  tid    uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Dedupe, drop nulls, and drop the caller. The caller is always a member,
  -- and letting them arrive through p_members as well would make a direct
  -- thread look like a group of three to the dedupe below.
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into others
    from unnest(coalesce(p_members, '{}'::uuid[])) x
   where x is not null and x <> caller;

  if array_length(others, 1) is null then
    raise exception 'pick somebody to message' using errcode = '22023';
  end if;

  foreach m in array others loop
    if not public.can_reach(caller, m) then
      raise exception 'you can only message people from your clubs or your friends'
        using errcode = '42501';
    end if;
  end loop;

  -- Direct dedupe. Exactly one other person, and a two-person thread whose
  -- members are exactly the two of you.
  if array_length(others, 1) = 1 then
    select t.id into tid
      from public.message_threads t
     where t.club_id is null
       and (select count(*) from public.thread_members tm
             where tm.thread_id = t.id) = 2
       and exists (select 1 from public.thread_members tm
                    where tm.thread_id = t.id and tm.profile_id = caller)
       and exists (select 1 from public.thread_members tm
                    where tm.thread_id = t.id and tm.profile_id = others[1])
     limit 1;
    if tid is not null then
      return tid;
    end if;
  end if;

  -- An empty title is stored as NULL, not ''. fetch_my_threads names an
  -- untitled group from its members at read time, which stays right when
  -- somebody is added; a frozen name does not.
  insert into public.message_threads (title, created_by)
  values (nullif(trim(coalesce(p_title, '')), ''), caller)
  returning id into tid;

  insert into public.thread_members (thread_id, profile_id, added_by)
  select tid, caller, null
  union all
  select tid, x, caller from unnest(others) x;

  return tid;
end;
$$;

/*
 * `can_reach(caller, m)` — the ADDER's reach, not the group's. You may only
 * bring in somebody you could have messaged yourself, which keeps a group
 * from becoming a way to introduce two strangers without either agreeing.
 */
create function public.add_to_group_thread(target_thread uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  m      uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.message_threads t
     where t.id = target_thread and t.club_id is null
  ) then
    raise exception 'only a group has people to add' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.thread_members tm
     where tm.thread_id = target_thread and tm.profile_id = caller
  ) then
    raise exception 'you are not in this conversation' using errcode = '42501';
  end if;

  foreach m in array coalesce(p_members, '{}'::uuid[]) loop
    if m is null or m = caller then
      continue;
    end if;
    if not public.can_reach(caller, m) then
      raise exception 'you can only message people from your clubs or your friends'
        using errcode = '42501';
    end if;
    -- joined_at defaults to now(), which is also this person's unread
    -- floor: they see the full history and inherit none of it as unread.
    insert into public.thread_members (thread_id, profile_id, added_by)
    values (target_thread, m, caller)
    on conflict do nothing;
  end loop;
end;
$$;

create function public.leave_group_thread(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  delete from public.thread_members
   where thread_id = target_thread and profile_id = caller;

  /*
   * Last one out takes the thread with them. Nobody could ever reach it
   * again — can_read_thread returns false for a group with no members — so
   * leaving it behind is litter with a permission check on it. The cascade
   * on message_threads takes the messages and the read markers.
   *
   * Deliberately unrecoverable, and named as such in the spec's error
   * table. There is no undo and no archive.
   */
  if not exists (
    select 1 from public.thread_members tm where tm.thread_id = target_thread
  ) then
    delete from public.message_threads
     where id = target_thread and club_id is null;
  end if;
end;
$$;

revoke execute on function public.create_group_thread(text, uuid[]) from public, anon;
revoke execute on function public.add_to_group_thread(uuid, uuid[]) from public, anon;
revoke execute on function public.leave_group_thread(uuid) from public, anon;
grant execute on function public.create_group_thread(text, uuid[]) to authenticated;
grant execute on function public.add_to_group_thread(uuid, uuid[]) to authenticated;
grant execute on function public.leave_group_thread(uuid) to authenticated;
