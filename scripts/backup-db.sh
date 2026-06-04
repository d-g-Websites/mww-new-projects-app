#!/usr/bin/env bash
# Daily SQLite backup → private GitHub repo.
#
# Dumps the dashboard's projects.db to plain SQL text (so git can
# diff + dedupe + compress between days), copies the dump into a
# rolling daily snapshot folder (last 30 days), commits, pushes.
# No commit happens when the DB hasn't changed since the last
# backup — keeps the repo history meaningful.
#
# Cron entry (as mww-dash):
#   0 3 * * * /var/www/mww-dashboard-app/scripts/backup-db.sh >> /var/log/mww-backup.log 2>&1
#
# Restore:
#   git clone git@github.com:d-g-Websites/mww-dashboard-backups.git restore
#   sqlite3 /tmp/restored.db < restore/projects.sql
#   # Then copy /tmp/restored.db to /var/www/mww-dashboard-app/data/projects.db

set -euo pipefail

BACKUP_REPO="${BACKUP_REPO:-/var/backups/mww-db}"
DB_PATH="${DB_PATH:-/var/www/mww-dashboard-app/data/projects.db}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [[ ! -d "$BACKUP_REPO/.git" ]]; then
  log "ERROR: $BACKUP_REPO is not a git repo. Clone the backups repo there first."
  exit 1
fi
if [[ ! -f "$DB_PATH" ]]; then
  log "ERROR: DB file not found at $DB_PATH"
  exit 1
fi

DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Make sure local clone is up to date in case someone pushed
# (admin restoring on another machine, etc.) — prevents push
# rejection. Failures here aren't fatal; we proceed with what we
# have and let the push retry handle it.
cd "$BACKUP_REPO"
git fetch origin --quiet || log "git fetch failed (will try to push anyway)"
git reset --hard origin/master --quiet || true

# SQLite supports concurrent reads during a .dump even while the
# dashboard is live writing. The dump is a snapshot at start time.
sqlite3 "$DB_PATH" .dump > "$BACKUP_REPO/projects.sql"

# Rolling daily snapshot folder, last RETAIN_DAYS days.
mkdir -p "$BACKUP_REPO/daily"
cp "$BACKUP_REPO/projects.sql" "$BACKUP_REPO/daily/$DATE.sql"
find "$BACKUP_REPO/daily" -name "*.sql" -mtime +"$RETAIN_DAYS" -delete

# Drop a small README so the repo isn't bare.
cat > "$BACKUP_REPO/README.md" <<EOF
# MWW Dashboard DB Backups

Automated daily backups of the dashboard's SQLite database at
\`/var/www/mww-dashboard-app/data/projects.db\` on the VPS.

- \`projects.sql\` — most recent full dump, refreshed every backup run.
- \`daily/\` — rolling snapshots, last $RETAIN_DAYS days.

Last backup: $TIMESTAMP

## Restore

\`\`\`bash
git clone git@github.com:d-g-Websites/mww-dashboard-backups.git restore
sqlite3 /tmp/restored.db < restore/projects.sql
# Stop the dashboard, swap in the restored DB, restart:
sudo systemctl stop mww-dashboard
sudo -u mww-dash cp /tmp/restored.db /var/www/mww-dashboard-app/data/projects.db
sudo systemctl start mww-dashboard
\`\`\`

To restore a specific day instead of the most recent dump, use the
matching file from \`daily/YYYY-MM-DD.sql\`.
EOF

git add projects.sql daily/ README.md

if git diff --staged --quiet; then
  log "no changes since last backup — skipping commit"
  exit 0
fi

git commit -m "DB backup $TIMESTAMP" --quiet

# Retry push a few times on transient network errors.
for attempt in 1 2 3 4; do
  if git push origin master --quiet; then
    log "backup pushed (attempt $attempt)"
    exit 0
  fi
  log "push attempt $attempt failed, retrying in $((attempt * 5))s"
  sleep $((attempt * 5))
done

log "ERROR: backup committed locally but push failed after 4 attempts"
exit 1
