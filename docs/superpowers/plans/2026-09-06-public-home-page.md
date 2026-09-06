# Public Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, self-contained public marketing home page (`marketing/index.html`) that pitches MahjHero to club organizers, private/casual game hosts, and players.

**Architecture:** A single static HTML file with all CSS inlined in a `<style>` block and all interactivity in one inline `<script>` block at the end of `<body>` — no build step, no framework, no external JS. Visual tokens are copied verbatim from `lib/theme.ts` into CSS custom properties so the page is visually continuous with the real app. Served locally for verification via Python's built-in `http.server`, wired into `.claude/launch.json` as a named dev-server config.

**Tech Stack:** Plain HTML5 + CSS3 + vanilla JS. Google Fonts (Caprasimo, Figtree) loaded via `<link>`. No npm packages, no bundler.

## Global Constraints

(From `docs/superpowers/specs/2026-09-06-public-home-page-design.md` — every task's work implicitly includes these.)

- Single self-contained file, inline CSS, no build step, no backend, no forms.
- Visual tokens copied verbatim from `lib/theme.ts` (colors, spacing, radius, shadow, type) — no new palette.
- Fonts: Caprasimo for headings, Figtree (400/600/700) for body, both via Google Fonts `<link>` tags.
- No fabricated testimonials, review scores, or user counts.
- Differentiators described by the gap they close; never name Mahjic, AMR Authority, or The Sparrow Club.
- Every feature named on the page must already exist in the app (verified: seating/waitlist/check-in, `docs/superpowers/specs/2026-09-05-invite-only-games-design.md`, `lib/leaderboard.ts` + `app/clubs/[id]/leaderboard.tsx`).
- States plainly the app is free to use today. No pricing table.
- Founder note is unsigned (no name).
- Footer contact email is `hello@mahjhero.com`.
- "Get started" / "I already have an account" links point to `href="#"` with an HTML comment marking them for replacement once the deployed app URL is known.
- Fully responsive down to ~375px phone width; no horizontal scroll at any width.
- Mockups are hand-built HTML/CSS/inline-SVG in the app's real visual style — no backend, no seeded data, clearly generic placeholder content (e.g. "Riverside Mahjong Club").

---

### Task 1: Scaffold the page and local preview server

**Files:**
- Create: `marketing/index.html`
- Modify: `.claude/launch.json`

**Interfaces:**
- Produces: the file `marketing/index.html` with a `<head>` (title, meta description, Google Fonts links, a `<style>` block defining CSS custom properties and base rules) and a `<body>` containing seven HTML comment markers in order — `<!-- HERO -->`, `<!-- PROBLEM -->`, `<!-- ROLE_PICKER -->`, `<!-- FEATURES -->`, `<!-- FOUNDER -->`, `<!-- FINAL_CTA -->`, `<!-- FOOTER -->`, `<!-- SCRIPTS -->` — and seven matching CSS comment markers inside `<style>` — `/* HERO_STYLES */`, `/* PROBLEM_STYLES */`, `/* ROLE_PICKER_STYLES */`, `/* FEATURES_STYLES */`, `/* FOUNDER_STYLES */`, `/* FINAL_CTA_STYLES */`, `/* FOOTER_STYLES */`. Later tasks locate and replace these exact markers — do not rename or reorder them.
- Produces: a `marketing-site` entry in `.claude/launch.json` serving `marketing/` on port 8099.

- [ ] **Step 1: Create the `marketing/` directory and the base HTML file**

Write `marketing/index.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MahjHero — Your club's table, always set.</title>
<meta name="description" content="MahjHero is the seat-by-seat scheduler for American Mahjong clubs and private games — book with friends, an auto-promoting waitlist, on-arrival check-in, and a club leaderboard." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #f5ead8;
    --surface: #ebddc5;
    --text: #201e1d;
    --text-muted: #676158;
    --text-label: #605b55;
    --accent: #c67139;
    --accent-100: #fff2eb;
    --accent-200: #ffe1d0;
    --accent-300: #ffc6a5;
    --accent-700: #8c491a;
    --accent-800: #643312;
    --accent2: #7a8a5e;
    --accent2-100: #f0fae1;
    --accent2-200: #e1eecc;
    --accent2-600: #728157;
    --accent2-700: #56633f;
    --accent2-800: #3d472b;
    --neutral-200: #eee7db;
    --neutral-300: #dcd3c4;
    --neutral-900: #2e2b25;
    --divider: rgba(32, 30, 29, 0.16);
    --radius-sm: 8px;
    --radius-md: 16px;
    --radius-lg: 28px;
    --radius-card: 32px;
    --radius-pill: 999px;
    --shadow-sm: 0 1px 2px rgba(46, 43, 37, 0.14);
    --shadow-md: 0 3px 10px rgba(46, 43, 37, 0.16);
    --shadow-lg: 0 12px 32px rgba(46, 43, 37, 0.22);
    --font-heading: 'Caprasimo', Georgia, serif;
    --font-body: 'Figtree', -apple-system, sans-serif;
  }

  * { box-sizing: border-box; }

  html { scroll-behavior: smooth; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 18px;
    line-height: 1.6;
  }

  img, svg { max-width: 100%; display: block; }

  .wrap {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 26px;
  }

  section { padding: 70px 0; }

  h1, h2, h3 {
    font-family: var(--font-heading);
    font-weight: 400;
    color: var(--text);
    margin: 0;
  }

  p { margin: 0; }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 18px;
    padding: 16px 32px;
    border-radius: var(--radius-pill);
    text-decoration: none;
    cursor: pointer;
    border: none;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-100);
    box-shadow: var(--shadow-md);
  }

  .btn-secondary {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--divider);
  }

  .card {
    background: var(--surface);
    border-radius: var(--radius-card);
    padding: 26px;
    box-shadow: var(--shadow-sm);
  }

  /* HERO_STYLES */

  /* PROBLEM_STYLES */

  /* ROLE_PICKER_STYLES */

  /* FEATURES_STYLES */

  /* FOUNDER_STYLES */

  /* FINAL_CTA_STYLES */

  /* FOOTER_STYLES */
</style>
</head>
<body>
  <!-- HERO -->
  <!-- PROBLEM -->
  <!-- ROLE_PICKER -->
  <!-- FEATURES -->
  <!-- FOUNDER -->
  <!-- FINAL_CTA -->
  <!-- FOOTER -->
  <!-- SCRIPTS -->
</body>
</html>
```

- [ ] **Step 2: Add the local preview server to `.claude/launch.json`**

Read the current file first. Replace its full contents with:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "mahjhero-web",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["expo", "start", "--web", "--port", "8090"],
      "port": 8090,
      "autoPort": true
    },
    {
      "name": "marketing-site",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8099", "--directory", "marketing"],
      "port": 8099
    }
  ]
}
```

- [ ] **Step 3: Verify the scaffold loads correctly**

Call `mcp__Claude_Browser__preview_start` with `{"name": "marketing-site"}`. This opens a browser tab at `http://localhost:8099/`.

