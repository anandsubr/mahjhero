import { brand } from '../brand.ts';
import type { Body } from '../types.ts';

/**
 * Club names, event titles and broadcast bodies are all typed by people and
 * all go straight into an HTML document. Everything interpolated below goes
 * through this first.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One layout for all eleven kinds.
 *
 * Tables and inline styles, because that is the only construct email
 * clients agree on — no flexbox, no grid, no external stylesheet, no
 * `<style>` block that Gmail will strip. 600px is the width every client
 * renders without horizontal scrolling.
 *
 * Eleven bespoke designs would look better and would be eleven separate
 * sets of client-compatibility risk for a product that has not sent its
 * first email yet.
 */
export function renderShell(
  body: Body,
  clubName: string,
  settingsUrl: string,
): string {
  const paragraphs = body.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${brand.text};">${escapeHtml(text)}</p>`,
    )
    .join('');

  const cta = body.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
         <tr><td style="border-radius:999px;background:${brand.accent};">
           <a href="${escapeHtml(body.cta.url)}"
              style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(body.cta.label)}</a>
         </td></tr>
       </table>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${brand.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:${brand.surface};border-radius:16px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 24px;font-size:20px;font-weight:700;color:${brand.accentDark};">${brand.name}</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;color:${brand.text};">${escapeHtml(body.headline)}</h1>
        ${paragraphs}
        ${cta}
        <hr style="border:none;border-top:1px solid ${brand.divider};margin:24px 0;" />
        <p style="margin:0;font-size:13px;line-height:20px;color:${brand.muted};">
          ${escapeHtml(`Sent by ${clubName} on MahjHero.`)}<br />
          ${escapeHtml(body.footerNote)}
        </p>
        <p style="margin:8px 0 0;font-size:13px;line-height:20px;color:${brand.muted};">
          <a href="${escapeHtml(settingsUrl)}" style="color:${brand.accentDark};">Notification settings</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
