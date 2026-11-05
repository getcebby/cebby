#!/usr/bin/env bash
# Check a restored database against its backup set:
#   1. schema and permissions match production exactly (fingerprint.txt),
#   2. every table holds exactly the rows the dump carried (dump-rows.txt),
#   3. no cron jobs exist, unless it was restored --with-cron. A copy of production
#      must never run production's jobs, which call production's functions.
#
# Usage: scripts/db-backup/verify.sh <backup-dir> <database-url> [--with-cron] [--new-ref]
#
#   --new-ref   the restore rewrote production's project ref, which changes the bodies
#               of the functions that name it. Compare everything except function bodies.
#
# Prints no row counts, because CI logs are public.
# shellcheck source=scripts/db-backup/lib.sh
source "$(dirname "$0")/lib.sh"

usage="usage: verify.sh <backup-dir> <database-url> [--with-cron] [--new-ref]"
dir="${1:?$usage}"
url="${2:?$usage}"
shift 2
with_cron=false
new_ref=false
while [ $# -gt 0 ]; do
  case "$1" in
    --with-cron) with_cron=true ;;
    --new-ref) new_ref=true ;;
    *) die "unknown option $1 ($usage)" ;;
  esac
  shift
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp "$dir/fingerprint.txt" "$work/expected.txt"
url_sql "$url" "$DB_BACKUP_DIR/sql/fingerprint.sql" > "$work/fingerprint.txt"
if $new_ref; then
  sed -i.orig -E 's/ src=[0-9a-f]+ / /' "$work/expected.txt" "$work/fingerprint.txt"
  log "--new-ref: function bodies not compared"
fi
if ! diff -u "$work/expected.txt" "$work/fingerprint.txt" > "$work/fingerprint.diff"; then
  log "schema or permissions differ from production (- production, + restored):"
  grep -E '^[-+][a-z]' "$work/fingerprint.diff" | head -40 >&2
  die "the restore does not match production's schema"
fi

url_sql "$url" "$DB_BACKUP_DIR/sql/counts.sql" > "$work/counts.txt"
tables=0
mismatched=0
while IFS='|' read -r table rows; do
  expected="$(awk -F'|' -v t="$table" '$1 == t { print $2 }' "$dir/dump-rows.txt")"
  if [ "$rows" != "${expected:-0}" ]; then
    log "rows differ from the dump: $table"
    mismatched=1
  fi
  tables=$((tables + 1))
done < "$work/counts.txt"
[ "$mismatched" -eq 0 ] || die "the restore does not hold the dump's rows"

echo 'select count(*) from cron.job;' > "$work/jobs.sql"
jobs="$(url_sql "$url" "$work/jobs.sql")"
if $with_cron; then
  expected_jobs="$(grep -c '^select cron.schedule' "$dir/cron.sql" || true)"
  [ "$jobs" = "$expected_jobs" ] || die "expected $expected_jobs cron jobs, found $jobs"
else
  [ "$jobs" = 0 ] || die "the restored database has cron jobs, which would call production"
fi

log "verified: schema and permissions identical to production ($(wc -l < "$dir/fingerprint.txt" | tr -d ' ') objects), rows match the dump ($tables tables), $jobs cron jobs"
