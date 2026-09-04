# Club Leaderboard Design

## Goal

Give a club an all-time, points-based leaderboard aggregated from its
existing round-scoring data, reachable from both the Club Dashboard and the
Club Edit page.

## Background

`public.table_rounds` (`supabase/migrations/20260902060000_create_table_rounds.sql:16-33`)
already logs one row per hand: `club_id`, `event_id`, `event_table_id`,
`winner_profile_id`, `points` (a fixed set — 25/30/35/40/45/50/75), and
`recorded_by`. `club_id` is denormalized directly onto every round, so a
club-wide aggregate needs no join through `events`. `lib/rounds.ts`'s
`roundTotals` already sums `points` by `winner_profile_id`, but only ever
over one event's rounds (every current caller passes it a single event's
fetch) — nothing aggregates across a club's whole history today, and there
is no season/reset concept anywhere in the schema or app. This spec adds
exactly that aggregate, all-time, with no date filtering.

Two RLS policies already in place make a plain (non-`security definer`)
Postgres function sufficient, with no membership check to re-implement:

- `table_rounds_select_member` (`20260902060000_create_table_rounds.sql:47-48`)
  — `using (public.is_club_member(club_id))`.
- `profiles_select_self_or_comember` (`20260822033527_create_clubs.sql:120-128`)
  — lets a caller read a fellow active club member's `profiles` row (needed
  for `display_name`).

A function that omits `security definer` runs as the calling role, so both
policies apply exactly as they already do for any other read — a non-member
calling this function gets an empty result, not an error, the same way a
non-member querying `table_rounds` directly today would.

## Scope

### 1. `club_leaderboard` — a new read-only Postgres function

```sql
create function public.club_leaderboard(target_club uuid)
returns table (
  profile_id   uuid,
  display_name text,
  total_points bigint,
  rounds_won   bigint
)
language sql
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
  group by tr.winner_profile_id, p.display_name
  order by sum(tr.points) desc, count(*) desc;
$$;

grant execute on function public.club_leaderboard(uuid) to authenticated;
```

Ranked by total points first, rounds won as the tiebreaker (confirmed during
brainstorming). No `security definer`, no explicit membership check, no
`revoke`/re-`grant` dance — this is a brand-new function, not a
re-signatured existing one, so it needs none of the drop-and-recreate
ceremony the fee-mutation functions did.

### 2. `lib/leaderboard.ts` — client wrapper

```ts
export type LeaderboardEntry = {
  profile_id: string;
  display_name: string;
  total_points: number;
  rounds_won: number;
};

export async function fetchClubLeaderboard(
  clubId: string,
): Promise<LeaderboardEntry[] | null> {
  // never rejects, same contract as every other lib/*.ts fetch
}
```

`display_name` can be empty (a member who never set one) — the leaderboard
screen falls back to "Member", the same word every other roster-facing
screen already uses for this exact case.

### 3. `app/clubs/[id]/leaderboard.tsx` — the new screen

Built on `app/clubs/[id]/venues.tsx`'s exact template, not a new shape:
same guard order (loading → session → ready → loadFailed), same back
button (`Button variant="ghost"` + `ChevronLeftIcon`, label "Club",
`accessibilityLabel="Back to the club"`, `router.push('/clubs/${clubId}')`),
same flat `DashboardHeader` usage —

```tsx
<DashboardHeader kicker={club.name} name="Leaderboard" meta="" />
```

Below that, one row per entry: rank number, name (or "Member" fallback),
total points, rounds won. Empty state ("No rounds recorded yet.") when the
club has no leaderboard rows at all — matching `venues.tsx`'s own
no-venues-yet empty-state pattern rather than inventing new copy
conventions.

### 4. Club Dashboard entry point — `app/clubs/index.tsx`

In the "Your club" scope (`scope.kicker === 'Your club'`), fetch the
leaderboard's top entry (via the same `fetchClubLeaderboard`, taking
`[0]`) alongside the screen's other per-club data, and show a tappable
"Leader: <name>" line right under `DashboardHeader`, navigating to
`/clubs/${scopeClubId}/leaderboard`. Hidden entirely when there is no
leader yet (no rounds recorded club-wide) — the same "render nothing, not
a placeholder" convention the daily greeting and the fee line already
established this session.

### 5. Club Edit entry point — `app/clubs/[id]/index.tsx`

A "Leaderboard" secondary `Button`, visible to **every** member — placed
outside the `{mayInvite ? ... : null}` block (unlike "Open the club
thread"/"Create an invite link"/etc., which are all organizer-only), right
after the existing `DashboardHeader` call. Navigates to the same
`/clubs/${id}/leaderboard` route the dashboard's "Leader" line does.

## Decisions locked during brainstorming

| # | Decision |
|---|---|
| 1 | All-time cumulative leaderboard — no season/date-range concept, matching the schema's own lack of one. |
| 2 | Server-side aggregation via a new Postgres function, not a client-side reduce over every round row. |
| 3 | Ranked by total points first, rounds won as the tiebreaker. |
| 4 | Two entry points, both to the same screen: a tappable "Leader: <name>" line on the Club Dashboard's "Your club" scope, and a "Leaderboard" button on the Club Edit page, open to every member (not organizer-gated). |
| 5 | The new screen reuses `venues.tsx`'s exact header/back-button/empty-state shape rather than inventing a new one. |

## Open items for the implementation plan to resolve

- Exact styling/row layout for the leaderboard list (rank number treatment,
  spacing) — a live check against the app's existing list patterns
  (roster rows, invite rows) rather than a from-scratch design.
- Whether the Club Dashboard's "Leader" line needs its own loading/failure
  handling distinct from the rest of that screen's per-club data, or can
  share the existing per-club fetch effect.
- Confirm `is_club_member` (referenced by `table_rounds_select_member`)
  is the same helper other RPCs already use, so this spec's reliance on
  RLS alone (no explicit membership check in `club_leaderboard` itself)
  is consistent with how the rest of this codebase reasons about it.

## Testing

- `lib/leaderboard.ts`: unit tests for `fetchClubLeaderboard` (success,
  network failure, empty club) following `lib/rounds.ts`'s/`lib/profile.ts`'s
  existing mock-chain conventions.
- `app/__tests__/leaderboard.test.tsx` (new): the screen's guard ordering,
  the ranked list rendering (including the "Member" fallback and the
  points/rounds-won tiebreaker order), the empty state, and the back link.
- `app/__tests__/clubs.test.tsx`: a case asserting the "Leader: <name>"
  line appears on the "Your club" scope when a leader exists, is absent
  when the club has no recorded rounds, and navigates to the leaderboard
  route when tapped.
- `app/__tests__/clubs.test.tsx` (the `ClubDetailScreen` describe block):
  a case confirming the "Leaderboard" button is visible regardless of
  `mayInvite`/organizer status, unlike its organizer-only neighbors.
- A live visual check of the new screen and both entry points, matching
  this branch's established practice.