Then call `mcp__Claude_Browser__javascript_tool` with:

```js
({
  title: document.title,
  bg: getComputedStyle(document.body).backgroundColor,
  fontFamily: getComputedStyle(document.body).fontFamily,
})
```

Expected: `title` is `"MahjHero — Your club's table, always set."`, `bg` is `"rgb(245, 234, 216)"`, `fontFamily` includes `"Figtree"`.

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html .claude/launch.json
git commit -m "feat(marketing): scaffold public home page with base tokens"
```

---

### Task 2: Hero section

**Files:**
- Modify: `marketing/index.html` (replace the `<!-- HERO -->` and `/* HERO_STYLES */` markers)

**Interfaces:**
- Consumes: the `<!-- HERO -->` and `/* HERO_STYLES */` markers from Task 1, and the CSS custom properties defined in `:root` (e.g. `--accent`, `--font-heading`, `--shadow-sm`).
- Produces: nothing new consumed by later tasks — the hero is visually and structurally independent of the sections that follow it.

- [ ] **Step 1: Replace the `<!-- HERO -->` marker**

In `marketing/index.html`, replace:

```html
  <!-- HERO -->
```

with:

```html
  <header class="hero">
    <div class="wrap hero-inner">
      <div class="wordmark">Mahj<span class="wordmark-accent">Hero</span></div>

      <div class="hero-tiles" aria-hidden="true">
        <div class="tile tile-left">
          <svg width="26" height="40" viewBox="0 0 26 40" fill="none" stroke="#c67139" stroke-width="2.75">
            <circle cx="13" cy="8" r="4.5" />
            <circle cx="13" cy="20" r="4.5" />
            <circle cx="13" cy="32" r="4.5" />
          </svg>
        </div>
        <div class="tile">
          <svg width="26" height="40" viewBox="0 0 26 40" fill="none" stroke="#728157" stroke-width="2.75" stroke-linecap="round">
            <path d="M7 6v28M13 6v28M19 6v28" />
            <path d="M4 14h6M10 14h6M16 14h6M4 26h6M10 26h6M16 26h6" />
          </svg>
        </div>
        <div class="tile tile-accent tile-right">
          <span class="tile-glyph">中</span>
        </div>
      </div>

      <h1 class="hero-heading">One cancellation shouldn&rsquo;t cancel the whole table.</h1>
      <p class="hero-body">
        MahjHero is the seat-by-seat scheduler for American Mahjong clubs and
        private games &mdash; book a seat next to a friend, get promoted off
        the waitlist the moment one opens, and know who&rsquo;s actually coming.
      </p>

      <div class="hero-actions">
        <!-- Replace with the deployed app's sign-in URL once known -->
        <a class="btn btn-primary" href="#" aria-label="Get started">Get started</a>
        <a class="btn btn-secondary" href="#" aria-label="I already have an account">I already have an account</a>
      </div>
    </div>
  </header>
