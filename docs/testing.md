# Testing

Four layers, each covering something the others structurally cannot.

| Layer | Runner | Covers | Blind to |
|---|---|---|---|
| Logic | Vitest | Pure functions in `lib/` | Anything rendered |
| Schema contract | Vitest + local Supabase | The DB↔client seam — column names, types, JSON shape | UI |
| Database | pgTAP | RLS policies, triggers, constraints | Everything above SQL |
| Component | Vitest + @testing-library/react | Screen structure, navigation, state transitions | Colour, layout, truncation |
| Visual | Playwright | Colour, layout, truncation, at real viewport widths | Logic, data |

## Why the visual layer exists

Four rendering defects reached a human reviewer while all three original suites
were green: a missing back button that stranded users on the notifications
screen, a toggle knob rendering in a colour absent from the palette, a truncated
time label, and the layout stretching edge-to-edge on desktop. The component
layer catches the first. Nothing but the visual layer catches the rest.

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

## Running

    npm test              # logic + component
    npm run test:contract # schema contract (needs the local stack)
    npm run test:visual   # visual regression (needs the local stack)
    npx supabase test db --local   # pgTAP
