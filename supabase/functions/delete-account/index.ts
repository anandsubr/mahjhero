import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { handleDeleteAccount } from './handler.ts';

// See send-club-invite/index.ts for why this stub is local to a module file.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

/**
 * verify_jwt = true at the gateway, and the handler re-verifies the caller
 * with auth.getUser() on a client carrying their Authorization header; the
 * user id deleted is always that verified id, never a body field.
 */
Deno.serve((request: Request) =>
  handleDeleteAccount(request, () => ({
    userClient: createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    }),
    adminClient: createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    appleEnv: {
      teamId: Deno.env.get('APPLE_TEAM_ID'),
      keyId: Deno.env.get('APPLE_KEY_ID'),
      privateKey: Deno.env.get('APPLE_PRIVATE_KEY'),
      clientId: Deno.env.get('APPLE_CLIENT_ID'),
    },
  })),
);
