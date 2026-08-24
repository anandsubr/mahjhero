import { renderShell } from './templates/shell.ts';
import { bodyFor } from './templates/bodies.ts';
import type { Body, Message, RenderRow } from './types.ts';

/**
 * `subject` becomes a raw RFC 5322 header value once it reaches the SMTP
 * client. `club_name`, `event_title` and `broadcast_subject` are all typed
 * by people, and a CR or LF in any of them would inject an arbitrary
 * header — an extra `Bcc:` line, for instance. Collapsing every control
 * character to a single space closes that off before the subject leaves
 * this module, rather than trusting denomailer to do it. The migration's
 * check constraint on `broadcasts.subject` stops the worst of it at the
 * source; this is defence in depth for the other two inputs, which have no
 * database constraint to lean on.
 */
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * `to` becomes a raw RFC 5322 header value too, exactly like `subject` —
 * but stripping is the wrong move here. A mangled subject is at worst
 * cosmetic: a collapsed control character reads oddly and nothing more.
 * A mangled *address* is not cosmetic — silently rewriting
 * `bob@x.com\r\nBcc:eve@evil.com` into something that no longer contains
 * the injected header does not make the row safe to send, it just hides
 * the tampering and, in the more mundane case, produces an address that
 * bounces or reaches nobody, with no record of what the original value
 * was.
 *
 * So this refuses instead of rewrites: a control character in the
 * recipient makes `renderMessage` throw rather than build a message with
 * a silently-altered `to`. `recipient_email` comes from `auth.users.email`
 * today, which this function has no visibility into and no way to trust
 * blindly — Supabase Auth's own validation is an external guarantee, not
 * one this repo enforces or tests. Throwing here composes with the batch
 * loop `deliverBatch` adds in Task 10 (`docs/superpowers/plans/
 * 2026-08-23-notifications-and-comms.md`, not the stale, differently-
 * scoped `.superpowers/sdd/task-10-brief.md`): each row's render runs
 * inside a try/catch, so this throw fails and dead-letters that one row
 * with the thrown message recorded as the reason, rather than crashing
 * the batch or sending to a rewritten address.
 */
function assertCleanAddress(address: string): string {
  if (/[\x00-\x1f\x7f]/.test(address)) {
    throw new Error(
      `recipient address contains a control character: ${JSON.stringify(address)}`,
    );
  }
  return address;
}

/**
 * Built from the same Body the HTML is built from, never scraped out of the
 * HTML. Regex-stripping markup is how text parts end up with `&amp;` in
 * them and a stray `</p>` at the end of every paragraph.
 */
function renderText(body: Body, clubName: string, settingsUrl: string): string {
  const parts = [body.headline, '', ...body.paragraphs];
  if (body.cta) parts.push('', `${body.cta.label}: ${body.cta.url}`);
  parts.push('', '---', `Sent by ${clubName} on MahjHero.`, body.footerNote,
             `Notification settings: ${settingsUrl}`);
  return parts.join('\n');
}

export function renderMessage(row: RenderRow, appUrl: string): Message {
  const body = bodyFor(row, appUrl);
  // Absolute https, always. Email clients do not follow the mahjhero://
  // scheme, so every link in every template resolves against appUrl.
  const settingsUrl = `${appUrl}/notifications`;
  return {
    to: assertCleanAddress(row.recipient_email),
    subject: sanitizeSubject(body.subject),
    html: renderShell(body, row.club_name, settingsUrl),
    text: renderText(body, row.club_name, settingsUrl),
  };
}
