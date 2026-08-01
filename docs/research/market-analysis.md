# American Mahjong App Market — Research Notes

**Compiled:** 2026-08-01
**Method:** Web search and page fetches. See "Limitations" before relying on this.

---

## Market map

### Direct competitors — club and league management

**Bam Good Time / Mahjic** (Bam Good Time LLC) — the category leader, two brands from
one company.

- Online registration, Stripe payment collection, automatic waitlist with promotion,
  table rotation, live scoring, real-time standings, player match history, QR check-in,
  CSV roster import, club website, analytics (Pro), public directory
- **Portable ELO rating that follows a player between clubs** (via mahjic.org)
- Notifications by email, opt-in SMS, and push
- "Start a Table" reservation flow, framed like booking a restaurant
- Free club creation in about five minutes
- Platforms: web, iOS, iPad, Mac — **no native Android**
- Pricing: free tier (5 events/month); Starter $19–21.99/mo; Pro $49–56.99/mo;
  annual $229.99 / $599.99
- App Store: 4.2 stars from **6 ratings**

Requested-but-unshipped features, per its own App Store version history: tournament
brackets with single/double elimination, league and match chat, venue management and
table booking, enhanced privacy and identity hiding, profile photo face-centering.

**[AMR Authority](https://apps.apple.com/us/app/amr-authority/id6751984429)** — Fort
Worth, launched around May 2026. Positioned as the first global ranking system for
American Mahjong.

- Score tracking with **all-player confirmation before results are recorded**,
  automatic leaderboards, match history, casual and NMJL formats, event management,
  player statistics and win rates
- Free on iOS; AMR+ subscription $4.99/mo; Android promised
- Gaps: iOS-only, no online registration, no payment collection, no waitlist
  management, no CSV import, minimal operational features

**[The Sparrow Club](https://thesparrowclub.app/)** — "the digital clubhouse for modern
Mahjong."

- Sparrow Sub-Signal™, built specifically around filling an empty fourth seat
- Matches players on skill level and pace
- Targets three audiences: casual/social players, beginners, and **professional
  instructors** needing admin tools and student placement
- Founding memberships launched 30 April (National Mahjong Day); pricing undisclosed

**MahjSoft** — open-source American Mahjong score calculation. Desktop, self-hosted,
free. No hosted version, no registration or payments, no mobile app.

**Generic tools** — Meetup, Eventbrite, spreadsheets, group texts. What most clubs
actually use. None handles table capacity, waitlists, or rosters properly, and they
break down somewhere around 15–25 members.

### Not competitors — gameplay and practice apps

Different market; listed to avoid confusion.

| App | Notes |
|---|---|
| I Love Mahj | $6/mo, browser-based, largest online player base, NMJL rules, tutorials, drills |
| Eight Bam | Freemium, iOS-only, AI opponents, hand coach, historical card years |
| Real Mah Jongg | $5–6, official NMJL implementation, single-player AI |
| Mahjic Play | Free, Apple-only, hand suggestions, ties into the Bam Good Time club ecosystem |
| MahJongg4Fun | Free multiplayer, 3D tiles, multiple variants |
| Mahjong 4 Friends | Freemium, cross-platform, multiple variants |

## Validated pain points

The four-player constraint is the root cause of nearly everything:

- **One cancellation destroys a whole table.** You don't lose one player — you lose
  four seats, and three other people are told the maths no longer works.
- **The tipping point is 12–16 members**, where group texts plus a spreadsheet stop
  working and organizing "starts to feel like a part-time job."
- **Scaling stages:** 2–3 tables (8–12 players) — table assignments become necessary,
  cancellations more disruptive. 4–6 tables (16–24) — a single organizer is stretched
  thin, rotation patterns matter. 7+ tables (28+) — requires co-organizers, governance,
  and systems that run without the founder present.
- **Recurring beats ad-hoc.** Clubs on a fixed weekly slot are materially more stable;
  "whenever works" tends to reschedule and then collapse.
- Today's coping mechanisms are policy rather than software: forfeited payment for
  late cancellation, no refunds for no-shows.
- Other named problems: RSVP headcount, waitlist overflow, tracking who has paid,
  communication overhead (reminders, cancellations, weather closures), onboarding
  word-of-mouth members, and the weekly substitute puzzle.

## Gaps worth attacking

1. **No native Android anywhere in the category.** Bam Good Time has none; AMR is
   iOS-only. The clearest unclaimed position, and it matters more than usual given the
   demographic skew.
2. **Nobody has shipped book-with-friends.** Mahjic's users have requested table
   booking; it remains unshipped.
3. **No in-club chat** in any product.
4. **Fragmentation** — "most clubs end up using a tool from two or three categories
   rather than one tool for everything."
5. **Tournament brackets** requested at Mahjic, unshipped. Note that true brackets fit
   awkwardly onto a four-player game; most American Mahjong tournaments accumulate
   scores across rotating rounds instead.

## Limitations of this research

Weigh these before treating the above as settled:

- **Much of the pain-point detail comes from Bam Good Time's own blog** — competitor
  content marketing, framed around problems their product solves. Directionally useful,
  not neutral.
- **Real user complaint data is very thin.** Mahjic has 6 ratings and one visible
  review. No substantial body of user complaints exists for the club-management
  category. The negative reviews found (crashes, ad-flooding, joker-validation bugs)
  were all for gameplay apps, which are not competitors.
- **Facebook is reportedly the largest informal network** for these players, and those
  group threads were not accessible — so the most authentic demand signal is
  under-sampled here.
- **The 6-ratings figure cuts both ways.** The incumbent has minimal consumer traction:
  either an opening, or a warning that this market is small. Primary conversations with
  club organizers would resolve it far better than more desk research.

## Naming

**MahjHero** was selected. `mahjhero.com` and `mahjhero.app` were unregistered when
checked; the domain is now registered via Cloudflare Registrar.

Rejected candidates and their conflicts:

| Candidate | Conflict |
|---|---|
| Mahjic Club | [Mahjic Mahjong: Club & League](https://apps.apple.com/us/app/mahjic-mahjong-club-league/id6759616151) — direct competitor, same category |
| MahjCircle | [The Mahj Circle](https://themahjcircle.com/) — sells American Mahjong learning guides and NMJL card resources |
| Sparrow Club | [The Sparrow Club](https://thesparrowclub.app/) — same concept, same space |
| Four Sparrows | Existing App Store mahjong game |
| Sparrow's Nest | [Sparrow's Nest Studio](https://sparrowsneststudio.com/) — NYC mahjong parlour, home of the USPML |
| Four Winds Club | Two real mahjong clubs plus an unrelated mahjong game app |
| Charleston Club | "The Charleston Club" studio and "Charleston Mahjong Club" retail brand |
| MahjHouse | "House of Mahj", "Mahj House Austin", "The Mahj Haus" all in use |
| TableFour | Existing dining/social-networking app (different category) |

Sparrow-themed names are the most saturated lane in mahjong branding — avoid the
direction entirely. **Tile & Table** was the cleanest alternate if MahjHero ever needs
replacing.

**Outstanding:** trademark clearance is web-search only. A proper USPTO search is
still needed. An active 2024 filing for "THE MAHJ CLUB" covering mahjong retail and
tournament services indicates the niche is beginning to be defended.

## Content licensing constraint

The **2026 NMJL card is copyrighted**. The National Mah Jongg League sells it annually
and it is the League's core revenue. An app reproducing the card's hands is
redistributing copyrighted material, regardless of whether members already own a copy.

This is observable in the market: The Mahj Circle sells an NMJL study guide and states
plainly that it does not replace the official card and is not affiliated with or
endorsed by the League.

MahjHero's content area is therefore original and host-authored only, with members
directed to NMJL to buy their own card. A licensing conversation with the League is a
possible later path, not a launch dependency.
