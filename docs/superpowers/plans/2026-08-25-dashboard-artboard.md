# Dashboard Artboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `app/clubs/index.tsx` to the `1C club` artboard — switcher header, club chips, "Need a 4th" cards, date-tile game rows with Join — and add the artboard's four-tab bottom bar.

**Architecture:** All derivation (which rows to show, which tables need a fourth, what the header says) moves into a new pure module `lib/dashboard.ts` that never touches React or Supabase, so it is unit-testable without rendering. Presentation splits into small single-purpose components under `components/`. The screen becomes a thin wiring layer over both. The tab bar is a presentational component the four tab screens render, not an expo-router route group — see Global Constraints for why.

**Tech Stack:** Expo 57 / expo-router 57, React Native 0.86 + react-native-web, TypeScript, Supabase JS, Vitest + `@testing-library/react`.

## Global Constraints

- **Design source of truth:** `.superpowers/design/MahjHero.dc.html`, the `<!-- 1C club -->` block. Tokens come from `lib/theme.ts` — never hardcode a colour, radius, space or font size that exists there.
- **Type floor:** 18pt body (`type.size.body`), 16pt helper (`type.size.helper`). The artboard's 15px is deliberately not matched; the player base skews older. Never introduce a font size below `type.size.helper`.
- **No new SQL.** No migration, no new RPC, no change to any `supabase/` file.
- **Preserve behaviour.** Promotion offers, waitlist management, decline and check-in keep their exact current logic and copy. This plan moves them inside a new row layout; it does not change when they appear or what they do.
- **`needsAFourth` is not reimplemented.** `lib/bookings.ts` records that this rule reached three copies before one drifted. Call the existing function.
- **Test command:** `TZ=America/New_York npx vitest run <path>` — the TZ is required; `package.json`'s `test` script sets it and tests assert formatted times.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Tab bar is a component, not a route group.** Wrapping the four tab screens in `app/(tabs)/` would put `app/(tabs)/clubs/index.tsx` and the existing `app/clubs/[id]/` tree in the same URL namespace, and would move files that six test files import by relative path. A presentational `TabBar` gets the artboard's bar with no route restructuring. Migrating to expo-router `Tabs` is a follow-up, recorded in the spec.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `lib/dashboard.ts` | Pure derivation: chips, header scope, initials, dashboard rows, need-a-fourth alerts. No React, no network. |
| `lib/dashboard.test.ts` | Unit tests for the above. |
| `components/DateTile.tsx` | The day/date tile. Knows a timestamp and a timezone, nothing else. |
| `components/Skeleton.tsx` | One shimmering placeholder block. |
| `components/ClubChips.tsx` | The horizontal chip scroller. |
| `components/DashboardHeader.tsx` | Kicker / name / meta plus the initials avatar. |
| `components/NoticeBanner.tsx` | Dismissible accent-2 confirmation. |
| `components/NeedAFourthCard.tsx` | The accent alert card and its "I'm in" button. |
| `components/TabBar.tsx` | The four-tab bottom bar. |
| `app/messages.tsx` | Messages placeholder screen. |
| `components/__tests__/dashboard-parts.test.tsx` | Rendering tests for the new components. |

**Modified:**

| Path | Change |
|---|---|
| `components/icons.tsx` | Add `HomeIcon`, `MessageIcon`, `PersonIcon`, `BellIcon`. |
| `app/clubs/index.tsx` | Rebuilt to the artboard. |
| `app/profile.tsx` | Mount `TabBar`. |
| `app/notifications.tsx` | Mount `TabBar`. |
| `app/__tests__/clubs.test.tsx` | Update assertions, add new coverage. |

---

### Task 1: `lib/dashboard.ts` — pure derivation

**Files:**
- Create: `lib/dashboard.ts`
- Test: `lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `MyBooking` and `needsAFourth`, `seatsRemaining` from `lib/bookings.ts`; `ClubEvent` and `formatEventWhen` from `lib/events.ts`; `Club` from `lib/clubs.ts`.
- Produces:
  - `ALL_CLUBS: 'all'`
  - `type Chip = { id: string; label: string }`
  - `buildChips(clubs: Club[]): Chip[]`
  - `type HeaderScope = { kicker: string; name: string; meta: string }`
  - `headerScope(clubs: Club[], selected: string): HeaderScope`
  - `initialsFrom(displayName: string): string`
  - `inScope(clubId: string, selected: string): boolean`
  - `type DashboardRow = { eventId: string; clubId: string; clubName: string; title: string; startsAt: string; timezone: string; venueName: string; booking: MyBooking | null; joinable: boolean }`
  - `buildDashboardRows(input: { bookings: MyBooking[]; events: ClubEvent[]; clubs: Club[]; userId: string; now?: Date }): DashboardRow[]`
  - `type FourthAlert = { eventId: string; clubId: string; clubName: string; tableId: string; text: string }`
  - `needAFourthAlerts(input: { events: ClubEvent[]; clubs: Club[]; userId: string; now?: Date }): FourthAlert[]`

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  initialsFrom,
  inScope,
  needAFourthAlerts,
} from './dashboard';
import type { Club } from './clubs';
import type { ClubEvent } from './events';
import type { MyBooking } from './bookings';

const CLUBS: Club[] = [
  {
    id: 'club-1',
    name: 'Riverside Mah Jongg',
    slug: 'riverside',
    rhythm: 'Thursdays, 7pm',
    visibility: 'private',
    timezone: 'America/New_York',
  },
  {
    id: 'club-2',
    name: 'Harbour Tiles',
    slug: 'harbour',
    rhythm: 'First Sunday',
    visibility: 'private',
    timezone: 'America/New_York',
  },
];

const NOW = new Date('2026-09-01T12:00:00Z');

function event(over: Partial<ClubEvent> = {}): ClubEvent {
  return {
    id: 'event-1',
    club_id: 'club-1',
    series_id: null,
    title: 'Thursday night',
    venue_id: 'venue-1',
    venue_name: "Sara's place",
    notes: '',
    starts_at: '2026-09-02T23:00:00Z',
    ends_at: '2026-09-03T02:00:00Z',
    status: 'published',
    occurrence_date: null,
    overrides: [],
    table_count: 1,
    event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
    bookings: [],
    check_in_required: false,
    ...over,
  };
}

function booking(over: Partial<MyBooking> = {}): MyBooking {
  return {
    booking_id: 'booking-1',
    group_id: 'group-1',
    event_id: 'event-9',
    club_id: 'club-1',
    club_name: 'Riverside Mah Jongg',
    event_title: 'Sunday social',
    starts_at: '2026-09-06T23:00:00Z',
    club_timezone: 'America/New_York',
    venue_name: 'The hall',
    event_table_id: 'table-9',
    table_label: 'Table 1',
    status: 'confirmed',
    booked_by: 'me',
    booked_by_name: 'Me',
    offer_id: null,
    offer_seats: null,
    offer_expires_at: null,
    waitlist_position: null,
    check_in_required: false,
    check_in_state: null,
    check_in_opens_at: null,
    check_in_closes_at: null,
    ...over,
  };
}

describe('buildChips', () => {
  it('puts All clubs first, then one chip per club', () => {
    expect(buildChips(CLUBS)).toEqual([
      { id: ALL_CLUBS, label: 'All clubs' },
      { id: 'club-1', label: 'Riverside Mah Jongg' },
      { id: 'club-2', label: 'Harbour Tiles' },
    ]);
  });
});

describe('headerScope', () => {
  it('counts clubs when the scope is all', () => {
    expect(headerScope(CLUBS, ALL_CLUBS)).toEqual({
      kicker: 'Your clubs',
      name: 'All your clubs',
      meta: '2 clubs',
    });
  });

  it('singularises a lone club', () => {
    expect(headerScope([CLUBS[0]], ALL_CLUBS).meta).toBe('1 club');
  });

  it("uses the club's own rhythm when one is picked", () => {
    expect(headerScope(CLUBS, 'club-1')).toEqual({
      kicker: 'Your club',
      name: 'Riverside Mah Jongg',
      meta: 'Thursdays, 7pm',
    });
  });

  it('falls back to the all-clubs scope for an unknown id', () => {
    expect(headerScope(CLUBS, 'club-gone').name).toBe('All your clubs');
  });
});

describe('initialsFrom', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jean Wu')).toBe('JW');
    expect(initialsFrom('  ada  byron  lovelace ')).toBe('AB');
  });

  it('returns empty for a name that was never set', () => {
    expect(initialsFrom('')).toBe('');
    expect(initialsFrom('   ')).toBe('');
  });
});

describe('inScope', () => {
  it('admits everything under all clubs', () => {
    expect(inScope('club-2', ALL_CLUBS)).toBe(true);
  });

  it('admits only the picked club otherwise', () => {
    expect(inScope('club-2', 'club-1')).toBe(false);
    expect(inScope('club-1', 'club-1')).toBe(true);
  });
});

describe('buildDashboardRows', () => {
  it('carries a booking through as a non-joinable row', () => {
    const rows = buildDashboardRows({
      bookings: [booking()],
      events: [],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventId).toBe('event-9');
    expect(rows[0].joinable).toBe(false);
    expect(rows[0].booking?.booking_id).toBe('booking-1');
  });

  it('adds an open event the viewer is not in as joinable', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event()],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].joinable).toBe(true);
    expect(rows[0].clubName).toBe('Riverside Mah Jongg');
    expect(rows[0].timezone).toBe('America/New_York');
  });

  it('never lists an event twice when the viewer is booked into it', () => {
    const rows = buildDashboardRows({
      bookings: [booking({ event_id: 'event-1' })],
      events: [event()],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].joinable).toBe(false);
  });

  it('drops a full event, a cancelled one, and one already started', () => {
    const full = event({
      id: 'full',
      bookings: [
        { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
        { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
        { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
        { profile_id: 'd', status: 'confirmed', event_table_id: 'table-1' },
      ],
    });
    const cancelled = event({ id: 'cancelled', status: 'cancelled' });
    const past = event({ id: 'past', starts_at: '2026-08-01T23:00:00Z' });
    const rows = buildDashboardRows({
      bookings: [],
      events: [full, cancelled, past],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops an event the viewer is waitlisted on, without a booking row', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          bookings: [
            { profile_id: 'me', status: 'waitlisted', event_table_id: null },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('sorts soonest first across sources', () => {
    const rows = buildDashboardRows({
      bookings: [booking({ event_id: 'later', starts_at: '2026-09-10T23:00:00Z' })],
      events: [event({ id: 'sooner', starts_at: '2026-09-02T23:00:00Z' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows.map((r) => r.eventId)).toEqual(['sooner', 'later']);
  });
});

describe('needAFourthAlerts', () => {
  const threeSeated = [
    { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
    { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1' },
    { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1' },
  ];

  it('raises one alert for a table one short and starting inside 48 hours', () => {
    const alerts = needAFourthAlerts({
      events: [event({ bookings: threeSeated })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tableId).toBe('table-1');
    expect(alerts[0].clubName).toBe('Riverside Mah Jongg');
    expect(alerts[0].text).toContain('Thursday night');
  });

  it('stays silent for an event the viewer is already in', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated.slice(0, 2),
            { profile_id: 'me', status: 'confirmed', event_table_id: 'table-1' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('stays silent more than 48 hours out', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({ starts_at: '2026-09-20T23:00:00Z', bookings: threeSeated }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('stays silent for a cancelled event', () => {
    const alerts = needAFourthAlerts({
      events: [event({ status: 'cancelled', bookings: threeSeated })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run lib/dashboard.test.ts`
