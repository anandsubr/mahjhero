# Dashboard follow-ups — design

Date: 2026-08-26
Branch: `feat/dashboard-artboard` (follow-up on unmerged work, not a fork off `main`)

Nineteen items raised against the dashboard artboard branch: six UX gaps found
by using the app, thirteen from the pre-PR code review. Two of the nineteen
turned out to be already closed. One turned out to be larger than reported.

## Already closed — no work

**Item 7** — `app/messages.tsx`'s loading state omitting `contentStyle`. It is
present (`<Screen center contentStyle={styles.centered} tabBar=…>`), added in
`3a52fc4`.

**Item 8** — `hostClubId`'s `list.length === 1` fallback being undocumented. An
eleven-line comment above it covers exactly that fallback and why the
alternative gate hid the button from the member most likely to want it. Also
`3a52fc4`.

Both items were raised against a commit older than the branch head.

## Item 1 — club selector: no change

Raised, then withdrawn. The chip row's `list.length > 1` gate and the
non-interactive header stand as they are. `DashboardHeader`'s comment already
records why the artboard's chevron is not drawn.

## Item 2 — game tiles open the game

Each `GameRow` in `app/clubs/index.tsx` is inert. The date tile and the
title block become a `Link` to `/clubs/{clubId}/events/{eventId}`.

The press target deliberately stops short of the whole card. A row can carry a
`Join` button, a `Seated` tag, offer accept/decline buttons, a leave-waitlist
button and a check-in control; nesting those inside a card-wide pressable puts
two competing press targets on the same pixels. Wrapping only the date tile and
the `gameBody` column leaves every control with its own unambiguous target.

`Link asChild` wraps a `Pressable`, not `Card` — the reason the file already
documents at length for the club cards below it: `Card` neither declares
accessibility props nor spreads unrecognised ones onto its `View`, so cloning
onto it silently drops the injected handler.

Accessibility label: `Open {row.title}`.

## Item 3 — sign out

Today: a left-aligned ghost text button, which is what the artboard draws and
what reads as an odd stray link.

`Button` gains a fourth variant, `destructive`: `colors.accent[200]` ground with
`colors.accent[800]` text, measuring 8.37:1. Profile renders it `block` at the
foot of the screen. The `signOut` style's `alignSelf: 'flex-start'` goes.

The variant is added to `Button` rather than styled inline at the call site so
the next destructive action in this app inherits one treatment.

## Item 4 — profile's back link

Profile carries a "← Clubs" ghost button, added when profile was reachable only
by pushing onto a stack. The tab bar now sits under every tab screen and its
Club tab is the same destination. The button, its `ChevronLeftIcon` import and
its `backButton` style are removed.

## Item 5 — club and venue chrome

`app/clubs/[id]/index.tsx` and `app/clubs/[id]/venues.tsx` are the two screens a
member reaches most often from the dashboard, and neither carries the app's
header or its bottom bar. Both get `DashboardHeader` and `TabBar active="club"`.

`TabBar` goes on **every** state, including the loading and error early returns
— the same rule `3a52fc4` applied to the other tab screens, and for the same
reason: `TabBar` navigates with `router.replace` off an entry route that is
itself a `Redirect`, so a barless error state is a dead end.

`DashboardHeader` goes on the **ready** state only. Its kicker, name and meta
all read from the fetched club, which by definition has not arrived in the
loading state and did not arrive at all in the error state. Drawing a header
with an empty name there would be worse than the spinner it replaced. The
loading and error states keep the spinner and the error text they have, now
above a tab bar.

| Screen | kicker | name | meta | back button |
|---|---|---|---|---|
| Club detail | `Your club` | `club.name` | `club.rhythm` | removed — the Club tab is the same destination |
| Venues | `club.name` | `Venues` | none | kept — no tab reaches a specific club |

### `useViewerInitials`

Both screens need the signed-in member's initials for the header avatar, and
`app/clubs/index.tsx` already derives them from its own `profileName` state and
a `fetchProfile` call in its mount effect. Rather than a third copy, a
`useViewerInitials()` hook in `lib/use-viewer.ts` owns it: reads the session,
fetches the profile keyed on the user id, returns `initialsFrom(display_name)`,
returning `''` until the fetch resolves and on any failure.

