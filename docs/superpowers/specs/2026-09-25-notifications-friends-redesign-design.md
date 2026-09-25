# Notifications & Friends redesign

Source: `design_handoff_notifications_friends` (1a Notifications, 1b Friends).
Brings the two Profile sub-screens into the game form / Profile language:
back row, left-aligned Caprasimo title, grouped `surface` cards, pill
toggles, slim tab bar with Profile active.

## Decisions (agreed 2026-09-25)

- **Names:** Friends keeps the full display name and two-letter initials.
  The handoff's "Anand, not Anand 0" came from a test account whose display
  name really is "Anand 0"; the app adds nothing.
- **Saving:** Notifications uses the handoff's save bar, not auto-save.
- **Remove friend:** no undo toast — a removed friend reappears under
  "People in your clubs", one tap from being re-added.
- **Time picker:** the existing `TimeField` (quarter-hour steps) inside the
  new From/Until tiles; not reduced to hourly. On iOS the tile holds the
  native compact picker, as the game form's time chip already does.

## Notifications (1a)

- `BackRow` "‹ Profile" (new shared component), `FormTitle` "Notifications".
- **How should we reach you?** One `FormCard`, three radio rows (58pt): 34pt
  `bg` icon circle (bell / smartphone / mail, `accent-700`), label + subtitle
  ("Everything, both ways" / "Alerts on this phone" / "Nothing on your
  phone"), 24pt ring radio with 12pt dot. `aria-selected` as before; the
  accessible name stays the label alone.
- **Quiet hours:** `ToggleRow` (moon, `accent-2-700`) "Pause notifications
  overnight" with the existing help text. When on: a two-column grid of
  From / Until tiles (`TimeField` `tileLabel`), labels "Quiet hours
  start"/"Quiet hours end" kept for screen readers.
- **Alerts:** `ToggleRow` (user-plus) "Mute "need a 4th" alerts"; helper is
  "Get a nudge when a table is one player short." off, "You won't hear when
  a table is one player short." on.
- **Save bar:** `ActionBar` (new `cancelLabel` / `aboveTabBar` props) pinned
  above the tab bar only while the form differs from the last saved copy.
  Discard restores the saved copy; Save changes runs the same payload logic
  as before. On success the saved copy updates, the bar leaves, and "✓
  Saved" shows under the cards until the next edit. Errors show in
  `ErrorBanner` and the bar stays.

## Friends (1b)

- `BackRow`, `FormTitle` "Friends", intro text unchanged.
- **Your friends** (count on the right). Empty: dashed card, 44pt
  `accent-2-200` circle with a people icon, existing copy. Filled: one card
  of divider rows (60pt): 40pt avatar in a colour seeded from the profile id,
  white initials, name, shared clubs; 40pt ghost user-minus button labelled
  "Remove {name}".
- **People in your clubs:** "Search people" pill filtering client-side
  (case-insensitive substring on the display name); rows with a "+ Add" pill
  labelled "Add {name}". Empty states: "No one matches “q”." when a search
  hides everyone; "You've added everyone in your clubs." when there is no one
  left to add but you have friends. With no friends and no one to add, the
  section is hidden as today.

## Unchanged

Loading / error / signed-out states, user-id-keyed fetches, the friends
busy-ref guard, and every `lib/` call.

## Verification

Updated `notifications.test.tsx` / `friends.test.tsx` (new copy, dirty /
Discard / Saved, search), `vitest` green, in-app browser check against local
Supabase, then the MahjHero QA Pass steps touching these screens.
