# Oracle Cloud deployment

Assumes: an Oracle Cloud VM (Ubuntu), Node 22.x, and this repo cloned to
`/opt/tripprice`. Nothing here has been run against a real server yet.

## PM2 vs Docker: PM2

`web/next.config.mjs` has the app import `../src` directly
(`outputFileTracingRoot: process.cwd() + "/.."`, `@core/*` -> `../src/*`),
and the price-refresh CLI (`src/cli/index.ts`) is a separate root-level
project that isn't part of the Next.js app at all. Both need the same repo
checkout and the same Node runtime on the same box; Docker would mean
either one image built from a repo-root context (awkward multi-stage
build for a two-`package.json` layout that was never split into packages)
or two images sharing a mounted volume - complexity with no payoff for a
single-VM, single-operator deploy. PM2 runs both the web app and (via cron,
below) the CLI directly from the checkout, with process supervision,
log capture, and reboot persistence, for a fraction of the moving parts.

## Production env vars

Two separate files - see the checked-in `.example` templates for the
full list with comments:

- `web/.env.production` (from `web/.env.production.example`) - read
  automatically by `next build`/`next start`. Needs `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` (optional), `ADMIN_USER`/`ADMIN_PASSWORD`,
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, `applicationId`/`accessKey`
  (Rakuten), `COUPANG_PARTNERS_ACCESS_KEY`/`COUPANG_PARTNERS_SECRET_KEY`.
- `.env` at repo root (from `.env.example`) - read by the CLI via
  `dotenv/config` when cron runs it. Same backend vars minus the
  `NEXT_PUBLIC_*`/`ADMIN_*` ones, which the CLI never touches.

Both are gitignored; never commit the real files.

## Build / start

Standard Next.js production flow, no config changes needed:

```
cd /opt/tripprice/web
npm ci
npm run build   # next build
npm run start   # next start -p 3000 (via PM2 below, not run directly)
```

PM2 owns the actual `next start` process - see `deploy/ecosystem.config.js`
(edit `REPO_DIR` in that file if the checkout path isn't `/opt/tripprice`).

## Nginx reverse proxy

`deploy/nginx/tripprice.conf` proxies `:80` -> `127.0.0.1:3000`. Replace
`your-domain.example` with the real domain before installing. Add HTTPS
afterwards with certbot (`certbot --nginx`) once DNS is pointed at the box.

## Auto-start after reboot

- Web app: `pm2 startup` (generates + enables a systemd unit that runs
  `pm2 resurrect` on boot) + `pm2 save` (snapshots the currently running
  process list, including `tripprice-web`, so resurrect brings it back).
- Nginx: `systemctl enable nginx` (standard package default on Ubuntu,
  confirm it's actually enabled).
- Cron: crontab entries persist across reboots on their own - no extra step.

## Price refresh job

`deploy/refresh-cron.sh` runs the same CLI commands an operator would run
by hand (`npm run cli -- refresh --source=rakuten`, `--source=coupang`,
then `stale-sweep`), logging to `/opt/tripprice/logs/refresh.log`.
`deploy/crontab.txt` schedules it every 6 hours - adjust the interval
based on observed API rate limits once it's been running for a while.
This is intentionally NOT the admin page's "전체 refresh 실행" button (that
stays as the manual/on-demand path); cron covers the unattended baseline.

## Post-deploy checklist

Verify with the real domain once DNS + Nginx + PM2 are all up:

- `/` - homepage loads, product cards render
- `/products/<id>` - a real variant id from Supabase, price comparison
  renders
- `/sitemap.xml` - non-empty only if `NEXT_PUBLIC_SITE_URL` is set;
  otherwise returns an empty sitemap by design (see `app/sitemap.ts`)
- `/robots.txt` - `disallow: /admin`, and a `Sitemap:` line only when
  `NEXT_PUBLIC_SITE_URL` is set

## Command sequence (run on the server)

```bash
# 1. OS packages
sudo apt update && sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# 2. Oracle Cloud specific: open the port BEFORE testing from outside -
#    both layers, or it'll look "stuck" with no error:
#      a) VCN Security List / Network Security Group: add ingress 80/tcp
#         (and 443/tcp) from 0.0.0.0/0 in the OCI console
#      b) the VM's own firewall:
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save   # or: sudo iptables-save > /etc/iptables/rules.v4

# 3. Get the code
sudo mkdir -p /opt/tripprice && sudo chown $USER:$USER /opt/tripprice
git clone <repo-url> /opt/tripprice
cd /opt/tripprice
mkdir -p logs

# 4. Env files (fill in real values, then lock down perms)
cp .env.example .env && chmod 600 .env
cp web/.env.production.example web/.env.production && chmod 600 web/.env.production

# 5. Install deps
npm ci
cd web && npm ci && npm run build && cd ..

# 6. Start the web app under PM2
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup   # then run the one-line sudo command it prints

# 7. Nginx
sudo cp deploy/nginx/tripprice.conf /etc/nginx/sites-available/tripprice.conf
sudo ln -s /etc/nginx/sites-available/tripprice.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable nginx
# once DNS points at this box:
sudo certbot --nginx -d your-domain.example

# 8. Price refresh cron
chmod +x deploy/refresh-cron.sh
(crontab -l 2>/dev/null; cat deploy/crontab.txt) | crontab -
crontab -l   # verify

# 9. Verify
curl -I https://your-domain.example/
curl -I https://your-domain.example/sitemap.xml
curl -I https://your-domain.example/robots.txt
```
