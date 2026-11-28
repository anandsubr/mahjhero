/*
 * Pivot batch 1: two places where the word "club" reached people from the
 * database rather than from app copy.
 *
 * - suggest_club_code's fallback stem, used when a name has no letters or
 *   digits, made codes like CLUB042. Now GROUP042. Existing codes are left
 *   alone; this only changes what new ones look like.
 * - add_friend's refusal is relayed verbatim to the Friends screen
 *   (lib/friends.ts). Same check, new wording.
 *
 * Both are the earlier definitions copied verbatim apart from that one
 * string, so grants and behaviour are unchanged (create or replace keeps
 * a function's existing ACL).
 */

create or replace function public.suggest_club_code(club_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  stem text := left(regexp_replace(upper(coalesce(club_name, '')), '[^A-Z0-9]', '', 'g'), 8);
  candidate text;
  tries int := 0;
begin
  if length(stem) = 0 then
    stem := 'GROUP';
  end if;
  loop
    tries := tries + 1;
    exit when tries > 50;
    candidate := stem || lpad(floor(random() * 1000)::int::text, 3, '0');
    if not exists (select 1 from public.clubs where code = candidate) then
      return candidate;
    end if;
  end loop;
  loop
    candidate := stem || lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from public.clubs where code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.add_friend(target uuid)
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
    raise exception 'you can only add someone from one of your groups'
      using errcode = '42501';
  end if;

  -- Idempotent: the screen's Add button is one tap and a double tap is not
  -- an error the member should have to read about.
  insert into public.friendships (profile_id, friend_id)
  values (caller, target)
  on conflict do nothing;
end;
$$;