Expected: FAIL — `Failed to resolve import "./dashboard"`.

- [ ] **Step 3: Write the implementation**

Create `lib/dashboard.ts`:

```ts
/**
 * Everything the dashboard derives, with no React and no network in sight.
 *
 * The screen used to compute nothing — it rendered `fetchMyUpcomingBookings`
 * straight down the page. The artboard asks for more: a club scope, a merged
 * list of your games and open ones you could still join, and a call for a
 * fourth. That is real logic, and it belongs somewhere it can be tested
 * without rendering a tree or mocking Supabase.
 */
import { needsAFourth, seatsRemaining } from './bookings';
import type { MyBooking } from './bookings';
import type { Club } from './clubs';
import { formatEventWhen } from './events';
import type { ClubEvent } from './events';

/** The chip id standing for "no club filter". Not a club id. */
export const ALL_CLUBS = 'all';

export type Chip = { id: string; label: string };

export function buildChips(clubs: Club[]): Chip[] {
  return [{ id: ALL_CLUBS, label: 'All clubs' }].concat(
    clubs.map((club) => ({ id: club.id, label: club.name })),
  );
}

export type HeaderScope = { kicker: string; name: string; meta: string };

/**
 * An unknown id resolves to the all-clubs scope rather than throwing: the
 * selection is client state and a club can disappear underneath it (left,
 * removed, or the list reloaded), and the honest answer to "show me a club
 * you are no longer in" is the whole list.
 *
 * The artboard's meta is "N clubs · M members". `fetchMyClubs` returns no
 * member counts, so the count half is dropped rather than faked — see the
 * spec's deferred item 4.
 */
export function headerScope(clubs: Club[], selected: string): HeaderScope {
  const club =
    selected === ALL_CLUBS
      ? null
      : (clubs.find((candidate) => candidate.id === selected) ?? null);
  if (!club) {
    return {
      kicker: 'Your clubs',
      name: 'All your clubs',
      meta: `${clubs.length} ${clubs.length === 1 ? 'club' : 'clubs'}`,
    };
  }
  return { kicker: 'Your club', name: club.name, meta: club.rhythm };
}

/**
 * Empty for a member who never set a display name — a magic-link signup
 * starts with `display_name = ''` and nothing forces one. The avatar draws a
 * person glyph in that case rather than a placeholder letter, which would be
 * a name the member never chose.
 */
export function initialsFrom(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export function inScope(clubId: string, selected: string): boolean {
  return selected === ALL_CLUBS || clubId === selected;
}

export type DashboardRow = {
  eventId: string;
  clubId: string;
  clubName: string;
  title: string;
  startsAt: string;
  timezone: string;
  venueName: string;
  /** The viewer's own booking, when they have one. Null on a joinable row. */
  booking: MyBooking | null;
  joinable: boolean;
};

/** Live means it holds or is queued for a seat; declined and cancelled do not. */
function viewerIsIn(event: ClubEvent, userId: string): boolean {
  return event.bookings.some(
    (row) =>
      row.profile_id === userId &&
      (row.status === 'confirmed' || row.status === 'waitlisted'),
  );
}

function confirmedOnTable(event: ClubEvent, tableId: string): number {
  return event.bookings.filter(
    (row) => row.status === 'confirmed' && row.event_table_id === tableId,
  ).length;
}

function hasFreeSeat(event: ClubEvent): boolean {
  const capacity = event.event_tables.reduce(
    (total, table) => total + table.capacity,
    0,
  );
  const confirmed = event.bookings.filter(
    (row) => row.status === 'confirmed',
  ).length;
  return seatsRemaining(capacity, confirmed) > 0;
}

/**
 * The viewer's bookings first, then any open event they are not in, merged
 * and sorted by start.
 *
 * Bookings win the de-duplication: both sources can carry the same event, and
 * the booking is the richer row — it is what the offer, waitlist and check-in
 * controls hang off.
 */
export function buildDashboardRows(input: {
  bookings: MyBooking[];
  events: ClubEvent[];
  clubs: Club[];
  userId: string;
  now?: Date;
}): DashboardRow[] {
  const now = input.now ?? new Date();
  const clubsById = new Map(input.clubs.map((club) => [club.id, club]));

  const rows: DashboardRow[] = input.bookings.map((booking) => ({
    eventId: booking.event_id,
    clubId: booking.club_id,
    clubName: booking.club_name,
    title: booking.event_title,
    startsAt: booking.starts_at,
    timezone: booking.club_timezone,
    venueName: booking.venue_name,
    booking,
    joinable: false,
  }));

  const seen = new Set(rows.map((row) => row.eventId));

  for (const event of input.events) {
    if (seen.has(event.id)) continue;
    if (event.status !== 'published') continue;
    if (viewerIsIn(event, input.userId)) continue;
    if (new Date(event.starts_at).getTime() <= now.getTime()) continue;
    if (!hasFreeSeat(event)) continue;
    const club = clubsById.get(event.club_id);
    if (!club) continue;

    seen.add(event.id);
    rows.push({
      eventId: event.id,
      clubId: event.club_id,
      clubName: club.name,
      title: event.title,
      startsAt: event.starts_at,
      timezone: club.timezone,
      venueName: event.venue_name,
      booking: null,
      joinable: true,
    });
  }

  return rows.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}

export type FourthAlert = {
  eventId: string;
  clubId: string;
  clubName: string;
  tableId: string;
  text: string;
};

/**
 * One alert per table that is one seat short and starting soon, for events
 * the viewer could actually take the seat at.
 *
 * The gate is `needsAFourth` itself, not a local rewrite of it. That rule
 * lives in three places already (here, `eventStatusLine`, and
 * `need_a_fourth_stage` in SQL) and `lib/bookings.ts` records that a fourth
 * copy is exactly how one of them fell out of sync.
 */
export function needAFourthAlerts(input: {
  events: ClubEvent[];
  clubs: Club[];
  userId: string;
  now?: Date;
}): FourthAlert[] {
  const now = input.now ?? new Date();
  const clubsById = new Map(input.clubs.map((club) => [club.id, club]));
  const alerts: FourthAlert[] = [];

  for (const event of input.events) {
    if (event.status !== 'published') continue;
    if (viewerIsIn(event, input.userId)) continue;
    const club = clubsById.get(event.club_id);
    if (!club) continue;

    for (const table of event.event_tables) {
      const short = needsAFourth(
        table.capacity,
        confirmedOnTable(event, table.id),
        new Date(event.starts_at),
        now,
      );
      if (!short) continue;
      alerts.push({
        eventId: event.id,
        clubId: event.club_id,
        clubName: club.name,
        tableId: table.id,
        text: `${formatEventWhen(event.starts_at, club.timezone)} — ${event.title}`,
      });
    }
  }

  return alerts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run lib/dashboard.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.ts lib/dashboard.test.ts
git commit -m "feat: derive the dashboard's rows, chips and fourth-alerts

Pure module, no React and no network, so the artboard's new logic — club
scope, the merge of your games with open ones, the call for a fourth — is
testable without rendering.

needsAFourth is called, not reimplemented: lib/bookings.ts records that this
rule reached three copies before one drifted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `DateTile`

**Files:**
- Create: `components/DateTile.tsx`
- Test: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `colors`, `radius`, `type` from `lib/theme.ts`.
- Produces: `export default function DateTile({ startsAt, timezone }: { startsAt: string; timezone: string })`.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/dashboard-parts.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DateTile from '../DateTile';

describe('DateTile', () => {
  it('shows the weekday and date in the club timezone', () => {
    // 2026-09-03T01:00:00Z is still Wednesday the 2nd in New York.
    render(<DateTile startsAt="2026-09-03T01:00:00Z" timezone="America/New_York" />);
    expect(screen.getByText('WED')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('respects a different timezone for the same instant', () => {
    render(<DateTile startsAt="2026-09-03T01:00:00Z" timezone="Europe/London" />);
    expect(screen.getByText('THU')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: FAIL — `Failed to resolve import "../DateTile"`.

- [ ] **Step 3: Write the implementation**

Create `components/DateTile.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '../lib/theme';

