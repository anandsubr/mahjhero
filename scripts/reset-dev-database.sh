#!/usr/bin/env bash
# Wipes every club, event, booking, score, message, and account from the
# mahjhero-dev database -- for starting a QA pass from zero. Irreversible,
# dev-only. Never touches app_config or greetings; see reset-dev-database.sql
# for exactly what it does and why.
#
# Usage: scripts/reset-dev-database.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EXPECTED_REF="rzutuhabxzcateutaojo" # mahjhero-dev -- the only project this script is allowed to touch
LINKED_REF_FILE="supabase/.temp/project-ref"

if [[ ! -f "$LINKED_REF_FILE" ]]; then
  echo "error: no linked Supabase project found (missing $LINKED_REF_FILE)." >&2
  echo "Run 'npx supabase link' first, and make sure it's linked to mahjhero-dev." >&2
  exit 1
fi

LINKED_REF="$(cat "$LINKED_REF_FILE")"
if [[ "$LINKED_REF" != "$EXPECTED_REF" ]]; then
  echo "error: linked project is '$LINKED_REF', expected mahjhero-dev ($EXPECTED_REF)." >&2
  echo "Refusing to run -- this script must never run against any other project." >&2
  exit 1
fi

echo "Target: mahjhero-dev ($EXPECTED_REF)"
echo ""
echo "This will permanently delete every club, event, booking, waitlist entry,"
echo "check-in, payment record, score, message, and sign-in account in that"
echo "database. There is no undo. app_config and greetings are left alone."
echo ""
echo "Current row counts:"
npx supabase db query --linked "
  select 'auth.users' as t, count(*) from auth.users
  union all select 'clubs', count(*) from public.clubs
  union all select 'events', count(*) from public.events
  union all select 'bookings', count(*) from public.bookings
  union all select 'table_rounds', count(*) from public.table_rounds
  union all select 'message_threads', count(*) from public.message_threads
  order by 1;
"
echo ""
read -r -p "Type RESET to wipe mahjhero-dev, or anything else to cancel: " CONFIRM
if [[ "$CONFIRM" != "RESET" ]]; then
  echo "Cancelled -- nothing was touched."
  exit 0
fi

echo ""
echo "Wiping..."
npx supabase db query --linked -f scripts/reset-dev-database.sql

echo ""
echo "Done. Row counts should all be zero now:"
npx supabase db query --linked "
  select 'auth.users' as t, count(*) from auth.users
  union all select 'clubs', count(*) from public.clubs
  union all select 'events', count(*) from public.events
  union all select 'bookings', count(*) from public.bookings
  union all select 'table_rounds', count(*) from public.table_rounds
  union all select 'message_threads', count(*) from public.message_threads
  order by 1;
"
