/**
 * `smtp.ts` imports denomailer by its Deno-only URL specifier, which no
 * Node/tsc module resolution understands — Deno resolves it at
 * edge-function deploy time instead. Rather than excluding smtp.ts from
 * type checking entirely (leaving it unverified by every tool in the
 * repo), this stubs the exact shape smtp.ts calls, so `tsc` still checks
 * the rest of that file — field names on `client.send()`, the
 * `SmtpConfig` shape, everything but the module's own internals — against
 * a real contract.
 *
 * Kept intentionally narrow: only the members smtp.ts actually uses.
 */
declare module 'https://deno.land/x/denomailer@1.6.0/mod.ts' {
  export type ConnectAuthentication = {
    username: string;
    password: string;
  };

  export type ConnectionOptions = {
    hostname: string;
    port: number;
    tls: boolean;
    auth?: ConnectAuthentication;
  };

  export type SendConfig = {
    from: string;
    to: string;
    subject: string;
    content: string;
    html: string;
  };

  export class SMTPClient {
    constructor(config: { connection: ConnectionOptions });
    send(config: SendConfig): Promise<void>;
    close(): Promise<void>;
  }
}
