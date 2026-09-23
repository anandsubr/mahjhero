import { describe, expect, it } from 'vitest';
import { isInvitePayload, isInviteStillValid, buildInviteBody } from '../payload';

describe('isInvitePayload', () => {
  it('accepts a payload with an inviteId', () => {
    expect(isInvitePayload({ inviteId: 'invite-1' })).toBe(true);
  });

  it('rejects a payload missing "inviteId"', () => {
    expect(isInvitePayload({})).toBe(false);
  });

  it('rejects a payload whose inviteId is not a string', () => {
    expect(isInvitePayload({ inviteId: 42 })).toBe(false);
  });

  it('rejects null', () => {
    expect(isInvitePayload(null)).toBe(false);
  });
});

describe('isInviteStillValid', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('is valid when not accepted, not declined, and not expired', () => {
    expect(
      isInviteStillValid({ accepted_at: null, declined_at: null, expires_at: future }),
    ).toBe(true);
  });

  it('is invalid once accepted', () => {
    expect(
      isInviteStillValid({
        accepted_at: new Date().toISOString(),
        declined_at: null,
        expires_at: future,
      }),
    ).toBe(false);
  });

  it('is invalid once declined', () => {
    expect(
      isInviteStillValid({
        accepted_at: null,
        declined_at: new Date().toISOString(),
        expires_at: future,
      }),
    ).toBe(false);
  });

  it('is invalid once expired', () => {
    expect(
      isInviteStillValid({ accepted_at: null, declined_at: null, expires_at: past }),
    ).toBe(false);
  });
});

describe('buildInviteBody', () => {
  it('greets the invitee by name when one is given', () => {
    const body = buildInviteBody('Tiles Club', 'https://app.mahjhero.com', 'Ann');
    expect(body.paragraphs[0]).toBe('Hi Ann,');
  });

  it('falls back to a generic greeting with no display name', () => {
    const body = buildInviteBody('Tiles Club', 'https://app.mahjhero.com', null);
    expect(body.paragraphs[0]).toBe('Hi,');
  });

  it('names the club in the headline and the CTA points at sign-in', () => {
    const body = buildInviteBody('Tiles Club', 'https://app.mahjhero.com');
    expect(body.headline).toBe("You're invited to Tiles Club");
    expect(body.cta).toEqual({
      label: 'Sign in to MahjHero',
      url: 'https://app.mahjhero.com/sign-in',
    });
  });
});
