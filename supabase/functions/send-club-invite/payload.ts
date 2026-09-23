import type { Body } from '../_shared/email-types.ts';

/**
 * Split out of index.ts so Vitest can load it directly: index.ts imports
 * `../_shared/smtp.ts`, which imports a `deno.land` URL specifier that
 * only a Deno runtime (not Vitest's Node-based ESM loader) can resolve.
 * Confirmed by trying the direct `../index` import first -- it failed with
 * "Only URLs with a scheme in: file and data are supported by the default
 * ESM loader. Received protocol 'https:'" -- the exact failure
 * deliver-notifications' own render.ts/smtp.ts split (see smtp.ts's and
 * pooled-connection.ts's docstrings) already exists to avoid. This file has
 * no Deno-URL import of its own, so it -- and the pure logic in it -- is
 * visible to Vitest the same way render.ts is.
 */

export type InvitePayload = {
  to: string;
  clubName: string;
  inviteeDisplayName?: string;
};

export function isInvitePayload(value: unknown): value is InvitePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).to === 'string' &&
    typeof (value as Record<string, unknown>).clubName === 'string'
  );
}

export function buildInviteBody(payload: InvitePayload, appUrl: string): Body {
  const greeting = payload.inviteeDisplayName?.trim()
    ? `Hi ${payload.inviteeDisplayName.trim()},`
    : 'Hi,';
  return {
    subject: `You're invited to ${payload.clubName}`,
    headline: `You're invited to ${payload.clubName}`,
    paragraphs: [
      greeting,
      `You've been invited to join ${payload.clubName} on MahjHero. Sign in with this email address to see the invite and accept it.`,
    ],
    cta: { label: 'Sign in to MahjHero', url: `${appUrl}/sign-in` },
    footerNote: "Didn't expect this? You can safely ignore this email.",
  };
}
