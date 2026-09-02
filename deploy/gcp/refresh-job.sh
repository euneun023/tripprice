#!/bin/sh
# Runs inside the Cloud Run Job container (see Dockerfile.job). Same three
# CLI commands as the old Oracle cron path (deploy/refresh-cron.sh) - no
# separate refresh logic for Cloud Run vs. cron vs. a human running them by
# hand. Cloud Run Jobs capture stdout/stderr to Cloud Logging on their own,
# so (unlike refresh-cron.sh) there's no manual log-file redirection here.
set -eu

npx tsx src/cli/index.ts refresh --source=rakuten --limit=50
npx tsx src/cli/index.ts refresh --source=coupang --limit=50
npx tsx src/cli/index.ts stale-sweep
