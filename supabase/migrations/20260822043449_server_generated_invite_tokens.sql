/*
 * The invite token is a bearer credential: whoever holds it can join the club.
 * It was generated client-side with Math.random(), which is not a CSPRNG —
 * and importRoster drew a whole batch from one PRNG stream, so one leaked
 * token could expose its siblings.
 *
 * Generating it here means the client cannot choose it, cannot weaken it, and
 * cannot accidentally reuse one. 24 bytes is 192 bits of entropy.
 */
alter table public.club_invites
  alter column token set default encode(extensions.gen_random_bytes(24), 'hex');
