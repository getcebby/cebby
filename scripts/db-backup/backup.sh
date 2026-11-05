#!/usr/bin/env bash
# Back up Cebby's production database into <out-dir>:
#   roles.sql, schema.sql, data.sql   the restorable dump (`supabase db dump`)
#   cron.sql                          production's cron jobs (the dump leaves them out)
#   fingerprint.txt                   schema + permissions, which a restore must match
#   prod-counts.txt, dump-rows.txt    rows per table in production and in the dump
#   migrations.txt                    applied migrations, for `supabase migration repair`
#   manifest.json                     what, when, from which commit, and file checksums
#
# Usage: scripts/db-backup/backup.sh <out-dir>
# Env:   SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD   required
#        SUPABASE_ACCESS_TOKEN                        in CI (locally the CLI login is used)
#        BACKUP_KIND, GIT_SHA, RUN_URL                recorded in manifest.json
#
# Only reads production. Prints no row counts, because CI logs are public.
# shellcheck source=scripts/db-backup/lib.sh
source "$(dirname "$0")/lib.sh"

out="${1:?usage: backup.sh <out-dir>}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"
mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || die "$out is not empty"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

dump() { # <file> [db dump flags...]
  local file="$1" msg; shift
  if ! $SUPABASE db dump --remote="$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD" "$@" -f "$out/$file" \
      >/dev/null 2>"$out/.dump.log"; then
    msg="$(cat "$out/.dump.log")"
    log "${msg//"$SUPABASE_DB_PASSWORD"/***}"
    die "db dump failed for $file"
  fi
  rm -f "$out/.dump.log"
  [ -s "$out/$file" ] || die "db dump wrote an empty $file"
}

log "dumping roles, schema and data"
dump roles.sql --role-only
# Without --keep-comments, db dump deletes every line starting with "--", including
# comment lines inside function bodies.
dump schema.sql --keep-comments
excluded=()
for t in "${EXCLUDED_DATA_TABLES[@]}"; do excluded+=(-x "$t"); done
dump data.sql --data-only --use-copy "${excluded[@]}"

log "recording the schema fingerprint, row counts, cron jobs and migrations"
load_prod_conn
prod_sql "$DB_BACKUP_DIR/sql/fingerprint.sql" > "$out/fingerprint.txt"
prod_sql "$DB_BACKUP_DIR/sql/counts.sql" > "$out/prod-counts.txt"
prod_sql "$DB_BACKUP_DIR/sql/migrations.sql" > "$out/migrations.txt"
{
  echo "-- Production's cron jobs, recreated by restore.sh --with-cron."
  echo "-- Apply ONLY to a database that replaces production: these jobs call production URLs."
  prod_sql "$DB_BACKUP_DIR/sql/cron-export.sql"
} > "$out/cron.sql"
dump_row_counts "$out/data.sql" > "$out/dump-rows.txt"

for f in fingerprint.txt prod-counts.txt migrations.txt dump-rows.txt; do
  [ -s "$out/$f" ] || die "$f is empty"
done
grep -q '^public\.events|[1-9]' "$out/prod-counts.txt" || die "production reports no events: wrong database?"
grep -q '^select cron.schedule' "$out/cron.sql" || log "warning: production has no cron jobs"

# Every table with rows in production must have nearly as many in the dump. Rows written
# after the dump's snapshot explain a small gap; an empty table means a broken dump.
log "checking the dump against production"
checked=0
while IFS='|' read -r table prod_rows; do
  for t in "${EXCLUDED_DATA_TABLES[@]}"; do [ "$t" = "$table" ] && continue 2; done
  dumped="$(awk -F'|' -v t="$table" '$1 == t { print $2 }' "$out/dump-rows.txt")"
  dumped="${dumped:-0}"
  if [ "$prod_rows" -gt 0 ] && { [ "$dumped" -eq 0 ] || [ $((dumped * 10)) -lt $((prod_rows * 9)) ]; }; then
    die "the dump is missing rows of $table"
  fi
  checked=$((checked + 1))
done < "$out/prod-counts.txt"

files_json="$(
  for f in roles.sql schema.sql data.sql cron.sql fingerprint.txt prod-counts.txt dump-rows.txt migrations.txt; do
    jq -n --arg name "$f" --arg sha256 "$(sha256 "$out/$f")" --argjson bytes "$(wc -c < "$out/$f" | tr -d ' ')" \
      '{name: $name, bytes: $bytes, sha256: $sha256}'
  done | jq -s .
)"
jq -n \
  --arg kind "${BACKUP_KIND:-manual}" \
  --arg started_at "$started_at" \
  --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg project_ref "$SUPABASE_PROJECT_REF" \
  --arg git_sha "${GIT_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}" \
  --arg run_url "${RUN_URL:-}" \
  --arg supabase_cli "$($SUPABASE --version 2>/dev/null | tail -1)" \
  --argjson excluded "$(printf '%s\n' "${EXCLUDED_DATA_TABLES[@]}" | jq -R . | jq -s .)" \
  --argjson migrations "$(wc -l < "$out/migrations.txt" | tr -d ' ')" \
  --argjson files "$files_json" \
  '{format: 1, kind: $kind, started_at: $started_at, finished_at: $finished_at,
    project_ref: $project_ref, git_sha: $git_sha, run_url: $run_url, supabase_cli: $supabase_cli,
    excluded_data_tables: $excluded, migrations: $migrations, files: $files}' > "$out/manifest.json"

log "backup ready: $checked tables match production, $(wc -l < "$out/migrations.txt" | tr -d ' ') migrations recorded"
