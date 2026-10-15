#!/usr/bin/env bash
# Deploys the dashboard on the VPS: pull main, reinstall packages when
# package-lock.json changed, restart the service, print the running commit.
#
# GitHub Actions (.github/workflows/deploy.yml) runs this over SSH after every
# push to main. Its key is pinned to this script in ~/.ssh/authorized_keys
# (command="bash /var/www/mww-dashboard-app/scripts/deploy.sh",restrict ...),
# so that key cannot run anything else. Running it by hand is fine too.
#
# Everything sits in main() so bash has read the whole script before
# `git pull` can rewrite this file.
set -euo pipefail

main() {
  local app_dir=/var/www/mww-dashboard-app
  local service=mww-dashboard

  cd "$app_dir"
  local before after
  before=$(git rev-parse HEAD)
  git pull --ff-only --quiet origin main
  after=$(git rev-parse HEAD)
  if [ "$before" = "$after" ]; then
    echo "already at $after"
  else
    echo "pulled ${before:0:7}..${after:0:7}"
  fi

  if ! git diff --quiet "$before" "$after" -- package-lock.json; then
    echo "package-lock.json changed: npm ci"
    npm ci --omit=dev --no-audit --no-fund
  fi

  sudo -n systemctl restart "$service"
  sleep 3
  if ! systemctl is-active --quiet "$service"; then
    echo "$service did not stay up after the restart"
    journalctl -u "$service" -n 30 --no-pager || true
    exit 1
  fi
  echo "deployed $after"
}

main "$@"; exit
