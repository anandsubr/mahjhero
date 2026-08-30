import { beforeEach, describe, expect, it, vi } from 'vitest';

// countBroadcastRecipients's path is `rpc(...)`. Modelled as the real call
// so a test is exercising the behaviour and not a TypeError on a missing
// method.
const rpc = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    // Referenced through an indirection, not as a bare value: vi.mock's
    // factory runs when './supabase' first resolves, which happens before
    // this file's own `const rpc = vi.fn()` executes (import statements
    // are hoisted ahead of module-level code, and vi.mock's factory fires
    // as part of resolving the import of './broadcasts' below). A direct
    // `rpc,` here would read the binding before it is initialized. Matches
    // lib/bookings.test.ts's `rpc: (...args) => rpc(...args)`.
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import {
  countBroadcastRecipients,
  isValidBroadcast,
  BODY_MAX,
  SUBJECT_MAX,
} from './broadcasts';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockRejectedValue(new Error('network down'));
});

describe('isValidBroadcast', () => {
  it('accepts an ordinary message', () => {
    expect(isValidBroadcast('Doors at seven', 'Side entrance is locked.')).toBe(true);
  });

  // Whitespace is not a message. The database check constraint trims too,
  // so a client that let this through would produce a 23514 the member
  // could do nothing about.
  it('rejects a subject or body that is only whitespace', () => {
    expect(isValidBroadcast('   ', 'Body')).toBe(false);
    expect(isValidBroadcast('Subject', '  \n ')).toBe(false);
  });

  // The bounds match the constraints in 20260826030000 exactly. If they
  // drift, a member types a valid-looking message and the write fails.
  it('rejects anything past the stored limits', () => {
    expect(isValidBroadcast('x'.repeat(SUBJECT_MAX), 'Body')).toBe(true);
    expect(isValidBroadcast('x'.repeat(SUBJECT_MAX + 1), 'Body')).toBe(false);
    expect(isValidBroadcast('Subject', 'x'.repeat(BODY_MAX))).toBe(true);
    expect(isValidBroadcast('Subject', 'x'.repeat(BODY_MAX + 1))).toBe(false);
  });

  // 20260826030000's `subject` column carries a second constraint beyond
  // length: `check (subject !~ '[[:cntrl:]]')`. The Edge Function drops the
  // subject straight into an SMTP header (render.ts's sanitizeSubject), so a
  // CR or LF here would let a host inject an arbitrary header. A client that
  // let this through would type-check fine and still hit a 23514 on send.
  it('rejects a subject carrying an embedded control character', () => {
    expect(
      isValidBroadcast('Doors at seven\r\nBcc: evil@example.com', 'Body'),
    ).toBe(false);
    expect(isValidBroadcast('Doors at seven\tsharp', 'Body')).toBe(false);
  });

  // Postgres's `[[:cntrl:]]`, under this database's en_US.UTF-8 collation,
  // is not just 0x00-0x1F and 0x7F -- it also carries the C1 range,
  // U+0080-U+009F, which a bad Windows-1252 round-trip can paste into a
  // subject. Before this widened the pattern, a subject like this one
  // passed this check and hit the database's constraint anyway, and
  // because the write path relays `error.message` verbatim, the host would
  // have seen a raw `violates check constraint "broadcasts_subject_check1"`
  // instead of a refusal caught here first.
  it('rejects a subject carrying a C1 control character (U+0080-U+009F)', () => {
    // \u0085 (NEL) sits in the middle of the C1 range; \u0080 and \u009f
    // are its two boundaries. The old pattern's JS source stopped at
    // \x7f and never reached any of these three.
    expect(isValidBroadcast('Doors at\u0085seven', 'Body')).toBe(false);
    expect(isValidBroadcast('Doors at\u0080seven', 'Body')).toBe(false);
    expect(isValidBroadcast('Doors at\u009fseven', 'Body')).toBe(false);
  });

  // A subject is trimmed before it is sent, and trim() strips
  // \t \n \v \f \r — all inside the control-character pattern's range. A
  // subject with only a leading/trailing newline trims away to something
  // the database would accept outright, so the client must accept it too
  // rather than refusing a host for no reason.
  it('accepts a subject with a leading or trailing newline', () => {
    expect(isValidBroadcast('Doors at seven\n', 'Body')).toBe(true);
    expect(isValidBroadcast('\nDoors at seven', 'Body')).toBe(true);
  });

  // An interior control character survives trimming, so it must still be
  // refused — this is the header-injection case the database constraint
  // (and this client-side mirror of it) exists for.
  it('rejects a subject carrying an interior newline even though it survives trimming', () => {
    expect(isValidBroadcast('Doors\nat seven', 'Body')).toBe(false);
  });
});

describe('countBroadcastRecipients', () => {
  it('asks the database rather than counting locally', async () => {
    rpc.mockResolvedValue({ data: 14, error: null });
    await expect(countBroadcastRecipients('c1', null)).resolves.toBe(14);
    expect(rpc).toHaveBeenCalledWith('broadcast_recipient_count', {
      target_club: 'c1',
      target_event: null,
    });
  });

  it('resolves null rather than guessing when it cannot ask', async () => {
    await expect(countBroadcastRecipients('c1', 'e1')).resolves.toBeNull();
  });

  // Distinct from the network-down case above: this is an RPC-level
  // refusal (data: null, error: {...}), not a thrown/rejected call. The
  // `if (error) return null` branch is currently masked by the fact that
  // `data` is deliberately a NUMBER here, not null. With `data: null` this
  // test would pass whether or not the `if (error) return null` branch
  // exists, because the `typeof data === 'number'` guard below it returns
  // null for a null `data` anyway — the branch would be masked by the very
  // test meant to pin it. A non-null `data` alongside an error is the only
  // shape where deleting that branch changes the answer, from null to 5.
  it('resolves null on an explicit RPC-level failure', async () => {
    rpc.mockResolvedValue({ data: 5, error: { message: 'denied' } });
    await expect(countBroadcastRecipients('c1', null)).resolves.toBeNull();
  });
});
