import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { PooledConnection } from './pooled-connection.ts';
import type { Sender } from './sender.ts';
import type { Message } from './types.ts';

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

/**
 * Hosts that are unambiguously local development infrastructure, never a
 * real relay reachable over the public internet: loopback under any of its
 * spellings, and `inbucket` — the Docker network alias the Supabase CLI's
 * own Mailpit container answers to (see docs/testing.md's "notification
 * drain" section for why that's what `.env.local` uses, rather than
 * `127.0.0.1:54325`, from inside `functions serve`'s container).
 *
 * Deliberately a fixed allowlist, not a heuristic (no "contains localhost",
 * no CIDR match on 127.0.0.0/8) — the cost of getting this wrong is mail
 * content on the wire in plaintext, so it only recognizes exact strings a
 * person cannot produce by accident.
 */
const LOCAL_DEV_SMTP_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'inbucket']);

function isLocalDevHost(host: string): boolean {
  return LOCAL_DEV_SMTP_HOSTS.has(host.toLowerCase());
}

/**
 * denomailer 1.6.0 has no connect or send timeout of its own — confirmed
 * against its `ClientOptions`/`ConnectionOptions` types, which carry
 * `pool.timeout` (an idle *pooled* connection's close interval, not a
 * connect deadline) and nothing else timeout-shaped. Its `Deno.connect` /
 * `Deno.connectTls` call is unwrapped, so a relay that accepts the TCP
 * handshake and then never speaks — a black hole, not a refusal — leaves
 * `client.send()` awaiting forever. The Edge Function's own wall clock is
 * what used to end that, mid-batch: the row stayed leased, `attempts` had
 * already been incremented at claim time, and `last_error` never got
 * written, so it neither sent nor dead-lettered while its attempts
 * climbed one silent kill at a time.
 *
 * 15 seconds is generous for a TLS handshake plus one SMTP transaction
 * against a working relay and short enough that a hung one gives up long
 * before an Edge Function invocation's own wall clock does, even in the
 * worst case of it firing on every message in a batch.
 */
const SEND_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`smtp: timed out after ${ms}ms waiting on the relay`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The only file in this function that imports a URL module, and therefore
 * the only one Vitest cannot see. Keep it that thin.
 *
 * SMTP rather than a provider's HTTP API so that local development and the
 * hosted deployment run the identical code path — locally against the
 * Mailpit the Supabase CLI already runs on port 54325, and in production
 * against whatever relay the secrets point at. The provider becomes a
 * secret rather than a dependency.
 */
export class SmtpSender implements Sender {
  /**
   * Owns the reuse-across-a-batch / discard-on-failure state machine (see
   * pooled-connection.ts) — this class supplies only how to open a client
   * and how to tear one down, both denomailer-specific and therefore kept
   * here rather than in the dependency-free class that composes them.
   */
  private readonly connection = new PooledConnection<SMTPClient>(
    () => this.createClient(),
    (client) => client.close(),
  );

  constructor(private readonly config: SmtpConfig) {}

  /**
   * Opened on the first `send` a batch makes and reused for every message
   * after it, instead of one connection per message.
   *
   * At 50 messages a minute a relay sees a fresh TCP+TLS handshake every
   * 1.2 seconds under the old per-message scheme — many relays throttle
   * connection *attempts* far harder than they throttle messages on an
   * already-open one, so that pattern reads as abuse before the message
   * volume itself would. One connection per batch, reused across every
   * `send` and closed once by `close()` below, is both fewer handshakes
   * and the shape a real mail client uses.
   *
   * Lazy rather than opened in the constructor so a batch that claims zero
   * rows — most ticks, in a club-scale product — never dials the relay at
   * all. The laziness and the reuse-across-a-batch caching both now live in
   * `connection` (see above); this method only ever builds a brand new
   * client, called by `connection.get()` the first time and again after any
   * `connection.discard()`.
   */
  private createClient(): SMTPClient {
    /*
     * denomailer refuses to finish the handshake at all — for every
     * message, regardless of whether credentials are involved — unless the
     * connection ends up secure: implicit TLS on 465, or a STARTTLS
     * upgrade it negotiates for itself whenever the server offers the
     * extension (both handled below, before this is even consulted).
     * Mailpit offers neither, so this branch was unreachable in every test
     * this function had before Task 11's end-to-end check, which is what
     * caught it: every real send failed with "Connection is not secure",
     * against Mailpit and only Mailpit.
     *
     * denomailer's own docstring for this option is blunt about the
     * blast radius: "USE WITH COUTION AS THIS WILL POSIBLY EXPOSE YOUR
     * USERDATA AND ALL MAIL CONTENT TO ATTACKERS" [sic] — mail content,
     * not just credentials. So this is gated on destination trust, not on
     * whether credentials happen to be set: an unsecured connection is
     * only ever permitted to a host on `LOCAL_DEV_SMTP_HOSTS` above,
     * verified local development infrastructure that never leaves the
     * machine (or the CI/dev Docker network). Anything else — including a
     * production relay that ends up here because `SMTP_USER` was never
     * set, e.g. a typo in `npx supabase secrets set` — stays fail-closed
     * and throws, exactly as denomailer does unmodified, which is the
     * safe outcome for that bug: loud and logged, not a silent plaintext
     * send indistinguishable from `sent:1`.
     *
     * The credential check is kept as a second, independent condition
     * rather than dropped in favor of host trust alone: it's what
     * guarantees the property this file must never lose — whenever this
     * flag permits an unsecured connection, the branch below that attaches
     * `auth` is unreachable, so a password can never be the thing crossing
     * the open socket. Host trust alone doesn't give you that on its own
     * (nothing stops `SMTP_USER` from being set against a local relay in
     * some future config), so both stay: local *and* credential-free.
     *
     * No opt-in escape hatch for an unsecured non-local relay. Nobody
     * building against this function has needed one, and adding an
     * environment variable that turns denomailer's refusal back off is
     * configuration surface whose only real use is bypassing the exact
     * protection this fix exists to add — if that need ever shows up, it
     * should be argued for on its own, not pre-built here.
     */
    const allowUnsecure = isLocalDevHost(this.config.host) && !this.config.user;

    if (allowUnsecure) {
      // The one case this permits is a deliberate, narrow exception to a
      // library that refuses unsecured handshakes by design — so every
      // time it fires, that's on the record, naming the host, rather than
      // a plaintext send that looks identical to a secure one from the
      // caller's side.
      console.warn(
        `smtp: allowing an unsecured connection to local dev host "${this.config.host}" — this must never fire against a real relay`,
      );
    }

    return new SMTPClient({
      connection: {
        hostname: this.config.host,
        port: this.config.port,
        // Implicit TLS on 465; 587 negotiates STARTTLS on its own. The
        // local Mailpit on 54325 offers neither and needs this false.
        tls: this.config.port === 465,
        // Mailpit accepts anything and wants no credentials. Passing an
        // empty username makes it refuse the connection outright.
        auth: this.config.user
          ? { username: this.config.user, password: this.config.pass }
          : undefined,
      },
      debug: { allowUnsecure },
    });
  }