```

- [ ] **Step 2: Replace the `/* HERO_STYLES */` marker**

Replace:

```css
  /* HERO_STYLES */
```

with:

```css
  /* HERO_STYLES */
  .hero { padding: 60px 0 70px; }
  .hero-inner { display: flex; flex-direction: column; gap: 26px; }
  .wordmark {
    font-family: var(--font-heading);
    font-size: 28px;
    color: var(--text);
  }
  .wordmark-accent { color: var(--accent); }
  .hero-tiles { display: flex; align-items: flex-end; gap: 8.8px; }
  .tile {
    width: 52px;
    height: 70px;
    border-radius: 15px;
    background: var(--surface);
    border-bottom: 5px solid var(--neutral-200);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-sm);
  }
  .tile-left { transform: rotate(-6deg); }
  .tile-right { transform: rotate(5deg); }
  .tile-accent { background: var(--accent); border-bottom-color: var(--accent-700); }
  .tile-glyph { font-size: 30px; line-height: 1; color: var(--bg); }
  .hero-heading { font-size: 50px; line-height: 1.08; max-width: 680px; }
  .hero-body {
    font-size: 19px;
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 560px;
  }
  .hero-actions { display: flex; gap: 13.2px; flex-wrap: wrap; }
```

- [ ] **Step 3: Verify**

With the `marketing-site` preview still running (or restart it with `mcp__Claude_Browser__preview_start` `{"name": "marketing-site"}` and navigate to `http://localhost:8099/`), call `mcp__Claude_Browser__get_page_text` and confirm the output contains `"One cancellation shouldn't cancel the whole table."` and `"Get started"`. Take a screenshot with `mcp__Claude_Browser__computer` `{"action": "screenshot"}` and confirm the three tiles render fanned (rotated) above the headline, and the wordmark reads "MahjHero" with "Hero" in the terracotta accent color.

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add hero section"
```

---

### Task 3: Problem section

**Files:**
- Modify: `marketing/index.html` (replace the `<!-- PROBLEM -->` and `/* PROBLEM_STYLES */` markers)

**Interfaces:**
- Consumes: the `<!-- PROBLEM -->` and `/* PROBLEM_STYLES */` markers from Task 1, and `.card` from Task 1's base styles.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the `<!-- PROBLEM -->` marker**

Replace:

```html
  <!-- PROBLEM -->
```

with:

```html
  <section class="problem">
    <div class="wrap problem-inner">
      <h2 class="problem-heading">The four-player problem</h2>
      <div class="problem-grid">
        <div class="card problem-card">
          <p class="problem-card-text">
            One cancellation doesn&rsquo;t cost you a player &mdash; it
            collapses a whole table, and three other people are told the
            math doesn&rsquo;t work anymore.
          </p>
        </div>
        <div class="card problem-card">
          <p class="problem-card-text">
            Somewhere around 12&ndash;16 members, a group text and a shared
            spreadsheet stop working. Organizing starts to feel like a
            part-time job.
          </p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace the `/* PROBLEM_STYLES */` marker**

Replace:

```css
  /* PROBLEM_STYLES */
```

with:

```css
  /* PROBLEM_STYLES */
  .problem-inner { display: flex; flex-direction: column; gap: 35.2px; }
  .problem-heading { font-size: 34px; }
  .problem-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 22px;
  }
  .problem-card-text {
    font-size: 19px;
    line-height: 1.6;
    color: var(--text);
  }
  @media (max-width: 680px) {
    .problem-grid { grid-template-columns: 1fr; }
  }
```

