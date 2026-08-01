# MahjHero Foundation & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A MahjHero app that runs on iOS, Android, and web, where a person can sign in by magic link, Google, or Apple, and edit their profile and notification preferences.

**Architecture:** One Expo/React Native codebase targeting three platforms, backed by Supabase. All schema lives in versioned SQL migrations; Row-Level Security is enabled from the first table rather than retrofitted. Database behaviour is tested with pgTAP against a local Supabase stack, because the database — not the app — owns authorization.

**Tech Stack:** Expo (React Native) with expo-router and TypeScript; Supabase (Postgres, Auth, RLS); pgTAP for database tests; Vitest for application logic tests.

**Spec:** [../specs/2026-08-01-mahjhero-v1-design.md](../specs/2026-08-01-mahjhero-v1-design.md)

## Global Constraints

Every task's requirements implicitly include these. Values are taken from the spec.

- **Three platforms from one codebase:** iOS, Android, and web. A change that builds on one but not the others is incomplete.
- **The web target is permanent.** Invite links must open a working app in a browser. Installing is an upgrade, never a prerequisite.
- **Sign in with Apple is mandatory on iOS** because Google sign-in is offered (App Store Review Guideline 4.8).
- **Verified email is the identity key.** Any provider verifying the same address must resolve to the existing profile. Duplicate profiles are a correctness bug, not a cosmetic one.
- **The database owns authorization.** RLS is enabled on every table in the same migration that creates it. No table ships without policies.
- **No passwords.** Magic link, phone OTP, Google, and Sign in with Apple only.
- **The app never reproduces NMJL card content**, in any phase.
- **Quiet hours are per-member, in the member's own timezone** — never a club setting.

---

### Task 1: Scaffold the Expo application

**Files:**
- Create: `package.json`, `app.json`, `tsconfig.json`, `.gitignore`
- Create: `app/_layout.tsx`
- Create: `app/index.tsx`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a runnable Expo project rooted at the repository root, with expo-router file-based routing under `app/`.

- [ ] **Step 1: Create the Expo project**

The repository already contains `README.md` and `docs/`. Scaffold into a temporary directory and move the files in, so nothing existing is overwritten.

```bash
npx create-expo-app@latest /tmp/mahjhero-scaffold --template blank-typescript
rsync -a \
  --exclude=.git \
  --exclude=README.md \
  --exclude=CLAUDE.md \
  --exclude=AGENTS.md \
  --exclude=LICENSE \
  /tmp/mahjhero-scaffold/ .
rm -rf /tmp/mahjhero-scaffold
```

**`--exclude=.git` is not optional.** `create-expo-app` initializes its own git repository in the scaffold directory; without that exclusion the rsync overwrites this repository's `.git` with the throwaway one and destroys all history.

- [ ] **Step 2: Add expo-router and web support**

```bash
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar react-dom react-native-web @expo/metro-runtime
```

- [ ] **Step 3: Point the entry point at expo-router**

Replace the `main` field in `package.json`:

```json
{
  "main": "expo-router/entry"
}
```

- [ ] **Step 4: Configure app.json for three platforms**

```json
{
  "expo": {
    "name": "MahjHero",
    "slug": "mahjhero",
    "scheme": "mahjhero",
    "version": "0.1.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "app.mahjhero.client"
    },
    "android": {
      "package": "app.mahjhero.client"
    },
    "web": {
      "bundler": "metro",
      "output": "single"
    },
    "plugins": ["expo-router"]
  }
}
```

- [ ] **Step 5: Delete the template entry file and create the router layout**

```bash
rm -f App.tsx
mkdir -p app
```

Create `app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `app/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>MahjHero</Text>
    </View>
  );
}
```

- [ ] **Step 6: Verify the web build compiles**

Run: `npx expo export --platform web`
Expected: completes without error and writes a `dist/` directory.

- [ ] **Step 7: Verify the native bundles compile**

Run: `npx expo export --platform ios --platform android`
Expected: completes without error. This checks the JavaScript bundles build for both native targets; it does not require Xcode or Android Studio.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Expo app with expo-router for iOS, Android, and web"
```

---

### Task 2: Link the Supabase dev project and set up the pgTAP test harness

**Files:**
- Create: `supabase/config.toml` (generated)
- Create: `supabase/migrations/<timestamp>_enable_pgtap.sql`
- Create: `supabase/tests/database/harness.test.sql`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a running local Supabase stack, a linked hosted dev project, a migrations directory, and a working `supabase test db --local` command. All later database tasks depend on this harness.

