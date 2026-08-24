import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { deliverBatch, type Report } from './batch.ts';
import { SmtpSender } from './smtp.ts';
import type { RenderRow } from './types.ts';

/**
 * Fifty per invocation, one invocation a minute.
 *
 * Deliberately not "drain until empty": a runaway producer would then turn
 * one invocation into an unbounded one, and Edge Functions have a wall
 * clock. A backlog drains at 3,000 an hour instead, oldest first.
 */
const BATCH_SIZE = 50;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

Deno.serve(async (req: Request): Promise<Response> => {
  let secret: string;
  try {
    secret = required('DRAIN_SECRET');
  } catch (cause) {
    // A misconfigured function must not silently accept every caller.
    return new Response(String(cause), { status: 500 });
  }

  /*
   * The endpoint is public — `verify_jwt = false` in config.toml, because
   * pg_net calls it with a header and not a session. The shared secret is
   * the whole of the authentication.
   *
   * This matters more than it looks: anyone who could trigger the drain
   * could lease every pending message away five minutes at a time and burn
   * the attempt counter until real messages dead-lettered.
   */
  if (req.headers.get('x-drain-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const supabase = createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await supabase.rpc('claim_notification_batch', {
    p_limit: BATCH_SIZE,
  });

  if (error) {
    // Nothing was claimed, so nothing is lost — the next tick is a minute
    // away. 500 so the failure shows up in the function logs.
    console.error('claim_notification_batch failed', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = (data ?? []) as RenderRow[];

  const sender = new SmtpSender({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    // Empty is legitimate: the local Mailpit wants no credentials.
    user: Deno.env.get('SMTP_USER') ?? '',
    pass: Deno.env.get('SMTP_PASS') ?? '',
    from: required('SMTP_FROM'),
  });

  const report: Report = {
    markSent: async (ids) => {
      const { error: markError } = await supabase.rpc('mark_notifications_sent', { p_ids: ids });
      // Logged, not thrown. The messages went; failing to record that costs
      // a duplicate on the next tick, which is the at-least-once contract
      // working as designed, not an outage.
      if (markError) console.error('mark_notifications_sent failed', markError);
    },
    markFailed: async (id, message) => {
      const { error: markError } = await supabase.rpc('mark_notifications_failed', {
        p_id: id,
        p_error: message,
      });
      if (markError) console.error('mark_notifications_failed failed', markError);
    },
  };

  const result = await deliverBatch(rows, sender, required('PUBLIC_APP_URL'), report);

  return new Response(JSON.stringify({ claimed: rows.length, ...result }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