Keyed on `session?.user.id`, not `session` — `lib/session.tsx` hands out a fresh
object on every `TOKEN_REFRESHED`, and depending on the object would refetch
within the hour for nothing. The same reasoning the profile screen already
records.

`''` is a real state, not an error: a magic-link signup starts with an empty
`display_name`, and `DashboardHeader` already draws a person glyph rather than
inventing a letter the member never chose.

The dashboard drops its `profileName` state and calls the hook.

## Item 6 — the signed-out welcome screen

`resolveIndexRedirect` currently sends a signed-out visitor straight to
`/sign-in`. The artboard's welcome screen — the app's actual front door — was
never built.

New route `app/welcome.tsx`, and `resolveIndexRedirect`'s signed-out branch
returns `/welcome` instead of `/sign-in`.

Contents, top to bottom:

1. **Tile hero** — three mahjong tiles on `colors.surface`, the outer two
   rotated ∓6°/+5°, the third on `accentColor` carrying 中. Drawn with
   `react-native-svg`, already a dependency.
2. **Headline** — "Your club's table, always set." at `type.size.display`.
3. **Subcopy** — "Find a game, keep your seat, and let the club know when
   you're in."
4. **Explainer card** — a fixed card in the artboard's invitation slot on
   `accent2[100]`, reading as an explainer rather than an invitation: an
   `Invites` tag, then "Someone will send you a link to their club. Open it on
   this device and you'll land straight inside." The artboard's mock copy
   ("Sara Lindqvist invited you to Riverside Mah Jongg") is **not** shipped —
   a fabricated invitation naming a person who does not exist is a control a
   member would tap.
5. **Buttons** — `Get started` (primary, block, big) and `I already have an
   account` (secondary, block, big). Both route to `/sign-in`; the artboard
   draws both and they are the same destination there too.

A session appearing while the screen is mounted redirects to `/` — the same
guard `app/sign-in.tsx` carries, and for the same reason: `app/index.tsx` has
already unmounted, and it is the only place that knows about a parked invite.

`app/sign-in.tsx` gains the artboard's `← Back` ghost button to `/welcome`.

## Items 9–17, 19 — review follow-ups

**9. Zero-alert two-table case.** `lib/dashboard.test.ts` covers one short
table, both tables short, and the single-table negatives, but never two tables
that both have room. Add `stays silent when neither table is short`.

**10. `initialsFrom` and astral characters.** `word[0]` takes one UTF-16 code
unit, so a name beginning with an astral character yields a lone unpaired
surrogate — a replacement glyph in the avatar. Iterate code points instead
(`Array.from(word)[0]`). Test with an astral first character.

**11. Unparseable dates throw.** `formatEventWhen`, `eventStartTimeInZone` and
`DateTile` all hand `new Date(startsAt)` to `Intl.DateTimeFormat.format`, which
throws `RangeError` on an invalid date. A malformed `starts_at` from the server
takes down the whole dashboard rather than one row. Each guards
`Number.isNaN(date.getTime())`:

| Function | Returns |
|---|---|
| `formatEventWhen` | `'Date unavailable'` |
| `eventStartTimeInZone` | `''` — an empty `TimeField`, which is the honest state for a value that cannot be read |
| `DateTile` | `--` in both the day and date slots |

**12. `useNativeDriver` on web.** `Skeleton` animates opacity with
`useNativeDriver: true`, which logs a fallback warning on every web render.
`useNativeDriver: Platform.OS !== 'web'`.

**13. Three test gaps.**
- `Skeleton`'s `delay` prop is passed by three call sites and asserted by none.
  Spy `Animated.delay` and assert the 0/150/300 stagger.
