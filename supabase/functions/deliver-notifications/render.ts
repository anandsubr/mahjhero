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
    to: row.recipient_email,
    subject: sanitizeSubject(body.subject),
    html: renderShell(body, row.club_name, settingsUrl),
    text: renderText(body, row.club_name, settingsUrl),
  };
}
