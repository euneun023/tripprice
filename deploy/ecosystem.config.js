// PM2 process file for the Next.js web app.
//
// Only the process itself is defined here - secrets are NOT duplicated
// into this file. `next start` (run with cwd below) auto-loads
// web/.env.production, same as any other `next start` invocation.
//
// Usage (from repo root, after `npm ci && npm run build` inside web/):
//   pm2 start deploy/ecosystem.config.js
//
// REPO_DIR must match wherever the repo is actually checked out on the
// server (see deploy/README.md step "clone the repo").
const REPO_DIR = "/opt/tripprice";

module.exports = {
  apps: [
    {
      name: "tripprice-web",
      cwd: `${REPO_DIR}/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: `${REPO_DIR}/logs/web-out.log`,
      error_file: `${REPO_DIR}/logs/web-error.log`,
      time: true,
    },
  ],
};