  async send(message: Message): Promise<void> {
    const client = this.connection.get();
    try {
      // Bounds both the connect and the SMTP exchange: denomailer awaits
      // its own lazy connect promise inside `send()` (see `withTimeout`'s
      // comment), so wrapping this one call covers a hang at either
      // stage.
      await withTimeout(
        client.send({
          from: this.config.from,
          to: message.to,
          subject: message.subject,
          content: message.text,
          html: message.html,
        }),
        SEND_TIMEOUT_MS,
      );
    } catch (cause) {
      /*
       * denomailer 1.6.0 (`client/basic/client.ts`, read directly from its
       * source rather than trusted secondhand) does not reset the SMTP
       * transaction after a failed send. For any failure before DATA mode
       * -- a rejected `RCPT TO`, say -- its own `catch` runs `#cleanup()`,
       * which is `NOOP` followed by reading one `250`, and nothing else:
       *
       *   async #cleanup() {
       *     this.#connection.writeCmd("NOOP");
       *     while (true) {
       *       const cmd = await this.#connection.readCmd();
       *       if (cmd && cmd.code === 250) return;
       *     }
       *   }
       *
       * NOOP does not clear the reverse-path buffer a `MAIL FROM` opened
       * (RFC 5321 §4.1.1.9). So reusing this same `client` for the next
       * `send()` in the batch issues a second `MAIL FROM` on top of the
       * first, still-open one -- a nested MAIL that a real relay answers
       * with its own 3-digit reply code (Postfix: "503 5.5.1 Error: nested
       * MAIL command"; Exim: "503 sender already given"; Gmail: "503 5.5.1
       * MAIL first"), which is indistinguishable, to
       * `looksLikeAddressRejection` in batch.ts, from a genuine per-row
       * rejection -- so one bad address would cascade a false failure
       * through every row behind it for the rest of the batch.
       *
       * There is a second, milder shape of the same underlying problem: a
       * failure that happens IN data mode makes denomailer close the raw
       * socket itself (`this.#connection.conn?.close()`, via a
       * `queueMicrotask`) without this class ever finding out -- `client`
       * above stays the same object, and `connection` would still hand it
       * back on the next `get()` call, so the next `send()` would throw
       * Deno's own "Bad resource ID" against an already-closed connection
       * instead.
       *
       * Both are fixed the same way: never hand the next `send()` call a
       * connection whose protocol state a failure may have left
       * inconsistent. Discard it unconditionally, on any failure, so the
       * next `send()` reopens fresh through `createClient()` above -- the
       * happy-path reuse in `connection.get()` is untouched, since this
       * only ever runs after a `send` has already thrown. See
       * pooled-connection.ts for the discard/reopen state machine itself,
       * and its own tests for the guard this comment used to be the only
       * evidence of.
       */
      await this.connection.discard();
      // Best-effort close of the discarded client: denomailer may have
      // already closed this connection itself (the data-mode case above),
      // so a failure here is expected, not news -- the caller is already
      // about to see the send failure that actually matters, which is why
      // `discard` swallows a teardown failure silently rather than logging
      // one for every ordinary send rejection.
      throw cause;
    }
  }

  /**
   * Closes the connection `send` opened, if `send` ever ran. `deliverBatch`
   * calls this exactly once, in a `finally`, after the last row in a batch
   * has had its turn — not per message, which would put the per-message
   * handshake this class exists to avoid right back in.
   */
  async close(): Promise<void> {
    await this.connection.discard((closeError) => {
      // Every message this connection carried has already been reported
      // through `report.markSent`/`markFailed` by the time this runs — a
      // close error changes none of that, so it is logged and swallowed
      // rather than thrown out of a `finally`, where it would replace
      // whatever the batch loop was already unwinding.
      console.error('smtp close failed', closeError);
    });
  }
}
