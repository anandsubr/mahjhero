# Component Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the coverage gap where every rendering defect on this project has landed — give the four existing screens component tests for structure and behaviour, and pixel baselines for colour, truncation, and layout.

**Architecture:** Two independent layers. Component tests run under the existing Vitest setup, rendering screens against `react-native-web` (which the repo already aliases). Visual regression runs Playwright against the real `expo export -p web` build, screenshotting each screen at 375px and 1440px and diffing committed baselines. Authenticated screens are reached by minting a session through Supabase's admin API against the local stack — never by faking auth in app code.

**Tech Stack:** Vitest (already present), a React testing library chosen empirically in Task 1, Playwright, the local Supabase stack.

**Spec:** [../specs/2026-08-05-release-and-feedback-infrastructure-design.md](../specs/2026-08-05-release-and-feedback-infrastructure-design.md) — Phase 1a.

## Global Constraints

Every task's requirements implicitly include these.

- **This plan adds tests only.** No production behaviour changes. If a test fails because the app is wrong, report it — do not edit `app/` or `lib/` to make a test pass without saying so.
- **No auth bypass in app code.** Sessions for tests are minted externally and injected. A test-only code path inside the app is a defect, not a shortcut.
- **`service_role` keys never enter the app bundle.** They are for test setup against the local stack only, read from the environment, never committed and never imported by anything under `app/` or `lib/`.
- **The existing suites must keep passing:** 89 Vitest, 6 schema-contract, 11 pgTAP.
- **Visual baselines are reviewed like code.** An intentional design change updates them in the same PR that changes the design.
- **18pt is the app-wide minimum body text size.** Helper text at 16pt is the sole exception. Tests must not encode values below that as correct.
- Local stack start command:
  `npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit`

---

### Task 1: Establish which testing library actually works here

**Files:**
- Create: `components/__tests__/spike.test.tsx`
- Modify: `package.json`
- Create: `docs/testing.md`

**Interfaces:**
- Consumes: the existing `vitest.config.mts`, which aliases `react-native` → `react-native-web`.
- Produces: a documented decision — either `@testing-library/react-native` or `@testing-library/react` — that Tasks 2 and 3 build on, plus whatever config both need.

**Why this task exists.** The spec names React Native Testing Library, but RNTL is Jest-first and expects to render real React Native through `react-test-renderer`. This repo runs Vitest and aliases `react-native` to `react-native-web`, so components resolve to DOM elements. Those assumptions may not compose. The failure mode to avoid is subtle: a suite that appears to test native components while actually testing DOM output. Settle it with evidence before building on it.

- [ ] **Step 1: Install both candidates and a DOM environment**

```bash
npm install --save-dev @testing-library/react-native @testing-library/react @testing-library/dom jsdom
```

- [ ] **Step 2: Add a jsdom environment to the Vitest config**

In `vitest.config.mts`, add `environment: 'jsdom'` inside the existing `test` block, leaving `env` and the `resolve.alias` exactly as they are:

```ts
  test: {
    environment: 'jsdom',
    env: {
      // ...existing placeholder env vars, unchanged
    },
  },
```

- [ ] **Step 3: Write the spike test against BOTH libraries**

Create `components/__tests__/spike.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { Text, View } from 'react-native';
import { render as renderDom, screen } from '@testing-library/react';

function Probe() {
  return (
    <View>
      <Text accessibilityRole="header">Quiet hours</Text>
    </View>
  );
}

describe('testing library spike', () => {
  it('renders a React Native tree and finds text via @testing-library/react', () => {
    renderDom(<Probe />);
    expect(screen.getByText('Quiet hours')).toBeTruthy();
  });

  it('exposes the accessibility role as a queryable attribute', () => {
    renderDom(<Probe />);
    expect(screen.getByRole('heading')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the spike**

Run: `npm test -- spike`
Expected: both tests PASS.

If they pass, `@testing-library/react` works against the `react-native-web` render and is the library to use. Record that.

If they fail, try the RNTL equivalent in the same file before concluding anything:

```tsx
import { render as renderNative, screen as nativeScreen } from '@testing-library/react-native';

