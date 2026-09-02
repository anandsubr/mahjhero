# A way back from every screen you push into — design

**Date:** 2026-09-01
**Base branch:** cut from `main` — none of the four screens depend on the
club-dashboard work in flight

---

## The problem

Four screens in the app can be navigated into and offer no way out.

The one that surfaced it: the clubs dashboard now opens a club from its
header, and [app/clubs/[id]/index.tsx](../../../app/clubs/[id]/index.tsx) —
the club's roster, invites, venues and import — has no back affordance at all.
Its only route back to `/clubs` is the `Club` tab, which renders as the active
tab on that screen. An active tab reads "you are here", not "go back", so the
way out is there but invisible.

Sweeping the rest of the app for the same shape turns up three more. Every
other screen without a back link is a tab root or an entry point, where back
is meaningless.

| Screen | Reached from | Has no way back to |
| --- | --- | --- |
| `app/clubs/[id]/index.tsx` | the dashboard header | `/clubs` |
| `app/clubs/new.tsx` | the dashboard | `/clubs` |
| `app/messages/new.tsx` | the messages list | `/messages` |
| `app/clubs/[id]/events/[eventId]/check-in.tsx` | the event screen | that game |

`app/clubs/[id]/broadcast.tsx` and `broadcasts.tsx` are **not** on this list.
Both are pure redirects — a spinner and a `router.replace`, kept alive so
URLs in already-sent emails do not 404. There is nothing to go back from.

---

## The shape

The app already has this control, five times over:
`app/clubs/[id]/venues.tsx`, `import.tsx`, `events/new.tsx`,
`events/[eventId]/index.tsx` and `events/[eventId]/edit.tsx` each open with a
ghost `Button` carrying a `ChevronLeftIcon`, aligned to the start of the
content, above the header. This adds the same control to the four screens
that missed it. Nothing new is designed.

```tsx
<Button
  variant="ghost"
  big={false}
  icon={<ChevronLeftIcon color={colors.accentColor} />}
  onPress={() => router.push('/clubs')}
  accessibilityLabel="Back to your clubs"
  style={styles.backButton}
>
  Clubs
</Button>
```

**An explicit destination, never `router.back()`.** The reason is recorded in
`check-in.tsx`'s own comment: `TabBar` navigates with `router.replace` off an
entry route that is itself a `<Redirect>`, so the history stack is typically
one deep and `router.back()` has nowhere to go. Every existing back button in
this app pushes a known route, and these four do the same.

| Screen | Label | Pushes | Accessible name |
| --- | --- | --- | --- |
| `clubs/[id]/index.tsx` | `Clubs` | `/clubs` | `Back to your clubs` |
| `clubs/new.tsx` | `Clubs` | `/clubs` | `Back to your clubs` |
| `messages/new.tsx` | `Messages` | `/messages` | `Back to messages` |
| `check-in.tsx` | `Game` | `/clubs/${clubId}/events/${eventId}` | `Back to the game` |

The visible label names the destination, not the action — `Clubs`, not
`Back` — matching every existing instance. The accessible name says both,
because a screen-reader user hears the button out of its visual context.

The button renders in the same place each time: first child of the populated
`Screen`, above `DashboardHeader` where there is one,
`style={{ alignSelf: 'flex-start' }}` so it does not stretch to the column
width. It is drawn only on the populated render — the loading, redirect and
fatal-error branches keep the tab bar they already carry, and a back button
above a spinner would be a control over content that has not arrived.

`check-in.tsx` needs `clubId` and `eventId` for its destination. Both are
already read from `useLocalSearchParams` at the top of the component.

---

## What this touches

Four screens, one control each: `app/clubs/[id]/index.tsx`,
`app/clubs/new.tsx`, `app/messages/new.tsx`,
`app/clubs/[id]/events/[eventId]/check-in.tsx`. Each needs the `Button` and
`ChevronLeftIcon` imports it does not already have, and a `backButton` style.

**Tests.** One per screen, asserting the button is present and pushes the
right route. The four covering suites are `app/__tests__/clubs.test.tsx`,
`clubs-new.test.tsx`, `messages-new.test.tsx` and `check-in.test.tsx`; each
already mocks `useRouter` with a `push` spy, which is the whole mechanism.

The `club detail`, `check-in` and `message-new` visual baselines gain a row
of chrome at the top and regenerate.

---

## Not in scope

**Tab roots and entry points.** `app/clubs/index.tsx`, `friends.tsx`,
`messages/index.tsx`, `profile.tsx`, `index.tsx`, `welcome.tsx`,
`auth/callback.tsx` and `join/[token].tsx` have no back link and should not
get one.

**Making `TabBar` push rather than replace.** That would give the app a real
history stack and make `router.back()` viable everywhere, retiring the
explicit-destination rule. It is a much larger change with its own risks, and
this document does not depend on it either way.
