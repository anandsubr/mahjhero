# Club Hub + Games (Club-Hub Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old club page with the Design V3 club hub — cover header with five labelled sections (Board, Games, Photos, Members, Ranks), a Games section with a personal calendar subscription, club settings with cover photo/colour, and pull-to-refresh.

**Architecture:** Three migrations (club_games RPC; cover columns + bucket + RPCs; calendar feed tokens), one new edge function (`calendar-feed`, ICS builder unit-tested with vitest), client libs, an Expo Router group `app/clubs/[id]/(hub)/` whose `_layout.tsx` draws `ClubHubHeader` above a `<Slot/>`, and section screens built on a shared `HubSection` scroller. Existing content (club board, roster/invites, leaderboard) is moved into sections, not rewritten.

**Tech Stack:** Expo Router 57 / React Native 0.86 / react-native-web, Supabase (Postgres, pgTAP, Storage, Deno edge functions), vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-club-hub-games-design.md`. Design: `docs/design/club-hub-v3/Club Hub.dc.html` + README "Club hub (1b–1e)". Phase-1 plan for conventions: `docs/superpowers/plans/2026-09-29-home-club-hub.md`.

## Global Constraints

- Import `Text`/`TextInput` from `components/Text`, never from `react-native` (enforced by a test).
- Colours only from `lib/theme.ts`; white text may be `'#fff'`. Fonts: `type.heading` (Caprasimo) for the club name; Figtree elsewhere. Hit targets ≥ 44pt. New icons: Lucide-style SVG in `components/icons.tsx`, stroke 2.75.
- Migrations are forward-only; never edit an applied migration (all phase-1 migrations are applied on dev and prod). New security-definer functions: `set search_path = public`, guard `auth.uid()`, `revoke execute ... from public, anon` (and `authenticated` for internal ones), `grant execute ... to authenticated` for client RPCs, and add client RPCs to BOTH allowlists in `supabase/tests/database/portable/grants.test.sql`.
- New raise messages must be added to the self-audit exemption list in `lib/bookings.test.ts` (~line 419) with an accurate "raised by" reason.
- Visibility rule for games (same as phase 1): `e.game_mode = 'open_play' or public.is_club_organizer(e.club_id) or public.event_has_my_active_booking(e.id)`.
- Cover colours (exact keys → tokens): `accent2_800 → colors.accent2[800]` (default), `accent2_700 → colors.accent2[700]`, `accent_700 → colors.accent[700]`, `accent_800 → colors.accent[800]`, `neutral_800 → colors.neutral[800]`.
- Section order and labels: **Board · Games · Photos · Members · Ranks**; routes `/clubs/[id]/board|games|photos|members|ranks`; Games is the default.
- Copy (exact): "Club code: {CODE}", "Share", "Copied", "Join {Club name} on MahjHero with code {CODE}", "All", "Upcoming", "Past", "No games here yet.", "No past games.", "Add to calendar", "New game", "Invited", "Not going", "Copy link", "Add it in your calendar app under ‘Subscribe to calendar’.", "Could not get your calendar link.", "Reset calendar link", "Photos and files are coming soon.", "Could not load this club.", "Retry".
- Game creation stays host-only (`role === 'host'`); settings are organizer-only (`host` or `co_organizer`).
- Local Supabase only for tests (`npx supabase db reset --local`, `npm run test:db`); never `db push`/`config push`/`--linked` except in Task 13 (dev only, by the controller).
- Git: stage by explicit path only; never stage `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npm test`, `npm run test:db`, `npx tsc --noEmit`.

## Deviation from the spec (update the spec in Task 3)

`my_calendar_feed_url()` / `reset_calendar_feed()` return the **token**, not a URL (SQL can't know the functions URL). They are named `my_calendar_feed_token()` / `reset_calendar_feed_token()`; the client builds `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-feed?token=${token}`.

## File Structure

**Create**
- `supabase/migrations/20260930100000_club_games.sql`, `20260930100100_club_covers.sql`, `20260930100200_calendar_feeds.sql`
- `supabase/tests/database/fixtures/club_games.test.sql`, `club_covers.test.sql`, `calendar_feeds.test.sql`
- `supabase/functions/calendar-feed/index.ts`, `ics.ts`, `esm-supabase-js.d.ts` (copy from `send-club-invite`), `__tests__/ics.test.ts`
- `lib/club-hub.ts` (+ test) — cover colours, share text, section list
- `lib/club-cover.ts` (+ test) — upload/set/remove cover, set colour, signed URL
- `lib/calendar-feed.ts` (+ test) — token RPCs, URL building, open/copy
- `components/hub/ClubHubHeader.tsx`, `SectionButtons.tsx`, `HubSection.tsx`, `CalendarLinkSheet.tsx`
- `components/ClubBoard.tsx` (extracted), `components/ClubLeaderboard.tsx` (extracted), `components/ClubMembers.tsx` (extracted)
- `app/clubs/[id]/(hub)/_layout.tsx`, `games.tsx`, `board.tsx`, `photos.tsx`, `members.tsx`, `ranks.tsx`
- `app/clubs/[id]/settings.tsx`
- tests: `components/__tests__/club-hub.test.tsx`, `app/__tests__/club-games.test.tsx`, `app/__tests__/club-settings.test.tsx`

**Modify**
- `lib/my-games.ts` (`fetchClubGames`, `MyStatus` += `'invited'`, `notes`), `components/GameRow.tsx` ("Invited" tag), `components/icons.tsx` (+ `SettingsIcon`, `ShareIcon`, `ImageIcon`, `MessageSquareIcon`), `components/Screen.tsx` (`onRefresh`), `app/home.tsx` (refresh; club links → `/games`), `components/home/JoinClubCard.tsx` callers, `lib/use-needs-you.ts` (club-invite accept → `/games`), `app/messages/club/[threadId]/index.tsx` (use `ClubBoard`), `app/profile.tsx` (Reset calendar link), `supabase/config.toml`, `supabase/tests/database/portable/grants.test.sql`, `lib/bookings.test.ts`, `e2e/*`.
- `app/clubs/[id]/index.tsx` → redirect to `games`; `app/clubs/[id]/leaderboard.tsx` → redirect to `ranks`.

---

### Task 1: `club_games` RPC

**Files:** Create `supabase/migrations/20260930100000_club_games.sql`, `supabase/tests/database/fixtures/club_games.test.sql`; Modify `supabase/tests/database/portable/grants.test.sql`.

**Interfaces:** Produces `public.club_games(target_club uuid, from_ts timestamptz, to_ts timestamptz)` returning `(event_id, club_id, club_name, title, game_mode, seating_mode, starts_at, ends_at, club_timezone, venue_name, seats_taken int, capacity int, capped boolean, my_status text, waitlist_position int, table_label text, notes text)`; `my_status ∈ {'hosting','going','waitlisted','invited','not'}`. Raises `42501` for non-members.

- [ ] **Step 1: Write the failing pgTAP test.** Model the fixture on `supabase/tests/database/fixtures/home_feeds.test.sql` (copy its users/clubs/venues/events/booking inserts, which are known to satisfy the schema, including `event_tables.club_id` and `invite_holds_seat`). Scenarios, one assertion each (use `plan(12)`):
  1. As member M of club C: open game with no booking → row with `my_status = 'not'`.
  2. Confirmed booking → `'going'` and `table_label` set.
  3. Waitlisted booking → `'waitlisted'` and `waitlist_position = 1`.
  4. Unanswered invite (status `invited`, `invite_holds_seat = true`) → `'invited'`.
  5. Game created by M → `'hosting'`.
  6. Invite-only game M isn't booked on and doesn't organize → absent.
  7. Invite-only game M is booked on → present.
  8. Cancelled game → absent.
  9. Game in another club → absent (only `target_club` rows).
  10. Window `[from, to)` excludes a game at exactly `to`.
  11. `notes` comes through (set `notes = 'Bring a card'` on one event).
  12. As a non-member of C: `throws_ok($$select * from public.club_games(C, now(), now() + interval '1 day')$$, '42501', null, ...)`.
- [ ] **Step 2: Run it** — `npx supabase db reset --local && npm run test:db`; expect FAIL (function missing).
- [ ] **Step 3: Write the migration.**

```sql
/*
 * club_games: one club's games for the club hub's Games section
 * (club-hub phase 2). Same row shape as my_games (20260929100100) plus
 * notes, and a my_status for every game ('not' when the caller has no
 * part in it). Visibility matches events_select_member: open games, plus
 * invite-only games the caller organizes or is booked on.
 */
