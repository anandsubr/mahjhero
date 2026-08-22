# Clubs & Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can create a club, invite people to it by link or CSV, and see who is in it — turning the profile screen from a dead end into the second stop after signing in.

**Architecture:** Three new tables (`clubs`, `club_members`, `club_invites`) with RLS scoped by membership, a `lib/clubs.ts` data layer following the established never-rejects convention, and four screens built from the existing design-system primitives. Signed-in members land on their clubs list rather than their profile.

**Tech Stack:** Expo/React Native with expo-router, Supabase (Postgres, RLS), Vitest + `@testing-library/react`, pgTAP, Playwright.

**Spec:** [../specs/2026-08-01-mahjhero-v1-design.md](../specs/2026-08-01-mahjhero-v1-design.md) — subsystem B (clubs & membership).
**Design:** `.superpowers/design/1C-variant.html` — the "Your clubs", "Start a club", and club-detail screens.

## Global Constraints

Every task's requirements implicitly include these.

- **Three platforms from one codebase:** iOS, Android, and web. A change that builds on one but not the others is incomplete.
- **The web target is permanent.** Invite links must open a working app in a browser. Installing is an upgrade, never a prerequisite.
- **The database owns authorization.** RLS is enabled on every table in the same migration that creates it, and every table gets a `grant` matching its policies — no wider. RLS policies *filter* access; they do not *grant* it.
- **`lib/` functions never reject.** They catch internally, `console.error('<fn> failed', cause)` the original, and return `GENERIC_ERROR` from `lib/constants.ts` through an `{ error: string | null }` channel. Callers must consume that channel.
- **Every write uses `.select(...)` and treats zero rows as failure.** PostgREST answers 204 with `error: null` when an update matches nothing, which is what an RLS denial looks like. Without this a blocked write reports success.
- **18pt is the app-wide minimum body text size.** Helper/secondary text at 16pt is the sole exception.
- **Accessibility props are required** — `accessibilityLabel`, `accessibilityRole`, `accessibilityState` on every interactive control.
- **Every screen wraps its content in `<Screen>`**, which constrains the column to 440px and centres it on wide viewports.
- **Every redirect target must have a route file.** `app/__tests__/redirect-routes.test.ts` enforces this; a redirect with no route is a 404 on web.
- **Roles:** `host` (everything, plus club settings and role changes), `co_organizer` (everything except changing roles or deleting the club), `member` (view roster and events, manage own bookings).
- **Visibility:** `public` means an invite link admits instantly; `private` means the link raises a join request the host approves.

## Scope

**In:** clubs table and membership, roles, the clubs list, creating a club, club detail showing the roster, invite links (both visibility modes), CSV import, and widening the `profiles` read policy to club co-members.

**Out — deferred with reasons:**

- **The events half of the club screen.** The design's club detail shows "This week", need-a-4th alerts, and Join buttons. Those need events and seating, which are Plans 3 and 4. This plan builds the roster half and leaves a clearly-marked space.
- **Friends and Messages.** Designed on the canvas, but V3 on the roadmap.
- **Guest/non-member attendance.** Deferred indefinitely per the roadmap.
- **Leaving or removing members, and transferring host.** Real, but each needs its own decisions about what happens to that member's bookings — which do not exist yet. Plan 5 or later.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_create_clubs.sql` | All three tables, their RLS, grants, and the widened profiles policy |
| `supabase/tests/database/clubs.test.sql` | pgTAP: RLS isolation between clubs, role permissions, invite acceptance |
| `lib/clubs.ts` | Data layer — fetch, create, invite, accept, import. Never rejects. |
| `lib/clubs.test.ts` | Pure-function tests (slug generation, CSV parsing, role predicates) |
| `app/clubs/index.tsx` | The clubs list, and the new landing route |
| `app/clubs/new.tsx` | Start a club |
| `app/clubs/[id].tsx` | Club detail — roster |
| `app/join/[token].tsx` | Invite acceptance |
| `app/__tests__/clubs.test.tsx` | Component tests for the new screens |

---

### Task 1: Clubs schema, RLS, and the widened profiles policy

**Files:**
- Create: `supabase/migrations/<timestamp>_create_clubs.sql`
- Create: `supabase/tests/database/clubs.test.sql`

**Interfaces:**
- Consumes: `public.profiles` and its `skill_level` enum from the foundation plan.
- Produces: tables `public.clubs`, `public.club_members`, `public.club_invites`; enums `public.club_role` (`host`/`co_organizer`/`member`), `public.club_visibility` (`public`/`private`), `public.member_status` (`active`/`removed`); and the helper `public.is_club_member(uuid)`.

**Why a `security definer` helper.** The obvious policy — "you may read a club if you are in `club_members` for it" — recurses when `club_members`' own policy asks the same question. `is_club_member` breaks the recursion by running with definer rights and a pinned `search_path`. This is the standard Supabase pattern and skipping it produces an infinite-recursion error at query time, not at migration time.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/clubs.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(15);

-- Structure
select has_table('public', 'clubs', 'clubs table exists');
select has_table('public', 'club_members', 'club_members table exists');
select has_table('public', 'club_invites', 'club_invites table exists');

-- Two members, two clubs. Alice hosts Riverside; Bob hosts Oakfield.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield Tiles', 'oakfield',
   'public', 'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

-- RLS: a member sees their own club and not the other one.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  1,
  'a member can read their own club'
);

