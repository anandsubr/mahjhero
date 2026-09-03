/*
 * profiles_update_own (20260801221252) checks WHO can update a row
 * (only the row's own owner) but the table-wide `grant update` alongside
 * it never restricted WHICH columns -- so any member could PATCH their
 * own is_admin to true and defeat every RLS policy gated on it
 * (greetings_admin_write, 20260903090000). Narrowed here to exactly the
 * columns lib/profile.ts's updateProfile/updatePreferences actually
 * write, the same column-grant-narrowing pattern this codebase already
 * uses (20260822180000_club_roster_narrow_profiles.sql).
 *
 * `avatar_url` is deliberately NOT in this list: it is part of
 * PROFILE_COLUMNS (read) but neither updateProfile's
 * `Partial<Pick<Profile, 'display_name' | 'skill_level' | 'timezone'>>` nor
 * updatePreferences' NotificationPreferences shape ever writes it -- there
 * is no avatar-upload feature yet. Add it here the day one exists; granting
 * write access to a column nothing writes is an unused door, not a fix.
 */
revoke update on public.profiles from authenticated;
grant update (
  display_name,
  skill_level,
  timezone,
  notify_channel,
  mute_need_a_fourth,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  updated_at
) on public.profiles to authenticated;
