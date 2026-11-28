import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

// Untyped (no generated Database type here), as in the other functions.
// deno-lint-ignore no-explicit-any
type Admin = any;
import { SmtpSender } from '../_shared/smtp.ts';
import { renderShell } from '../_shared/email-shell.ts';
import { sanitizeSubject, assertCleanAddress, renderText } from '../_shared/email-text.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { buildRsvpEmail, clientIp, eventLink, parseRsvpRequest, rsvpError } from './logic.ts';

// Same local-stub reasoning as deliver-notifications/index.ts.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * The public door to a Mahj Night (pivot batch 2). `verify_jwt = false`:
 * guests RSVP from a browser with no account. The link token is the whole
 * of the authorization for the public view, the same model as
 * calendar-feed; everything is read and written by service-role calls to
 * the definer functions in 20261128130000, which decide what each viewer
 * sees. No SQL function is granted to anon.
 *
 *   GET  ?token=…&r=<rsvp secret>   the event page, cut to this viewer
 *   POST { token, name, email, status, isBeginner, secret? }   RSVP
 *
 * A signed-in caller's JWT (Authorization: Bearer …) is verified here with
 * auth.getUser; only then is their id passed on as `viewer`, which is what
 * unlocks the host view. The anon key in that header just means signed out.
 */
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
    });
  }

  const admin: Admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? '';
    const secret = url.searchParams.get('r');
    const viewer = await verifiedViewer(admin, request.headers.get('Authorization'));
    const { data, error } = await admin.rpc('event_page', {
      token,
      secret: secret && secret.length >= 20 ? secret : null,
      viewer,
    });
    if (error) {
      console.error('mahj-night: event_page failed', error);
      return json({ error: 'failed' }, 500);
    }
    if (!data) return json({ error: 'not_found' }, 404);
    return json({ page: data }, 200);
  }

  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const rsvp = parseRsvpRequest(body);
  if (!rsvp) return json({ error: 'invalid_request' }, 400);

  const { data, error } = await admin.rpc('submit_rsvp', {
    token: rsvp.token,
    rsvp_name: rsvp.name,
    rsvp_email: rsvp.email,
    rsvp_status: rsvp.status,
    beginner: rsvp.isBeginner,
    client_ip: clientIp(request.headers),
    secret: rsvp.secret,
  });
  if (error) {
    const mapped = rsvpError(error.message ?? '');
    if (mapped.status === 500) console.error('mahj-night: submit_rsvp failed', error);
    return json({ error: mapped.error }, mapped.status);
  }

  const result = data as {
    outcome: 'created' | 'updated' | 'exists';
    rsvp_id: string;
    secret: string;
    email: string;
    name: string;
    status: 'going' | 'maybe' | 'no';
    title: string;
    host_first_name: string;
    starts_at: string;
    timezone: string;
    area: string;
  };

  // Email on a new RSVP, and when an existing one was re-submitted without
  // its secret (so its owner gets their link back). Not on an in-place
  // change: that browser already has the link.
  if (result.outcome !== 'updated') {
    await sendRsvpEmail(admin, rsvp.token, result);
  }

  if (result.outcome === 'exists') {
    // Never hand the secret to a caller who didn't prove they own the row.
    return json({ outcome: 'exists' }, 200);
  }
  return json({ outcome: result.outcome, secret: result.secret }, 200);
});

async function verifiedViewer(
  admin: Admin,
  authorization: string | null,
): Promise<string | null> {
  const jwt = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === Deno.env.get('SUPABASE_ANON_KEY')) return null;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function sendRsvpEmail(
  admin: Admin,
  token: string,
  r: {
    outcome: 'created' | 'updated' | 'exists';
    rsvp_id: string; secret: string; email: string; name: string;
    status: 'going' | 'maybe' | 'no'; title: string; host_first_name: string;
    starts_at: string; timezone: string; area: string;
  },
): Promise<void> {
  try {
    const { data: allowed, error } = await admin.rpc('claim_rsvp_email_slot', { target_rsvp: r.rsvp_id });
    if (error) throw error;
    if (!allowed) return;

    const appUrl = required('PUBLIC_APP_URL');
    const body = buildRsvpEmail({
      kind: r.outcome === 'exists' ? 'resend' : 'confirm',
      name: r.name,
      status: r.status,
      title: r.title,
      hostFirstName: r.host_first_name,
      startsAt: r.starts_at,
      timezone: r.timezone,
      area: r.area,
      link: eventLink(appUrl, token, r.secret),
    });
    const from = r.host_first_name ? `${r.host_first_name}'s Mahj Night` : 'a Mahj Night';
    const settingsUrl = `${appUrl}/sign-in`;

    const sender = new SmtpSender({
      host: required('SMTP_HOST'),
      port: Number(required('SMTP_PORT')),
      user: Deno.env.get('SMTP_USER') ?? '',
      pass: Deno.env.get('SMTP_PASS') ?? '',
      from: required('SMTP_FROM'),
    });
    try {
      await sender.send({
        to: assertCleanAddress(r.email),
        subject: sanitizeSubject(body.subject),
        html: renderShell(body, from, settingsUrl),
        text: renderText(body, from, settingsUrl),
      });
    } finally {
      await sender.close?.();
    }
  } catch (cause) {
    // The RSVP itself is saved; a failed email must not undo it.
    console.error('mahj-night: rsvp email failed', cause);
  }
}
