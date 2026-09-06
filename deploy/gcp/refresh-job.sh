# Runs inside the Cloud Run Job container (see Dockerfile.job).
#
# Superseded the old direct `refresh --source=... --limit=50` (x2) +
# `stale-sweep` sequence - src/cli/index.ts's "scheduled-refresh" command
# now runs the full validate-config -> acquire-lease -> compute-cutoff ->
# refresh-due-listings -> summarize -> structured-log -> release-lease
# orchestration (src/services/refreshJobService.ts) instead. SOURCE/LIMIT
# are read from the environment by that command itself, not hardcoded here:
# each Job resource/execution is expected to be configured for exactly one
# source (Rakuten first; Coupang once its rate limit is confirmed via the
# partner console - see the automation design discussion this followed).
# CLOUD_RUN_EXECUTION is set automatically by the Cloud Run Jobs runtime,
# not by this script. stale-sweep is a separate, DB-only concern (no seller
# API call) intentionally left out of this Job - it belongs to its own
# schedule, not this one, if/when it's wired up.
#
# Cloud Run Jobs capture stdout/stderr to Cloud Logging on their own, so
# there's no manual log-file redirection here.
set -eu

npx tsx src/cli/index.ts scheduled-refresh