select is(
  (select count(*)::int from public.clubs
   where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read a club they do not belong to'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read another club roster'
);

-- The widened profiles policy: co-members are visible, strangers are not.
select is(
  (select count(*)::int from public.profiles
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'a member can still read their own profile'
);

select is(
  (select count(*)::int from public.profiles
   where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'a member cannot read the profile of someone in no shared club'
);

-- A member may not promote themselves.
select throws_ok(
  $$update public.club_members set role = 'host'
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
      and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a member cannot change roles directly'
);

-- ---------------------------------------------------------------------------
-- WRITE isolation. Read isolation above is only half the property, and the
-- missing half is where the real breach lives: an earlier version of this
-- schema had `with check (auth.uid() = profile_id)` on club_members, which
-- constrains who the row is about and nothing about which club or what role.
-- Any authenticated user holding a club's uuid could insert themselves into
-- it as host. Every assertion below would have caught that; none of the read
-- assertions did.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.club_members (club_id, profile_id, role)
    values ('c2c2c2c2-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001', 'host')$$,
  '42501',
  null,
  'a member cannot insert themselves into another club'
);

select throws_ok(
  $$insert into public.club_members (club_id, profile_id, role)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'host')$$,
  '42501',
  null,
  'a member cannot insert a membership even in their own club'
);

select throws_ok(
  $$insert into public.club_invites (club_id, token, invited_by)
    values ('c2c2c2c2-0000-0000-0000-000000000002', 'sneaky-token',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member cannot create an invite to another club'
);

with attempted as (
  update public.clubs set name = 'Hijacked'
  where id = 'c2c2c2c2-0000-0000-0000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a member cannot update another club'
);

-- create_club is the only way a membership is created, and it seats the
-- caller as host in the same transaction — so a club can never exist with
-- no host, which would make it unreachable by every membership-scoped policy.
--
-- The call has to be its own statement. Calling create_club() inside the
-- WHERE clause of a query against club_members cannot work: the query's
-- snapshot is taken before the volatile function runs, so it can never see
-- the row that function just inserted. That is a command-visibility rule,
-- not an RLS effect — it fails the same way as superuser.
create temporary table created_club on commit drop as
  select public.create_club('Test Club', 'Tuesdays') as id;

select is(
  (select count(*)::int
   from public.club_members
   where club_id = (select id from created_club)
     and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and role = 'host'),
  1,
  'create_club seats the caller as host'
);

select is(
  (select count(*)::int from public.clubs
   where id = (select id from created_club)),
  1,
  'the creator can read the club they just made'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx supabase test db --local`
Expected: FAIL — `relation "public.clubs" does not exist`

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new create_clubs
```

Write into the generated file:

```sql
create type public.club_role as enum ('host', 'co_organizer', 'member');
create type public.club_visibility as enum ('public', 'private');
create type public.member_status as enum ('active', 'removed');

create table public.clubs (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  slug             text not null unique,
  -- Free text like "Thursday evenings". The design asks for it on the create
  -- screen and shows it on club cards; it is a human hint, never parsed.
  rhythm           text not null default '',
  visibility       public.club_visibility not null default 'private',
  timezone         text not null default 'America/New_York',
  reminder_offsets int[] not null default '{1440, 120}',
  -- Nullable with `set null`: deleting an account must not fail, and must not
  -- take the club with it. Without this, the cascade from auth.users into
  -- profiles aborts here, so account deletion is impossible for anyone who
  -- has ever created a club.
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.club_members (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.club_role not null default 'member',
  status     public.member_status not null default 'active',
  joined_at  timestamptz not null default now(),
  unique (club_id, profile_id)
);

create table public.club_invites (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs(id) on delete cascade,
  token         text not null unique,
  email         text,
  display_name  text,
  skill_level   public.skill_level,
  invited_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '30 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index club_members_profile_idx on public.club_members (profile_id);
-- token already has a btree from its unique constraint; club_id does not,
-- and the cascade from clubs would otherwise sequential-scan.
create index club_invites_club_idx on public.club_invites (club_id);

-- Breaks policy recursion: club_members' own policy would otherwise ask the
-- same question it is answering. Definer rights plus a pinned search_path.
create function public.is_club_member(target_club uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = target_club
      and profile_id = auth.uid()
      and status = 'active'
  );
$$;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_invites enable row level security;

create policy clubs_select_member on public.clubs
  for select using (public.is_club_member(id));

-- No insert policy on clubs either: `create_club` below is the only way in,
-- so a club and its host row are always created together. A club with no
-- member is unreachable by anyone — every policy here is membership-scoped —
-- and its unique slug would be squatted permanently.

create policy clubs_update_host on public.clubs
  for update using (
    exists (
      select 1 from public.club_members m
      where m.club_id = clubs.id and m.profile_id = auth.uid()
        and m.role = 'host' and m.status = 'active'
    )
  );

create policy club_members_select_member on public.club_members
  for select using (public.is_club_member(club_id));

-- NOTE: there is deliberately NO insert policy and NO insert grant on
-- club_members. Memberships are created only by `create_club` below and by
-- `accept_club_invite` (Task 3), both `security definer`.
--
-- The obvious policy — `with check (auth.uid() = profile_id)` — is a
-- cross-tenant breach: it constrains WHO the row is about and says nothing
-- about WHICH club or WHAT role, so any authenticated user holding a club's
-- uuid could insert themselves into it as host. Club uuids are not secret;
-- every invitee learns one. Do not add that policy back.

create policy club_invites_select_organizer on public.club_invites
  for select using (
    exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

create policy club_invites_insert_organizer on public.club_invites
  for insert with check (
    exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

/*
 * Creates a club and seats the caller as its host, atomically.
 *
 * security definer because there is no insert policy on either table — that
 * is the point. A client-side two-write version would need an insert policy
 * on club_members, and the only workable shape for one
 * (`with check (auth.uid() = profile_id)`) lets anybody join any club as
 * host. Doing it here means memberships can only ever be created by code
 * that decides both the club and the role.
 *
 * RLS does not protect this function, so it validates its own inputs.
 */
create function public.create_club(club_name text, club_rhythm text default '')
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

  -- Suffix rather than collide: two clubs may legitimately share a name, and
  -- surfacing a raw unique-violation to the member helps nobody.
  insert into public.clubs (name, slug, rhythm, created_by)
  values (
    trim(club_name),
    base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    trim(coalesce(club_rhythm, '')),
    caller
  )
  returning id into new_id;

  insert into public.club_members (club_id, profile_id, role)
  values (new_id, caller, 'host');

  return new_id;
end;
$$;

grant execute on function public.create_club(text, text) to authenticated;

-- RLS filters; it does not grant. Without these the policies are unreachable
-- and every query fails with "permission denied".
--
-- Note what is NOT granted: no insert on clubs or club_members (definer
-- functions own that), and no delete anywhere (removing members and deleting
-- clubs is a later plan, and both need decisions about what happens to that
-- member's bookings).
grant select, update on public.clubs to authenticated;
grant select on public.club_members to authenticated;
grant select, insert on public.club_invites to authenticated;

-- Widen the profiles read policy: a member may see co-members, so rosters can
-- show names and skill levels. Strangers stay invisible.
drop policy if exists profiles_select_own on public.profiles;

create policy profiles_select_self_or_comember on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1
      from public.club_members mine
      join public.club_members theirs on theirs.club_id = mine.club_id
      where mine.profile_id = auth.uid() and mine.status = 'active'
        and theirs.profile_id = profiles.id and theirs.status = 'active'
    )
  );
```

- [ ] **Step 4: Apply the migration locally**

Run: `npx supabase db reset`
Expected: all migrations apply, ending with `create_clubs`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx supabase test db --local`
Expected: PASS — 15 assertions in `clubs.test.sql`, and the existing 11 still pass.

- [ ] **Step 6: Prove the isolation test can fail**

Temporarily change `clubs_select_member`'s `using` clause to `true`, run `npx supabase db reset && npx supabase test db --local`, and confirm the "cannot read a club they do not belong to" assertion fails. Restore and re-apply.

This is the assertion that proves one club cannot see another's data. A test that passes with RLS effectively disabled is worth nothing.

- [ ] **Step 7: Push to the hosted dev project**

Run: `printf 'y\n' | npx supabase db push --linked`
Expected: reports `create_clubs` applied.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: add clubs, membership, and invites with RLS"
```

---

### Task 2: The clubs data layer

**Files:**
- Create: `lib/clubs.ts`
- Create: `lib/clubs.test.ts`

**Interfaces:**
- Consumes: `supabase` from `lib/supabase.ts`, `GENERIC_ERROR` from `lib/constants.ts`, `SkillLevel` from `lib/profile.ts`.
- Produces: types `Club`, `ClubMember`, `ClubRole`, `ClubVisibility`; and `slugify`, `canInvite`, `parseRoster`, `fetchMyClubs`, `fetchClub`, `fetchRoster`, `createClub`, `createInvite`, `acceptInvite`, `importRoster`.

- [ ] **Step 1: Write the failing tests**

Create `lib/clubs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canInvite, parseRoster, slugify } from './clubs';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Riverside Mah Jongg')).toBe('riverside-mah-jongg');
  });

  it('strips punctuation rather than encoding it', () => {
    expect(slugify("Nana's Tiles!")).toBe('nanas-tiles');
  });

  it('collapses runs of separators', () => {
    expect(slugify('Oakfield   --  Tiles')).toBe('oakfield-tiles');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('canInvite', () => {
  it('allows a host', () => {
    expect(canInvite('host')).toBe(true);
  });

  it('allows a co-organizer', () => {
    expect(canInvite('co_organizer')).toBe(true);
  });

  it('refuses a plain member', () => {
    expect(canInvite('member')).toBe(false);
  });
});

describe('parseRoster', () => {
  it('reads name, email, and skill level from a header row', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,beginner';
    expect(parseRoster(csv)).toEqual({
      rows: [
        { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: 'beginner' },
      ],
      errors: [],
    });
  });

  it('tolerates columns in any order and ignores unknown ones', () => {
    const csv = 'Email,Nickname,Name\njane@example.com,jd,Jane Doe';
    expect(parseRoster(csv).rows).toEqual([
      { display_name: 'Jane Doe', email: 'jane@example.com', skill_level: null },
    ]);
  });

  it('reports the row number for a bad email rather than dropping it', () => {
    const csv = 'name,email\nJane Doe,not-an-email';
    const result = parseRoster(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: 'Not a valid email address' }]);
  });

  it('rejects a file with no email column', () => {
    const result = parseRoster('name\nJane Doe');
    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(/email column/i);
  });

  it('ignores an unrecognised skill level rather than guessing', () => {
    const csv = 'name,email,skill\nJane Doe,jane@example.com,expert';
    expect(parseRoster(csv).rows[0].skill_level).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- clubs`
Expected: FAIL — cannot resolve `./clubs`

- [ ] **Step 3: Write the pure functions**

Create `lib/clubs.ts` with this first half:

```ts
import { GENERIC_ERROR } from './constants';
import type { SkillLevel } from './profile';
import { supabase } from './supabase';

export type ClubRole = 'host' | 'co_organizer' | 'member';
export type ClubVisibility = 'public' | 'private';

export type Club = {
  id: string;
  name: string;
  slug: string;
  rhythm: string;
  visibility: ClubVisibility;
  timezone: string;
};

export type ClubMember = {
  profile_id: string;
  role: ClubRole;
  display_name: string;
  skill_level: SkillLevel | null;
};

export type RosterRow = {
  display_name: string;
  email: string;
  skill_level: SkillLevel | null;
};

export type RosterError = { row: number; message: string };

const CLUB_COLUMNS = 'id, name, slug, rhythm, visibility, timezone';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

/** URL-safe form of a club name. May return '' — callers must handle that. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Only hosts and co-organizers may invite. Plain members may not. */
export function canInvite(role: ClubRole): boolean {
  return role === 'host' || role === 'co_organizer';
}

/**
 * Parses a roster CSV into rows plus per-row errors.
 *
 * Returns errors rather than throwing, and never silently drops a row: a host
 * who imports forty members and receives thirty-four has no way to find the
 * missing six. Row numbers are 1-based and count the header, so they match
 * what a spreadsheet shows.
 */
export function parseRoster(csv: string): { rows: RosterRow[]; errors: RosterError[] } {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'The file is empty' }] };
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  const nameIdx = header.indexOf('name');
  const skillIdx = header.indexOf('skill');

  if (emailIdx === -1) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'No email column found in the header row' }],
    };
  }

  const rows: RosterRow[] = [];
  const errors: RosterError[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((c) => c.trim());
    const email = cells[emailIdx] ?? '';

    if (!EMAIL_PATTERN.test(email)) {
      errors.push({ row: i + 1, message: 'Not a valid email address' });
      continue;
    }

    const rawSkill = skillIdx === -1 ? '' : (cells[skillIdx] ?? '').toLowerCase();
    const skill = SKILL_LEVELS.find((s) => s === rawSkill) ?? null;

    rows.push({
      display_name: nameIdx === -1 ? '' : (cells[nameIdx] ?? ''),
      email,
      skill_level: skill,
    });
  }

  return { rows, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- clubs`
Expected: PASS — 13 tests

- [ ] **Step 5: Add the data functions**

Append to `lib/clubs.ts`:

```ts
/**
 * Every function below never rejects. They catch internally, log the original
 * cause for diagnosis, and report failure through `{ error }` — the screens
 * await them directly and an escaping rejection would strand the member with
 * a spinner and no message.
 */

export async function fetchMyClubs(): Promise<Club[] | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select(CLUB_COLUMNS)
      .order('name');

    if (error) {
      console.error('fetchMyClubs failed', error);
      return null;
    }
    return data as Club[];
  } catch (cause) {
    console.error('fetchMyClubs failed', cause);
    return null;
  }
}

export async function fetchClub(clubId: string): Promise<Club | null> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select(CLUB_COLUMNS)
      .eq('id', clubId)
      .single();

    if (error) {
      console.error('fetchClub failed', error);
      return null;
    }
    return data as Club;
  } catch (cause) {
    console.error('fetchClub failed', cause);
    return null;
  }
}

export async function fetchRoster(clubId: string): Promise<ClubMember[] | null> {
  try {
    const { data, error } = await supabase
      .from('club_members')
      .select('profile_id, role, profiles ( display_name, skill_level )')
      .eq('club_id', clubId)
      .eq('status', 'active');

    if (error) {
      console.error('fetchRoster failed', error);
      return null;
    }

    return (data ?? []).map((row: Record<string, unknown>) => {
      const profile = row.profiles as { display_name: string; skill_level: SkillLevel | null };
      return {
        profile_id: row.profile_id as string,
        role: row.role as ClubRole,
        display_name: profile?.display_name ?? '',
        skill_level: profile?.skill_level ?? null,
      };
    });
  } catch (cause) {
    console.error('fetchRoster failed', cause);
    return null;
  }
}

/**
 * Creates the club and seats the caller as its host.
 *
 * Goes through the `create_club` database function rather than two client
 * writes, because there is deliberately no insert policy on `clubs` or
 * `club_members`. The only workable client-side policy for the membership
 * insert — `with check (auth.uid() = profile_id)` — constrains who the row is
 * about and nothing about which club or what role, so anyone holding a club's
 * uuid could insert themselves into it as host. Letting the function decide
 * both means that is not expressible from a client at all.
 *
 * It also makes the two inserts one transaction, so a club can never exist
 * without a host — which would leave it unreachable by every
 * membership-scoped policy and its unique slug squatted permanently.
 *
 * Note there is no `userId` argument: the function reads `auth.uid()` itself,
 * so a caller cannot create a club on someone else's behalf.
 */
export async function createClub(
  name: string,
  rhythm: string,
): Promise<{ clubId: string | null; error: string | null }> {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { clubId: null, error: 'Give the club a name.' };
  }
  if (slugify(trimmed).length === 0) {
    return { clubId: null, error: 'That name needs at least one letter or number.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_club', {
      club_name: trimmed,
      club_rhythm: rhythm.trim(),
    });

    if (error || !data) {
      console.error('createClub failed', error);
      return { clubId: null, error: GENERIC_ERROR };
    }
    return { clubId: data as string, error: null };
  } catch (cause) {
    console.error('createClub failed', cause);
    return { clubId: null, error: GENERIC_ERROR };
  }
}

export async function createInvite(
  clubId: string,
  userId: string,
  target?: { email: string; display_name: string; skill_level: SkillLevel | null },
): Promise<{ token: string | null; error: string | null }> {
  try {
    const token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    const { data, error } = await supabase
      .from('club_invites')
      .insert({
        club_id: clubId,
        token,
        invited_by: userId,
        email: target?.email ?? null,
        display_name: target?.display_name ?? null,
        skill_level: target?.skill_level ?? null,
      })
      .select('token')
      .single();

    if (error || !data) {
      console.error('createInvite failed', error);
      return { token: null, error: GENERIC_ERROR };
    }
    return { token: data.token as string, error: null };
  } catch (cause) {
    console.error('createInvite failed', cause);
    return { token: null, error: GENERIC_ERROR };
  }
}

/**
 * Redeems an invite token.
 *
 * The RPC is a `security definer` function (Task 3) because the member is by
 * definition not yet in the club, so no membership-scoped policy can let them
 * read the invite or write the membership row.
 */
export async function acceptInvite(
  token: string,
): Promise<{ clubId: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_club_invite', {
      invite_token: token,
    });

    if (error) {
      console.error('acceptInvite failed', error);
      return { clubId: null, error: GENERIC_ERROR };
    }
    if (!data) {
      return {
        clubId: null,
        error: 'That invite link has expired or has already been used.',
      };
    }
    return { clubId: data as string, error: null };
  } catch (cause) {
    console.error('acceptInvite failed', cause);
    return { clubId: null, error: GENERIC_ERROR };
  }
}

export async function importRoster(
  clubId: string,
  userId: string,
  rows: RosterRow[],
): Promise<{ created: number; error: string | null }> {
  try {
    const invites = rows.map((row) => ({
      club_id: clubId,
      token: `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      invited_by: userId,
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
    return { created: data?.length ?? 0, error: null };
  } catch (cause) {
    console.error('importRoster failed', cause);
    return { created: 0, error: GENERIC_ERROR };
  }
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test && npx tsc --noEmit`
Expected: 108 Vitest tests pass (95 existing + 13 new); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/clubs.ts lib/clubs.test.ts
git commit -m "feat: add the clubs data layer"
```

---

### Task 3: The invite-acceptance RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_accept_club_invite.sql`
- Modify: `supabase/tests/database/clubs.test.sql`

**Interfaces:**
- Consumes: the tables from Task 1.
- Produces: `public.accept_club_invite(invite_token text) returns uuid` — the club id on success, null on a bad, expired, or spent token.

**Why this is a database function.** Someone redeeming an invite is not yet a member, so every membership-scoped policy excludes them: they cannot read the invite row, and they cannot insert their own membership with the right club. A `security definer` function is the only way to do this without opening a policy hole that would let anyone join any club.

**Because it runs with definer rights, RLS does not protect it.** It must validate the token itself — existence, expiry, and prior use — as its first statements.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/tests/database/clubs.test.sql`, before `select * from finish();`, and change `plan(15)` to `plan(19)`:

```sql
-- Invite acceptance. Bob redeems an invite to Alice's club.
set local role postgres;
reset request.jwt.claims;

insert into public.club_invites (club_id, token, invited_by, expires_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'good-token',
   'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'stale-token',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 day');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  public.accept_club_invite('good-token'),
  'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
  'a valid token returns the club id'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'redeeming an invite creates the membership'
);

select is(
  public.accept_club_invite('good-token'),
  null,
  'a token cannot be redeemed twice'
);

select is(
  public.accept_club_invite('stale-token'),
  null,
  'an expired token is refused'
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx supabase test db --local`
Expected: FAIL — `function public.accept_club_invite(unknown) does not exist`

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new accept_club_invite
```

Write into the generated file:

```sql
/*
 * Redeems an invite token and returns the club id, or null if the token is
 * unknown, expired, or already spent.
 *
 * security definer because the caller is by definition not yet a member, so
 * every membership-scoped policy excludes them — they can neither read the
 * invite nor insert their own membership row.
 *
 * RLS therefore does NOT protect this function. It validates the token itself,
 * as its first statements, and the row lock closes the window where two taps
 * on the same link could both succeed.
 */
create function public.accept_club_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.club_invites%rowtype;
  caller uuid := auth.uid();
begin
  if caller is null then
    return null;
  end if;

  select * into invite
  from public.club_invites
  where token = invite_token
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.expires_at < now() then
    return null;
  end if;

  insert into public.club_members (club_id, profile_id, role)
  values (invite.club_id, caller, 'member')
  on conflict (club_id, profile_id) do nothing;

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  return invite.club_id;
end;
$$;

grant execute on function public.accept_club_invite(text) to authenticated;
```

- [ ] **Step 4: Apply and run the tests**

Run: `npx supabase db reset && npx supabase test db --local`
Expected: PASS — 19 assertions in `clubs.test.sql`.

- [ ] **Step 5: Prove the expiry check can fail**

Temporarily delete the `or invite.expires_at < now()` clause, re-apply with `npx supabase db reset`, and confirm the "expired token is refused" assertion fails. Restore and re-apply.

- [ ] **Step 6: Push to the hosted dev project**

Run: `printf 'y\n' | npx supabase db push --linked`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: add the invite-acceptance function"
```

---

### Task 4: The clubs list, and moving the landing route

**Files:**
- Create: `app/clubs/index.tsx`
- Modify: `app/index.tsx`
- Modify: `app/profile.tsx`

**Interfaces:**
- Consumes: `fetchMyClubs`, `Club` from `lib/clubs.ts`; `useSession` from `lib/session.ts`; `Screen`, `Button`, `Card` from `components/`.
- Produces: the `/clubs` route, which becomes where signed-in members land.

**Why the landing route moves.** `app/index.tsx` currently sends signed-in members to `/profile`, which has nowhere to go — the member fills in their name and stops. The design lands them on their clubs. Profile becomes reachable from there instead of being the destination.

- [ ] **Step 1: Build the clubs list**

Create `app/clubs/index.tsx`:

```tsx
import { Link, Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { fetchMyClubs } from '../../lib/clubs';
import type { Club } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

export default function ClubsScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyClubs().then((result) => {
      if (cancelled) return;
      if (result === null) setLoadFailed(true);
      else setClubs(result);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen>
        <Text style={styles.heading}>Your clubs</Text>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const list = clubs ?? [];

  return (
    <Screen>
      <Text style={styles.heading}>Your clubs</Text>

      {list.length === 0 ? (
        <>
          <Text style={styles.help}>
            You are not in a club yet. Start one and invite the people you
            already play with.
          </Text>
          <Button
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start a club"
            >Start a club</Button>
        </>
      ) : (
        <>
          {list.map((club) => (
            <Link key={club.id} href={`/clubs/${club.id}`} asChild>
              <Card accessibilityRole="button" accessibilityLabel={club.name}>
                <Text style={styles.clubName}>{club.name}</Text>
                {club.rhythm.length > 0 ? (
                  <Text style={styles.help}>{club.rhythm}</Text>
                ) : null}
              </Card>
            </Link>
          ))}
          <Button
            variant="secondary"
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start another club"
            >Start another club</Button>
        </>
      )}

      <Link href="/profile" style={styles.linkRow}>
        <Text style={styles.link}>Your profile</Text>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  clubName: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  linkRow: { marginTop: space[6] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
```

- [ ] **Step 2: Move the landing route**

In `app/index.tsx`, change the signed-in destination from `/profile` to `/clubs`:

```tsx
  return <Redirect href={session ? '/clubs' : '/sign-in'} />;
```

- [ ] **Step 3: Give profile a way back**

In `app/profile.tsx`, add a back link above the heading, matching the notifications screen's pattern. Import `ChevronLeftIcon` from `../components/icons` and `useRouter` from `expo-router`, then render before the `<Text style={styles.heading}>`:

```tsx
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor}
      >Clubs</Button>}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
      />
```

Profile is no longer the landing screen, so without this it becomes the dead end that notifications used to be.

- [ ] **Step 4: Verify the build and the route test**

Run: `npm test && npx tsc --noEmit && npx expo export --platform web`
Expected: tests pass, typecheck clean, web build succeeds. `/clubs/new` and `/clubs/[id]` do not exist yet, so those pushes 404 until Tasks 5 and 6 — the build must still succeed.

- [ ] **Step 5: Commit**

```bash
git add app/clubs app/index.tsx app/profile.tsx
git commit -m "feat: add the clubs list and land signed-in members there"
```

---

### Task 5: Start a club

**Files:**
- Create: `app/clubs/new.tsx`

**Interfaces:**
- Consumes: `createClub` from `lib/clubs.ts`; `useSession`; `Screen`, `Button`, `TextField`, `ErrorBanner`.
- Produces: the `/clubs/new` route.

- [ ] **Step 1: Build the screen**

Create `app/clubs/new.tsx`:

```tsx
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import { ChevronLeftIcon } from '../../components/icons';
import { createClub } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, type } from '../../lib/theme';

export default function NewClubScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [rhythm, setRhythm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  async function onCreate() {
    if (!session || saving) return;
    setError(null);
    setSaving(true);
    const { clubId, error: createError } = await createClub(name, rhythm);
    setSaving(false);
    if (createError || !clubId) {
      setError(createError ?? 'Could not create the club.');
      return;
    }
    router.replace(`/clubs/${clubId}`);
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor}
      >Clubs</Button>}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
      />

      <Text style={styles.heading}>Start a club</Text>
      <Text style={styles.help}>
        A club is just a name and a rhythm. Invite people once it exists.
      </Text>

      <TextField
        label="Club name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        placeholder="Oakfield Tiles"
        accessibilityLabel="Club name"
      />

      <TextField
        label="When you usually play"
        value={rhythm}
        onChangeText={setRhythm}
        placeholder="Thursday evenings"
        accessibilityLabel="When you usually play"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Button
        onPress={onCreate}
        disabled={saving || name.trim().length === 0}
        accessibilityLabel="Create the club"
      >{saving ? 'Creating…' : 'Create the club'}</Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
```

- [ ] **Step 2: Verify**

Run: `npm test && npx tsc --noEmit && npx expo export --platform web`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add app/clubs/new.tsx
git commit -m "feat: add the start-a-club screen"
```

---

### Task 6: Club detail with the roster and an invite link

**Files:**
- Create: `app/clubs/[id].tsx`

**Interfaces:**
- Consumes: `fetchClub`, `fetchRoster`, `createInvite`, `canInvite`, `Club`, `ClubMember` from `lib/clubs.ts`.
- Produces: the `/clubs/[id]` route.

**Scope note.** The design's club screen also shows "This week", need-a-4th alerts, and Join buttons. Those need events and seating, which are Plans 3 and 4. Build the roster half only, and leave the events section out entirely rather than stubbing it — an empty "This week" heading with nothing under it reads as a bug.

- [ ] **Step 1: Build the screen**

Create `app/clubs/[id].tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import Tag from '../../components/Tag';
import { ChevronLeftIcon } from '../../components/icons';
import { canInvite, createInvite, fetchClub, fetchRoster } from '../../lib/clubs';
import type { Club, ClubMember } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

export default function ClubDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;
    Promise.all([fetchClub(id), fetchRoster(id)]).then(([c, r]) => {
      if (cancelled) return;
      if (c === null || r === null) setLoadFailed(true);
      else {
        setClub(c);
        setRoster(r);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, id]);

  if (loading || !ready) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (loadFailed || !club) {
    return (
      <Screen>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const me = roster.find((m) => m.profile_id === userId);
  const mayInvite = me ? canInvite(me.role) : false;

  async function onInvite() {
    if (!session || !id) return;
    setError(null);
    const { token, error: inviteError } = await createInvite(id, session.user.id);
    if (inviteError || !token) {
      setError(inviteError ?? GENERIC_ERROR);
      return;
    }
    setInviteUrl(`${window.location.origin}/join/${token}`);
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor}
      >Clubs</Button>}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
      />

      <Text style={styles.heading}>{club.name}</Text>
      {club.rhythm.length > 0 ? (
        <Text style={styles.help}>{club.rhythm}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>
        {roster.length} {roster.length === 1 ? 'member' : 'members'}
      </Text>

      {roster.map((member) => (
        <Card key={member.profile_id}>
          <View style={styles.row}>
            <Text style={styles.memberName}>
              {member.display_name.trim().length > 0
                ? member.display_name
                : 'Invited — not signed in yet'}
            </Text>
            {member.role !== 'member' ? (
              <Tag label={member.role === 'host' ? 'Host' : 'Co-organizer'} />
            ) : null}
          </View>
          {member.skill_level ? (
            <Text style={styles.help}>
              {member.skill_level.charAt(0).toUpperCase() +
                member.skill_level.slice(1)}
            </Text>
          ) : null}
        </Card>
      ))}

      {mayInvite ? (
        <>
          <Button
            variant="secondary"
            onPress={onInvite}
            accessibilityLabel="Create an invite link"
      >Create an invite link</Button>
          {inviteUrl ? (
            <Card>
              <Text style={styles.help}>
                Share this link. It works for 30 days.
              </Text>
              <Text style={styles.inviteUrl} selectable>
                {inviteUrl}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  memberName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  inviteUrl: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accentColor,
  },
});
```

- [ ] **Step 2: Verify**

Run: `npm test && npx tsc --noEmit && npx expo export --platform web`
Expected: all pass.

`window.location.origin` is web-only. That is correct for this task — the invite URL is shared as a web link and opens in a browser, which is the platform contract the spec sets. A native-safe origin is Task 8's concern if it proves necessary; note it in your report rather than guessing at one now.

- [ ] **Step 3: Commit**

```bash
git add "app/clubs/[id].tsx"
git commit -m "feat: add club detail with roster and invite links"
```

---

### Task 7: Accepting an invite

**Files:**
- Create: `app/join/[token].tsx`

**Interfaces:**
- Consumes: `acceptInvite` from `lib/clubs.ts`; `useSession`.
- Produces: the `/join/[token]` route — the target of every invite link.

**The signed-out case matters most.** An invite link is usually opened by someone who has never used the app. They must be able to sign in and still land in the club, not lose the invite along the way. Store the token, send them to sign-in, and redeem it when they come back.

- [ ] **Step 1: Build the screen**

Create `app/join/[token].tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { acceptInvite } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, type } from '../../lib/theme';

/**
 * Where an invite link lands.
 *
 * Most people opening one have never used MahjHero. They arrive signed out, so
 * the token is parked in storage, they sign in, and `app/index.tsx` sends them
 * back here to redeem it. Losing the invite across sign-in would mean asking
 * the host to send another.
 */
export const PENDING_INVITE_KEY = 'mahjhero.pending-invite';

export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, loading } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(true);

  useEffect(() => {
    if (loading || !token) return;

    if (!session) {
      globalThis.localStorage?.setItem(PENDING_INVITE_KEY, token);
      router.replace('/sign-in');
      return;
    }

    let cancelled = false;
    acceptInvite(token).then(({ clubId, error: acceptError }) => {
      if (cancelled) return;
      globalThis.localStorage?.removeItem(PENDING_INVITE_KEY);
      if (acceptError || !clubId) {
        setError(acceptError ?? 'That invite link is no longer valid.');
        setWorking(false);
        return;
      }
      router.replace(`/clubs/${clubId}`);
    });

    return () => {
      cancelled = true;
    };
  }, [loading, session, token, router]);

  if (error) {
    return (
      <Screen>
        <Text style={styles.heading}>That link did not work</Text>
        <ErrorBanner message={error} />
        <Button
          onPress={() => router.replace('/clubs')}
          accessibilityLabel="Go to your clubs"
          >Go to your clubs</Button>
      </Screen>
    );
  }

  if (!working) return <Redirect href="/clubs" />;

  return (
    <Screen>
      <View style={styles.centered}>
        <ActivityIndicator
          color={colors.accentColor}
          accessibilityLabel="Joining the club"
        />
        <Text style={styles.message}>Joining the club…</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  message: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
});
```

- [ ] **Step 2: Redeem a parked invite after sign-in**

In `app/index.tsx`, check for a parked token before sending a signed-in member to their clubs:

```tsx
  if (session) {
    const pending = globalThis.localStorage?.getItem('mahjhero.pending-invite');
    if (pending) return <Redirect href={`/join/${pending}`} />;
    return <Redirect href="/clubs" />;
  }
  return <Redirect href="/sign-in" />;
```

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit && npx expo export --platform web`
Expected: all pass, including `app/__tests__/redirect-routes.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add "app/join/[token].tsx" app/index.tsx
git commit -m "feat: add invite acceptance, surviving sign-in"
```

---

### Task 8: Tests for the new screens

**Files:**
- Create: `app/__tests__/clubs.test.tsx`
- Modify: `e2e/visual.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: component coverage for the clubs list and club detail, plus visual baselines for the clubs list.

- [ ] **Step 1: Write the component tests**

Create `app/__tests__/clubs.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClubsScreen from '../clubs/index';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

const fetchMyClubs = vi.fn();

vi.mock('../../lib/clubs', () => ({
  fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
}));

describe('clubs list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a way to start one when the member has no clubs', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.getByText('Start a club')).toBeTruthy();
  });

  it('lists the clubs a member belongs to', async () => {
    fetchMyClubs.mockResolvedValueOnce([
      { id: 'c1', name: 'Riverside Mah Jongg', slug: 'riverside',
        rhythm: 'Thursday evenings', visibility: 'private', timezone: 'America/New_York' },
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
  });

  it('shows an error rather than an empty list when the load fails', async () => {
    fetchMyClubs.mockResolvedValueOnce(null);
    render(<ClubsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/not in a club yet/i)).toBeNull();
  });
});
```

The third test is the one that matters. A failed load and an empty roster are different states, and rendering "you are not in a club yet" after a network failure would tell a member their clubs are gone.

- [ ] **Step 2: Run and prove they can fail**

Run: `npm test -- clubs.test`
Expected: PASS — 3 tests.

Then mutate: make the `loadFailed` branch render the normal list instead of the error, confirm the third test fails, and revert. Record the output.

- [ ] **Step 3: Add a visual baseline for the clubs list**

In `e2e/visual.spec.ts`, inside the `signed in` describe, add alongside the existing profile and notifications cases:

```ts
    test(`clubs at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/clubs');
      await expect(page.getByText('Your clubs')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`clubs-${vp.name}.png`, {
        fullPage: true,
      });
    });
```

A freshly minted test user belongs to no clubs, so this captures the empty state — which is what every new member sees first and therefore worth defending.

- [ ] **Step 4: Generate and inspect the baselines**

Run: `npx playwright test --update-snapshots`

**Open both new PNGs and look at them.** Confirm the empty-state copy and the "Start a club" button are present and not truncated, and that at 1440px the column is centred rather than stretched. A baseline captured from a broken render encodes the bug as correct.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run test:contract && npx supabase test db --local && npm run test:visual && npx tsc --noEmit`
Expected: 111 Vitest, 6 contract, 30 pgTAP, 8 visual, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add app/__tests__/clubs.test.tsx e2e/visual.spec.ts e2e/visual.spec.ts-snapshots
git commit -m "test: cover the clubs list in component and visual layers"
```

---

### Task 9: CSV roster import

**Files:**
- Move: `app/clubs/[id].tsx` → `app/clubs/[id]/index.tsx`
- Create: `app/clubs/[id]/import.tsx`

**Interfaces:**
- Consumes: `parseRoster`, `importRoster`, `RosterRow`, `RosterError` from `lib/clubs.ts`.
- Produces: the `/clubs/[id]/import` route.

**Why this is in V1 rather than deferred.** The host is living in a spreadsheet today. If they cannot get that roster in, they never start — the import is the on-ramp, not a convenience. `parseRoster` and `importRoster` already exist and are tested; without a screen calling them they are dead code.

**Why the file moves.** expo-router cannot have both `app/clubs/[id].tsx` and a `app/clubs/[id]/` directory. Moving the screen to `[id]/index.tsx` serves the same route and makes room for `[id]/import.tsx`. Move it with `git mv` so history follows.

**Validate before writing anything.** A host who imports forty rows and gets thirty-four has no way to find the missing six. Parse, show every row and every error, and only write when they confirm.

- [ ] **Step 1: Move the club detail screen**

```bash
mkdir -p "app/clubs/[id]"
git mv "app/clubs/[id].tsx" "app/clubs/[id]/index.tsx"
```

Fix its relative imports — it is one level deeper now, so `../../components/…` becomes `../../../components/…` and `../../lib/…` becomes `../../../lib/…`.

Run: `npx tsc --noEmit`
Expected: clean. If it is not, the import depths are wrong.

- [ ] **Step 2: Build the import screen**

Create `app/clubs/[id]/import.tsx`:

```tsx
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TextField from '../../../components/TextField';
import { ChevronLeftIcon } from '../../../components/icons';
import { importRoster, parseRoster } from '../../../lib/clubs';
import type { RosterError, RosterRow } from '../../../lib/clubs';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

export default function ImportRosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [errors, setErrors] = useState<RosterError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  function onPreview() {
    setError(null);
    const result = parseRoster(csv);
    setRows(result.rows);
    setErrors(result.errors);
  }

  async function onImport() {
    if (!session || !id || !rows || importing) return;
    setError(null);
    setImporting(true);
    const { created, error: importError } = await importRoster(
      id,
      session.user.id,
      rows,
    );
    setImporting(false);
    if (importError) {
      setError(importError);
      return;
    }
    router.replace(`/clubs/${id}?imported=${created}`);
  }

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={<ChevronLeftIcon color={colors.accentColor}
      >Club</Button>}
        onPress={() => router.push(`/clubs/${id}`)}
        accessibilityLabel="Back to the club"
      />

      <Text style={styles.heading}>Import a roster</Text>
      <Text style={styles.help}>
        Paste your spreadsheet, including the header row. It needs an email
        column; name and skill are used if present.
      </Text>

      <TextField
        label="Roster"
        value={csv}
        onChangeText={(value) => {
          setCsv(value);
          setRows(null);
          setErrors([]);
        }}
        placeholder={'name,email,skill\nJane Doe,jane@example.com,beginner'}
        multiline
        accessibilityLabel="Roster CSV"
      />

      <Button
        variant="secondary"
        onPress={onPreview}
        disabled={csv.trim().length === 0}
        accessibilityLabel="Check the file"
      >Check the file</Button>

      {rows !== null ? (
        <>
          <Text style={styles.sectionTitle}>
            {rows.length} {rows.length === 1 ? 'person' : 'people'} ready
            {errors.length > 0
              ? `, ${errors.length} ${errors.length === 1 ? 'row' : 'rows'} skipped`
              : ''}
          </Text>

          {rows.map((row) => (
            <Card key={row.email}>
              <Text style={styles.name}>
                {row.display_name.trim().length > 0 ? row.display_name : row.email}
              </Text>
              <Text style={styles.help}>
                {row.email}
                {row.skill_level ? ` · ${row.skill_level}` : ''}
              </Text>
            </Card>
          ))}

          {errors.map((rowError) => (
            <Card key={`error-${rowError.row}`}>
              <Text style={styles.rowError}>
                Row {rowError.row}: {rowError.message}
              </Text>
            </Card>
          ))}

          {rows.length > 0 ? (
            <Button`}
              onPress={onImport}
              disabled={importing}
              accessibilityLabel={`Invite these ${rows.length} people`}
      >{importing ? 'Importing…' : `Invite these ${rows.length}</Button>
          ) : null}
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  rowError: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[800],
  },
});
```

- [ ] **Step 3: Link to it from club detail**

In `app/clubs/[id]/index.tsx`, inside the `mayInvite` block alongside the invite-link button:

```tsx
          <Button
            variant="secondary"
            onPress={() => router.push(`/clubs/${id}/import`)}
            accessibilityLabel="Import a roster from a spreadsheet"
            >Import a roster</Button>
```

- [ ] **Step 4: Add a component test for the preview gate**

Append to `app/__tests__/clubs.test.tsx`:

```tsx
import ImportRosterScreen from '../clubs/[id]/import';

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
    importRoster: vi.fn(async () => ({ created: 2, error: null })),
  };
});