- `buildDashboardRows`'s `drops a full event, a cancelled one, and one already
  started` asserts three independent exclusion paths through one expectation, so
  any two can regress silently. Split into three.
- `drops the need-a-fourth card once the same game has been joined`
  (`app/__tests__/clubs.test.tsx`) never asserts the card was there first, so it
  would pass against a screen that never rendered one. Add the pre-assertion.

**14. `ClubChips`'s bare `2`.** The artboard's literal `padding-bottom: 2px`
scroll gutter. No spacing token is 2 and inventing one to hold a single
literal pollutes a scale whose smallest step is 4.4. It becomes a named
module constant with a comment recording where the 2 comes from.

**15. The waitlist notice is bare.** A seated take says `You're in — Fri 5 Sep,
7:00 pm — Club Night`; the waitlist half of the same outcome says only `2nd on
the waitlist`, naming nothing. `waitlistNotice` takes the game's description as
a second argument and appends it, so both halves of both call sites name the
game. `joinGame` builds its description the way the alert does:
`${formatEventWhen(row.startsAt, row.timezone)} — ${row.title}`.

**16. No cancellation guard.** `reloadAfterBooking` — and the `takeSeat`,
`joinGame` and `runBookingAction` paths that await it — call `setState` after an
await with nothing checking the component is still mounted. A `useRef(true)`
cleared in an unmount effect guards every post-await write.

**17. Interleaving actions.** `takeBusy` (take/join) and `actionBusy`
(decline/offer/waitlist) are independent, so a member can start a decline while
a join is in flight and the two reloads race. They collapse into one `busy`
flag covering every booking write. `checkInBusy` stays separate by design — the
check-in control is optimistic, single-person, and deliberately does not wait on
the server.

**19. The spec's tab-bar paragraph.**
`docs/superpowers/specs/2026-08-25-dashboard-artboard-design.md` says the bar is
"Introduced as an expo-router layout so it persists across the tabbed screens."
It is not: `components/TabBar.tsx` is rendered by each screen through `Screen`'s
`tabBar` prop, and its own comment explains why a `(tabs)` group would collide
with the existing `app/clubs/[id]/` tree. Correct the paragraph to describe what
shipped, and record the expo-router migration as the follow-up it is.

## Item 18 — `textMuted` fails AA everywhere

Reported as a stale comment. The comment claims flattening `textMuted` is safe
"because muted text is only ever placed directly on the page background, never
on a card" — and this branch does put it on cards, at 3.17:1.

Measuring the premise: `textMuted` `#807a71` on `colors.bg` `#f5ead8` is
**3.57:1**. It never cleared AA's 4.5:1 on the background either. The comment
was not describing a safe arrangement that this branch broke; it was describing
a failure that had always been there, and fixing only the comment would leave
it standing.

`textMuted` darkens to **`#676158`** — a 65% mix of `text` over `surface`,
flattened the same way as before:

| Ground | Old `#807a71` | New `#676158` |
|---|---|---|
| `bg` `#f5ead8` | 3.57:1 ✗ | **5.15:1 ✓** |
| `surface` `#ebddc5` | 3.17:1 ✗ | **4.58:1 ✓** |

One token, so every screen in the app is fixed at once rather than only this
branch's. Still clearly muted against `text` `#201e1d`. The rejected
alternative — a second `textMutedOnSurface` token — fixes cards and leaves the
background failure in place.

The comment is rewritten to state the measured ratios on both grounds and to
drop the "only on the page background" claim, so the next person to move the
palette knows what the number has to clear.

## Testing

Existing suite: `npm test` (vitest, `TZ=America/New_York`).

New coverage:

- `app/__tests__/welcome.test.tsx` — hero, headline, explainer card and both
  buttons render; both route to `/sign-in`; a session redirects to `/`.
- `app/__tests__/index.test.ts` — the signed-out branch now resolves
  `/welcome`.
- `app/__tests__/clubs.test.tsx` — a game row navigates to its event; the
  need-a-fourth pre-assertion.
- `app/__tests__/clubs.test.tsx` (its existing `club detail screen` describe)
  and `app/__tests__/venues.test.tsx` — the header renders in the ready state
  and the tab bar renders in all three. Both screens already have a test
  harness in those files; a new file per screen would duplicate the mocks.
- `app/__tests__/profile.test.tsx` — no back link; sign out is a block
  destructive button.
- `lib/dashboard.test.ts` — the zero-alert two-table case; `initialsFrom` on an
  astral first character; three split exclusion tests.
- `lib/events.test.ts` — `formatEventWhen` and `eventStartTimeInZone` on an
  unparseable date.
- `components/__tests__/dashboard-parts.test.tsx` — `Skeleton`'s stagger;
  `DateTile` on an unparseable date.
- `components/__tests__/Button.test.tsx` — the `destructive` variant.

## Out of scope

- Migrating the tab bar to an expo-router `Tabs` layout (item 19 records it as
  a follow-up; it is not done here).
- The artboard's separate "Your clubs" screen, and the header chevron that
  would open it (item 1, withdrawn).
- "Clubs near you" discovery, which the artboard draws and nothing behind it
  exists for.
