# Shared helpers for scripts/db-backup. Sourced, never run directly.
# shellcheck disable=SC2034 # its variables are used by the scripts that source it
set -euo pipefail

DB_BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The Supabase CLI. CI installs it; locally use SUPABASE="npx -y supabase@3.0.0".
SUPABASE="${SUPABASE:-supabase}"
# psql runs in a container so its version always matches the server (prod is Postgres 17).
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

# Rows we never back up: logs that rebuild themselves and make up most of the database.
# Losing service_health_events on a restore only empties the /status history bars.
EXCLUDED_DATA_TABLES=(public.service_health_events net._http_response cron.job_run_details)

log() { printf '[db-backup] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Wrap a SQL file in a read-only transaction with a fixed search_path. Postgres prints
# index, view and constraint definitions relative to search_path, so both sides of a
# comparison must use the same one.
_readonly_wrap() {
  echo 'begin transaction read only;'
  echo 'set local search_path to pg_catalog;'
  cat "$1"
  echo 'commit;'
}

# Point the PG* variables at production, using the same connection `supabase db dump`
# resolves (the IPv4 session pooler). Needs SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD.
load_prod_conn() {
  local exports
  exports="$($SUPABASE db dump --dry-run --role-only --remote="$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD" 2>/dev/null \
    | grep -E '^export PG(HOST|PORT|USER|DATABASE)=')" || die "could not resolve the production database connection"
  eval "$exports"
  export PGPASSWORD="$SUPABASE_DB_PASSWORD" PGSSLMODE=require
  [ -n "${PGHOST:-}" ] || die "db dump --dry-run gave no PGHOST"
}

# Read-only query against production (call load_prod_conn first).
prod_sql() { # <sql-file> [psql args...]
  local file="$1"; shift
  _readonly_wrap "$file" | docker run --rm -i --network host \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
    "$PG_IMAGE" psql -X -q -At -v ON_ERROR_STOP=1 "$@"
}

# Read-only query against a database URL.
url_sql() { # <url> <sql-file> [psql args...]
  local url="$1" file="$2"; shift 2
  _readonly_wrap "$file" | docker run --rm -i --network host \
    "$PG_IMAGE" psql -X -q -At -v ON_ERROR_STOP=1 -d "$url" "$@"
}

# Run SQL from stdin against a database URL, stopping at the first error.
# PSQL_VERBOSITY=terse drops DETAIL and CONTEXT lines, which can quote row data.
url_exec() { # <url>
  docker run --rm -i --network host "$PG_IMAGE" \
    psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY="${PSQL_VERBOSITY:-default}" -d "$1"
}

# Rows per table in a data.sql made by `db dump --data-only --use-copy`, as
# "schema.table|rows". COPY text format escapes newlines, so each row is one line.
dump_row_counts() { # <data.sql>
  awk '
    /^COPY / { tbl = $2; gsub(/"/, "", tbl); rows = 0; inside = 1; next }
    inside && /^\\\.$/ { print tbl "|" rows; inside = 0; next }
    inside { rows++ }
  ' "$1" | sort
}
