#!/usr/bin/env bash
# Send the latest commit to the server and restart it. Run from your Mac:
#   deploy/deploy.sh ubuntu@SERVER_IP                     update the code
#   deploy/deploy.sh ubuntu@SERVER_IP https://your.site   first time, or when .env changed
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:?Usage: deploy/deploy.sh user@server [public url]}"
PUBLIC_URL="${2:-}"

if ! git diff --quiet HEAD; then
  echo "You have uncommitted changes. Only the last commit gets deployed." >&2
fi

ssh "$HOST" 'sudo bash -s' < deploy/setup-server.sh

if [ -n "$PUBLIC_URL" ]; then
  # Your .env, minus what the server must not have, plus the live settings
  { grep -vE '^(GOOGLE_CLIENT_SECRET|PORT|HOST|NODE_ENV|COOKIE_SECURE|TRUST_PROXY|DATA_DIR|PUBLIC_URL|SHOW_IP_CHECK)=' .env
    printf '%s\n' 'PORT=3000' 'HOST=127.0.0.1' 'NODE_ENV=production' 'COOKIE_SECURE=true' 'TRUST_PROXY=1' \
      'DATA_DIR=/var/lib/mathlens' 'SHOW_IP_CHECK=true' "PUBLIC_URL=${PUBLIC_URL}"
  } | ssh "$HOST" 'sudo install -o root -g mathlens -m 640 /dev/stdin /etc/mathlens.env'
fi

git archive HEAD | ssh "$HOST" 'sudo tar -x -C /opt/mathlens'
ssh "$HOST" 'set -e
  cd /opt/mathlens
  sudo env PATH=/usr/local/bin:$PATH npm ci --omit=dev --no-audit --no-fund
  sudo cp deploy/mathlens.service deploy/mathlens-backup.service deploy/mathlens-backup.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now mathlens-backup.timer
  sudo systemctl enable mathlens
  sudo systemctl restart mathlens
  sleep 2
  curl -fsS http://127.0.0.1:3000/healthz && echo " MathLens is running."'
