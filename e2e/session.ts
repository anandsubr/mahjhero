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
 * the project ref in the URL. Keep in step with the client's own convention:
 * see `defaultStorageKey` in `node_modules/@supabase/supabase-js/src/SupabaseClient.ts`
 * (``sb-${baseUrl.hostname.split('.')[0]}-auth-token``). If a future
 * supabase-js bump changes that derivation, this helper will silently
 * produce a mismatched key, and Task 4's screenshots will just come back
 * blank/unauthenticated — check that file first before suspecting Playwright
 * or the injection step.
 */
export function storageKeyFor(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}
