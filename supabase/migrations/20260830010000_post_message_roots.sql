/*
 * post_message learns about posts.
 *
 * DROP then CREATE, not CREATE OR REPLACE: adding a defaulted parameter
 * changes the signature, and `create or replace` would leave the old
 * 4-argument function in place as an overload. Two functions with defaults
 * make `post_message(uuid, text)` ambiguous, and PostgREST would resolve
 * whichever it liked. Its signature in BOTH closed-world arrays in
 * portable/grants.test.sql moves with it.
 *
 * The announcement path is untouched below: broadcast_recipients still
 * resolves the roster, still feeds the outbox, and is still the single
 * source of both the count the compose screen previews and the set the
 * fan-out mails.
 */
drop function public.post_message(uuid, text, boolean, uuid);

/*
 * One way in for every message, in every kind of thread.
 *
 * The announcement path is what absorbs broadcasts. It does NOT write its
 * own recipient query: broadcast_recipients (20260826030000) resolves the
 * club roster when event_id is null and the event's confirmed bookings
 * otherwise — exactly the two targets the deleted broadcast screens had.
 * Its own docstring records why that must stay one function: the count the
 * compose screen previews and the set the fan-out mails cannot disagree
 * once they are one, and they disagree the moment they are two.
 */
create function public.post_message(
  target_thread uuid,
  p_body        text,
  p_announce    boolean default false,
  p_reply_to    uuid default null,
  p_root        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  th     public.message_threads;
  body   text := trim(coalesce(p_body, ''));
  subj   text;
  bid    uuid;
  told   int;
  mid    uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Checked before the length bound so a member who cannot post here is
  -- told that, rather than being told their empty message is too short.
  if not public.can_post_thread(target_thread) then
    raise exception 'you cannot post in this conversation' using errcode = '42501';
  end if;

  if length(body) = 0 then
    raise exception 'write something first' using errcode = '22023';
  end if;
  if length(body) > 2000 then
    raise exception 'that message is too long' using errcode = '22023';
  end if;

  /*
   * The composite foreign key already makes a cross-thread quote
   * unstateable, so this check exists only to turn a 23503 into words
   * somebody can read. It is not the guard — the constraint is, and it stays
   * the thing that would stop a future caller that forgot this branch.
   */
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to and m.thread_id = target_thread
  ) then
    raise exception 'you can only reply to a message in this conversation'
      using errcode = '22023';
  end if;

  select * into th from public.message_threads where id = target_thread;

  /*
   * The board guards. Ordered so the most specific refusal wins: a reply
   * that also asked to announce is told announcements are always roots
   * rather than being sent through assert_club_organizer first, which
   * would refuse an organizer for the wrong reason.
   */
  if p_root is not null then
    if th.club_id is null or th.event_id is not null then
      raise exception 'only a club has posts to reply to' using errcode = '22023';
    end if;
    if coalesce(p_announce, false) then
      raise exception 'only a new post can be an announcement'
        using errcode = '22023';
    end if;
    -- `root_id is null` is the one-level rule. The composite foreign key
    -- already makes the cross-thread case unstateable; the thread_id
    -- clause here is what turns it into readable words.
    if not exists (
      select 1 from public.messages m
       where m.id = p_root
         and m.thread_id = target_thread
         and m.root_id is null
    ) then
      raise exception 'you can only reply to a post in this conversation'
        using errcode = '22023';
    end if;
  end if;

  if coalesce(p_announce, false) then
    if th.club_id is null then
      raise exception 'a group has no roster to announce to' using errcode = '22023';
    end if;

    -- Raises 42501 for anyone who is not host or co-organizer. Reused
    -- rather than reimplemented, so the UI's gate and this one cannot
    -- drift apart.
    perform public.assert_club_organizer(th.club_id);

    /*
     * The subject is DERIVED, not typed. An email needs a subject line and
     * the compose artboard has one input, so rather than add a field the
     * design does not have, the first line becomes the subject — and the
     * screen shows it back in the confirmation, so it is disclosed rather
     * than invented silently.
     *
     * Control characters are stripped because deliver-notifications drops
     * this straight into an SMTP header, where a CR or LF would let an
     * organizer inject an arbitrary header — an extra Bcc:, for one. The
     * check constraints on broadcasts.subject and messages.subject are the
     * braces to this belt.
     */
    subj := regexp_replace(
      split_part(body, E'\n', 1), '[[:cntrl:]]', '', 'g');
    subj := trim(subj);
    if length(subj) > 120 then
      subj := left(subj, 119) || '…';
    end if;
    if length(subj) = 0 then
      raise exception 'an announcement needs a first line to use as its subject'
        using errcode = '22023';
    end if;

    insert into public.broadcasts (club_id, event_id, author_id, subject, body)
    values (th.club_id, th.event_id, caller, subj, body)
    returning id into bid;

    /*
     * The dedupe key carries the recipient, not just the broadcast. A
     * multi-row INSERT ... ON CONFLICT DO NOTHING checks each row against
     * the unique index as it is inserted, INCLUDING rows the same statement
     * has already placed — so a key of `broadcast:<id>` alone would keep
     * exactly ONE row for the whole fan-out and tell one person.
     * send_broadcast and announce_table_fourth both carry this same note.
     */
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select r.profile_id, th.club_id, th.event_id, 'broadcast',
           jsonb_build_object('broadcast_id', bid),
           'broadcast:' || bid::text || ':' || r.profile_id::text
      from public.broadcast_recipients(th.club_id, th.event_id) r
     -- You do not need mailing about the thing you just wrote.
     where r.profile_id <> caller
    on conflict (dedupe_key) do nothing;

    get diagnostics told = row_count;
    update public.broadcasts set recipient_count = told where id = bid;
  end if;

  insert into public.messages
    (thread_id, author_id, body, subject, is_announcement, broadcast_id,
     reply_to_id, root_id)
  values (target_thread, caller, body, subj, coalesce(p_announce, false), bid,
          p_reply_to, p_root)
  returning id into mid;

  -- Denormalised in the same transaction, so neither the Recent sort nor
  -- the board's own ordering has to compute an aggregate at read time.
  update public.message_threads
     set last_message_at = now()
   where id = target_thread;

  if p_root is not null then
    update public.messages
       set reply_count   = reply_count + 1,
           last_reply_at = now()
     where id = p_root;
  end if;

  return mid;
end;
$$;

-- `revoke … from public` does not clear Supabase's hosted bootstrap grant
-- to `authenticated`, which is why that role is named explicitly.
revoke execute on function public.post_message(uuid, text, boolean, uuid, uuid)
  from public, anon;
grant execute on function public.post_message(uuid, text, boolean, uuid, uuid)
  to authenticated;
