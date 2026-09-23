# Email-Targeted Club Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the anonymous bearer-token club invite (anyone holding the link joins, regardless of who it was "addressed" to) with an email-targeted invite: an automatic branded email, an accept/reject banner on the dashboard for existing accounts, and no client-side hand-off needed for new accounts since acceptance is looked up by email on every dashboard load.

**Architecture:** `club_invites.token` is dropped; `email` becomes required and is the only thing that determines who can redeem an invite. Creation moves from a plain client-side insert to a `security definer` RPC (`create_club_invite`) so a friendly "already a member" error is possible. Redemption becomes two new-shape RPCs (`accept_club_invite(uuid)`, `decline_club_invite(uuid)`) plus a new read RPC (`fetch_my_pending_invites()`) that looks up pending invites by the caller's own authenticated email — no RLS policy needed, matching this codebase's existing pattern for "caller isn't a member yet" problems. A new, deliberately small edge function (`send-club-invite`) sends the email over the same SMTP relay `deliver-notifications` already uses, reusing its hardened low-level sending code (moved into a new `supabase/functions/_shared/` — the first shared module between functions in this repo) rather than its outbox/batch machinery, which is `auth.users`-based and can't target someone who has never signed up.

**Tech Stack:** Postgres/pgTAP (Supabase), Deno Edge Functions, `denomailer` (existing SMTP client), Expo Router / React Native, Vitest.

## Global Constraints

- `club_invites.email` is required from this point on; there is no more anonymous invite. Any pre-existing null-email row is deleted, not backfilled — it is unredeemable under the new model regardless.
- Every email comparison against an authenticated caller is case-insensitive (`lower(...)`), since `club_invites.email` is typed by hand by an organizer and may not match `auth.users.email`'s casing exactly.
- `accept_club_invite`'s parameter changes from `invite_token text` to `invite_id uuid` — this is a signature change, not just a body change. Postgres cannot `create or replace` across a parameter-type change; the existing function must be dropped first, and every grant/revoke on the old signature needs a fresh pair on the new one (this codebase has hit this exact issue before — see `supabase/migrations/20260905180200_accept_invite_revoke_public.sql`).
- Every new/changed RPC follows this codebase's established shape: `security definer`, `set search_path = public`, a `stable` marker on read-only functions, and an explicit `revoke execute ... from public, anon` / `grant execute ... to authenticated` pair at the end of the migration that introduces or changes it.
- `app/join/[token].tsx` and the entire "copy a shareable link" UI are deleted, not deprecated in place — there is no more link to click.
- `send-club-invite` receives everything it needs (recipient email, club name, invitee display name) directly in its request body from the already-authenticated client. It does not construct its own Supabase client, does not use the service-role key, and does not look anything up itself — keeping it genuinely isolated from `deliver-notifications`'s outbox system, per the design's Decision 3.

---

### Task 1: Migration — `club_invites` schema changes

**Files:**
- Create: `supabase/migrations/20260923010000_club_invites_email_targeted_schema.sql`

**Interfaces:**
- Produces: `club_invites` with `token` removed, `email not null`, `declined_at timestamptz` added. Consumed by every later task.

- [ ] **Step 1: Write the migration**

```sql
-- Club invites become email-targeted: the token was the only thing that
-- protected an invite (whoever held the string joined, regardless of who it
-- was "addressed" to). Under the new model, security comes from
-- "authenticated, and your account's email matches the invite's email" --
-- see create_club_invite / accept_club_invite / decline_club_invite /
-- fetch_my_pending_invites (later migrations). A token that no longer
-- protects anything is a future source of confusion, not a harmless
-- leftover, so it is dropped rather than left unused.
--
-- Any existing invite with a null email (created under the old anonymous
-- link flow) is unredeemable under the new model regardless -- there is no
-- email to match against -- so those rows are deleted before the NOT NULL
-- constraint is added, rather than leaving the constraint to fail against
-- pre-existing data.
delete from public.club_invites where email is null;

alter table public.club_invites
  alter column email set not null;

alter table public.club_invites
  add column declined_at timestamptz;

alter table public.club_invites
  drop column token;
```

- [ ] **Step 2: Apply locally and confirm the shape**

Run: `npx supabase db reset --local`
Expected: migration applies cleanly (no error). Then run:
`npx supabase db query --linked "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='club_invites' order by ordinal_position;" --local` (or the equivalent local `psql` invocation this repo's `README.md`/`docs/testing.md` documents for inspecting the local database) — confirm `token` is absent, `email` shows `is_nullable = NO`, and `declined_at` is present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923010000_club_invites_email_targeted_schema.sql
git commit -m "$(cat <<'EOF'
feat(db): drop club_invites.token, require email, add declined_at

The token was the only thing protecting an invite -- whoever held it
joined regardless of who it was addressed to. Later migrations in
this plan replace it with an email match against the caller's own
authenticated account.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration — `create_club_invite` RPC

**Files:**
- Create: `supabase/migrations/20260923020000_create_club_invite_rpc.sql`

**Interfaces:**
- Consumes: `club_invites` from Task 1 (`email not null`, no `token`).
- Produces: `create_club_invite(target_club_id uuid, target_email text, target_display_name text, target_event_id uuid) returns uuid` — the new invite's id. Raises `'That person is already in this club'` (no special errcode, plpgsql's default `P0001`) if the email already belongs to an active member of the club. Raises with errcode `42501` if the caller does not organize the club (via `assert_club_organizer`, the same helper `set_payment_status` already uses for this exact check — see `supabase/migrations/20260906150000_payment_mutations.sql`). Consumed by Task 6's `createInvite`.

- [ ] **Step 1: Write the migration**

```sql
-- Invite creation moves from a plain client-side insert to a
-- security-definer RPC so a friendly "already a member" error is possible
-- (an RLS WITH CHECK failure only ever reports as an opaque "row-level
-- security policy violation", not a message a UI can show as-is).
--
-- Direct INSERT on club_invites is revoked below once this exists, so
-- creation only ever happens through this one path.
create function public.create_club_invite(
  target_club_id uuid,
  target_email text,
  target_display_name text,
  target_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  -- Raises 42501 itself if the caller does not organize this club (or the
  -- club does not exist) -- same helper, same error class, as
  -- set_payment_status's own tenancy check.
  perform public.assert_club_organizer(target_club_id);

  if exists (
    select 1
    from public.club_members cm
    join auth.users u on u.id = cm.profile_id
    where cm.club_id = target_club_id
      and cm.status = 'active'
      and lower(u.email) = lower(target_email)
  ) then
    raise exception 'That person is already in this club';
  end if;

  insert into public.club_invites (club_id, email, display_name, event_id)
  values (
    target_club_id,
    target_email,
    nullif(target_display_name, ''),
    target_event_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.create_club_invite(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.create_club_invite(uuid, text, text, uuid)
  to authenticated;

-- Creation only ever happens through create_club_invite now.
revoke insert on public.club_invites from authenticated;
```

- [ ] **Step 2: Confirm `assert_club_organizer` exists with this exact name and behavior**

Run: `grep -rn "function public.assert_club_organizer" supabase/migrations/`
Expected: one definition found (it should already exist — `supabase/migrations/20260906150000_payment_mutations.sql` calls it, so it must be defined somewhere at or before that migration). Read that definition and confirm it raises on a caller who is not an active host/co-organizer of the given club id, including when the club id does not exist at all. If its behavior differs from this assumption, adjust Step 1's call accordingly and note the discrepancy in your report — do not guess silently.

- [ ] **Step 3: Apply locally**

Run: `npx supabase db reset --local`
Expected: migration applies cleanly.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923020000_create_club_invite_rpc.sql
git commit -m "$(cat <<'EOF'
feat(db): add create_club_invite RPC, revoke direct insert

Moves invite creation into a security-definer function so re-inviting
an existing member gets a real error instead of an opaque RLS
violation. Direct INSERT on club_invites is revoked -- this is now
the only way to create one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration — redemption RPCs (`accept_club_invite`, `decline_club_invite`, `fetch_my_pending_invites`)

**Files:**
- Create: `supabase/migrations/20260923030000_club_invite_accept_decline_fetch.sql`

**Interfaces:**
- Consumes: `club_invites` from Task 1.
- Produces:
  - `accept_club_invite(invite_id uuid) returns jsonb` — same body as today's `accept_club_invite(text)` (`supabase/migrations/20260905170000_accept_invite_seating_log_warning.sql`) minus the token lookup, plus an email-match check folded into the existing "is this invite valid at all" gate. Returns `null` (not a raised exception) for not-found/already-accepted/already-declined/expired/email-mismatch, exactly like today's function already does for the first three — one unified "not valid for you" gate, not two different failure-reporting styles in the same function.
  - `decline_club_invite(invite_id uuid) returns boolean` — `true` if actually declined, `false` for the same "not valid for you" set of reasons `accept_club_invite` returns null for.
  - `fetch_my_pending_invites() returns table (id uuid, club_id uuid, club_name text, event_id uuid, event_title text)` — pending invites (not accepted, not declined, not expired) addressed to the caller's own authenticated email.

Consumed by Task 7's `acceptClubInvite` / `declineClubInvite` / `fetchMyPendingInvites`.

- [ ] **Step 1: Write the migration**

