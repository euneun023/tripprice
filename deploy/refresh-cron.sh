#!/usr/bin/env bash
# Periodic price refresh, meant to be run by cron (see deploy/crontab.txt).
# Re-checks every already-approved listing's price/availability on Rakuten
# and Coupang, then flags anything that's gone too long without a
# successful check. Reuses the exact same CLI commands as manual operator
# use (src/cli/index.ts) - no separate refresh logic for cron vs. human.
set -euo pipefail

# cron runs jobs with a minimal PATH (typically just /usr/bin:/bin) that
# won't reliably include node/npm depending on how they were installed -
# set it explicitly rather than assuming the interactive shell's PATH.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

REPO_DIR="/opt/tripprice"
LOG_DIR="$REPO_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$REPO_DIR"

{
  echo "===== $(date -u '+%Y-%m-%dT%H:%M:%SZ') ====="
  npm run cli -- refresh --source=rakuten --limit=50
  npm run cli -- refresh --source=coupang --limit=50
  npm run cli -- stale-sweep
} >> "$LOG_DIR/refresh.log" 2>&1
