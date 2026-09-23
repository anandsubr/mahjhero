import { renderShell } from '../_shared/email-shell.ts';
import { bodyFor } from './templates/bodies.ts';
import { assertCleanAddress, renderText, sanitizeSubject } from '../_shared/email-text.ts';
import type { Message, RenderRow } from './types.ts';

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
