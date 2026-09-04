/*
 * The leaderboard: all-time member standings, ranked by total points then
 * rounds won.
 *
 * security definer because `profiles` is self-only below — the caller cannot
 * read a co-member's row directly, by design. RLS therefore does NOT protect
 * this function, so it re-asks the membership question itself: the
 * `is_club_member(target_club)` predicate is the tenant boundary, not
 * decoration. Without it any signed-in user holding a club uuid could read
 * that club's leaderboard.
 *
 * The return type is the exposure surface. Adding a column here is the
 * deliberate act of publishing it to every co-member.
 *
 * Deliberately does NOT filter on club_members.status = 'active' the way
 * club_roster does: a departed member's historical rounds still count
 * toward an all-time leaderboard. Intentional, not an oversight.
 */
create function public.club_leaderboard(target_club uuid)
returns table (
  profile_id   uuid,
  display_name text,
  total_points bigint,
  rounds_won   bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    tr.winner_profile_id,
    p.display_name,
    sum(tr.points)::bigint,
    count(*)::bigint
  from public.table_rounds tr
  join public.profiles p on p.id = tr.winner_profile_id
  where tr.club_id = target_club
    and public.is_club_member(target_club)
  group by tr.winner_profile_id, p.display_name
  order by sum(tr.points) desc, count(*) desc, tr.winner_profile_id;
$$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC, and Supabase's
-- hosted bootstrap grants it directly to anon as well; `revoke from public`
-- alone does not touch a direct grant. Both are revoked so the ACL says what
-- it means. See 20260822045809 for where that was learned.
revoke execute on function public.club_leaderboard(uuid) from public;
revoke execute on function public.club_leaderboard(uuid) from anon;
grant execute on function public.club_leaderboard(uuid) to authenticated;
