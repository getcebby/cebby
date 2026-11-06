# Keep agents on the laptop from changing production

Design, 2026-11-06. Status: draft for Dorell's review.

## Why

Dorell's concern (2026-11-05): "my current local setup I think points to prod db. Agents can make mistakes while doing their job."

What was on the laptop (checked 2026-11-05, values never printed):

| Where | What | Reaches |
|---|---|---|
| `apps/pwa/.env` | `SUPABASE_SERVICE_ROLE_KEY`, `DB_PASSWORD`, `TYPESENSE_ADMIN_KEY`, prod URL | read and write every prod table; the search index |
| `apps/admin/.env` | prod URL + `SUPABASE_SERVICE_ROLE_KEY` | read and write every prod table |
| `services/core`, `services/luma` | `supabase link`ed to prod; the CLI is logged in through the browser (a full-access token in the keychain) | `db reset --remote --yes` wipes prod; `db push --remote` applies any migration; the token can delete projects |
| `services/core/scripts/.env.migration` | service-role keys and DB passwords for v1, prod and the old dev project, a Supabase access token, R2 image keys | everything |
| `apps/web/.env.local` (legacy v1 site) | v1 service-role key | v1, which still holds the Facebook tokens |

Prod has had nightly backups since #110, so a mistake can now be undone. This design is about preventing one in the first place. It follows the principle from the AI-native SDLC playbook: "the agent may act up to the production gate and cannot pass it."

## Decisions so far

Made by Dorell:
- **A:** keep a copy of every secret in 1Password.
- **C:** day-to-day work runs on local data, and nothing on disk can write to prod.
- **Agents keep read-only access to prod**, to check deploys and diagnose problems.
- **1Password Credential Broker for GitHub Actions:** later, not in this project.

Proposed by me, and not objected to:
- **The admin app keeps working against prod**, with its key loaded through `op run`, so starting it needs Dorell's Touch ID.

## Goals

1. **No prod write access on disk.** No file on the laptop holds a credential that can change prod data, prod schema or the Supabase project. Every such credential sits in 1Password, behind Touch ID.
2. **Agents can still read prod**, including function logs, without asking Dorell.
3. **PWA development runs on local data:** a recent backup in a local Supabase, with prod secrets and other people's personal data removed.
4. **The admin app still manages prod**, after a Touch ID prompt.
5. **Prod secrets that sat in plain-text files** (which agents have read) are rotated.

## Non-goals

- CI secrets. GitHub repo secrets stay; Credential Broker comes later (Public Preview, needs a 1Password Business account).
- The Cloudflare (`wrangler`) login and the GitHub CLI token. Both reach prod-adjacent systems; they're a later, separate step.
- Deploying the admin app anywhere.
- Prod's own security (RLS, anon RPCs). The exception is the one function named in §2.

## Anti-goals (would count as failure even if everything technically works)

- `pnpm dev` for the PWA needs Touch ID or gets slower to start.
- Agents can no longer verify a deploy or read function logs.
- A local copy of prod data holds the Facebook page tokens or `app_secrets`. With those present, a local edit to an event would call prod: the Typesense sync trigger posts to a hard-coded prod URL with the token from `app_secrets`.
- A secret reaches the public repo, a public CI log, or a migration.

## Design

### 1. 1Password layout (Dorell sets this up; the builder supplies the exact list)

Two vaults, split by blast radius:
- **Cebby Prod**: anything that can change prod.
- **Cebby Dev**: things safe to lose.

Use one item per service with fields named for their use, and a note on each saying where the value is used and how to rotate it.

- **Cebby Prod**
  - Supabase cebby-v2: `service_role_key`, `db_password`, `full_access_token`
  - Typesense: `admin_key`
  - R2 images: `access_key_id`, `secret_access_key`
  - R2 backups (read-only token, for the local refresh in §3)
  - Admin: `admin_password`
  - Supabase v1: its keys and password
- **Cebby Dev**
  - Supabase reader: `password`, `scoped_token`
  - Typesense: `search_key`
  - Google Maps, Logto app ID, Notion

Prerequisite for every deletion below: Dorell has attached the four env files from the table above to a 1Password item, or copied their values into the items.

### 2. Read-only access to prod for agents

**A database role `cebby_reader`,** created by a migration, without a password.
- Dorell sets the password in the dashboard SQL editor (`alter role cebby_reader password '…'`), so it never appears in the repo.
- `alter role … set default_transaction_read_only = on` and a `statement_timeout` (30 s) act as seatbelts.

**Read-only is enforced by privileges, not by that default.** Any session can switch the default off, so the role must be given nothing it could write with:
- `USAGE` on schemas `public`, `cron`, `net` and `supabase_migrations`.
- `SELECT` on every table and view in `public`, except four:
  - `app_secrets` and `account_secrets`, which hold secrets;
  - `profiles` and `event_registrations`, which hold people's personal data.
