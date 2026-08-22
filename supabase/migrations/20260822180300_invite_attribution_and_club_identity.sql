/*
 * Two narrower holes found in the same review.
 *
 * 1. `club_invites.invited_by` was client-supplied and unchecked. The insert
 *    policy asks only "is the caller an organizer of this club" and says
 *    nothing about whose name goes on the invite, so a host could attribute
 *    any invite — including a whole imported batch — to any profile id they
 *    could name. `create_club` deliberately takes no user-id argument for
 *    exactly this reason: it reads `auth.uid()` itself so a caller cannot act
 *    as someone else. This gives `club_invites` the same property, from both
 *    ends: a default so the client no longer needs to send the column, and a
 *    `with check` so sending a different one is refused rather than trusted.
 *
 * 2. `clubs_update_host` had a `using` clause and no `with check`, and was
 *    unbounded by column. `using` filters which rows an UPDATE may *reach*;
 *    only `with check` constrains what those rows may be updated *to*.
 *    Without one, a host could rewrite `created_by` (pointing the club's
 *    origin at a stranger) or `slug`. Slug is globally unique, so a host
 *    could walk the namespace and squat any slug a future public-club URL
 *    would want, from an ordinary authenticated session.
 */

alter table public.club_invites alter column invited_by set default auth.uid();

drop policy club_invites_insert_organizer on public.club_invites;

create policy club_invites_insert_organizer on public.club_invites
  for insert with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

-- `with check` mirrors `using`, so a host cannot update a row out of their own
-- reach — e.g. by moving it to a club they do not host.
drop policy clubs_update_host on public.clubs;

create policy clubs_update_host on public.clubs
  for update
  using (
    exists (
      select 1 from public.club_members m
      where m.club_id = clubs.id and m.profile_id = auth.uid()
        and m.role = 'host' and m.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.club_members m
      where m.club_id = clubs.id and m.profile_id = auth.uid()
        and m.role = 'host' and m.status = 'active'
    )
  );

/*
 * The column freeze a policy cannot express: `with check` sees only NEW, so
 * it can say "the result must still be my club" but not "the slug must not
 * have changed". That comparison needs OLD, which means a trigger.
 *
 * `visibility` is deliberately NOT frozen. It is a legitimate host setting —
 * a host choosing whether their club is listed publicly is the intended use,
 * once a public browse exists — and no policy consults it today.
 *
 * The `current_user` escape hatch is for `security definer` functions, which
 * run as the function owner (postgres). A future rename or slug-change
 * function goes through one of those, where the rules can be stated
 * deliberately, rather than through a direct client UPDATE.
 */
create function public.clubs_freeze_identity()
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

  return new;
end;
$$;

create trigger clubs_freeze_identity
  before update on public.clubs
  for each row execute function public.clubs_freeze_identity();

revoke execute on function public.clubs_freeze_identity() from public;
revoke execute on function public.clubs_freeze_identity() from anon, authenticated;
