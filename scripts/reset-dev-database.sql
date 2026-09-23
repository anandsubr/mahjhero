-- Reset MahjHero's dev database to empty (no clubs, events, bookings, scores,
-- messages, or accounts) while leaving schema and app-wide config untouched.
--
-- Deliberately NOT reset: `app_config` (app-wide settings, not test data) and
-- `greetings` (admin-authored content, not something a test pass generates).
--
-- Run via `scripts/reset-dev-database.sh`, not directly -- that wrapper
-- checks you're pointed at the right project and makes you type a
-- confirmation phrase first. This file has no such guard on its own.
--
-- TRUNCATE ... CASCADE (not per-table DELETE) so Postgres resolves the
-- foreign-key order itself. `public.profiles.id` is NOT declared as a
-- foreign key to `auth.users.id` (checked directly against mahjhero-dev,
-- 2026-09-22 -- no FK referencing auth.users exists anywhere in this
-- schema), so `auth.users` cannot cascade into it automatically; it is
-- listed here explicitly instead. `auth.users` itself IS the parent of
-- Supabase's own internal auth.* tables (identities, sessions, refresh
-- tokens, etc.), and CASCADE reaches those via their own real FKs without
-- needing to name them.
--
-- Deliberately no `RESTART IDENTITY`: the role this runs as (the Supabase
-- CLI's management-API connection) doesn't own auth.refresh_tokens_id_seq,
-- one of the sequences CASCADE reaches from auth.users, so requesting a
-- restart fails the whole statement with 42501 before anything is deleted.
-- Every table this project owns keys on `gen_random_uuid()`, not a
-- sequence, so there is nothing of ours to restart anyway.
truncate table
  public.archived_messages,
  public.booking_groups,
  public.bookings,
  public.broadcasts,
  public.check_ins,
  public.club_invites,
  public.club_members,
  public.clubs,
  public.event_payments,
  public.event_series,
  public.event_tables,
  public.events,
  public.friendships,
  public.message_attachments,
  public.message_threads,
  public.messages,
  public.notification_outbox,
  public.notification_reads,
  public.post_reads,
  public.profiles,
  public.promotion_offers,
  public.push_tokens,
  public.table_rounds,
  public.thread_members,
  public.thread_reads,
  public.venues,
  auth.users
cascade;