**Deployment model — two databases, different jobs:**

- **Tests run against a local stack** (`supabase test db --local`). The local Postgres connects as superuser, which pgTAP requires.
- **The app runs against the hosted `mahjhero-dev` project.** Migrations go there with `supabase db push`.

Both receive the same migrations, so schema stays identical.

**Do not attempt `supabase test db --linked`.** It was tried and abandoned for a structural reason: the CLI connects to a linked project as `cli_login_postgres`, a non-superuser that is absent from the `extensions` schema ACL. Supabase forces extensions into that schema and does not let a `grant usage ... to public` stick, so pgTAP's functions are unreachable — and Postgres reports the missing schema privilege as `function plan(integer) does not exist` rather than a permission error, which makes it look like the extension is missing when it is not.

**Prerequisites:** OrbStack (or Docker Desktop) installed and running, and several GB of free disk for the container images.

To keep the footprint small, start only the services the tests need:

```bash
npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit
```

**`supabase db reset` applies to the local database only.** It rebuilds local Postgres from the migrations in seconds and is the normal way to get a clean slate while iterating on schema. It has no remote equivalent — resetting the hosted dev project means recreating it in the dashboard, which is acceptable because that project holds no real data.

- [ ] **Step 1: Initialize the Supabase directory**

```bash
npx supabase init
```

Expected: creates `supabase/config.toml` and empty `migrations/` and `functions/` directories.

- [ ] **Step 2: Authenticate and link the dev project**

These two commands involve credentials — a browser authorization and the project's database password — so run them interactively yourself rather than delegating them.

```bash
npx supabase login
npx supabase link --project-ref <dev-project-ref>
```

Expected: `Finished supabase link.` The ref is the subdomain in your project's dashboard URL.

- [ ] **Step 3: Create the pgTAP migration**

```bash
npx supabase migration new enable_pgtap
```

Write into the generated file in `supabase/migrations/`:

```sql
create extension if not exists pgtap with schema extensions;
```

- [ ] **Step 4: Push the migration to the dev project**

```bash
npx supabase db push
```

Expected: lists the pending migration and reports it applied.

Every task that adds a migration must push it before its tests run. Unlike a local stack, nothing applies migrations implicitly.

- [ ] **Step 5: Write a harness test that proves the runner works**

Create `supabase/tests/database/harness.test.sql`:

```sql
begin;
select plan(1);

select ok(true, 'pgTAP harness runs');

select * from finish();
rollback;
```

- [ ] **Step 6: Run the test suite against the linked project**

Run: `npx supabase test db --local`
Expected: PASS — `harness.test.sql .. ok`

Every pgTAP test in this plan wraps itself in `begin`/`rollback`, so a test run leaves the dev database unchanged. That property is what makes running against a hosted project safe; do not write a test that omits it.

- [ ] **Step 7: Ignore Supabase artefacts and local environment files**

Append to `.gitignore`:

```
supabase/.branches
supabase/.temp
.env.local
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: link Supabase dev project with pgTAP test harness"
```

---

### Task 3: Profiles table with RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_profiles.sql`
- Create: `supabase/tests/database/profiles.test.sql`

**Interfaces:**
- Consumes: the pgTAP harness from Task 2.
- Produces: `public.profiles` with columns `id uuid`, `display_name text`, `skill_level skill_level`, `avatar_url text`, `timezone text`, `notify_channel notify_channel`, `mute_need_a_fourth boolean`, `quiet_hours_enabled boolean`, `quiet_hours_start time`, `quiet_hours_end time`. Also the enums `public.skill_level` (`beginner`/`intermediate`/`advanced`) and `public.notify_channel` (`push`/`email`/`both`), and the trigger function `public.handle_new_user()`. Every later plan reads from `profiles`.

**Note on the RLS policy scope:** in this plan a member may read only their own profile. Plan 2 (Clubs & membership) widens it so members who share an active club can read each other's profiles. Do not widen it here — there are no clubs yet to scope by.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/database/profiles.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(8);

-- Structure
select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'quiet_hours_start', 'has quiet_hours_start');
select has_column('public', 'profiles', 'mute_need_a_fourth', 'has mute_need_a_fourth');

-- A profile row is created automatically for a new auth user
insert into auth.users (id, email, raw_user_meta_data)
values (
  '11111111-1111-1111-1111-111111111111',
  'alice@example.com',
  '{"full_name": "Alice"}'::jsonb
);

