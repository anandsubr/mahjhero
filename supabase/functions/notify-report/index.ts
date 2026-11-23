import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { SmtpSender } from '../_shared/smtp.ts';
import { handleNotifyReport, type NotifyReportDeps } from './handler.ts';

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
 * with auth.getUser(); it only emails about a report the caller filed.
 */
Deno.serve((request: Request) =>
  handleNotifyReport(request, () => ({
    userClient: createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    }),
    adminClient: createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as NotifyReportDeps['adminClient'],
    sender: new SmtpSender({
      host: required('SMTP_HOST'),
      port: Number(required('SMTP_PORT')),
      user: Deno.env.get('SMTP_USER') ?? '',
      pass: Deno.env.get('SMTP_PASS') ?? '',
      from: required('SMTP_FROM'),
    }),
    adminEmail: required('ADMIN_EMAIL'),
    appUrl: required('PUBLIC_APP_URL'),
  })),
);
