#!/usr/bin/env bash
# Restore a backup set made by backup.sh into an empty Supabase database.
#
# Usage: scripts/db-backup/restore.sh <backup-dir> <database-url> [--with-cron] [--new-ref <ref>]
#
#   <database-url>  postgresql://postgres:<password>@<host>:<port>/postgres of an EMPTY
#                   Supabase database: a new project, or a local `supabase db start`.
#   --with-cron     also recreate production's cron jobs. Only for a database that
#                   replaces production, because the jobs call production's functions.
#   --new-ref REF   cron jobs and some functions hard-code production's project URL.
#                   When restoring into a new project, rewrite it to the new ref.
#
# Everything loads in one transaction, so on any error nothing is written.
# Afterwards, run verify.sh with the same arguments.
# shellcheck source=scripts/db-backup/lib.sh
source "$(dirname "$0")/lib.sh"

usage="usage: restore.sh <backup-dir> <database-url> [--with-cron] [--new-ref REF]"
dir="${1:?$usage}"
url="${2:?$usage}"
shift 2
with_cron=false
new_ref=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-cron) with_cron=true ;;
    --new-ref) new_ref="${2:?--new-ref needs a project ref}"; shift ;;
    *) die "unknown option $1 ($usage)" ;;
  esac
  shift
done
for f in roles.sql schema.sql data.sql cron.sql manifest.json; do
  [ -s "$dir/$f" ] || die "$dir/$f is missing"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Cebby signs people in with Logto, so production's auth.* and storage.* tables are
# empty, and a fresh project's storage tables refuse writes from postgres anyway. Leave
# those blocks out, and stop if one ever holds rows: that data would need restoring too.
awk '
  /^COPY "(auth|storage)"\./ { skip = 1; tbl = $2; rows = 0; next }
  skip && /^\\\.$/ { if (rows > 0) { print "rows in " tbl > "/dev/stderr"; bad = 1 } skip = 0; next }
  skip { rows++; next }
  { print }
  END { exit bad }
' "$dir/data.sql" > "$work/data.sql" || die "auth or storage tables now hold data; restore.sh must learn to restore them"

cp "$dir/schema.sql" "$work/schema.sql"
cp "$dir/cron.sql" "$work/cron.sql"
if [ -n "$new_ref" ]; then
  old_ref="$(jq -r '.project_ref // empty' "$dir/manifest.json")"
  [ -n "$old_ref" ] || die "manifest.json has no project_ref"
  sed -i.orig "s/$old_ref/$new_ref/g" "$work/schema.sql" "$work/cron.sql"
  log "rewrote $old_ref to $new_ref in schema.sql and cron.sql"
fi

log "restoring in one transaction$($with_cron && echo ', with cron jobs')"
{
  echo 'begin;'
  cat "$dir/roles.sql" "$DB_BACKUP_DIR/sql/pre-schema.sql" "$work/schema.sql" "$work/data.sql"
  if $with_cron; then cat "$work/cron.sql"; fi
  echo 'commit;'
} | url_exec "$url" >/dev/null
log "restore committed"
