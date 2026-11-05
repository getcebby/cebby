#!/usr/bin/env bash
# Prove a backup set restores: start a throwaway local Supabase database, restore the
# set into it, verify it, then remove it. Needs Docker. Never touches production.
#
# Usage: scripts/db-backup/rehearse.sh <backup-dir> [--keep]
#   --keep   leave the restored database running, to copy rows out of it (README.md)
# Env:   REHEARSAL_DB_PORT   default 55422, clear of the usual local stack on 54322
# shellcheck source=scripts/db-backup/lib.sh
source "$(dirname "$0")/lib.sh"

dir="${1:?usage: rehearse.sh <backup-dir> [--keep]}"
keep=false
[ "${2:-}" = "--keep" ] && keep=true
port="${REHEARSAL_DB_PORT:-55422}"
work="$(mktemp -d)"
mkdir -p "$work/supabase"
cat > "$work/supabase/config.toml" <<EOF
project_id = "cebby-restore-rehearsal"

[db]
port = $port
shadow_port = $((port - 2))
major_version = 17

[db.seed]
enabled = false
EOF

stop_db() { (cd "$work" && $SUPABASE stop --no-backup >/dev/null 2>&1) || true; }
cleanup() { stop_db; rm -rf "$work"; }
trap cleanup EXIT

log "starting a throwaway Supabase database on port $port"
stop_db # a leftover from an interrupted run would block the start
if ! (cd "$work" && $SUPABASE db start >/dev/null 2>"$work/start.log"); then
  cat "$work/start.log" >&2
  die "supabase db start failed"
fi

url="postgresql://postgres:postgres@127.0.0.1:$port/postgres"
# Error codes only: psql messages can quote row data, and CI logs are public. To see a
# failing restore in full, run restore.sh directly against the rehearsal database.
export PSQL_VERBOSITY=sqlstate
"$DB_BACKUP_DIR/restore.sh" "$dir" "$url"
"$DB_BACKUP_DIR/verify.sh" "$dir" "$url"
log "rehearsal passed"

if $keep; then
  trap - EXIT
  log "kept running: $url"
  log "stop it with: (cd $work && $SUPABASE stop --no-backup) && rm -rf $work"
fi
