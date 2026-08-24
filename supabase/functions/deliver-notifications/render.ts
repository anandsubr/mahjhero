import { renderShell } from './templates/shell.ts';
import { bodyFor } from './templates/bodies.ts';
import type { Body, Message, RenderRow } from './types.ts';

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
    subject: body.subject,
    html: renderShell(body, row.club_name, settingsUrl),
    text: renderText(body, row.club_name, settingsUrl),
  };
}
