#!/usr/bin/env bash
# Read-only Oracle Cloud server precheck - Step 1 of deploy/README.md.
# Does NOT install, clone, build, or change any config. Just prints
# current state so we can decide what (if anything) is missing before
# running the real command sequence.
#
# Usage: copy this file to the server (or paste its contents) and run:
#   bash precheck.sh
set -uo pipefail

section() { echo; echo "===== $1 ====="; }

section "OS / architecture"
if [ -f /etc/os-release ]; then cat /etc/os-release; fi
uname -a

section "Node / npm"
if command -v node >/dev/null 2>&1; then
  echo "node: $(node -v)"
else
  echo "node: NOT FOUND"
fi
if command -v npm >/dev/null 2>&1; then
  echo "npm: $(npm -v)"
  echo "npm path: $(command -v npm)"
else
  echo "npm: NOT FOUND"
fi

section "Git"
if command -v git >/dev/null 2>&1; then
  git --version
else
  echo "git: NOT FOUND"
fi

section "Nginx"
if command -v nginx >/dev/null 2>&1; then
  nginx -v 2>&1
  systemctl is-active nginx 2>&1
  systemctl is-enabled nginx 2>&1
else
  echo "nginx: NOT FOUND"
fi

section "PM2"
if command -v pm2 >/dev/null 2>&1; then
  pm2 -v
else
  echo "pm2: NOT FOUND"
fi

section "Ports 80/443"
if command -v ss >/dev/null 2>&1; then
  sudo ss -tlnp 2>/dev/null | grep -E ':80|:443' || echo "(nothing currently listening on 80/443)"
else
  echo "ss not available"
fi

section "OS firewall rules (80/443)"
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -L INPUT -n 2>/dev/null | grep -E '80|443' || echo "(no explicit 80/443 iptables rule found)"
elif command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --list-all 2>/dev/null
fi
echo "NOTE: this only shows the VM's own firewall. The OCI VCN Security"
echo "List / Network Security Group ingress rules must be checked"
echo "separately in the OCI console - this script cannot see those."

section "Disk / RAM"
df -h /
echo
free -h

section "Deploy path (/opt/tripprice)"
if [ -e /opt/tripprice ]; then
  echo "/opt/tripprice already exists:"
  ls -la /opt/tripprice
else
  echo "/opt/tripprice does not exist yet (expected before clone)"
fi
