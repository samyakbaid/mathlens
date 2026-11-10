#!/usr/bin/env bash
# Prints how MathLens is being used on the live server. Read only.
# Usage: deploy/stats.sh ubuntu@130.210.7.218
set -euo pipefail
host="${1:?Usage: deploy/stats.sh ubuntu@your-server}"
cd "$(dirname "$0")"
ssh -o ConnectTimeout=15 "$host" 'sudo -u mathlens node --no-warnings - /var/lib/mathlens/mathlens.db' < stats.mjs
