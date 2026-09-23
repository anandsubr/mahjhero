import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { SmtpSender } from '../_shared/smtp.ts';
import { renderShell } from '../_shared/email-shell.ts';
import { sanitizeSubject, assertCleanAddress, renderText } from '../_shared/email-text.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { isInvitePayload, isInviteStillValid, buildInviteBody } from './payload.ts';

// Same local-stub reasoning as deliver-notifications/index.ts: a bare
// top-level `declare const Deno` in a *script* file leaks globally to
// every file `tsc` type-checks; inside a *module* file (this one, because
// of the imports above) it stays local. Repeated here rather than shared,
// on purpose -- see that file's own long comment for why.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Takes only an invite id -- the recipient, club name, and display name are
 * all looked up here, server-side, using a client built from the CALLER's
 * own Authorization header (the anon key, not the service-role key), so
 * club_invites_select_organizer's existing RLS policy is what decides
 * whether this caller may send this invite's email at all. See payload.ts's
 * docstring for why this replaced an earlier, client-trusting version.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }

  if (!isInvitePayload(payload)) {
    return jsonResponse({ error: 'expected { inviteId: string }' }, 400);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'missing Authorization header' }, 401);
  }

  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: invite, error: fetchError } = await supabase
    .from('club_invites')
    .select('email, display_name, accepted_at, declined_at, expires_at, clubs(name)')
    .eq('id', payload.inviteId)
    .maybeSingle();

  if (fetchError) {
    console.error('send-club-invite: invite lookup failed', fetchError);
    return jsonResponse({ error: 'failed to look up invite' }, 500);
  }
  // Either the id does not exist, or club_invites_select_organizer's RLS
  // denied it -- both look identical from here on purpose, so this
  // endpoint can't be used to probe which invite ids are real.
  if (!invite) {
    return jsonResponse({ error: 'invite not found' }, 404);
  }
  if (!isInviteStillValid(invite as { accepted_at: string | null; declined_at: string | null; expires_at: string })) {
    return jsonResponse({ error: 'That invite is no longer valid.' }, 409);
  }

  let to: string;
  try {
    to = assertCleanAddress(invite.email as string);
  } catch (cause) {
    console.error('send-club-invite: stored email failed validation', cause);
    return jsonResponse({ error: (cause as Error).message }, 500);
  }

  // Without a generated Database type passed to createClient, postgrest-js's
  // select()-string inference can't know club_invites.club_id -> clubs.id is
  // many-to-one, so it types this embed as an array by default even though
  // a single row is what actually comes back at runtime. Cast through
  // `unknown` (as tsc itself suggests) rather than changing the query.
  const clubName = (invite.clubs as unknown as { name: string } | null)?.name ?? 'your club';
  const appUrl = required('PUBLIC_APP_URL');
  const settingsUrl = `${appUrl}/sign-in`;
  const body = buildInviteBody(clubName, appUrl, invite.display_name as string | null);

  const sender = new SmtpSender({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    user: Deno.env.get('SMTP_USER') ?? '',
    pass: Deno.env.get('SMTP_PASS') ?? '',
    from: required('SMTP_FROM'),
  });

  try {
    await sender.send({
      to,
      subject: sanitizeSubject(body.subject),
      html: renderShell(body, clubName, settingsUrl),
      text: renderText(body, clubName, settingsUrl),
    });
  } catch (cause) {
    console.error('send-club-invite failed', cause);
    return jsonResponse({ error: 'failed to send' }, 502);
  } finally {
    await sender.close?.();
  }

  return jsonResponse({ ok: true }, 200);
});
