/**
 * `index.ts` is the HTTP handler Deno Deploy runs, not something Vitest
 * ever imports (it is environment wiring plus a `Deno.serve` call, unit-
 * tested by nothing — see the module comment in batch.ts). `tsc` still
 * type-checks it, though, same as every other file under
 * supabase/functions/, so it needs the two things Node's type universe
 * does not know about: the `Deno` global, and the `esm.sh` URL specifier
 * used to reach @supabase/supabase-js from Deno instead of node_modules.
 *
 * Both are stubs, narrow on purpose:
 *
 * - `Deno` declares only `env.get` and `serve`, the two members index.ts
 *   actually calls — not the whole Deno namespace.
 * - The esm.sh module re-exports the real npm package's types rather than
 *   redeclaring them by hand, so the two ways of importing
 *   @supabase/supabase-js@2.111.0 (this URL at the pinned version, and the
 *   npm dependency at the same version in package.json) stay one type
 *   surface instead of two that can drift apart.
 */
declare module 'https://esm.sh/@supabase/supabase-js@2.111.0' {
  export * from '@supabase/supabase-js';
}

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
