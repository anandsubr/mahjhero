/*
 * Friends: a one-way edge, and deliberately so.
 *
 * `(a, b)` says "a keeps b in their list". It says nothing about what b
 * thinks, there is no pending state, and there is no notification — because
 * the `1C friends` artboard draws a bare Add/Remove with no design for any
 * of them, and because a request/accept flow makes adding a two-person,
 * two-session act for a list whose only job is to shorten a picker.
 *
 * What makes a one-way edge safe is the select policy below: the edge is
 * invisible to its target, so it cannot function as a signal or a slight.
 * Nobody can read who has friended them.
 *
 * The edge is also NOT a permission. Reaching someone is can_reach()'s
 * question, and it has a second branch — a shared club — so a friendship is
 * a shortcut through a door that is already open. What friendship adds is
 * that it OUTLIVES the shared club: add someone from your club, one of you
 * leaves, and you can still message them. That is the entire reason a group
 * thread can span clubs.
 */
create table public.friendships (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (profile_id, friend_id),
  check (profile_id <> friend_id)
);

/*
 * The primary key already indexes (profile_id, friend_id), which serves
 * "who are my friends". This covers the other direction, which
 * fetch_addable_people's NOT EXISTS and can_reach's first branch both
 * probe.
 */
create index friendships_friend_idx on public.friendships (friend_id);

alter table public.friendships enable row level security;

/*
 * `revoke all` first, and it is not belt-and-braces. Supabase grants ALL on
 * every table in `public` to `authenticated` by default; ALL includes
 * TRUNCATE, which is NOT subject to row-level security. Without this line
 * the policy below stops nothing.
 * supabase/tests/database/portable/grants.test.sql exists for exactly this.
 */
revoke all on public.friendships from authenticated;
grant select on public.friendships to authenticated;

create policy friendships_select_own on public.friendships
  for select using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- May a reach b?
-- ---------------------------------------------------------------------

/*
 * One predicate, so the answer cannot drift between the picker, the
 * create-thread RPC and the add-to-group RPC. Same posture as
 * assert_club_organizer, which send_broadcast (20260826030000) reuses
 * rather than reimplementing.
 *
 * NOT symmetric, because the friendship branch is not symmetric. Callers
 * asking "may the caller message this person" must pass the caller as `a`.
 *
 * can_reach(x, x) is true whenever x is in any active club. Every caller
 * therefore has to exclude self on its own; there is no useful answer this
 * function could give instead, since "may I reach myself" is not the
 * question any caller is asking.
 */
create function public.can_reach(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
     where f.profile_id = a and f.friend_id = b
  ) or exists (
    select 1
      from public.club_members m1
      join public.club_members m2 on m2.club_id = m1.club_id
     where m1.profile_id = a and m1.status = 'active'
       and m2.profile_id = b and m2.status = 'active'
  );
$$;

/*
 * Internal. `revoke … from public` does NOT clear Supabase's hosted
 * bootstrap grant to `authenticated`, which is why that role is named
 * explicitly. This repository has been bitten by that four times —
 * 20260823020000, 20260823030000, 20260823060000, 20260825061000 — and
 * each time the gap was invisible against the local stack, which grants
 * `authenticated` nothing by default.
 *
 * The definer functions in 20260828010000 still call this: a security
 * definer function runs as its owner, not its caller.
 */
revoke execute on function public.can_reach(uuid, uuid)
  from public, anon, authenticated;