```sql
-- accept_club_invite's parameter changes from a bearer token (text) to an
-- id (uuid) -- security no longer comes from the token being secret, it
-- comes from the email match below, so there is nothing left for a secret
-- string to protect. Postgres cannot `create or replace` across a
-- parameter-type change, so the old signature is dropped outright (this
-- codebase has hit exactly this before -- see
-- 20260905180200_accept_invite_revoke_public.sql's own comment on why a
-- signature change resets EXECUTE to PUBLIC and needs fresh grants).
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

        insert into public.booking_groups (club_id, event_id, created_by)
        values (invite.club_id, invite.event_id, caller)
        returning id into new_group;

        if seating->>'outcome' = 'seated' then
          for placement in select * from jsonb_array_elements(seating->'placements')
          loop
            insert into public.bookings (
              event_id, profile_id, event_table_id, group_id, status
            ) values (
              invite.event_id,
              caller,
              (placement->>'event_table_id')::uuid,
              new_group,
              'confirmed'
            );
          end loop;
        else
          insert into public.bookings (event_id, profile_id, group_id, status)
          values (invite.event_id, caller, new_group, 'waitlisted');
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
```

Note on `events.title`: this plan assumes the events table's title column is named `title` (matching `RenderRow.event_title`'s source column in the existing notification system). If Step 2 below shows a different column name, adjust the `e.title as event_title` line before proceeding.

- [ ] **Step 2: Confirm the `events` table's title column name**

Run: `grep -n "title" supabase/migrations/*create_events*.sql supabase/migrations/*events*.sql 2>/dev/null | grep -i "column\|title text\|title varchar" | head -5`
Expected: confirms the column is named `title`. If not, fix the migration from Step 1 before applying it.

- [ ] **Step 3: Apply locally**

Run: `npx supabase db reset --local`
Expected: migration applies cleanly, no errors about the dropped/recreated function.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923030000_club_invite_accept_decline_fetch.sql
git commit -m "$(cat <<'EOF'
feat(db): accept/decline invites by id with an email match, add fetch_my_pending_invites

accept_club_invite moves from a bearer token to an id, and now
actually checks the invite's email against the caller's authenticated
email -- the bug the whole redesign exists to fix. decline_club_invite
and fetch_my_pending_invites are new; the latter is how the dashboard
banner finds invites addressed to the signed-in member, without any
client-side storage or hand-off.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: pgTAP tests — `create_club_invite`

**Files:**
- Create: `supabase/tests/database/fixtures/create_club_invite.test.sql`

**Interfaces:**
- Consumes: `create_club_invite` from Task 2.

- [ ] **Step 1: Write the test file**

Follow `supabase/tests/database/fixtures/accept_invite_seats_guest.test.sql`'s exact structure (`begin; set local search_path...; select plan(N); <fixtures>; set local role authenticated; set local request.jwt.claims = '{"sub": "...", "role": "authenticated"}'; <assertions>; reset role; select * from finish(); rollback;`). Build fixtures with literal UUIDs in the same `xxxxxxxx-0000-0000-0000-00000000fa0N` style already used in that file.

Cover, in this order:
1. A host creates an invite for an email with no existing account → `create_club_invite` returns a non-null uuid, and a row exists in `club_invites` with that email, `accepted_at is null`, `declined_at is null`.
2. A co-organizer can also create one (same assertion shape, different caller role in the fixture).
3. A plain member (not host/co-organizer) attempting to call it → `select throws_ok($$select public.create_club_invite('<club>', 'x@example.com', '', null)$$, '42501', null, 'a plain member cannot invite');`
4. Inviting an email that already belongs to an active member of the club → `select throws_ok($$select public.create_club_invite('<club>', '<existing-member-email>', '', null)$$, 'P0001', 'That person is already in this club', 'cannot re-invite an existing member');`
5. A caller with no session at all (`set local request.jwt.claims = '{"role": "authenticated"}';`, no `sub`) → same `42501` throw as case 3, matching `waitlist_promotion.test.sql`'s own dedicated null-caller case (this guard needs its own assertion rather than assuming the organizer check catches it the same way).
6. Passing a real `target_event_id` that belongs to the same club → the created row's `event_id` matches what was passed (a plain `select is(...)` against the row, not the function's return value, since the function only returns the new id).

- [ ] **Step 2: Run it**

Run: `npx supabase test db --local`
Expected: the new file's plan count passes, 0 failures, and the full suite's total assertion count increases by exactly the number of `select is/ok/throws_ok` calls you wrote.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/fixtures/create_club_invite.test.sql
git commit -m "$(cat <<'EOF'
test(db): cover create_club_invite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: pgTAP tests — `accept_club_invite`, `decline_club_invite`, `fetch_my_pending_invites`

**Files:**
- Create: `supabase/tests/database/fixtures/club_invite_accept_decline_fetch.test.sql`

**Interfaces:**
- Consumes: the three RPCs from Task 3.

- [ ] **Step 1: Write the test file**