describe('roster import', () => {
  it('reports skipped rows instead of dropping them silently', async () => {
    render(<ImportRosterScreen />);
    const field = screen.getByLabelText('Roster CSV');
    fireEvent.change(field, {
      target: { value: 'name,email\nJane,jane@example.com\nBad,not-an-email' },
    });
    fireEvent.click(screen.getByText('Check the file'));
    expect(await screen.findByText(/1 person ready, 1 row skipped/)).toBeTruthy();
    expect(screen.getByText(/Row 3: Not a valid email address/)).toBeTruthy();
  });
});
```

Add `fireEvent` to the `@testing-library/react` import at the top of the file. Note this test uses the *real* `parseRoster` via `importOriginal`, so it exercises the actual parsing rather than a mock of it — the point is that a bad row surfaces to the host.

- [ ] **Step 5: Run everything**

Run: `npm test && npx tsc --noEmit && npx expo export --platform web`
Expected: 112 Vitest tests pass; typecheck clean; the web build succeeds and `app/__tests__/redirect-routes.test.ts` still passes.

- [ ] **Step 6: Commit**

```bash
git add app/clubs app/__tests__/clubs.test.tsx
git commit -m "feat: add CSV roster import with a preview that shows skipped rows"
```

---

## What this plan does not cover

- **The events half of the club screen** — "This week", need-a-4th alerts, Join buttons. Plans 3 and 4.
- **Leaving a club, removing a member, transferring host.** Each needs decisions about what happens to that member's bookings, which do not exist yet.
- **Role changes.** The schema supports `co_organizer`, and `canInvite` honours it, but nothing promotes anyone yet. Needs a `security definer` function like `accept_club_invite`, since a member cannot be trusted to write their own role.
- **The public/private distinction in the join flow.** The column exists and the spec defines the behaviour — public admits instantly, private raises a request the host approves — but this plan treats every invite link as instant. Join requests need a host-facing approval queue, which is its own screen.
- **Sending invite emails.** `club_invites` stores an address, and CSV import creates a row per person, but nothing delivers anything. Email delivery arrives with the notifications plan; until then a host shares the link themselves.
- **File picking for CSV import.** Task 9 takes a paste rather than a file. A native file picker means `expo-document-picker` and three platform paths; pasting works everywhere today and is what a host copying out of Google Sheets does anyway. Revisit if anyone asks.
