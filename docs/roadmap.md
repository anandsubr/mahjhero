# MahjHero — Roadmap

**Last updated:** 2026-08-01

Phasing decided during design. Everything listed here is wanted in the product; the
phases describe **sequencing, not scope cuts**.

The guiding logic: the pain that makes club organizers quit is *scheduling* —
headcount, the collapsed table, the weekly substitute hunt. Nobody described scoring
as painful, and in-club chat is already well served by the WhatsApp groups clubs use
today. So V1 is the smallest build that could make a club abandon its spreadsheet,
built around the one feature no competitor offers.

---

## V1 — the wedge

Full design in [superpowers/specs/2026-08-01-mahjhero-v1-design.md](superpowers/specs/2026-08-01-mahjhero-v1-design.md).

- **Identity** — account, profile, skill level
- **Club** — roster, invite link, CSV import, host + co-organizer roles, public/private flag
- **Events** — create, recurring series, skill-tiered tables, capacity
- **Seating** — RSVP-as-booking, seat selection, **book with friends**, waitlist with
  auto-promotion, **"need a 4th"**, cancellations
- **Check-in** — on-arrival check-in, host door list and member self check-in.
  *Offline tolerance deferred (2026-08-24) to a follow-up plan; V1 check-in ships
  online-only.*
- **Comms** — event reminders, host broadcast to all members or event attendees;
  push + email

## V2 — make it sticky

- **Scoring** — points or wins, club-level setting, all-player confirmation before
  results are recorded
- **Leaderboard** — club-local standings and winner board
- **Content area** — original beginner and strategy material, host-authored per-club
  content, periodic tips delivery

Scoring is deferred because no organizer described it as a pain point, and because a
club must be running events in the app before there is anything to score. The
all-player confirmation pattern is borrowed from AMR Authority — cheap to build, and
it heads off the score disputes that sour a club.

## V3 — platform

- **In-club chat** — club-level and event/table-level
- **Public club directory** — discovery and search. The public/private flag ships in
  V1 and already governs whether an invite link admits instantly or raises a join
  request, so it is exercised from the start rather than sitting dead.
- **Co-organizer expansion, SMS delivery**

Chat is the largest single build on the list (realtime, moderation, notification
fan-out) and competes directly with WhatsApp groups that already work. A directory
also looks poor while sparse, so it benefits from arriving after clubs are active.

## Deferred indefinitely

Not scheduled. Each needs evidence of demand before it earns a phase.

| Item | Why it's parked |
|---|---|
| Billing — platform fees | Cannot price what nobody has adopted. The club is the tenant boundary, so this attaches later without migration. |
| Billing — club dues and table fees | Real host pain, but payment processing, refunds, and disputes become your problem early. |
| Tournament brackets | A separate competition model, not just extra work. True brackets fit a four-player game awkwardly; most American Mahjong tournaments accumulate scores across rotating rounds instead. Requested at Mahjic and still unshipped. |
| Cross-club global rating | A distinct product bet, and an established open rating system (mahjic.org) already holds that ground. Better attempted later from real score data. |
| Automatic table assignment by skill | Hosts have opinions about who sits where and will fight an algorithm. Revisit only if they ask. |
| Guest / non-member attendance | Can ride on the invite flow later. |
| Standalone attendance statistics | Falls out of check-in data whenever it's wanted; no need to design it now. |
| Online gameplay | Not the business. Well served by I Love Mahj and Eight Bam. |

## Cross-cutting commitments

- **Android ships alongside iOS.** No competitor offers a native Android app; it is the
  clearest unclaimed position and cheap to hold given the stack choice, but expensive
  to retrofit.
- **The web target is permanent.** Invite links must open a working app in a browser.
  Installing is an upgrade, never a prerequisite — this audience will not complete an
  app-store-first onboarding.
- **The NMJL card is never reproduced in-app**, in any phase. See the licensing note in
  [research/market-analysis.md](research/market-analysis.md).

## Open items carried forward

1. **Validate demand with real organizers.** The research is thin on authentic user
   voice and the incumbent has only 6 App Store ratings.
2. **Run a proper USPTO trademark search** for "MahjHero".
3. **Sign in with Apple** is mandatory on iOS given Google sign-in (Guideline 4.8).
