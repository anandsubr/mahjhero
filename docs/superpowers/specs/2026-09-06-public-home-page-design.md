# Public home page — Design

## Problem

The only thing a signed-out visitor sees today is `app/welcome.tsx`: one
headline, one line of body copy, an invite-card, and two sign-in buttons. It
is a gateway into sign-in, not a pitch — it doesn't explain what MahjHero is,
doesn't speak differently to an organizer versus a player, and doesn't carry
any of the real differentiators the market research surfaced (book-with-
friends, native Android, the four-player collapse problem nobody else
solves).

MahjHero needs a real public marketing page — at `mahjhero.com` — that makes
the case for three audiences: a **club organizer** running a recurring club,
a **private/casual host** running the same kind of game at smaller, more
informal scale, and a **player** looking for a seat. Beta testing is about to
expand beyond one person, and this page is also the thing a new tester's
first click lands on.

## Audience

Three named personas, but only two functionally distinct roles:

- **Club organizer** and **private/casual host** are the same underlying role
  at different scale and formality — a weekly game among six friends versus a
  40-member club — using the identical feature set (create a club, invite
  people, run events, seat players). Copy differs in tone, not in substance.
- **Player** is genuinely distinct: finds a game, books a seat (alone or with
  named friends), checks in on arrival.

## Format

A standalone, self-contained static HTML file (`index.html`, inline CSS, no
build step, no framework, no backend) — not a change to `app/welcome.tsx` or
any Expo Router screen. It is meant to be dropped onto a static host at
`mahjhero.com` later; deployment itself is out of scope for this task. Its
primary call-to-action links directly into the real app's sign-in flow (the
deployed app's URL, once known — a placeholder link in the meantime).

No forms, no email capture, no waitlist mechanism — the app is far enough
along (seating, check-in, invite-only games, and scoring are all built and
tested) that beta testers are treated as real early users, not a waitlist.

## Page structure

One continuous scroll, no separate routes:

1. **Hero.** "MahjHero" wordmark set in Caprasimo (no logo mark exists yet —
   `assets/icon.png` is still the default Expo placeholder, so this stays
   text-only, the same way the in-app screens never render a logo image).
   Headline and subhead pitched at the shared pain — the four-player
   collapse problem — not yet split by persona. Primary "Get started"
   button, secondary "I already have an account" link.

2. **The problem, named plainly.** Two or three short, specific, sourced
   claims rather than vague benefit language:
   - One cancellation doesn't cost a table one player — it collapses all
     four seats and strands the other three.
   - Group texts and a spreadsheet stop working somewhere around 12-16
     members; organizing starts to feel like a part-time job.
   - No credibility props beyond this — no fabricated testimonials, no
     invented numbers.

3. **"Which are you?" role picker.** Three cards (Club organizer / Private
   host / Player). Selecting one (simple tab/toggle interaction, no page
   navigation) surfaces 2-3 role-specific benefits plus one small mockup
   illustrating the screen that matters most to that role:
   - *Club organizer* — roster + invite link, recurring events, host
     broadcast.
   - *Private host* — the same tools framed at friend-group scale, plus
     **invite-only games**: a private game visible and joinable only to the
     people you specifically invite, including people who aren't club
     members yet (they join on accepting).
   - *Player* — the seat grid, booking a seat next to a named friend,
     waitlist with automatic promotion, check-in on arrival.

4. **Feature highlights.** Converges back to one shared thread, each backed
   by a hand-built mockup in the app's real visual style:
   - **Book with a friend** — the differentiator no competitor ships.
   - **Waitlist that promotes itself** — a freed seat is offered
     automatically, in queue order, no organizer intervention.
   - **Check-in on arrival** — a host's door list and a member's own
     self-check-in.
   - **Invite-only private games** — cross-referenced from the private-host
     card above, stated once here as a standing feature.
   - **Scoring & club leaderboard** — points recorded per round, an
     all-time club ranking. Presented as shipped, no "coming soon" marker.

5. **Founder note.** A short, honest paragraph on why this exists — built out
   of the same frustration named in section 2 (group texts and spreadsheets
   breaking down), not a corporate "our mission" paragraph.

6. **Final CTA.** Repeats "Get started." States plainly that it's free to use
   today. No pricing table — billing is explicitly undecided
   (`docs/roadmap.md`), so nothing is promised about tomorrow.

7. **Footer.** Wordmark, a contact email link, nothing else — no privacy/
   terms placeholders, no social links that don't exist yet.

## Content principles

- No fabricated testimonials, review scores, or user counts.
- Differentiators are described by the gap they close ("no app lets you book
  a seat next to a specific friend," "a scheduler with a real Android app")
  rather than by naming Mahjic, AMR Authority, or The Sparrow Club by name —
  avoids comparative-advertising and trademark risk, and the claims stay true
  even if a competitor ships a copy feature later.
- Every feature named on the page must already exist in the app (verified
  against the codebase while writing this doc: seating/waitlist/check-in,
  `supabase/migrations/*invite_only*` + `docs/superpowers/specs/2026-09-05-
  invite-only-games-design.md`, and `lib/leaderboard.ts` +
  `app/clubs/[id]/leaderboard.tsx` for scoring). Nothing on the roadmap but
  unbuilt gets a mention.

## Visual system

Reuses `lib/theme.ts` verbatim rather than inventing a new palette:

- Cream background (`#f5ead8`), surface (`#ebddc5`), warm text (`#201e1d`),
  terracotta accent (`#c67139`) and sage accent2 (`#7a8a5e`).
- Caprasimo for headings, Figtree (regular/semibold/bold) for body — both
  loaded via Google Fonts `<link>` tags (both are on Google Fonts; the app
  bundles them locally via `expo-font`, but a static page has no bundler).
- Rounded cards (`radius.card` = 32px), the same soft shadow tokens, pill
  buttons — visually continuous with the app a visitor is about to sign into.
- Wider desktop layout than the app's 440px mobile column allows, but keeps
  a comfortable reading measure (roughly 720-960px content width) rather
  than stretching text edge-to-edge on a wide monitor. Fully responsive down
  to phone width, since some visitors will land on this link from a text
  message on their phone.

## Mockups

Hand-built HTML/CSS (plus small inline SVGs for tile glyphs, following
`app/welcome.tsx`'s `TileHero` pattern of drawn circles/bamboo/dragon glyphs)
styled to match the real components (`Card`, `Button`, `SeatGrid`-style seat
tokens) closely enough to read as authentic. No backend, no seeded data —
illustrative content only, clearly generic (e.g. "Riverside Mahjong Club" as
a placeholder name, not implying a real club exists).

## Out of scope

- Deployment/hosting/DNS for `mahjhero.com`.
- Real screenshots requiring a running backend.
- Forms, email capture, or any waitlist mechanism.
- A pricing table or billing copy beyond "free today."
- Legal pages (privacy, terms) — not written as part of this task.
- Any change to `app/welcome.tsx` or other in-app screens.

## Verification

No automated test suite applies to a static marketing page. Verification is
visual: serve the file locally, check it in the browser preview at desktop
and phone widths, confirm font loading, confirm the role-picker interaction
works, and check contrast against the same accessibility bar the app itself
holds (this player base skews older — the app's own `lib/theme.ts` comments
document AA contrast targets already met by these tokens, so reusing them
verbatim carries that compliance over).