- `SELECT` on `cron.job`, `cron.job_run_details`, `net._http_response` and `supabase_migrations.schema_migrations`.
- No `private` schema access. The public wrappers (`get_scraper_status`, `get_scraper_history`) already expose what `/status` shows.
- No default privileges. A new table stays unreadable until a migration grants it, so a future secrets table isn't exposed by accident.

**The one write path left** is `public.fan_out_account_syncs`.
- It's `SECURITY DEFINER`, executable by `PUBLIC`, and queues outbound HTTP requests. The public anon key can already call it, so the reader adds no new exposure.
- Infra roadmap item #4 is to move it to `private` and repoint the three cron jobs. Do that here, so "read-only" is true.
- Don't fix it with `REVOKE EXECUTE … FROM anon`. A call to a revoked function crashes Postgres on Supabase's image (memory: supautils segfault); moving to `private` is the known-safe way.
- The other `SECURITY DEFINER` functions in `public` only read (`get_scraper_*`) or can't be called directly (`notify_typesense_event_change`, `rls_auto_enable`).

**Unverified: whether the pooler accepts the role.** The session pooler (Supavisor, `aws-1-ap-southeast-1.pooler.supabase.com:5432`) should accept a custom role as user `cebby_reader.<project-ref>`. Prove that first. The direct database host is IPv6-only on this plan. If the pooler refuses, stop and report back. Don't loosen any grant, and don't hand agents a stronger credential instead.

**A pgTAP test proves the boundary.** As `cebby_reader`, it must be able to:
- read `events`, `accounts`, `cron.job` and a health view,

and must be refused on:
- `app_secrets`, `account_secrets` and `profiles`,
- any `INSERT`, `UPDATE` or `DELETE`,
- writes after `set transaction_read_only = off`,
- calling `fan_out_account_syncs`, once it has moved.

**A scoped Supabase access token for agents,** read-only, for this project only:
- **Permissions:** Logs, Projects, Edge Functions, Edge Function Secrets (names and hashes only), Connection Pooling and Backups, all at Read. These are the permission names in Supabase's PAT docs; check the Backups name there, since that's the one I haven't seen yet.
- **Login:** run `supabase logout`, then `supabase login --token <scoped>`, so the keychain holds the scoped token. The full-access token moves to 1Password Prod, for the rare `op run` when Dorell needs one.
- **Expected effect:** from the laptop, `functions deploy`, `db push`, `secrets set` and project deletion all fail. CI still does them.

**Where agents find the reader connection:** a file outside the repo, `~/.config/cebby/prod-reader.env`, holding:
- the `PGHOST`, `PGPORT` and `PGDATABASE` of the session pooler,
- `PGUSER=cebby_reader.enwcrupzidbcwimyttla` and `PGPASSWORD`,
- a note that the scoped token is the CLI login.

It's readable by agents on purpose: the worst an agent can do with it is read.

**Agent notes that must change:** memory notes and `ARCHITECTURE.md` currently tell agents to use `DB_PASSWORD` from `apps/pwa/.env` and the keychain login. Point them at the reader file instead.

### 3. Local data for PWA development

**A script refreshes a local database on demand** (e.g. `scripts/local-db/refresh.sh`, run as `op run --env-file=… -- scripts/local-db/refresh.sh`, so it needs Touch ID for the R2 backups token). It:
1. Downloads the newest complete `nightly/` backup (one that has `manifest.json`) from R2 and checks the files against the manifest's sha256s.
2. Restores it with `scripts/db-backup/restore.sh` into a dedicated local stack. That stack is not the `services/core` one, which pgTAP and migration work reset. It needs the API as well as the database (`supabase start`, not `db start`), because the PWA talks to PostgREST.
3. **Scrubs prod-only data** in the same session:
   - empties `app_secrets` and `account_secrets`,
   - deletes `profiles` and `event_registrations` rows other than Dorell's own, matched by his Logto user ID, which is configured in the script's env.
4. Checks the result: no cron jobs (`restore.sh` adds none by default), `app_secrets` empty, events present.

**The PWA's `.env` switches to local values:**
- the local URL, anon key and service-role key;
- the Typesense host plus the read-only search key. Search still reads the prod index, which is fine for development;
- the Maps key, Logto app ID and Notion, all low risk.

The PWA's dev server reads server-side values directly from `.env`, and shell variables don't override them (memory: PWA dev env gotchas). So `.env` must hold real values. Under C, those are all local or low-risk.

**`TYPESENSE_ADMIN_KEY`** is required by the env schema (`apps/pwa/astro.config.mjs`), but no page uses the admin client (`src/lib/typesense-node.ts` isn't imported). Make it optional in the schema, or use a placeholder (builder's call), and take the real key off the laptop. The deployed worker gets it from Cloudflare's own secrets.

**Prod-maintenance scripts** (`apps/pwa/src/scripts/backfill-coords.ts`, `sync-typesense-standalone.ts`) target prod on purpose. Run them through `op run` with Prod references, or from CI as `sync-typesense.yml` already does. Document which.

### 4. The admin app against prod, behind Touch ID

