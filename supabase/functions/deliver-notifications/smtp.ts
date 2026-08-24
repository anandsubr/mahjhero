import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
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
  constructor(private readonly config: SmtpConfig) {}

  async send(message: Message): Promise<void> {
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

    const client = new SMTPClient({
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

    try {
      await client.send({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        content: message.text,
        html: message.html,
      });
    } catch (sendError) {
      // A connection left open survives the invocation in Deno Deploy and
      // the relay eventually refuses new ones, so a close is still owed
      // even on failure. But the send already failed for a real reason —
      // a close error on top of that is noise next to it, so it is logged
      // rather than allowed to replace the error that actually matters.
      try {
        await client.close();
      } catch (closeError) {
        console.error('smtp close failed after a failed send', closeError);
      }
      throw sendError;
    }

    try {
      // A connection left open survives the invocation in Deno Deploy and
      // the relay eventually refuses new ones.
      await client.close();
    } catch (closeError) {
      // The send above already succeeded — the relay accepted the message
      // before dropping the connection, which does happen. Given the
      // retry model, letting this reject would read as a failed send and
      // cause a duplicate delivery for mail that already went out, so it
      // is logged and swallowed instead.
      console.error(
        'smtp close failed after a successful send; message was not resent',
        closeError,
      );
    }
  }
}
