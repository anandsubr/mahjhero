import { describe, expect, it } from 'vitest';
import { FakeSender } from '../sender';
import type { Sender } from '../sender';
import { renderMessage } from '../render';
import { deliverBatch } from '../batch';
import type { Report } from '../batch';
import type { Message, OutboxKind, RenderRow } from '../types';

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

/**
 * `FakeSender` has nothing to release, so it doesn't implement `close` —
 * `Sender.close` is optional for exactly that reason (see sender.ts). This
 * subclass adds one, purely to let a test see that `deliverBatch` calls it
 * exactly once per batch, regardless of how the loop inside ended.
 */
class ClosingFakeSender extends FakeSender {
  closeCalls = 0;
  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

/**
 * Models the exact bug fix #1 (round 2) in smtp.ts exists to close:
 * denomailer's SMTP client does not reset its transaction state after a
 * failed send (see smtp.ts's `send` for the confirmed mechanism, read
 * directly from denomailer 1.6.0's source — a `NOOP` + read one `250`,
 * which never clears the reverse-path buffer a `MAIL FROM` opened). Reusing
 * one connection across a batch without tearing it down after a failure
 * sends a nested `MAIL FROM` for the very next message, which a real relay
 * answers with its own 3-digit reply code — a shape indistinguishable, to
 * `looksLikeAddressRejection` below, from a genuine address rejection.
 *
 * `FakeSender` above models every `send` as independent, which is exactly
 * why all four `deliverBatch` tests that existed before this round passed
 * even while an earlier `smtp.ts` reused a poisoned connection in
 * production: none of them modeled a sender with memory of its own
 * previous failure. This one does — once `poisonedError` fires for a
 * rejected message, every later `send` on the same instance throws that
 * same poisoned-connection error regardless of what `failOn` would have
 * said about that message, exactly matching what an un-fixed `SmtpSender`
 * did before its connection was closed at the end of the batch.
 *
 * This is not something `deliverBatch` can defend against — a real 5xx
 * reply and a nested-MAIL 5xx reply are the same shape by construction, so
 * no classification in batch.ts can tell them apart. The defense has to
 * stop the poisoning from happening at all, inside the `Sender`
 * implementation itself; see smtp.ts's `send`. This class and the test
 * below exist to pin exactly why that matters: without it, one bad address
 * takes every row behind it down too.
 */
class ConnectionPoisoningFakeSender implements Sender {
  readonly sent: Message[] = [];
  private poisoned = false;

  constructor(
    private readonly failOn: (message: Message) => string | null,
    private readonly poisonedError: string,
  ) {}

  send(message: Message): Promise<void> {
    if (this.poisoned) return Promise.reject(new Error(this.poisonedError));
    const reason = this.failOn(message);
    if (reason) {
      this.poisoned = true;
      return Promise.reject(new Error(reason));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

function recordingReport() {
  const sentIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  const releases: Array<{ spared: string[]; trigger: { id: string; error: string } }> = [];
  const report: Report = {
    markSent: async (ids) => {
      sentIds.push(...ids);
    },
    markFailed: async (id, error) => {
      failures.push({ id, error });
    },
    release: async (spared, trigger) => {
      releases.push({ spared, trigger });
    },
  };
  return { report, sentIds, failures, releases };
}

describe('deliverBatch', () => {
  it('sends every row and reports them in one call', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two' }), row({ id: 'three' })];
    const sender = new FakeSender();
    const { report, sentIds } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(sender.sent).toHaveLength(3);
    // One markSent for the whole batch. Fifty round trips to say "that
    // worked" would cost more than the sending did.
    expect(sentIds).toEqual(['one', 'two', 'three']);
  });

  // The reason the loop exists. A relay that rejects one address must not
  // cost the other forty-nine their delivery window.
  it('keeps going when one address is rejected', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two', recipient_email: 'bad@example.com' }), row({ id: 'three' })];
    const sender = new FakeSender((message) =>
      message.to === 'bad@example.com' ? '550 no such user' : null,
    );
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 2, failed: 1 });
    expect(sentIds).toEqual(['one', 'three']);
    expect(failures).toEqual([{ id: 'two', error: '550 no such user' }]);
  });

  // A row that cannot be rendered at all is a failure like any other, not
  // an exception that abandons the batch. `bodyFor`'s `default:` throws a
  // named error for exactly this case — a kind that matches no template —
  // so this asserts on that specific message reaching `markFailed`, not
  // just on some throw or other happening to occur.
  it('treats a render failure as that row failing', async () => {
    const rows = [row({ id: 'one', kind: 'nonsense' as never })];
    const sender = new FakeSender();
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(sentIds).toEqual([]);
    expect(failures).toEqual([
      { id: 'one', error: 'bodyFor: unhandled notification kind: nonsense' },
    ]);
  });

