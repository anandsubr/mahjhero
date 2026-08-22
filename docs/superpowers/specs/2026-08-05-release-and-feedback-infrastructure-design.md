# MahjHero Release & Feedback Infrastructure — Design

**Date:** 2026-08-05
**Status:** Approved (design); pending implementation plan
**Scope of this spec:** Phases 0–5. Phase 6 (EAS/app-store pipeline) and Phase 7
(reusable template) are follow-on specs — 6 is gated on external account
procurement, 7 depends on 1–5 being proven in production first.

## Goal

Establish a migration-based, tested, promotable release pipeline for the
MahjHero Expo app (web + mobile) on Supabase, plus an in-app feedback loop that
files GitHub issues and can drive a human-triaged autonomous fix→PR pipeline.
Prove the whole chain on MahjHero, then extract it as a template for future
projects (Phase 7).

## Context / current state

- **App:** Expo (React Native + web via `react-native-web`), TypeScript,
  expo-router. GitHub remote `anandsubr/mahjhero`.
- **Backend:** Supabase **Pro**, migration-based (`supabase/migrations/`, 4
  migrations), local dev via the Supabase CLI.
- **Tests already present:** Vitest for `lib/` logic + a schema-contract test
  (`REQUIRE_LOCAL_SUPABASE=1`); pgTAP db tests in `supabase/tests/database/`.
- **Deploy:** Vercel is connected to the repo. No `.github/workflows` yet, no
  `eas.json`, no prod Supabase project yet.
- **Accounts not yet held:** Apple Developer, Google Play, Expo/EAS.

## Decisions (locked during brainstorming)

1. **Environment model A** — one persistent shared dev environment + prod (not
   ephemeral per-PR branching).
2. **Branch→env mapping A** — two long-lived branches; promotion is a
   `develop`→`main` PR.
3. **Mobile testing B** — component/db/web tests on every PR; Maestro simulator
   smoke flows gated to the promotion PR only.
4. **Feedback loop A** — human-triaged: feedback → issue; `agent-go` label
   triggers an always-PR (never auto-merge) agent fix.

---

## 1. Environment topology

| Git branch  | Supabase project      | Web (Vercel)                          | Purpose             |
| ----------- | --------------------- | ------------------------------------- | ------------------- |
| `develop`   | **dev** project       | `dev.mahjhero.app` (pinned alias)     | shared dev env      |
| `main`      | **prod** project (new)| `mahjhero.app` (production branch)    | live                |

- Feature branches PR into `develop`.
- Promotion to prod = a reviewable **`develop`→`main` PR** with test results
  attached.
- Migrations stay in `supabase/migrations/` (forward-only).

## 2. Migration flow (migration-based, promotable)

- **Every PR:** CI spins up an *ephemeral local* Supabase (`supabase db reset`),
  applies all migrations from scratch, and runs pgTAP + the schema-contract
  test — proving migrations apply cleanly and schema matches code before
  touching any real project.
- **Merge to `develop`:** `supabase db push` against the **dev** project.
- **Merge to `main`:** `supabase db push` against the **prod** project, inside a
  GitHub `prod` Environment with an optional required-reviewer gate.
- Rollback = a new corrective migration (no destructive down-migrations).

## 3. Test orchestration (web / mobile / db)

- **`ci.yml`** — every PR, Linux, fast; gates all merges:
  - typecheck
  - `vitest`: `lib/` logic + web + React Native Testing Library component tests
  - schema-contract test
  - pgTAP db tests against ephemeral local Supabase
  - **visual regression** on the web target — Playwright screenshots of each
    screen at 375px and 1440px, diffed against committed baselines

### Why visual regression is in the gate, not a later phase

Three real defects were found by a human opening the app after the full suite
(89 Vitest + 6 contract + 11 pgTAP) passed green: a missing back button that
stranded users on the notifications screen, a toggle knob rendering in a colour
absent from the palette, and a time label truncating inside its field. A fourth,
the layout stretching edge-to-edge on desktop, was found the same way.

Of those four, RNTL catches exactly one (the missing element). Maestro drives
flows, not pixels. pgTAP and the logic tests are structurally blind to all of
them. **Colour, truncation, and layout have no coverage anywhere else in this
pyramid** — and they are where every rendering defect on this project has
actually landed so far.

`expo export -p web` already produces a real DOM, so this runs on the same Linux
runner as the rest of `ci.yml` with no macOS minutes. Baselines are committed and
reviewed like code; an intentional design change updates them in the same PR.
- **`e2e-mobile.yml`** — only on the `develop`→`main` promotion PR, macOS runner:
  boot iOS simulator, `expo prebuild`, run **Maestro** smoke flows for critical
  journeys. Reserved for promotion so everyday PRs stay fast/cheap.

