/*
 * First-run guidance (docs/superpowers/specs/2026-09-23-first-run-guidance-design.md).
 *
 * The keys of every tip/card a member has dismissed. Stored on the profile,
 * not the device, so a card dismissed on the web stays dismissed on the phone.
 *
 * profiles UPDATE is column-granted (20260903160000_profiles_update_column_grant.sql),
 * so the new column must be named in a grant of its own or the client cannot
 * write it. Row scope is unchanged: profiles_update_own still limits writes
 * to the member's own row.
 */
alter table public.profiles
  add column dismissed_guides text[] not null default '{}'
  constraint profiles_dismissed_guides_bounded check (cardinality(dismissed_guides) <= 200);

grant update (dismissed_guides) on public.profiles to authenticated;