Same structural template as Task 4. Build fixtures directly in `auth.users`/`public.club_invites` (no need to go through `create_club_invite` for these — insert invite rows directly with literal UUIDs, matching `accept_invite_seats_guest.test.sql`'s own style of inserting `club_invites` rows by hand).

Cover:
1. `fetch_my_pending_invites()`, called as the invited user, returns exactly the invite(s) addressed to their email (case-insensitive — fixture one invite with `Email@Example.com`, sign in as `email@example.com`, confirm it's returned) and none belonging to a different email.
2. `fetch_my_pending_invites()` excludes an already-accepted invite, an already-declined invite, and an expired one (three separate fixture rows, one assertion each that the result set does not include that row's id — `results_eq`/`is_empty` style, or `is((select count(*) from (select * from public.fetch_my_pending_invites()) t where id = '<row>'), 0, '...')`).
3. `accept_club_invite(invite_id)` called by the matching email → returns the `jsonb` with the right `club_id`, and a `club_members` row now exists for that caller/club.
4. `accept_club_invite(invite_id)` called by a signed-in user whose email does NOT match the invite → returns `null`, and no `club_members` row is created (this is the actual bug fix — assert both halves, not just the return value).
5. `accept_club_invite(invite_id)` called with no session (`request.jwt.claims` has no `sub`) → returns `null` (matching today's existing behavior for this case, unchanged).
6. `decline_club_invite(invite_id)` called by the matching email → returns `true`, and the row now has `declined_at is not null`.
7. `decline_club_invite(invite_id)` called twice in a row → the second call returns `false` (idempotent-safe, matches the plan's stated requirement).
8. `decline_club_invite(invite_id)` called by a non-matching email → returns `false`, and `declined_at` stays null.
9. An event-tied invite (mirror the existing `accept_invite_seats_guest.test.sql` fixture shape for this one case, reusing its exact venue/event/table setup) accepted by the matching email → the returned `jsonb`'s `event_id` is populated and a `bookings` row exists, exactly like that existing test already proves for the token-based version — this confirms the seating logic survived the token→id change unchanged.

- [ ] **Step 2: Run it**

Run: `npx supabase test db --local`
Expected: passes, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/fixtures/club_invite_accept_decline_fetch.test.sql
git commit -m "$(cat <<'EOF'
test(db): cover accept_club_invite's email-match gate, decline_club_invite, and fetch_my_pending_invites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `grants.test.sql` updates

**Files:**
- Modify: `supabase/tests/database/portable/grants.test.sql`

**Interfaces:**
- Consumes: all function signatures introduced/changed in Tasks 2-3.

- [ ] **Step 1: Update the four existing `accept_club_invite(text)` references**

At each of the four locations found in this codebase (confirmed present at the time this plan was written — search to get current line numbers, since earlier edits in this same file may have shifted them):
- The negative anon-cannot-execute assertion (originally around line 176-179)
- The positive authenticated-can-execute assertion (originally around line 215-218)
- The "Direction 1" bidirectional allowlist array entry (originally around line 731)
- The "Direction 2" bidirectional allowlist array entry (originally around line 827)

Change every occurrence of the literal string `'public.accept_club_invite(text)'` to `'public.accept_club_invite(uuid)'`.

- [ ] **Step 2: Check for an existing INSERT assertion on `club_invites`**

Run: `grep -n "club_invites.*INSERT\|INSERT.*club_invites" supabase/tests/database/portable/grants.test.sql`

If a positive assertion exists (`has_table_privilege('authenticated', 'public.club_invites', 'INSERT')` asserted `ok`), flip it to a negative assertion (`not has_table_privilege(...)`) with an updated description, since Task 2 revoked this grant. If no such assertion exists, add one negative assertion for it, right next to the existing `TRUNCATE`/`DELETE` assertions for `club_invites` (around the original line 34-45 area).

- [ ] **Step 3: Add assertions for `create_club_invite`, `decline_club_invite`, and `fetch_my_pending_invites`**

Copy the exact shape of the `set_payment_status`/`event_payment_status` block (around the original line 458-493 area) for each of the three new functions — one positive `authenticated` assertion and one negative `anon` assertion per function, using their exact signatures: `public.create_club_invite(uuid, text, text, uuid)`, `public.decline_club_invite(uuid)`, `public.fetch_my_pending_invites()`.

- [ ] **Step 4: Add all four new/changed signatures to both bidirectional allowlist arrays**

In both "Direction 1" and "Direction 2" arrays (originally around lines 719-807 and 809-896), add:
```
'public.create_club_invite(uuid, text, text, uuid)',
'public.decline_club_invite(uuid)',
'public.fetch_my_pending_invites()',
```
(`accept_club_invite(uuid)` replaces the existing `accept_club_invite(text)` entry you already updated in Step 1 — do not add it a second time.)

- [ ] **Step 5: Bump the plan count**

Find `select plan(119);` (or whatever the current count is — confirm by reading the file, since it may have moved since this plan was written) at the top of the file and increase it by exactly the number of new `select ok(...)`/`select is(...)` assertions you added in Steps 2-3 (6 new assertions if Step 2 needed one added, 6 if it only needed one flipped — count precisely from what you actually wrote).

- [ ] **Step 6: Run it**

Run: `npx supabase test db --local`
Expected: `grants.test.sql`'s reported plan count matches its actual assertion count (a pgTAP mismatch here is loud and immediate), 0 failures.

- [ ] **Step 7: Commit**

```bash
git add supabase/tests/database/portable/grants.test.sql
git commit -m "$(cat <<'EOF'
test(db): update grants.test.sql for the invite-redesign RPCs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `lib/clubs.ts` client updates

**Files:**
- Modify: `lib/clubs.ts`
- Modify: `lib/clubs.test.ts` (or wherever this file's existing tests live — confirm the exact path by finding the test file that currently covers `createInvite`/`acceptInvite`/`deleteInvite`/`fetchPendingInvites`, and follow its exact existing mocking conventions for `supabase.rpc`/`supabase.from`)

**Interfaces:**
- Consumes: `create_club_invite`, `accept_club_invite(uuid)`, `decline_club_invite(uuid)`, `fetch_my_pending_invites()` from Tasks 2-3.
- Produces:
  - `ClubInvite` type: drops `token`, adds `declined_at: string | null`.
  - `createInvite(clubId: string, email: string, displayName?: string, eventId?: string): Promise<{ id: string | null; error: string | null }>` (renamed return shape from `{ token }` to `{ id }`; `email` is now a required positional argument, not part of an optional `target` object).
  - `acceptClubInvite(inviteId: string): Promise<{ clubId: string | null; eventId: string | null; error: string | null }>` (renamed from `acceptInvite`, same return shape, new `inviteId` parameter).
  - `declineClubInvite(inviteId: string): Promise<{ error: string | null }>` (new).
  - `fetchMyPendingInvites(): Promise<PendingInvite[] | null>` (new) where `PendingInvite = { id: string; clubId: string; clubName: string; eventId: string | null; eventTitle: string | null }`.
  - `fetchPendingInvites` (existing, organizer-facing list): query updated to select `declined_at` instead of `token`, and to stop filtering on `accepted_at`/`expires_at` alone — see Step 3.
  - `PENDING_INVITE_KEY` is removed (Task 14 removes its remaining consumers).

- [ ] **Step 1: Update the `ClubInvite` type and `INVITE_COLUMNS`**

Replace (currently lines 31-40 and line 51):
```ts
export type ClubInvite = {
  id: string;
  email: string | null;
  display_name: string | null;
  skill_level: SkillLevel | null;
  /** Same select grant and RLS as the rest of the row (organizer-only) --
   *  the same role that could already read this by creating a NEW invite
   *  right after this one can read this one's token too. */
  token: string;
};
```
with:
```ts
export type ClubInvite = {
  id: string;
  email: string;
  display_name: string | null;
  skill_level: SkillLevel | null;
  declined_at: string | null;
};
```
and change:
```ts
const INVITE_COLUMNS = 'id, email, display_name, skill_level, token';
```
to:
```ts
const INVITE_COLUMNS = 'id, email, display_name, skill_level, declined_at';
```

- [ ] **Step 2: Replace `createInvite`**

Replace the current function (lines 457-484) with:
```ts
/**
 * Now a security-definer RPC, not a plain insert -- `create_club_invite`
 * (see the migration that added it) can give a real "already a member"
 * error, which an RLS WITH CHECK failure never could.
 */
export async function createInvite(
  clubId: string,
  email: string,
  displayName?: string,
  eventId?: string,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('create_club_invite', {
      target_club_id: clubId,
      target_email: email.trim(),
      target_display_name: displayName?.trim() ?? '',
      target_event_id: eventId ?? null,
    });

    if (error) {
      console.error('createInvite failed', error);
      if (error.message.includes('already in this club')) {
        return { id: null, error: 'That person is already in this club.' };
      }
      return { id: null, error: GENERIC_ERROR };
    }
    return { id: data as string, error: null };
  } catch (cause) {
    console.error('createInvite failed', cause);
    return { id: null, error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 3: Update `fetchPendingInvites`**

Replace the current function body's select (lines 371-392) — the organizer's list should now also surface declined invites (so an organizer can see "declined" rather than the person just silently never showing up), not only pending ones:
```ts
export async function fetchPendingInvites(
  clubId: string,
): Promise<ClubInvite[] | null> {
  try {
    const { data, error } = await supabase
      .from('club_invites')
      .select(INVITE_COLUMNS)
      .eq('club_id', clubId)
      .is('accepted_at', null)
      .order('created_at');

    if (error) {
      console.error('fetchPendingInvites failed', error);
      return null;
    }
    return (data ?? []) as ClubInvite[];
  } catch (cause) {
    console.error('fetchPendingInvites failed', cause);
    return null;
  }
}
```
(Dropped the `.gt('expires_at', ...)` filter along with the "pending" framing — an organizer should still see a genuinely expired, never-answered invite as something to deal with, not have it silently vanish. `declined_at` on each returned row is what the UI in Task 10 uses to render its status.)

- [ ] **Step 4: Rename `acceptInvite` to `acceptClubInvite`, add `declineClubInvite`**

Replace (lines 542-567):
```ts
export async function acceptInvite(
  token: string,
): Promise<{ clubId: string | null; eventId: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_club_invite', {
      invite_token: token,
    });

    if (error) {
      console.error('acceptInvite failed', error);
      return { clubId: null, eventId: null, error: GENERIC_ERROR };
    }
    if (!data) {
      return {
        clubId: null,
        eventId: null,
        error: 'That invite link has expired or has already been used.',
      };
    }
    const result = data as { club_id: string; event_id: string | null };
    return { clubId: result.club_id, eventId: result.event_id, error: null };
  } catch (cause) {
    console.error('acceptInvite failed', cause);
    return { clubId: null, eventId: null, error: GENERIC_ERROR };
  }
}
```
with:
```ts
export async function acceptClubInvite(
  inviteId: string,
): Promise<{ clubId: string | null; eventId: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_club_invite', {
      invite_id: inviteId,
    });

    if (error) {
      console.error('acceptClubInvite failed', error);
      return { clubId: null, eventId: null, error: GENERIC_ERROR };
    }
    if (!data) {
      return {
        clubId: null,
        eventId: null,
        error: 'That invite is no longer valid.',
      };
    }
    const result = data as { club_id: string; event_id: string | null };
    return { clubId: result.club_id, eventId: result.event_id, error: null };
  } catch (cause) {
    console.error('acceptClubInvite failed', cause);
    return { clubId: null, eventId: null, error: GENERIC_ERROR };
  }
}

export async function declineClubInvite(
  inviteId: string,
): Promise<{ error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('decline_club_invite', {
      invite_id: inviteId,
    });
    if (error) {
      console.error('declineClubInvite failed', error);
      return { error: GENERIC_ERROR };
    }
    if (!data) {
      return { error: 'That invite is no longer valid.' };
    }
    return { error: null };
  } catch (cause) {
    console.error('declineClubInvite failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 5: Add `fetchMyPendingInvites` and its type, remove `PENDING_INVITE_KEY`**

Remove the `PENDING_INVITE_KEY` export (lines 521-533) — Task 14 removes its last remaining consumers, and leaving it exported with nothing importing it would be dead code. Add, in its place:
```ts
export type PendingInvite = {
  id: string;
  clubId: string;
  clubName: string;
  eventId: string | null;
  eventTitle: string | null;
};

/**
 * Invites addressed to the caller's own authenticated email, across every
 * club -- not scoped to one club id, unlike `fetchPendingInvites` above,
 * because the dashboard (unlike a club's own detail screen) has no single
 * club in view. `fetch_my_pending_invites` is `security definer` for the
 * same reason `acceptClubInvite`'s RPC is: the caller is by definition not
 * yet a member of whichever club invited them, so no membership-scoped
 * policy could let them read it.
 */
export async function fetchMyPendingInvites(): Promise<PendingInvite[] | null> {
  try {
    const { data, error } = await supabase.rpc('fetch_my_pending_invites');
    if (error) {
      console.error('fetchMyPendingInvites failed', error);
      return null;
    }
    return (
      (data ?? []) as {
        id: string;
        club_id: string;
        club_name: string;
        event_id: string | null;
        event_title: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      clubId: row.club_id,
      clubName: row.club_name,
      eventId: row.event_id,
      eventTitle: row.event_title,
    }));
  } catch (cause) {
    console.error('fetchMyPendingInvites failed', cause);
    return null;
  }
}
```

- [ ] **Step 6: Update this file's existing tests**

Find the test file covering `lib/clubs.ts` (its `describe('createInvite', ...)` / `describe('acceptInvite', ...)` blocks). Update:
- `createInvite`'s tests to call the new positional-argument signature and assert `supabase.rpc` is called with `'create_club_invite'` and the `target_*` argument names shown in Step 2, including a case for the "already a member" error-message mapping.
- Rename `acceptInvite` tests to `acceptClubInvite`, asserting `supabase.rpc` is called with `'accept_club_invite'` and `{ invite_id: ... }` (not `invite_token`).
- Add a `declineClubInvite` describe block mirroring `acceptClubInvite`'s test shape.
- Add a `fetchMyPendingInvites` describe block: resolves to `[]` on an RPC error (not `null` — wait, re-check: this function returns `null` on error per its own code above, matching `fetchPendingInvites`'s existing convention; write the test to actually match what the code does, not what seems intuitive) and maps `club_id`/`club_name`/`event_id`/`event_title` to the camelCase shape on success.
- Update `fetchPendingInvites`'s existing tests for the `INVITE_COLUMNS` change (no more `token` in the mocked response rows; a `declined_at` field now present).

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run lib/clubs.test.ts && npx tsc --noEmit`
Expected: `lib/clubs.test.ts` passes. `tsc` will show errors in every file that still calls the old `acceptInvite`/`createInvite(clubId, target?)` shapes or imports `PENDING_INVITE_KEY` — that is expected here; Tasks 10-14 fix each of those call sites. Confirm the errors are ONLY in files this plan's later tasks touch (`app/clubs/[id]/index.tsx`, `app/clubs/[id]/events/[eventId]/index.tsx`, `app/join/[token].tsx`, `app/index.tsx`) and nowhere else.

- [ ] **Step 8: Commit**

```bash
git add lib/clubs.ts lib/clubs.test.ts
git commit -m "$(cat <<'EOF'
feat(clubs): update client wrappers for email-targeted invites

createInvite now requires an email and calls the new
create_club_invite RPC; acceptInvite is renamed acceptClubInvite and
takes an invite id instead of a token; declineClubInvite and
fetchMyPendingInvites are new. Call sites are updated in later
commits on this branch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extract `supabase/functions/_shared/`

**Files:**
- Create: `supabase/functions/_shared/brand.ts` (moved from `deliver-notifications/brand.ts`)
- Create: `supabase/functions/_shared/sender.ts` (moved from `deliver-notifications/sender.ts`)
- Create: `supabase/functions/_shared/smtp.ts` (moved from `deliver-notifications/smtp.ts`)
- Create: `supabase/functions/_shared/pooled-connection.ts` (moved from `deliver-notifications/pooled-connection.ts`)
- Create: `supabase/functions/_shared/denomailer.d.ts` (moved from `deliver-notifications/denomailer.d.ts`)
- Create: `supabase/functions/_shared/email-types.ts` (new — the `Body`/`Cta`/`Message` subset of `deliver-notifications/types.ts`, without `RenderRow`/`OutboxKind`, which stay outbox-specific)
- Create: `supabase/functions/_shared/email-shell.ts` (moved from `deliver-notifications/templates/shell.ts`, importing `brand` and the `Body` type from their new shared locations)
- Create: `supabase/functions/_shared/email-text.ts` (new — `sanitizeSubject`/`assertCleanAddress`/`renderText`, extracted from `deliver-notifications/render.ts`)
- Modify: `deliver-notifications/render.ts`, `deliver-notifications/smtp.ts` references, `deliver-notifications/types.ts`, and any other file under `deliver-notifications/` that imported the moved files, to import from `../_shared/...` instead
- Modify: `deliver-notifications/__tests__/pooled-connection.test.ts` and `render.test.ts` (import paths only)

**Interfaces:**
- Produces: `SmtpSender` (from `_shared/smtp.ts`), `Sender`/`FakeSender` (from `_shared/sender.ts`), `renderShell`/`escapeHtml` (from `_shared/email-shell.ts`), `brand` (from `_shared/brand.ts`), `Body`/`Cta`/`Message` types (from `_shared/email-types.ts`), `sanitizeSubject`/`assertCleanAddress`/`renderText` (from `_shared/email-text.ts`). Consumed by Task 9's `send-club-invite`.
- This is the **first** shared module between edge functions in this repo — there is no existing convention to follow beyond "a relative-path sibling directory," which is how Supabase's own docs describe cross-function sharing.

- [ ] **Step 1: Move the five reusable files verbatim**

```bash
mkdir -p supabase/functions/_shared/templates
git mv supabase/functions/deliver-notifications/brand.ts supabase/functions/_shared/brand.ts
git mv supabase/functions/deliver-notifications/sender.ts supabase/functions/_shared/sender.ts
git mv supabase/functions/deliver-notifications/smtp.ts supabase/functions/_shared/smtp.ts
git mv supabase/functions/deliver-notifications/pooled-connection.ts supabase/functions/_shared/pooled-connection.ts
git mv supabase/functions/deliver-notifications/denomailer.d.ts supabase/functions/_shared/denomailer.d.ts
```

- [ ] **Step 2: Fix the moved files' own relative imports**

`_shared/smtp.ts` imports `from './pooled-connection.ts'`, `from './sender.ts'`, and `from './types.ts'` (for `Message`) — the first two stay relative (both now siblings in `_shared/`), the last needs to become `from './email-types.ts'` once you create that file in Step 3.

- [ ] **Step 3: Create `_shared/email-types.ts`**

```ts
/** One call to action. At most one per message, deliberately. */
export type Cta = { label: string; url: string };

/**
 * What a message says, before it is any particular format. Both the HTML
 * and the plain-text parts are built from this -- the text is never
 * scraped out of the HTML, which is how text parts end up full of stray
 * markup.
 */
export type Body = {
  subject: string;
  headline: string;
  paragraphs: string[];
  cta: Cta | null;
  footerNote: string;
};

export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
```

Then update `deliver-notifications/types.ts` to import and re-export these instead of defining them itself:
```ts
export type { Body, Cta, Message } from '../_shared/email-types.ts';
```
(Keep `RenderRow` and `OutboxKind` defined in `deliver-notifications/types.ts` exactly as they are — those stay outbox-specific.)

- [ ] **Step 4: Move and adjust the shell template**

```bash
git mv supabase/functions/deliver-notifications/templates/shell.ts supabase/functions/_shared/email-shell.ts
```
In the moved file, change:
```ts
import { brand } from '../brand.ts';
import type { Body } from '../types.ts';
```
to:
```ts
import { brand } from './brand.ts';
import type { Body } from './email-types.ts';
```
Then update `deliver-notifications/templates/bodies.ts` (which likely imports `Body`/`Cta` from `../types.ts`) and `deliver-notifications/render.ts` (which imports `renderShell` from `./templates/shell.ts`) to point at the new locations:
```ts
// render.ts
import { renderShell } from '../_shared/email-shell.ts';
```

- [ ] **Step 5: Extract `_shared/email-text.ts`**

From `deliver-notifications/render.ts`, move `sanitizeSubject`, `assertCleanAddress`, and `renderText` (the three standalone functions, not `renderMessage` itself, which stays in `render.ts` since it's specific to `RenderRow`) into a new file:
```ts
import type { Body } from './email-types.ts';

/**
 * `subject` becomes a raw RFC 5322 header value once it reaches the SMTP
 * client. Collapsing every control character to a single space closes off
 * a header-injection path before the subject leaves this module.
 */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * `to` becomes a raw RFC 5322 header value too, but stripping is the wrong
 * move here (see deliver-notifications/render.ts's original docstring for
 * the full reasoning) -- a mangled address is not cosmetic, so this
 * refuses rather than rewrites.
 */
export function assertCleanAddress(address: string): string {
  if (/[\x00-\x1f\x7f]/.test(address)) {
    throw new Error(
      `recipient address contains a control character: ${JSON.stringify(address)}`,
    );
  }
  return address;
}

/**
 * Built from the same Body the HTML is built from, never scraped out of
 * the HTML.
 */
export function renderText(body: Body, clubName: string, settingsUrl: string): string {
  const parts = [body.headline, '', ...body.paragraphs];
  if (body.cta) parts.push('', `${body.cta.label}: ${body.cta.url}`);
  parts.push('', '---', `Sent by ${clubName} on MahjHero.`, body.footerNote,
             `Notification settings: ${settingsUrl}`);
  return parts.join('\n');
}
```
Update `deliver-notifications/render.ts` to import these three from `'../_shared/email-text.ts'` instead of defining them locally, and delete its own copies.

- [ ] **Step 6: Fix the two existing test files' import paths**

`deliver-notifications/__tests__/pooled-connection.test.ts` and `render.test.ts` currently import from sibling files by relative path (e.g. `from '../pooled-connection'`). Update any import that now points at a moved file to `'../../_shared/pooled-connection'` etc. — read both files first to find every affected import rather than guessing which ones moved.

- [ ] **Step 7: Run the existing tests and typecheck**

Run: `npx vitest run supabase/functions/deliver-notifications/__tests__ && npx tsc --noEmit`
Expected: both existing test files pass unchanged (this task only moves code and fixes import paths — it must not change behavior). `tsc` should show no new errors related to this move (pre-existing errors from Task 7's rename are still expected and unrelated).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared supabase/functions/deliver-notifications
git commit -m "$(cat <<'EOF'
refactor(functions): extract supabase/functions/_shared/

Moves deliver-notifications' low-level SMTP sending and email
templating code (brand, shell, SMTP client, connection pooling) into
a shared module, so the new send-club-invite function (next commit)
can reuse hardened, tested sending code without depending on the
outbox/batch pipeline, which is auth.users-based and can't target
someone who has never signed up. Behavior-preserving: no logic
changed, only file locations and import paths.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `send-club-invite` edge function

**Files:**
- Create: `supabase/functions/send-club-invite/index.ts`
- Create: `supabase/functions/send-club-invite/__tests__/index.test.ts`
- Modify: `supabase/config.toml` (new `[functions.send-club-invite]` section)
- Modify: `lib/clubs.ts` (new `sendClubInviteEmail` wrapper)
- Modify: `lib/clubs.test.ts`

**Interfaces:**
- Consumes: `_shared/smtp.ts`, `_shared/email-shell.ts`, `_shared/email-text.ts`, `_shared/brand.ts`, `_shared/email-types.ts` from Task 8.
- Produces: an HTTP endpoint invoked as `supabase.functions.invoke('send-club-invite', { body: { to, clubName, inviteeDisplayName } })`, and a client wrapper `sendClubInviteEmail(params: { to: string; clubName: string; inviteeDisplayName?: string }): Promise<{ error: string | null }>` in `lib/clubs.ts`. Consumed by Task 10, 11, and 12.

- [ ] **Step 1: Write the edge function**

```ts
import { SmtpSender } from '../_shared/smtp.ts';
import { renderShell } from '../_shared/email-shell.ts';
import { sanitizeSubject, assertCleanAddress, renderText } from '../_shared/email-text.ts';
import type { Body } from '../_shared/email-types.ts';

// Same local-stub reasoning as deliver-notifications/index.ts: a bare
// top-level `declare const Deno` in a *script* file leaks globally to
// every file `tsc` type-checks; inside a *module* file (this one, because
// of the imports above) it stays local. Repeated here rather than shared,
// on purpose -- see that file's own long comment for why.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

type InvitePayload = {
  to: string;
  clubName: string;
  inviteeDisplayName?: string;
};

function isInvitePayload(value: unknown): value is InvitePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).to === 'string' &&
    typeof (value as Record<string, unknown>).clubName === 'string'
  );
}

/**
 * Deliberately isolated from deliver-notifications' outbox/batch pipeline,
 * which resolves recipients through auth.users -- this needs to reach
 * someone who has never signed up. Everything it needs (recipient,
 * club name, invitee's display name) arrives directly in the request body
 * from the already-authenticated client; this function does its own no
 * database lookup and needs no service-role key, only SMTP credentials.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isInvitePayload(payload)) {
    return new Response(
      JSON.stringify({ error: 'expected { to: string, clubName: string, inviteeDisplayName?: string }' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let to: string;
  try {
    to = assertCleanAddress(payload.to);
  } catch (cause) {
    return new Response(JSON.stringify({ error: (cause as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.mahjhero.com';
  const settingsUrl = `${appUrl}/sign-in`;
  const greeting = payload.inviteeDisplayName?.trim()
    ? `Hi ${payload.inviteeDisplayName.trim()},`
    : 'Hi,';

  const body: Body = {
    subject: `You're invited to ${payload.clubName}`,
    headline: `You're invited to ${payload.clubName}`,
    paragraphs: [
      greeting,
      `You've been invited to join ${payload.clubName} on MahjHero. Sign in with this email address to see the invite and accept it.`,
    ],
    cta: { label: 'Sign in to MahjHero', url: `${appUrl}/sign-in` },
    footerNote: "Didn't expect this? You can safely ignore this email.",
  };

  const sender = new SmtpSender({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    user: Deno.env.get('SMTP_USER') ?? '',
    pass: Deno.env.get('SMTP_PASS') ?? '',
    from: required('SMTP_FROM'),
  });

  try {
    await sender.send({
      to,
      subject: sanitizeSubject(body.subject),
      html: renderShell(body, payload.clubName, settingsUrl),
      text: renderText(body, payload.clubName, settingsUrl),
    });
  } catch (cause) {
    console.error('send-club-invite failed', cause);
    return new Response(JSON.stringify({ error: 'failed to send' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await sender.close?.();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Check `_shared/smtp.ts`'s `SmtpConfig` type (moved in Task 8) matches the object literal passed to `new SmtpSender(...)` above exactly (`host`, `port`, `user`, `pass`, `from`) — it should, since Task 8 moved that file verbatim, but confirm before moving on.

- [ ] **Step 2: Register it in `supabase/config.toml`**

Add, near the existing `[functions.deliver-notifications]` section:
```toml
# Called directly by an authenticated app user (not a cron job like
# deliver-notifications), so this keeps the default verify_jwt = true --
# unlike deliver-notifications, there is no reason to accept unauthenticated
# calls here.
[functions.send-club-invite]
verify_jwt = true
```

- [ ] **Step 3: Write a test for the payload-validation logic**

Since this function only uses `fetch`-adjacent web-standard APIs plus the moved `_shared` modules (no direct Deno-URL import itself — `SmtpSender` is the one with that dependency, same split `deliver-notifications` already uses), most of this file's logic (payload validation, body composition) can be tested directly with Vitest, matching `deliver-notifications/__tests__/render.test.ts`'s precedent. Since `Deno.serve`/`Deno.env` themselves aren't callable outside a Deno runtime, extract the two pure pieces worth testing into their own exported functions first — add these two named exports to `index.ts` above `Deno.serve(...)`:
```ts
export { isInvitePayload };

export function buildInviteBody(payload: InvitePayload, appUrl: string): Body {
  const greeting = payload.inviteeDisplayName?.trim()
    ? `Hi ${payload.inviteeDisplayName.trim()},`
    : 'Hi,';
  return {
    subject: `You're invited to ${payload.clubName}`,
    headline: `You're invited to ${payload.clubName}`,
    paragraphs: [
      greeting,
      `You've been invited to join ${payload.clubName} on MahjHero. Sign in with this email address to see the invite and accept it.`,
    ],
    cta: { label: 'Sign in to MahjHero', url: `${appUrl}/sign-in` },
    footerNote: "Didn't expect this? You can safely ignore this email.",
  };
}
```
and use `buildInviteBody(payload, appUrl)` in place of the inline `body` object inside the `Deno.serve` handler.

Then write `supabase/functions/send-club-invite/__tests__/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isInvitePayload, buildInviteBody } from '../index';

describe('isInvitePayload', () => {
  it('accepts a payload with the required fields', () => {
    expect(isInvitePayload({ to: 'a@example.com', clubName: 'Tiles Club' })).toBe(true);
  });

  it('accepts an optional inviteeDisplayName', () => {
    expect(
      isInvitePayload({ to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' }),
    ).toBe(true);
  });

  it('rejects a payload missing "to"', () => {
    expect(isInvitePayload({ clubName: 'Tiles Club' })).toBe(false);
  });

  it('rejects a payload missing "clubName"', () => {
    expect(isInvitePayload({ to: 'a@example.com' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isInvitePayload(null)).toBe(false);
  });
});

describe('buildInviteBody', () => {
  it('greets the invitee by name when one is given', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' },
      'https://app.mahjhero.com',
    );
    expect(body.paragraphs[0]).toBe('Hi Ann,');
  });

  it('falls back to a generic greeting with no display name', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club' },
      'https://app.mahjhero.com',
    );
    expect(body.paragraphs[0]).toBe('Hi,');
  });

  it('names the club in the headline and the CTA points at sign-in', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club' },
      'https://app.mahjhero.com',
    );
    expect(body.headline).toBe("You're invited to Tiles Club");
    expect(body.cta).toEqual({
      label: 'Sign in to MahjHero',
      url: 'https://app.mahjhero.com/sign-in',
    });
  });
});
```

Note: this test file imports `../index`, which itself imports `../_shared/smtp.ts` (a Deno-URL-importing file) at module load — check whether this causes the same "cannot resolve" failure `deliver-notifications`'s own split was built to avoid (its docstring at `pooled-connection.ts:1-13` explains exactly this constraint). If Vitest fails to even load `index.ts` because of the `smtp.ts` import chain, move `isInvitePayload`/`buildInviteBody`/the `InvitePayload` type into their own new file (`supabase/functions/send-club-invite/payload.ts`, no Deno-URL imports), have `index.ts` import them from there, and point this test file at `../payload` instead of `../index` — mirroring exactly how `deliver-notifications` keeps `render.ts` (tested) separate from `smtp.ts` (not tested by Vitest). Report which shape you ended up needing.

- [ ] **Step 4: Add the client wrapper in `lib/clubs.ts`**

```ts
/**
 * Fires the invite email. Deliberately fire-and-forget from the caller's
 * perspective in terms of UX (the invite already exists whether or not
 * this succeeds -- see the design's own accepted trade-off), but the
 * result is still surfaced so a call site can offer "Resend invite email"
 * on a failure rather than claim success it can't back up.
 */
export async function sendClubInviteEmail(params: {
  to: string;
  clubName: string;
  inviteeDisplayName?: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.functions.invoke('send-club-invite', {
      body: params,
    });
    if (error) {
      console.error('sendClubInviteEmail failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('sendClubInviteEmail failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 5: Test the client wrapper**

Add to `lib/clubs.test.ts`, matching this file's existing `supabase.functions`-mocking convention if one already exists elsewhere in the test suite (search for `functions.invoke` mocks first — if none exist yet in this codebase, mock `supabase.functions = { invoke: vi.fn() }` the same way `supabase.auth`/`supabase.rpc` are already mocked at the top of this file):
```ts
describe('sendClubInviteEmail', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error('network down'));
    await expect(
      sendClubInviteEmail({ to: 'a@example.com', clubName: 'Tiles Club' }),
    ).resolves.toEqual({ error: 'Could not reach MahjHero. Check your connection and try again.' });
  });

  it('passes the payload through to the edge function unchanged', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { ok: true }, error: null });
    await sendClubInviteEmail({
      to: 'a@example.com',
      clubName: 'Tiles Club',
      inviteeDisplayName: 'Ann',
    });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('send-club-invite', {
      body: { to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' },
    });
  });
});
```

- [ ] **Step 6: Run everything and typecheck**

Run: `npx vitest run supabase/functions/send-club-invite lib/clubs.test.ts && npx tsc --noEmit`
Expected: new tests pass. Remaining `tsc` errors should be the same pre-existing set from Task 7 (call sites not yet updated) — no new ones introduced by this task.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-club-invite supabase/config.toml lib/clubs.ts lib/clubs.test.ts
git commit -m "$(cat <<'EOF'
feat(functions): add send-club-invite edge function

Sends a branded "you're invited" email over the same SMTP relay
deliver-notifications uses, reusing its hardened sending code from
supabase/functions/_shared/ rather than its outbox pipeline. Takes
the recipient, club name, and invitee name directly from the
authenticated client -- no database lookup, no service-role key.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `app/clubs/[id]/index.tsx` — replace the invite-link UI

**Files:**
- Modify: `app/clubs/[id]/index.tsx`
- Modify: this file's test file (find it — likely `app/__tests__/club-detail.test.tsx` or similar; confirm by finding whatever currently tests `onInvite`/`onCopyInvite`)

**Interfaces:**
- Consumes: `createInvite`, `acceptClubInvite` (not used here, but `ClubInvite`'s new shape is), `sendClubInviteEmail`, `declineClubInvite` (not used here) from Tasks 7 and 9.

- [ ] **Step 1: Replace state**

Remove (currently lines 52, 57-58, 61):
```ts
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  ...
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  ...
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);
```
Replace with:
```ts
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviting, setInviting] = useState(false);
  // Which pending invite's email was just resent -- shown as inline
  // "Sent" feedback on that one row for a couple seconds, matching the
  // "Copied" feedback the old copy-link row used to show.
  const [resentInviteId, setResentInviteId] = useState<string | null>(null);
  const resentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);
```
(`deletingInviteId` is unchanged — `onDeleteInvite`/revoke stays exactly as it is.)

- [ ] **Step 2: Replace `onInvite` and `onCopyInvite`**

Remove `onInvite` and `onCopyInvite` in full (lines 145-188). Replace with:
```ts
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function onInvite() {
    if (!id) return;
    if (!EMAIL_PATTERN.test(inviteEmail.trim())) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setInviting(true);
    const { id: inviteId, error: inviteError } = await createInvite(
      id,
      inviteEmail.trim(),
      inviteDisplayName.trim(),
    );
    if (inviteError || !inviteId) {
      setInviting(false);
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    const { error: sendError } = await sendClubInviteEmail({
      to: inviteEmail.trim(),
      clubName: club?.name ?? 'your club',
      inviteeDisplayName: inviteDisplayName.trim() || undefined,
    });
    setInviting(false);
    if (sendError) {
      // The invite exists even though the email didn't go out -- "Resend
      // invite email" on the new row (below) is the recovery path, not a
      // retry loop here.
      setError('Invite created, but the email could not be sent. You can resend it below.');
    }
    setInvites((prev) => [
      ...prev,
      {
        id: inviteId,
        email: inviteEmail.trim(),
        display_name: inviteDisplayName.trim() || null,
        skill_level: null,
        declined_at: null,
      },
    ]);
    setInviteEmail('');
    setInviteDisplayName('');
  }

  async function onResendInvite(invite: ClubInvite) {
    setError(null);
    const { error: sendError } = await sendClubInviteEmail({
      to: invite.email,
      clubName: club?.name ?? 'your club',
      inviteeDisplayName: invite.display_name ?? undefined,
    });
    if (sendError) {
      setError(sendError);
      return;
    }
    if (resentTimeoutRef.current) clearTimeout(resentTimeoutRef.current);
    setResentInviteId(invite.id);
    resentTimeoutRef.current = setTimeout(() => setResentInviteId(null), 2000);
  }
```
(The bare `Platform`/`window.location`/`navigator.clipboard` web-only guards are gone entirely — sending an email has no such restriction, so this form now works identically on native. Remove the now-unused `Platform` import from this file if nothing else in it still uses `Platform.OS` — check with `grep -n "Platform\." "app/clubs/[id]/index.tsx"` before removing the import.)

- [ ] **Step 3: Replace the render section**

Replace the "Create an invite link" button and the `inviteUrl` card (lines 431-456) with:
```tsx
      {mayInvite ? (
        <>
          <TextField
            label="Invite by email"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="them@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Email address to invite"
          />
          <TextField
            label="Name (optional)"
            value={inviteDisplayName}
            onChangeText={setInviteDisplayName}
            placeholder="Their name"
            accessibilityLabel="Name of the person you're inviting"
          />
          <Button
            variant="secondary"
            onPress={onInvite}
            disabled={inviting}
            loading={inviting}
            accessibilityLabel="Send invite"
          >
            Send invite
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/import`)}
            accessibilityLabel="Import a roster from a spreadsheet"
          >
            Import a roster
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/venues`)}
```
(The last line above is the existing "Venues" button that already followed the old invite-link card — leave everything from there onward in this block untouched; only the block being replaced is the "Create an invite link" button through the `inviteUrl` card.)

- [ ] **Step 4: Update the invite-row rendering**

Replace the invite-row block (lines 367-429) — `inviteLabel`'s fallback to `'Invite link'` is gone (email is required now), the Copy icon becomes a Resend action, and a row now shows a "Declined" tag when applicable:
```tsx
      {invites.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>
            {invites.length} invited
          </Text>
          {invites.map((invite) => {
            const inviteLabel =
              invite.display_name && invite.display_name.trim().length > 0
                ? invite.display_name
                : invite.email;
            const busy = deletingInviteId === invite.id;
            return (
              <Card key={invite.id}>
                <View style={styles.row}>
                  <Text style={styles.memberName}>{inviteLabel}</Text>
                  <Tag>{invite.declined_at ? 'Declined' : 'Invited'}</Tag>
                </View>
                <View style={styles.inviteMetaRow}>
                  <Text style={styles.inviteMetaText} numberOfLines={1}>
                    {resentInviteId === invite.id ? 'Sent' : invite.email}
                  </Text>
                  <View style={styles.inviteActions}>
                    {!invite.declined_at ? (
                      <Pressable
                        onPress={() => onResendInvite(invite)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Resend the invite email to ${inviteLabel}`}
                        hitSlop={8}
                      >
                        <SendIcon size={18} color={colors.accentColor} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => onDeleteInvite(invite)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete the invite for ${inviteLabel}`}
                      hitSlop={8}
                    >
                      <TrashIcon size={18} color={busy ? colors.textMuted : colors.text} />
                    </Pressable>
                  </View>
                </View>
              </Card>
            );
          })}
        </>
      ) : null}
```
Update the import line (currently `import { CopyIcon, TrashIcon } from '../../../components/icons';`) to `import { SendIcon, TrashIcon } from '../../../components/icons';` — confirm `SendIcon` exists in `components/icons.tsx` first (`grep -n "SendIcon" components/icons.tsx`); it does, per this repo's existing icon set, but verify before assuming.

- [ ] **Step 5: Update this screen's existing tests**

Find and update the test file that currently exercises `onInvite`/`onCopyInvite`/the "Create an invite link" button. Replace those cases with: filling the email field and pressing "Send invite" calls `createInvite` with the right arguments and then `sendClubInviteEmail`; a failed `createInvite` shows its error and does not call `sendClubInviteEmail`; a successful `createInvite` with a failed `sendClubInviteEmail` shows the "Invite created, but..." message and still adds the row; pressing the resend action on an existing row calls `sendClubInviteEmail` again; a declined invite's row shows "Declined" and has no resend action.

- [ ] **Step 6: Run and typecheck**

Run: `npx vitest run "app/**/*club*" && npx tsc --noEmit`
Expected: this screen's tests pass. `tsc` errors remaining should now exclude this file — confirm it's no longer in the error list.

- [ ] **Step 7: Commit**

```bash
git add "app/clubs/[id]/index.tsx" # plus the test file you updated
git commit -m "$(cat <<'EOF'
feat(clubs): replace the invite-link UI with an email-targeted form

"Create an invite link" becomes an email (+ optional name) form that
creates the invite and sends the email in one action. The per-row
copy-link action becomes "Resend invite email"; a declined invite
shows its status instead of disappearing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `app/clubs/[id]/events/[eventId]/index.tsx` — the event-scoped guest invite

**Files:**
- Modify: `app/clubs/[id]/events/[eventId]/index.tsx`
- Modify: this file's test file

**Interfaces:**
- Consumes: `createInvite`, `sendClubInviteEmail` from Tasks 7 and 9.

**Note on the resulting UX change, worth being aware of while implementing:** today, a guest invited to a specific game lands directly on that game's own screen, already seated (the old link went straight to `/join/<token>`, which redirected into the event). Under the new model, there is no more link — the guest gets an email, signs in normally, and sees the invite as a banner on their **dashboard** (Task 13), which seats them at the tied event on accept (the RPC's existing best-effort seating logic, unchanged) but the landing screen changes from "the event directly" to "the dashboard, with a banner." This is a deliberate, accepted consequence of Decision 1 in the design (every invite is email-targeted now, with no exception carved out for this one flow) — not something to design around here.

- [ ] **Step 1: Replace `onInviteGuest`**

Replace (lines 838-850):
```ts
  async function onInviteGuest() {
    setError(null);
    if (Platform.OS !== 'web') {
      setError('Invite links can only be created from the web app for now.');
      return;
    }
    const { token, error: inviteError } = await createInvite(clubId, undefined, eventId);
    if (inviteError || !token) {
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    setGuestInviteUrl(`${window.location.origin}/join/${token}`);
  }
```
with a form-driven version matching Task 10's shape:
```ts
  async function onInviteGuest() {
    if (!EMAIL_PATTERN.test(guestEmail.trim())) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setInvitingGuest(true);
    const { id: inviteId, error: inviteError } = await createInvite(
      clubId,
      guestEmail.trim(),
      undefined,
      eventId,
    );
    if (inviteError || !inviteId) {
      setInvitingGuest(false);
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    const { error: sendError } = await sendClubInviteEmail({
      to: guestEmail.trim(),
      clubName: club?.name ?? 'your club',
    });
    setInvitingGuest(false);
    setGuestInviteSent(!sendError);
    if (sendError) {
      setError('Invite created, but the email could not be sent.');
    }
    setGuestEmail('');
  }
```
Add the two new pieces of state this needs (near the existing `guestInviteUrl` declaration, line 214) and remove `guestInviteUrl`:
```ts
  const [guestEmail, setGuestEmail] = useState('');
  const [invitingGuest, setInvitingGuest] = useState(false);
  const [guestInviteSent, setGuestInviteSent] = useState(false);
```
Add the same `EMAIL_PATTERN` constant this file needs (or import it from a shared location if one already exists in this codebase for email validation — check `lib/auth.ts`'s `isValidEmail`/`EMAIL_PATTERN` first and reuse that instead of redefining it, since this exact pattern already exists there).

- [ ] **Step 2: Replace the render section**

Replace (lines 1300-1319 area — the "Invite a guest" button and the `guestInviteUrl` card):
```tsx
      {isOrganizer ? (
        <>
          <TextField
            label="Invite a guest by email"
            value={guestEmail}
            onChangeText={setGuestEmail}
            placeholder="guest@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Guest's email address"
          />
          <Button
            variant="secondary"
            disabled={busy || invitingGuest}
            loading={invitingGuest}
            onPress={onInviteGuest}
            accessibilityLabel="Invite a guest"
          >
            Invite a guest
          </Button>
          {guestInviteSent ? (
            <Text style={styles.help}>
              Invited. They'll see it on their dashboard once they sign in, and it'll seat them at this game.
            </Text>
          ) : null}
        </>
      ) : null}
```

- [ ] **Step 3: Update this screen's existing tests**

Find and update the test(s) covering `onInviteGuest`/the "Invite a guest" button and `guestInviteUrl` rendering to match the new email-form flow, mirroring Task 10's test updates.

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run "app/**/*event*" && npx tsc --noEmit`
Expected: passes; this file no longer appears in `tsc`'s remaining error list.

- [ ] **Step 5: Commit**

```bash
git add "app/clubs/[id]/events/[eventId]/index.tsx" # plus its test file
git commit -m "$(cat <<'EOF'
feat(events): replace the guest-invite link with an email form

Mirrors the club-level invite form. A guest invited to a specific
game now gets an email and sees the invite on their dashboard once
signed in (which still seats them at the tied game on accept),
rather than landing on the game directly via a clicked link.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `importRoster` sends an email per row

**Files:**
- Modify: `lib/clubs.ts`
- Modify: `app/clubs/[id]/import.tsx`
- Modify: `lib/clubs.test.ts`

**Interfaces:**
- Consumes: `sendClubInviteEmail` from Task 9.
- Produces: `importRoster` return shape changes from `{ created: number; error: string | null }` to `{ invites: { id: string; email: string; display_name: string }[]; error: string | null }`.

- [ ] **Step 1: Update `importRoster`**

Replace the current function's insert/return (lines 601-629):
```ts
  try {
    const invites = rows.map((row) => ({
      club_id: clubId,
      email: row.email,
      display_name: row.display_name,
      skill_level: row.skill_level,
    }));

    const { data, error } = await supabase
      .from('club_invites')
      .insert(invites)
      .select('id');

    if (error) {
      console.error('importRoster failed', error);
      return { created: 0, error: GENERIC_ERROR };
    }
    if (!data || data.length === 0) {
      console.error('importRoster failed', 'insert returned no rows');
      return { created: 0, error: GENERIC_ERROR };
    }
    return { created: data.length, error: null };
  } catch (cause) {
    console.error('importRoster failed', cause);
    return { created: 0, error: GENERIC_ERROR };
  }
```
with a version that goes through `create_club_invite` per row (direct table INSERT is revoked as of Task 2, so the bulk path must move to the RPC too — one RPC call per row, not a single bulk insert, since `create_club_invite` is designed around one invite at a time):
```ts
  const created: { id: string; email: string; display_name: string }[] = [];
  for (const row of rows) {
    const { data, error } = await supabase.rpc('create_club_invite', {
      target_club_id: clubId,
      target_email: row.email,
      target_display_name: row.display_name,
      target_event_id: null,
    });
    if (error) {
      // All-or-nothing was the old contract when this was one INSERT
      // statement; per-row RPC calls can't offer that same atomicity
      // (a connection drop mid-loop leaves a partial result), so this
      // reports what actually landed rather than claiming a false
      // rollback. `rows` has already passed through parseRoster, so
      // "already a member" is the only per-row failure expected here.
      console.error('importRoster: one row failed', row.email, error);
      continue;
    }
    created.push({ id: data as string, email: row.email, display_name: row.display_name });
  }

  if (created.length === 0) {
    return { invites: [], error: GENERIC_ERROR };
  }
  return { invites: created, error: null };
```
Update the function's return type declaration accordingly, and update its docstring (currently lines 569-583, which explains the old "all-or-nothing" reasoning) to reflect that this is no longer atomic, for exactly the reason in the new code comment above.

- [ ] **Step 2: Send an email per created row in `import.tsx`**

Find the call site (currently `const { created, error: importError } = await importRoster(id, rows);` followed by `router.replace(`/clubs/${id}?imported=${created}`);`). Replace with:
```ts
    const { invites, error: importError } = await importRoster(id, rows);
    if (importError) {
      setError(importError);
      return;
    }
    await Promise.all(
      invites.map((invite) =>
        sendClubInviteEmail({
          to: invite.email,
          clubName: club.name, // use whatever variable already holds the club's name in this screen -- read the file first to confirm its exact name
          inviteeDisplayName: invite.display_name || undefined,
        }),
      ),
    );
    router.replace(`/clubs/${id}?imported=${invites.length}`);
```
Read the file first to find the exact existing variable holding the club's name at this point in the component (it fetches the club to show its name somewhere on this screen already) and substitute that instead of guessing `club.name`.

- [ ] **Step 3: Update `importRoster`'s tests**

Update the existing `importRoster` describe block in `lib/clubs.test.ts` for the new return shape and the per-row RPC call pattern (mock `supabase.rpc` resolving successfully for each row; add a case where one row's RPC call fails and confirm the others still succeed, matching the new non-atomic contract).

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run lib/clubs.test.ts "app/**/*import*" && npx tsc --noEmit`
Expected: passes; `import.tsx` no longer appears in `tsc`'s remaining error list.

- [ ] **Step 5: Commit**

```bash
git add lib/clubs.ts lib/clubs.test.ts "app/clubs/[id]/import.tsx"
git commit -m "$(cat <<'EOF'
feat(clubs): send an invite email per row on roster import

importRoster moves from one bulk INSERT to one create_club_invite
call per row (direct table INSERT was revoked in an earlier commit
on this branch), and the import screen now emails everyone it
successfully invited, instead of silently creating rows nobody is
told about.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Dashboard accept/reject banner

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: this file's test file

**Interfaces:**
- Consumes: `fetchMyPendingInvites`, `acceptClubInvite`, `declineClubInvite` from Task 7.

- [ ] **Step 1: Add state and fetch**

Add near the other dashboard state (around line 141):
```ts
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
```
Import `PendingInvite`, `fetchMyPendingInvites`, `acceptClubInvite`, `declineClubInvite` alongside this file's existing `lib/clubs` import (currently `import { canInvite, fetchMyClubs, fetchMyRoles } from '../../lib/clubs';`) — add them to that same import statement.

Add one more call inside the existing mount effect (after the `fetchGreetings()` call, before its closing `return () => { cancelled = true; };`):
```ts
    fetchMyPendingInvites().then((result) => {
      if (cancelled) return;
      setPendingInvites(result ?? []);
    });
```

- [ ] **Step 2: Add accept/decline handlers**

Add near `handleLeaveWaitlist` (after line 301):
```ts
  function handleAcceptInvite(invite: PendingInvite) {
    void runInviteAction(invite, async () => {
      const { clubId, eventId, error } = await acceptClubInvite(invite.id);
      if (error) return { error };
      // Unlike declining a booking or an offer (same club context
      // throughout), accepting a club invite changes which club/event the
      // member has access to at all -- navigating there is simpler and
      // more correct than trying to reconcile local dashboard state for a
      // club that was not in `clubs` a moment ago.
      router.push(eventId ? `/clubs/${clubId}/events/${eventId}` : `/clubs/${clubId}`);
      return { error: null };
    });
  }

  function handleDeclineInvite(invite: PendingInvite) {
    void runInviteAction(invite, () => declineClubInvite(invite.id));
  }

  /**
   * Separate from `runBookingAction` above: that helper's failure path
   * calls `reloadAfterBooking()`, which has nothing to do with invites, and
   * its success path is a no-op requiring only a local state removal (or,
   * for accept, a navigation) rather than a dashboard-wide reload -- an
   * invite response never changes what today's events/bookings list looks
   * like.
   */
  async function runInviteAction(
    invite: PendingInvite,
    action: () => Promise<{ error: string | null }>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const { error } = await action();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }
```

- [ ] **Step 3: Render the banner**

Add, right after the existing `{actionError ? <ErrorBanner message={actionError} /> : null}` line (637) and before the `{alerts.map(...)}` block:
```tsx
      {pendingInvites.map((invite) => (
        <Card key={invite.id}>
          <Text style={styles.heading}>
            {invite.clubName} invited you to join
            {invite.eventTitle ? ` — ${invite.eventTitle}` : ''}
          </Text>
          <Button
            block
            disabled={busy}
            onPress={() => handleAcceptInvite(invite)}
            accessibilityLabel={`Join ${invite.clubName}`}
          >
            Join
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => handleDeclineInvite(invite)}
            accessibilityLabel={`Decline the invite to ${invite.clubName}`}
          >
            No thanks
          </Button>
        </Card>
      ))}
```
Check whether this file already has a `styles.heading` matching `WaitlistPanel`'s own (`fontFamily: type.bodySemiBold, fontSize: type.size.bodyLarge, color: colors.text`) — if `app/clubs/index.tsx`'s `StyleSheet.create` block doesn't already have one under that exact name, add it rather than colliding with an existing, differently-styled `heading` key.

- [ ] **Step 4: Update this screen's existing tests**

Find the test file covering the dashboard's booking/offer accept-decline flow (it should already mock `acceptPromotionOffer`/`declinePromotionOffer`, per Task import list — mirror that same mocking shape for `fetchMyPendingInvites`/`acceptClubInvite`/`declineClubInvite`). Add cases: a pending invite renders its card with the club name; a tied event's title appears too; pressing "Join" calls `acceptClubInvite` and, on success, navigates (assert against this file's existing router mock, the same way other navigation assertions in this test file already work); pressing "No thanks" calls `declineClubInvite` and removes the card on success; a failed accept/decline shows `actionError` and leaves the card in place.

- [ ] **Step 5: Run and typecheck**

Run: `npx vitest run app/__tests__ && npx tsc --noEmit`
Expected: passes; `app/clubs/index.tsx` no longer appears in `tsc`'s remaining error list.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx # plus its test file
git commit -m "$(cat <<'EOF'
feat(dashboard): show pending club invites as an accept/reject banner

No client-side storage or hand-off is needed -- fetch_my_pending_invites
looks the invite up by the signed-in member's own email on every
dashboard load. Accepting navigates into the new club/event (its
access wasn't there a moment ago, so there's nothing to reconcile
locally); declining just removes the card.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Delete the anonymous-link flow

**Files:**
- Delete: `app/join/[token].tsx`
- Delete: this file's test file, if one exists (`grep -rl "join/\[token\]\|JoinScreen" app/__tests__`)
- Modify: `app/index.tsx`
- Modify: `app/__tests__/index.test.ts`

**Interfaces:**
- Consumes: nothing new. Removes the last consumers of `PENDING_INVITE_KEY`, which Task 7 already stopped exporting.

- [ ] **Step 1: Delete the join screen and its test**

```bash
git rm "app/join/[token].tsx"
git rm --ignore-unmatch app/__tests__/join-token.test.tsx  # or whatever the actual filename turns out to be -- confirm with the grep above first
```

- [ ] **Step 2: Remove the pending-invite branch from `app/index.tsx`**

Read the current file in full first — this plan's earlier research (from the OTP work) confirms its shape as of that point, but re-read it now since Task 7 already changed how the rest of the app imports from `lib/clubs`. Remove the `AsyncStorage`/`PENDING_INVITE_KEY` read effect and simplify `resolveIndexRedirect` (currently exported as a pure function specifically so its branching is unit-testable) to no longer take a `pendingInvite` parameter:

```ts
export function resolveIndexRedirect(
  loading: boolean,
  hasSession: boolean,
): string | null {
  if (loading) return null;
  if (hasSession) return '/clubs';
  return '/welcome';
}
```

Remove the `pendingInvite` state, the `AsyncStorage.getItem(PENDING_INVITE_KEY)` effect, and the `PENDING_INVITE_KEY`/`AsyncStorage` imports from this file. Update the call site to `resolveIndexRedirect(loading, !!session)`.

- [ ] **Step 3: Update `app/__tests__/index.test.ts`**

Remove every test case that exercises the pending-invite branch (a signed-in member with a parked invite redirecting to `/join/<token>` instead of `/clubs`, and the "storage read hasn't resolved yet" race case this function's own docstring describes at length) — those code paths no longer exist. Keep the remaining signed-out/signed-in/loading cases, updated to call the new two-argument `resolveIndexRedirect` signature.

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: **the full suite passes and `tsc` is completely clean** — this is the task where every remaining error from Task 7 onward should finally resolve, since this was the last file still importing `PENDING_INVITE_KEY`.

- [ ] **Step 5: Commit**

```bash
git add -A app/index.tsx app/__tests__/index.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): remove the anonymous invite-link flow

app/join/[token].tsx and the PENDING_INVITE_KEY parking mechanism it
existed for are both gone -- there is no more link to park a token
for. app/index.tsx's redirect logic simplifies to two states instead
of three.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Whole-branch verification pass

**Files:** none — this task runs and manually verifies, it does not change code (beyond fixing anything the checks below turn up).

- [ ] **Step 1: Full automated suite**

Run: `npx supabase db reset --local && npx supabase test db --local && npx vitest run && npx tsc --noEmit`
Expected: all green. If anything fails, fix it before proceeding — do not treat this as a soft gate.

- [ ] **Step 2: Portable pgTAP against the linked project (read-only confirmation only, not a migration push)**

Run: `npm run test:db:remote` (per this repo's existing script for the portable suite against a real Supabase project) — only if a linked project is available in this environment; skip with a note in your report if not.

- [ ] **Step 3: By-hand pass in a real browser**

This feature cannot be fully verified by jsdom (email delivery, and a real multi-account accept/reject flow). Using the local dev server (or mahjhero-dev, if already migrated there) and at least two real test email addresses:
1. As an organizer, invite a brand-new email address to a club. Confirm the invite email actually arrives (check the local Mailpit/Inbucket catcher if running fully local, or a real inbox against mahjhero-dev) and its content matches the branded template.
2. Sign in as that invited address for the first time. Confirm the pending-invite banner appears on the dashboard with the right club name, with no manual step required to surface it.
3. Accept it. Confirm you land in the club (or the tied event, if you invited to one specifically) and the organizer's invite list now shows no pending row for that person (they're a real member now).
4. Invite a second address, sign in as it, and press "No thanks". Confirm the banner disappears and the organizer's invite list shows "Declined" for that row.
5. As the organizer, try inviting an email that's already an active member of the club. Confirm the friendly "already in this club" error, not a generic failure.
6. Confirm `/join/<anything>` (a URL from before this branch) now 404s rather than crashing — there is no more route registered for it.

Record the actual outcome of each numbered check in your report — do not mark this task complete on the basis of the automated suite alone.

- [ ] **Step 4: Report**

Summarize: final test counts (pgTAP assertions, Vitest tests) before and after this branch, confirmation `tsc --noEmit` is clean, and the by-hand results from Step 3. Flag anything that didn't work as expected rather than silently working around it.

## Self-Review

**Spec coverage:**
- Decision 1 (fully replace the link) → Task 14 deletes it outright. ✅
- Decision 2 (drop `token`) → Task 1. ✅
- Decision 3 (dedicated edge function, not the outbox pipeline) → Tasks 8-9 build `send-club-invite` standalone, reusing only the low-level SMTP/template code, never touching `notification_outbox`/`batch.ts`. ✅
- Decision 4 (plain navigation link, not an auth link) → Task 9's email body links to `/sign-in` with no token/query params. ✅
- Decision 5 (dashboard banner, no client storage) → Task 13; Task 14 removes the old storage mechanism entirely. ✅
- Decision 6 (roster import also emails) → Task 12. ✅
- Architecture's `fetch_my_pending_invites`/`accept_club_invite`/`decline_club_invite` exact shapes → Task 3, consumed exactly as designed by Task 7. ✅
- "Organizer-facing invite list gains a status" → Task 10's Declined tag, backed by Task 3's `declined_at`. ✅
- Error handling & edge cases (re-invite existing member, multiple pending invites, wrong-account non-issue, resend-on-failure) → Tasks 2, 4, 10. ✅
- Testing section (pgTAP for all three RPC behaviors, frontend component tests) → Tasks 4, 5, 10, 11, 13. ✅
- Out of scope (OTP flow untouched, no `send-club-invite` auto-retry, `notification_outbox` untouched) → confirmed nowhere in this plan touches `lib/auth.ts`, `app/sign-in.tsx`, or `deliver-notifications`'s outbox/batch/index.ts logic (only its presentational code moves, behavior-preserving, in Task 8). ✅

**Placeholder scan:** no TBD/TODO markers. A few steps (Task 2 Step 2, Task 3 Step 2, Task 6's line numbers, Task 12 Step 2's club-name variable) explicitly instruct the implementer to confirm a fact against the live codebase rather than assuming this plan's guess is exactly right — this is deliberate, not vagueness: the underlying values (helper function behavior, column names, current line numbers) are things this plan's author could not verify with full certainty from static research alone, and a wrong guess here should be caught before it's built on, not silently assumed.

**Type consistency:** `createInvite(clubId, email, displayName?, eventId?) → { id, error }` is the same shape in Task 7's implementation, Task 7's tests, and Tasks 10-12's call sites. `PendingInvite { id, clubId, clubName, eventId, eventTitle }` is the same shape in Task 7's definition and Task 13's consumption. `sendClubInviteEmail({ to, clubName, inviteeDisplayName? }) → { error }` is the same shape in Task 9's definition and Tasks 10-12's call sites.
