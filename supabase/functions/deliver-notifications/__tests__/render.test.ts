import { describe, expect, it } from 'vitest';
import { FakeSender } from '../sender';
import { renderMessage } from '../render';
import type { OutboxKind, RenderRow } from '../types';

const APP = 'https://app.example.test';

function row(overrides: Partial<RenderRow> = {}): RenderRow {
  return {
    id: '0b0b0b0b-0000-0000-0000-000000000001',
    kind: 'booked_by_friend',
    payload: { booking_id: 'b00c1234-0000-0000-0000-000000000001' },
    recipient_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    recipient_name: 'Bob',
    recipient_email: 'bob@example.com',
    channel: 'email',
    club_id: 'c1c1c1c1-0000-0000-0000-000000000001',
    club_name: 'Riverside',
    event_id: 'e1e1e1e1-0000-0000-0000-000000000001',
    event_title: 'Tuesday night',
    event_starts_at: '2026-09-08T23:00:00Z',
    club_timezone: 'America/New_York',
    table_label: 'Table 2',
    actor_name: 'Alice',
    broadcast_subject: null,
    broadcast_body: null,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

const ALL_KINDS: OutboxKind[] = [
  'booked_by_friend',
  'booking_declined',
  'booking_cancelled_by_host',
  'waitlist_promoted',
  'promotion_offer',
  'promotion_offer_expired',
  'unseated',
  'event_cancelled',
  'need_a_fourth',
  'event_reminder',
  'broadcast',
];

describe('renderMessage', () => {
  // Nothing is allowed to render as a blank subject or an empty body. A
  // kind added later without a template would otherwise ship as an email
  // with no subject line and nobody would notice until a member did.
  it.each(ALL_KINDS)('renders %s with a subject and a body', (kind) => {
    const message = renderMessage(
      row({
        kind,
        broadcast_subject: kind === 'broadcast' ? 'Doors open at seven' : null,
        broadcast_body:
          kind === 'broadcast' ? 'The side entrance is locked.' : null,
        payload: kind === 'event_reminder' ? { offset_minutes: 120 } : {},
      }),
      APP,
    );

    expect(message.to).toBe('bob@example.com');
    expect(message.subject.trim().length).toBeGreaterThan(0);
    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(message.html).toContain('<table');
  });

  // The plain-text part is generated from the same body data, not scraped
  // out of the HTML. A stray tag here means somebody stripped markup with
  // a regex instead.
  it.each(ALL_KINDS)('gives %s a text part with no markup', (kind) => {
    const message = renderMessage(
      row({
        kind,
        broadcast_subject: kind === 'broadcast' ? 'Doors open at seven' : null,
        broadcast_body:
          kind === 'broadcast' ? 'The side entrance is locked.' : null,
        payload: kind === 'event_reminder' ? { offset_minutes: 120 } : {},
      }),
      APP,
    );
    expect(message.text).not.toMatch(/<[a-z/]/i);
  });

  // The two tests above only prove every kind renders *something*. Neither
  // notices if two kinds' copy got swapped — five kinds have a named test
  // asserting real content below, but that left six (booking_declined,
  // waitlist_promoted, promotion_offer, promotion_offer_expired, unseated,
  // event_cancelled) with no assertion on their actual words at all. This
  // table covers all eleven with a phrase unique to that kind, so a
  // copy-paste swap between any two `case` bodies in bodies.ts fails here.
  const DISTINGUISHING_CONTENT: Array<{
    kind: OutboxKind;
    field: 'subject' | 'text';
    phrase: string;
  }> = [
    { kind: 'booked_by_friend', field: 'subject', phrase: 'saved you a seat' },
    { kind: 'booking_declined', field: 'text', phrase: 'declined the seat you booked for them' },
    { kind: 'booking_cancelled_by_host', field: 'text', phrase: 'cancelled your seat at' },
    { kind: 'waitlist_promoted', field: 'text', phrase: 'next on the waitlist' },
    { kind: 'promotion_offer', field: 'text', phrase: 'held for you for the next two hours' },
    { kind: 'promotion_offer_expired', field: 'text', phrase: "wasn't taken in time" },
    { kind: 'unseated', field: 'text', phrase: 'is no longer yours' },
    { kind: 'event_cancelled', field: 'text', phrase: 'Your seat went with it' },
    { kind: 'need_a_fourth', field: 'text', phrase: 'is three of four' },
    { kind: 'event_reminder', field: 'text', phrase: 'cancelling now gives the seat' },
    { kind: 'broadcast', field: 'text', phrase: 'The side entrance is locked' },
  ];

  it.each(DISTINGUISHING_CONTENT)(
    "gives $kind its own copy, not another kind's",
    ({ kind, field, phrase }) => {
      const message = renderMessage(
        row({
          kind,
          broadcast_subject: kind === 'broadcast' ? 'Doors open at seven' : null,
          broadcast_body:
            kind === 'broadcast' ? 'The side entrance is locked.' : null,
          // 1440 selects the day-ahead wording, which is where this
          // kind's distinguishing phrase lives.
          payload: kind === 'event_reminder' ? { offset_minutes: 1440 } : {},
        }),
        APP,
      );
      expect(message[field]).toContain(phrase);
    },
  );

  it('names the person who acted', () => {
    const message = renderMessage(row({ kind: 'booked_by_friend' }), APP);
    expect(message.subject).toContain('Alice');
  });

  // The actor is nullable — a promotion is nobody's doing — so the copy
  // must not read "undefined booked you a seat".
  it('says something sensible when nobody acted', () => {
    const message = renderMessage(
      row({ kind: 'booking_cancelled_by_host', actor_name: null }),
      APP,
    );
    expect(message.subject).not.toContain('null');
    expect(message.text).not.toContain('undefined');
  });

  // The two default offsets want different words. "Tuesday night is
  // tomorrow" and "Tuesday night starts soon" are not interchangeable.
  it('words a day-ahead reminder differently from a two-hour one', () => {
    const dayAhead = renderMessage(
      row({ kind: 'event_reminder', payload: { offset_minutes: 1440 } }),
      APP,
    );
    const soon = renderMessage(
      row({ kind: 'event_reminder', payload: { offset_minutes: 120 } }),
      APP,
    );
    expect(dayAhead.subject).not.toBe(soon.subject);
  });

  it('uses the host their own words for a broadcast', () => {
    const message = renderMessage(
      row({
        kind: 'broadcast',
        broadcast_subject: 'Doors open at seven',
        broadcast_body: 'The side entrance is locked this week.',
      }),
      APP,
    );
    expect(message.subject).toBe('Doors open at seven');
    expect(message.text).toContain('The side entrance is locked this week.');
  });

  // Every link has to be absolute https. Email clients do not follow the
  // mahjhero:// scheme, so a relative or custom-scheme href is a dead link.
  it('links absolutely, over https', () => {
    const message = renderMessage(row({ kind: 'event_reminder' }), APP);
    expect(message.html).toContain(`${APP}/clubs/`);
    expect(message.html).not.toContain('mahjhero://');
  });

  // A club is named by its host and goes straight into an HTML document.
  it('escapes anything a host typed', () => {
    const message = renderMessage(
      row({ club_name: 'Bell <script>alert(1)</script> Club' }),
      APP,
    );
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  // subject is a raw RFC 5322 header value. A club name with a CR/LF in it
  // must not be able to inject a second header line (an extra `Bcc:`, say)
  // by riding along into the subject unchanged.
  it('keeps a club name with a CR/LF from injecting a header into the subject', () => {
    const message = renderMessage(
      row({
        kind: 'booked_by_friend',
        club_name: 'Riverside\r\nBcc: eve@evil.example',
      }),
      APP,
    );
    expect(message.subject).not.toMatch(/[\r\n]/);
    // eslint-disable-next-line no-control-regex
    expect(message.subject).not.toMatch(/[\x00-\x1f\x7f]/);
  });

  // Same claim, for the other free-text field that lands in a subject:
  // the event title.
  it('keeps an event title with a CR/LF from injecting a header into the subject', () => {
    const message = renderMessage(
      row({
        kind: 'booking_cancelled_by_host',
        event_title: 'Tuesday night\r\nBcc: eve@evil.example',
      }),
      APP,
    );
    expect(message.subject).not.toMatch(/[\r\n]/);
    // eslint-disable-next-line no-control-regex
    expect(message.subject).not.toMatch(/[\x00-\x1f\x7f]/);
  });

  // The recipient address is a header value too, but unlike the subject it
  // is not sanitized by rewriting: silently stripping the control
  // characters out of a `to` would hide a header-injection attempt behind
  // an address that looks clean while still routing (or misrouting) the
  // send. renderMessage refuses to build the message at all, so the row
  // fails loudly instead of mailing something to a rewritten address.
  it('refuses to build a message for a recipient address with a CR/LF', () => {
    expect(() =>
      renderMessage(
        row({ recipient_email: 'bob@example.com\r\nBcc: eve@evil.example' }),
        APP,
      ),
    ).toThrow(/control character/);
  });

  // Reminders for a booked game cannot be switched off, so the footer must
  // not offer a link that implies otherwise.
  it('tells a member which messages they can silence', () => {
    const reminder = renderMessage(row({ kind: 'event_reminder' }), APP);
    const fourth = renderMessage(row({ kind: 'need_a_fourth' }), APP);
    expect(reminder.text.toLowerCase()).toContain("can't be switched off");
    expect(fourth.text).toContain(`${APP}/notifications`);
  });
});

describe('FakeSender', () => {
  it('records what it was given', async () => {
    const sender = new FakeSender();
    await sender.send(renderMessage(row(), APP));
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('bob@example.com');
  });

  it('rejects when told to, and records nothing', async () => {
    const sender = new FakeSender(() => 'connection refused');
    await expect(sender.send(renderMessage(row(), APP))).rejects.toThrow(
      'connection refused',
    );
    expect(sender.sent).toHaveLength(0);
  });
});