`apps/admin/.env` holds only references for its secrets:
- `SUPABASE_SERVICE_ROLE_KEY="op://Cebby Prod/Supabase cebby-v2/service_role_key"`
- `ADMIN_PASSWORD` as a reference too
- plain values for `PUBLIC_SUPABASE_URL` and `PUBLIC_PWA_ORIGIN`

A script `dev:prod` runs `op run --env-file=.env -- pnpm dev`.

**Check first (spike):** does the admin dev server (Astro, Node adapter) take `import.meta.env.SUPABASE_SERVICE_ROLE_KEY` from the process environment that `op run` sets, or from the `.env` file it parses itself? If it takes the file, it would get the literal `op://` string, and a different loader is needed. Possible fallbacks:
- read the value in `src/lib/supabase.ts` from `process.env`;
- `op inject` into a temporary file deleted on exit. This is weaker: the file exists while the app runs.

**1Password's CLI approval** covers one terminal tab and its sub-shells. It lapses after 10 minutes idle, 12 hours at most. Each other tab needs its own approval. So admin runs in its own tab, and a Touch ID prompt Dorell didn't start himself gets declined. Say this in the admin README.

### 5. Cleanup

Once §1's prerequisite is met and §2 to §4 work:
- Run `supabase unlink` in `services/core` and `services/luma`. A bare `--remote` then has no target.
- Delete `services/core/scripts/.env.migration` and `apps/web/.env.local`.
- Remove the prod `SUPABASE_SERVICE_ROLE_KEY`, `DB_PASSWORD` and `TYPESENSE_ADMIN_KEY` from `apps/pwa/.env`.
- Check that no file under `~/Projects/cebby*` holds any prod write credential. Compare SHA-256 hashes of every env value against the prod secrets' hashes and the known prod values, the way the 2026-11-05 check did, and print no values.

### 6. Rotation (Dorell, in the dashboards; the builder writes the checklist)

Agents have read these in plain text, so after the laptop is clean:
- **Prod database password:** reset it, then update the `DB_PASSWORD` GitHub secret. The backup workflow and deploys use it.
- **Typesense admin key:** create a new one, update the Supabase function secret, the GitHub secret and Cloudflare's PWA secret, then delete the old key.
- **R2 image keys:** roll them in Cloudflare and update the Supabase function secrets.
- **Supabase full-access token:** revoke the browser-login token once the scoped token works.
- **Service-role key: deferred.** It's a legacy JWT, and rotating its secret also invalidates the anon key the PWA ships. Do it with a move to Supabase's newer API keys, as a separate step.

## Verification ("done" means each of these was observed)

- **The reader role:**
  - It connects through the session pooler.
  - It can read `events`.
  - It's denied on `app_secrets`, `profiles`, any write, and a write after `set transaction_read_only = off`.
  - pgTAP passes locally.
  - On prod after deploy, check by hand with `psql` as `cebby_reader`: one allowed read and each denial. Don't run pgTAP on prod, because it opens a writing transaction there.
- **From the laptop with the scoped token:**
  - Logs and the function list are readable.
  - `supabase secrets set` and `functions deploy` are refused.
  - `db push --remote=<ref>` fails, because there's no password on disk.
- **The local refresh:**
  - It restores the newest nightly backup.
  - `app_secrets` and `account_secrets` are empty, and only Dorell's profile remains.
  - Editing an event locally makes no request to prod (the sync trigger logs that `internal_fn_jwt` isn't set).
- **PWA `pnpm dev`:**
  - It starts with no prompt.
  - The home page, search and an event page all work on local data.
  - The dev server's requests go to the local stack.
- **Admin `pnpm dev:prod`:**
  - Touch ID prompts, then the pages load prod data.
  - An `op read` from a different tab prompts again.
- **No prod write credential remains** on disk (the hash check in §5).
- **Backups still pass** (the nightly run after the changes).

## Order (each step ends usable)

1. **Dorell:** 1Password items (A). Nothing is deleted before this.
2. **Reader role.** A migration (with `fan_out_account_syncs` moved to `private`), pgTAP, the reader file, and updated agent notes. One PR. Merging it deploys the migration. Dorell then sets the reader's password.
3. **Scoped token.** Log the CLI in with it; the full-access token goes to 1Password.
4. **Local data.** The refresh script, the dedicated local stack and the PWA `.env` switch. One PR (script and schema change); the `.env` edit is local.
5. **Admin `op run`.** The spike, then one PR.
6. **Cleanup** (§5) and the hash check.
7. **Rotation** (§6).

## Left to the builder

- Script names and locations, the local stack's project ID and ports, and how the refresh finds Dorell's Logto user ID.
- The exact grant list, within §2's rules.
- 1Password item and field names, within §1's split.
- Whether `TYPESENSE_ADMIN_KEY` becomes optional or gets a placeholder.

## Later (not this project)

- 1Password Credential Broker for GitHub Actions, once it's generally available and if a Business account is in place.
- Limiting the Cloudflare `wrangler` login and the GitHub CLI token on the laptop.
- Restricting the Google Maps key by HTTP referrer, since it's billed.
- Moving to Supabase's newer API keys, then rotating the service-role key.
