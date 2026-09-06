# Google Cloud Run deployment (Seoul / asia-northeast3 + Supabase)

Replaces the Oracle Cloud PM2/Nginx plan (`deploy/README.md`, kept only for
reference - not used going forward). Two Cloud Run resources, same
Supabase project as before:

- **Cloud Run service** - the Next.js web app (`deploy/gcp/Dockerfile.web`).
- **Cloud Run Job** - the price-refresh CLI (`deploy/gcp/Dockerfile.job`),
  triggered on a schedule by Cloud Scheduler instead of cron.

**Status: the web service is live.** `deploy/gcp/Dockerfile.web` has since
been rewritten (multi-stage `deps`/`builder`/`runner`, reconstructed from
the actually-deployed image's registry manifest - see the file's own
header comment for how) and is built via `deploy/gcp/cloudbuild.web.yaml`
+ `.github/workflows/build.yml`/`deploy-production.yml` (WIF-based GitHub
Actions, no service-account keys) rather than the manual `docker build`
commands below - those still work for a local sanity check, but production
now deploys through the GitHub Actions pipeline. Sections 1-5 below (env
vars, deployment order) describe the general shape and are still broadly
accurate; the "Local Docker build verification" build commands are now
superseded by CI. **The Cloud Run Job + Cloud Scheduler piece (this repo's
`Dockerfile.job`/`refresh-job.sh`) has not been deployed yet** - still
accurate as a plan, not yet run against real GCP resources.

## What changed in the repo for this

- `web/next.config.mjs` - added `output: "standalone"` so the Next build
  produces a self-contained server bundle (small image, no `npm ci` needed
  inside the runtime container). Everything else (the `../src` import setup,
  `@core/*` alias, image remote patterns) is unchanged.
- `.dockerignore` (repo root) - new.
- `deploy/gcp/Dockerfile.web`, `deploy/gcp/Dockerfile.job`,
  `deploy/gcp/refresh-job.sh` - new.

SEO (`web/app/lib/seo.ts`), GA4 (`web/app/lib/analytics.ts`), and the
Supabase repository layer (`src/repository/supabase/*`) are untouched -
they already read plain env vars, which Cloud Run supplies the same way
`next start`/cron did.

## Local Docker build verification

Docker is not installed in the environment this was prepared in (`docker`
not found via bash or PowerShell), so the builds below have **not**
actually been run - only reviewed for correctness (multi-stage layering,
what `output: "standalone"` produces given `outputFileTracingRoot`,
`.dockerignore` coverage). Please run these locally before deploying:

```bash
# web app
docker build -f deploy/gcp/Dockerfile.web -t tripprice-web .
docker run --rm -p 8080:8080 --env-file web/.env.production tripprice-web
curl -I http://localhost:8080/

# refresh job
docker build -f deploy/gcp/Dockerfile.job -t tripprice-refresh-job .
docker run --rm --env-file .env tripprice-refresh-job
```

If `next build` fails inside the image on missing types/env, that'll
surface immediately in `docker build` output.

## Production env vars

### Cloud Run service (web) - same values as `web/.env.production.example`

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Cloud Run URL or custom domain, no trailing slash |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | optional, unset disables GA4 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | required in prod, gates `/admin/*` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | service-role, server-only |
| `applicationId` / `accessKey` | Rakuten, used by the admin refresh-all button |
| `COUPANG_PARTNERS_ACCESS_KEY` / `COUPANG_PARTNERS_SECRET_KEY` | Coupang |

Do **not** set `PORT` - Cloud Run injects it (8080) and reserves the name.

### Cloud Run Job (refresh CLI) - same values as root `.env.example`

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Plus, source-specific only -
a Rakuten Job needs `applicationId`/`accessKey` and NOT the Coupang pair; a
Coupang Job needs `COUPANG_PARTNERS_ACCESS_KEY`/`COUPANG_PARTNERS_SECRET_KEY`
and NOT the Rakuten pair (`parseScheduledRefreshJobEnv()` in
`src/services/refreshJobService.ts` fails fast at startup if the active
source's own credentials are missing - it does not require the other
source's). Also required: `SOURCE` (`rakuten` or `coupang` - one Job
resource per source) and, for a controlled first run, `LIMIT`. No
`NEXT_PUBLIC_*`/`ADMIN_*` - the CLI never touches those.
`CLOUD_RUN_EXECUTION` is set automatically by the Cloud Run Jobs runtime,
never configured manually.

Set both sets of vars via `--set-env-vars` for non-secrets and
`--set-secrets` (Secret Manager) for the Supabase/Rakuten/Coupang
credentials and `ADMIN_PASSWORD` - don't bake real values into the image or
commit them.

## Price refresh: Cloud Run Job + Cloud Scheduler

`deploy/gcp/Dockerfile.job` packages `src/` only and runs
`deploy/gcp/refresh-job.sh`, which now runs a single command -
`scheduled-refresh` (`src/cli/index.ts`) - instead of the old direct
`refresh --source=... --limit=50` (x2) + `stale-sweep` sequence this
originally shipped with. `scheduled-refresh` runs the full orchestration in
`src/services/refreshJobService.ts`: validate config -> acquire a DB-backed
lease (`refresh_lock`, see `supabase/migrations/0008_refresh_lock.sql` -
must be applied before this Job is ever created, see "Deployment order"
below) -> compute a 5.5h `checkedBefore` cutoff -> refresh due listings for
exactly one source (with ~1s pacing between Rakuten requests specifically -
see `RAKUTEN_BATCH_PACING_MS`) -> aggregate outcome -> structured JSON log
-> release the lease. `SOURCE`/`LIMIT` are read from the container's own
env, not hardcoded in the script - each Job resource/execution is meant to
be configured for exactly one source. `stale-sweep` is intentionally not
part of this Job - a separate, DB-only concern for its own future schedule
if/when it's wired up. Cloud Run Jobs capture stdout/stderr to Cloud
Logging automatically.

Cloud Scheduler calls the Cloud Run Jobs REST API's `:run` endpoint on a
cron schedule (OIDC auth, a service account with the `roles/run.invoker`
role on the job) - same `0 */6 * * *` cadence as `deploy/crontab.txt`,
adjustable later the same way the old README suggested.

## Deployment order (not run yet)

1. `gcloud auth login`, `gcloud config set project <PROJECT_ID>`, `gcloud config set run/region asia-northeast3`.
2. Enable APIs: `run.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com`, `cloudscheduler.googleapis.com`.
3. Create an Artifact Registry Docker repo in `asia-northeast3`.
4. Put secrets (Supabase, Rakuten, Coupang, `ADMIN_PASSWORD`) into Secret Manager.
5. Build + push the web image (Cloud Build or local `docker build` + `docker push`), then `gcloud run deploy` the service with the env vars/secrets above.
6. Build + push the job image, then `gcloud run jobs deploy` with its env vars/secrets.
7. Create the Cloud Scheduler job targeting the Cloud Run Job's `:run` endpoint, OIDC service account with `run.invoker` on the job, schedule `0 */6 * * *`, timezone `Asia/Seoul`.
8. Point `NEXT_PUBLIC_SITE_URL` at the Cloud Run URL (or a mapped custom domain) and redeploy the service if it changed.
9. Verify: `/`, `/products/<real-variant-id>`, `/sitemap.xml`, `/robots.txt` - same checklist as the old Oracle README - plus trigger the Cloud Run Job manually once (`gcloud run jobs execute`) and check Cloud Logging for the three CLI commands succeeding.