it('renders via RNTL', () => {
  renderNative(<Probe />);
  expect(nativeScreen.getByText('Quiet hours')).toBeTruthy();
});
```

Run it and record which of the two works. **Do not proceed to Task 2 until one of them demonstrably passes** — and if neither does, report BLOCKED with both error outputs rather than guessing at config.

- [ ] **Step 5: Remove the loser and document the decision**

Delete whichever library's test did not work from `spike.test.tsx`, and uninstall it:

```bash
npm uninstall @testing-library/react-native   # or @testing-library/react, whichever lost
```

Create `docs/testing.md`:

```markdown
# Testing

Four layers, each covering something the others structurally cannot.

| Layer | Runner | Covers | Blind to |
|---|---|---|---|
| Logic | Vitest | Pure functions in `lib/` | Anything rendered |
| Schema contract | Vitest + local Supabase | The DB↔client seam — column names, types, JSON shape | UI |
| Database | pgTAP | RLS policies, triggers, constraints | Everything above SQL |
| Component | Vitest + <library chosen in Task 1> | Screen structure, navigation, state transitions | Colour, layout, truncation |
| Visual | Playwright | Colour, layout, truncation, at real viewport widths | Logic, data |

## Why the visual layer exists

Four rendering defects reached a human reviewer while all three original suites
were green: a missing back button that stranded users on the notifications
screen, a toggle knob rendering in a colour absent from the palette, a truncated
time label, and the layout stretching edge-to-edge on desktop. The component
layer catches the first. Nothing but the visual layer catches the rest.

## Which library, and why

<Record here: which of @testing-library/react or @testing-library/react-native
passed the spike, the actual error from the one that failed, and the reason —
`vitest.config.mts` aliases `react-native` to `react-native-web`, so components
resolve to DOM elements.>

## Running

    npm test              # logic + component
    npm run test:contract # schema contract (needs the local stack)
    npm run test:visual   # visual regression (needs the local stack)
    npx supabase test db --local   # pgTAP
```

- [ ] **Step 6: Confirm the existing suite is unaffected**

Run: `npm test`
Expected: 89 existing tests still pass, plus the surviving spike tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.mts components/__tests__/spike.test.tsx docs/testing.md
git commit -m "test: establish the component testing library empirically"
```

---

### Task 2: Regression tests for the four defects found by hand

**Files:**
- Create: `app/__tests__/notifications.test.tsx`
- Create: `app/__tests__/profile.test.tsx`
- Delete: `components/__tests__/spike.test.tsx`

**Interfaces:**
- Consumes: the library chosen in Task 1.
- Produces: the mocking pattern (`vi.mock` of `../../lib/session`, `../../lib/profile`) that Task 3 reuses.

**The code below imports `@testing-library/react`,** which is the expected winner of Task 1's spike — `vitest.config.mts` aliases `react-native` to `react-native-web`, so components resolve to DOM. **If Task 1 found that `@testing-library/react-native` won instead, adapt every import and query in this task to RNTL's API** (`render` and `screen` from `@testing-library/react-native`, `getByText` unchanged, `getByRole` becomes `getByRole` with RN role names). Do not install both to avoid the edit — Task 1 removed the loser deliberately.

**Why these four.** Each corresponds to a defect that actually shipped and was found by a person opening the app. A regression test that cannot fail against the pre-fix code is worthless — Step 4 proves each one can.

- [ ] **Step 0: Stub the Flow-shipping native modules**

Task 1's spike rendered a trivial inline component and passed. Importing a **real screen** fails, because two third-party packages ship untranspiled Flow that Vitest cannot parse:

