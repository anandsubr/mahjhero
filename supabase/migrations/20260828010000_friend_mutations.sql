/*
 * Every write to friendships goes through here — the table has a select
 * policy and no write policy at all, which is the posture plans 3, 4 and 6
 * established for every mutable table in this schema.
 */

create function public.add_friend(target uuid)
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
  if target = caller then
    raise exception 'you cannot add yourself' using errcode = '22023';
  end if;

  /*
   * Deliberately NOT can_reach(). can_reach is already true for an existing
   * friend, so using it here would make the rule circular — a friendship,
   * once made, would license re-adding forever, and "you can only acquire a
   * friend inside a shared club" would be enforced nowhere. The shared-club
   * test is written out so that it is the acquisition rule and can_reach
   * stays the reach rule.
   */
  if not exists (
    select 1
      from public.club_members m1
      join public.club_members m2 on m2.club_id = m1.club_id
     where m1.profile_id = caller and m1.status = 'active'
       and m2.profile_id = target and m2.status = 'active'
  ) then
    raise exception 'you can only add someone from one of your clubs'
      using errcode = '42501';
  end if;

  -- Idempotent: the screen's Add button is one tap and a double tap is not
  -- an error the member should have to read about.
  insert into public.friendships (profile_id, friend_id)
  values (caller, target)
  on conflict do nothing;
end;
$$;

create function public.remove_friend(target uuid)
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

  -- No shared-club check. You may always stop keeping somebody in your own
  -- list, whatever has happened to the club you met in.
  delete from public.friendships
   where profile_id = caller and friend_id = target;
end;
$$;

/*
 * The clubs the two of you STILL share, resolved here rather than by the
 * screen fanning out over rosters.
 *
 * An empty array is a real answer, not a failure: it is exactly the friend
 * you acquired in a club one of you has since left. app/friends.tsx says
 * "No clubs in common" for it.
 */
create function public.fetch_friends()
returns table (
  profile_id   uuid,
  display_name text,
  club_names   text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         coalesce((
           select array_agg(c.name order by c.name)
             from public.club_members them
             join public.club_members me
               on me.club_id = them.club_id
              and me.profile_id = (select auth.uid())
              and me.status = 'active'
             join public.clubs c on c.id = them.club_id
            where them.profile_id = p.id
              and them.status = 'active'
         ), '{}'::text[])
    from public.friendships f
    join public.profiles p on p.id = f.friend_id
   where f.profile_id = (select auth.uid())
   order by p.display_name;
$$;

/*
 * The artboard's "People in your clubs" list: everybody in any of your
 * clubs who is not you and not already a friend.
 *
 * `distinct on (p.id)` collapses somebody who is in two of your clubs to one
 * row, showing the alphabetically first shared club. distinct on requires
 * its own ordering, which is by id and therefore meaningless to a reader, so
 * the whole thing is wrapped and re-ordered by name.
 */
create function public.fetch_addable_people()
returns table (
  profile_id   uuid,
  display_name text,
  club_name    text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.profile_id, t.display_name, t.club_name
    from (
      select distinct on (p.id)
             p.id           as profile_id,
             p.display_name as display_name,
             c.name         as club_name
        from public.club_members me
        join public.club_members them
          on them.club_id = me.club_id and them.status = 'active'
        join public.profiles p on p.id = them.profile_id
        join public.clubs c on c.id = me.club_id
       where me.profile_id = (select auth.uid())
         and me.status = 'active'
         and p.id <> (select auth.uid())
         and not exists (
           select 1 from public.friendships f
            where f.profile_id = (select auth.uid())
              and f.friend_id = p.id
         )
       order by p.id, c.name
    ) t
   order by t.display_name;
$$;

-- ---------------------------------------------------------------------
-- Grants. These four ARE the client's API, so authenticated executes them.
-- anon does not: none of them means anything without auth.uid().
-- ---------------------------------------------------------------------
revoke execute on function public.add_friend(uuid) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.fetch_friends() from public, anon;
revoke execute on function public.fetch_addable_people() from public, anon;

grant execute on function public.add_friend(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.fetch_friends() to authenticated;
grant execute on function public.fetch_addable_people() to authenticated;
