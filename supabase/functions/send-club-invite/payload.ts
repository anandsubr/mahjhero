import type { Body } from '../_shared/email-types.ts';

/**
 * Split out of index.ts so Vitest can load it directly: index.ts imports
 * both `../_shared/smtp.ts` and `@supabase/supabase-js` by URL specifier,
 * neither of which Vitest's Node-based ESM loader can resolve. This file
 * has no such import, so it -- and the pure logic in it -- is visible to
 * Vitest the same way deliver-notifications/render.ts is.
 *
 * Only carries an invite id, not the recipient/club name/display name
 * directly -- those are looked up server-side in index.ts, using the
 * caller's own Authorization header, so club_invites_select_organizer's
 * RLS policy is what decides whether this caller may act on this invite at
 * all. An earlier version trusted {to, clubName, inviteeDisplayName}
 * straight from the request body, which let any signed-in user send
 * arbitrary branded email to any address with no tie to a real invite --
 * found in the final whole-branch review and fixed here.
 */
export type InvitePayload = { inviteId: string };

export function isInvitePayload(value: unknown): value is InvitePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).inviteId === 'string'
  );
}

/**
 * A row's own accepted/declined/expired state, extracted as a pure
 * function so it's testable without a live database -- this is exactly
 * the "not valid for you" gate accept_club_invite/decline_club_invite
 * already apply server-side; this is the same check applied here so a
 * resend attempt on a dead invite fails informatively instead of sending
 * an email nobody can act on.
 */
export function isInviteStillValid(invite: {
  accepted_at: string | null;
  declined_at: string | null;
  expires_at: string;
}): boolean {
  if (invite.accepted_at || invite.declined_at) return false;
  return new Date(invite.expires_at) > new Date();
}

export function buildInviteBody(
  clubName: string,
  appUrl: string,
  inviteeDisplayName?: string | null,
): Body {
  const greeting = inviteeDisplayName?.trim()
    ? `Hi ${inviteeDisplayName.trim()},`
    : 'Hi,';
  return {
    subject: `You're invited to ${clubName}`,
    headline: `You're invited to ${clubName}`,
    paragraphs: [
      greeting,
      `You've been invited to join ${clubName} on MahjHero. Sign in with this email address to see the invite and accept it.`,
    ],
    cta: { label: 'Sign in to MahjHero', url: `${appUrl}/sign-in` },
    footerNote: "Didn't expect this? You can safely ignore this email.",
  };
}