- `app/notifications.tsx` → `components/TimeField` → `@react-native-community/datetimepicker`
  → `SyntaxError` at `datetimepicker.js:1` (`@flow strict-local`)
- `app/profile.tsx` → `components/SkillLevelPicker` → `components/icons` → `react-native-svg`
  → `SyntaxError: Unexpected token 'typeof'`

Stub both, the same way `react-native` is already aliased to `react-native-web`. These are third-party rendering internals; the component layer's job is screen structure, navigation, and state, and the Playwright visual layer covers how they actually paint.

Create `test/stubs/datetimepicker.tsx`:

```tsx
// @react-native-community/datetimepicker ships untranspiled Flow, which
// Vitest cannot parse. Component tests care that TimeField renders and
// reports a value, not how the platform picker paints — Playwright's
// visual layer covers that.
export default function DateTimePicker() {
  return null;
}
```

Create `test/stubs/react-native-svg.tsx`:

```tsx
// react-native-svg reaches into react-native internals that the
// react-native-web alias does not intercept. Icons carry no behaviour worth
// asserting here; the visual layer verifies they render.
import type { ReactNode } from 'react';

const Noop = ({ children }: { children?: ReactNode }) => <>{children}</>;

export default Noop;
export const Svg = Noop;
export const Circle = Noop;
export const Path = Noop;
export const Rect = Noop;
export const G = Noop;
export const Line = Noop;
```

Add both to `resolve.alias` in `vitest.config.mts`, alongside the existing `react-native` entry:

```ts
      '@react-native-community/datetimepicker': new URL(
        './test/stubs/datetimepicker.tsx', import.meta.url,
      ).pathname,
      'react-native-svg': new URL(
        './test/stubs/react-native-svg.tsx', import.meta.url,
      ).pathname,
```

Then confirm a screen imports cleanly before writing any assertions:

Run: `npx vitest run app/__tests__ 2>&1 | tail -5`
Expected: the `SyntaxError` failures are gone. Assertion failures at this point are fine — Steps 1–3 fix those.

**If another Flow-shipping module surfaces, stub it the same way and record it.** If stubbing proves insufficient — for instance a screen genuinely cannot render without the real module — stop and report BLOCKED rather than deleting assertions to get green.

- [ ] **Step 1: Write the notifications tests**

Create `app/__tests__/notifications.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationSettings from '../notifications';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

vi.mock('../../lib/profile', () => ({
  fetchPreferences: vi.fn(async () => ({
    notify_channel: 'both',
    mute_need_a_fourth: false,
    quiet_hours_enabled: true,
    quiet_hours_start: '21:00',
    quiet_hours_end: '08:00',
  })),
  updatePreferences: vi.fn(async () => ({ error: null })),
  isValidQuietWindow: () => true,
}));

describe('notifications screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a way back to the profile screen', async () => {
    render(<NotificationSettings />);
    expect(await screen.findByText('Profile')).toBeTruthy();
  });

  it('lists the default channel first', async () => {
    render(<NotificationSettings />);
    await screen.findByText('Push and email');
    const options = screen.getAllByText(/Push and email|Push only|Email only/);
    expect(options[0].textContent).toBe('Push and email');
  });
});
```

- [ ] **Step 2: Write the profile tests**

Create `app/__tests__/profile.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfileScreen from '../profile';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

const fetchProfile = vi.fn();

vi.mock('../../lib/profile', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
  updateProfile: vi.fn(async () => ({ error: null })),
  isCompleteProfile: (p: { display_name: string; skill_level: string | null }) =>
    p.display_name.trim().length > 0 && p.skill_level !== null,
}));

describe('profile screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error rather than a blank editable form when the load fails', async () => {
    fetchProfile.mockResolvedValueOnce(null);
    render(<ProfileScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('explains why Save is unavailable when the profile is incomplete', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: '',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(
      await screen.findByText(/Add your name and skill level/),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- app/__tests__`