select is(
  (select display_name from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'profile is auto-created with display_name from user metadata'
);

select is(
  (select quiet_hours_start from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  '21:00'::time,
  'quiet hours default to 21:00'
);

select is(
  (select quiet_hours_enabled from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  true,
  'quiet hours default to enabled'
);

-- RLS: a member reads their own profile and no one else's
insert into auth.users (id, email)
values ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select count(*)::int from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'member can read their own profile'
);

select is(
  (select count(*)::int from public.profiles
   where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'member cannot read another profile'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx supabase test db --local`
Expected: FAIL — `relation "public.profiles" does not exist`

- [ ] **Step 3: Write the migration**

```bash
npx supabase migration new create_profiles
```

Write into the generated file:

```sql
create type public.skill_level as enum ('beginner', 'intermediate', 'advanced');
create type public.notify_channel as enum ('push', 'email', 'both');

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null default '',
  skill_level         public.skill_level,
  avatar_url          text,
  timezone            text not null default 'America/New_York',
  notify_channel      public.notify_channel not null default 'both',
  mute_need_a_fourth  boolean not null default false,
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start   time not null default '21:00',
  quiet_hours_end     time not null default '08:00',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Create a profile whenever an auth user is created, by any provider.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 4: Push the migration to the dev project**

Run: `npx supabase db push`
Expected: reports `create_profiles` applied.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx supabase test db --local`
Expected: PASS — all 8 assertions in `profiles.test.sql`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: add profiles table with RLS and auto-creation trigger"
```

---

### Task 4: Identity linking on verified email

**Files:**
- Create: `supabase/tests/database/identity_linking.test.sql`
- Modify: `supabase/config.toml`
- Create: `docs/auth-configuration.md`

**Interfaces:**
- Consumes: `public.profiles` and `public.handle_new_user()` from Task 3.
- Produces: a guarantee, asserted by test, that one verified email maps to exactly one row in `public.profiles`.

**Why this task exists:** the spec calls duplicate identities "unusually damaging" — a member would appear twice on a club roster with bookings split across both profiles, and the host would have no way to tell which to remove. This task verifies the behaviour empirically rather than assuming the platform default is correct.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/database/identity_linking.test.sql`:

```sql
begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(2);

-- One auth user, two verified identities for the same address
-- (as happens when someone signs up by magic link then uses Google).
insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

insert into auth.identities (id, user_id, provider, provider_id, identity_data)
values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'email', 'carol@example.com',
   '{"sub": "carol@example.com", "email": "carol@example.com"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '33333333-3333-3333-3333-333333333333',
   'google', 'google-oauth-subject-1',
   '{"sub": "google-oauth-subject-1", "email": "carol@example.com"}'::jsonb);

select is(
  (select count(*)::int from public.profiles
   where id = '33333333-3333-3333-3333-333333333333'),
  1,
  'two identities on one user still yield exactly one profile'
);

select is(
  (select count(distinct u.id)::int
   from auth.users u
   where u.email = 'carol@example.com'),
  1,
  'one verified email maps to exactly one auth user'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify current behaviour**

Run: `npx supabase test db --local`
Expected: PASS for both assertions. The `on conflict (id) do nothing` clause in `handle_new_user()` is what makes the first hold.

If either assertion fails, the trigger is creating duplicate profiles — fix `handle_new_user()` before continuing. Do not proceed with a failing assertion here; every later plan assumes one profile per person.

- [ ] **Step 3: Confirm automatic identity linking is on in the dashboard**

Because this project is remote-only, auth behaviour is configured in the Supabase dashboard rather than in `config.toml`. In the dev project, open **Authentication → Sign In / Providers** and confirm that manual linking is **disabled**.

Leaving manual linking off preserves Supabase's automatic behaviour: a provider sign-in carrying an already-verified email attaches to the existing user instead of creating a second one. That is precisely what the test in Step 1 asserts.

- [ ] **Step 4: Document the hosted-project configuration**

Create `docs/auth-configuration.md`:

```markdown
# Auth configuration

MahjHero treats **verified email as the identity key**. One verified address maps to
exactly one profile, regardless of how many providers the person uses.

## Required settings on the hosted Supabase project

These are not captured by migrations and must be set in the dashboard for each
environment (Authentication → Providers / Sign In).

| Setting | Value | Why |
|---|---|---|
| Email provider | Enabled, **magic link only** | The spec forbids passwords |
| Phone provider | Enabled (OTP) | Second passwordless route |
| Google provider | Enabled | Requested sign-in method |
| Apple provider | Enabled | Mandatory on iOS once Google is offered — App Store Review Guideline 4.8 |
| Confirm email | Enabled | Linking depends on the address being verified |
| Manual linking | Disabled | Leaves automatic linking on verified email in place |

## Why this matters

If two providers produce two profiles for one person, they appear twice on a club
roster, their bookings split across both, and a host cannot tell which to remove.
`supabase/tests/database/identity_linking.test.sql` asserts this cannot happen; run
it against any environment whose auth settings change.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/tests docs/auth-configuration.md
git commit -m "test: assert one verified email maps to one profile"
```

---

### Task 5: Supabase client and session provider

**Files:**
- Create: `lib/supabase.ts`
- Create: `lib/session.tsx`
- Create: `lib/session.test.ts`
- Create: `.env.local.example`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `public.profiles` from Task 3.
- Produces: `supabase` (a `SupabaseClient`), `SessionProvider` (React component), and `useSession(): { session: Session | null; loading: boolean }`. Tasks 6, 7, 8, and 9 all consume `useSession`.

- [ ] **Step 1: Install dependencies**

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `scripts`:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `lib/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveSessionState } from './session';

describe('resolveSessionState', () => {
  it('is loading before the first auth event', () => {
    expect(resolveSessionState(undefined)).toEqual({
      session: null,
      loading: true,
    });
  });

  it('is signed out when the first event carries no session', () => {
    expect(resolveSessionState(null)).toEqual({
      session: null,
      loading: false,
    });
  });

  it('is signed in when a session arrives', () => {
    const session = { access_token: 'token', user: { id: 'abc' } } as never;
    expect(resolveSessionState(session)).toEqual({
      session,
      loading: false,
    });
  });
});
```

The distinction between `undefined` (nothing has happened yet) and `null` (we asked and there is no session) is the whole point — without it the app flashes the sign-in screen on every cold start before restoring the stored session.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./session"`

- [ ] **Step 5: Create the Supabase client**

Create `lib/supabase.ts`:

```ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.local.example to .env.local and fill it in.',
  );
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    // On web, Supabase uses localStorage by default; AsyncStorage is native-only.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps have no URL to parse; web needs this for magic-link callbacks.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
```

- [ ] **Step 6: Create the session provider**

Create `lib/session.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from './supabase';

export type SessionState = {
  session: Session | null;
  loading: boolean;
};

/**
 * `undefined` means no auth event has arrived yet, so we are still loading.
 * `null` means we asked and there is no session.
 */
export function resolveSessionState(
  session: Session | null | undefined,
): SessionState {
  if (session === undefined) {
    return { session: null, loading: true };
  }
  return { session, loading: false };
}

const SessionContext = createContext<SessionState>({
  session: null,
  loading: true,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => setSession(nextSession),
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={resolveSessionState(session)}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 3 tests

- [ ] **Step 8: Create the environment template**

Create `.env.local.example`:

```
# From the dev project dashboard: Settings -> API
# The publishable key (sb_publishable_...) is a client key and is safe in a
# client bundle. Never put the service_role key here or anywhere in the app.
EXPO_PUBLIC_SUPABASE_URL=https://<dev-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
```

Then copy it to `.env.local` and fill in the real values. `.env.local` is git-ignored (Task 2).

- [ ] **Step 9: Wrap the app in the provider**

Replace `app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import { SessionProvider } from '../lib/session';

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client and session provider"
```

---

### Task 6: Magic-link sign-in

**Files:**
- Create: `app/sign-in.tsx`
- Create: `lib/auth.ts`
- Create: `lib/auth.test.ts`
- Modify: `app/index.tsx`

**Interfaces:**
- Consumes: `supabase` from Task 5, `useSession` from Task 5.
- Produces: `isValidEmail(value: string): boolean` and `sendMagicLink(email: string): Promise<{ error: string | null }>`, both from `lib/auth.ts`. Task 7 adds OAuth functions to the same module.

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidEmail } from './auth';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
  });

  it('accepts an address with a plus tag', () => {
    expect(isValidEmail('jane+mahjong@example.co.uk')).toBe(true);
  });

  it('trims surrounding whitespace before judging', () => {
    expect(isValidEmail('  jane@example.com  ')).toBe(true);
  });

  it('rejects an address with no domain', () => {
    expect(isValidEmail('jane@')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});
```

Whitespace trimming matters more than usual here: this audience will paste addresses, and a trailing space producing "that address looks wrong" is a support call to the club host.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./auth"`

- [ ] **Step 3: Write the implementation**

Create `lib/auth.ts`:

```ts
import { supabase } from './supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export async function sendMagicLink(
  email: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
  });
  return { error: error ? error.message : null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 8 tests total (3 from session, 5 from auth)

- [ ] **Step 5: Build the sign-in screen**

Create `app/sign-in.tsx`:

```tsx
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isValidEmail, sendMagicLink } from '../lib/auth';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!isValidEmail(email)) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setStatus('sending');
    const { error: sendError } = await sendMagicLink(email);
    if (sendError) {
      setError(sendError);
      setStatus('idle');
      return;
    }
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to {email.trim()}. Open it on this device.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Sign in to MahjHero</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email address"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={styles.button}
        onPress={onSubmit}
        disabled={status === 'sending'}
        accessibilityRole="button"
      >
        {status === 'sending' ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.buttonText}>Email me a sign-in link</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: '600' },
  body: { fontSize: 18, lineHeight: 26 },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
  },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  error: { color: '#b3261e', fontSize: 16 },
});
```

Font sizes here are deliberately larger than a typical default. The spec notes this audience skews older; 18pt body text is the floor for the whole app.

- [ ] **Step 6: Route signed-out users to sign-in**

Replace `app/index.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../lib/session';