/**
 * The artboard's little calendar chip at the head of each game row.
 *
 * Hidden from assistive tech on purpose: the row's meta line already carries
 * the full formatted date from `formatEventWhen`, so reading this out would
 * announce the same day twice. Same reasoning as SkillLevelPips, which is
 * aria-hidden beside the word it decorates.
 *
 * The design draws the tile's lip with `inset 0 -4px 0`. React Native has no
 * inset box-shadow, so it is a bottom border instead — visually the same
 * thing at this size.
 */
export default function DateTile({
  startsAt,
  timezone,
}: {
  startsAt: string;
  timezone: string;
}) {
  const when = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: timezone,
  })
    .format(when)
    .toUpperCase();
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    timeZone: timezone,
  }).format(when);

  return (
    <View
      style={styles.tile}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.day}>{day}</Text>
      <Text style={styles.date}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 52,
    height: 70,
    flexShrink: 0,
    borderRadius: radius.sm * 1.6,
    backgroundColor: colors.bg,
    borderBottomWidth: 4,
    borderBottomColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  date: {
    fontFamily: type.heading,
    fontSize: 24,
    lineHeight: 26,
    color: colors.text,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add components/DateTile.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat: add the game row's date tile

Formats in the club's own timezone, and is hidden from assistive tech
because the row's meta line already announces the same date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `Skeleton`

**Files:**
- Create: `components/Skeleton.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Produces: `export default function Skeleton({ delay }: { delay?: number })`. Renders with `testID="skeleton"`.

- [ ] **Step 1: Write the failing test**

Append to `components/__tests__/dashboard-parts.test.tsx`, and add `Skeleton` to the imports at the top of the file:

```tsx
import Skeleton from '../Skeleton';

describe('Skeleton', () => {
  it('renders a block that assistive tech ignores', () => {
    render(<Skeleton />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders one block per call so a stack can stagger them', () => {
    render(
      <>
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </>,
    );
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx -t Skeleton`
Expected: FAIL — `Failed to resolve import "../Skeleton"`.

- [ ] **Step 3: Write the implementation**

Create `components/Skeleton.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../lib/theme';

/**
 * One shimmering placeholder block, replacing the full-screen spinner while
 * the dashboard's own content loads. The artboard stacks three, staggered by
 * `delay`, which is why the stagger is a prop rather than baked in.
 *
 * `@keyframes shimmer { 0%, 100% { opacity: .5 } 50% { opacity: .9 } }` in
 * the design; a two-leg Animated sequence is the same curve.
 */
export default function Skeleton({ delay = 0 }: { delay?: number }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // The offset applies once, OUTSIDE the loop. Animated.loop resets and
    // restarts its whole child every iteration, so a `delay` on the first
    // timing leg would re-apply every cycle — giving the three blocks
    // periods of 1200/1350/1500ms and a pause at rest each time, instead of
    // the one-time offset CSS `animation-delay` describes.
    const loop = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.9,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.5,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    loop.start();
    // Stopped on unmount: a running loop holds a reference to the component's
    // Animated.Value and keeps ticking after the content has arrived.
    return () => loop.stop();
  }, [opacity, delay]);

  return (
    <Animated.View
      testID="skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    height: 86,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/Skeleton.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat: add the dashboard's shimmer skeleton block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `ClubChips`

**Files:**
- Create: `components/ClubChips.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `Chip` and `ALL_CLUBS` from `lib/dashboard.ts` (Task 1).
- Produces: `export default function ClubChips({ chips, selected, onSelect }: { chips: Chip[]; selected: string; onSelect: (id: string) => void })`.

- [ ] **Step 1: Write the failing test**

Append to `components/__tests__/dashboard-parts.test.tsx`, adding `fireEvent` to the `@testing-library/react` import and `vi` to the `vitest` import:

```tsx
import ClubChips from '../ClubChips';
import { ALL_CLUBS } from '../../lib/dashboard';

const CHIPS = [
  { id: ALL_CLUBS, label: 'All clubs' },
  { id: 'club-1', label: 'Riverside Mah Jongg' },
];

describe('ClubChips', () => {
  it('marks the selected chip and only that one', () => {
    render(<ClubChips chips={CHIPS} selected="club-1" onSelect={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Riverside Mah Jongg' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'All clubs' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('reports the chip that was pressed', () => {
    const onSelect = vi.fn();
    render(<ClubChips chips={CHIPS} selected={ALL_CLUBS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Riverside Mah Jongg' }));
    expect(onSelect).toHaveBeenCalledWith('club-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx -t ClubChips`
Expected: FAIL — `Failed to resolve import "../ClubChips"`.

- [ ] **Step 3: Write the implementation**

Create `components/ClubChips.tsx`:

```tsx
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Chip } from '../lib/dashboard';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's horizontal club switcher. Selection is presentation state
 * the dashboard owns; this component only reports presses.
 *
 * Not built from Button: the artboard's chip carries a leading dot only when
 * active and uses the body face rather than Button's heading face, and
 * bending Button that far is more code than the row it replaces.
 */
export default function ClubChips({
  chips,
  selected,
  onSelect,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => {
        const active = chip.id === selected;
        return (
          <Pressable
            key={chip.id}
            onPress={() => onSelect(chip.id)}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
            aria-selected={active}
            style={styles.chip}
          >
            {active ? <View style={styles.dot} /> : null}
            <Text style={styles.label}>{chip.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add components/ClubChips.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat: add the dashboard's club chip switcher

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tab-bar icons and `DashboardHeader`

Folded into one task: the header's empty-name fallback needs `PersonIcon`, and the same icon set the tab bar needs comes from the same artboard SVGs, so adding them once avoids touching `icons.tsx` twice.

**Files:**
- Modify: `components/icons.tsx`
- Create: `components/DashboardHeader.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `initialsFrom` from `lib/dashboard.ts` is **not** used here — the caller passes already-computed initials.
- Produces:
  - In `components/icons.tsx`: `HomeIcon`, `MessageIcon`, `PersonIcon`, `BellIcon`, each `({ size = 24, color = colors.text }: { size?: number; color?: string })`.
  - `export default function DashboardHeader({ kicker, name, meta, initials, onPressAvatar }: { kicker: string; name: string; meta: string; initials: string; onPressAvatar: () => void })`.

- [ ] **Step 1: Write the failing test**

Append to `components/__tests__/dashboard-parts.test.tsx`:

```tsx
import DashboardHeader from '../DashboardHeader';

describe('DashboardHeader', () => {
  it('shows the scope kicker, name and meta', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="All your clubs"
        meta="2 clubs"
        initials="JW"
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('All your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.getByText('JW')).toBeTruthy();
  });

  it('routes to the profile from the avatar', () => {
    const onPressAvatar = vi.fn();
    render(
      <DashboardHeader
        kicker="Your club"
        name="Riverside Mah Jongg"
        meta="Thursdays, 7pm"
        initials="JW"
        onPressAvatar={onPressAvatar}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(onPressAvatar).toHaveBeenCalled();
  });

  it('falls back to a glyph rather than inventing a letter', () => {
    render(
      <DashboardHeader
        kicker="Your clubs"
        name="All your clubs"
        meta="1 club"
        initials=""
        onPressAvatar={() => {}}
      />,
    );
    expect(screen.getByTestId('avatar-fallback')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx -t DashboardHeader`
Expected: FAIL — `Failed to resolve import "../DashboardHeader"`.

- [ ] **Step 3: Add the icons**

Append to `components/icons.tsx` (it already imports `Svg`, `Path`, `Circle` as needed — add `Circle` to the `react-native-svg` import if it is not there):

```tsx
export function HomeIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function MessageIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  );
}

export function PersonIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <Circle cx={12} cy={7} r={4} />
    </Svg>
  );
}

export function BellIcon({ size = 24, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </Svg>
  );
}
```

- [ ] **Step 4: Write the header**

Create `components/DashboardHeader.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PersonIcon } from './icons';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's dashboard header: scope on the left, the member on the
 * right.
 *
 * The artboard draws an up/down chevron beside the kicker, tapping through to
 * a separate "Your clubs" screen. This app keeps that list on this same
 * screen, so there is nowhere for the chevron to go and it is not drawn — an
 * affordance that does nothing is worse than none. The chips do the
 * switching.
 */
export default function DashboardHeader({
  kicker,
  name,
  meta,
  initials,
  onPressAvatar,
}: {
  kicker: string;
  name: string;
  meta: string;
  initials: string;
  onPressAvatar: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.scope}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.name}>{name}</Text>
        {meta.length > 0 ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        style={styles.avatar}
      >
        {initials.length > 0 ? (
          <Text style={styles.initials}>{initials}</Text>
        ) : (
          <View testID="avatar-fallback">
            <PersonIcon size={26} color={colors.bg} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  scope: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accentColor,
  },
  name: {
    fontFamily: type.heading,
    fontSize: 30,
    lineHeight: 35,
    color: colors.text,
    marginTop: 3,
  },
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 3,
  },
  avatar: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.accent2[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.bg,
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add components/icons.tsx components/DashboardHeader.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat: add the dashboard header and the artboard's tab icons

The avatar falls back to a person glyph rather than a placeholder letter: a
magic-link signup starts with an empty display_name, and a letter the member
never chose is worse than no letter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `NoticeBanner` and `NeedAFourthCard`

Folded into one task: the card's only job is to raise the banner, and neither is independently reviewable.

**Files:**
- Create: `components/NoticeBanner.tsx`, `components/NeedAFourthCard.tsx`
- Modify: `components/__tests__/dashboard-parts.test.tsx`

**Interfaces:**
- Consumes: `Card` from `components/Card.tsx`, `Button` from `components/Button.tsx`, `CheckIcon` from `components/icons.tsx`.
- Produces:
  - `export default function NoticeBanner({ message, onDismiss }: { message: string; onDismiss: () => void })`
  - `export default function NeedAFourthCard({ clubName, text, busy, onTake }: { clubName: string; text: string; busy: boolean; onTake: () => void })`

- [ ] **Step 1: Write the failing test**

Append to `components/__tests__/dashboard-parts.test.tsx`:

```tsx
import NoticeBanner from '../NoticeBanner';
import NeedAFourthCard from '../NeedAFourthCard';

describe('NoticeBanner', () => {
  it('shows the message and dismisses', () => {
    const onDismiss = vi.fn();
    render(<NoticeBanner message="You're in — Thursday night." onDismiss={onDismiss} />);
    expect(screen.getByText("You're in — Thursday night.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('NeedAFourthCard', () => {
  it('names the club in the kicker and carries the call text', () => {
    render(
      <NeedAFourthCard
        clubName="Riverside Mah Jongg"
        text="Thu, 3 Sep, 7:00 pm — Thursday night"
        busy={false}
        onTake={() => {}}
      />,
    );
    expect(screen.getByText('Need a 4th · Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thu, 3 Sep, 7:00 pm — Thursday night')).toBeTruthy();
  });

  it('takes the seat', () => {
    const onTake = vi.fn();
    render(<NeedAFourthCard clubName="Riverside" text="Tonight" busy={false} onTake={onTake} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm in — Tonight" }));
    expect(onTake).toHaveBeenCalled();
  });

  it('does not fire while a take is in flight', () => {
    const onTake = vi.fn();
    render(<NeedAFourthCard clubName="Riverside" text="Tonight" busy onTake={onTake} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm in — Tonight" }));
    expect(onTake).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx -t NoticeBanner`
Expected: FAIL — `Failed to resolve import "../NoticeBanner"`.

- [ ] **Step 3: Write `NoticeBanner`**

Create `components/NoticeBanner.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { CheckIcon } from './icons';
import { colors, space, type } from '../lib/theme';

/** The artboard's confirmation strip, raised after taking a seat. */
export default function NoticeBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <Card row background={colors.accent2[100]} style={styles.card}>
      <CheckIcon size={20} color={colors.accent2[700]} />
      <View style={styles.body}>
        <Text style={styles.text}>{message}</Text>
      </View>
      <Button
        variant="ghost"
        big={false}
        onPress={onDismiss}
        accessibilityLabel="Dismiss"
      >
        Dismiss
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  text: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 25,
    color: colors.accent2[800],
  },
});
```

- [ ] **Step 4: Write `NeedAFourthCard`**

Create `components/NeedAFourthCard.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's call for a fourth: an accent card with a red-dragon tile,
 * the club it belongs to, and one button that takes the seat.
 *
 * The glyph is 中 on a background-coloured tile, exactly as drawn. No custom
 * font is shipped for it — iOS and Android both cover the character in their
 * system fallback stack, and the design's own stack (Hiragino Mincho ProN,
 * Songti SC, Noto Serif SC) is a web nicety rather than a requirement.
 */
export default function NeedAFourthCard({
  clubName,
  text,
  busy,
  onTake,
}: {
  clubName: string;
  text: string;
  busy: boolean;
  onTake: () => void;
}) {
  return (
    <Card row elevated background={colors.accentColor} style={styles.card}>
      <View style={styles.tile}>
        <Text style={styles.glyph}>中</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.kicker}>{`Need a 4th · ${clubName}`}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
      <Button
        big={false}
        disabled={busy}
        onPress={onTake}
        accessibilityLabel={`I'm in — ${text}`}
        style={styles.action}
      >
        I&apos;m in
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  tile: {
    width: 38,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.sm * 1.4,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.accentColor,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.bg,
    opacity: 0.9,
  },
  text: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.bg,
    marginTop: 2,
  },
  action: {
    flexShrink: 0,
    minHeight: 46,
    backgroundColor: colors.bg,
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run components/__tests__/dashboard-parts.test.tsx`
Expected: PASS — 13 tests.

- [ ] **Step 6: Commit**

```bash
git add components/NoticeBanner.tsx components/NeedAFourthCard.tsx components/__tests__/dashboard-parts.test.tsx
git commit -m "feat: add the need-a-fourth card and its confirmation banner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `TabBar` and the Messages placeholder

**Files:**
- Create: `components/TabBar.tsx`, `app/messages.tsx`
- Create: `app/__tests__/tab-bar.test.tsx`

**Interfaces:**
- Consumes: `HomeIcon`, `MessageIcon`, `PersonIcon`, `BellIcon` from `components/icons.tsx` (Task 5); `Screen` from `components/Screen.tsx`.
- Produces:
  - `export type TabKey = 'club' | 'messages' | 'profile' | 'alerts'`
  - `export default function TabBar({ active }: { active: TabKey })`
  - `app/messages.tsx` default export `MessagesScreen`.

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/tab-bar.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TabBar from '../../components/TabBar';

const replace = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  Redirect: ({ href }: { href: string }) => <div data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  replace.mockClear();
});

describe('TabBar', () => {
  it('renders all four destinations', () => {
    render(<TabBar active="club" />);
    for (const label of ['Club', 'Messages', 'Profile', 'Alerts']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('marks only the active tab', () => {
    render(<TabBar active="profile" />);
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Club' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it.each([
    ['Club', '/clubs'],
    ['Messages', '/messages'],
    ['Profile', '/profile'],
    ['Alerts', '/notifications'],
  ])('routes %s to %s', (label, href) => {
    render(<TabBar active="club" />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(replace).toHaveBeenCalledWith(href);
  });

  it('does not navigate when the active tab is pressed', () => {
    render(<TabBar active="club" />);
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=America/New_York npx vitest run app/__tests__/tab-bar.test.tsx`
Expected: FAIL — `Failed to resolve import "../../components/TabBar"`.

- [ ] **Step 3: Write `TabBar`**

Create `components/TabBar.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BellIcon, HomeIcon, MessageIcon, PersonIcon } from './icons';
import { colors, space, type } from '../lib/theme';

export type TabKey = 'club' | 'messages' | 'profile' | 'alerts';

const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: 'club', label: 'Club', href: '/clubs' },
  { key: 'messages', label: 'Messages', href: '/messages' },
  { key: 'profile', label: 'Profile', href: '/profile' },
  { key: 'alerts', label: 'Alerts', href: '/notifications' },
];

function icon(key: TabKey, color: string) {
  if (key === 'club') return <HomeIcon color={color} />;
  if (key === 'messages') return <MessageIcon color={color} />;
  if (key === 'profile') return <PersonIcon color={color} />;
  return <BellIcon color={color} />;
}

/**
 * The artboard's four-tab bottom bar, rendered by each tab screen rather
 * than installed as an expo-router route group.
 *
 * A `(tabs)` group would put `app/(tabs)/clubs/index.tsx` in the same URL
 * namespace as the existing `app/clubs/[id]/` tree, and would move files that
 * several test files import by relative path. This carries the same bar with
 * no route restructuring. Migrating to expo-router's own `Tabs` is a
 * follow-up, not a prerequisite.
 *
 * `replace`, not `push`: tabs are peers, and pushing would grow a back stack
 * of every tab the member has ever tapped.
 */
export default function TabBar({ active }: { active: TabKey }) {
  const router = useRouter();

  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const tint = selected ? colors.accentColor : colors.neutral[700];
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (selected) return;
              router.replace(tab.href);
            }}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            aria-selected={selected}
            style={styles.tab}
          >
            {icon(tab.key, tint)}
            <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: space[2],
    paddingBottom: space[4],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: 58,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
  },
});
```

- [ ] **Step 4: Write the Messages placeholder**

Create `app/messages.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';

/**
 * A placeholder, and honest about it. The design's messages, thread and
 * compose screens describe club threads with replies; none of that exists
 * yet. The screen is here so the tab bar has four real destinations rather
 * than three and a dead one.
 *
 * The club broadcasts this app already has are a different feature — one-way,
 * organizer to club, no thread — and are reached from the club screen.
 */
export default function MessagesScreen() {
  const { session, loading } = useSession();

  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      <View style={styles.body}>
        <Text style={styles.heading}>Messages</Text>
        <Text style={styles.help}>
          Club messages are on the way. For now, organizers can reach everyone
          from their club&apos;s page.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[4],
  },
  body: {
    gap: space[3],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
});
```

- [ ] **Step 5: Add the `tabBar` slot to `Screen`**

`Screen` currently returns either a `ScrollView` or a `View` directly. The bar
must sit outside the scroller so it does not scroll away, so the two branches
become a `body` value that an optional shell wraps.

In `components/Screen.tsx`, add to `ScreenProps` after `contentStyle`:

```tsx
  /**
   * The app's bottom tab bar, for the four screens that are tabs. Rendered
   * outside the scroller: inside, it would scroll off the bottom of a long
   * dashboard, which is exactly where it is most needed.
   */
  tabBar?: ReactNode;
```

Add `tabBar` to the destructured parameters, then replace the whole body of
the component — everything from `const content = ...` to the final `}` before
`const styles` — with:

```tsx
  const content = <View style={[styles.content, contentStyle]}>{children}</View>;

  const body = scroll ? (
    <ScrollView
      // Test-only handle, no behaviour attached. On web this renders as
      // `data-testid`, which e2e/visual.spec.ts uses to measure how tall
      // this scroller's content actually is: react-native-web scrolls an
      // inner `overflow: auto` div rather than the document, so the page
      // itself never grows and a screenshot would otherwise stop at the
      // fold. See "Why the visual suite resizes the viewport" in
      // docs/testing.md.
      testID="screen-scroll"
      style={[styles.fill, { backgroundColor: background }]}
      contentContainerStyle={center ? styles.scrollCenter : null}
    >
      {content}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.fill,
        { backgroundColor: background },
        center ? styles.center : null,
      ]}
    >
      {content}
    </View>
  );

  if (!tabBar) return body;

  return (
    <View style={[styles.fill, { backgroundColor: background }]}>
      <View style={styles.tabShellBody}>{body}</View>
      {/*
        The bar is capped and centred like the content column rather than
        running full-bleed. On a desktop browser — a first-class case here,
        since club invite links open the web build — a 1400px-wide tab bar
        under a 440px column reads as a different app's chrome.
      */}
      <View style={styles.tabBarColumn}>{tabBar}</View>
    </View>
  );
}
```

Add to `Screen`'s `StyleSheet.create` call:

```tsx
  tabShellBody: {
    flex: 1,
    minHeight: 0,
  },
  tabBarColumn: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `TZ=America/New_York npx vitest run app/__tests__/tab-bar.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 7: Commit**

```bash
git add components/TabBar.tsx components/Screen.tsx app/messages.tsx app/__tests__/tab-bar.test.tsx
git commit -m "feat: add the artboard's four-tab bar and a Messages placeholder

The bar is a component the tab screens render, not an expo-router route
group: a (tabs) group would share a URL namespace with the existing
app/clubs/[id]/ tree and move files several tests import by path.

Screen gains a tabBar slot so the bar sits outside the scroller.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Rebuild `app/clubs/index.tsx`

**Files:**
- Modify: `app/clubs/index.tsx`
- Modify: `app/__tests__/clubs.test.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1–7, plus the existing `fetchMyClubs`, `fetchMyUpcomingBookings`, `fetchProfile`, `fetchUpcomingEvents`, `commitBooking`, and the untouched offer/waitlist/check-in handlers already in the file.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add to `app/__tests__/clubs.test.tsx`. Extend the existing `lib/events` mock factory to also stub nothing new (it already stubs `fetchUpcomingEvents`), add mocks for `lib/profile` and `commitBooking`, and add this describe block. Existing `CLUB`/booking fixtures in the file are reused.

```tsx
const fetchProfile = vi.fn();
const commitBooking = vi.fn();

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchMyUpcomingBookings: (...args: unknown[]) => fetchMyUpcomingBookings(...args),
    commitBooking: (...args: unknown[]) => commitBooking(...args),
  };
});

describe('dashboard artboard', () => {
  it('heads the page with the club count and the profile avatar', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue({ id: 'test-user', display_name: 'Jean Wu', skill_level: null, avatar_url: null, timezone: 'America/New_York' });

    render(<ClubsScreen />);

    expect(await screen.findByText('All your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.getByText('JW')).toBeTruthy();
  });

  it('narrows the games list to the picked club', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_id: 'e1', club_id: CLUB.id, club_name: CLUB.name, event_title: 'Riverside game' },
      { ...BOOKING, booking_id: 'b2', event_id: 'e2', club_id: 'club-2', club_name: 'Harbour', event_title: 'Harbour game' },
    ]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Riverside game')).toBeTruthy();
    expect(screen.getByText('Harbour game')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));

    expect(screen.queryByText('Riverside game')).toBeNull();
    expect(screen.getByText('Harbour game')).toBeTruthy();
    expect(screen.getByText('Your club')).toBeTruthy();
  });

  it('shows skeletons before the first load resolves', () => {
    fetchMyClubs.mockReturnValue(new Promise(() => {}));
    fetchMyUpcomingBookings.mockReturnValue(new Promise(() => {}));
    fetchUpcomingEvents.mockReturnValue(new Promise(() => {}));
    fetchProfile.mockReturnValue(new Promise(() => {}));

    render(<ClubsScreen />);

    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });

  it('takes a seat from a need-a-fourth card and raises the notice', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'e1',
        club_id: CLUB.id,
        title: 'Thursday night',
        starts_at: soon,
        status: 'published',
        event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({ result: {}, error: null });

    render(<ClubsScreen />);

    const take = await screen.findByRole('button', { name: /I'm in/ });
    fireEvent.click(take);

    await waitFor(() => expect(commitBooking).toHaveBeenCalled());
    expect(commitBooking.mock.calls[0][0]).toMatchObject({
      eventId: 'e1',
      players: ['test-user'],
      preferredTableId: 'table-1',
      allowSplit: false,
    });
    expect(await screen.findByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('surfaces a failed take without raising a notice', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'e1',
        club_id: CLUB.id,
        starts_at: soon,
        status: 'published',
        event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({ result: null, error: 'That seat just went.' });

    render(<ClubsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /I'm in/ }));

    expect(await screen.findByText('That seat just went.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('offers Join on an open game and Seated on a held one', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_id: 'mine', club_id: CLUB.id, club_name: CLUB.name, event_title: 'My game', status: 'confirmed' },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      { ...EVENT, id: 'open', club_id: CLUB.id, title: 'Open game', status: 'published', event_tables: [{ id: 't', capacity: 4, label: 'T' }], bookings: [] },
    ]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Seated')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Join Open game/ })).toBeTruthy();
  });

  it('shows the dashed empty state when nothing is coming up', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Nothing else coming up.')).toBeTruthy();
  });
});
```

Add `EVENT` and `BOOKING` fixtures near the file's existing `CLUB` fixture if
they are not already present, matching the shapes in `lib/dashboard.test.ts`
Task 1 Step 1. Add `waitFor` to the `@testing-library/react` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx -t "dashboard artboard"`
Expected: FAIL — the header text, chips, skeletons and cards do not exist yet.

- [ ] **Step 3: Rewrite the screen**

Modify `app/clubs/index.tsx`. Keep every existing handler
(`handleDecline`, `handleAcceptOffer`, `handleDeclineOffer`,
`handleLeaveWaitlist`, `handleCheckIn`, `setCheckInState`,
`runBookingAction`, `reloadBookings`) exactly as they are. The changes are:

1. **New state and fetches.** Alongside the existing `clubs` and `bookings`
   state, add:

```tsx
const [events, setEvents] = useState<ClubEvent[]>([]);
const [profileName, setProfileName] = useState('');
const [selected, setSelected] = useState<string>(ALL_CLUBS);
const [notice, setNotice] = useState<string | null>(null);
const [takeBusy, setTakeBusy] = useState(false);
```

   In the existing `useEffect`, after `fetchMyClubs` resolves, fan out over
   the clubs and load their events. `fetchProfile` runs alongside:

```tsx
fetchMyClubs().then(async (result) => {
  if (cancelled) return;
  if (result === null) {
    setLoadFailed(true);
    setReady(true);
    return;
  }
  setClubs(result);
  // One read per club. Chatty by design for now — collapsing these into a
  // single RPC is deferred item 8 in the spec, and wants the screen's shape
  // to settle first. Failures degrade to "no open games" rather than
  // blanking the screen: the member's own bookings are the load-bearing
  // half and they came from a different call.
  const perClub = await Promise.all(
    result.map((club) => fetchUpcomingEvents(club.id)),
  );
  if (cancelled) return;
  setEvents(perClub.filter((list): list is ClubEvent[] => list !== null).flat());
  setReady(true);
});

fetchProfile(userId).then((profile) => {
  if (cancelled) return;
  setProfileName(profile?.display_name ?? '');
});
```

2. **Derivations**, computed after the loading guards:

```tsx
const list = clubs ?? [];
const chips = buildChips(list);
const scope = headerScope(list, selected);
const rows = buildDashboardRows({
  bookings: bookings ?? [],
  events,
  clubs: list,
  userId: userId ?? '',
}).filter((row) => inScope(row.clubId, selected));
const alerts = needAFourthAlerts({
  events,
  clubs: list,
  userId: userId ?? '',
}).filter((alert) => inScope(alert.clubId, selected));
```

3. **Taking a seat**, a new handler beside the existing ones:

```tsx
async function takeSeat(alert: FourthAlert) {
  setTakeBusy(true);
  setActionError(null);
  const { error } = await commitBooking({
    eventId: alert.eventId,
    players: [userId ?? ''],
    preferredTableId: alert.tableId,
    allowSplit: false,
  });
  setTakeBusy(false);
  if (error) {
    setActionError(error);
    return;
  }
  setNotice(`You're in — ${alert.text}.`);
  await reloadBookings();
}
```

   `joinGame` is the same call with `preferredTableId: null`, and raises no
   notice — the row flipping from Join to Seated is its own confirmation:

```tsx
async function joinGame(row: DashboardRow) {
  setTakeBusy(true);
  setActionError(null);
  const { error } = await commitBooking({
    eventId: row.eventId,
    players: [userId ?? ''],
    preferredTableId: null,
    allowSplit: false,
  });
  setTakeBusy(false);
  if (error) {
    setActionError(error);
    return;
  }
  await reloadBookings();
}
```

4. **The loading branch** replaces its `ActivityIndicator` with skeletons:

```tsx
if (!ready) {
  return (
    <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <View style={styles.list}>
        <Skeleton />
        <Skeleton delay={150} />
        <Skeleton delay={300} />
      </View>
    </Screen>
  );
}
```

5. **The returned tree**, replacing everything from the current
   `<Screen scroll contentStyle={styles.container}>` to its close:

```tsx
return (
  <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
    <DashboardHeader
      kicker={scope.kicker}
      name={scope.name}
      meta={scope.meta}
      initials={initialsFrom(profileName)}
      onPressAvatar={() => router.push('/profile')}
    />

    {list.length > 1 ? (
      <ClubChips chips={chips} selected={selected} onSelect={setSelected} />
    ) : null}

    {notice ? (
      <NoticeBanner message={notice} onDismiss={() => setNotice(null)} />
    ) : null}

    {actionError ? <ErrorBanner message={actionError} /> : null}

    {alerts.map((alert) => (
      <NeedAFourthCard
        key={`${alert.eventId}:${alert.tableId}`}
        clubName={alert.clubName}
        text={alert.text}
        busy={takeBusy}
        onTake={() => void takeSeat(alert)}
      />
    ))}

    <Text style={styles.sectionTitle}>Your games</Text>

    {bookingsFailed ? (
      <Text style={styles.help}>Could not load your games.</Text>
    ) : rows.length === 0 ? (
      <View style={styles.emptyCard}>
        <Text style={styles.help}>Nothing else coming up.</Text>
        {selected !== ALL_CLUBS ? (
          <Button
            variant="secondary"
            big={false}
            onPress={() => router.push(`/clubs/${selected}/events/new`)}
            accessibilityLabel="Host a table"
          >
            Host a table
          </Button>
        ) : null}
      </View>
    ) : (
      rows.map((row) => (
        <GameRow
          key={row.eventId}
          row={row}
          youId={userId}
          busy={actionBusy}
          takeBusy={takeBusy}
          checkInBusy={checkInBusy}
          onJoin={joinGame}
          onDecline={handleDecline}
          onAcceptOffer={handleAcceptOffer}
          onDeclineOffer={handleDeclineOffer}
          onLeaveWaitlist={handleLeaveWaitlist}
          onCheckIn={handleCheckIn}
        />
      ))
    )}

    <Text style={styles.sectionTitle}>Your clubs</Text>

    {/* unchanged from the current file: the empty-state copy, the club
        Link/Pressable/Card list, and the "Start a club" / "Start another
        club" buttons. The trailing "Your profile" Link is deleted — the
        header's avatar is that affordance now. */}
  </Screen>
);
```

6. **`BookingCard` becomes `GameRow`.** Rename it, change its prop from
   `booking: MyBooking` to `row: DashboardRow`, and add `onJoin` and
   `takeBusy`. At the top of the body:

```tsx
const booking = row.booking;
```

   Everything the old component computed from `booking` (`hasOffer`,
   `offerLive`, `notStarted`, `showCheckIn`, `seatStatus`, `bookedByOther`)
   stays byte-for-byte identical, guarded by `booking !== null` — a joinable
   row has no booking and none of those controls apply. Its returned tree
   becomes:

```tsx
return (
  <Card>
    <View style={styles.gameRow}>
      <DateTile startsAt={row.startsAt} timezone={row.timezone} />
      <View style={styles.gameBody}>
        <Text style={styles.gameKicker}>{row.clubName}</Text>
        <Text style={styles.gameTitle}>{row.title}</Text>
        <Text style={styles.help}>
          {formatEventWhen(row.startsAt, row.timezone)}
          {' · '}
          {row.venueName}
        </Text>
      </View>
      {booking === null ? (
        <Button
          variant="secondary"
          big={false}
          disabled={takeBusy}
          onPress={() => onJoin(row)}
          accessibilityLabel={`Join ${row.title}`}
          style={styles.gameAction}
        >
          Join
        </Button>
      ) : booking.status === 'confirmed' ? (
        <Tag variant="accent2">Seated</Tag>
      ) : null}
    </View>

    {/* Everything below is the old BookingCard body, unchanged, wrapped in
        a `booking !== null` guard: seatStatus, the offer countdown and its
        two buttons, the lapsed-offer branch, the decline button, the leave-
        waitlist button, and CheckInControl. */}
  </Card>
);
```

7. **New styles** to add to the file's `StyleSheet.create` call:

```tsx
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  gameBody: {
    flex: 1,
    minWidth: 0,
  },
  gameKicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  gameTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: 1,
  },
  gameAction: {
    flexShrink: 0,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[2],
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
```

   Add `radius` to the file's `lib/theme` import.

   **Delete only these styles:** `linkRow` and `link` (used solely by the
   deleted "Your profile" link) and `gamesSection` (used solely by the
   replaced games section).

   **Keep `heading`, `centered`, and the `ActivityIndicator` import.** Two
   branches above the main tree still use them and are NOT changed by this
   task:

   - the `loading` (auth) branch renders `<View style={styles.centered}>`
     around an `ActivityIndicator` — that is an auth gate, not content
     loading, and the spec keeps its spinner
   - the `loadFailed` branch renders `<Text style={styles.heading}>Your
     clubs</Text>` above an `ErrorBanner`

   Both branches also gain the tab bar, so the member is not stranded:

```tsx
if (loading) {
  return (
    <Screen tabBar={<TabBar active="club" />}>
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </View>
    </Screen>
  );
}
```

```tsx
if (loadFailed) {
  return (
    <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <Text style={styles.heading}>Your clubs</Text>
      <ErrorBanner message={GENERIC_ERROR} />
    </Screen>
  );
}
```

- [ ] **Step 4: Update the existing assertions**

Run the whole file and fix the tests that assert removed text:

Run: `TZ=America/New_York npx vitest run app/__tests__/clubs.test.tsx`

Expected failures and their fixes:
- `Your games` as a *heading* — the section title survives with the same
  text, so these should pass unchanged. If a test asserted the heading only
  rendered when a booking existed, it now always renders; assert on the row
  content instead.
- `Your profile` link — deleted. Change any test that clicked it to click the
  avatar: `screen.getByRole('button', { name: 'Your profile' })`.
- Tests asserting `screen.getByText(CLUB.name)` as the page heading now find
  it twice (header and club list) when one club is selected. Scope those with
  `getAllByText(...)[0]` or assert on the club list's `Pressable` by role.

- [ ] **Step 5: Run the full suite**

Run: `TZ=America/New_York npx vitest run`
Expected: PASS — every test file green. The tab bar touches only screens that
render it, so no other screen's tests should move; if one does, read the
failure before changing the test.

- [ ] **Step 6: Commit**

```bash
git add app/clubs/index.tsx app/__tests__/clubs.test.tsx
git commit -m "feat: rebuild the dashboard to the 1C club artboard

Switcher header with the initials avatar, club chips, need-a-fourth cards,
date-tile game rows carrying Seated or Join, dashed empty state, skeletons
in place of the spinner, and the four-tab bar.

Offers, waitlist, decline and check-in keep their exact behaviour; they move
inside the new row rather than changing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Mount the tab bar on Profile and Alerts

**Files:**
- Modify: `app/profile.tsx`, `app/notifications.tsx`
- Modify: `app/__tests__/profile.test.tsx`, `app/__tests__/notifications.test.tsx`

**Interfaces:**
- Consumes: `TabBar`, `TabKey` from `components/TabBar.tsx` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `app/__tests__/profile.test.tsx`, inside its existing top-level
`describe`. Its `expo-router` mock already provides `useRouter`, so no mock
change is needed:

```tsx
it('carries the tab bar with Profile marked', async () => {
  // Arrange exactly as the file's existing "renders the form" test does.
  render(<ProfileScreen />);
  expect(await screen.findByRole('button', { name: 'Profile' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
});
```

Add the mirror to `app/__tests__/notifications.test.tsx`, asserting
`{ name: 'Alerts' }` is selected.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TZ=America/New_York npx vitest run app/__tests__/profile.test.tsx app/__tests__/notifications.test.tsx -t "tab bar"`
Expected: FAIL — no button named `Profile` / `Alerts` in either tree.

- [ ] **Step 3: Mount the bar**

In `app/profile.tsx`, import `TabBar` and pass it to the screen's main
`Screen`, leaving the loading and redirect branches alone:

```tsx
import TabBar from '../components/TabBar';
```

```tsx
<Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
```

Do the same in `app/notifications.tsx` with `active="alerts"`.

The profile screen keeps its existing back button: the bar switches between
peers, and the back chevron returns to whatever pushed the screen, which is
not always a tab.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `TZ=America/New_York npx vitest run app/__tests__/profile.test.tsx app/__tests__/notifications.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `TZ=America/New_York npx vitest run`
Expected: PASS — every file.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/profile.tsx app/notifications.tsx app/__tests__/profile.test.tsx app/__tests__/notifications.test.tsx
git commit -m "feat: mount the tab bar on Profile and Alerts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Open the pull request

**Files:** none — this task only pushes and opens the PR.

**Interfaces:**
- Consumes: a green suite from Task 9.
- Produces: a pull request from `feat/dashboard-artboard`.

- [ ] **Step 1: Confirm the suite and the typecheck are green**

Run: `TZ=America/New_York npx vitest run`
Expected: PASS — every file.

Run: `npx tsc --noEmit`
Expected: no output.

Do not proceed past a failure. A PR opened on a red branch is worse than no
PR.

- [ ] **Step 2: Confirm nothing under `supabase/` changed**

Run: `git diff --stat main...HEAD -- supabase/`
Expected: no output. This plan adds no SQL; any diff here is a mistake.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/dashboard-artboard
```

- [ ] **Step 4: Open the PR against `feat/check-in`**

The base is `feat/check-in`, **not** `main`: this branch is stacked on it and
renders `MyBooking.check_in_required` and `CheckInControl`, which only exist
there. If PR #7 has already merged by this point, rebase onto `main` first
(`git fetch origin && git rebase origin/main`) and use `--base main` instead.

```bash
gh pr create --base feat/check-in --title "Dashboard — the 1C club artboard" --body "$(cat <<'EOF'
Brings `app/clubs/index.tsx` to the `1C club` artboard from
`.superpowers/design/MahjHero.dc.html`, and adds the artboard's four-tab
bottom bar.

The design never moved — the canvas in the Claude Design project is
byte-identical to the copy already committed under `.superpowers/design`. The
app had drifted from it.

## What changed

- **Header** — club-scope kicker, name and meta, with an initials avatar that
  replaces the old bottom "Your profile" link.
- **Club chips** — `All clubs` plus one per club, filtering the games list and
  the header. Hidden for single-club members.
- **Need a 4th** — accent cards for tables one seat short and starting inside
  48 hours, with an "I'm in" that books the seat.
- **Game rows** — date tile, club kicker, title and meta, with `Seated` or a
  `Join` button. The list now merges your bookings with open games you are
  not in.
- **Skeletons** replace the full-screen spinner; the empty state is the
  artboard's dashed card.
- **Tab bar** — Club / Messages / Profile / Alerts. Messages is a placeholder;
  the other three route to screens that already existed.

## What did not change

No migration, no new RPC, nothing under `supabase/`. Promotion offers,
waitlist management, decline and check-in keep their exact behaviour — they
move inside the new row layout rather than changing.

## Notes for review

- `lib/dashboard.ts` holds all the new derivation as pure functions, unit
  tested without rendering.
- `needsAFourth` is called, not reimplemented. `lib/bookings.ts` records that
  this rule reached three copies before one drifted out of sync.
- The tab bar is a component the four tab screens render, not an expo-router
  `(tabs)` group — a group would share a URL namespace with the existing
  `app/clubs/[id]/` tree. Migrating to `Tabs` is a follow-up.
- Deliberate deviations from the artboard, and the ten items deferred to a
  later pass, are recorded in
  `docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Report the PR URL**

Paste the URL `gh` prints back to the user. Do not merge it.

---

## Self-Review

**Spec coverage.** Header → Task 5. Chips → Task 4 + 8. Notice banner →
Task 6 + 8. Skeletons → Task 3 + 8. Need-a-fourth cards → Task 1 + 6 + 8.
Section header, game rows, Join, Seated → Task 1 + 2 + 8. Empty state →
Task 8. Your clubs list → Task 8 (unchanged). Tab bar and Messages → Task 7 +
9. Every spec deviation is carried in a code comment where it applies. All
ten deferred items stay deferred; no task touches them.

**Naming consistency.** `ALL_CLUBS`, `buildChips`, `headerScope`,
`initialsFrom`, `inScope`, `buildDashboardRows`, `needAFourthAlerts`,
`DashboardRow`, `FourthAlert`, `Chip`, `HeaderScope` are defined in Task 1 and
used with those exact names in Tasks 4, 5 and 8. `TabKey` and `TabBar` are
defined in Task 7 and used in Tasks 7, 8 and 9. `Skeleton`'s `delay` prop,
`DateTile`'s `startsAt`/`timezone`, `NeedAFourthCard`'s `busy`/`onTake` and
`NoticeBanner`'s `message`/`onDismiss` match their call sites in Task 8.

**Known soft spot.** Task 8 Step 4 lists expected test failures rather than
final assertions, because the current file's 27 tests were not read line by
line while writing this plan. The implementer should read each failure before
editing the test — a failure that is not in that list may be a real
regression, not churn.