Expected: 4 tests PASS.

If a query fails because the rendered text differs from what is written above, **read the screen and fix the test to match the app** — the app is correct here, these are regression tests for already-fixed bugs. If a test fails because the app genuinely lacks the behaviour, report it rather than weakening the assertion.

- [ ] **Step 4: Prove each test can fail**

For each of the four, mutate the app, confirm the test fails, then revert:

| Test | Mutation | Expected failure |
|---|---|---|
| back to profile | delete the back button block in `app/notifications.tsx` | `Unable to find an element with the text: Profile` |
| default channel first | change `CHANNELS` to `['push', 'email', 'both']` | received `Push only` |
| load failure shows error | make the failure branch render the form anyway | `Could not reach MahjHero` not found |
| incomplete explains why | delete the help text block in `app/profile.tsx` | `Add your name and skill level` not found |

Record the actual failure output for each in your report. Verify `git diff` is empty afterwards.

- [ ] **Step 5: Delete the spike**

```bash
rm components/__tests__/spike.test.tsx
```

Its job was to settle the library question; `docs/testing.md` holds the answer now.

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: 93 tests pass (89 existing + 4 new), no warnings.

- [ ] **Step 7: Commit**

```bash
git add app/__tests__ docs/testing.md
git rm --cached components/__tests__/spike.test.tsx 2>/dev/null || true
git commit -m "test: add regression tests for the four hand-found defects"
```

---

### Task 3: A session helper for authenticated visual tests

**Files:**
- Create: `e2e/session.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the local Supabase stack.
- Produces: `mintSession(email: string): Promise<{ access_token: string; refresh_token: string }>` and `storageKeyFor(supabaseUrl: string): string`, both from `e2e/session.ts`. Task 4 uses both.

**The problem this solves.** Profile and notifications sit behind a session. Magic links cannot be clicked headlessly. The app must not gain a test-only bypass. So the session is minted outside the app, through Supabase's admin API against the local stack, and injected into browser storage before the page loads — exactly as a real sign-in would leave it.

- [ ] **Step 1: Install the Supabase client for test use**

`@supabase/supabase-js` is already a dependency. No install needed.

- [ ] **Step 2: Write the helper**

Create `e2e/session.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

/**
 * Mints a real session against the LOCAL Supabase stack for visual tests.
 *
 * Uses the admin API to generate a magic link, then extracts the tokens from
 * the returned URL — the same tokens a real sign-in would produce. The app
 * gains no test-only code path.
 *
 * The service_role key is read from the environment and is only ever pointed
 * at the local stack. It must never appear in the app bundle: nothing under
 * app/ or lib/ may import this file.
 */
export async function mintSession(
  email: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const url = process.env.SUPABASE_LOCAL_URL;
  const serviceRole = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error(
      'Set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY. Both are ' +
        'printed by `npx supabase start`. Never use hosted-project values here.',
    );
  }

  // Compare the parsed hostname exactly. A substring check is foolable —
  // `https://notlocalhost.evil.example.com` contains "localhost", and
  // `https://evil.com/?x=127.0.0.1` contains the loopback address. This is
  // the only control stopping a service_role key from being pointed at a
  // hosted project, so it has to actually hold.
  const hostname = new URL(url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`Refusing to mint sessions against a non-local URL: ${url}`);
  }

  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await admin.auth.admin.createUser({ email, email_confirm: true });

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);

  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error('generateLink returned no action_link');

  const verify = await fetch(actionLink, { redirect: 'manual' });
  const location = verify.headers.get('location');
  if (!location) throw new Error('magic link did not redirect');

  const fragment = new URL(location).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!access_token || !refresh_token) {
    throw new Error(`no tokens in redirect fragment: ${location}`);
  }

  return { access_token, refresh_token };
}

/**
 * The localStorage key supabase-js persists its session under, derived from
 * the project ref in the URL. Keep in step with the client's own convention.
 */