- [ ] **Step 3: Verify**

Reload `http://localhost:8099/` (call `mcp__Claude_Browser__navigate` with the same URL, or `javascript_tool` `window.location.reload()`). Call `get_page_text` and confirm it contains `"The four-player problem"` and `"12–16 members"`. Resize with `mcp__Claude_Browser__resize_window` `{"preset": "mobile"}`, screenshot, and confirm the two problem cards stack vertically with no horizontal scrollbar. Reset with `resize_window` `{"preset": "desktop"}` afterward.

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add problem section"
```

---

### Task 4: Role-picker section (organizer / private host / player)

**Files:**
- Modify: `marketing/index.html` (replace `<!-- ROLE_PICKER -->`, `/* ROLE_PICKER_STYLES */`, and `<!-- SCRIPTS -->`)

**Interfaces:**
- Consumes: the `<!-- ROLE_PICKER -->`, `/* ROLE_PICKER_STYLES */`, and `<!-- SCRIPTS -->` markers from Task 1, and `.card` from Task 1.
- Produces: three tab buttons with `data-role` values `organizer`, `host`, `player`, and three panels with ids `role-panel-organizer`, `role-panel-host`, `role-panel-player` — referenced only within this task's own script, not by later tasks.

- [ ] **Step 1: Replace the `<!-- ROLE_PICKER -->` marker**

Replace:

```html
  <!-- ROLE_PICKER -->
```

with:

```html
  <section class="roles">
    <div class="wrap roles-inner">
      <h2 class="roles-heading">Built for whoever&rsquo;s holding the table together</h2>

      <div class="role-tabs" role="tablist" aria-label="Choose your role">
        <button class="role-tab is-active" role="tab" aria-selected="true" aria-controls="role-panel-organizer" id="role-tab-organizer" data-role="organizer">Club organizer</button>
        <button class="role-tab" role="tab" aria-selected="false" aria-controls="role-panel-host" id="role-tab-host" data-role="host">Private host</button>
        <button class="role-tab" role="tab" aria-selected="false" aria-controls="role-panel-player" id="role-tab-player" data-role="player">Player</button>
      </div>

      <div class="role-panel is-active" id="role-panel-organizer" role="tabpanel" aria-labelledby="role-tab-organizer">
        <div class="role-panel-grid">
          <div class="role-panel-copy">
            <h3 class="role-panel-heading">Run the club without running yourself ragged</h3>
            <ul class="role-panel-list">
              <li>Roster and invite link &mdash; new members join with a tap, no code to type into a group chat.</li>
              <li>Recurring events &mdash; set the weekly game once and it keeps making itself.</li>
              <li>Host broadcast &mdash; one message reaches everyone booked for a game, or the whole club.</li>
            </ul>
          </div>
          <div class="role-mock card">
            <div class="mock-header">Riverside Mahjong Club</div>
            <div class="mock-row"><span>42 members</span><span class="mock-pill">Host</span></div>
            <div class="mock-list">
              <div class="mock-list-item">Tuesday Night &middot; 4 tables</div>
              <div class="mock-list-item">Thursday Open Play &middot; 2 tables</div>
            </div>
          </div>
        </div>
      </div>

      <div class="role-panel" id="role-panel-host" role="tabpanel" aria-labelledby="role-tab-host" hidden>
        <div class="role-panel-grid">
          <div class="role-panel-copy">
            <h3 class="role-panel-heading">Same table, smaller circle</h3>
            <ul class="role-panel-list">
              <li>Every organizer tool above, sized for six friends instead of sixty.</li>
              <li>Invite-only games &mdash; visible and joinable only to the people you invite, even if they&rsquo;re not club members yet.</li>
              <li>No open sign-up &mdash; nobody stumbles into your Tuesday night game by accident.</li>
            </ul>
          </div>
          <div class="role-mock card">
            <div class="mock-row"><span class="mock-lock">&#128274; Invite-only</span></div>
            <div class="mock-header">Saturday at Jamie&rsquo;s</div>
            <div class="mock-list">
              <div class="mock-list-item">You, Priya, Sam &mdash; confirmed</div>
              <div class="mock-list-item">Waiting on: Alex</div>
            </div>
          </div>
        </div>
      </div>

      <div class="role-panel" id="role-panel-player" role="tabpanel" aria-labelledby="role-tab-player" hidden>
        <div class="role-panel-grid">
          <div class="role-panel-copy">
            <h3 class="role-panel-heading">Find a seat, or hold one for a friend</h3>
            <ul class="role-panel-list">
              <li>Book a seat, or book yourself and a specific friend together &mdash; no other app does this.</li>
              <li>Waitlisted? You&rsquo;re promoted automatically the moment a seat opens, in order.</li>
              <li>Check in when you arrive &mdash; the host&rsquo;s door list updates itself.</li>
            </ul>
          </div>
          <div class="role-mock card">
            <div class="mock-header">Table 2 &middot; 4 seats</div>
            <div class="seat-grid">
              <div class="seat seat-filled">Priya</div>
              <div class="seat seat-you">You + Jamie</div>
              <div class="seat seat-filled">Sam</div>
              <div class="seat seat-open">Open</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace the `/* ROLE_PICKER_STYLES */` marker**

