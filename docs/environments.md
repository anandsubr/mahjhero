# Environments

| | Test | Prod |
|---|---|---|
| Web | Vercel **Preview** deployments (every PR gets a URL) | Vercel **Production** — `app.mahjhero.com`, built from `main` |
| Supabase | `mahjhero-dev` (`rzutuhabxzcateutaojo`) | `mahjhero-prod` (`tnqofwoqivyhvjnntaau`) |
| Auth / SMTP settings | Dev dashboard (hand-managed) | `[remotes.prod]` in `supabase/config.toml` |
| Local | `.env.local` → dev, or local Supabase | — |

The client only knows which backend it talks to through
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Expo
inlines them at build time, so changing either in Vercel needs a redeploy.

Every CLI command below passes `--project-ref` explicitly instead of relying
on `supabase link`, so the target is always visible in the command itself.

## Day-to-day flow

1. Fix and try it locally.
2. Open the PR. Its Vercel preview runs against `mahjhero-dev` — use it for
   anything localhost can't show: a real phone, Google/Apple sign-in, real email.
3. **If the PR adds a migration:** `npx supabase db push --project-ref tnqofwoqivyhvjnntaau`
   before merging. Migrations land ahead of the code that needs them.
4. Merge. `main` deploys to `app.mahjhero.com`.

Push migrations to dev first (`--project-ref rzutuhabxzcateutaojo`) and exercise
them on a preview before they go to prod.

If a PR changes Edge Functions: `npx supabase functions deploy --project-ref tnqofwoqivyhvjnntaau`
after merging.

## Changing prod auth settings

Edit `[remotes.prod]` in `supabase/config.toml`, then:

```bash
set -a; source supabase/.env.prod.auth; set +a
npx supabase config diff --project-ref tnqofwoqivyhvjnntaau   # read-only; review it
npx supabase config push --project-ref tnqofwoqivyhvjnntaau   # prompts per change
```

Never `config push` to dev: the dev dashboard has drifted from the base
config (see the comment above `[remotes.prod]`).

`config diff` shows email template subjects but not their bodies, so check
**Authentication → Email Templates** in the dashboard after a push that
touches `supabase/templates/`.

New projects default to an 8-digit email code; the app expects 6, which
`[auth.email] otp_length` sets. Watch for that line in the first diff.

## One-time setup of mahjhero-prod

1. **Create the project** in the Supabase dashboard (same org and region as
   dev). Its ref goes into `project_id` under `[remotes.prod]` (done:
   `tnqofwoqivyhvjnntaau`).
2. **Fill the secret files** (both ignored by git):
   `cp supabase/.env.prod.example supabase/.env.prod` and
   `cp supabase/.env.prod.auth.example supabase/.env.prod.auth`.
3. **Schema, functions, secrets:**
   ```bash
   npx supabase db push --project-ref tnqofwoqivyhvjnntaau
   npx supabase functions deploy --project-ref tnqofwoqivyhvjnntaau
   npx supabase secrets set --env-file supabase/.env.prod --project-ref tnqofwoqivyhvjnntaau
   ```
4. **Auth settings:** the `config diff` / `config push` block above.
5. **Notification drain** — in the prod SQL editor (the cron job is a no-op
   until both rows exist):
   ```sql
   insert into public.app_config (key, value) values
     ('functions_url', 'https://tnqofwoqivyhvjnntaau.supabase.co/functions/v1'),
     ('drain_secret',  '<DRAIN_SECRET from supabase/.env.prod>');
   ```
6. **Providers outside Supabase** — add
   `https://tnqofwoqivyhvjnntaau.supabase.co/auth/v1/callback` as an authorized
   redirect URI on the Google OAuth client and as a return URL on the Apple
   Services ID `app.mahjhero.client.signin`, next to dev's.
7. **Check it:** run `supabase/tests/database/identity_linking.test.sql`
   against prod (see `docs/auth-configuration.md`), and confirm the two email
   templates in the dashboard.
8. **Vercel → Settings → Environment Variables:** set the two
   `EXPO_PUBLIC_SUPABASE_*` variables to the prod values for **Production**,
   and to the dev values for **Preview**. Redeploy production. This is the
   cutover: `app.mahjhero.com` now reads and writes the prod database.
9. **Dev dashboard follow-ups:** add the Vercel preview origin
   (`https://mahjhero-*-anand-subramanians-projects-e7313e33.vercel.app/auth/callback`) to dev's
   Redirect URLs so sign-in works on PR previews, and drop
   `https://app.mahjhero.com/auth/callback` from dev's list once prod is live.

Data already in `mahjhero-dev` does not move. Prod starts empty unless it is
copied over deliberately (`pg_dump` of `public`, plus `auth.users` if accounts
need to survive).
