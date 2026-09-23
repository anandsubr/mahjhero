import type { Body } from './email-types.ts';

/**
 * `subject` becomes a raw RFC 5322 header value once it reaches the SMTP
 * client. Collapsing every control character to a single space closes off
 * a header-injection path before the subject leaves this module.
 */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * `to` becomes a raw RFC 5322 header value too, but stripping is the wrong
 * move here the way it is for `subject` above. A mangled subject is at
 * worst cosmetic; a mangled *address* is not -- silently rewriting
 * `bob@x.com\r\nBcc:eve@evil.com` into something that no longer contains
 * the injected header does not make the row safe to send, it just hides
 * the tampering. So this refuses instead of rewrites: a control character
 * in the recipient throws rather than building a message with a
 * silently-altered `to`.
 */
export function assertCleanAddress(address: string): string {
  if (/[\x00-\x1f\x7f]/.test(address)) {
    throw new Error(
      `recipient address contains a control character: ${JSON.stringify(address)}`,
    );
  }
  return address;
}

/**
 * Built from the same Body the HTML is built from, never scraped out of
 * the HTML.
 */
export function renderText(body: Body, clubName: string, settingsUrl: string): string {
  const parts = [body.headline, '', ...body.paragraphs];
  if (body.cta) parts.push('', `${body.cta.label}: ${body.cta.url}`);
  parts.push('', '---', `Sent by ${clubName} on MahjHero.`, body.footerNote,
             `Notification settings: ${settingsUrl}`);
  return parts.join('\n');
}
