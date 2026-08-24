/*
 * Empty in this plan, and deliberately so.
 *
 * `profiles.notify_channel` has offered 'push', 'email' and 'both' since
 * plan 1, and app/notifications.tsx has been letting members choose
 * between them for weeks. This plan does not make 'push' real — nothing in
 * a web-first test suite (vitest against react-native-web, Playwright
 * against Chromium, no EAS configuration in the repo) can verify a device
 * delivery leg, and an unverifiable delivery path is worse than an absent
 * one.
 *
 * The table exists so `resolve_notify_channel` has something to consult
 * and so the later push plan is additive. The RLS policy is written now,
 * while nothing depends on it, rather than later under live traffic —
 * which is the moment this kind of policy gets written wrong.
 */
create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  -- One physical device, one row. A reinstall that re-registers the same
  -- token must update, not accumulate.
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_profile on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

/*
 * A member's devices are their own business — not their club's, and not
 * another member's. `for all` with a matching `with check` so the same
 * rule governs reads and writes; a select-only policy plus an insert grant
 * would let a member register a token against somebody else's profile.
 */
create policy push_tokens_own on public.push_tokens
  for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

/*
 * `revoke all` first. Supabase grants ALL on every table in `public` to
 * `authenticated` by default, and ALL includes TRUNCATE — which is not
 * subject to row-level security, so the policy above would not stop a
 * member emptying the table. See supabase/tests/database/portable/
 * grants.test.sql, which exists entirely because of this.
 */
revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
