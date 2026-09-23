#!/usr/bin/env bash
# Grants the app-admin flag (public.profiles.is_admin) to an account on
# mahjhero-dev, by email. There is deliberately no in-app UI for this --
# is_admin was originally seeded once, directly, in
# supabase/migrations/20260903080000_profiles_is_admin.sql, matched against
# auth.users by email. That seed only ever runs once in a project's history;
# it does not re-fire after a reset (scripts/reset-dev-database.sh) deletes
# the account it was pointed at. This script is the repeatable equivalent
# for whenever that happens again.
#
# The account must already exist -- sign in with that email first (magic
# link, Google, or Apple) so its auth.users/profiles rows exist, then run
# this.
#
# Usage: scripts/grant-admin.sh someone@example.com
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EMAIL="${1:-}"
if [[ -z "$EMAIL" ]]; then
  echo "Usage: scripts/grant-admin.sh <email>" >&2
  exit 1
fi

EXPECTED_REF="rzutuhabxzcateutaojo" # mahjhero-dev
LINKED_REF_FILE="supabase/.temp/project-ref"

if [[ ! -f "$LINKED_REF_FILE" ]]; then
  echo "error: no linked Supabase project found (missing $LINKED_REF_FILE)." >&2
  exit 1
fi

LINKED_REF="$(cat "$LINKED_REF_FILE")"
if [[ "$LINKED_REF" != "$EXPECTED_REF" ]]; then
  echo "error: linked project is '$LINKED_REF', expected mahjhero-dev ($EXPECTED_REF)." >&2
  exit 1
fi

echo "Target: mahjhero-dev ($EXPECTED_REF)"
echo "Looking up $EMAIL ..."

# Single-quotes inside the SQL string are doubled ('') per standard SQL
# escaping, not shell escaping -- this whole string is already inside
# double quotes so $EMAIL itself expands first.
FOUND="$(npx supabase db query --linked "
  select p.id, p.is_admin
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email = '${EMAIL//\'/\'\'}';
" 2>&1)"

echo "$FOUND"

if ! grep -q '"id"' <<<"$FOUND"; then
  echo ""
  echo "No profile found for that email. Sign in with it at least once first --" >&2
  echo "a profile row is only created after a successful sign-in." >&2
  exit 1
fi

read -r -p "Grant is_admin = true to this account? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Cancelled -- nothing was changed."
  exit 0
fi

npx supabase db query --linked "
  update public.profiles p
  set is_admin = true
  from auth.users u
  where u.id = p.id and u.email = '${EMAIL//\'/\'\'}'
  returning p.id, p.is_admin;
"

echo ""
echo "Done. Sign out and back in (or just reload) to see the Greetings card on Profile."
