/*
 * pg_cron, for the nightly materialization of recurring events.
 *
 * The extension creates and owns the `cron` schema; do not pass a SCHEMA
 * clause. `shared_preload_libraries` must already contain pg_cron — that is a
 * server-start parameter and no migration can set it, which is why this was
 * verified on both the local stack and the hosted project before this file
 * was written rather than after.
 *
 * The job itself is scheduled in a later migration, once the function it
 * calls exists.
 */
create extension if not exists pg_cron;
