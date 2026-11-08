#!/usr/bin/env bash
# Downloads a backup, decrypts it to ~/mathlens-restore/ and checks it. Doesn't touch the live site.
#   deploy/restore-backup.sh                                  newest backup
#   deploy/restore-backup.sh mathlens-2026-11-08T....db.age   a specific one
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
REPO="${BACKUP_GITHUB_REPO:-samyakbaid/mathlens-backups}"
KEY="${BACKUP_KEY:-$HOME/.config/mathlens/backup-key.txt}"
OUT="$HOME/mathlens-restore"
[ -f "$KEY" ] || { echo "Backup key not found at $KEY" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
gh repo clone "$REPO" "$work/repo" -- --quiet --depth 1
name="${1:-$(ls "$work/repo/backups" | sort | tail -1)}"
[ -f "$work/repo/backups/$name" ] || { echo "Backup not found: $name" >&2; exit 1; }

umask 077
mkdir -p "$OUT"
rm -f "$OUT/mathlens.db"
age -d -i "$KEY" -o "$OUT/mathlens.db" "$work/repo/backups/$name"
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[1], { readOnly: true });
const n = (t) => d.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
console.log('Integrity:', d.prepare('PRAGMA integrity_check').get().integrity_check);
console.log('Users:', n('users'), '| Lessons:', n('lessons'), '| Payments:', n('payments'));
" "$OUT/mathlens.db"
echo "Restored $name to $OUT/mathlens.db"
echo "This file holds customer data. Delete it when you're done."
