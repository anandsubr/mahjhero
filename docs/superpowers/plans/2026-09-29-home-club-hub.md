# Home Redesign (Club-Hub Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard and global tab bar with the Design V3 Home (My games list/calendar ⇄ Clubs), including join-a-club-by-code.

**Architecture:** Two migrations add club codes (+ join/set RPCs, rate limit) and two read RPCs (`my_games`, `my_clubs_next_game`). Pure date/label logic lives in `lib/home.ts`; data access in `lib/my-games.ts` and `lib/clubs.ts`; the "Needs you" actions move out of the old dashboard into a hook. `app/home.tsx` composes small components under `components/home/`. The old `app/clubs/index.tsx` and `components/TabBar.tsx` are deleted.

**Tech Stack:** Expo Router 57 / React Native 0.86 / react-native-web, Supabase (Postgres + pgTAP), vitest + @testing-library/react (jsdom), Playwright visual tests.

**Spec:** `docs/superpowers/specs/2026-09-29-home-club-hub-design.md`. Design reference: `docs/design/club-hub-v3/` (Home = frame **2a** in `Club Hub Paradigm.dc.html`; screenshot `docs/superpowers/specs/assets/2026-09-29-club-hub-screens.png`).

## Global Constraints

- Import `Text`/`TextInput` from `components/Text`, never from `react-native` (enforced by `app/__tests__/fixed-font-size-imports.test.ts`).
- Colours only from `lib/theme.ts` (`colors.bg`, `colors.surface`, `colors.text`, `colors.divider`, `colors.accentColor`, `colors.accent[200|600|700|800]`, `colors.accent2[200|500|700|800]`, `colors.neutral[300|400|600|700|800|900]`). Fonts: `type.heading` (Caprasimo) for wordmark/day numbers/month label/Caprasimo initials; `type.bodyRegular|bodySemiBold|bodyBold` (Figtree) elsewhere.
- Hit targets ≥ 44pt. Icons are hand-written Lucide-style SVGs in `components/icons.tsx`, stroke width 2.75 for new ones.
- Migrations are forward-only: never edit an existing migration file. Every new function: `revoke execute ... from public, anon` (and `authenticated` for internal ones); `grant execute ... to authenticated` for client RPCs; add client RPCs to both allowlists in `supabase/tests/database/portable/grants.test.sql`.
- Club code format: `^[A-Z0-9]{4,16}$`, stored uppercase; input normalized by uppercasing and removing all whitespace.
- Copy (exact): "My games", "Clubs", "List", "Calendar", "This week", "Next week", "Later", "Join a club", "Join", "Start a club", "Private game", "Open play", "You're going", "You're hosting", "Open seating", "No club with that code.", "Too many tries. Try again in an hour.", "That code is taken.", "Codes are 4–16 letters or numbers.", "You left or were removed from this club. Ask a host to invite you back.", "Could not load your games.", "No games yet. Join one from a club.", "Nothing on {Weekday D Mon}.", "{N} upcoming across {M} club(s)".
- Month abbreviations are fixed, not from `Intl`: `Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec` (date column uses the first three letters uppercased: `SEP`, `OCT`).
- Git: stage by explicit path only. Never stage `CLAUDE.md`, `docs/product-brief.md` or `social media assets/`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npm test` (vitest, TZ=America/New_York), `npm run test:db` (pgTAP, needs `npx supabase start`), `npx tsc --noEmit`.

## Deviations from the spec (decided while planning, spec updated in Task 1)

1. **"Hosting" = the game's creator** (`events.created_by = me`), not "any organizer of the club" — otherwise every game in a hosted club would land in the host's My games, which the design (host of Test Club with only one "You're hosting" row) contradicts.
2. **Removed members cannot rejoin by code.** Reactivation would let a member a host removed walk straight back in. They get "You left or were removed from this club. Ask a host to invite you back." (Invite acceptance still reactivates, as today.)
3. **No as-you-type availability check.** A public "is this code taken?" RPC is an oracle that bypasses the join rate limit. Uniqueness is checked on save (`set_club_code`, `create_club`), and `set_club_code` shares the 10/hour attempt budget. On Start a club the code field is optional: blank = generated.

## File Structure

**Create**
- `supabase/migrations/20260929100000_club_codes.sql` — `clubs.code`, generator, trigger, backfill, attempts table, `create_club(text,text,text)`, `join_club_by_code`, `set_club_code`.
- `supabase/migrations/20260929100100_home_feeds.sql` — `my_games`, `my_clubs_next_game`.
- `supabase/tests/database/fixtures/club_codes.test.sql`, `supabase/tests/database/fixtures/home_feeds.test.sql`.
- `lib/home.ts` (+ `lib/home.test.ts`) — pure helpers.
- `lib/my-games.ts` (+ `lib/my-games.test.ts`) — `fetchMyGames`, `fetchClubsNextGame`, `toGameRowData`.
- `lib/use-needs-you.ts` — invites/offers/need-a-fourth state + actions (ported from the old dashboard).
- `components/GameRow.tsx` — shared row.
- `components/home/HomeHeader.tsx`, `HomeSwitch.tsx`, `MyGamesList.tsx`, `MyGamesCalendar.tsx`, `JoinClubCard.tsx`, `ClubCard.tsx`, `NeedsYouStack.tsx`, `ClubCodeField.tsx`.
- `components/__tests__/game-row.test.tsx`, `components/__tests__/home-parts.test.tsx`, `app/__tests__/home.test.tsx`.

**Modify**
- `lib/clubs.ts` — `code` on `Club`, `normalizeClubCode`, `joinClubByCode`, `setClubCode`, `createClub(name, rhythm, code)`.
- `components/icons.tsx` — `ListIcon`, `UsersIcon` alias not needed (use `PeopleIcon`).
- `app/index.tsx` — redirect to `/home`.
- `app/clubs/new.tsx` — optional code field.
- `app/clubs/[id]/index.tsx` — "Club code" line with edit for organizers.
- Every screen passing `tabBar=` to `Screen` — remove the prop; `components/Screen.tsx` — remove `tabBar`.
- Every `'/clubs'` dashboard link → `'/home'`.
- `lib/dashboard.ts` — delete dashboard-only helpers.
- `supabase/tests/database/portable/grants.test.sql`.
- `e2e/visual.spec.ts`, `e2e/session.ts`.

**Delete**
- `app/clubs/index.tsx`, `components/TabBar.tsx`, `components/ClubChips.tsx`, `app/__tests__/clubs.test.tsx`, `app/__tests__/your-games.test.tsx`, `app/__tests__/guides-dashboard.test.tsx`, `app/__tests__/tab-bar.test.tsx`, `app/__tests__/nav-glyph-parity.test.tsx` (and any test left importing a deleted module — see Task 10).

---

### Task 1: Club codes in the database

**Files:**
- Create: `supabase/migrations/20260929100000_club_codes.sql`
- Create: `supabase/tests/database/fixtures/club_codes.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`
- Modify: `docs/superpowers/specs/2026-09-29-home-club-hub-design.md` (record the three deviations above)

**Interfaces:**
- Produces (SQL, callable by `authenticated`):
  - `public.create_club(club_name text, club_rhythm text default '', club_code text default null) returns uuid` — raises SQLSTATE `23505` if the code is taken, `23514` if the format is invalid.
  - `public.join_club_by_code(club_code text) returns jsonb` — `{"club_id": uuid, "already_member": bool}`, or SQL null for no match. Raises message `rate_limited` (P0001) after 10 attempts/hour, message `removed_member` (P0001) for a removed member.
  - `public.set_club_code(target_club uuid, new_code text) returns text` — returns the stored code. Raises `42501` non-organizer, `invalid_code` (22023), `23505` taken, `rate_limited` (P0001).
- Internal: `public.suggest_club_code(text)`, `public.clubs_fill_code()` trigger fn, table `public.club_code_attempts`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/fixtures/club_codes.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(21);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'host@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'joiner@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'removed@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'spammer@example.com');

-- A fixture insert with no code gets one from the trigger (existing fixture
-- files all insert clubs this way, so this is what keeps them working).
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

select matches(
  (select code from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  '^RIVERSID[0-9]{3}$',
  'a club inserted without a code gets name letters + 3 digits'
);

select throws_ok(
  $$insert into public.clubs (name, slug, timezone, created_by, code) values
    ('Bad', 'bad', 'UTC', 'aaaaaaaa-0000-0000-0000-000000000001', 'AB')$$,
  '23514', null, 'a code shorter than 4 characters is refused'
);

insert into public.clubs (id, name, slug, timezone, created_by, code) values
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield', 'UTC',
   'aaaaaaaa-0000-0000-0000-000000000001', 'oak tiles');

select is(
  (select code from public.clubs where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  'OAKTILES',
  'an explicit code is uppercased and has its spaces removed'
);

select throws_ok(
  $$insert into public.clubs (name, slug, timezone, created_by, code) values
    ('Other', 'other', 'UTC', 'aaaaaaaa-0000-0000-0000-000000000001', 'OakTiles')$$,
  '23505', null, 'codes are unique regardless of the case they were typed in'
);

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'member', 'removed'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

-- create_club with and without a code
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.create_club('North Side', '', 'north side')$$,
  'create_club accepts a code'
);
select is(
  (select code from public.clubs where name = 'North Side'),
  'NORTHSIDE',
  'create_club stores the normalized code'
);
select lives_ok(
  $$select public.create_club('Friday Tiles', '')$$,
  'create_club without a code still works'
);
select matches(
  (select code from public.clubs where name = 'Friday Tiles'),
  '^FRIDAYTI[0-9]{3}$',
  'create_club without a code generates one'
);
select throws_ok(
  $$select public.create_club('Dupe', '', 'OAKTILES')$$,
  '23505', null, 'create_club refuses a taken code'
);

-- set_club_code
select is(
  public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', ' oak 2 '),
  'OAK2',
  'a host can change the code; it comes back normalized'
);
select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'NORTHSIDE')$$,
  '23505', null, 'set_club_code refuses a code another club has'
);
select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'no!')$$,
  '22023', 'invalid_code', 'set_club_code refuses a malformed code'
);

-- join_club_by_code
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'MINE')$$,
  '42501', null, 'a non-organizer cannot change the code'
);
select is(
  public.join_club_by_code('nope9999'),
  null,
  'an unknown code returns null'
);
select is(
  public.join_club_by_code(' oak2 ') ->> 'already_member',
  'false',
  'a valid code joins the club (case/space-insensitive)'
);
select is(
  (select role::text from public.club_members
    where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'active'),
  'member',
  'the joiner is an active member'
);
select is(
  public.join_club_by_code('OAK2') ->> 'already_member',
  'true',
  'joining again reports already_member'
);

set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';
select throws_ok(
  format('select public.join_club_by_code(%L)',
         (select code from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001')),
  'P0001', 'removed_member', 'a removed member cannot rejoin by code'
);

-- rate limit: 10 attempts per hour, the 11th is refused
set local request.jwt.claims = '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';
select public.join_club_by_code('GUESS' || n) from generate_series(1, 10) n;
select throws_ok(
  $$select public.join_club_by_code('GUESS11')$$,
  'P0001', 'rate_limited', 'the 11th attempt in an hour is refused'
);

reset role;
select is(
  (select count(*)::int from public.club_code_attempts
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  10,
  'refused attempts are not recorded'
);

set local role anon;
select throws_ok(
  $$select public.join_club_by_code('OAK2')$$,
  '42501', null, 'anon cannot call join_club_by_code'
);
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase start` (if not running), then `npm run test:db -- supabase/tests/database/fixtures/club_codes.test.sql` (if the CLI rejects a path argument, run `npm run test:db` and look for this file).
Expected: FAIL — `column "code" of relation "clubs" does not exist` / functions missing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260929100000_club_codes.sql`:

```sql
/*
 * Club codes (club-hub redesign, phase 1).
 *
 * A short, human-chosen code a member types on Home to join a club instantly.
 * Hosts and co-organizers may change it; changing it is how a leaked code is
 * retired. Uniqueness is the database's job (unique index); the format check
 * is a constraint so no write path can bypass it.
 *
 * Removed members cannot rejoin by code: removal is a host decision, and an
 * instant-join code must not undo it. Invite acceptance still reactivates.
 */

