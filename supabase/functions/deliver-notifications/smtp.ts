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
    } finally {
      // A connection left open survives the invocation in Deno Deploy and
      // the relay eventually refuses new ones.
      await client.close();
    }
  }
}