Replace:

```css
  /* ROLE_PICKER_STYLES */
```

with:

```css
  /* ROLE_PICKER_STYLES */
  .roles-inner { display: flex; flex-direction: column; gap: 35.2px; }
  .roles-heading { font-size: 34px; max-width: 640px; }
  .role-tabs { display: flex; gap: 8.8px; flex-wrap: wrap; }
  .role-tab {
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 16px;
    padding: 13.2px 22px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--divider);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .role-tab.is-active {
    background: var(--accent);
    color: var(--accent-100);
    border-color: var(--accent);
  }
  .role-panel[hidden] { display: none; }
  .role-panel-grid {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 26.4px;
    align-items: start;
  }
  .role-panel-heading { font-size: 28px; margin-bottom: 17.6px; }
  .role-panel-list {
    margin: 0;
    padding-left: 20px;
    color: var(--text);
    font-size: 18px;
    line-height: 1.6;
    display: flex;
    flex-direction: column;
    gap: 13.2px;
  }
  .role-mock { display: flex; flex-direction: column; gap: 13.2px; }
  .mock-header { font-family: var(--font-body); font-weight: 700; font-size: 18px; }
  .mock-row { display: flex; justify-content: space-between; align-items: center; font-size: 16px; color: var(--text-muted); }
  .mock-pill {
    background: var(--accent2-100);
    color: var(--accent2-800);
    border-radius: var(--radius-pill);
    padding: 4.4px 13.2px;
    font-size: 14px;
    font-weight: 700;
  }
  .mock-lock {
    background: var(--accent-200);
    color: var(--accent-800);
    border-radius: var(--radius-pill);
    padding: 4.4px 13.2px;
    font-size: 14px;
    font-weight: 700;
  }
  .mock-list { display: flex; flex-direction: column; gap: 8.8px; }
  .mock-list-item {
    background: var(--bg);
    border-radius: var(--radius-md);
    padding: 13.2px 17.6px;
    font-size: 16px;
    color: var(--text);
  }
  .seat-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8.8px;
  }
  .seat {
    border-radius: var(--radius-md);
    padding: 17.6px;
    text-align: center;
    font-size: 16px;
    font-weight: 700;
  }
  .seat-filled { background: var(--neutral-200); color: var(--text); }
  .seat-you { background: var(--accent); color: var(--accent-100); }
  .seat-open {
    background: transparent;
    border: 1px dashed var(--divider);
    color: var(--text-muted);
  }
  @media (max-width: 680px) {
    .role-panel-grid { grid-template-columns: 1fr; }
  }
```

- [ ] **Step 3: Replace the `<!-- SCRIPTS -->` marker**

Replace:

```html
  <!-- SCRIPTS -->
```

with:

```html
  <script>
    (function () {
      var tabs = document.querySelectorAll('.role-tab');
      var panels = document.querySelectorAll('.role-panel');
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          tabs.forEach(function (t) {
            t.classList.remove('is-active');
            t.setAttribute('aria-selected', 'false');
          });
          panels.forEach(function (p) {
            p.classList.remove('is-active');
            p.hidden = true;
          });
          tab.classList.add('is-active');
          tab.setAttribute('aria-selected', 'true');
          var panel = document.getElementById('role-panel-' + tab.dataset.role);
          panel.classList.add('is-active');
          panel.hidden = false;
        });
      });
    })();
  </script>
```

- [ ] **Step 4: Verify**

