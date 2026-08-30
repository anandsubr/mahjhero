/*
 * The read RPCs that close the gap Task 10 found against a real database.
 *
 * `public.profiles` has been self-row-only since 20260822180000, which
 * narrowed it deliberately to close a leak that migration's own comment
 * describes -- a plain member reading a co-member's quiet hours. This
 * migration does not reopen it. Because the policy is self-only, a
 * PostgREST embed of `profiles(display_name)` -- what THREAD_COLUMNS and
 * MESSAGE_COLUMNS in lib/messages.ts both ask for -- resolves to NULL for
 * every row but the caller's own, whichever table it hangs off. A group
 * roster and every sender name but your own comes back blank.
 *
 * Same fix as `club_roster` (20260822180000): a SECURITY DEFINER function,
 * where RLS does not apply, that re-asks the tenancy question itself --
 * here `can_read_thread` (20260829010000), the same gate
 * `messages_select` and `message_threads_select` already lean on. Two
 * functions rather than one, because they answer two different questions:
 * the message list, whose self-referential reply_to_id PostgREST cannot
 * embed at ALL (see MESSAGE_COLUMNS' docstring -- not an RLS problem, a
 * schema-cache one), and the group roster, which `club_roster` itself
 * cannot serve, because a group has no club_id to hand it.
 */

/*
 * The message list, sender names and the quoted parent resolved inline.
 *
 * Also removes Task 10's second round trip for the quoted parent: the
 * composite foreign key `(reply_to_id, thread_id)` on `messages` already
 * guarantees a reply's parent lives in the SAME thread as the reply, so the
 * self-join below carries no risk the old belt-and-braces second query
 * (scoped by thread_id) did not already accept -- it is the same guarantee,
 * asked once instead of twice.
 */
create function public.fetch_thread_messages(target_thread uuid)
returns table (
  id              uuid,
  author_id       uuid,
  author_name     text,
  body            text,
  subject         text,
  is_announcement boolean,
  created_at      timestamptz,
  reply_to_id     uuid,
  reply_to_body   text,
  reply_to_author text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select m.id, m.author_id, p.display_name, m.body, m.subject,
           m.is_announcement, m.created_at, m.reply_to_id,
           q.body, qp.display_name
      from public.messages m
      join public.profiles p on p.id = m.author_id
      left join public.messages q
        on q.id = m.reply_to_id and q.thread_id = m.thread_id
      left join public.profiles qp on qp.id = q.author_id
     where m.thread_id = target_thread
     order by m.created_at, m.id;
end;
$$;

/*
 * The group roster -- the one thread kind `club_roster` cannot serve,
 * because a group has no club_id. Empty for a club or game thread: their
 * membership is derived from club_members/bookings and never materialised
 * in thread_members (20260829000000's own docstring argues at length for
 * why), so there is nothing here to return. THREAD_COLUMNS' own
 * `thread_members` embed already resolves those to an empty array, so a
 * client merging this against that list changes nothing for them.
 */
create function public.thread_roster(target_thread uuid)
returns table (
  profile_id   uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_thread(target_thread) then
    raise exception 'you cannot read this conversation' using errcode = '42501';
  end if;

  return query
    select tm.profile_id, p.display_name
      from public.thread_members tm
      join public.profiles p on p.id = tm.profile_id
     where tm.thread_id = target_thread
     order by tm.joined_at, tm.profile_id;
end;
$$;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly. See
-- 20260829010000's own note on this, and the four prior migrations it
-- cites that were bitten by it.
revoke execute on function public.fetch_thread_messages(uuid) from public, anon;
revoke execute on function public.thread_roster(uuid) from public, anon;
grant execute on function public.fetch_thread_messages(uuid) to authenticated;
grant execute on function public.thread_roster(uuid) to authenticated;
