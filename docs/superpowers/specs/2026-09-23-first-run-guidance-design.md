# First-run guidance — design

**Date:** 2026-09-23
**Status:** Approved in brainstorming; awaiting implementation plan

## Problem

`app/welcome.tsx` explains what MahjHero is, but only to signed-out visitors.
Once someone signs in there is no guidance at all. Two audiences need it,
equally:

- **Players** (`member`), who mostly arrive through an invite link and need to
  find a game, join it, bring someone along, and know where to look on the day.
- **Organizers** (`host`), who must set a club up — schedule a game, invite
  players, announce — before the club is useful to anyone.

Constraints from `docs/roadmap.md`: this audience will not complete an
app-store-style onboarding, and the web target is permanent, so guidance must be
short, never block the path from an invite link to a game, and follow the person
across devices.

## Decision: nothing interrupts first sign-in

No intro carousel or modal. A first-time user lands where they would anyway; the
guidance lives on the screens themselves:

1. An organizer **setup checklist** card on the dashboard (hosts only).
2. A **"How MahjHero works"** card on the dashboard (players).
3. **Contextual tips** — a dismissible card the first time a person reaches one of
   four screens.
4. A **"How it works"** page reachable from Profile, with **"Show tips again."**

## What each person sees

### Organizer: "Get your club going" (dashboard, `app/clubs/index.tsx`)

Shown per club to that club's **host** only (co-organizers join a club that is
already running). Steps tick themselves from real data; nothing is ticked by hand.

| # | Step | Done when | Action goes to |
|---|------|-----------|----------------|
| 1 | Create your club | Always done (the card only exists for a host) | — |
| 2 | Schedule your first game | Club has ≥ 1 event/series | `/clubs/[id]/events/new` |
| 3 | Invite your players | Club has ≥ 2 members **or** ≥ 1 pending invite | `/clubs/[id]` (invites) |
| 4 | Say hello *(optional)* | Club has ≥ 1 broadcast | `/clubs/[id]/broadcast` |

Venue is not its own step: it is chosen inside the new-game form (`VenuePicker`).

The card disappears when steps 1–3 are done (step 4 is optional and does not
hold the card open), or when the host dismisses it. Dismissal is per club
(key `host-checklist:<clubId>`).

### Player: "How MahjHero works" (dashboard)

Shown to anyone who is not a host or co-organizer in any club. Three lines, a
"Got it" dismiss (key `player-intro`):

1. Find a game
2. Tap **Join** to take a spot, or **Invite** to bring someone along
3. On the day, check the game page for your table and messages

### Contextual tips

Each appears the first time the person reaches the screen, until dismissed.

| Key | Screen | Audience | Content (to be verified against rendered copy) |
|-----|--------|----------|------------------------------------------------|
| `tip:event` | `app/clubs/[id]/events/[eventId]/index.tsx` | Player | What **Join**, **Invite**, and the waitlist mean |
| `tip:new-game` | `app/clubs/[id]/events/new.tsx` | Organizer | Assigned tables vs. open seating (one line each); set **Cost to play**, and **Minimum spend** if the venue asks — players see the cost up front and payment is tracked at check-in; no money moves through the app |
| `tip:check-in` | `app/clubs/[id]/events/[eventId]/check-in.tsx` | Organizer | Tap a name to check them in; payment status is visible to organizers only |
| `tip:club` | `app/clubs/[id]/index.tsx` | Organizer | Where invites live and how an invite link works |

All button and field names in tip copy must be checked against the real rendered
labels at implementation time — never reused from this spec unverified.

### "How it works" (from `app/profile.tsx`)

A Profile row opens one page (`app/how-it-works.tsx`) with the player steps and an
organizer section summarising the checklist and tips. A **"Show tips again"**
button clears every dismissal.

## Architecture

### Persistence

- New column `profiles.dismissed_guides text[] not null default '{}'`.
- `profiles` UPDATE is **column-granted**
  (`20260903160000_profiles_update_column_grant.sql`). The migration must add
  `dismissed_guides` to that grant, and a test must prove an authenticated user can
  update it on their own row and not on another's (the existing `profiles_update_own`
  policy covers the row check).
- Stored server-side so a dismissal on the web holds on the phone. No local-storage
  mirror.

### `lib/guides.ts`

- `useGuide(key)` → `{ visible, dismiss }`. Reads `dismissed_guides` from the
  profile the app already loads; `dismiss` hides immediately (optimistic) and
  appends the key in the background.
- `resetGuides()` → sets the column to `'{}'`.
- `hostChecklist(input)` — pure function from already-loaded counts to
  `{ steps: {key, done}[], complete: boolean }`, unit-tested in isolation.

### `components/TipCard.tsx`

One presentational card used by every tip and both dashboard cards: optional tag,
title, one or two lines, optional action button, "Got it". Styled like the
welcome screen's Invites card (`Card` on `colors.accent2[100]`), with the same
contrast rule (`accent2[800]` body text on that ground).

### Checklist data

Derived from what the dashboard already loads (clubs + role, upcoming games)
plus, if needed, one narrow count query per host club for members, pending
invites and broadcasts. No progress is stored.

## Failure behaviour

- If the profile's `dismissed_guides` cannot be read, **hide** all guides — never
  re-show something the person may have dismissed.
- If a dismiss write fails, the card stays hidden for the session; it may return
  next session. No error banner.
- If the checklist's count query fails, hide the checklist rather than show wrong
  progress.

## Testing

- Unit: `useGuide` (visible/dismiss/optimistic/failed write), `hostChecklist`
  (each step's done condition, optional step 4 not blocking completion).
- DB: migration + column grant — own-row update allowed, other-row refused, other
  columns still not grantable.
- Render: each tip on its screen for the right role, hidden for the wrong role and
  once dismissed; "Show tips again" restores them.
- Visual: Playwright baselines for the dashboard with the host checklist and with
  the player card.
- QA Pass artifact: per `CLAUDE.md`, add first-sign-in steps (player card, host
  checklist, one tip, Show tips again) to the affected scenario(s).

## Out of scope

- Intro carousel / full-screen onboarding.
- Coach-mark overlays pointing at real controls.
- Tips on screens beyond the four above; co-organizer checklist.
- Any analytics on tip views/dismissals.