-- Generator. security definer so the uniqueness probe sees every club, not
-- just the caller's (RLS would otherwise hide collisions).
create function public.suggest_club_code(club_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  stem text := left(regexp_replace(upper(coalesce(club_name, '')), '[^A-Z0-9]', '', 'g'), 8);
  candidate text;
begin
  if length(stem) = 0 then
    stem := 'CLUB';
  end if;
  loop
    candidate := stem || lpad(floor(random() * 1000)::int::text, 3, '0');
    exit when not exists (select 1 from public.clubs where code = candidate);
  end loop;
  return candidate;
end;
$$;
revoke execute on function public.suggest_club_code(text) from public, anon, authenticated;

alter table public.clubs add column code text;

do $$
declare
  r record;
begin
  for r in select id, name from public.clubs where code is null loop
    update public.clubs set code = public.suggest_club_code(r.name) where id = r.id;
  end loop;
end;
$$;

alter table public.clubs
  alter column code set not null,
  add constraint clubs_code_format check (code ~ '^[A-Z0-9]{4,16}$');
create unique index clubs_code_key on public.clubs (code);

-- Fills a missing code on insert and normalizes any code written, so fixture
-- inserts, create_club and a host's direct update all land in one shape.
create function public.clubs_fill_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    if tg_op = 'INSERT' then
      new.code := public.suggest_club_code(new.name);
    end if;
  else
    new.code := upper(regexp_replace(new.code, '\s', '', 'g'));
  end if;
  return new;
end;
$$;
revoke execute on function public.clubs_fill_code() from public, anon, authenticated;

create trigger clubs_fill_code
  before insert or update of code on public.clubs
  for each row execute function public.clubs_fill_code();

-- Attempt log for the join rate limit. No policies: only the definer
-- functions below read or write it.
create table public.club_code_attempts (
  id           bigserial primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index club_code_attempts_recent on public.club_code_attempts (profile_id, attempted_at);
alter table public.club_code_attempts enable row level security;
revoke all on public.club_code_attempts from public, anon, authenticated;

-- Shared by join_club_by_code and set_club_code: raises rate_limited once the
-- caller has 10 attempts in the past hour, otherwise records this one.
create function public.record_club_code_attempt(caller uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.club_code_attempts
       where profile_id = caller and attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.club_code_attempts (profile_id) values (caller);
end;
$$;
revoke execute on function public.record_club_code_attempt(uuid) from public, anon, authenticated;

-- create_club gains an optional code. Signature change: drop and recreate,
-- then restate the grants (a new signature starts with EXECUTE to PUBLIC).
-- Body otherwise identical to 20260822040732_close_club_members_escalation.sql.
drop function public.create_club(text, text);

create function public.create_club(
  club_name text,
  club_rhythm text default '',
  club_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  new_id uuid;
  base_slug text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if length(trim(club_name)) = 0 then
    raise exception 'club name is required' using errcode = '22023';
  end if;

  base_slug := regexp_replace(lower(trim(club_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  if length(base_slug) = 0 then
    raise exception 'club name needs a letter or number'
      using errcode = '22023';
  end if;

  insert into public.clubs (name, slug, rhythm, created_by, code)
  values (
    trim(club_name),
    base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    trim(coalesce(club_rhythm, '')),
    caller,
    nullif(regexp_replace(coalesce(club_code, ''), '\s', '', 'g'), '')
  )
  returning id into new_id;

  insert into public.club_members (club_id, profile_id, role)
  values (new_id, caller, 'host');

  return new_id;
end;
$$;
revoke execute on function public.create_club(text, text, text) from public, anon;
grant execute on function public.create_club(text, text, text) to authenticated;

create function public.join_club_by_code(club_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(club_code, ''), '\s', '', 'g'));
  target     uuid;
  membership public.club_members%rowtype;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  perform public.record_club_code_attempt(caller);

  select id into target from public.clubs where code = normalized;
  if target is null then
    return null;
  end if;

  select * into membership from public.club_members
   where club_id = target and profile_id = caller;
  if found then
    if membership.status = 'removed' then
      raise exception 'removed_member';
    end if;
    return jsonb_build_object('club_id', target, 'already_member', true);
  end if;

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  insert into public.club_members (club_id, profile_id, role)
  values (target, caller, 'member');

  return jsonb_build_object('club_id', target, 'already_member', false);
end;
$$;
revoke execute on function public.join_club_by_code(text) from public, anon;
grant execute on function public.join_club_by_code(text) to authenticated;

create function public.set_club_code(target_club uuid, new_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(new_code, ''), '\s', '', 'g'));
begin
  if caller is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if normalized !~ '^[A-Z0-9]{4,16}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  perform public.record_club_code_attempt(caller);

  update public.clubs set code = normalized where id = target_club;
  return normalized;
end;
$$;
revoke execute on function public.set_club_code(uuid, text) from public, anon;
grant execute on function public.set_club_code(uuid, text) to authenticated;
```

Note on "refused attempts are not recorded": `raise` aborts the statement, so a rate-limited call inserts nothing. The attempt that finds no club *is* recorded (that is the point).

Note: `club_members.status` — confirm the column/enum name with `grep -n "status" supabase/migrations/20260822033527_create_clubs.sql`; the fixture insert in Step 1 uses `status = 'removed'` exactly as `accept_club_invite` does.

- [ ] **Step 4: Update the grants test**

In `supabase/tests/database/portable/grants.test.sql`:
- Replace every `'public.create_club(text, text)'` with `'public.create_club(text, text, text)'` (4 places: the anon check near line 180, the positive check near line 223, and both allowlist arrays near lines 794 and 895).
- In **both** allowlist arrays, add these two lines directly after the `create_club` line:

```sql
       'public.join_club_by_code(text)',
       'public.set_club_code(uuid, text)',
```

(`select plan(127)` does not change: no assertions were added.)

- [ ] **Step 5: Run the DB tests**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `club_codes.test.sql` passes 21/21; `grants.test.sql` passes; every other file still passes (their club inserts get codes from the trigger).

- [ ] **Step 6: Update the spec for the deviations**

In `docs/superpowers/specs/2026-09-29-home-club-hub-design.md`:
- Under "Club codes": replace the `join_club_by_code` "reactivates a removed one" clause with "a removed member is refused (`removed_member`); only an invite brings them back". Delete the `club_code_available` bullet and add: "`set_club_code` shares the 10/hour attempt budget; there is no availability RPC (it would be an oracle around the join rate limit)."
- Under "My games feed": change "or is an organizer" to "or created the game (`events.created_by`)", and "An organizer who is also booked" to "A creator who is also booked".
- Under Section 2 "Start a club": replace "gains an editable code field pre-filled with a suggestion" with "gains an optional code field (blank = generated)".
- Under Section 3 "Code editing": replace the availability-check sentence with "Uniqueness is checked on save; `23505` shows 'That code is taken.'".

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929100000_club_codes.sql supabase/tests/database/fixtures/club_codes.test.sql supabase/tests/database/portable/grants.test.sql docs/superpowers/specs/2026-09-29-home-club-hub-design.md
git commit -m "feat(db): club codes with join-by-code and host-editable code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Home feed RPCs

**Files:**
- Create: `supabase/migrations/20260929100100_home_feeds.sql`
- Create: `supabase/tests/database/fixtures/home_feeds.test.sql`
- Modify: `supabase/tests/database/portable/grants.test.sql`

**Interfaces:**
- Produces:
  - `public.my_games(from_ts timestamptz, to_ts timestamptz)` returning `(event_id uuid, club_id uuid, club_name text, title text, game_mode public.game_mode, seating_mode public.seating_mode, starts_at timestamptz, ends_at timestamptz, club_timezone text, venue_name text, seats_taken int, capacity int, capped boolean, my_status text, waitlist_position int, table_label text)`; `my_status ∈ {'going','waitlisted','hosting'}`.
  - `public.my_clubs_next_game()` returning `(club_id uuid, next_starts_at timestamptz)`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/fixtures/home_feeds.test.sql`:

```sql
begin;
set local search_path to extensions, public;

select plan(12);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'me@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Mine', 'mine', 'America/New_York',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Not mine', 'not-mine', 'UTC',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('11111111-0000-0000-0000-000000000002', 'Elsewhere',
   'c2c2c2c2-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002');

-- e1: I'm confirmed at Table 1. e2: I'm waitlisted. e3: I created it (and
-- I'm booked too). e4: I'm only invited. e5: nothing to do with me. e6: in a
-- club I'm not in. e7: cancelled, I was booked. e8: next club game, far out.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by, status, seating_mode, capacity)
values
  ('e1000000-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday',
   '11111111-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'assigned_tables', null),
  ('e2000000-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001', 'Full one',
   '11111111-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', 1),
  ('e3000000-0000-0000-0000-000000000003', 'c1c1c1c1-0000-0000-0000-000000000001', 'My night',
   '11111111-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001', 'published', 'open_seating', null),
  ('e4000000-0000-0000-0000-000000000004', 'c1c1c1c1-0000-0000-0000-000000000001', 'Invited',
   '11111111-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e5000000-0000-0000-0000-000000000005', 'c1c1c1c1-0000-0000-0000-000000000001', 'Not joined',
   '11111111-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e6000000-0000-0000-0000-000000000006', 'c2c2c2c2-0000-0000-0000-000000000002', 'Other club',
   '11111111-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e7000000-0000-0000-0000-000000000007', 'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled',
   '11111111-0000-0000-0000-000000000001', now() + interval '6 days', now() + interval '6 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'cancelled', 'open_seating', null),
  ('e8000000-0000-0000-0000-000000000008', 'c2c2c2c2-0000-0000-0000-000000000002', 'Far',
   '11111111-0000-0000-0000-000000000002', now() + interval '200 days', now() + interval '200 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null);

insert into public.event_tables (id, event_id, label, capacity, position) values
  ('7a000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Table 1', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted', now()),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null);

insert into public.bookings (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status) values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed'),
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted'),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed'),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'invited'),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select array_agg(title order by starts_at) from public.my_games(now(), now() + interval '120 days')),
  array['Thursday', 'Full one', 'My night'],
  'my_games lists confirmed, waitlisted and created games only (no invited, unjoined, other-club or cancelled)'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  'going', 'a confirmed booking is going'
);
select is(
  (select table_label from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  'Table 1', 'the table label comes through'
);
select is(
  (select seats_taken || '/' || capacity from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  '1/4', 'seats taken over capacity'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'Full one'),
  'waitlisted', 'a waitlisted booking is waitlisted'
);
select is(
  (select waitlist_position from public.my_games(now(), now() + interval '120 days') where title = 'Full one'),
  1, 'waitlist position is reported'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'My night'),
  'hosting', 'a game I created is hosting even though I am booked'
);
select is(
  (select capped from public.my_games(now(), now() + interval '120 days') where title = 'My night'),
  false, 'an open-seating game with no capacity is uncapped'
);
select is(
  (select count(*)::int from public.my_games(now() + interval '2 days', now() + interval '3 days')),
  1, 'the window is [from, to)'
);
select is(
  (select array_agg(club_id::text) from public.my_clubs_next_game()),
  array['c1c1c1c1-0000-0000-0000-000000000001'],
  'my_clubs_next_game covers only my clubs'
);
select ok(
  (select next_starts_at from public.my_clubs_next_game()) < now() + interval '1 day 1 minute',
  'next game is the soonest published one'
);

set local role anon;
select throws_ok($$select * from public.my_games(now(), now() + interval '1 day')$$,
  '42501', null, 'anon cannot call my_games');
reset role;

select * from finish();
rollback;
```

Before running, verify fixture columns against the schema — `grep -n "create table public.events" -A40 supabase/migrations/20260822194000_create_events.sql` and the `seating_mode`/`capacity` migration `20260906100000_seating_mode_and_capacity.sql`; `event_tables` columns are `id, event_id, label, skill_tier, capacity, position` (`EVENT_TABLE_COLUMNS` in `lib/events.ts:222`). Fill any other NOT NULL column without a default the insert misses (e.g. `timezone`-like columns) with a plain literal.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db`
Expected: `home_feeds.test.sql` FAILS with `function public.my_games(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260929100100_home_feeds.sql`:

```sql
/*
 * Home feeds (club-hub redesign, phase 1).
 *
 * my_games: every game in a window that the caller has a confirmed or
 * waitlisted seat at, or created. One round trip for Home's list and
 * calendar, replacing the dashboard's per-club fetch. Invited (unanswered)
 * seats are excluded — they are shown in Home's "Needs you" until accepted.
 *
 * seats_taken counts what the capacity gate counts as occupied: confirmed
 * seats plus seat-holding invites (see event_free_seats,
 * 20260924101000_capacity_counts_held_invites.sql).
 */
create function public.my_games(from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id          uuid,
  club_id           uuid,
  club_name         text,
  title             text,
  game_mode         public.game_mode,
  seating_mode      public.seating_mode,
  starts_at         timestamptz,
  ends_at           timestamptz,
  club_timezone     text,
  venue_name        text,
  seats_taken       int,
  capacity          int,
  capped            boolean,
  my_status         text,
  waitlist_position int,
  table_label       text
)
language sql
security definer
stable
set search_path = public
as $$
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.status in ('confirmed', 'waitlisted')
  )
  select
    e.id, e.club_id, c.name, e.title, e.game_mode, e.seating_mode,
    e.starts_at, e.ends_at, c.timezone, v.name,
    (public.event_confirmed_seats(e.id)
      + (select count(*)::int from public.bookings ib
          where ib.event_id = e.id and ib.status = 'invited' and ib.invite_holds_seat))::int,
    public.event_capacity(e.id),
    public.event_is_capped(e.id),
    case
      when e.created_by = auth.uid() then 'hosting'
      when m.status = 'confirmed' then 'going'
      else 'waitlisted'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (m.event_id is not null or e.created_by = auth.uid())
    and public.is_club_member(e.club_id)
  order by e.starts_at, c.name;
$$;
revoke execute on function public.my_games(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_games(timestamptz, timestamptz) to authenticated;

-- The soonest upcoming published game per club the caller belongs to.
create function public.my_clubs_next_game()
returns table (club_id uuid, next_starts_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select e.club_id, min(e.starts_at)
  from public.events e
  where e.status = 'published'
    and e.starts_at > now()
    and public.is_club_member(e.club_id)
  group by e.club_id;
$$;
revoke execute on function public.my_clubs_next_game() from public, anon;
grant execute on function public.my_clubs_next_game() to authenticated;
```

- [ ] **Step 4: Update the grants allowlists**

In `supabase/tests/database/portable/grants.test.sql`, in **both** allowlist arrays, add after `'public.my_upcoming_bookings()',`:

```sql
       'public.my_games(timestamptz, timestamptz)',
       'public.my_clubs_next_game()',
```

If the allowlist writes types in long form elsewhere (e.g. `timestamp with time zone`), match the form `to_regprocedure` accepts — both forms resolve; the Direction-2 query prints `p.oid::regprocedure::text`, which is `public.my_games(timestamp with time zone,timestamp with time zone)`, but it compares via `to_regprocedure`, so the short form is fine.

- [ ] **Step 5: Run the DB tests**

Run: `npx supabase db reset --local && npm run test:db`
Expected: `home_feeds.test.sql` 12/12, grants pass, all others pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929100100_home_feeds.sql supabase/tests/database/fixtures/home_feeds.test.sql supabase/tests/database/portable/grants.test.sql
git commit -m "feat(db): my_games and my_clubs_next_game feeds for Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Client data layer — club codes and feeds

**Files:**
- Modify: `lib/clubs.ts`
- Create: `lib/my-games.ts`
- Test: `lib/clubs.test.ts` (append), `lib/my-games.test.ts`

**Interfaces:**
- Consumes: RPCs from Tasks 1–2.
- Produces:
  - `Club` gains `code: string`; `CLUB_COLUMNS` gains `code`.
  - `normalizeClubCode(raw: string): string`
  - `isValidClubCode(code: string): boolean`
  - `joinClubByCode(code: string): Promise<{ clubId: string | null; alreadyMember: boolean; error: string | null }>`
  - `setClubCode(clubId: string, code: string): Promise<{ code: string | null; error: string | null }>`
  - `createClub(name: string, rhythm: string, code?: string): Promise<{ clubId: string | null; error: string | null }>`
  - `lib/my-games.ts`: `type MyStatus = 'going' | 'waitlisted' | 'hosting' | 'not'`; `type MyGame` (below); `fetchMyGames(from: Date, to: Date): Promise<MyGame[] | null>`; `fetchClubsNextGame(): Promise<Record<string, string> | null>` (club id → ISO start).

- [ ] **Step 1: Write failing tests**

Look at the top of `lib/clubs.test.ts` for how it mocks `./supabase` (it mocks `supabase.rpc`); reuse the same mock variable. Append:

```ts
describe('club codes', () => {
  it('normalizes by uppercasing and removing whitespace', () => {
    expect(normalizeClubCode(' oak  tiles\n')).toBe('OAKTILES');
  });

  it('validates 4-16 letters or digits', () => {
    expect(isValidClubCode('OAK2')).toBe(true);
    expect(isValidClubCode('ABC')).toBe(false);
    expect(isValidClubCode('A'.repeat(17))).toBe(false);
    expect(isValidClubCode('OAK-2')).toBe(false);
  });

  it('joinClubByCode maps a match', async () => {
    rpc.mockResolvedValueOnce({ data: { club_id: 'c1', already_member: false }, error: null });
    await expect(joinClubByCode(' oak2 ')).resolves.toEqual({
      clubId: 'c1', alreadyMember: false, error: null,
    });
    expect(rpc).toHaveBeenCalledWith('join_club_by_code', { club_code: 'OAK2' });
  });

  it('joinClubByCode maps no match', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(joinClubByCode('NOPE')).resolves.toEqual({
      clubId: null, alreadyMember: false, error: 'No club with that code.',
    });
  });

  it('joinClubByCode maps the rate limit and removed member', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'rate_limited' } });
    expect((await joinClubByCode('X1X1')).error).toBe('Too many tries. Try again in an hour.');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'removed_member' } });
    expect((await joinClubByCode('X1X1')).error).toBe(
      'You left or were removed from this club. Ask a host to invite you back.',
    );
  });

  it('setClubCode maps taken and invalid', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } });
    expect((await setClubCode('c1', 'OAK2')).error).toBe('That code is taken.');
    expect((await setClubCode('c1', 'no')).error).toBe('Codes are 4–16 letters or numbers.');
  });

  it('createClub passes a normalized code, or null when blank', async () => {
    rpc.mockResolvedValueOnce({ data: 'c9', error: null });
    await createClub('North', '', ' north side ');
    expect(rpc).toHaveBeenLastCalledWith('create_club', {
      club_name: 'North', club_rhythm: '', club_code: 'NORTHSIDE',
    });
    rpc.mockResolvedValueOnce({ data: 'c9', error: null });
    await createClub('North', '');
    expect(rpc).toHaveBeenLastCalledWith('create_club', {
      club_name: 'North', club_rhythm: '', club_code: null,
    });
  });

  it('createClub maps a taken code', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'dup' } });
    expect((await createClub('North', '', 'OAK2')).error).toBe('That code is taken.');
  });
});
```

(Add `normalizeClubCode, isValidClubCode, joinClubByCode, setClubCode` to the file's import from `./clubs`. If the existing mock variable is named differently than `rpc`, use that name.) If an existing `createClub` test asserts the old two-key argument object, update it to include `club_code: null`.

Create `lib/my-games.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchClubsNextGame, fetchMyGames } from './my-games';