export function storageKeyFor(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}
```

- [ ] **Step 3: Ignore Playwright output**

Append to `.gitignore`:

```
test-results/
playwright-report/
e2e/.env
```

Baselines under `e2e/**/*-snapshots/` are **not** ignored — they are reviewed artefacts.

- [ ] **Step 4: Verify the helper against the running stack**

With the local stack up, run:

```bash
SUPABASE_LOCAL_URL=http://127.0.0.1:54321 \
SUPABASE_LOCAL_SERVICE_ROLE_KEY="$(npx supabase status -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).SERVICE_ROLE_KEY))')" \
node --experimental-strip-types -e "import('./e2e/session.ts').then(async m => { const s = await m.mintSession('visual-test@example.com'); console.log('got tokens:', s.access_token.slice(0,12) + '…'); })"
```

Expected: prints a token prefix. If `generateLink` or the redirect parse fails, report the actual error — do not substitute a different auth approach without saying so.

- [ ] **Step 5: Commit**

```bash
git add e2e/session.ts .gitignore
git commit -m "test: mint local Supabase sessions for authenticated visual tests"
```

---

### Task 4: Playwright visual regression across all four screens

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/visual.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `mintSession` and `storageKeyFor` from `e2e/session.ts`.
- Produces: committed baselines under `e2e/visual.spec.ts-snapshots/`, and the `npm run test:visual` script.

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write the config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  webServer: {
    // The real production web build, not the dev server — dev-only overlays
    // and HMR markers would pollute the baselines.
    //
    // CRITICAL: the bundle is built against the LOCAL Supabase, not the hosted
    // dev project that .env.local points at. `mintSession` issues tokens from
    // the local stack, and a token minted by one project is not valid for
    // another — build against the hosted project and every signed-in test
    // fails to authenticate for reasons that look like a Playwright problem.
    // These env vars override .env.local for this build only.
    command:
      'EXPO_PUBLIC_SUPABASE_URL="$SUPABASE_LOCAL_URL" ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_LOCAL_ANON_KEY" ' +
      'npx expo export -p web && npx serve dist -l 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  expect: {
    toHaveScreenshot: {
      // An absolute pixel budget, not a ratio.
      //
      // A ratio scales with page size and silently swallows small elements:
      // a 62x34 toggle knob is ~2,100px, which on a 375x812 page is 0.69% —
      // under a 1% ratio. This suite exists *because* a toggle knob rendered
      // in the wrong colour escaped every other test, so a threshold that
      // masks exactly that is worse than useless. A whole-theme accent
      // mutation was empirically shown to pass at 0.01 on notifications-mobile.
      //
      // 120px covers antialiasing jitter between machines while staying far
      // below any single control. Do not raise it to silence a diff — mask a
      // genuinely non-deterministic region instead.
      maxDiffPixels: 120,
    },
  },
});
```

Install the static server:

```bash
npm install --save-dev serve
```

- [ ] **Step 3: Write the visual spec**

