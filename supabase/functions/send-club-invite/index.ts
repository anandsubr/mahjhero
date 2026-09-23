import { SmtpSender } from '../_shared/smtp.ts';
import { renderShell } from '../_shared/email-shell.ts';
import { sanitizeSubject, assertCleanAddress, renderText } from '../_shared/email-text.ts';
import { isInvitePayload, buildInviteBody } from './payload.ts';

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

export { isInvitePayload, buildInviteBody };

/**
 * Deliberately isolated from deliver-notifications' outbox/batch pipeline,
 * which resolves recipients through auth.users -- this needs to reach
 * someone who has never signed up. Everything it needs (recipient,
 * club name, invitee's display name) arrives directly in the request body
 * from the already-authenticated client; this function does its own no
 * database lookup and needs no service-role key, only SMTP credentials.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isInvitePayload(payload)) {
    return new Response(
      JSON.stringify({ error: 'expected { to: string, clubName: string, inviteeDisplayName?: string }' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let to: string;
  try {
    to = assertCleanAddress(payload.to);
  } catch (cause) {
    return new Response(JSON.stringify({ error: (cause as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.mahjhero.com';
  const settingsUrl = `${appUrl}/sign-in`;
  const body = buildInviteBody(payload, appUrl);

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
      html: renderShell(body, payload.clubName, settingsUrl),
      text: renderText(body, payload.clubName, settingsUrl),
    });
  } catch (cause) {
    console.error('send-club-invite failed', cause);
    return new Response(JSON.stringify({ error: 'failed to send' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await sender.close?.();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
