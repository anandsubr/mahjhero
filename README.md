# MahjHero

A community platform for **American Mahjong** clubs. Organizers run their events
through it; members find games, book seats — including alongside specific friends —
and turn up.

**Status:** design complete for V1, no implementation yet.

## The idea

Club organizers currently run on group texts and a spreadsheet, which stops working
somewhere around 12–16 members. The four-player constraint makes it brittle: one
cancellation doesn't cost you a player, it collapses a whole table and three other
people are told the maths no longer works.

Existing tools handle the logistics — registration, waitlists, scoring — competently.
None of them let you book a seat *with named friends*, and none ships a native Android
app.

**Positioning:** the incumbent runs the logistics; MahjHero makes the club social.

## Documentation

| Document | Contents |
|---|---|
| [docs/superpowers/specs/2026-08-01-mahjhero-v1-design.md](docs/superpowers/specs/2026-08-01-mahjhero-v1-design.md) | The V1 design specification — scope, architecture, data model, seating mechanics, permissions, error handling, testing |
| [docs/roadmap.md](docs/roadmap.md) | V1 / V2 / V3 phasing, and what is deferred with reasons |
| [docs/research/market-analysis.md](docs/research/market-analysis.md) | Competitive landscape, validated pain points, naming decisions, content licensing constraint |

## V1 in one table

| Area | Features |
|---|---|
| Identity | Account, profile, skill level |
| Club | Roster, invite link, CSV import, host + co-organizer roles |
| Events | Create, recurring, skill-tiered tables, capacity |
| Seating | Book a seat, **book with friends**, waitlist, **"need a 4th"**, cancellations |
| Check-in | On arrival, works without a live connection |
| Comms | Event reminders, host broadcast; push + email |

Scoring and leaderboards are V2. Chat and public club discovery are V3. See the
roadmap for the reasoning.

## Stack

- **Client:** Expo / React Native — iOS, Android, and web from one codebase
- **Backend:** Supabase — Postgres, Auth, Row-Level Security, Realtime, Edge Functions
- **Delivery:** Expo push (APNs + FCM); Resend for email
- **Domain:** `mahjhero.app` / `mahjhero.com`, registered via Cloudflare Registrar

The organizing principle is that the database owns authorization and capacity, not the
app: RLS for tenant isolation, and a transactional Postgres function for every seat
allocation.

## Before building further

Three open items, recorded here so they aren't lost:

1. **Validate demand with practising club organizers.** The market research leans on a
   competitor's own content marketing, and the direct competitor has only 6 App Store
   ratings — either an opening or a signal the market is small.
2. **Run a proper USPTO trademark search** for "MahjHero". Clearance so far is
   web-search only.
3. **Sign in with Apple is mandatory** on iOS once Google sign-in is offered
   (App Store Review Guideline 4.8).
