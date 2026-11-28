import { describe, expect, it } from 'vitest';
import {
  buildRsvpEmail,
  clientIp,
  eventLink,
  formatWhen,
  parseRsvpRequest,
  rsvpError,
} from '../logic';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

describe('parseRsvpRequest', () => {
  const ok = { token: TOKEN, name: ' Ana ', email: ' ana@example.com ', status: 'going' };

  it('accepts a complete RSVP and trims it', () => {
    expect(parseRsvpRequest({ ...ok, isBeginner: true })).toEqual({
      token: TOKEN, name: 'Ana', email: 'ana@example.com', status: 'going',
      isBeginner: true, secret: null,
    });
  });

  it('refuses a missing name, unknown status, or short token', () => {
    expect(parseRsvpRequest({ ...ok, name: '  ' })).toBeNull();
    expect(parseRsvpRequest({ ...ok, status: 'yes' })).toBeNull();
    expect(parseRsvpRequest({ ...ok, token: 'short' })).toBeNull();
    expect(parseRsvpRequest(null)).toBeNull();
  });

  it('keeps a plausible secret and drops a junk one', () => {
    expect(parseRsvpRequest({ ...ok, secret: 'x'.repeat(32) })?.secret).toBe('x'.repeat(32));
    expect(parseRsvpRequest({ ...ok, secret: 'x' })?.secret).toBeNull();
  });
});

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
  });
  it('falls back to unknown', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('rsvpError', () => {
  it('maps the SQL raises', () => {
    expect(rsvpError('full')).toEqual({ status: 409, error: 'full' });
    expect(rsvpError('rate_limited')).toEqual({ status: 429, error: 'rate_limited' });
    expect(rsvpError('not_found')).toEqual({ status: 404, error: 'not_found' });
    expect(rsvpError('boom').status).toBe(500);
  });
});

describe('the RSVP email', () => {
  const facts = {
    name: 'Ana Lopez', status: 'going' as const, title: 'Friday Mahj', hostFirstName: 'Priya',
    startsAt: '2026-12-05T01:00:00Z', timezone: 'America/New_York', area: 'Suwanee',
    link: eventLink('https://app.mahjhero.com/', TOKEN, 's'.repeat(32)),
  };

  it('formats the time in the night\'s timezone', () => {
    expect(formatWhen(facts.startsAt, facts.timezone)).toBe('Friday, December 4 at 8:00 PM');
  });

  it('confirms a yes with the guest\'s own link', () => {
    const body = buildRsvpEmail({ ...facts, kind: 'confirm' });
    expect(body.subject).toBe("You're going: Friday Mahj");
    expect(body.paragraphs[0]).toBe('Hi Ana,');
    expect(body.cta?.url).toBe(`https://app.mahjhero.com/e/${TOKEN}?r=${'s'.repeat(32)}`);
  });

  it('says nothing changed when it is a resend', () => {
    const body = buildRsvpEmail({ ...facts, kind: 'resend' });
    expect(body.paragraphs[1]).toContain("Your answer hasn't changed");
  });

  it('never puts the address in the email', () => {
    const body = buildRsvpEmail({ ...facts, kind: 'confirm' });
    expect(JSON.stringify(body)).not.toMatch(/Oak Lane/);
  });
});