const ROW = {
  event_id: 'e1', club_id: 'c1', club_name: 'Test Club', title: 'Open play night',
  game_mode: 'open_play', seating_mode: 'open_seating',
  starts_at: '2026-10-01T15:30:00Z', ends_at: '2026-10-01T18:30:00Z',
  club_timezone: 'America/New_York', venue_name: 'Sample Venue',
  seats_taken: 14, capacity: 24, capped: true,
  my_status: 'going', waitlist_position: null, table_label: null,
};

beforeEach(() => rpc.mockReset());

describe('fetchMyGames', () => {
  it('calls my_games with ISO bounds and maps rows', async () => {
    rpc.mockResolvedValueOnce({ data: [ROW], error: null });
    const from = new Date('2026-09-29T00:00:00Z');
    const to = new Date('2026-10-29T00:00:00Z');
    const games = await fetchMyGames(from, to);
    expect(rpc).toHaveBeenCalledWith('my_games', {
      from_ts: from.toISOString(), to_ts: to.toISOString(),
    });
    expect(games).toEqual([{
      eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Open play night',
      gameMode: 'open_play', seatingMode: 'open_seating',
      startsAt: '2026-10-01T15:30:00Z', timezone: 'America/New_York', venueName: 'Sample Venue',
      seatsTaken: 14, capacity: 24, myStatus: 'going', waitlistPosition: null, tableLabel: null,
    }]);
  });

  it('maps an uncapped game to capacity null', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, capped: false, capacity: 0 }], error: null });
    const [game] = (await fetchMyGames(new Date(), new Date()))!;
    expect(game.capacity).toBeNull();
  });

  it('returns null on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await fetchMyGames(new Date(), new Date())).toBeNull();
  });
});

describe('fetchClubsNextGame', () => {
  it('maps rows to a club-id record', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ club_id: 'c1', next_starts_at: '2026-10-01T15:30:00Z' }], error: null,
    });
    expect(await fetchClubsNextGame()).toEqual({ c1: '2026-10-01T15:30:00Z' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- lib/clubs.test.ts lib/my-games.test.ts`
Expected: FAIL — missing exports / missing module.

- [ ] **Step 3: Implement**

In `lib/clubs.ts`:
- `Club` type: add `code: string;`.
- `CLUB_COLUMNS = 'id, name, slug, rhythm, visibility, timezone, default_game_mode, code'`.
- Replace `createClub` and add the new functions:

```ts
const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
export const CODE_TAKEN = 'That code is taken.';
export const CODE_INVALID = 'Codes are 4–16 letters or numbers.';

/** Uppercase with all whitespace removed — the same normalization the database applies. */
export function normalizeClubCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidClubCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

type RpcError = { code?: string; message?: string } | null;

function codeError(error: RpcError): string {
  if (error?.code === '23505') return CODE_TAKEN;
  if (error?.code === '23514' || error?.message === 'invalid_code') return CODE_INVALID;
  if (error?.message === 'rate_limited') return 'Too many tries. Try again in an hour.';
  return GENERIC_ERROR;
}

export async function createClub(
  name: string,
  rhythm: string,
  code?: string,
): Promise<{ clubId: string | null; error: string | null }> {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { clubId: null, error: 'Give the club a name.' };
  }
  if (slugify(trimmed).length === 0) {
    return { clubId: null, error: 'That name needs at least one letter or number.' };
  }
  const normalized = normalizeClubCode(code ?? '');
  if (normalized.length > 0 && !isValidClubCode(normalized)) {
    return { clubId: null, error: CODE_INVALID };
  }

  try {
    const { data, error } = await supabase.rpc('create_club', {
      club_name: trimmed,
      club_rhythm: rhythm.trim(),
      club_code: normalized.length > 0 ? normalized : null,
    });

    if (error || !data) {
      console.error('createClub failed', error);
      return { clubId: null, error: codeError(error) };
    }
    return { clubId: data as string, error: null };
  } catch (cause) {
    console.error('createClub failed', cause);
    return { clubId: null, error: GENERIC_ERROR };
  }
}

export async function joinClubByCode(
  raw: string,
): Promise<{ clubId: string | null; alreadyMember: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('join_club_by_code', {
      club_code: normalizeClubCode(raw),
    });
    if (error) {
      if (error.message === 'removed_member') {
        return {
          clubId: null,
          alreadyMember: false,
          error: 'You left or were removed from this club. Ask a host to invite you back.',
        };
      }
      console.error('joinClubByCode failed', error);
      return { clubId: null, alreadyMember: false, error: codeError(error) };
    }
    if (!data) {
      return { clubId: null, alreadyMember: false, error: 'No club with that code.' };
    }
    const result = data as { club_id: string; already_member: boolean };
    return { clubId: result.club_id, alreadyMember: result.already_member, error: null };
  } catch (cause) {
    console.error('joinClubByCode failed', cause);
    return { clubId: null, alreadyMember: false, error: GENERIC_ERROR };
  }
}

export async function setClubCode(
  clubId: string,
  raw: string,
): Promise<{ code: string | null; error: string | null }> {
  const normalized = normalizeClubCode(raw);
  if (!isValidClubCode(normalized)) return { code: null, error: CODE_INVALID };
  try {
    const { data, error } = await supabase.rpc('set_club_code', {
      target_club: clubId,
      new_code: normalized,
    });
    if (error || !data) {
      console.error('setClubCode failed', error);
      return { code: null, error: codeError(error) };
    }
    return { code: data as string, error: null };
  } catch (cause) {
    console.error('setClubCode failed', cause);
    return { code: null, error: GENERIC_ERROR };
  }
}
```

Create `lib/my-games.ts`:

```ts
import type { GameMode } from './clubs';
import type { SeatingMode } from './events';
import { supabase } from './supabase';

/** 'not' is only produced by the club Games section (phase 2), never by my_games. */
export type MyStatus = 'going' | 'waitlisted' | 'hosting' | 'not';

/** One game row, shaped for components/GameRow. */
export type MyGame = {
  eventId: string;
  clubId: string;
  clubName: string;
  title: string | null;
  gameMode: GameMode;
  seatingMode: SeatingMode;
  startsAt: string;
  /** The club's timezone — every date and time on the row is shown in it. */
  timezone: string;
  venueName: string;
  seatsTaken: number;
  /** null = uncapped (open seating with no headcount). */
  capacity: number | null;
  myStatus: MyStatus;
  waitlistPosition: number | null;
  tableLabel: string | null;
};

type MyGameRow = {
  event_id: string;
  club_id: string;
  club_name: string;
  title: string | null;
  game_mode: GameMode;
  seating_mode: SeatingMode;
  starts_at: string;
  club_timezone: string;
  venue_name: string;
  seats_taken: number;
  capacity: number;
  capped: boolean;
  my_status: 'going' | 'waitlisted' | 'hosting';
  waitlist_position: number | null;
  table_label: string | null;
};

export async function fetchMyGames(from: Date, to: Date): Promise<MyGame[] | null> {
  try {
    const { data, error } = await supabase.rpc('my_games', {
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
    });
    if (error) {
      console.error('fetchMyGames failed', error);
      return null;
    }
    return ((data ?? []) as MyGameRow[]).map((r) => ({
      eventId: r.event_id,
      clubId: r.club_id,
      clubName: r.club_name,
      title: r.title,
      gameMode: r.game_mode,
      seatingMode: r.seating_mode,
      startsAt: r.starts_at,
      timezone: r.club_timezone,
      venueName: r.venue_name,
      seatsTaken: r.seats_taken,
      capacity: r.capped ? r.capacity : null,
      myStatus: r.my_status,
      waitlistPosition: r.waitlist_position,
      tableLabel: r.table_label,
    }));
  } catch (cause) {
    console.error('fetchMyGames failed', cause);
    return null;
  }
}