Create `e2e/visual.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { mintSession, storageKeyFor } from './session';

// The LOCAL stack — the same project the bundle was built against in
// playwright.config.ts. Deliberately not EXPO_PUBLIC_SUPABASE_URL, which
// .env.local points at the hosted dev project; a session minted locally is
// not valid there, and the storage key would not match either.
const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? '';
const WIDTHS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Fonts are fetched, so a screenshot taken before they land is a false diff. */
async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

test.describe('signed out', () => {
  for (const vp of WIDTHS) {
    test(`sign-in at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/sign-in');
      await expect(page.getByText('Sign in to MahjHero')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`sign-in-${vp.name}.png`, {
        fullPage: true,
      });
    });
  }
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    const session = await mintSession(`visual-${Date.now()}@example.com`);
    const key = storageKeyFor(SUPABASE_URL);
    await page.addInitScript(
      ([k, s]) => window.localStorage.setItem(k, JSON.stringify(s)),
      [
        key,
        {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
        },
      ] as const,
    );
  });

  for (const vp of WIDTHS) {
    test(`profile at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/profile');
      await expect(page.getByText('Your profile')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`profile-${vp.name}.png`, {
        fullPage: true,
      });
    });

    test(`notifications at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/notifications');
      await expect(page.getByText('How should we reach you?')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`notifications-${vp.name}.png`, {
        fullPage: true,
      });
    });
  }
});
```

- [ ] **Step 4: Add the script**

In `package.json`, add to `scripts`:

```json
{
  "test:visual": "playwright test"
}
```

- [ ] **Step 5: Generate the baselines**

With the local stack running:

```bash
npx playwright test --update-snapshots
```

Expected: six PNGs written under `e2e/visual.spec.ts-snapshots/`.

**Open each one and look at it before committing.** A baseline captured from a broken render permanently encodes the bug as correct. Specifically confirm: the notifications screen shows the back button and cream-on-terracotta toggle, the time fields are stacked and not truncated, and at desktop width the content column is centred at 440px on a full-bleed cream background.

- [ ] **Step 6: Prove the diff catches a real regression**

Two mutations, because they test different things.

**6a — whole-theme change.** Set `colors.accentColor` in `lib/theme.ts` to `#00ff00` and run `npx playwright test`. Expect **all six** to fail. Record the diff-pixel count for each. If any screen passes, the threshold is masking a change that repaints the whole palette — report it rather than accepting it.

**6b — single-element change.** This is the one that matters. Revert 6a, then change only the toggle's *track* colour where `components/Toggle.tsx` renders its "on" state, so exactly one small control differs. Run `npx playwright test -g "notifications"`.

Expect **both notifications baselines to fail**. A 62×34 toggle is roughly 2,100 pixels — comfortably above the 120px budget, but it would sit under a 1% *ratio* on a 375×812 page. This step is what proves the harness catches the defect class it was built for: a toggle knob in the wrong colour escaped every other layer of testing on this project.

Revert, re-run, confirm green. Record all outputs and verify `git diff` is empty.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/visual.spec.ts package.json package-lock.json e2e/visual.spec.ts-snapshots
git commit -m "test: add Playwright visual regression at 375px and 1440px"
```

---

### Task 5: Document how to run and update the harness

**Files:**
- Modify: `docs/testing.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Complete the testing doc**

Append to `docs/testing.md`:

```markdown
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

Read the diff image in `test-results/` first. Raising `maxDiffPixelRatio` to
make a failure go away defeats the layer's only purpose; if a diff is genuinely
non-deterministic, mask that region instead.
```

- [ ] **Step 2: Point the README at it**

In `README.md`, under the Stack section, add:

```markdown
## Tests

Five layers — logic, schema contract, database, component, and visual
regression. See [docs/testing.md](docs/testing.md) for what each one covers,
what it is blind to, and how to run them.
```

- [ ] **Step 3: Run the full suite one last time**

```bash
npm test && npm run test:contract && npx supabase test db --local && npm run test:visual
```

Expected: 93 Vitest, 6 contract, 11 pgTAP, 6 visual — all passing.

- [ ] **Step 4: Commit**

```bash
git add docs/testing.md README.md
git commit -m "docs: document the five test layers and baseline workflow"
```

---

## What this plan does not cover

- **Maestro simulator flows.** Spec §3 gates those to the promotion PR on a macOS runner. They need `develop`/`main` to exist (Phase 0).
- **Wiring any of this into `ci.yml`.** That is Phase 1b and depends on Phase 0 provisioning.
- **Baselines for screens that do not exist yet.** Clubs, events, and messages get theirs in their own plans.
- **Cross-browser visual testing.** Chromium only. Firefox and WebKit render text differently enough to need their own baselines, which triples review cost for little return at this stage.
