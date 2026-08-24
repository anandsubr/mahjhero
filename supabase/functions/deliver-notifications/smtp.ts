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