export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={session ? '/profile' : '/sign-in'} />;
}
```

- [ ] **Step 7: Verify the web build still compiles**

Run: `npx expo export --platform web`
Expected: completes without error. The `/profile` route does not exist yet, so navigating there will 404 until Task 8 — the build itself must still succeed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add magic-link sign-in"
```

---

### Task 7: Google and Apple sign-in

**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/auth.test.ts`
- Modify: `app/sign-in.tsx`
- Modify: `app.json`

**Interfaces:**
- Consumes: `supabase` from Task 5, `isValidEmail` and `sendMagicLink` from Task 6.
- Produces: `signInWithProvider(provider: 'google' | 'apple'): Promise<{ error: string | null }>` and `availableProviders(platform: string): Array<'google' | 'apple'>`, both from `lib/auth.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/auth.test.ts`:

```ts
import { availableProviders } from './auth';

describe('availableProviders', () => {
  it('offers Apple alongside Google on iOS, as Guideline 4.8 requires', () => {
    expect(availableProviders('ios')).toEqual(['google', 'apple']);
  });

  it('offers only Google on Android', () => {
    expect(availableProviders('android')).toEqual(['google']);
  });

  it('offers both on web', () => {
    expect(availableProviders('web')).toEqual(['google', 'apple']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `availableProviders is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/auth.ts`:

```ts
export type OAuthProvider = 'google' | 'apple';

/**
 * App Store Review Guideline 4.8: an iOS app offering third-party sign-in must
 * also offer an equivalent privacy-preserving option. Sign in with Apple is that
 * option, so it is not optional wherever Google is present on iOS.
 */
export function availableProviders(platform: string): OAuthProvider[] {
  if (platform === 'android') {
    return ['google'];
  }
  return ['google', 'apple'];
}

export async function signInWithProvider(
  provider: OAuthProvider,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({ provider });
  return { error: error ? error.message : null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 11 tests total

- [ ] **Step 5: Enable Sign in with Apple in the native build config**

In `app.json`, add to the `expo.ios` object and the `expo.plugins` array:

```json
{
  "expo": {
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "app.mahjhero.client",
      "usesAppleSignIn": true
    },
    "plugins": ["expo-router", "expo-apple-authentication"]
  }
}
```

Then install the module:

```bash
npx expo install expo-apple-authentication
```

- [ ] **Step 6: Add provider buttons to the sign-in screen**

In `app/sign-in.tsx`, add these imports:

```tsx
import { Platform } from 'react-native';
import { availableProviders, signInWithProvider } from '../lib/auth';
```

Then insert this block immediately before the closing `</View>` of the main return:

```tsx
      <Text style={styles.divider}>or</Text>
      {availableProviders(Platform.OS).map((provider) => (
        <Pressable
          key={provider}
          style={styles.providerButton}
          onPress={async () => {
            const { error: providerError } = await signInWithProvider(provider);
            if (providerError) setError(providerError);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.providerButtonText}>
            Continue with {provider === 'google' ? 'Google' : 'Apple'}
          </Text>
        </Pressable>
      ))}
```

And add these entries to the `StyleSheet.create` object:

```tsx
  divider: { textAlign: 'center', fontSize: 16, color: '#666' },
  providerButton: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  providerButtonText: { fontSize: 18, fontWeight: '600' },
```

- [ ] **Step 7: Verify the build compiles**

Run: `npx expo export --platform web`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Google and Apple sign-in"
```

---

### Task 8: Profile screen

**Files:**
- Create: `app/profile.tsx`
- Create: `lib/profile.ts`
- Create: `lib/profile.test.ts`

**Interfaces:**
- Consumes: `supabase` from Task 5, `useSession` from Task 5, `public.profiles` from Task 3.
- Produces: the `Profile` type, `fetchProfile(userId: string)`, `updateProfile(userId, changes)`, and `isCompleteProfile(profile)` from `lib/profile.ts`. Task 9 extends the same module with notification preferences.

- [ ] **Step 1: Write the failing test**

Create `lib/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isCompleteProfile } from './profile';

describe('isCompleteProfile', () => {
  it('is complete with a display name and a skill level', () => {
    expect(
      isCompleteProfile({ display_name: 'Alice', skill_level: 'beginner' }),
    ).toBe(true);
  });

  it('is incomplete without a skill level', () => {
    expect(
      isCompleteProfile({ display_name: 'Alice', skill_level: null }),
    ).toBe(false);
  });

  it('is incomplete when the display name is only whitespace', () => {
    expect(
      isCompleteProfile({ display_name: '   ', skill_level: 'advanced' }),
    ).toBe(false);
  });
});
```

Skill level is required rather than optional because events tier their tables by it. A member with no skill level cannot be matched to a table, so the app must collect it before they reach any club. Step 5 uses this to disable the Save button until both fields are present, which is why it is worth extracting rather than inlining.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./profile"`

- [ ] **Step 3: Write the implementation**

Create `lib/profile.ts`:

```ts
import { supabase } from './supabase';

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export type Profile = {
  id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  avatar_url: string | null;
  timezone: string;
};

export function isCompleteProfile(profile: {
  display_name: string;
  skill_level: SkillLevel | null;
}): boolean {
  return profile.display_name.trim().length > 0 && profile.skill_level !== null;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, skill_level, avatar_url, timezone')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data as Profile;
}

export async function updateProfile(
  userId: string,
  changes: Partial<Pick<Profile, 'display_name' | 'skill_level' | 'timezone'>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', userId);

  return { error: error ? error.message : null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 14 tests total

- [ ] **Step 5: Build the profile screen**

Create `app/profile.tsx`:

```tsx
import { Link, Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchProfile, isCompleteProfile, updateProfile } from '../lib/profile';
import type { SkillLevel } from '../lib/profile';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

export default function ProfileScreen() {
  const { session, loading } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchProfile(session.user.id).then((profile) => {
      if (profile) {
        setDisplayName(profile.display_name);
        setSkillLevel(profile.skill_level);
      }
      setReady(true);
    });
  }, [session]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  async function onSave() {
    if (!session) return;
    await updateProfile(session.user.id, {
      display_name: displayName,
      skill_level: skillLevel,
    });
    setSaved(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Your profile</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={(value) => {
          setDisplayName(value);
          setSaved(false);
        }}
        placeholder="How your club knows you"
        accessibilityLabel="Display name"
      />

      <Text style={styles.label}>Skill level</Text>
      <Text style={styles.help}>
        Hosts use this to seat you at the right table.
      </Text>
      {LEVELS.map((level) => (
        <Pressable
          key={level}
          style={[
            styles.option,
            skillLevel === level ? styles.optionSelected : null,
          ]}
          onPress={() => {
            setSkillLevel(level);
            setSaved(false);
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected: skillLevel === level }}
        >
          <Text style={styles.optionText}>
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </Text>
        </Pressable>
      ))}

      {isCompleteProfile({ display_name: displayName, skill_level: skillLevel }) ? null : (
        <Text style={styles.help}>
          Add your name and skill level so hosts can seat you at the right table.
        </Text>
      )}
      <Pressable
        style={[
          styles.button,
          isCompleteProfile({ display_name: displayName, skill_level: skillLevel })
            ? null
            : styles.buttonDisabled,
        ]}
        onPress={onSave}
        disabled={
          !isCompleteProfile({ display_name: displayName, skill_level: skillLevel })
        }
        accessibilityRole="button"
        accessibilityState={{
          disabled: !isCompleteProfile({
            display_name: displayName,
            skill_level: skillLevel,
          }),
        }}
      >
        <Text style={styles.buttonText}>{saved ? 'Saved' : 'Save'}</Text>
      </Pressable>

      <Link href="/notifications" style={styles.linkRow}>
        <Text style={styles.link}>Notification settings</Text>
      </Link>

      <Pressable
        style={styles.signOut}
        onPress={() => supabase.auth.signOut()}
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  label: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  help: { fontSize: 16, color: '#666' },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
  },
  option: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 18,
  },
  optionSelected: { borderColor: '#1f6feb', borderWidth: 3 },
  optionText: { fontSize: 18 },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { backgroundColor: '#9db8e8' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  linkRow: { marginTop: 24 },
  link: { fontSize: 18, color: '#1f6feb' },
  signOut: { marginTop: 32, alignItems: 'center' },
  signOutText: { fontSize: 18, color: '#b3261e' },
});
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx expo export --platform web`
Expected: completes without error. The `/notifications` route arrives in Task 9.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add profile screen with display name and skill level"
```

---

### Task 9: Notification preferences

**Files:**
- Create: `app/notifications.tsx`
- Modify: `lib/profile.ts`
- Modify: `lib/profile.test.ts`

**Interfaces:**
- Consumes: `supabase` and `useSession` from Task 5, `Profile` from Task 8.
- Produces: `NotificationPreferences` type, `fetchPreferences(userId)`, `updatePreferences(userId, changes)`, and `isValidQuietWindow(start, end)` from `lib/profile.ts`. Plan 6 (Notifications) consumes all four.

- [ ] **Step 1: Write the failing test**

Append to `lib/profile.test.ts`:

```ts
import { isValidQuietWindow } from './profile';

describe('isValidQuietWindow', () => {
  it('accepts a window crossing midnight', () => {
    expect(isValidQuietWindow('21:00', '08:00')).toBe(true);
  });

  it('accepts a window inside one day', () => {
    expect(isValidQuietWindow('13:00', '15:00')).toBe(true);
  });

  it('rejects a zero-length window', () => {
    expect(isValidQuietWindow('21:00', '21:00')).toBe(false);
  });

  it('rejects a malformed time', () => {
    expect(isValidQuietWindow('9pm', '08:00')).toBe(false);
  });
});
```

A window crossing midnight is the *normal* case here — the default is 21:00 to 08:00 — so a naive `start < end` check would reject the default setting.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `isValidQuietWindow is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/profile.ts`:

```ts
export type NotifyChannel = 'push' | 'email' | 'both';

export type NotificationPreferences = {
  notify_channel: NotifyChannel;
  mute_need_a_fourth: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Quiet windows normally cross midnight (the default is 21:00–08:00), so any
 * distinct pair of valid times is a legal window. Only equal times are rejected,
 * because a zero-length window silently disables the feature.
 */
export function isValidQuietWindow(start: string, end: string): boolean {
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) return false;
  return start !== end;
}

export async function fetchPreferences(
  userId: string,
): Promise<NotificationPreferences | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'notify_channel, mute_need_a_fourth, quiet_hours_enabled, quiet_hours_start, quiet_hours_end',
    )
    .eq('id', userId)
    .single();

  if (error) return null;
  return data as NotificationPreferences;
}

export async function updatePreferences(
  userId: string,
  changes: Partial<NotificationPreferences>,
): Promise<{ error: string | null }> {
  const touchesStart = changes.quiet_hours_start !== undefined;
  const touchesEnd = changes.quiet_hours_end !== undefined;

  // Both bounds must travel together. Accepting one alone would let a caller
  // slip past validation and store a window this module considers invalid.
  if (touchesStart !== touchesEnd) {
    return { error: 'Quiet hours must be changed as a pair.' };
  }

  if (
    touchesStart &&
    touchesEnd &&
    !isValidQuietWindow(changes.quiet_hours_start!, changes.quiet_hours_end!)
  ) {
    return { error: 'Those quiet hours do not make sense.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', userId);

  return { error: error ? error.message : null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 18 tests total

- [ ] **Step 5: Build the notification settings screen**

Create `app/notifications.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchPreferences, updatePreferences } from '../lib/profile';
import type { NotificationPreferences, NotifyChannel } from '../lib/profile';
import { useSession } from '../lib/session';

const CHANNELS: NotifyChannel[] = ['push', 'email', 'both'];

export default function NotificationSettings() {
  const { session, loading } = useSession();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchPreferences(session.user.id).then(setPrefs);
  }, [session]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!prefs) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  function change(patch: Partial<NotificationPreferences>) {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
  }

  async function onSave() {
    if (!session || !prefs) return;
    const { error: saveError } = await updatePreferences(session.user.id, prefs);
    if (saveError) {
      setError(saveError);
      return;
    }
    setError(null);
    setSaved(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Notifications</Text>

      <Text style={styles.label}>How should we reach you?</Text>
      {CHANNELS.map((channel) => (
        <Pressable
          key={channel}
          style={[
            styles.option,
            prefs.notify_channel === channel ? styles.optionSelected : null,
          ]}
          onPress={() => change({ notify_channel: channel })}
          accessibilityRole="radio"
          accessibilityState={{ selected: prefs.notify_channel === channel }}
        >
          <Text style={styles.optionText}>
            {channel === 'both' ? 'Push and email' : channel === 'push' ? 'Push only' : 'Email only'}
          </Text>
        </Pressable>
      ))}

      <View style={styles.row}>
        <Text style={styles.label}>Quiet hours</Text>
        <Switch
          value={prefs.quiet_hours_enabled}
          onValueChange={(value) => change({ quiet_hours_enabled: value })}
          accessibilityLabel="Enable quiet hours"
        />
      </View>
      <Text style={styles.help}>
        We hold non-urgent notifications during these hours, in your own time zone.
        Reminders for games you have booked still come through.
      </Text>

      {prefs.quiet_hours_enabled ? (
        <View style={styles.row}>
          <TextInput
            style={styles.timeInput}
            value={prefs.quiet_hours_start}
            onChangeText={(value) => change({ quiet_hours_start: value })}
            placeholder="21:00"
            accessibilityLabel="Quiet hours start"
          />
          <Text style={styles.optionText}>to</Text>
          <TextInput
            style={styles.timeInput}
            value={prefs.quiet_hours_end}
            onChangeText={(value) => change({ quiet_hours_end: value })}
            placeholder="08:00"
            accessibilityLabel="Quiet hours end"
          />
        </View>
      ) : null}

      <View style={styles.row}>
        <Text style={styles.label}>Mute "need a 4th" alerts</Text>
        <Switch
          value={prefs.mute_need_a_fourth}
          onValueChange={(value) => change({ mute_need_a_fourth: value })}
          accessibilityLabel="Mute need a fourth alerts"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} onPress={onSave} accessibilityRole="button">
        <Text style={styles.buttonText}>{saved ? 'Saved' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  label: { fontSize: 18, fontWeight: '600' },
  help: { fontSize: 16, color: '#666', lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  option: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 18 },
  optionSelected: { borderColor: '#1f6feb', borderWidth: 3 },
  optionText: { fontSize: 18 },
  timeInput: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    flex: 1,
  },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  error: { color: '#b3261e', fontSize: 16 },
});
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test && npx supabase test db --local`
Expected: 18 Vitest tests PASS; all pgTAP files PASS.

- [ ] **Step 7: Verify all three platforms build**

Run: `npx expo export --platform web && npx expo export --platform ios --platform android`
Expected: both complete without error.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add notification preferences with per-member quiet hours"
```

---

## What this plan does not cover

Deliberately deferred to later plans, so they aren't mistaken for omissions:

- **Phone OTP sign-in.** The spec lists it; the screen and flow belong with Plan 2, where invites by phone number arrive. `docs/auth-configuration.md` already records the provider setting.
- **Widening the profiles read policy.** Members can currently read only their own profile. Plan 2 extends this to members sharing an active club, once clubs exist to scope by.
- **Push notification registration.** Device tokens and Expo push setup belong with Plan 6, which is where anything is actually sent.
- **Timezone detection.** `profiles.timezone` defaults to `America/New_York` and is not yet set from the device. Plan 6 needs it correct for quiet hours; setting it earlier would be unverifiable, since nothing reads it until then.

## Forward references

None. Every function this plan defines has a caller within it. Plan 2 additionally reuses `isCompleteProfile` to block joining a club without a skill level, but that is a second consumer, not the first.