  it('reports nothing when there is nothing to do', async () => {
    const sender = new FakeSender();
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch([], sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sentIds).toEqual([]);
    expect(failures).toEqual([]);
  });

  // The bug this whole classification exists to close: a relay outage used
  // to burn an attempt off every row in every batch drawn while it lasted,
  // and five batches (25 minutes into the 5/5/10/20/40/80 backoff
  // schedule) was enough to dead-letter rows that were never actually bad
  // addresses. A recognized connection-level failure — see
  // `looksLikeConnectionFailure` in batch.ts — must cost nothing: neither
  // `markFailed` for anyone, nor an un-refunded attempt, which is what
  // `report.release` (not tested by `markFailed`/`markSent` alone) exists
  // to prove.
  it('stops the batch on a recognized connection failure and releases every row instead of marking any failed', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two' }), row({ id: 'three' })];
    const sender = new ClosingFakeSender(() => 'connect ECONNREFUSED 127.0.0.1:25');
    const { report, sentIds, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sentIds).toEqual([]);
    expect(failures).toEqual([]);
    // The row whose own send threw is the trigger; everything still
    // waiting behind it is spared.
    expect(releases).toEqual([
      {
        spared: ['two', 'three'],
        trigger: { id: 'one', error: 'connect ECONNREFUSED 127.0.0.1:25' },
      },
    ]);
    // Closed once, even though the loop broke before its last row.
    expect(sender.closeCalls).toBe(1);
  });

