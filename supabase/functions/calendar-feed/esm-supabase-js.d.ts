/*
 * index.ts imports @supabase/supabase-js by its `esm.sh` URL, the way
 * Deno Deploy reaches it — no `node_modules`, no bundler. `tsc` has no
 * resolver for a bare `https://` specifier, so this stubs it: rather than
 * redeclaring the client's types by hand (and risking them drifting from
 * reality), it re-exports the real npm package's types, so the two ways of
 * importing @supabase/supabase-js@2.111.0 — this URL at the pinned
 * version, and the npm dependency at the same version in package.json —
 * stay one type surface instead of two that can drift apart.
 *
 * Deliberately its own file, kept as a script (no top-level
 * import/export of its own): `declare module "<string>"` only declares a
 * brand-new ambient module when the containing file is a script. Inside a
 * module it is read as a *module augmentation* instead — it requires the
 * named module to already be resolvable some other way, which a
 * fabricated URL specifier never is, so it fails to resolve rather than
 * declaring one from scratch. (index.ts's own `Deno` stub lives directly
 * in index.ts, not in a shared ambient file, for the same-shaped but
 * opposite reason — see the comment there.)
 */
declare module 'https://esm.sh/@supabase/supabase-js@2.111.0' {
  export * from '@supabase/supabase-js';
}