/** Club id → ISO start of that club's next published game. Clubs with none are absent. */
export async function fetchClubsNextGame(): Promise<Record<string, string> | null> {
  try {
    const { data, error } = await supabase.rpc('my_clubs_next_game');
    if (error) {
      console.error('fetchClubsNextGame failed', error);
      return null;
    }
    return Object.fromEntries(
      ((data ?? []) as { club_id: string; next_starts_at: string }[]).map((r) => [
        r.club_id,
        r.next_starts_at,
      ]),
    );
  } catch (cause) {
    console.error('fetchClubsNextGame failed', cause);
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- lib/clubs.test.ts lib/my-games.test.ts && npx tsc --noEmit`
Expected: PASS. `tsc` may flag test fixtures building a `Club` without `code` — add `code: 'TESTCODE'` to those fixtures.

- [ ] **Step 5: Commit**

```bash
git add lib/clubs.ts lib/clubs.test.ts lib/my-games.ts lib/my-games.test.ts
# plus any test fixture files you added `code:` to, by explicit path
git commit -m "feat(lib): club code client calls and my-games feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure Home helpers

**Files:**
- Create: `lib/home.ts`
- Test: `lib/home.test.ts`

**Interfaces:**
- Consumes: `glyphForClub` idea (hash) from `lib/dashboard.ts`; `formatEventTime` from `lib/events.ts`; `ClubRole`, `GameMode` from `lib/clubs.ts`.
- Produces:
  - `MONTHS: readonly string[]` (`'Jan'…'Sept'…'Dec'`)
  - `gameHeadline(title: string | null, gameMode: GameMode): string`
  - `homeDefault(upcomingCount: number): 'myGames' | 'clubs'`
  - `localDateKey(d: Date): string` — device-local `YYYY-MM-DD`
  - `gameDateKey(startsAt: string, timezone: string): string` — `YYYY-MM-DD` in the club's zone (wraps `eventDateInZone`)
  - `addDays(dateKey: string, n: number): string`
  - `weekBucket(dateKey: string, todayKey: string): 'This week' | 'Next week' | 'Later' | 'Past'`
  - `type MonthCell = { key: string; day: number; isToday: boolean; isPast: boolean } | null`
  - `buildMonthGrid(year: number, monthIndex: number, todayKey: string): MonthCell[]` (length multiple of 7, Monday first)
  - `monthLabel(year: number, monthIndex: number): string` — `'October 2026'`
  - `dayHeading(dateKey: string): string` — `'Thursday 1 Oct'`
  - `clubColor(clubId: string): string`
  - `clubSubline(role: ClubRole, nextStartsAt: string | null, timezone: string): string`
  - `gameCountLabel(n: number): string` — `'1 game'` / `'4 games'`
  - `upcomingSummary(games: { clubId: string }[]): string`
  - `dateColumn(startsAt: string, timezone: string): { month: string; day: string; weekday: string }`

- [ ] **Step 1: Write the failing tests**

Create `lib/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays, buildMonthGrid, clubColor, clubSubline, dateColumn, dayHeading,
  gameCountLabel, gameDateKey, gameHeadline, homeDefault, monthLabel,
  upcomingSummary, weekBucket,
} from './home';

describe('gameHeadline', () => {
  it('uses the title when present', () => {
    expect(gameHeadline('Beginner table', 'open_play')).toBe('Beginner table');
  });
  it('falls back to Private game for invite-only', () => {
    expect(gameHeadline('  ', 'invite_only')).toBe('Private game');
    expect(gameHeadline(null, 'invite_only')).toBe('Private game');
  });
  it('falls back to Open play otherwise', () => {
    expect(gameHeadline('', 'open_play')).toBe('Open play');
  });
});

describe('homeDefault', () => {
  it('prefers My games when anything is upcoming', () => {
    expect(homeDefault(1)).toBe('myGames');
    expect(homeDefault(0)).toBe('clubs');
  });
});

describe('dates', () => {
  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('gameDateKey uses the club timezone', () => {
    // 02:00 UTC on 2 Oct is still 1 Oct in New York
    expect(gameDateKey('2026-10-02T02:00:00Z', 'America/New_York')).toBe('2026-10-01');
  });

  it('weekBucket uses Monday-start weeks', () => {
    const tue = '2026-09-29'; // a Tuesday
    expect(weekBucket('2026-09-28', tue)).toBe('Past'); // Monday before today
    expect(weekBucket('2026-09-29', tue)).toBe('This week');
    expect(weekBucket('2026-10-04', tue)).toBe('This week'); // Sunday
    expect(weekBucket('2026-10-05', tue)).toBe('Next week'); // Monday
    expect(weekBucket('2026-10-11', tue)).toBe('Next week');
    expect(weekBucket('2026-10-12', tue)).toBe('Later');
  });

  it('weekBucket when today is a Sunday', () => {
    expect(weekBucket('2026-10-04', '2026-10-04')).toBe('This week');
    expect(weekBucket('2026-10-05', '2026-10-04')).toBe('Next week');
  });
});

describe('buildMonthGrid', () => {
  it('starts on Monday with leading blanks and flags today/past', () => {
    const grid = buildMonthGrid(2026, 9, '2026-10-07'); // October 2026 starts on a Thursday
    expect(grid.length % 7).toBe(0);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toEqual({ key: '2026-10-01', day: 1, isToday: false, isPast: true });
    const today = grid.find((c) => c?.key === '2026-10-07');
    expect(today).toEqual({ key: '2026-10-07', day: 7, isToday: true, isPast: false });
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it('handles February of a non-leap year', () => {
    const grid = buildMonthGrid(2027, 1, '2026-01-01'); // Feb 2027 starts Monday
    expect(grid[0]?.key).toBe('2027-02-01');
    expect(grid.filter(Boolean)).toHaveLength(28);
    expect(grid).toHaveLength(28);
  });
});

describe('labels', () => {
  it('monthLabel and dayHeading', () => {
    expect(monthLabel(2026, 9)).toBe('October 2026');
    expect(dayHeading('2026-10-01')).toBe('Thursday 1 Oct');
    expect(dayHeading('2026-09-29')).toBe('Tuesday 29 Sept');
  });

  it('gameCountLabel', () => {
    expect(gameCountLabel(1)).toBe('1 game');
    expect(gameCountLabel(4)).toBe('4 games');
  });

  it('upcomingSummary counts distinct clubs', () => {
    expect(upcomingSummary([{ clubId: 'a' }, { clubId: 'a' }, { clubId: 'b' }])).toBe(
      '3 upcoming across 2 clubs',
    );
    expect(upcomingSummary([{ clubId: 'a' }])).toBe('1 upcoming across 1 club');
  });

  it('clubSubline', () => {
    expect(clubSubline('host', '2026-09-29T15:30:00Z', 'America/New_York')).toBe(
      'Host · Next game Tue 29 Sept, 11:30 AM',
    );
    expect(clubSubline('co_organizer', null, 'UTC')).toBe('Co-organizer · No games scheduled');
    expect(clubSubline('member', null, 'UTC')).toBe('Member · No games scheduled');
  });

  it('dateColumn', () => {
    expect(dateColumn('2026-09-29T15:30:00Z', 'America/New_York')).toEqual({
      month: 'SEP', day: '29', weekday: 'Tue',
    });
  });

  it('clubColor is stable per club and from the palette', () => {
    expect(clubColor('abc')).toBe(clubColor('abc'));
    expect(typeof clubColor('xyz')).toBe('string');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- lib/home.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/home.ts`**

```ts
import type { ClubRole, GameMode } from './clubs';
import { eventDateInZone, formatEventTime } from './events';
import { colors } from './theme';

/**
 * Pure helpers for Home (club-hub redesign, phase 1). Dates travel as
 * 'YYYY-MM-DD' keys so week/month logic is plain calendar arithmetic with no
 * timezone in play; a game's key is taken in its club's timezone, "today" in
 * the device's.
 */

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function gameHeadline(title: string | null, gameMode: GameMode): string {
  const trimmed = (title ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  return gameMode === 'invite_only' ? 'Private game' : 'Open play';
}

export function homeDefault(upcomingCount: number): 'myGames' | 'clubs' {
  return upcomingCount > 0 ? 'myGames' : 'clubs';
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function gameDateKey(startsAt: string, timezone: string): string {
  return eventDateInZone(startsAt, timezone);
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}

/** 0 = Monday … 6 = Sunday. */
function mondayIndex(key: string): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

export function weekBucket(
  key: string,
  todayKey: string,
): 'This week' | 'Next week' | 'Later' | 'Past' {
  if (key < todayKey) return 'Past';
  const thisSunday = addDays(todayKey, 6 - mondayIndex(todayKey));
  if (key <= thisSunday) return 'This week';
  if (key <= addDays(thisSunday, 7)) return 'Next week';
  return 'Later';
}

export type MonthCell = { key: string; day: number; isToday: boolean; isPast: boolean } | null;

export function buildMonthGrid(year: number, monthIndex: number, todayKey: string): MonthCell[] {
  const first = `${year}-${pad(monthIndex + 1)}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: mondayIndex(first) }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    cells.push({ key, day, isToday: key === todayKey, isPast: key < todayKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTHS_LONG[monthIndex]} ${year}`;
}

export function dayHeading(key: string): string {
  const d = keyToUtc(key);
  return `${WEEKDAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function gameCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'game' : 'games'}`;
}

export function upcomingSummary(games: { clubId: string }[]): string {
  const clubs = new Set(games.map((g) => g.clubId)).size;
  return `${games.length} upcoming across ${clubs} ${clubs === 1 ? 'club' : 'clubs'}`;
}

// Five club colours from the design's calendar dots, assigned by the same
// string hash glyphForClub (lib/dashboard.ts) uses, so a club keeps its
// colour everywhere without a stored column.
const CLUB_COLORS = [
  colors.accent2[700],
  colors.accent[600],
  colors.accent2[500],
  colors.neutral[800],
  colors.accent[800],
];

export function clubColor(clubId: string): string {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  return CLUB_COLORS[Math.abs(hash) % CLUB_COLORS.length];
}

const ROLE_LABEL: Record<ClubRole, string> = {
  host: 'Host',
  co_organizer: 'Co-organizer',
  member: 'Member',
};

export function dateColumn(
  startsAt: string,
  timezone: string,
): { month: string; day: string; weekday: string } {
  const key = gameDateKey(startsAt, timezone);
  if (!key) return { month: '--', day: '--', weekday: '' };
  const d = keyToUtc(key);
  return {
    month: MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase(),
    day: String(d.getUTCDate()),
    weekday: WEEKDAYS_SHORT[d.getUTCDay()],
  };
}

export function clubSubline(role: ClubRole, nextStartsAt: string | null, timezone: string): string {
  if (!nextStartsAt) return `${ROLE_LABEL[role]} · No games scheduled`;
  const key = gameDateKey(nextStartsAt, timezone);
  const d = keyToUtc(key);
  const when = `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const time = formatEventTime(nextStartsAt, timezone, 'en-US');
  return `${ROLE_LABEL[role]} · Next game ${when}, ${time}`;
}
```

Check `colors.accent[600]` and `colors.accent2[500]` exist in `lib/theme.ts` (ramps are 100–900). `formatEventTime(..., 'en-US')` yields `11:30 AM`; if the test environment's ICU renders a narrow no-break space (` `) before `AM`, replace it: `.replace(/ /g, ' ')`.

- [ ] **Step 4: Run tests**

Run: `npm test -- lib/home.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/home.ts lib/home.test.ts
git commit -m "feat(lib): pure Home helpers (weeks, month grid, labels)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared GameRow

**Files:**
- Modify: `components/icons.tsx` (add `ListIcon`)
- Create: `components/GameRow.tsx`
- Test: `components/__tests__/game-row.test.tsx`

**Interfaces:**
- Consumes: `MyGame` (`lib/my-games.ts`), `gameHeadline`, `dateColumn` (`lib/home.ts`), `formatEventTime` (`lib/events.ts`), `MahjongTile` + `glyphForClub`, `PeopleIcon`, `CheckIcon`, `ChevronRightIcon`.
- Produces: `export default function GameRow(props: { game: MyGame; showClub?: boolean; description?: string | null; past?: boolean; onPress: (game: MyGame) => void; last?: boolean })`; `export function statusTag(game: MyGame): { label: string; tone: 'going' | 'hosting' | 'neutral' }`; `export function seatsLabel(game: MyGame): string`; `ListIcon({ size?, color? })`.

- [ ] **Step 1: Write the failing test**

Look at `components/__tests__/dashboard-parts.test.tsx` for how component tests render (react-native-web via vitest aliases) and mirror its imports. Create `components/__tests__/game-row.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GameRow, { seatsLabel, statusTag } from '../GameRow';
import type { MyGame } from '../../lib/my-games';

const GAME: MyGame = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: '', gameMode: 'open_play',
  seatingMode: 'open_seating', startsAt: '2026-09-29T15:30:00Z', timezone: 'America/New_York',
  venueName: 'Sample Venue', seatsTaken: 14, capacity: 24, myStatus: 'going',
  waitlistPosition: null, tableLabel: null,
};

describe('statusTag', () => {
  it('shows the table for a seated player', () => {
    expect(statusTag({ ...GAME, seatingMode: 'assigned_tables', tableLabel: 'Table 2' }))
      .toEqual({ label: 'Table 2', tone: 'going' });
  });
  it('shows Open seating for open seating', () => {
    expect(statusTag(GAME)).toEqual({ label: 'Open seating', tone: 'going' });
  });
  it("shows You're going for an unassigned table seat", () => {
    expect(statusTag({ ...GAME, seatingMode: 'assigned_tables' }))
      .toEqual({ label: "You're going", tone: 'going' });
  });
  it('shows the waitlist position', () => {
    expect(statusTag({ ...GAME, myStatus: 'waitlisted', waitlistPosition: 2 }))
      .toEqual({ label: 'Waitlist #2', tone: 'neutral' });
    expect(statusTag({ ...GAME, myStatus: 'waitlisted' }))
      .toEqual({ label: 'Waitlist', tone: 'neutral' });
  });
  it("shows You're hosting and Not going", () => {
    expect(statusTag({ ...GAME, myStatus: 'hosting' }))
      .toEqual({ label: "You're hosting", tone: 'hosting' });
    expect(statusTag({ ...GAME, myStatus: 'not' }))
      .toEqual({ label: 'Not going', tone: 'neutral' });
  });
});

describe('seatsLabel', () => {
  it('shows taken/capacity, or a count when uncapped', () => {
    expect(seatsLabel(GAME)).toBe('14/24');
    expect(seatsLabel({ ...GAME, capacity: null })).toBe('14 going');
  });
});

describe('GameRow', () => {
  it('renders the fallback headline, time · venue, club line and date column', () => {
    render(<GameRow game={GAME} showClub onPress={() => {}} />);
    expect(screen.getByText('Open play')).toBeTruthy();
    expect(screen.getByText('11:30 am · Sample Venue')).toBeTruthy();
    expect(screen.getByText('Test Club')).toBeTruthy();
    expect(screen.getByText('SEP')).toBeTruthy();
    expect(screen.getByText('29')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
  });

  it('hides the club line unless asked', () => {
    render(<GameRow game={GAME} onPress={() => {}} />);
    expect(screen.queryByText('Test Club')).toBeNull();
  });

  it('calls onPress with the game', () => {
    const onPress = vi.fn();
    render(<GameRow game={GAME} onPress={onPress} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(GAME);
  });
});
```

(`formatEventTime` uses `en-GB` by default, which renders `11:30 am`. Keep that default to match every other screen.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- components/__tests__/game-row.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `ListIcon`**

Append to `components/icons.tsx`, following the file's existing pattern (read one existing icon such as `BellIcon` for the exact `Svg`/`Path` imports and props):

```tsx
export function ListIcon({ size = 16, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  );
}
```

- [ ] **Step 4: Implement `components/GameRow.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import MahjongTile from './MahjongTile';
import { CheckIcon, ChevronRightIcon, PeopleIcon } from './icons';
import { glyphForClub } from '../lib/dashboard';
import { formatEventTime } from '../lib/events';
import { dateColumn, gameHeadline } from '../lib/home';
import type { MyGame } from '../lib/my-games';
import { colors, radius, type } from '../lib/theme';

export function statusTag(game: MyGame): { label: string; tone: 'going' | 'hosting' | 'neutral' } {
  switch (game.myStatus) {
    case 'hosting':
      return { label: "You're hosting", tone: 'hosting' };
    case 'waitlisted':
      return {
        label: game.waitlistPosition ? `Waitlist #${game.waitlistPosition}` : 'Waitlist',
        tone: 'neutral',
      };
    case 'not':
      return { label: 'Not going', tone: 'neutral' };
    case 'going':
      if (game.tableLabel) return { label: game.tableLabel, tone: 'going' };
      if (game.seatingMode === 'open_seating') return { label: 'Open seating', tone: 'going' };
      return { label: "You're going", tone: 'going' };
  }
}

export function seatsLabel(game: MyGame): string {
  return game.capacity === null
    ? `${game.seatsTaken} going`
    : `${game.seatsTaken}/${game.capacity}`;
}

/**
 * One game in a list (Design V3 "shared game row"): date column, optional
 * club line, headline (title or its fallback), "time · venue", optional
 * description, tags, chevron. Used by Home's My games and, in phase 2, the
 * club Games section.
 */
