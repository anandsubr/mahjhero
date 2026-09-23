-- Club invites become email-targeted: the token was the only thing that
-- protected an invite (whoever held the string joined, regardless of who it
-- was "addressed" to). Under the new model, security comes from
-- "authenticated, and your account's email matches the invite's email" --
-- see create_club_invite / accept_club_invite / decline_club_invite /
-- fetch_my_pending_invites (later migrations). A token that no longer
-- protects anything is a future source of confusion, not a harmless
-- leftover, so it is dropped rather than left unused.
--
-- Any existing invite with a null email (created under the old anonymous
-- link flow) is unredeemable under the new model regardless -- there is no
-- email to match against -- so those rows are deleted before the NOT NULL
-- constraint is added, rather than leaving the constraint to fail against
-- pre-existing data.
delete from public.club_invites where email is null;

alter table public.club_invites
  alter column email set not null;

alter table public.club_invites
  add column declined_at timestamptz;

alter table public.club_invites
  drop column token;
