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

/**
 * `!==` on the raw header would let the comparison bail out at the first
 * mismatching byte, which is exactly the signal an attacker needs to
 * recover `DRAIN_SECRET` one byte at a time from response-time
 * differences — the classic timing side channel that any `secret ===
 * provided` string compare opens. Practical exploitability here is low
 * (this is a cron trigger behind normal network jitter, not a
 * low-latency LAN target), but the fix costs nothing, and this header is
 * the *entire* authentication for a necessarily public endpoint (see the
 * comment on the handler below).
 *
 * Both operands are hashed with SHA-256 via `crypto.subtle` — the
 * standard Web Crypto API, not a Deno-specific extra: it's a required
 * part of the web platform surface every hosted-JS runtime implements,
 * so it needs no import and no `deno.d.ts` stub, unlike the `Deno`
 * namespace members below. Hashing first buys two things a raw compare
 * can't: both digests come out the same fixed length regardless of how
 * long the real secret or the supplied header is, so length itself leaks
 * nothing; and the byte-comparison loop that follows always walks the
 * full 32 bytes and accumulates a running OR instead of returning on the
 * first difference, so *which* byte differed leaks nothing either.
 *
 * A missing header is folded to `''` rather than given an early `false` —
 * it still gets hashed and compared through the exact same path, so "no
 * header" costs precisely what "wrong header" costs. A faster path for a
 * missing header would hand an attacker a free way to confirm the
 * endpoint is guarded at all before spending any effort on the secret
 * itself.
 */
async function timingSafeSecretEquals(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedDigest);
  const b = new Uint8Array(expectedDigest);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
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
  if (!(await timingSafeSecretEquals(req.headers.get('x-drain-secret'), secret))) {
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