export default function GameRow({
  game,
  showClub = false,
  description,
  past = false,
  last = false,
  onPress,
}: {
  game: MyGame;
  showClub?: boolean;
  description?: string | null;
  past?: boolean;
  last?: boolean;
  onPress: (game: MyGame) => void;
}) {
  const headline = gameHeadline(game.title, game.gameMode);
  const date = dateColumn(game.startsAt, game.timezone);
  const time = formatEventTime(game.startsAt, game.timezone);
  const tag = statusTag(game);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${headline}, ${game.clubName}, ${date.weekday} ${date.day} ${date.month}, ${time}`}
      onPress={() => onPress(game)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        !last && styles.divider,
        (pressed || hovered) && styles.pressed,
        past && styles.past,
      ]}
    >
      <View style={styles.dateCol} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.month}>{date.month}</Text>
        <Text style={styles.day}>{date.day}</Text>
        <Text style={styles.weekday}>{date.weekday}</Text>
      </View>

      <View style={styles.body}>
        {showClub ? (
          <View style={styles.clubLine}>
            <MahjongTile suit={glyphForClub(game.clubId)} size="chip" />
            <Text style={styles.clubName} numberOfLines={1}>{game.clubName}</Text>
          </View>
        ) : null}
        <Text style={styles.headline} numberOfLines={1}>{headline}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`${time} · ${game.venueName}`}</Text>
        {description ? (
          <Text style={styles.description} numberOfLines={1}>{description}</Text>
        ) : null}
        <View style={styles.tags}>
          <View style={[styles.pill, styles.pillNeutral]}>
            <PeopleIcon size={13} color={colors.neutral[800]} />
            <Text style={[styles.pillText, { color: colors.neutral[800] }]}>{seatsLabel(game)}</Text>
          </View>
          <View
            style={[
              styles.pill,
              tag.tone === 'going' ? styles.pillGoing
                : tag.tone === 'hosting' ? styles.pillHosting
                : styles.pillMuted,
            ]}
          >
            {tag.tone === 'going' ? <CheckIcon size={13} color={colors.accent2[800]} /> : null}
            <Text
              style={[
                styles.pillText,
                {
                  color: tag.tone === 'going' ? colors.accent2[800]
                    : tag.tone === 'hosting' ? colors.accent[800]
                    : colors.neutral[800],
                },
              ]}
            >
              {tag.label}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.chevron}>
        <ChevronRightIcon size={18} color={colors.neutral[700]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  pressed: { backgroundColor: colors.surface },
  past: { opacity: 0.6 },
  dateCol: { width: 56, alignItems: 'center' },
  month: {
    fontFamily: type.bodyBold, fontSize: 12, color: colors.accent[700],
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  day: { fontFamily: type.heading, fontSize: 30, lineHeight: 34, color: colors.text },
  weekday: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  body: { flex: 1, minWidth: 0, gap: 3 },
  clubLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clubName: { fontFamily: type.bodyBold, fontSize: 12, color: colors.text, flexShrink: 1 },
  headline: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.neutral[800] },
  description: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  pillNeutral: { backgroundColor: 'transparent', paddingHorizontal: 0 },
  pillGoing: { backgroundColor: colors.accent2[200] },
  pillHosting: { backgroundColor: colors.accent[200] },
  pillMuted: { backgroundColor: colors.neutral[300] },
  pillText: { fontFamily: type.bodyBold, fontSize: 12 },
  chevron: { width: 18, alignItems: 'center' },
});
```

Check `MahjongTile`'s `size="chip"` renders ~20pt; if the smallest size is larger, add a `size="mini"` (20×20, radius 6) to `components/MahjongTile.tsx` following its existing size table, and use it here.

- [ ] **Step 5: Run tests**

Run: `npm test -- components/__tests__/game-row.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/GameRow.tsx components/icons.tsx components/__tests__/game-row.test.tsx
# plus components/MahjongTile.tsx if you added a size
git commit -m "feat(ui): shared GameRow for the club-hub redesign

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: My games list and calendar

**Files:**
- Create: `components/home/MyGamesList.tsx`, `components/home/MyGamesCalendar.tsx`
- Test: `components/__tests__/home-parts.test.tsx`

**Interfaces:**
- Consumes: `GameRow`, `MyGame`, `weekBucket`, `gameDateKey`, `gameCountLabel`, `buildMonthGrid`, `monthLabel`, `dayHeading`, `clubColor`, `ChevronLeftIcon`, `ChevronRightIcon`.
- Produces:
  - `MyGamesList({ games: MyGame[]; todayKey: string; onOpen: (g: MyGame) => void })`
  - `MyGamesCalendar({ year: number; monthIndex: number; todayKey: string; games: MyGame[]; selectedKey: string; onSelect: (key: string) => void; onPrev: () => void; onNext: () => void; onOpen: (g: MyGame) => void })`

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/home-parts.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MyGamesList from '../home/MyGamesList';
import MyGamesCalendar from '../home/MyGamesCalendar';
import type { MyGame } from '../../lib/my-games';

const base: MyGame = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Tuesday game',
  gameMode: 'open_play', seatingMode: 'open_seating', startsAt: '2026-09-29T15:30:00Z',
  timezone: 'America/New_York', venueName: 'Sample Venue', seatsTaken: 4, capacity: 8,
  myStatus: 'going', waitlistPosition: null, tableLabel: null,
};
const games: MyGame[] = [
  base,
  { ...base, eventId: 'e2', title: 'Next Monday', startsAt: '2026-10-05T15:30:00Z' },
  { ...base, eventId: 'e3', title: 'Much later', startsAt: '2026-10-20T15:30:00Z' },
];

describe('MyGamesList', () => {
  it('groups into This week / Next week / Later with counts', () => {
    render(<MyGamesList games={games} todayKey="2026-09-29" onOpen={() => {}} />);
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('Next week')).toBeTruthy();
    expect(screen.getByText('Later')).toBeTruthy();
    expect(screen.getAllByText('1 game')).toHaveLength(3);
  });

  it('omits empty groups and past games', () => {
    render(
      <MyGamesList
        games={[{ ...base, startsAt: '2026-09-20T15:30:00Z' }, games[2]]}
        todayKey="2026-09-29"
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.getByText('Later')).toBeTruthy();
  });
});

describe('MyGamesCalendar', () => {
  const props = {
    year: 2026, monthIndex: 8, todayKey: '2026-09-29', games,
    onPrev: vi.fn(), onNext: vi.fn(), onOpen: vi.fn(),
  };

  it("lists the selected day's games under its heading", () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={() => {}} />);
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(screen.getByText('Tuesday 29 Sept')).toBeTruthy();
    expect(screen.getByText('Tuesday game')).toBeTruthy();
  });

  it('shows the empty-day card', () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-30" onSelect={() => {}} />);
    expect(screen.getByText('Nothing on Wednesday 30 Sept.')).toBeTruthy();
  });

  it('selects a day when tapped', () => {
    const onSelect = vi.fn();
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^15 September/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-09-15');
  });

  it('navigates months', () => {
    render(<MyGamesCalendar {...props} selectedKey="2026-09-29" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(props.onPrev).toHaveBeenCalled();
    expect(props.onNext).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- components/__tests__/home-parts.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `components/home/MyGamesList.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import GameRow from '../GameRow';
import { gameCountLabel, gameDateKey, weekBucket } from '../../lib/home';
import type { MyGame } from '../../lib/my-games';
import { colors, type } from '../../lib/theme';

const GROUPS = ['This week', 'Next week', 'Later'] as const;

/** Upcoming games grouped into Monday-start weeks (Design V3 2a, List). */
export default function MyGamesList({
  games,
  todayKey,
  onOpen,
}: {
  games: MyGame[];
  todayKey: string;
  onOpen: (game: MyGame) => void;
}) {
  const grouped = GROUPS.map((title) => ({
    title,
    rows: games.filter((g) => weekBucket(gameDateKey(g.startsAt, g.timezone), todayKey) === title),
  })).filter((g) => g.rows.length > 0);

  return (
    <View style={styles.list}>
      {grouped.map((group) => (
        <View key={group.title}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{group.title}</Text>
            <Text style={styles.count}>{gameCountLabel(group.rows.length)}</Text>
          </View>
          {group.rows.map((game, i) => (
            <GameRow
              key={game.eventId}
              game={game}
              showClub
              last={i === group.rows.length - 1}
              onPress={onOpen}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: 4, paddingBottom: 4,
  },
  title: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  count: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
});
```

- [ ] **Step 4: Implement `components/home/MyGamesCalendar.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import GameRow from '../GameRow';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import {
  buildMonthGrid, clubColor, dayHeading, gameCountLabel, gameDateKey, monthLabel,
} from '../../lib/home';
import type { MyGame } from '../../lib/my-games';
import { colors, radius, type } from '../../lib/theme';

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Month card + the selected day's games (Design V3 2a, Calendar). */
export default function MyGamesCalendar({
  year,
  monthIndex,
  todayKey,
  games,
  selectedKey,
  onSelect,
  onPrev,
  onNext,
  onOpen,
}: {
  year: number;
  monthIndex: number;
  todayKey: string;
  games: MyGame[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (game: MyGame) => void;
}) {
  const byDay = new Map<string, MyGame[]>();
  for (const g of games) {
    const key = gameDateKey(g.startsAt, g.timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), g]);
  }
  const grid = buildMonthGrid(year, monthIndex, todayKey);
  const dayGames = byDay.get(selectedKey) ?? [];
  const heading = dayHeading(selectedKey);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.monthRow}>
          <Text style={styles.monthLabel}>{monthLabel(year, monthIndex)}</Text>
          <View style={styles.navButtons}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={onPrev} style={styles.navButton}>
              <ChevronLeftIcon size={20} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={onNext} style={styles.navButton}>
              <ChevronRightIcon size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text key={i} style={styles.weekday}>{d}</Text>
          ))}
        </View>
        <View style={styles.grid}>
          {grid.map((cell, i) => {
            if (!cell) return <View key={`blank-${i}`} style={styles.cell} />;
            const list = byDay.get(cell.key) ?? [];
            const dots = [...new Set(list.map((g) => g.clubId))].slice(0, 3);
            const selected = cell.key === selectedKey;
            return (
              <Pressable
                key={cell.key}
                accessibilityRole="button"
                accessibilityLabel={`${cell.day} ${monthLabel(year, monthIndex).split(' ')[0]}${
                  list.length ? `, ${gameCountLabel(list.length)}` : ''
                }`}
                accessibilityState={{ selected }}
                onPress={() => onSelect(cell.key)}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.circle,
                    cell.isToday && !selected && styles.today,
                    selected && styles.selected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      cell.isPast && styles.pastText,
                      list.length > 0 && styles.hasGames,
                      selected && styles.selectedText,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {dots.map((clubId) => (
                    <View key={clubId} style={[styles.dot, { backgroundColor: clubColor(clubId) }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {dayGames.length > 0 ? (
        <View>
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle} accessibilityRole="header">{heading}</Text>
            <Text style={styles.dayCount}>{gameCountLabel(dayGames.length)}</Text>
          </View>
          {dayGames.map((game, i) => (
            <GameRow
              key={game.eventId}
              game={game}
              showClub
              past={gameDateKey(game.startsAt, game.timezone) < todayKey}
              last={i === dayGames.length - 1}
              onPress={onOpen}
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{`Nothing on ${heading}.`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  monthLabel: { fontFamily: type.heading, fontSize: 20, color: colors.text },
  navButtons: { flexDirection: 'row', gap: 4 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  weekday: {
    flex: 1, textAlign: 'center', fontFamily: type.bodyBold, fontSize: 12, color: colors.neutral[700],
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.accentColor },
  selected: { backgroundColor: colors.accent[700] },
  dayNum: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  pastText: { color: colors.neutral[600] },
  hasGames: { fontFamily: type.bodyBold },
  selectedText: { color: '#fff' },
  dots: { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: 4, paddingBottom: 4,
  },
  dayTitle: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  dayCount: { fontFamily: type.bodySemiBold, fontSize: 13, color: colors.neutral[700] },
  empty: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.neutral[400],
    borderRadius: 20, padding: 20, alignItems: 'center',
  },
  emptyText: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.neutral[700] },
});
```

The test queries `name: /^15 September/`; the label is `"15 September"` (month name from `monthLabel`). Keep them in sync.

- [ ] **Step 5: Run tests**

Run: `npm test -- components/__tests__/home-parts.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/home/MyGamesList.tsx components/home/MyGamesCalendar.tsx components/__tests__/home-parts.test.tsx
git commit -m "feat(home): My games list and calendar views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Clubs view pieces — Join card, club card, code field

**Files:**
- Create: `components/home/JoinClubCard.tsx`, `components/home/ClubCard.tsx`, `components/home/ClubCodeField.tsx`
- Test: `components/__tests__/home-parts.test.tsx` (append)

**Interfaces:**
- Consumes: `joinClubByCode`, `normalizeClubCode` (Task 3); `clubSubline` (Task 4); `MahjongTile`, `glyphForClub`, `UnreadBadge` (existing — read `components/UnreadBadge.tsx` for its props), `ChevronRightIcon`.
- Produces:
  - `JoinClubCard({ onJoined: (clubId: string) => void })` — owns its input, busy and error state; calls `joinClubByCode`.
  - `ClubCard({ club: Club; role: ClubRole; nextStartsAt: string | null; unread: number; onPress: () => void })`
  - `ClubCodeField({ value: string; onChangeText: (v: string) => void; label: string; helper?: string; error?: string | null })` — a `TextInput` that shows uppercase and strips spaces as typed (used by Start a club and the club page).

- [ ] **Step 1: Write the failing tests (append to `components/__tests__/home-parts.test.tsx`)**

```tsx
import JoinClubCard from '../home/JoinClubCard';
import ClubCard from '../home/ClubCard';

const joinClubByCode = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clubs')>()),
  joinClubByCode: (...a: unknown[]) => joinClubByCode(...a),
}));

describe('JoinClubCard', () => {
  it('disables Join until text is entered, uppercases input', () => {
    render(<JoinClubCard onJoined={() => {}} />);
    const join = screen.getByRole('button', { name: 'Join' });
    expect(join.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'oak 2' } });
    expect((screen.getByLabelText('Club code') as HTMLInputElement).value).toBe('OAK2');
    expect(screen.getByRole('button', { name: 'Join' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('calls onJoined with the club id', async () => {
    joinClubByCode.mockResolvedValueOnce({ clubId: 'c1', alreadyMember: false, error: null });
    const onJoined = vi.fn();
    render(<JoinClubCard onJoined={onJoined} />);
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'OAK2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByRole('button', { name: 'Join' });
    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledWith('c1'));
  });

  it('shows the error inline', async () => {
    joinClubByCode.mockResolvedValueOnce({ clubId: null, alreadyMember: false, error: 'No club with that code.' });
    render(<JoinClubCard onJoined={() => {}} />);
    fireEvent.change(screen.getByLabelText('Club code'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('No club with that code.')).toBeTruthy();
  });
});

describe('ClubCard', () => {
  it('shows name, subline and unread', () => {
    render(
      <ClubCard
        club={{ id: 'c1', name: 'Test Club', slug: 't', rhythm: '', visibility: 'private',
          timezone: 'UTC', default_game_mode: 'open_play', code: 'TEST1' }}
        role="member"
        nextStartsAt={null}
        unread={3}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText('Test Club')).toBeTruthy();
    expect(screen.getByText('Member · No games scheduled')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
```

(How `Pressable disabled` surfaces in react-native-web: `aria-disabled="true"`. If the existing `Button` tests use a different assertion for disabled, copy theirs.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- components/__tests__/home-parts.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `components/home/ClubCodeField.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import { normalizeClubCode } from '../../lib/clubs';
import { colors, radius, type } from '../../lib/theme';

/** Club code input: shows uppercase with spaces removed as the person types. */
export default function ClubCodeField({
  value,
  onChangeText,
  label,
  helper,
  error,
}: {
  value: string;
  onChangeText: (v: string) => void;
  label: string;
  helper?: string;
  error?: string | null;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChangeText(normalizeClubCode(t))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  input: {
    minHeight: 48, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.neutral[400],
    paddingHorizontal: 16, fontFamily: type.bodyBold, fontSize: 17, letterSpacing: 2,
    color: colors.text, backgroundColor: colors.bg,
  },
  helper: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.neutral[700] },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[700] },
});
```

- [ ] **Step 4: Implement `components/home/JoinClubCard.tsx`**

```tsx
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import { joinClubByCode, normalizeClubCode } from '../../lib/clubs';
import { colors, radius, type } from '../../lib/theme';

/** "Join a club" by code (Design V3 2a, Clubs). Instant join; errors inline. */
export default function JoinClubCard({ onJoined }: { onJoined: (clubId: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || code.length === 0;

  async function submit() {
    if (disabled) return;
    setBusy(true);
    setError(null);
    const result = await joinClubByCode(code);
    setBusy(false);
    if (result.error || !result.clubId) {
      setError(result.error);
      return;
    }
    setCode('');
    onJoined(result.clubId);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Join a club</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Club code"
          placeholder="Club code"
          placeholderTextColor={colors.neutral[600]}
          value={code}
          onChangeText={(t) => {
            setCode(normalizeClubCode(t));
            setError(null);
          }}
          onSubmitEditing={() => void submit()}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join"
          disabled={disabled}
          onPress={() => void submit()}
          style={[styles.join, disabled && styles.joinDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.joinText, disabled && styles.joinTextDisabled]}>Join</Text>
          )}
        </Pressable>
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 16, gap: 10 },
  title: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.bg,
    paddingHorizontal: 16, fontFamily: type.bodyBold, fontSize: 16, letterSpacing: 2, color: colors.text,
  },
  join: {
    minWidth: 76, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.accent[700],
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
  },
  joinDisabled: { backgroundColor: colors.neutral[300] },
  joinText: { fontFamily: type.bodyBold, fontSize: 16, color: '#fff' },
  joinTextDisabled: { color: colors.neutral[600] },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[700] },
});
```

- [ ] **Step 5: Implement `components/home/ClubCard.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import MahjongTile from '../MahjongTile';
import { ChevronRightIcon } from '../icons';
import type { Club, ClubRole } from '../../lib/clubs';
import { glyphForClub } from '../../lib/dashboard';
import { clubSubline } from '../../lib/home';
import { colors, radius, type } from '../../lib/theme';

export default function ClubCard({
  club,
  role,
  nextStartsAt,
  unread,
  onPress,
}: {
  club: Club;
  role: ClubRole;
  nextStartsAt: string | null;
  unread: number;
  onPress: () => void;
}) {
  const subline = clubSubline(role, nextStartsAt, club.timezone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${club.name}. ${subline}${unread > 0 ? `. ${unread} unread` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <MahjongTile suit={glyphForClub(club.id)} size="section" />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{club.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>{subline}</Text>
      </View>
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
        </View>
      ) : null}
      <ChevronRightIcon size={18} color={colors.neutral[700]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80,
    backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12,
  },
  pressed: { opacity: 0.85 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  sub: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  badge: {
    minWidth: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.accent[700],
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  badgeText: { fontFamily: type.bodyBold, fontSize: 12, color: '#fff' },
});
```

Check `MahjongTile size="section"` is ~52pt (design: 52pt, radius 16). If it isn't, use the closest existing size; don't add a new one just for this.

- [ ] **Step 6: Run tests**

Run: `npm test -- components/__tests__/home-parts.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/home/JoinClubCard.tsx components/home/ClubCard.tsx components/home/ClubCodeField.tsx components/__tests__/home-parts.test.tsx
git commit -m "feat(home): Join a club card, club card and code field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: "Needs you" — hook and stack

**Files:**
- Create: `lib/use-needs-you.ts`, `components/home/NeedsYouStack.tsx`
- Test: `app/__tests__/home.test.tsx` gets the stack cases in Task 9; this task adds `components/__tests__/needs-you.test.tsx`

**Interfaces:**
- Consumes (existing): `fetchMyUpcomingBookings`, `acceptBookingInvite`, `declineBooking`, `acceptPromotionOffer`, `declinePromotionOffer`, `commitBooking`, `offerCountdown`, `waitlistLabel`, `MyBooking`, `BookingOutcome` (`lib/bookings.ts`); `fetchMyPendingInvites`, `acceptClubInvite`, `declineClubInvite`, `PendingInvite`, `Club` (`lib/clubs.ts`); `fetchUpcomingEvents`, `formatEventWhen` (`lib/events.ts`); `pendingGameInvites`, `needAFourthAlerts`, `FourthAlert` (`lib/dashboard.ts`); `NeedAFourthCard`, `Card`, `Button`, `NoticeBanner`, `ErrorBanner`.
- Produces:
  - `useNeedsYou(userId: string | undefined, clubs: Club[] | null, onSeatChanged: () => void): NeedsYou` where

    ```ts
    type NeedsYou = {
      clubInvites: PendingInvite[];
      gameInvites: MyBooking[];
      offers: MyBooking[];
      alerts: FourthAlert[];
      busy: boolean;
      error: string | null;
      notice: string | null;
      dismissNotice: () => void;
      acceptClubInvite: (i: PendingInvite) => void;
      declineClubInvite: (i: PendingInvite) => void;
      acceptGameInvite: (b: MyBooking) => void;
      declineGameInvite: (b: MyBooking) => void;
      acceptOffer: (b: MyBooking) => void;
      declineOffer: (b: MyBooking) => void;
      takeSeat: (a: FourthAlert) => void;
      reload: () => Promise<void>;
    };
    ```
  - `NeedsYouStack({ needs: NeedsYou })` — renders nothing when all four lists are empty and there is no notice/error.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/needs-you.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NeedsYouStack from '../home/NeedsYouStack';
import type { NeedsYou } from '../../lib/use-needs-you';
import type { MyBooking } from '../../lib/bookings';

function needs(over: Partial<NeedsYou> = {}): NeedsYou {
  return {
    clubInvites: [], gameInvites: [], offers: [], alerts: [], busy: false, error: null,
    notice: null, dismissNotice: vi.fn(), acceptClubInvite: vi.fn(), declineClubInvite: vi.fn(),
    acceptGameInvite: vi.fn(), declineGameInvite: vi.fn(), acceptOffer: vi.fn(),
    declineOffer: vi.fn(), takeSeat: vi.fn(), reload: vi.fn(), ...over,
  };
}

describe('NeedsYouStack', () => {
  it('renders nothing when there is nothing to do', () => {
    const { container } = render(<NeedsYouStack needs={needs()} />);
    expect(container.textContent).toBe('');
  });

  it('shows a club invite with Join / No thanks', () => {
    const n = needs({
      clubInvites: [{ id: 'i1', clubId: 'c1', clubName: 'Oakfield', eventId: null, eventTitle: null }],
    });
    render(<NeedsYouStack needs={n} />);
    expect(screen.getByText('Oakfield invited you to join')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join Oakfield' }));
    expect(n.acceptClubInvite).toHaveBeenCalled();
  });

  it('shows a live seat offer with Take the seat', () => {
    const offer = {
      booking_id: 'b1', event_title: 'Thursday', club_name: 'Test Club',
      starts_at: '2026-10-01T15:30:00Z', club_timezone: 'UTC', offer_id: 'o1',
      offer_seats: 1, offer_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    } as unknown as MyBooking;
    const n = needs({ offers: [offer] });
    render(<NeedsYouStack needs={n} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take the 1 seat' }));
    expect(n.acceptOffer).toHaveBeenCalledWith(offer);
  });
});
```

Check `PendingInvite`'s field names in `lib/clubs.ts:554` and adjust the fixture if they differ (the old dashboard reads `invite.clubName` and `invite.eventTitle`).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- components/__tests__/needs-you.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/use-needs-you.ts`**

Port from `app/clubs/index.tsx` (read it before deleting it in Task 10): `waitlistNotice` (lines 75–98), the `busyRef`/`mounted` pattern, `runBookingAction` (329–347), `runInviteAction` (408–425), the invite/offer handlers (349–398), and `takeSeat` (486–519). The hook replaces the screen's `reloadAfterBooking` with its own `reload` + the caller's `onSeatChanged` (Home refetches My games). Code:

```ts
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptBookingInvite, acceptPromotionOffer, commitBooking, declineBooking,
  declinePromotionOffer, fetchMyUpcomingBookings, waitlistLabel,
  type BookingOutcome, type MyBooking,
} from './bookings';
import {
  acceptClubInvite as acceptClubInviteRpc, declineClubInvite as declineClubInviteRpc,
  fetchMyPendingInvites, type Club, type PendingInvite,
} from './clubs';
import { needAFourthAlerts, pendingGameInvites, type FourthAlert } from './dashboard';
import { fetchUpcomingEvents, type ClubEvent } from './events';

export type NeedsYou = {
  clubInvites: PendingInvite[];
  gameInvites: MyBooking[];
  offers: MyBooking[];
  alerts: FourthAlert[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  dismissNotice: () => void;
  acceptClubInvite: (i: PendingInvite) => void;
  declineClubInvite: (i: PendingInvite) => void;
  acceptGameInvite: (b: MyBooking) => void;
  declineGameInvite: (b: MyBooking) => void;
  acceptOffer: (b: MyBooking) => void;
  declineOffer: (b: MyBooking) => void;
  takeSeat: (a: FourthAlert) => void;
  reload: () => Promise<void>;
};

/** The waitlisted half of a commit_booking outcome, naming its game. */
function waitlistNotice(result: BookingOutcome | null, description: string): string | null {
  if (!result || result.outcome !== 'waitlisted') return null;
  const position =
    result.waitlist_position !== null ? waitlistLabel(result.waitlist_position) : 'Waiting for a seat';
  return `${position} — ${description}`;
}

/** A live, unanswered seat offer (its own expiry, not the game's start, decides). */
function isLiveOffer(b: MyBooking): boolean {
  return (
    b.status === 'waitlisted' &&
    b.offer_id !== null &&
    b.offer_seats !== null &&
    b.offer_expires_at !== null &&
    new Date(b.offer_expires_at).getTime() > Date.now()
  );
}

/**
 * Everything on Home that asks the member to act: club invites, game
 * invites, waitlist seat offers and need-a-fourth calls. Ported from the old
 * dashboard (app/clubs/index.tsx); check-in, "Can't make it" and leaving a
 * waitlist now live only on Game detail.
 *
 * need-a-fourth still needs each club's events with tables and bookings, so
 * this is the one place that still reads fetchUpcomingEvents per club.
 */
export function useNeedsYou(
  userId: string | undefined,
  clubs: Club[] | null,
  onSeatChanged: () => void,
): NeedsYou {
  const router = useRouter();
  const [clubInvites, setClubInvites] = useState<PendingInvite[]>([]);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clubKey = (clubs ?? []).map((c) => c.id).sort().join(',');

  const reload = useCallback(async () => {
    if (!userId) return;
    const [invites, mine, perClub] = await Promise.all([
      fetchMyPendingInvites(),
      fetchMyUpcomingBookings(),
      Promise.all((clubs ?? []).map((c) => fetchUpcomingEvents(c.id))),
    ]);
    if (!mounted.current) return;
    setClubInvites(invites ?? []);
    setBookings(mine ?? []);
    setEvents(perClub.filter((e): e is ClubEvent[] => e !== null).flat());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clubKey summarizes clubs
  }, [userId, clubKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<{ error: string | null }>, seatChange: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: actionError } = await action();
    if (!mounted.current) return;
    if (actionError) {
      busyRef.current = false;
      setBusy(false);
      setError(actionError);
      return;
    }
    await reload();
    if (seatChange) onSeatChanged();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
  }

  const alerts = needAFourthAlerts({ events, clubs: clubs ?? [], userId: userId ?? '' });

  return {
    clubInvites,
    gameInvites: pendingGameInvites(bookings),
    offers: bookings.filter(isLiveOffer),
    alerts,
    busy,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    acceptClubInvite: (invite) =>
      void run(async () => {
        const { clubId, eventId, error: e } = await acceptClubInviteRpc(invite.id);
        if (e) return { error: e };
        router.push(eventId ? `/clubs/${clubId}/events/${eventId}` : `/clubs/${clubId}`);
        return { error: null };
      }, false),
    declineClubInvite: (invite) => void run(() => declineClubInviteRpc(invite.id), false),
    acceptGameInvite: (b) => void run(() => acceptBookingInvite(b.booking_id), true),
    declineGameInvite: (b) => void run(() => declineBooking(b.booking_id), true),
    acceptOffer: (b) => void run(() => acceptPromotionOffer(b.offer_id as string), true),
    declineOffer: (b) => void run(() => declinePromotionOffer(b.offer_id as string), true),
    takeSeat: (alert) =>
      void run(async () => {
        const { result, error: e } = await commitBooking({
          eventId: alert.eventId,
          players: [userId ?? ''],
          preferredTableId: alert.tableId,
          allowSplit: false,
        });
        if (e) return { error: e };
        setNotice(waitlistNotice(result, alert.text) ?? `You're in — ${alert.text}.`);
        return { error: null };
      }, true),
    reload,
  };
}
```

Note `run` clears `notice` before the action; `takeSeat` sets it inside the action, after that clear — so it survives. Verify `needAFourthAlerts`' exact input shape in `lib/dashboard.ts:359` and match it.

- [ ] **Step 4: Implement `components/home/NeedsYouStack.tsx`**

Move `PendingInviteCards` and `GameInviteCards` **verbatim** from `app/clubs/index.tsx` (lines ~928–1026) into this file, together with the style entries they use (`inviteHeading`, `help`) copied from that file's `StyleSheet`. Then add:

```tsx
import { StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Button from '../Button';
import Card from '../Card';
import ErrorBanner from '../ErrorBanner';
import NeedAFourthCard from '../NeedAFourthCard';
import NoticeBanner from '../NoticeBanner';
import { offerCountdown, type MyBooking } from '../../lib/bookings';
import type { PendingInvite } from '../../lib/clubs';
import { formatEventWhen } from '../../lib/events';
import type { NeedsYou } from '../../lib/use-needs-you';
import { colors, space, type } from '../../lib/theme';

// ...PendingInviteCards and GameInviteCards moved here verbatim...

function OfferCard({
  offer,
  busy,
  onAccept,
  onDecline,
}: {
  offer: MyBooking;
  busy: boolean;
  onAccept: (b: MyBooking) => void;
  onDecline: (b: MyBooking) => void;
}) {
  const seats = offer.offer_seats ?? 1;
  return (
    <Card>
      <Text style={styles.inviteHeading}>
        {`A seat opened up — ${offer.event_title}`}
      </Text>
      <Text style={styles.help}>
        {`${offer.club_name} · ${formatEventWhen(offer.starts_at, offer.club_timezone)}`}
      </Text>
      <Text style={styles.help}>
        {offerCountdown(new Date(offer.offer_expires_at as string), new Date())}
      </Text>
      <Button
        block
        disabled={busy}
        onPress={() => onAccept(offer)}
        accessibilityLabel={`Take the ${seats} ${seats === 1 ? 'seat' : 'seats'}`}
      >
        {`Take ${seats === 1 ? 'the seat' : `the ${seats} seats`}`}
      </Button>
      <Button
        variant="ghost"
        big={false}
        disabled={busy}
        onPress={() => onDecline(offer)}
        accessibilityLabel={`Decline the ${seats} ${seats === 1 ? 'seat' : 'seats'} offered for ${offer.event_title}`}
      >
        No thanks
      </Button>
    </Card>
  );
}

/** Home's "Needs you" stack. Renders nothing when there is nothing to act on. */
export default function NeedsYouStack({ needs }: { needs: NeedsYou }) {
  const empty =
    needs.clubInvites.length === 0 &&
    needs.gameInvites.length === 0 &&
    needs.offers.length === 0 &&
    needs.alerts.length === 0 &&
    !needs.notice &&
    !needs.error;
  if (empty) return null;

  return (
    <View style={styles.stack}>
      {needs.notice ? <NoticeBanner message={needs.notice} onDismiss={needs.dismissNotice} /> : null}
      {needs.error ? <ErrorBanner message={needs.error} /> : null}
      <PendingInviteCards
        invites={needs.clubInvites}
        busy={needs.busy}
        onAccept={needs.acceptClubInvite}
        onDecline={needs.declineClubInvite}
      />
      <GameInviteCards
        invites={needs.gameInvites}
        busy={needs.busy}
        onAccept={needs.acceptGameInvite}
        onDecline={needs.declineGameInvite}
      />
      {needs.offers.map((offer) => (
        <OfferCard
          key={offer.booking_id}
          offer={offer}
          busy={needs.busy}
          onAccept={needs.acceptOffer}
          onDecline={needs.declineOffer}
        />
      ))}
      {needs.alerts.map((alert) => (
        <NeedAFourthCard
          key={`${alert.eventId}:${alert.tableId}`}
          clubName={alert.clubName}
          text={alert.text}
          busy={needs.busy}
          onTake={() => needs.takeSeat(alert)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  // inviteHeading and help: copied from app/clubs/index.tsx's StyleSheet
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- components/__tests__/needs-you.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/use-needs-you.ts components/home/NeedsYouStack.tsx components/__tests__/needs-you.test.tsx
git commit -m "feat(home): Needs you stack (invites, seat offers, need a fourth)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Header, switch and the Home screen

**Files:**
- Create: `components/home/HomeHeader.tsx`, `components/home/HomeSwitch.tsx`, `app/home.tsx`
- Modify: `app/index.tsx`, `app/__tests__/index.test.ts`
- Test: `app/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–8; `useSession`, `useGuides`, `useUnreadCounts`, `useNotificationsUnread`, `fetchMyClubs`, `fetchMyRoles`, `fetchProfile`, `fetchHostChecklistCounts`, `hostChecklist`, `hostChecklistKey`, `canInvite`, `TipCard`/`TipText`, `Screen`, `Skeleton`, `ErrorBanner`, `BellIcon`, `ListIcon`, `CalendarIcon`, `PlusIcon`; `@react-native-async-storage/async-storage`; `useFocusEffect` from `expo-router`.
- Produces:
  - `HomeHeader({ initial: string; unread: boolean; onAlerts: () => void; onProfile: () => void })`
  - `HomeSwitch({ value: 'myGames' | 'clubs'; upcomingCount: number; onChange: (v) => void })`
  - `app/home.tsx` default export `HomeScreen`
  - `resolveIndexRedirect` returns `'/home'` for a signed-in user.

- [ ] **Step 1: Write the failing tests**

Update `app/__tests__/index.test.ts`: every expectation of `'/clubs'` becomes `'/home'`.

Create `app/__tests__/home.test.tsx` (mocks modeled on the deleted `your-games.test.tsx`: `expo-router` with a real `useEffect` for `useFocusEffect`, a module-scoped `SESSION`):

```tsx
import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'me', email: 'me@example.com' } }, loading: false };
vi.mock('../../lib/session', () => ({ useSession: () => SESSION }));

const GUIDES = { isVisible: () => false, dismiss: vi.fn() };
vi.mock('../../lib/use-guides', () => ({ useGuides: () => GUIDES }));
vi.mock('../../lib/use-unread', () => ({ useUnreadCounts: () => ({ total: 0, byClub: {} }) }));
vi.mock('../../lib/use-notifications-unread', () => ({ useNotificationsUnread: () => 2 }));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const NEEDS = {
  clubInvites: [], gameInvites: [], offers: [], alerts: [], busy: false, error: null,
  notice: null, dismissNotice: vi.fn(), acceptClubInvite: vi.fn(), declineClubInvite: vi.fn(),
  acceptGameInvite: vi.fn(), declineGameInvite: vi.fn(), acceptOffer: vi.fn(),
  declineOffer: vi.fn(), takeSeat: vi.fn(), reload: vi.fn(),
};
vi.mock('../../lib/use-needs-you', () => ({ useNeedsYou: () => NEEDS }));

const fetchMyGames = vi.fn();
const fetchClubsNextGame = vi.fn();
vi.mock('../../lib/my-games', () => ({
  fetchMyGames: (...a: unknown[]) => fetchMyGames(...a),
  fetchClubsNextGame: () => fetchClubsNextGame(),
}));

const CLUB = {
  id: 'c1', name: 'Test Club', slug: 't', rhythm: '', visibility: 'private',
  timezone: 'America/New_York', default_game_mode: 'open_play', code: 'TEST1',
};
vi.mock('../../lib/clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clubs')>()),
  fetchMyClubs: async () => [CLUB],
  fetchMyRoles: async () => [{ club_id: 'c1', role: 'member' }],
}));
vi.mock('../../lib/profile', () => ({
  fetchProfile: async () => ({ display_name: 'Anand' }),
}));

import HomeScreen from '../home';

const GAME = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Tuesday game',
  gameMode: 'open_play', seatingMode: 'open_seating',
  startsAt: new Date(Date.now() + 86_400_000).toISOString(), timezone: 'America/New_York',
  venueName: 'Sample Venue', seatsTaken: 2, capacity: 8, myStatus: 'going',
  waitlistPosition: null, tableLabel: null,
};

beforeEach(() => {
  push.mockReset();
  store.clear();
  fetchClubsNextGame.mockResolvedValue({});
});

describe('HomeScreen', () => {
  it('defaults to My games when something is upcoming', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
    expect(screen.getByText('1 upcoming across 1 club')).toBeTruthy();
    expect(screen.getByRole('button', { name: /My games/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('defaults to Clubs when nothing is upcoming', async () => {
    fetchMyGames.mockResolvedValue([]);
    render(<HomeScreen />);
    expect(await screen.findByText('Join a club')).toBeTruthy();
    expect(screen.getByText('Test Club')).toBeTruthy();
  });

  it('shows the feed error with Retry', async () => {
    fetchMyGames.mockResolvedValueOnce(null).mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /My games/ }));
    expect(await screen.findByText('Could not load your games.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
  });

  it('opens a game, alerts and profile', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^Open Tuesday game/ }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e1');
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(push).toHaveBeenCalledWith('/alerts');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  it('switches to Calendar and remembers it', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    await waitFor(() => expect(store.get('home:myGamesMode:me')).toBe('calendar'));
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- app/__tests__/home.test.tsx app/__tests__/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `components/home/HomeHeader.tsx`**

```tsx
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { BellIcon } from '../icons';
import { colors, type } from '../../lib/theme';

export default function HomeHeader({
  initial,
  unread,
  onAlerts,
  onProfile,
}: {
  initial: string;
  unread: boolean;
  onAlerts: () => void;
  onProfile: () => void;
}) {
  return (
    <View style={styles.row}>
      <Image source={require('../../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
      <Text style={styles.wordmark} accessibilityRole="header">MahjHero</Text>
      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Alerts, unread' : 'Alerts'}
        onPress={onAlerts}
        style={styles.alerts}
      >
        <BellIcon size={20} color={colors.text} />
        {unread ? <View style={styles.dot} /> : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={onProfile} style={styles.avatar}>
        <Text style={styles.initial}>{initial}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 12 },
  icon: { width: 40, height: 40, borderRadius: 11 },
  wordmark: { fontFamily: type.heading, fontSize: 26, color: colors.text },
  spacer: { flex: 1 },
  alerts: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  dot: {
    position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: colors.accent[600], borderWidth: 1.5, borderColor: colors.surface,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent2[700],
    alignItems: 'center', justifyContent: 'center',
  },
  initial: { fontFamily: type.heading, fontSize: 20, color: '#fff' },
});
```

Confirm the app icon path with `ls assets` (use whatever `app.json`'s `icon` points at). If `require` of a PNG isn't handled in vitest, the existing config probably stubs assets — check `vitest.config.mts`; if not, add `test.alias` or mock the asset in the test.

- [ ] **Step 4: Implement `components/home/HomeSwitch.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { colors, radius, type } from '../../lib/theme';

export type HomeView = 'myGames' | 'clubs';

export default function HomeSwitch({
  value,
  upcomingCount,
  onChange,
}: {
  value: HomeView;
  upcomingCount: number;
  onChange: (v: HomeView) => void;
}) {
  const options: { key: HomeView; label: string }[] = [
    { key: 'myGames', label: 'My games' },
    { key: 'clubs', label: 'Clubs' },
  ];
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            aria-selected={selected}
            accessibilityLabel={o.key === 'myGames' ? `My games, ${upcomingCount} upcoming` : 'Clubs'}
            onPress={() => onChange(o.key)}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{o.label}</Text>
            {o.key === 'myGames' && upcomingCount > 0 ? (
              <Text style={[styles.count, selected && styles.selectedLabel]}>{upcomingCount}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4 },
  option: {
    flex: 1, minHeight: 42, borderRadius: radius.pill, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  selected: { backgroundColor: colors.accent[700] },
  label: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  count: { fontFamily: type.bodyBold, fontSize: 13, color: colors.neutral[700] },
  selectedLabel: { color: '#fff' },
});
```

The test asserts `aria-selected="true"` on the selected option; react-native-web forwards `aria-selected`. If it doesn't render, change the test to `accessibilityState` via `aria-selected` equivalent the web build produces (inspect with `screen.debug()`).

- [ ] **Step 5: Implement `app/home.tsx`**

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import Button from '../components/Button';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import Skeleton from '../components/Skeleton';
import TipCard, { TipText } from '../components/TipCard';
import { CalendarIcon, ListIcon } from '../components/icons';
import ClubCard from '../components/home/ClubCard';
import HomeHeader from '../components/home/HomeHeader';
import HomeSwitch, { type HomeView } from '../components/home/HomeSwitch';
import JoinClubCard from '../components/home/JoinClubCard';
import MyGamesCalendar from '../components/home/MyGamesCalendar';
import MyGamesList from '../components/home/MyGamesList';
import NeedsYouStack from '../components/home/NeedsYouStack';
import { canInvite, fetchMyClubs, fetchMyRoles, type Club, type ClubRole } from '../lib/clubs';
import { GENERIC_ERROR } from '../lib/constants';
import {
  fetchHostChecklistCounts, hostChecklist, hostChecklistKey, type HostChecklistCounts,
} from '../lib/guides';
import { gameDateKey, homeDefault, localDateKey, upcomingSummary } from '../lib/home';
import { fetchClubsNextGame, fetchMyGames, type MyGame } from '../lib/my-games';
import { fetchProfile } from '../lib/profile';
import { useSession } from '../lib/session';
import { colors, layout, radius, type } from '../lib/theme';
import { useGuides } from '../lib/use-guides';
import { useNeedsYou } from '../lib/use-needs-you';
import { useNotificationsUnread } from '../lib/use-notifications-unread';
import { useUnreadCounts } from '../lib/use-unread';

const LIST_WINDOW_DAYS = 120;
type Mode = 'list' | 'calendar';

/**
 * Home (Design V3 2a): header, "Needs you", then My games (list or
 * calendar) or Clubs. Replaces the old dashboard (app/clubs/index.tsx) and
 * the global tab bar.
 */
export default function HomeScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const guides = useGuides();
  const { byClub: unreadByClub } = useUnreadCounts();
  const alertsUnread = useNotificationsUnread();

  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [clubsFailed, setClubsFailed] = useState(false);
  const [roles, setRoles] = useState<{ club_id: string; role: ClubRole }[] | null>(null);
  const [nextGames, setNextGames] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState('');
  const [upcoming, setUpcoming] = useState<MyGame[] | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [view, setView] = useState<HomeView | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const todayKey = localDateKey(new Date());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [monthGames, setMonthGames] = useState<MyGame[]>([]);
  const [checklist, setChecklist] = useState<Record<string, HostChecklistCounts | null>>({});

  const loadFeed = useCallback(async () => {
    const now = new Date();
    const result = await fetchMyGames(now, new Date(now.getTime() + LIST_WINDOW_DAYS * 86_400_000));
    setFeedFailed(result === null);
    setUpcoming(result ?? []);
  }, []);

  const loadClubs = useCallback(async () => {
    if (!userId) return;
    const [list, myRoles, next] = await Promise.all([
      fetchMyClubs(),
      fetchMyRoles(userId),
      fetchClubsNextGame(),
    ]);
    setClubsFailed(list === null);
    setClubs(list ?? []);
    setRoles(myRoles ?? []);
    setNextGames(next ?? {});
  }, [userId]);

  const needs = useNeedsYou(userId, clubs, () => void loadFeed());

  // Refetch whenever Home regains focus (coming back from a game after
  // booking or cancelling), like the old dashboard.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void loadFeed();
      void loadClubs();
      void needs.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- needs.reload is stable per userId/clubs
    }, [userId, loadFeed, loadClubs]),
  );

  useEffect(() => {
    if (!userId) return;
    fetchProfile(userId).then((p) => {
      const name = p?.display_name?.trim() || session?.user.email || '?';
      setInitial(name.charAt(0).toUpperCase());
    });
    AsyncStorage.getItem(`home:myGamesMode:${userId}`)
      .then((v) => {
        if (v === 'list' || v === 'calendar') setMode(v);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // The switch default waits for the feed so it never flickers.
  useEffect(() => {
    if (view === null && upcoming !== null) setView(homeDefault(upcoming.length));
  }, [upcoming, view]);

  // Calendar months fetch on navigation; the previous month stays on screen
  // until the new one arrives.
  useEffect(() => {
    if (mode !== 'calendar' || !userId) return;
    let cancelled = false;
    const from = new Date(month.year, month.monthIndex, 1);
    const to = new Date(month.year, month.monthIndex + 1, 1);
    fetchMyGames(from, to).then((r) => {
      if (!cancelled && r) setMonthGames(r);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, month, userId]);

  // Host checklist counts, loaded only while the Clubs view is shown.
  const hostedIds = (roles ?? [])
    .filter((r) => r.role === 'host')
    .map((r) => r.club_id)
    .filter((id) => guides.isVisible(hostChecklistKey(id)));
  const hostedKey = [...hostedIds].sort().join(',');
  useEffect(() => {
    if (view !== 'clubs' || hostedIds.length === 0) return;
    let cancelled = false;
    Promise.all(hostedIds.map(async (id) => [id, await fetchHostChecklistCounts(id)] as const)).then(
      (entries) => {
        if (!cancelled) setChecklist(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hostedKey summarizes hostedIds
  }, [view, hostedKey]);

  function chooseMode(next: Mode) {
    setMode(next);
    if (userId) AsyncStorage.setItem(`home:myGamesMode:${userId}`, next).catch(() => {});
  }

  function shiftMonth(delta: number) {
    const d = new Date(month.year, month.monthIndex + delta, 1);
    const next = { year: d.getFullYear(), monthIndex: d.getMonth() };
    setMonth(next);
    const inView = todayKey.startsWith(`${next.year}-${String(next.monthIndex + 1).padStart(2, '0')}`);
    setSelectedKey(inView ? todayKey : localDateKey(d));
  }

  const openGame = (g: MyGame) => router.push(`/clubs/${g.clubId}/events/${g.eventId}`);

  if (loading) {
    return (
      <Screen center>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const header = (
    <HomeHeader
      initial={initial}
      unread={alertsUnread > 0}
      onAlerts={() => router.push('/alerts')}
      onProfile={() => router.push('/profile')}
    />
  );

  if (view === null) {
    return (
      <Screen scroll contentStyle={styles.container}>
        {header}
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </Screen>
    );
  }

  const roleFor = (clubId: string): ClubRole =>
    roles?.find((r) => r.club_id === clubId)?.role ?? 'member';
  const upcomingGames = (upcoming ?? []).filter(
    (g) => gameDateKey(g.startsAt, g.timezone) >= todayKey,
  );

  return (
    <Screen scroll contentStyle={styles.container}>
      {header}
      <NeedsYouStack needs={needs} />
      <HomeSwitch value={view} upcomingCount={upcomingGames.length} onChange={setView} />

      {view === 'myGames' ? (
        <View style={styles.section}>
          <View style={styles.subRow}>
            <Text style={styles.sub}>{upcomingSummary(upcomingGames)}</Text>
            <View style={styles.modeTrack}>
              <ModeButton label="List" icon={<ListIcon size={14} color={mode === 'list' ? colors.accent[800] : colors.neutral[700]} />} selected={mode === 'list'} onPress={() => chooseMode('list')} />
              <ModeButton label="Calendar" icon={<CalendarIcon size={14} color={mode === 'calendar' ? colors.accent[800] : colors.neutral[700]} />} selected={mode === 'calendar'} onPress={() => chooseMode('calendar')} />
            </View>
          </View>

          {feedFailed ? (
            <View style={styles.errorBlock}>
              <Text style={styles.sub}>Could not load your games.</Text>
              <Button variant="secondary" big={false} onPress={() => void loadFeed()} accessibilityLabel="Retry">
                Retry
              </Button>
            </View>
          ) : mode === 'list' ? (
            upcomingGames.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.sub}>No games yet. Join one from a club.</Text>
                <Button variant="secondary" big={false} onPress={() => setView('clubs')} accessibilityLabel="Show my clubs">
                  Clubs
                </Button>
              </View>
            ) : (
              <MyGamesList games={upcomingGames} todayKey={todayKey} onOpen={openGame} />
            )
          ) : (
            <MyGamesCalendar
              year={month.year}
              monthIndex={month.monthIndex}
              todayKey={todayKey}
              games={monthGames}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
              onOpen={openGame}
            />
          )}
        </View>
      ) : (
        <View style={styles.section}>
          <JoinClubCard onJoined={(clubId) => router.push(`/clubs/${clubId}`)} />
          <GuideCards
            clubs={clubs ?? []}
            roles={roles}
            checklist={checklist}
            email={session.user.email}
          />
          {clubsFailed ? <ErrorBanner message={GENERIC_ERROR} /> : null}
          {(clubs ?? []).map((club) => (
            <ClubCard
              key={club.id}
              club={club}
              role={roleFor(club.id)}
              nextStartsAt={nextGames[club.id] ?? null}
              unread={unreadByClub[club.id] ?? 0}
              onPress={() => router.push(`/clubs/${club.id}`)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a club"
            onPress={() => router.push('/clubs/new')}
            style={styles.startClub}
          >
            <Text style={styles.startClubText}>+ Start a club</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );

  function GuideCards({
    clubs: list,
    roles: myRoles,
    checklist: counts,
    email,
  }: {
    clubs: Club[];
    roles: { club_id: string; role: ClubRole }[] | null;
    checklist: Record<string, HostChecklistCounts | null>;
    email: string | undefined;
  }) {
    return (
      <>
        {list.length === 0 && guides.isVisible('welcome') ? (
          <TipCard testID="welcome-card" tag="New here?" title="Welcome to MahjHero" onDismiss={() => guides.dismiss('welcome')}>
            <TipText>Organizing games? Start a club below, then schedule a game and invite your players.</TipText>
            <TipText>
              {`Joining a club? Enter its club code above, or ask its organizer to invite ${email || 'the email you signed in with'}.`}
            </TipText>
          </TipCard>
        ) : null}
        {list
          .filter((c) => myRoles?.some((r) => r.club_id === c.id && r.role === 'host'))
          .map((club) => {
            const key = hostChecklistKey(club.id);
            const c = counts[club.id];
            if (!c || !guides.isVisible(key)) return null;
            const { steps, complete } = hostChecklist(c);
            if (complete) return null;
            const next = steps.find((s) => !s.done);
            const action =
              next?.key === 'game'
                ? { label: 'Add a game', onPress: () => router.push(`/clubs/${club.id}/events/new`) }
                : next?.key === 'invite'
                  ? { label: 'Invite players', onPress: () => router.push(`/clubs/${club.id}`) }
                  : undefined;
            return (
              <TipCard key={key} testID={`host-checklist-${club.id}`} tag="Getting started" title={`Get ${club.name} going`} action={action} onDismiss={() => guides.dismiss(key)}>
                {steps.map((s) => (
                  <TipText key={s.key}>
                    {s.done ? '✓ ' : '○ '}
                    <Text>{s.label}</Text>
                  </TipText>
                ))}
              </TipCard>
            );
          })}
        {myRoles !== null && !myRoles.some((r) => canInvite(r.role)) && guides.isVisible('player-intro') ? (
          <TipCard testID="player-intro" tag="New here?" title="How MahjHero works" onDismiss={() => guides.dismiss('player-intro')}>
            <TipText>1. Join a club with its code, or accept an invite.</TipText>
            <TipText>2. Open a club to find a game and take a seat.</TipText>
            <TipText>3. Your games show up here under My games.</TipText>
          </TipCard>
        ) : null}
      </>
    );
  }
}

function ModeButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.modeButton, selected && styles.modeSelected]}
    >
      {icon}
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16, paddingHorizontal: 16, maxWidth: layout.contentMaxWidth, width: '100%', alignSelf: 'center' },
  section: { gap: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sub: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700], flexShrink: 1 },
  modeTrack: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3 },
  modeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32,
    paddingHorizontal: 10, borderRadius: radius.pill,
  },
  modeSelected: { backgroundColor: colors.bg },
  modeText: { fontFamily: type.bodyBold, fontSize: 12, color: colors.neutral[700] },
  modeTextSelected: { color: colors.accent[800] },
  errorBlock: { gap: 8, alignItems: 'flex-start' },
  emptyCard: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.neutral[400], borderRadius: 20,
    padding: 20, gap: 10, alignItems: 'center',
  },
  startClub: {
    minHeight: 56, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: colors.neutral[400], alignItems: 'center', justifyContent: 'center',
  },
  startClubText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
});
```

Notes for the implementer:
- `GuideCards` is declared inside `HomeScreen` only to reach `guides`/`router`; if lint complains about components defined in render, lift it to module scope and pass `guides` and `router` as props.
- Check `Screen`'s real props (`components/Screen.tsx`): if `contentStyle` already applies max width/padding, drop the duplicates from `styles.container`.
- `useFocusEffect` needs a navigation container; the Expo Router stack provides it. In tests it is mocked.
- The player-intro copy changes because "Find a game below / Tap Join" no longer describes Home.

- [ ] **Step 6: Point `/` at Home**

In `app/index.tsx`, change `if (hasSession) return '/clubs';` to `if (hasSession) return '/home';` and update its doc comment ("gets Home").

- [ ] **Step 7: Run tests**

Run: `npm test -- app/__tests__/home.test.tsx app/__tests__/index.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/home.tsx app/index.tsx app/__tests__/home.test.tsx app/__tests__/index.test.ts components/home/HomeHeader.tsx components/home/HomeSwitch.tsx
git commit -m "feat(home): new Home screen with My games and Clubs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Remove the tab bar and the old dashboard

**Files:**
- Delete: `app/clubs/index.tsx`, `components/TabBar.tsx`, `components/ClubChips.tsx`, `app/__tests__/clubs.test.tsx`, `app/__tests__/your-games.test.tsx`, `app/__tests__/guides-dashboard.test.tsx`, `app/__tests__/tab-bar.test.tsx`, `app/__tests__/nav-glyph-parity.test.tsx`
- Modify: `components/Screen.tsx`, every file listed by `grep -rl "TabBar" app components lib e2e`, every `'/clubs'` dashboard link, `lib/dashboard.ts`, `lib/dashboard.test.ts`, `components/__tests__/dashboard-parts.test.tsx`

- [ ] **Step 1: Delete the old screen and tab bar**

```bash
git rm app/clubs/index.tsx components/TabBar.tsx components/ClubChips.tsx app/__tests__/clubs.test.tsx app/__tests__/your-games.test.tsx app/__tests__/guides-dashboard.test.tsx app/__tests__/tab-bar.test.tsx app/__tests__/nav-glyph-parity.test.tsx
```

- [ ] **Step 2: Remove `tabBar` from `Screen` and every caller**

In `components/Screen.tsx`, delete the `tabBar?: ReactNode` prop, its doc comment and the JSX that renders it. Then:

```bash
grep -rln "TabBar\|tabBar=" app components lib
```

In each file: delete the `import TabBar ...` line and the `tabBar={<TabBar ... />}` prop. In test files, delete any assertion about the tab bar and any mock whose only purpose was TabBar (e.g. `usePathname` comments that say "TabBar's own Club tab route"; keep the mock if something else uses it).

- [ ] **Step 3: Repoint dashboard links to `/home`**

Replace `'/clubs'` (exact, the dashboard — NOT `/clubs/new` or `/clubs/${id}`) with `'/home'` in:
- `app/clubs/new.tsx:86`
- `app/clubs/[id]/broadcasts.tsx:25`
- `app/clubs/[id]/index.tsx:274`
- `app/clubs/[id]/broadcast.tsx:29`
- `app/clubs/[id]/events/[eventId]/index.tsx:878` and `:1023`
- `app/clubs/[id]/events/new.tsx:331` and `:363`

Re-run `grep -rn "'/clubs'" app components lib` — expected: no results. Update any test asserting those routes (`grep -rn "'/clubs'" app/__tests__`) to expect `'/home'`.

- [ ] **Step 4: Prune `lib/dashboard.ts`**

Delete `ALL_CLUBS`, `Chip`, `buildChips`, `inScope`, `DashboardRow`, `buildDashboardRows` and their tests in `lib/dashboard.test.ts`. Keep `glyphForClub`, `ClubGlyph`, `initialsFrom`, `pendingGameInvites`, `needAFourthAlerts`, `FourthAlert`. Keep `headerScope`/`HeaderScope` only if `components/DashboardHeader.tsx` still imports them (it is used by the club page and venues). Remove the stale comment reference to `buildDashboardRows` in `lib/events.ts` (near `fetchUpcomingEvents`) — reword it to "Home's need-a-fourth alerts (lib/use-needs-you.ts)". In `components/__tests__/dashboard-parts.test.tsx`, delete the `ClubChips` cases.

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. Any remaining failure is a test importing a deleted module or asserting tab-bar presence — fix it by removing that assertion, not by restoring the module.

- [ ] **Step 6: Commit**

```bash
git add -A app components lib   # review `git status` first: only files under app/, components/, lib/ you touched
git status --short              # confirm CLAUDE.md, docs/product-brief.md, "social media assets/" are NOT staged
git commit -m "refactor: remove the tab bar and the old dashboard

Home replaces both. Alerts and Profile move to Home's header; dashboard
back-links now go to /home.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add -A app components lib` is scoped to those three directories, none of which contains the never-commit files; still check `git status` before committing.)

---

### Task 11: Club code on Start a club and the club page

**Files:**
- Modify: `app/clubs/new.tsx`, `app/clubs/[id]/index.tsx`
- Test: `app/__tests__/clubs-new.test.tsx`, a new `app/__tests__/club-code.test.tsx`

**Interfaces:**
- Consumes: `ClubCodeField` (Task 7), `createClub(name, rhythm, code)`, `setClubCode`, `canInvite` (organizer check), `fetchClub` (returns `code` now).

- [ ] **Step 1: Write failing tests**

In `app/__tests__/clubs-new.test.tsx`, add (following the file's existing render/mocks for `createClub`):

```tsx
it('passes the optional club code to createClub', async () => {
  createClub.mockResolvedValueOnce({ clubId: 'c1', error: null });
  render(<NewClubScreen />);
  fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'North Side' } });
  fireEvent.change(screen.getByLabelText('Club code (optional)'), { target: { value: 'north side' } });
  fireEvent.click(screen.getByRole('button', { name: /Create|Start/ }));
  await waitFor(() => expect(createClub).toHaveBeenCalledWith('North Side', '', 'NORTHSIDE'));
});

it('shows a taken code error', async () => {
  createClub.mockResolvedValueOnce({ clubId: null, error: 'That code is taken.' });
  render(<NewClubScreen />);
  fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'North Side' } });
  fireEvent.change(screen.getByLabelText('Club code (optional)'), { target: { value: 'OAK2' } });
  fireEvent.click(screen.getByRole('button', { name: /Create|Start/ }));
  expect(await screen.findByText('That code is taken.')).toBeTruthy();
});
```

Match the real accessibility labels of the existing name field and submit button in `app/clubs/new.tsx` (read the file; adjust `'Club name'` and the button regex accordingly).

Create `app/__tests__/club-code.test.tsx` by copying the mock setup from the top of an existing club-page test (`grep -l "clubs/\[id\]/index" app/__tests__/*` — likely `club-board.test.tsx`), then:

```tsx
it('shows the club code to every member', async () => {
  // role 'member'
  render(<ClubScreen />);
  expect(await screen.findByText('Club code: TEST1')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change club code' })).toBeNull();
});

it('lets a host change the code', async () => {
  // role 'host'
  setClubCode.mockResolvedValueOnce({ code: 'NEWCODE', error: null });
  render(<ClubScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
  fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'newcode' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
  expect(await screen.findByText('Club code: NEWCODE')).toBeTruthy();
  expect(setClubCode).toHaveBeenCalledWith('c1', 'NEWCODE');
});

it('shows the taken error', async () => {
  // role 'host'
  setClubCode.mockResolvedValueOnce({ code: null, error: 'That code is taken.' });
  render(<ClubScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
  fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'OAK2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
  expect(await screen.findByText('That code is taken.')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- app/__tests__/clubs-new.test.tsx app/__tests__/club-code.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement on Start a club**

In `app/clubs/new.tsx`: add `const [code, setCode] = useState('');`, render below the rhythm field:

```tsx
<ClubCodeField
  label="Club code (optional)"
  value={code}
  onChangeText={setCode}
  helper="People type this on Home to join. Leave blank and we'll make one. You can change it later."
/>
```

and change the submit call to `createClub(name, rhythm, code)`. The existing error display already shows `createError`.

- [ ] **Step 4: Implement on the club page**

In `app/clubs/[id]/index.tsx`, near the club's name/header block, add state `const [codeDraft, setCodeDraft] = useState<string | null>(null); const [codeError, setCodeError] = useState<string | null>(null); const [codeSaving, setCodeSaving] = useState(false);` and render:

```tsx
<View style={styles.codeRow}>
  <Text style={styles.codeText}>{`Club code: ${club.code}`}</Text>
  {canManage && codeDraft === null ? (
    <Button
      variant="ghost"
      big={false}
      onPress={() => { setCodeDraft(club.code); setCodeError(null); }}
      accessibilityLabel="Change club code"
    >
      Change
    </Button>
  ) : null}
</View>
{codeDraft !== null ? (
  <View style={styles.codeEdit}>
    <ClubCodeField label="New club code" value={codeDraft} onChangeText={setCodeDraft} error={codeError} />
    <Button
      disabled={codeSaving}
      onPress={async () => {
        setCodeSaving(true);
        const { code, error } = await setClubCode(club.id, codeDraft);
        setCodeSaving(false);
        if (error || !code) { setCodeError(error); return; }
        setClub({ ...club, code });
        setCodeDraft(null);
      }}
      accessibilityLabel="Save code"
    >
      Save code
    </Button>
    <Button variant="ghost" big={false} onPress={() => setCodeDraft(null)} accessibilityLabel="Cancel">
      Cancel
    </Button>
  </View>
) : null}
```

Use the screen's existing names: its club state setter (e.g. `setClub`) and its existing organizer flag (the file gates "Create an invite link" on a `canInvite(role)`-derived boolean — see the comment near line 137; reuse that boolean as `canManage`). Add `codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }`, `codeText: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text }`, `codeEdit: { gap: 8 }` to its `StyleSheet`.

- [ ] **Step 5: Run tests**

Run: `npm test -- app/__tests__/clubs-new.test.tsx app/__tests__/club-code.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/new.tsx "app/clubs/[id]/index.tsx" app/__tests__/clubs-new.test.tsx app/__tests__/club-code.test.tsx
git commit -m "feat(clubs): choose a club code on creation; hosts can change it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Visual baselines and a real-browser check

**Files:**
- Modify: `e2e/visual.spec.ts`, `e2e/session.ts`, `e2e/visual.spec.ts-snapshots/*`

- [ ] **Step 1: Record the pre-existing failures on `main`**

```bash
git stash list  # must be empty of your work; everything is committed
git switch main && npx supabase db reset --local && npx playwright test 2>&1 | grep -E "✘|failed" > /private/tmp/claude-501/-Users-anandsubramanian-Documents-Claude-Projects-MahjongApp/8f2b364b-79ef-40ae-a79a-af7f0dc5012a/scratchpad/main-visual-failures.txt; git switch feat/home-redesign
```

- [ ] **Step 2: Replace the dashboard tests with Home tests**

In `e2e/visual.spec.ts`:
- `clubs at ${vp.name}` → `home empty at ${vp.name}`: `page.goto('/home')`, anchor `await expect(page.getByText('Join a club')).toBeVisible()`, capture `home-empty-${vp.name}.png`.
- `clubs list with a club at ${vp.name}` → `home my games at ${vp.name}`: `page.goto('/home')`, anchor on the seeded game's title (the seeded Riverside event's title from `seedClubWithEvent` in `e2e/session.ts`), capture `home-my-games-${vp.name}.png`. Remove its chip-row / "New club" / "Start a club" anchors.
- Add in the seeded block: `home calendar at ${vp.name}` — `page.goto('/home')`, click `getByRole('button', { name: 'Calendar' })`, anchor `getByRole('button', { name: 'Next month' })`, capture `home-calendar-${vp.name}.png`; and `home clubs at ${vp.name}` — click `getByRole('button', { name: /^Clubs/ })`, anchor `getByText('Riverside Mah Jongg')`, capture `home-clubs-${vp.name}.png`.
- Delete the `clubs-guides-*` test (the guides now render on Home's Clubs view; add `home-guides-${vp.name}.png` only if the old test's purpose — showing TipCards — still applies: navigate to `/home`, switch to Clubs, anchor on the checklist `testID`).
- Remove comments/anchors that reference the tab bar (e.g. the `messages at` comment about the tab-bar "Messages" label collision — the heading is unique now, so anchor on it if simpler).
- In `e2e/session.ts`, remove anything that exists only for TabBar/ClubChips.

- [ ] **Step 3: Run, compare, re-baseline**

```bash
npx supabase db reset --local && npx playwright test --update-snapshots
npx playwright test 2>&1 | grep -E "✘|failed"
```

Expected: no failures after update. Then diff: open each changed baseline under `e2e/visual.spec.ts-snapshots/` (`git diff --stat e2e/visual.spec.ts-snapshots`) and look at a handful of non-Home ones — the only change should be the tab bar gone from the bottom. Any other visible change on a non-Home screen is a regression to investigate. Compare against `main-visual-failures.txt`: tests failing on `main` for their own reasons (time picker, open seating, profile email) will now be re-baselined too — state that in the PR description.

- [ ] **Step 4: Reset the local DB**

```bash
npx supabase db reset --local && npm run test:db
```

Expected: all pgTAP pass (visual runs leave rows that break fixture suites).

- [ ] **Step 5: Real-browser check**

Follow the memory note on local browser QA: build the static web export (`npm run build:web`), serve `dist/` (add a `.claude/launch.json` config if none exists, e.g. `npx serve dist -l 8081`), sign in via magic-link fragment against local Supabase, and use `preview_start` + the browser tools at 375×812:
- Home shows header (icon, wordmark, bell, avatar), switch, My games list grouped by week — compare to `docs/superpowers/specs/assets/2026-09-29-club-hub-screens.png` (frame 2a).
- Calendar: month card, dots, tap a day, empty-day card.
- Clubs: Join a club with a wrong code → "No club with that code."; with the seeded club's code → lands on the club page.
- No tab bar on any screen.
Take a screenshot of each and keep them for the PR.

- [ ] **Step 6: Commit**

```bash
git add e2e/visual.spec.ts e2e/session.ts e2e/visual.spec.ts-snapshots
git commit -m "test(visual): Home baselines; re-baseline screens without the tab bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: QA Pass checklist, PR

- [ ] **Step 1: Update the QA Pass artifact**

Per `CLAUDE.md`: read the live artifact (`Artifact` action `read`, URL `https://claude.ai/artifact/NczhMYq4AtgBU7URkCChnB`). For every scenario whose steps start from the dashboard, tap a tab-bar tab, rely on the chip row / "New club" tile / "Your games" rows / check-in or "Can't make it" from the dashboard, rewrite those steps against the new Home, using exact copy from the source (`app/home.tsx`, `components/home/*`). Add steps (new `data-id`s, never renumbering existing ones) for: join by code (wrong code, right code, already a member), host changes the club code on the club page, Start a club with and without a code, My games List/Calendar toggle is remembered. Update the per-scenario `data-progress-for` fractions and the footer total. Republish with `url` set to that artifact URL.

- [ ] **Step 2: Push the migrations to prod before merging**

Remind the user (do not run it): the two migrations must be pushed to prod with `npx supabase db push --project-ref tnqofwoqivyhvjnntaau` (and to dev with its ref) before the PR merges. Never `config push`.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/home-redesign
gh pr create --title "Home redesign: My games / Clubs, join by code, no tab bar" --body "$(cat <<'EOF'
Phase 1 of the Design V3 club-hub redesign (spec: docs/superpowers/specs/2026-09-29-home-club-hub-design.md).

- New Home (`/home`): header with Alerts and Profile, "Needs you" stack, My games (list by week / month calendar) and Clubs (join by code, club cards, Start a club).
- Club codes: unique, host-editable; instant join by code with a 10/hour rate limit; removed members can't rejoin by code.
- New RPCs: `my_games`, `my_clubs_next_game`, `join_club_by_code`, `set_club_code`; `create_club` takes an optional code.
- Removed: the old dashboard and the global tab bar. Other screens are intentionally unreachable in places until later phases.
- Visual baselines re-shot (tab bar gone everywhere); includes baselines that were already failing on main.

**Before merging:** `db push` both migrations to prod.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then bind the PR with the ccd_pr tools and report CI status to the user.