  // Finding #2 (round 2): a relay throttling or greylisting the whole
  // batch answers every row with a 4xx reply, not a dropped connection —
  // RFC 5321's "try again later" class. Treated exactly like a recognized
  // connection failure: the loop breaks, nobody in this batch is marked
  // failed, and every claimed row (including the one that produced the
  // 4xx) is released rather than burning an attempt on a row that was
  // never actually wrong.
  it('stops the batch on a transient 4xx reply, the same as a connection failure', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two' }), row({ id: 'three' })];
    const sender = new ClosingFakeSender(() => '421 Too many concurrent connections');
    const { report, sentIds, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sentIds).toEqual([]);
    expect(failures).toEqual([]);
    expect(releases).toEqual([
      {
        spared: ['two', 'three'],
        trigger: { id: 'one', error: '421 Too many concurrent connections' },
      },
    ]);
  });

  // A 5xx reply is still this row's own problem, not the relay's — the
  // split is on the leading digit, not merely "has a reply code".
  it('still treats a 5xx reply as an address rejection, not a transient one', async () => {
    const rows = [row({ id: 'one' })];
    const sender = new FakeSender(() => '552 mailbox full');
    const { report, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(failures).toEqual([{ id: 'one', error: '552 mailbox full' }]);
    expect(releases).toEqual([]);
  });

  // The backstop for a failure neither `looksLikeAddressRejection`,
  // `looksLikeTransientReply` nor `looksLikeConnectionFailure` recognizes:
  // three of them in a row, with no send succeeding in between, is treated
  // as the relay rather than three unrelated bad addresses. The first two
  // still cost an attempt — the loop cannot know sooner than this — but
  // the third, and everything after it, is released.
  it('treats three consecutive unrecognized failures as the relay and releases the third row', async () => {
    const rows = [
      row({ id: 'one' }),
      row({ id: 'two' }),
      row({ id: 'three' }),
      row({ id: 'four' }),
    ];
    const sender = new ClosingFakeSender(() => 'the mail server said something odd');
    const { report, sentIds, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 0, failed: 2 });
    expect(sentIds).toEqual([]);
    expect(failures.map((f) => f.id)).toEqual(['one', 'two']);
    expect(releases).toEqual([
      {
        spared: ['four'],
        trigger: { id: 'three', error: 'the mail server said something odd' },
      },
    ]);
    expect(sender.closeCalls).toBe(1);
  });

  // A render failure happens before any network call, so it can never be
  // evidence the relay is down — it must not count toward the streak
  // above, or a handful of malformed rows ahead of a genuine address
  // rejection would misclassify that rejection as a relay outage.
  it('does not let a render failure feed the unrecognized-failure streak', async () => {
    const rows = [
      row({ id: 'one', kind: 'nonsense' as never }),
      row({ id: 'two', kind: 'nonsense' as never }),
      row({ id: 'three', recipient_email: 'bad@example.com' }),
      row({ id: 'four' }),
    ];
    const sender = new ClosingFakeSender((message) =>
      message.to === 'bad@example.com' ? '550 no such user' : null,
    );
    const { report, sentIds, failures } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 1, failed: 3 });
    expect(sentIds).toEqual(['four']);
    expect(failures.map((f) => f.id)).toEqual(['one', 'two', 'three']);
    expect(sender.closeCalls).toBe(1);
  });

  // The sharper version of the test above: it must not touch the streak at
  // all, not merely "not reset it to a value that happens to still work
  // out" — a render failure interleaved between two genuinely unrecognized
  // send failures used to zero the counter, so a third unrecognized
  // failure only ever reached a streak of 1, never RELAY_DOWN_STREAK's 3,
  // and the backstop could never fire while a render-broken row kept
  // interrupting it. Two unrecognized failures, a render failure in the
  // middle that must be inert, then a third unrecognized failure has to
  // still trip the backstop.
  it('lets an interleaved render failure pass through without resetting the streak', async () => {
    const rows = [
      row({ id: 'one' }),
      row({ id: 'two' }),
      row({ id: 'three', kind: 'nonsense' as never }),
      row({ id: 'four' }),
      row({ id: 'five' }),
    ];
    const sender = new ClosingFakeSender(() => 'the mail server said something odd');
    const { report, sentIds, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    // one, two and three (the render failure) each cost their own attempt;
    // four is where the streak — 1, 2, then 3 — trips, sparing four and
    // everything behind it (five).
    expect(result).toEqual({ sent: 0, failed: 3 });
    expect(sentIds).toEqual([]);
    expect(failures.map((f) => f.id)).toEqual(['one', 'two', 'three']);
    expect(releases).toEqual([
      {
        spared: ['five'],
        trigger: { id: 'four', error: 'the mail server said something odd' },
      },
    ]);
  });

  // Round 3's regression guard: `supabase.rpc` throws on a hard fetch
  // failure rather than returning `{ error }` the way it does for an
  // RPC-level one, and `report.release` runs right on the break path — the
  // one most likely to coincide with exactly that kind of flaky network.
  // `markSent` used to sit after the loop's try/finally rather than inside
  // it, so a `release` throw here used to unwind straight out of
  // `deliverBatch` and skip `markSent` entirely — the rows already sent
  // earlier in the same batch would never be recorded, and would be mailed
  // a second time on the next tick.
  it('still marks earlier rows sent, and still closes the sender, when report.release throws', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two', recipient_email: 'bad@example.com' })];
    const sender = new ClosingFakeSender((message) =>
      message.to === 'bad@example.com' ? 'connect ECONNREFUSED 127.0.0.1:25' : null,
    );
    const sentIds: string[] = [];
    const report: Report = {
      markSent: async (ids) => {
        sentIds.push(...ids);
      },
      markFailed: async () => {},
      release: async () => {
        throw new Error('fetch failed');
      },
    };

    await expect(deliverBatch(rows, sender, APP, report)).rejects.toThrow('fetch failed');

    expect(sentIds).toEqual(['one']);
    expect(sender.closeCalls).toBe(1);
  });

  it('closes the sender once after a batch that sends everything cleanly', async () => {
    const rows = [row({ id: 'one' }), row({ id: 'two' })];
    const sender = new ClosingFakeSender();
    const { report } = recordingReport();

    await deliverBatch(rows, sender, APP, report);

    expect(sender.closeCalls).toBe(1);
  });

  // The critical defect this whole round exists to fix, made concrete: a
  // Sender that reuses one poisoned connection cascades one genuinely bad
  // address into false failures for every row behind it, because the
  // resulting error carries a real 3-digit reply code and
  // `looksLikeAddressRejection` has no way to know it came from a
  // corrupted connection rather than the server. `deliverBatch` cannot
  // defend against this on its own — see `ConnectionPoisoningFakeSender`'s
  // doc comment above. What makes this safe in production is smtp.ts's
  // `send` tearing the connection down on every failure, so no `Sender`
  // shaped like this one is ever handed to `deliverBatch` for real.
  it('would cascade every row behind one rejection into false failures if a sender reused a poisoned connection', async () => {
    const rows = [
      row({ id: 'one' }),
      row({ id: 'two', recipient_email: 'bad@example.com' }),
      row({ id: 'three' }),
      row({ id: 'four' }),
    ];
    const sender = new ConnectionPoisoningFakeSender(
      (message) => (message.to === 'bad@example.com' ? '550 no such user' : null),
      '503 5.5.1 Error: nested MAIL command',
    );
    const { report, sentIds, failures, releases } = recordingReport();

    const result = await deliverBatch(rows, sender, APP, report);

    expect(result).toEqual({ sent: 1, failed: 3 });
    expect(sentIds).toEqual(['one']);
    expect(failures.map((f) => f.id)).toEqual(['two', 'three', 'four']);
    expect(failures[1].error).toBe('503 5.5.1 Error: nested MAIL command');
    expect(failures[2].error).toBe('503 5.5.1 Error: nested MAIL command');
    // Every one of those looks exactly like a genuine address rejection —
    // nothing here recognizes it as a relay problem, which is the point.
    expect(releases).toEqual([]);
  });
});