create function public.club_games(target_club uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id uuid, club_id uuid, club_name text, title text,
  game_mode public.game_mode, seating_mode public.seating_mode,
  starts_at timestamptz, ends_at timestamptz, club_timezone text, venue_name text,
  seats_taken int, capacity int, capped boolean, my_status text,
  waitlist_position int, table_label text, notes text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_member(target_club) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  return query
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.club_id = target_club
      and b.status in ('confirmed', 'waitlisted', 'invited')
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
      when m.status = 'waitlisted' then 'waitlisted'
      when m.status = 'invited' then 'invited'
      else 'not'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label,
    e.notes
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.club_id = target_club
    and e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  order by e.starts_at;
end;
$$;
revoke execute on function public.club_games(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.club_games(uuid, timestamptz, timestamptz) to authenticated;
```

Check `event_has_my_active_booking` counts `invited` bookings as active (read its definition in `20260924104000_invite_reads_and_privacy.sql`); if it doesn't, test 4 with an invite-only game will fail — keep test 4 on an open game and note it. If `bookings.club_id` doesn't exist, drop that filter.

- [ ] **Step 4:** Add `'public.club_games(uuid, timestamptz, timestamptz)',` to both allowlists in `grants.test.sql`. Add `'not a member'` to the `lib/bookings.test.ts` exemption list only if that exact message is new (grep migrations first).
- [ ] **Step 5:** `npx supabase db reset --local && npm run test:db` → all pass; `npm test -- lib/bookings.test.ts` passes.
- [ ] **Step 6: Commit** (`feat(db): club_games feed for the club hub Games section`).

---

### Task 2: Club cover columns, bucket and RPCs

**Files:** Create `supabase/migrations/20260930100100_club_covers.sql`, `supabase/tests/database/fixtures/club_covers.test.sql`; Modify `grants.test.sql`, `lib/bookings.test.ts`.

**Interfaces:** `clubs.cover_path text null`, `clubs.cover_color text not null default 'accent2_800'` (checked). `public.set_club_cover(target_club uuid, new_path text) returns text` (returns the previous path, or null; `new_path` null removes). `public.set_club_cover_color(target_club uuid, new_color text) returns void`. Bucket `club-covers` (private), path `{club_id}/{uuid}.jpg`.

- [ ] **Step 1: Failing pgTAP** (`plan(11)`): default colour is `accent2_800`; check constraint refuses `'pink'` (23514); host `set_club_cover_color(C, 'accent_700')` works; member refused (42501); `set_club_cover(C, C || '/x.jpg')` as host returns null and stores the path; second call returns the previous path; path not prefixed by the club id → `invalid_path` (22023); `set_club_cover(C, null)` clears; direct `update clubs set cover_color = ...` as authenticated host → 42501; direct `update clubs set cover_path = ...` → 42501; storage policies: a member can `select` from `storage.objects` a row with `bucket_id='club-covers'` and `name = C || '/a.jpg'` (insert that row as superuser first) and a non-member can't (count 0).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Migration.**

```sql
/*
 * Club cover (club-hub phase 2): an optional photo, else a host-chosen
 * colour from five dark palette tokens (white header text stays readable
 * on all of them). Both columns are written only through the organizer
 * RPCs below; direct UPDATEs are frozen like slug and code.
 */
alter table public.clubs
  add column cover_path text,
  add column cover_color text not null default 'accent2_800'
    constraint clubs_cover_color_check
    check (cover_color in ('accent2_800','accent2_700','accent_700','accent_800','neutral_800'));

create or replace function public.clubs_freeze_identity()
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

  if new.code is distinct from old.code then
    raise exception 'club code cannot be changed directly' using errcode = '42501';
  end if;

  if new.cover_path is distinct from old.cover_path
     or new.cover_color is distinct from old.cover_color then
    raise exception 'club cover cannot be changed directly' using errcode = '42501';
  end if;

  return new;
end;
$$;

create function public.set_club_cover(target_club uuid, new_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  if auth.uid() is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_path is not null and new_path not like target_club::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  select cover_path into previous from public.clubs where id = target_club for update;
  update public.clubs set cover_path = new_path where id = target_club;
  return previous;
end;
$$;
revoke execute on function public.set_club_cover(uuid, text) from public, anon;
grant execute on function public.set_club_cover(uuid, text) to authenticated;

create function public.set_club_cover_color(target_club uuid, new_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_organizer(target_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.clubs set cover_color = new_color where id = target_club;
end;
$$;
revoke execute on function public.set_club_cover_color(uuid, text) from public, anon;
grant execute on function public.set_club_cover_color(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('club-covers', 'club-covers', false);

create policy club_covers_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'club-covers'
    and public.is_club_member((storage.foldername(name))[1]::uuid)
  );

create policy club_covers_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'club-covers'
    and public.is_club_organizer((storage.foldername(name))[1]::uuid)
  );

create policy club_covers_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'club-covers'
    and public.is_club_organizer((storage.foldername(name))[1]::uuid)
  );
```

Confirm `is_club_member(uuid)` exists and is granted to `authenticated` (it's used by RLS). Check whether the `storage.objects` fixture insert needs `owner`/other columns locally; follow `message_images_storage.test.sql` if one exists.

- [ ] **Step 4:** grants allowlists: add `'public.set_club_cover(uuid, text)'`, `'public.set_club_cover_color(uuid, text)'`. `lib/bookings.test.ts` exemptions: `'invalid_path'` (raised by set_club_cover — client never sends a foreign path), `'club cover cannot be changed directly'` (clubs_freeze_identity, direct UPDATE only; group with the other freeze entries).
- [ ] **Step 5:** `npx supabase db reset --local && npm run test:db` and `npm test -- lib/bookings.test.ts` pass.
- [ ] **Step 6: Commit** (`feat(db): club cover photo and colour`).

---

### Task 3: Calendar feed tokens

**Files:** Create `supabase/migrations/20260930100200_calendar_feeds.sql`, `supabase/tests/database/fixtures/calendar_feeds.test.sql`; Modify `grants.test.sql`, spec doc.

**Interfaces:** table `calendar_feeds(profile_id uuid pk → profiles on delete cascade, token text unique not null, created_at timestamptz default now())`; `public.my_calendar_feed_token() returns text` (creates on first call, stable afterwards); `public.reset_calendar_feed_token() returns text` (new token). Tokens: `encode(gen_random_bytes(24), 'base64')` made URL-safe (`translate(..., '+/=', '-_')` and strip `=`).

- [ ] **Step 1: Failing pgTAP** (`plan(6)`): first call returns a non-empty token matching `^[A-Za-z0-9_-]{32}$`; second call returns the same token; reset returns a different token; after reset, `my_calendar_feed_token()` returns the new one; authenticated can't `select` from `calendar_feeds` (42501 or 0 rows — assert `throws_ok` with 42501 since privileges are revoked); anon can't call `my_calendar_feed_token()` (42501).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Migration.**

```sql
/*
 * Personal calendar subscription tokens (club-hub phase 2). The
 * calendar-feed edge function serves a member's games as .ics to anyone
 * holding the token (calendar apps can't sign in), so the token is the
 * only key: random, unguessable, and replaceable from Profile.
 */
create table public.calendar_feeds (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from public, anon, authenticated;

create function public.new_calendar_feed_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
$$;
revoke execute on function public.new_calendar_feed_token() from public, anon, authenticated;

create function public.my_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select token into result from public.calendar_feeds where profile_id = caller;
  if result is null then
    insert into public.calendar_feeds (profile_id, token)
    values (caller, public.new_calendar_feed_token())
    on conflict (profile_id) do nothing;
    select token into result from public.calendar_feeds where profile_id = caller;
  end if;
  return result;
end;
$$;
revoke execute on function public.my_calendar_feed_token() from public, anon;
grant execute on function public.my_calendar_feed_token() to authenticated;

create function public.reset_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result text := public.new_calendar_feed_token();
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.calendar_feeds (profile_id, token) values (caller, result)
  on conflict (profile_id) do update set token = excluded.token, created_at = now();
  return result;
end;
$$;
revoke execute on function public.reset_calendar_feed_token() from public, anon;
grant execute on function public.reset_calendar_feed_token() to authenticated;
```

Confirm `pgcrypto`'s `gen_random_bytes` lives in the `extensions` schema locally (`\df extensions.gen_random_bytes`); adjust the schema qualifier if not. 32 chars = 24 bytes base64 with no padding.

- [ ] **Step 4:** grants allowlists: `'public.my_calendar_feed_token()'`, `'public.reset_calendar_feed_token()'`. Update the spec's Section 3 bullet to the token-returning names and client-built URL.
- [ ] **Step 5:** tests pass. **Step 6: Commit** (`feat(db): personal calendar feed tokens`).

---

### Task 4: `calendar-feed` edge function

**Files:** Create `supabase/functions/calendar-feed/ics.ts`, `index.ts`, `esm-supabase-js.d.ts` (copy `send-club-invite/esm-supabase-js.d.ts`), `__tests__/ics.test.ts`; Modify `supabase/config.toml`.

**Interfaces:** `ics.ts` exports `type FeedGame = { eventId: string; clubId: string; title: string | null; gameMode: 'open_play' | 'invite_only'; clubName: string; startsAt: string; endsAt: string; venueName: string; notes: string; status: 'going' | 'waitlisted' | 'invited' | 'hosting' }` and `buildCalendar(games: FeedGame[], now: Date, appUrl: string): string`.

- [ ] **Step 1: Failing vitest** `supabase/functions/calendar-feed/__tests__/ics.test.ts` covering: output starts `BEGIN:VCALENDAR`, has `VERSION:2.0`, `PRODID:-//MahjHero//Calendar//EN`, `X-WR-CALNAME:MahjHero`, ends `END:VCALENDAR`, lines joined with `\r\n`; one `BEGIN:VEVENT` per game; `UID:{eventId}@mahjhero.com`; `DTSTART:20261001T153000Z` for `2026-10-01T15:30:00Z`; SUMMARY `Beginner table · Test Club`, `Open play · Test Club` for blank title open game, `Private game · Test Club` for blank invite-only, `Invited: …` and `Waitlist: …` prefixes; `LOCATION` = venue; `DESCRIPTION` contains the notes and the link `${appUrl}/clubs/${clubId}/events/${eventId}`; text escaping of `,` `;` `\` and newlines (`\n` → `\\n`); lines longer than 75 octets folded with `\r\n ` continuation.
- [ ] **Step 2:** `npx vitest run supabase/functions/calendar-feed` → FAIL.
- [ ] **Step 3: Implement `ics.ts`** (pure TypeScript, no Deno APIs, no imports):

```ts
export type FeedGame = {
  eventId: string;
  clubId: string;
  title: string | null;
  gameMode: 'open_play' | 'invite_only';
  clubName: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  notes: string;
  status: 'going' | 'waitlisted' | 'invited' | 'hosting';
};

function stamp(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function headline(g: FeedGame): string {
  const title = (g.title ?? '').trim();
  if (title) return title;
  return g.gameMode === 'invite_only' ? 'Private game' : 'Open play';
}

const PREFIX: Record<FeedGame['status'], string> = {
  going: '',
  hosting: '',
  invited: 'Invited: ',
  waitlisted: 'Waitlist: ',
};

export function buildCalendar(games: FeedGame[], now: Date, appUrl: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MahjHero//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MahjHero',
  ];
  for (const g of games) {
    const link = `${appUrl}/clubs/${g.clubId}/events/${g.eventId}`;
    const description = [g.notes.trim(), link].filter(Boolean).join('\n\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${g.eventId}@mahjhero.com`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(g.startsAt)}`,
      `DTEND:${stamp(g.endsAt)}`,
      `SUMMARY:${escapeText(`${PREFIX[g.status]}${headline(g)} · ${g.clubName}`)}`,
      `LOCATION:${escapeText(g.venueName)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${link}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Implement `index.ts`** following `deliver-notifications/index.ts`'s conventions (local `declare const Deno`, `required(name)`, `createClient` from `https://esm.sh/@supabase/supabase-js@2.111.0` with the service-role key, `Deno.serve`). Behaviour: only `GET`; read `token` from the query (missing → 400); `select profile_id from calendar_feeds where token = $token` (none → 404 `Not found`); then query the owner's games — published events with `starts_at` between now − 30 days and now + 180 days, where the owner has a booking with status `confirmed` (→ going), `waitlisted`, or `invited`, or `events.created_by = owner` (→ hosting, taking precedence); only clubs where the owner is an active member. Implement with two PostgREST queries (bookings joined to events/clubs/venues; events created_by joined to clubs/venues) merged by event id, or a small SQL view — keep it in the function, no new RPC. Respond `200` with `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: public, max-age=900`, body `buildCalendar(games, new Date(), required('PUBLIC_APP_URL'))`. Env: `PUBLIC_APP_URL`, the same secret deliver-notifications and send-club-invite already read (already set on dev/prod). Errors → 500 with a plain message, logged.
- [ ] **Step 5: config.toml** — after the `send-club-invite` block add:

```toml
# Calendar apps fetch this with no Supabase session (they can't sign in);
# the per-member token in the query string is the only key.
[functions.calendar-feed]
verify_jwt = false
```

- [ ] **Step 6:** `npx vitest run supabase/functions/calendar-feed` passes; `npx tsc --noEmit` clean (index.ts is type-checked like the other functions); optionally smoke-test locally with `npx supabase functions serve calendar-feed --no-verify-jwt` and `curl` using a token from Task 3 — report the output.
- [ ] **Step 7: Commit** (`feat(functions): calendar-feed serves a member's games as .ics`).

---

### Task 5: Client libs — club games, cover, calendar, share

**Files:** Modify `lib/my-games.ts` (+ test), `lib/clubs.ts` (`Club` += `cover_path: string | null; cover_color: CoverColor`; `CLUB_COLUMNS` += `cover_path, cover_color`). Create `lib/club-hub.ts`, `lib/club-cover.ts`, `lib/calendar-feed.ts` (+ tests each).

**Interfaces:**
- `lib/my-games.ts`: `MyStatus` += `'invited'`; `MyGame` += `notes?: string`; `fetchClubGames(clubId: string, from: Date, to: Date): Promise<MyGame[] | null>` (rpc `club_games` with `{ target_club, from_ts, to_ts }`, same mapping as `fetchMyGames` plus `notes`).
- `lib/club-hub.ts`:
  - `export type CoverColor = 'accent2_800' | 'accent2_700' | 'accent_700' | 'accent_800' | 'neutral_800'`
  - `export const COVER_COLORS: { key: CoverColor; label: string; value: string }[]` in the order above with labels `Dark green, Olive, Clay, Dark brown, Charcoal` and values from `colors`.
  - `export function coverColorValue(key: string): string` (unknown → dark green).
  - `export type HubSection = 'board' | 'games' | 'photos' | 'members' | 'ranks'`; `export const HUB_SECTIONS: { key: HubSection; label: string }[]` = Board, Games, Photos, Members, Ranks.
  - `export function shareText(clubName: string, code: string): string` → `Join ${clubName} on MahjHero with code ${code}`.
  - `export async function shareClubCode(clubName: string, code: string): Promise<'shared' | 'copied' | 'failed'>` — on web: `navigator.clipboard.writeText(...)` → `'copied'`; native: `Share.share({ message })` from `react-native` → `'shared'`; errors → `'failed'`.
- `lib/club-cover.ts`: `uploadClubCover(clubId: string, image: PickedImage): Promise<{ error: string | null }>` (compress with `compressImage`, upload to `club-covers` at `${clubId}/${Crypto.randomUUID()}.jpg`, call `set_club_cover`, then remove the returned previous path with `storage.from('club-covers').remove([prev])`, ignoring remove errors); `removeClubCover(clubId): Promise<{ error: string | null }>`; `setClubCoverColor(clubId, color: CoverColor): Promise<{ error: string | null }>`; `getClubCoverUrl(path: string): Promise<string | null>` (createSignedUrl, 1h, with a module cache like `getSignedUrls` in `lib/attachments.ts`). Errors map to `GENERIC_ERROR`. Reuse `compressImage` and `PickedImage` from `lib/attachments.ts` (export them there if not exported; they are).
- `lib/calendar-feed.ts`: `calendarFeedUrl(token: string): string` → `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/calendar-feed?token=${token}`; `webcalUrl(httpsUrl: string): string` (replace leading `https://`/`http://` with `webcal://`); `getMyCalendarFeedUrl(): Promise<string | null>`; `resetCalendarFeed(): Promise<string | null>`.

- [ ] **Step 1:** Write failing tests for each (mock `./supabase` the way `lib/my-games.test.ts` does; for `shareClubCode`, mock `react-native`'s `Platform`/`Share` and `navigator.clipboard`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test` + `npx tsc --noEmit` pass (add `cover_path: null, cover_color: 'accent2_800'` to `Club` fixtures that tsc flags).
- [ ] **Step 5: Commit** (`feat(lib): club games, cover, calendar feed and share helpers`).

---

### Task 6: Pull to refresh

**Files:** Modify `components/Screen.tsx` (+ `components/__tests__/Screen.test.tsx`), `app/home.tsx` (+ `app/__tests__/home.test.tsx`).

**Interfaces:** `Screen` prop `onRefresh?: () => Promise<void>`. When `scroll && onRefresh`, the `ScrollView` gets `refreshControl={<RefreshControl refreshing={refreshing} onRefresh={...} tintColor={colors.accentColor} colors={[colors.accentColor]} />}` with local `refreshing` state set true while the promise runs.

- [ ] Test: rendering `Screen` with `onRefresh` renders a RefreshControl (in jsdom assert the prop reaches the ScrollView, e.g. by mocking `RefreshControl` or checking `onRefresh` gets called when the control's handler fires). Home passes `onRefresh={async () => { await Promise.all([loadFeed(), loadClubs(), needs.reload()]); }}` — test that the handler calls `fetchMyGames` again.
- [ ] `npm test`, tsc; **Commit** (`feat(ui): pull to refresh on Screen and Home`).

---

### Task 7: Hub header, section buttons, layout and routes

**Files:** Modify `components/icons.tsx`. Create `components/hub/ClubHubHeader.tsx`, `components/hub/SectionButtons.tsx`, `components/hub/HubSection.tsx`, `app/clubs/[id]/(hub)/_layout.tsx`, placeholder section files `games.tsx`, `board.tsx`, `photos.tsx`, `members.tsx`, `ranks.tsx` (each rendering `HubSection` with a one-line placeholder; later tasks fill them), `components/__tests__/club-hub.test.tsx`. `git mv app/clubs/[id]/index.tsx app/clubs/[id]/legacy.tsx` (the old page stays as the source Tasks 10–11 move code from; Task 11 deletes it), then create a new `app/clubs/[id]/index.tsx`: `export default function ClubIndex() { const { id } = useLocalSearchParams<{ id: string }>(); return <Redirect href={`/clubs/${id}/games`} />; }`. Point the old page's existing tests at `legacy.tsx`. (The leaderboard redirect happens in Task 9.)

**Interfaces:**
- Icons: `SettingsIcon` (Lucide "settings"), `ShareIcon` (Lucide "share"), `ImageIcon` (Lucide "image"), `MessageSquareIcon` (Lucide "message-square"); all `({ size = 22, color = colors.text })`, stroke 2.75.
- `SectionButtons({ active: HubSection; onSelect: (s: HubSection) => void })` — 5-column row, each `Pressable` 60pt tall, radius 18, icon 22 over label 13/700; icons: board → MessageSquareIcon, games → CalendarIcon, photos → ImageIcon, members → PeopleIcon, ranks → TrophyIcon. Active: `backgroundColor: colors.bg`, text/icon `colors.accent[800]`; inactive: transparent, `#fff`. `accessibilityRole="tab"` inside a `tablist` View, `accessibilityState={{ selected }}`.
- `ClubHubHeader({ club: Club; coverUrl: string | null; canManage: boolean; active: HubSection; onBack; onSettings; onSelect })` — background: `ImageBackground` with `coverUrl` (on error → colour) + an absolute overlay `rgba(` of `colors.neutral[900]` at 0.55 `)`, else a `View` with `backgroundColor: coverColorValue(club.cover_color)`; padding top = safe-area inset + 8; rows as in the spec; Share pill calls `shareClubCode` and shows "Copied" for 2s when it returns `'copied'`.
- `HubSection({ children, footer?, onRefresh? })` — `ScrollView` (flex 1, `bg`, content max width `layout.contentMaxWidth`, padding 16) with optional `RefreshControl` (same as Screen's) and an optional pinned footer below it (same styling as `Screen`'s footer column). Does NOT add a top safe-area inset (the header owns it).
- `(hub)/_layout.tsx`: reads `id` and the current section from `useSegments()` (last segment), loads the club (`fetchClub`) and the caller's role (`fetchMyRoles`), resolves the cover URL (`getClubCoverUrl` when `cover_path`), renders `<View style={{flex:1, backgroundColor: colors.bg}}><ClubHubHeader …/><Slot/></View>`. Loading: header skeleton (a coloured block of the header's height); failure: `Screen center` with back link, "Could not load this club." and Retry. `onBack` → `router.replace('/home')`; `onSettings` → `router.push(`/clubs/${id}/settings`)`; `onSelect(s)` → `router.replace(`/clubs/${id}/${s}`)`. Signed-out → `<Redirect href="/sign-in" />`. Expose the loaded club/role to sections via a small React context `ClubHubContext` (`{ club, role, reloadClub }`) exported from `components/hub/ClubHubContext.tsx` — add that file.
- [ ] Tests (`components/__tests__/club-hub.test.tsx`): header shows colour background when no cover (assert style backgroundColor), photo when `coverUrl`; gear only when `canManage`; "Club code: CODE" text; Share calls `shareClubCode` and shows "Copied" on `'copied'`; SectionButtons marks the active one selected and calls `onSelect('members')` on tap.
- [ ] `npm test`, tsc. **Commit** (`feat(hub): club hub header, section buttons and routes`).

---

### Task 8: Games section

**Files:** Modify `app/clubs/[id]/(hub)/games.tsx`, `components/GameRow.tsx` (+ its test). Create `components/hub/CalendarLinkSheet.tsx`, `app/__tests__/club-games.test.tsx`.

**Interfaces:** `GameRow`'s `statusTag` gains `case 'invited': return { label: 'Invited', tone: 'hosting' }` (same `accent[200]`/`accent[800]` pill). `CalendarLinkSheet({ visible, url, onClose })` — a modal/bottom sheet showing the https URL (selectable text), **Copy link** (clipboard via `navigator.clipboard` on web; on native use `Share.share({ message: url })` labelled "Share link" instead), and the hint copy.

- [ ] **Screen behaviour:**
  - Segment control (All/Upcoming/Past, default Upcoming) — reuse the visual of Home's `HomeSwitch` pill styled smaller (42pt).
  - Fetch with `fetchClubGames(club.id, from, to)`: Upcoming `[now, now+120d)`; Past `[now−180d, now)` then reverse; All = `[now−180d, now+120d)` ascending. Rows: `GameRow` with `showClub={false}`, `description={game.notes || null}`, `past={startsAt < now}`, `onPress` → `router.push(`/clubs/${club.id}/events/${game.eventId}`)`.
  - Empty: "No games here yet." / "No past games."; hosts get a `Button` "New game" under it.
  - Footer (via `HubSection footer`): "Add to calendar" (surface pill with CalendarIcon) — on press `getMyCalendarFeedUrl()`; null → inline error "Could not get your calendar link."; on native `Linking.openURL(webcalUrl(url))`, falling back to the sheet if it throws; on web open the sheet directly. "New game" (accent-700 pill with PlusIcon) only when `role === 'host'` → `/clubs/${id}/events/new`.
  - Refetch on focus (`useFocusEffect`) and pull-to-refresh; error → "Could not load games." + Retry. Use a sequence guard like `app/home.tsx`'s `feedSeq`.
- [ ] Tests: default Upcoming list renders rows with notes; Past segment calls `fetchClubGames` with a past window and shows "No past games." when empty; footer shows "New game" for host only; "Add to calendar" on web opens the sheet with the URL; `invited` tag renders "Invited".
- [ ] `npm test`, tsc. **Commit** (`feat(hub): Games section with calendar subscription`).

---

### Task 9: Board, Ranks and Photos sections

**Files:** Create `components/ClubBoard.tsx`, `components/ClubLeaderboard.tsx`. Modify `app/messages/club/[threadId]/index.tsx`, `app/clubs/[id]/leaderboard.tsx` (→ redirect), `(hub)/board.tsx`, `(hub)/ranks.tsx`, `(hub)/photos.tsx`, related tests.

- [ ] **ClubBoard:** move the board-list content of `app/messages/club/[threadId]/index.tsx` (error banner, loading, empty card, `PostRow` list, `fetchClubPosts`, `fetchThread` if needed for the list, `useThreadRealtime`) into `ClubBoard({ threadId, clubId })` verbatim; the messages screen keeps its `CompactHeader` and renders `<ClubBoard …/>`. Its existing tests must still pass. Expose a "New post" action for whoever could post before (keep the same gating the header ⊕ used) as a button at the top of the Board section.
- [ ] **Board section:** `open_thread_for_club(club.id)` (existing client fn `openThreadForClub`) → thread id, then `<HubSection onRefresh=…><ClubBoard …/></HubSection>`; failure → "Could not load the board." + Retry.
- [ ] **ClubLeaderboard:** move the content part of `app/clubs/[id]/leaderboard.tsx` (guards, error, empty card, rows, data loads) into `ClubLeaderboard({ clubId })`; the Ranks section renders it inside `HubSection` with pull-to-refresh. `app/clubs/[id]/leaderboard.tsx` becomes a redirect to `/clubs/${id}/ranks`; move its tests to target the component.
- [ ] **Photos section:** `HubSection` with centered `ImageIcon` (40, `neutral[600]`) and "Photos and files are coming soon." (16, `neutral[700]`).
- [ ] `npm test`, tsc. **Commit** (`feat(hub): Board, Ranks and Photos sections`).

---

### Task 10: Members section

**Files:** Create `components/ClubMembers.tsx`. Modify `(hub)/members.tsx`, tests (move the roster/invite tests that targeted the old club page to the component).

- [ ] Move from `app/clubs/[id]/legacy.tsx` into `ClubMembers({ club, role })` verbatim: roster load (`fetchRoster`), member count + search, member cards, pending invites (`fetchPendingInvites`, resend/delete handlers and their busy state), the "Bringing people in" tip, and the invite-by-email form (`onInvite`) — the invite parts only when `canInvite(role)`. Drop the code row, leaderboard button, "Open the club thread", import/venues buttons and the game-mode toggle (they live in settings/sections now). Keep the `?imported=` confirmation card (import redirects back — change the import screen's post-import redirect to `/clubs/${id}/members?imported=N`).
- [ ] Members section: `HubSection onRefresh` wrapping `ClubMembers`.
- [ ] Tests: member list renders; organizer sees invite form and pending invites; member doesn't; resend/delete still call their lib fns.
- [ ] `npm test`, tsc. **Commit** (`feat(hub): Members section (roster and invites moved in)`).

---

### Task 11: Club settings, Profile reset, remove the legacy page, links

**Files:** Create `app/clubs/[id]/settings.tsx`, `app/__tests__/club-settings.test.tsx`. Modify `app/profile.tsx` (+ test). Delete `app/clubs/[id]/legacy.tsx`. Modify club navigation sites.

- [ ] **Settings screen** (`Screen scroll` with `CompactHeader` back → `/clubs/${id}/games`, title "Club settings"); organizers only, others `<Redirect href={`/clubs/${id}/games`} />`.
  - **Cover:** a 120pt-tall preview (photo or colour, same rendering as the header's background); buttons "Upload photo" (or "Replace photo" when set) → `pickImages('library', 0)` → first image → `uploadClubCover`; "Remove photo" when set → `removeClubCover`; a row of 5 round 44pt swatches from `COVER_COLORS` with `accessibilityLabel` = label and the selected one ringed (2px `accentColor`), tapping calls `setClubCoverColor`. Inline errors; reload the club after each change (use `ClubHubContext.reloadClub` isn't available outside the hub — just refetch `fetchClub` here).
  - **Club code:** move the Change → New club code → Save code block from `legacy.tsx` verbatim.
  - **"New games default to invite-only"** toggle: move `onToggleDefaultGameMode` + row from `legacy.tsx` verbatim.
  - Links: "Venues" → `/clubs/${id}/venues`; "Import a roster" → `/clubs/${id}/import`.
- [ ] **Profile:** a settings row "Reset calendar link" with helper "Your old calendar link will stop working." → confirm dialog (reuse the app's existing confirm pattern in profile.tsx, e.g. the sign-out confirm) → `resetCalendarFeed()`; success notice "New calendar link ready. Tap Add to calendar in a club to subscribe again."; failure → `GENERIC_ERROR`.
- [ ] Delete `app/clubs/[id]/legacy.tsx` and move/delete its tests (`app/__tests__/club-code.test.tsx` → target settings; roster/invite tests already moved in Task 10).
- [ ] **Links:** every navigation to a club's main page goes to `/clubs/${id}/games`: `app/home.tsx` (club cards, JoinClubCard `onJoined`), `lib/use-needs-you.ts` (club-invite accept without event), `components/home/HomeGuides.tsx` ("Invite players" → `/clubs/${id}/members`), any `router.push(`/clubs/${id}`)` found by `grep -rn "clubs/\${[^}]*}\`" app components lib` that means "the club page". Venues/import/events back links that went to `/clubs/${id}` → the relevant section (venues/import → settings; event screens → games).
- [ ] Tests: settings organizer-only redirect; swatch tap calls `setClubCoverColor('accent_700')`; upload flow calls `uploadClubCover`; code change still works; Profile reset calls `resetCalendarFeed`.
- [ ] `npm test`, tsc. **Commit** (`feat(hub): club settings with cover; reset calendar link on Profile`).

---

### Task 12: Visual baselines and real-browser check

- [ ] Follow phase-1 Task 12's procedure (record `main`'s failures first; local stack; export the three env vars). Replace the old `club detail` / `leaderboard` baselines with: `club games` (seeded club, Upcoming), `club members`, `club board`, `club ranks`, `club photos`, `club settings`, each desktop + mobile. Eye-check changed baselines; anything other than the intended screens changing → stop and report. End with `npx supabase db reset --local && npm run test:db`.
- [ ] Controller does the real-browser check on `localhost:8090` against hosted dev after Task 13's dev push (not the local stack).
- [ ] **Commit** (`test(visual): club hub baselines`).

---

### Task 13: Dev deploy, QA Pass, PR (controller)

- [ ] `npx supabase db push --project-ref rzutuhabxzcateutaojo --dry-run`, confirm only the three new migrations, then push.
- [ ] No new secret: `PUBLIC_APP_URL` is already set on dev/prod; verify with `npx supabase secrets list`. Then `npx supabase functions deploy calendar-feed --project-ref rzutuhabxzcateutaojo`. Verify `curl -i "https://rzutuhabxzcateutaojo.supabase.co/functions/v1/calendar-feed?token=bad"` → 404.
- [ ] Start `mahjhero-web`; walk through the hub on `localhost:8090`; hand to the user.
- [ ] QA Pass artifact per CLAUDE.md (read live, verify copy against source, add hub/Games/settings/calendar steps with new data-ids, update totals, republish in place).
- [ ] Push branch, open PR; body lists: prod needs the three migrations pushed, `PUBLIC_APP_URL` present (already set; verify with `npx supabase secrets list`), and `calendar-feed` deployed before merge.