Reload the page. Call `read_page` with `filter: "interactive"` and confirm three buttons labeled "Club organizer", "Private host", "Player" appear. Use `mcp__Claude_Browser__computer` to click the "Private host" tab (by `coordinate` or `ref` from `read_page`), then `get_page_text` and confirm the output now contains `"Same table, smaller circle"` and `"Invite-only"`, and does NOT contain `"Run the club without running yourself ragged"` (the organizer panel is hidden). Click "Player" and confirm the output contains `"Find a seat, or hold one for a friend"` and `"You + Jamie"`. Screenshot the player panel and confirm the four-seat grid renders in a 2x2 grid with "You + Jamie" highlighted in the accent color.

- [ ] **Step 5: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add role-picker section with organizer/host/player tabs"
```

---

### Task 5: Feature highlights section

**Files:**
- Modify: `marketing/index.html` (replace `<!-- FEATURES -->` and `/* FEATURES_STYLES */`)

**Interfaces:**
- Consumes: the `<!-- FEATURES -->` and `/* FEATURES_STYLES */` markers from Task 1, `.card` and `.mock-lock` (defined in Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the `<!-- FEATURES -->` marker**

Replace:

```html
  <!-- FEATURES -->
```

with:

```html
  <section class="features">
    <div class="wrap features-inner">
      <h2 class="features-heading">Everything below is live today, not a roadmap slide.</h2>
      <div class="features-grid">
        <div class="card feature-card">
          <div class="feature-icon">
            <svg width="40" height="28" viewBox="0 0 40 28" fill="none">
              <rect x="1" y="1" width="16" height="26" rx="4" fill="#c67139" />
              <rect x="23" y="1" width="16" height="26" rx="4" fill="#ffe1d0" />
            </svg>
          </div>
          <h3 class="feature-title">Book with a friend</h3>
          <p class="feature-body">Reserve your seat and a specific friend&rsquo;s in one booking &mdash; the one thing every other club app is missing.</p>
        </div>
        <div class="card feature-card">
          <div class="feature-icon">
            <span class="feature-badge">4:32 left</span>
          </div>
          <h3 class="feature-title">A waitlist that promotes itself</h3>
          <p class="feature-body">The moment a seat frees up, it&rsquo;s offered to the next person in line automatically &mdash; no organizer has to referee it.</p>
        </div>
        <div class="card feature-card">
          <div class="feature-icon">
            <div class="feature-checkrow">Priya Patel <span>&#10003;</span></div>
          </div>
          <h3 class="feature-title">Check-in on arrival</h3>
          <p class="feature-body">A host&rsquo;s door list and a member&rsquo;s own self check-in, so nobody&rsquo;s guessing who actually showed up.</p>
        </div>
        <div class="card feature-card">
          <div class="feature-icon">
            <span class="mock-lock">&#128274; Invite-only</span>
          </div>
          <h3 class="feature-title">Invite-only private games</h3>
          <p class="feature-body">Run a game that&rsquo;s visible and joinable only to the people you invite &mdash; club members or not.</p>
        </div>
        <div class="card feature-card">
          <div class="feature-icon">
            <div class="leaderboard-mini">
              <div>1. Priya &mdash; 428</div>
              <div>2. Sam &mdash; 402</div>
              <div>3. You &mdash; 380</div>
            </div>
          </div>
          <h3 class="feature-title">Scoring &amp; club leaderboard</h3>
          <p class="feature-body">Record points per round and keep an all-time club ranking &mdash; every player confirms before it&rsquo;s official.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace the `/* FEATURES_STYLES */` marker**

Replace:

```css
  /* FEATURES_STYLES */
```

with:

```css
  /* FEATURES_STYLES */
  .features-inner { display: flex; flex-direction: column; gap: 35.2px; }
  .features-heading { font-size: 34px; max-width: 640px; }
  .features-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 22px;
  }
  .feature-card { display: flex; flex-direction: column; gap: 13.2px; }
  .feature-icon { height: 40px; display: flex; align-items: center; }
  .feature-title { font-size: 22px; }
  .feature-body { font-size: 16px; line-height: 1.55; color: var(--text-muted); }
  .feature-badge {
    background: var(--accent2-100);
    color: var(--accent2-800);
    border-radius: var(--radius-pill);
    padding: 4.4px 13.2px;
    font-size: 14px;
    font-weight: 700;
  }
  .feature-checkrow {
    display: flex;
    justify-content: space-between;
    width: 100%;
    background: var(--bg);
    border-radius: var(--radius-sm);
    padding: 8.8px 13.2px;
    font-size: 14px;
  }
  .feature-checkrow span { color: var(--accent2-600); font-weight: 700; }
  .leaderboard-mini {
    display: flex;
    flex-direction: column;
    gap: 4.4px;
    font-size: 14px;
    color: var(--text);
    width: 100%;
  }
  @media (max-width: 900px) {
    .features-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 600px) {
    .features-grid { grid-template-columns: 1fr; }
  }
```

