import { describe, expect, it } from 'vitest';
import { isInvitePayload, buildInviteBody } from '../payload';

describe('isInvitePayload', () => {
  it('accepts a payload with the required fields', () => {
    expect(isInvitePayload({ to: 'a@example.com', clubName: 'Tiles Club' })).toBe(true);
  });

  it('accepts an optional inviteeDisplayName', () => {
    expect(
      isInvitePayload({ to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' }),
    ).toBe(true);
  });

  it('rejects a payload missing "to"', () => {
    expect(isInvitePayload({ clubName: 'Tiles Club' })).toBe(false);
  });

  it('rejects a payload missing "clubName"', () => {
    expect(isInvitePayload({ to: 'a@example.com' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isInvitePayload(null)).toBe(false);
  });
});

describe('buildInviteBody', () => {
  it('greets the invitee by name when one is given', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club', inviteeDisplayName: 'Ann' },
      'https://app.mahjhero.com',
    );
    expect(body.paragraphs[0]).toBe('Hi Ann,');
  });

  it('falls back to a generic greeting with no display name', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club' },
      'https://app.mahjhero.com',
    );
    expect(body.paragraphs[0]).toBe('Hi,');
  });

  it('names the club in the headline and the CTA points at sign-in', () => {
    const body = buildInviteBody(
      { to: 'a@example.com', clubName: 'Tiles Club' },
      'https://app.mahjhero.com',
    );
    expect(body.headline).toBe("You're invited to Tiles Club");
    expect(body.cta).toEqual({
      label: 'Sign in to MahjHero',
      url: 'https://app.mahjhero.com/sign-in',
    });
  });
});
