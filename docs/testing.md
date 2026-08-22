# Testing

Five layers, each covering something the others structurally cannot.

| Layer | Runner | Covers | Blind to |
|---|---|---|---|
| Logic | Vitest | Pure functions in `lib/` | Anything rendered |
| Schema contract | Vitest + local Supabase | The DB↔client seam — column names, types, JSON shape | UI |
| Database | pgTAP | RLS policies, triggers, constraints | Everything above SQL |
| Component | Vitest + @testing-library/react | Screen structure, navigation, state transitions | Colour, layout, truncation, **and all native rendering — see below** |
| Visual | Playwright | Colour, layout, truncation, at real viewport widths | Logic, data, and native rendering (Chromium web only) |

## Why the visual layer exists

Four rendering defects reached a human reviewer while all three original suites
were green: a missing back button that stranded users on the notifications
screen, a toggle knob rendering in a colour absent from the palette, a truncated
time label, and the layout stretching edge-to-edge on desktop. The component
layer catches the first. Nothing but the visual layer catches the rest.

## Why the threshold is an absolute pixel budget, not a ratio

`playwright.config.ts` sets `maxDiffPixels: 120` — a fixed count of differing
pixels, not `maxDiffPixelRatio`, a fraction of the page. It started as a ratio
(`maxDiffPixelRatio: 0.01`) and was changed after that ratio was shown,
empirically, not to catch the defect class this suite exists for.

A ratio scales with the size of the page, so it silently forgives small
elements: a 62×34 toggle knob is ~2,100px, and on a 375×812 mobile page that
is ~304,500px total, so the knob is only ~0.69% of the page — under a 1%
ratio. Proving this wasn't theoretical: a whole-theme accent-colour mutation
was run against the original `0.01` ratio and **passed** on
`notifications at mobile`, the exact page whose toggle-colour bug is why this
suite exists.

After switching to `maxDiffPixels: 120`, the same two mutations were re-run:

- The whole-theme accent mutation now fails all six baselines, with diffs
  ranging from 2,866px (`notifications-mobile`) to 24,330px
  (`notifications-desktop`) — every one far past the 120px budget.
- A narrower mutation, changing only the toggle track colour, fails both
  notifications baselines at 1,123px each. Under the old ratio, 1,123px is
  ~0.37% of the mobile page and ~0.28% of desktop — still comfortably under
  1%, so the ratio would have let this regression through too.

The lesson for future maintainers: do not "simplify" this back to a ratio to
make a large layout change stop tripping the suite. A ratio that is loose
enough to tolerate a full-page redesign is also loose enough to hide a single
mis-coloured control, which is precisely the failure mode this layer was
built to close.

## Which library, and why

`@testing-library/react` passed the spike; `@testing-library/react-native` did
not.

`vitest.config.mts` aliases `react-native` to `react-native-web`, so `<View>`
and `<Text>` from `react-native` resolve to plain DOM elements (`<div>`,
`<h1>` with `role="heading"`, etc.) under Vitest. `@testing-library/react`
queries that DOM directly with `render`/`screen.getByText`/`screen.getByRole`,
and both spike assertions pass with cleanup registered globally (see below).

`@testing-library/react-native` does not go through that DOM at all — it
renders through `react-test-renderer` against the real, native `react-native`
package, independent of the `react-native` → `react-native-web` alias. In this
repo that real package cannot even be loaded by Vitest's parser. The isolated
spike run failed with:

```
file:///Users/anandsubramanian/Documents/Claude/Projects/MahjongApp/node_modules/react-native/index.js:27
import typeof * as ReactNativePublicAPI from './index.js.flow';
       ^^^^^^

SyntaxError: Unexpected token 'typeof'
    at compileSourceTextModule (node:internal/modules/esm/utils:318:16)
    at ModuleLoader.importSyncForRequire (node:internal/modules/esm/loader:358:18)
    at loadESMFromCJS (node:internal/modules/cjs/loader:1649:24)
    ...
```

`react-native/index.js` is Flow-typed source (`import typeof * as X from
'./index.js.flow'` is Flow syntax, not valid JS), the same class of problem
the existing `resolve.alias` comment in `vitest.config.mts` already warns
about for plain imports of `react-native`. The alias only matches the exact
specifier `"react-native"`; `@testing-library/react-native` and its
dependencies reach into `react-native`'s internals in a way that resolves the
real package regardless, so the alias does not save it here. This was
reproduced identically with and without the alias applied (via `vite-node`
against `vitest.config.mts` directly), confirming it is not an artifact of how
the test was invoked.

