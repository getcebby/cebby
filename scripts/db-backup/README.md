# Database backups and restores

Production (`cebby-v2`, Supabase Free plan) has no Supabase backups. Free projects get none, and point-in-time recovery needs Pro. These scripts are the backups.

## What runs, and where it goes

[`.github/workflows/db-backup.yml`](../../.github/workflows/db-backup.yml) dumps production to the private Cloudflare R2 bucket **`cebby-db-backups`** (in Dorell's Cloudflare account):

| When | Prefix | Kept | Restore rehearsed first |
|---|---|---|---|
| Nightly, 18:50 UTC (02:50 PHT) | `nightly/` | 30 days | yes |
| Before every migration (`deploy-services.yml`) | `pre-migration/` | 90 days | no (the nightly run rehearses the same steps) |
| Pull requests that change the backup | `ci/` | 7 days | yes |

- **Retention.** Lifecycle rules delete each prefix after the period shown.
- **Lock.** A bucket lock keeps every object for its first 7 days: no token, leaked or not, can delete or overwrite a recent backup.
- **Layout.** Each backup is a folder such as `nightly/2026-11-05T185012Z-e1c82b9/`. It's complete once its `manifest.json` is there, because that file is uploaded last.
- **Blocking.** If the pre-migration backup fails, the migration doesn't run.
- **Failures.** A failed nightly run emails whoever last edited the workflow's cron line, the same way the watchdog does.

**In a backup:** every table in `public` and `private` with its rows, every function, policy, trigger, view and grant, and the roles.
- `cron.sql` holds the cron jobs, which the dump itself leaves out.
- `migrations.txt` holds the migration history.

**Not in a backup:**
- **Log data:** `service_health_events` (a restore empties the `/status` history bars), `net._http_response`, `cron.job_run_details`.
- **`auth` and `storage`:** both are empty, because Cebby signs people in with Logto. `restore.sh` stops if either ever holds rows.
- **Secrets outside the database:** see [the last section](#kept-outside-the-backup).

## Get a backup

You need the R2 keys. They're the `R2_BACKUP_*` GitHub secrets, or create a read-only R2 token for `cebby-db-backups` in the Cloudflare dashboard. You can also download files from the dashboard: R2 → `cebby-db-backups` → Objects.

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=auto
R2=https://<account-id>.r2.cloudflarestorage.com

aws s3 ls s3://cebby-db-backups/nightly/ --endpoint-url $R2        # or pre-migration/
aws s3 cp --recursive s3://cebby-db-backups/<prefix>/ ~/restore/ --endpoint-url $R2
gunzip ~/restore/*.gz
(cd ~/restore && jq -r '.files[] | "\(.sha256)  \(.name)"' manifest.json | shasum -a 256 -c)
```

Pick the backup taken before the damage: the newest `nightly/` one, or the `pre-migration/` one from just before a bad deploy. Its `manifest.json` has the time, the commit and a link to the run.

## Restore: get some rows back (the usual case)

Use this when a bad migration or a mistaken command damaged some data but production still runs. Restore the backup into a throwaway local database, which needs Docker and never touches production, then copy back only what's needed.

```bash
SUPABASE="npx -y supabase@3.0.0" scripts/db-backup/rehearse.sh ~/restore --keep
# → restores, verifies, and prints the local URL and the command that stops it
```

Then copy rows across. Write the SQL for the case at hand, run it in one transaction, and check the counts before `commit`. For example, to bring back deleted accounts:

```bash
LOCAL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
psql() { docker run --rm -i --network host -e PGPASSWORD postgres:17-alpine psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql "$LOCAL" -c "\copy (select * from public.accounts where account_id in (…)) to stdout" > rows.tsv
# production: session pooler, user postgres.<ref>
export PGPASSWORD=…   # DB_PASSWORD
{ echo 'begin;'; echo '\copy public.accounts from stdin'; cat rows.tsv; echo '\.'; echo 'select count(*) from public.accounts;'; } \
  | psql "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 user=postgres.enwcrupzidbcwimyttla dbname=postgres sslmode=require"
# The transaction is still open when psql exits, so nothing is saved.
# Rerun with 'commit;' added once the count looks right.
```

## Restore: production is gone

Use this when the project was deleted or its database is unusable.

1. **Create a new Supabase project** in CebbyORG, in region `ap-southeast-1`. Note its ref and database password.
2. **Get the newest backup** (above).
3. **Restore without cron jobs, rewriting the old project ref to the new one.** Cron jobs and two functions (`private.run_link_checks`, the Typesense sync trigger) hard-code the project URL.
   ```bash
   NEW=postgresql://postgres.<new-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
   scripts/db-backup/restore.sh ~/restore "$NEW" --new-ref <new-ref>
   scripts/db-backup/verify.sh  ~/restore "$NEW" --new-ref
   ```
4. **Record the migration history**, so later `db push` runs apply only new migrations:
   ```bash
   npx -y supabase@3.0.0 migration repair --status applied $(cut -d' ' -f1 ~/restore/migrations.txt) --remote=<new-ref> -p <password>
   ```
5. **Point everything at the new project.**
   - GitHub secrets: `SUPABASE_PROJECT_ID` and `DB_PASSWORD`.
   - The PWA and admin environments: URL, anon key and service-role key.
   - The edge function secrets below.
   - The restored `app_secrets.internal_fn_jwt` is signed by the old project. Replace it, and the `INTERNAL_FN_JWT` function secret, with the new project's legacy anon JWT (see `services/core/supabase/migrations/README.md`).
6. **Deploy the functions:** `gh workflow run deploy-services.yml -f environment=production`.
7. **Turn the cron jobs on last**, once the functions answer:
   ```bash
   sed 's/enwcrupzidbcwimyttla/<new-ref>/g' ~/restore/cron.sql \
     | docker run --rm -i --network host postgres:17-alpine psql "$NEW" -v ON_ERROR_STOP=1
   ```
8. **Check `/status`** after the next scraper run.

## Kept outside the backup

Keep copies of these in a password manager. A restore is only as good as the secrets that come with it.

- **Edge function secrets:** `INTERNAL_FN_JWT`, `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_ADMIN_KEY`, `SMTP_HOSTNAME`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`, `BASE_URL`, `LUMA_INCLUDE_PAST`. (`SUPABASE_URL` and the keys are provided by the project.)
- **App environments:** PWA and admin `.env` (Logto, Google Maps, Typesense search key, admin password).
- **The R2 keys** for this bucket.

## Run it locally

```bash
export SUPABASE="npx -y supabase@3.0.0" SUPABASE_PROJECT_REF=enwcrupzidbcwimyttla SUPABASE_DB_PASSWORD=…
scripts/db-backup/backup.sh /tmp/cebby-backup      # reads production only
scripts/db-backup/rehearse.sh /tmp/cebby-backup    # throwaway local database on port 55422
```

## Why the scripts do what they do

Each item below broke a plain `supabase db dump` restore when it was tested on 2026-11-05.

- **`sql/pre-schema.sql` runs before the schema.** A fresh Supabase project auto-grants every new table in `public` to `anon`, `authenticated` and `service_role`, and the dump never revokes those grants. Without this file, a restore gave `anon` full access to `app_secrets`, `account_secrets`, `profiles` and every other table production keeps private: 100 extra grants.
- **The schema dump uses `--keep-comments`.** Otherwise `db dump` deletes every line that starts with `--`, including comment lines inside function bodies.
- **`cron.sql` is separate, and never applied to a copy.** The dump leaves `cron.job` out. The jobs call production's functions with the token in `app_secrets`, so a copy running them would act on production. `verify.sh` fails if a copy has any cron jobs.
- **The `auth` and `storage` blocks are dropped.** They're empty, and a fresh project's storage tables refuse writes from `postgres`.
- **`verify.sh` compares a fingerprint, not just counts.** It covers every table, column, function body, view, policy, trigger, index, constraint and grant in `public` and `private`, and it must match production line for line. It also requires the rows of every table to match the dump exactly.
- **The logs print no row counts**, because the repo and its Actions logs are public.
