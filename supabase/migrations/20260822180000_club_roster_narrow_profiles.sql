/*
 * Corrective migration. `20260822033527_create_clubs.sql` widened the
 * `profiles` select policy from own-row-only to "own row OR any co-member's
 * row", so a club roster could show names and skill levels. Forward-only per
 * this project's rule: an applied migration is never hand-edited, because
 * `supabase db push` tracks by version timestamp and would silently skip an
 * amended file.
 *
 * The widening is per-ROW, but a policy cannot be per-COLUMN, so a co-member
 * read the entire row. Verified live: a plain member of a shared club read
 * another member's `quiet_hours_start`, `quiet_hours_end`, `notify_channel`,
 * `mute_need_a_fourth`, and `timezone`. Not a tenant-boundary breach — the
 * co-membership join still holds — but anyone in your club learned what hours
 * you sleep.
 *
 * Column-level GRANTs cannot express the fix: grants are per-role, not
 * per-policy, so there is no way to say "all columns of my own row, four
 * columns of a co-member's" with the single `authenticated` role doing both.
 *
 * Two shapes were considered:
 *
 *   (a) Move the notification/quiet-hours columns to a `profile_settings`
 *       table with an own-row-only policy, leaving `profiles` as rosterable
 *       identity.
 *   (b) This: a `security definer` function that returns exactly the four
 *       roster columns, and narrow the `profiles` policy back to self-only.
 *
 * (b) was chosen. (a) keeps the widened policy in force, so the *default* for
 * every column added to `profiles` from here on is "visible to everyone in
 * your club" — the same defect reopens the next time someone adds a column
 * and does not think to put it in the other table. (b) restores deny-by-
 * default: `profiles` is self-only again, and the exposed set is written out
 * explicitly in one function's return type, where widening it is a deliberate
 * edit rather than an omission. It also touches one caller (`fetchRoster`)
 * instead of the settings screen plus a data move.
 */

/*
 * The roster read, and the only way one member sees another's identity.
 *
 * security definer because `profiles` is self-only below — the caller cannot
 * read a co-member's row directly, by design. RLS therefore does NOT protect
 * this function, so it re-asks the membership question itself: the
 * `is_club_member(target_club)` predicate is the tenant boundary, not
 * decoration. Without it any signed-in user holding a club uuid could read
 * that club's whole roster.
 *
 * The return type is the exposure surface. Adding a column here is the
 * deliberate act of publishing it to every co-member.
 */
create function public.club_roster(target_club uuid)
returns table (
  profile_id   uuid,
  role         public.club_role,
  display_name text,
  skill_level  public.skill_level
)
language sql
security definer
stable
set search_path = public
as $$
  select m.profile_id, m.role, p.display_name, p.skill_level
  from public.club_members m
  join public.profiles p on p.id = m.profile_id
  where m.club_id = target_club
    and m.status = 'active'
    and public.is_club_member(target_club)
  order by m.joined_at, m.id;
$$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC, and Supabase's
-- hosted bootstrap grants it directly to anon as well; `revoke from public`
-- alone does not touch a direct grant. Both are revoked so the ACL says what
-- it means. See 20260822045809 for where that was learned.
revoke execute on function public.club_roster(uuid) from public;
revoke execute on function public.club_roster(uuid) from anon;
grant execute on function public.club_roster(uuid) to authenticated;

-- Back to self-only. `club_roster` above is now the only path from one
-- member to another's name and skill level.
drop policy if exists profiles_select_self_or_comember on public.profiles;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