- [ ] **Step 3: Verify**

Reload. `get_page_text` must contain all five feature titles: `"Book with a friend"`, `"A waitlist that promotes itself"`, `"Check-in on arrival"`, `"Invite-only private games"`, `"Scoring & club leaderboard"`. Resize to `mobile` preset, screenshot, confirm the five cards stack in a single column with no horizontal scroll, then reset to `desktop`.

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add feature highlights section"
```

---

### Task 6: Founder note section

**Files:**
- Modify: `marketing/index.html` (replace `<!-- FOUNDER -->` and `/* FOUNDER_STYLES */`)

**Interfaces:**
- Consumes: the `<!-- FOUNDER -->` and `/* FOUNDER_STYLES */` markers from Task 1, `.card` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the `<!-- FOUNDER -->` marker**

Replace:

```html
  <!-- FOUNDER -->
```

with:

```html
  <section class="founder">
    <div class="wrap founder-inner">
      <div class="card founder-card">
        <p class="founder-text">
          I built this because our club ran on a group text and a shared
          spreadsheet, and it broke almost every week &mdash; someone
          cancelled, the table fell apart, and three more people had to be
          told the game was off. MahjHero is the tool I wanted: one that
          treats a four-player table like the fragile thing it actually is.
        </p>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace the `/* FOUNDER_STYLES */` marker**

Replace:

```css
  /* FOUNDER_STYLES */
```

with:

```css
  /* FOUNDER_STYLES */
  .founder-inner { display: flex; }
  .founder-card { max-width: 680px; margin: 0 auto; }
  .founder-text {
    font-size: 19px;
    line-height: 1.7;
    color: var(--text);
    font-style: italic;
  }
```

- [ ] **Step 3: Verify**

Reload. `get_page_text` must contain `"I built this because our club ran on a group text"`. Confirm no name or signature appears anywhere near this paragraph (the note is intentionally unsigned).

- [ ] **Step 4: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add founder note section"
```

---

### Task 7: Final CTA and footer

**Files:**
- Modify: `marketing/index.html` (replace `<!-- FINAL_CTA -->`, `/* FINAL_CTA_STYLES */`, `<!-- FOOTER -->`, `/* FOOTER_STYLES */`)

**Interfaces:**
- Consumes: those four markers from Task 1, `.wordmark`/`.wordmark-accent` from Task 2.
- Produces: nothing consumed by later tasks. This is the last content task — after it, the page is content-complete and Task 8 is verification-only.

- [ ] **Step 1: Replace the `<!-- FINAL_CTA -->` marker**

Replace:

```html
  <!-- FINAL_CTA -->
```

with:

```html
  <section class="final-cta">
    <div class="wrap final-cta-inner">
      <h2 class="final-cta-heading">Free to use, today.</h2>
      <p class="final-cta-body">No pricing tiers, no card required &mdash; just a club that finally knows how many seats are actually open.</p>
      <!-- Replace with the deployed app's sign-in URL once known -->
      <a class="btn btn-primary" href="#" aria-label="Get started">Get started</a>
    </div>
  </section>
```

- [ ] **Step 2: Replace the `/* FINAL_CTA_STYLES */` marker**

Replace:

```css
  /* FINAL_CTA_STYLES */
```

with:

```css
  /* FINAL_CTA_STYLES */
  .final-cta { background: var(--surface); }
  .final-cta-inner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 17.6px;
  }
  .final-cta-heading { font-size: 40px; }
  .final-cta-body { font-size: 18px; color: var(--text-muted); max-width: 480px; }
```

- [ ] **Step 3: Replace the `<!-- FOOTER -->` marker**

Replace:

```html
  <!-- FOOTER -->
```

with:

```html
  <footer class="site-footer">
    <div class="wrap site-footer-inner">
      <div class="wordmark wordmark-small">Mahj<span class="wordmark-accent">Hero</span></div>
      <a class="footer-contact" href="mailto:hello@mahjhero.com">hello@mahjhero.com</a>
    </div>
  </footer>