One other finding from the spike, unrelated to which library won:
`@testing-library/react`'s automatic per-test cleanup only registers when it
detects a global `afterEach` function (`typeof afterEach === 'function'` in
its own source). This repo's Vitest config does not set `test.globals: true`,
so that global does not exist, and without cleanup being registered somewhere
DOM nodes from one test leak into the next, causing spurious "found multiple
elements" failures.

Cleanup is registered once, globally, in `vitest.setup.ts` (wired in via
`test.setupFiles` in `vitest.config.mts`) — component test authors do not
need to do anything themselves. `test.globals: true` was deliberately not
used for this, since it would inject Jest-style ambient globals across the
whole suite, including the existing `lib/` tests; `setupFiles` runs a single
module before each test file and registers one hook, with no such blast
radius.

## What the component layer does not cover

Component tests run under Vitest with `react-native` aliased to
`react-native-web` (see `vitest.config.mts`). That means every component test
exercises the **web render** of a screen — `<View>` and `<Text>` resolving to
`<div>`, `<h1 role="heading">`, and so on — not native iOS or Android
rendering. `@testing-library/react-native` was tried specifically to get
native coverage and could not be made to work at all in this repo: it fails
at parse time on Flow syntax inside `react-native`'s own internals, which the
`react-native-web` alias never intercepts (see above). There is currently no
substitute for it here.

**Consequence: genuine native rendering differences are uncovered by any
layer in this repo until Maestro simulator flows arrive in Phase 3.** A
passing component test says a screen's web DOM structure and state
transitions are correct; it says nothing about how that screen actually
paints on an iPhone or an Android device. Do not treat green component tests
as evidence that native rendering is fine.

Two other modules are stubbed out for component tests, for the same
Flow-parsing reason as the `react-native` alias above, and so are equally
untested at this layer:

- `@react-native-community/datetimepicker` → `test/stubs/datetimepicker.tsx`,
  which renders nothing. The real platform time picker's appearance and
  behaviour are not exercised by component tests.
- `react-native-svg` → `test/stubs/react-native-svg.tsx`, whose `Svg`,
  `Circle`, `Path`, etc. all render as a no-op passthrough. Real icon
  rendering is not exercised by component tests.

For both, the visual layer is what actually covers how they paint — it runs
against a real production web build, so the true `TimeField` control and the
true SVG icons appear in its screenshots. Native versions of either are still
uncovered until Maestro.

## Running

    npm test              # logic + component
    npm run test:contract # schema contract (needs the local stack)
    npm run test:visual   # visual regression (needs the local stack)
    npx supabase test db --local   # pgTAP

## Prerequisites

Component and logic tests need nothing. The schema-contract and visual suites
need the local Supabase stack:

    npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit

Visual tests additionally need three environment variables, all printed by
`npx supabase status`:

    SUPABASE_LOCAL_URL=http://127.0.0.1:54321
    SUPABASE_LOCAL_ANON_KEY=<anon/publishable key from supabase status>
    SUPABASE_LOCAL_SERVICE_ROLE_KEY=<service_role key from supabase status>

The service_role key is for local test setup only. It bypasses RLS entirely and
must never reach the app bundle or a hosted project.

**Visual tests run entirely against the local stack, not the hosted dev
project.** `playwright.config.ts` rebuilds the web bundle with the local URL and
anon key, overriding `.env.local` for that build. This is not incidental: a
session minted against one Supabase project is not valid for another, so
building against the hosted project would make every signed-in test fail to
authenticate — and the failure would look like a Playwright problem rather than
a configuration one.

## Updating visual baselines

When a design change is intentional:

    npx playwright test --update-snapshots

Then **look at every changed PNG** before committing. Review them in the pull
request like any other change — a baseline regenerated without being examined
turns a regression into the new expected state.

## When a visual test fails

Read the diff image in `test-results/` first. Raising `maxDiffPixels` to
make a failure go away defeats the layer's only purpose — see "Why the
threshold is an absolute pixel budget, not a ratio" above for what that
threshold protects against. If a diff is genuinely non-deterministic, mask
that region instead.