## 4. Deploy pipelines

- **Web (Vercel, already connected):** Production Branch = `main`; alias the
  `develop` preview to `dev.mahjhero.app`. Build = `expo export -p web` →
  `dist/`.
- **Mobile (EAS):** build + submit — **Phase 6, gated on account procurement**
  (Apple Developer $99/yr + identity verification; Google Play $25 one-time;
  Expo/EAS account). Independent track. Until accounts exist, mobile = simulator
  + CI only.

## 5. Feedback capture → GitHub Issues

- Shared `<FeedbackButton>` component (one component, web + native via RN):
  category, description, optional screenshot.
- POSTs to a **Vercel serverless function `/api/feedback`** that holds a GitHub
  token server-side (no token in the app bundle) and creates a structured issue
  labeled `feedback` + platform + app version + device metadata. Screenshots go
  to Supabase Storage and are linked. Requests authenticated with the user's
  Supabase JWT to curb spam.

## 6. Issue → autonomous fix → PR (human-triaged)

- Feedback lands as an issue labeled `feedback`. **You apply `agent-go`** to the
  ones worth attempting.
- `agent-fix.yml` (`anthropics/claude-code-action`) triggers on that label:
  branches off `develop` as `agent/issue-<n>`, attempts the fix, runs the full
  `ci.yml` suite, opens a **PR into `develop`** with test results in the body.
- **Never auto-merges** — flows through normal review + dev→promote gates, so
  nothing reaches prod without a human.

## 7. Reusability (meta-goal — deferred, own spec)

After the chain is proven on MahjHero, extract workflows, the feedback
component + function, and the Supabase CI scripts into a **GitHub template
repo** parameterized by project refs/domains. Not built up front.

---

## Secrets inventory (GitHub Actions, scoped by Environment)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (dev + prod), `VERCEL_TOKEN`,
`ANTHROPIC_API_KEY`, a GitHub token for the feedback function, and later
`EXPO_TOKEN` + store credentials (Phase 6).

## Build order

0. **Provision** — create prod Supabase project; DNS for `mahjhero.app` /
   `dev.mahjhero.app`; create `develop` branch; set Vercel production branch;
   load secrets + GitHub Environments (`dev`, `prod`).
1. **CI test gate** (`ci.yml`), built in two steps:
   1a. **Component-test harness** — RNTL under Vitest (validate the risk above
       first), plus Playwright visual regression on the web target. Buildable
       today against the four existing screens; needs none of Phase 0.
   1b. **Wire both into `ci.yml`** alongside typecheck, schema-contract, and
       pgTAP, once the repo has `develop` and the GitHub Environments.
2. **Migration promotion + web deploy** (dev on `develop`, prod on `main`).
3. **Mobile E2E** (Maestro, promotion PR) — once real flows exist.
4. **Feedback widget + `/api/feedback`.**
5. **Agent-on-label pipeline** (`agent-fix.yml`).
6. **EAS mobile store pipeline** — when Apple/Google/Expo accounts exist
   (parallel track, separate spec).
7. **Extract template** (separate spec).

## Open items / risks

- **DNS/domain ownership** for `mahjhero.app` must be confirmed in Vercel.
- **Prod migration safety:** the `prod` GitHub Environment reviewer gate is
  secondary to the promotion-PR review; confirm whether you want both.
- **Feedback spam / abuse:** JWT auth + rate limiting on `/api/feedback`;
  revisit if abused.
- **Agent cost:** `agent-go` is the only trigger; monitor token/CI spend before
  considering auto-triage (a future graduation to two-stage).
- **macOS runner minutes:** E2E gated to promotion PRs to bound cost.
- **RNTL is a Jest-first library, and this repo runs Vitest.** `vitest.config.mts`
  aliases `react-native` → `react-native-web`, which hardcodes
  `Platform.OS === 'web'`; RNTL expects to render real React Native through
  `react-test-renderer`. Those assumptions may not compose — the likely failure
  mode is quietly testing DOM output (really `@testing-library/react` territory)
  while believing native components are under test. **Prove this with one
  throwaway test before building a suite on it.** If it does not hold, the fork
  is either a Jest project alongside Vitest for component tests, or accepting
  `@testing-library/react` against the web render and leaning on Maestro for
  native behaviour.
- **Visual-regression flakiness:** font loading (Caprasimo/Figtree are fetched),
  antialiasing, and scrollbar width all shift pixels between environments. Pin
  the browser version, wait on `document.fonts.ready`, and mask any genuinely
  non-deterministic region rather than raising the diff threshold until the
  tests stop meaning anything.