```

- [ ] **Step 4: Replace the `/* FOOTER_STYLES */` marker**

Replace:

```css
  /* FOOTER_STYLES */
```

with:

```css
  /* FOOTER_STYLES */
  .site-footer { padding: 35.2px 0; }
  .site-footer-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 13.2px;
  }
  .wordmark-small { font-size: 20px; }
  .footer-contact {
    font-size: 16px;
    color: var(--text-muted);
    text-decoration: none;
  }
```

- [ ] **Step 5: Verify**

Reload. `get_page_text` must contain `"Free to use, today."` and `"hello@mahjhero.com"`. Confirm via `read_page` that the footer's email link has `href="mailto:hello@mahjhero.com"`.

- [ ] **Step 6: Commit**

```bash
git add marketing/index.html
git commit -m "feat(marketing): add final CTA and footer"
```

---

### Task 8: Full-page responsive, accessibility, and console verification

**Files:**
- None created or modified unless a check below fails, in which case fix the specific CSS rule in `marketing/index.html` that caused the failure and re-run the check it belongs to.

**Interfaces:**
- Consumes: the complete `marketing/index.html` produced by Tasks 1-7.
- Produces: nothing — this is the final gate before the page is considered done.

- [ ] **Step 1: Desktop screenshot, full page**

Reload `http://localhost:8099/`. Call `mcp__Claude_Browser__computer` `{"action": "screenshot"}` at the default desktop size and visually confirm all seven sections render in order (hero, problem, role picker, features, founder note, final CTA, footer) with consistent spacing and no visibly broken layout.

- [ ] **Step 2: Mobile width, no horizontal scroll**

Call `mcp__Claude_Browser__resize_window` `{"preset": "mobile"}`. Reload. Call `mcp__Claude_Browser__javascript_tool` with:

```js
document.documentElement.scrollWidth
```

Expected: exactly `375` (matches the mobile preset's viewport width — anything larger means a section is overflowing). If it's larger, screenshot to find the offending element, fix its CSS (most likely a fixed `width` or missing `flex-wrap` in a `*-grid`/`*-inner` rule), and re-run this step.

- [ ] **Step 3: Console errors**

Call `mcp__Claude_Browser__read_console_messages` `{"onlyErrors": true}`. Expected: an empty list. If any font-loading or script error appears, fix its cause (e.g. a typo in the Google Fonts URL or the inline `<script>` block) and re-run.

- [ ] **Step 4: Contrast check on the two lowest-contrast text/background pairs**

Call `mcp__Claude_Browser__javascript_tool` with:

```js
(function () {
  function luminance(r, g, b) {
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }
  function contrast(rgb1, rgb2) {
    var l1 = luminance(rgb1[0], rgb1[1], rgb1[2]) + 0.05;
    var l2 = luminance(rgb2[0], rgb2[1], rgb2[2]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }
  function parseRgb(str) {
    var m = str.match(/\d+/g);
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  var heroBody = document.querySelector('.hero-body');
  var featureBody = document.querySelector('.feature-body');
  var bg = getComputedStyle(document.body).backgroundColor;
  var surface = getComputedStyle(document.querySelector('.card')).backgroundColor;
  return {
    heroBodyOnBg: contrast(
      parseRgb(getComputedStyle(heroBody).color),
      parseRgb(bg)
    ),
    featureBodyOnSurface: contrast(
      parseRgb(getComputedStyle(featureBody).color),
      parseRgb(surface)
    ),
  };
})()
```

Expected: both values are `4.5` or higher (WCAG AA for body text). These use `--text-muted` (`#676158`), which `lib/theme.test.ts` already asserts clears 4.58:1 on the surface color and 5.15:1 on the background — this step confirms the same tokens still measure correctly once copied into plain CSS. If either value is below 4.5, the token was copied incorrectly; re-check the hex value against `lib/theme.ts` rather than picking a new color.

- [ ] **Step 5: Reset viewport and stop the preview server**

Call `mcp__Claude_Browser__resize_window` `{"preset": "desktop"}`. Call `mcp__Claude_Browser__preview_stop` with the `serverId` returned by the original `preview_start` call (or from `mcp__Claude_Browser__preview_list` if it was lost).

- [ ] **Step 6: Final commit (only if Steps 2-4 required a fix)**

If no fixes were needed, skip this step — Task 7's commit already covers the content-complete state. If a fix was made:

```bash
git add marketing/index.html
git commit -m "fix(marketing): resolve overflow/contrast/console issue found in verification pass"
```
