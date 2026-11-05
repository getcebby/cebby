#!/usr/bin/env bash
# Upload a backup set to Cloudflare R2: each file gzipped, manifest.json last, so a
# prefix that has a manifest.json is complete.
#
# Usage: scripts/db-backup/upload.sh <backup-dir> <prefix>
#        e.g. prefix = nightly/2026-11-05T185000Z-e1c82b9
# Env:   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#        R2_BUCKET   default cebby-db-backups
#
# The bucket's lifecycle rules delete nightly/ after 30 days, pre-migration/ after 90
# and ci/ after 7. A bucket lock keeps every object for its first 7 days, so nothing,
# including a leaked token, can delete or overwrite a recent backup.
# shellcheck source=scripts/db-backup/lib.sh
source "$(dirname "$0")/lib.sh"

dir="${1:?usage: upload.sh <backup-dir> <prefix>}"
prefix="${2:?usage: upload.sh <backup-dir> <prefix>}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
bucket="${R2_BUCKET:-cebby-db-backups}"
[ -s "$dir/manifest.json" ] || die "$dir/manifest.json is missing"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
endpoint="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
dest="s3://$bucket/$prefix"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
names="$(jq -r '.files[].name' "$dir/manifest.json")"
for name in $names; do
  gzip -9c "$dir/$name" > "$stage/$name.gz"
  aws s3 cp "$stage/$name.gz" "$dest/$name.gz" --endpoint-url "$endpoint" --only-show-errors
done
aws s3 cp "$dir/manifest.json" "$dest/manifest.json" --endpoint-url "$endpoint" --only-show-errors

expected=$(( $(echo "$names" | wc -l) + 1 ))
landed="$(aws s3 ls "$dest/" --endpoint-url "$endpoint" | wc -l | tr -d ' ')"
[ "$landed" -eq "$expected" ] || die "expected $expected files under $prefix/, found $landed"
log "uploaded $landed files to r2://$bucket/$prefix/"
