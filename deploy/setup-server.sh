#!/usr/bin/env bash
# One-time setup for an Ubuntu server (x86 or ARM). Safe to run again. Run as root (deploy.sh does this).
set -euo pipefail

NODE_VERSION=25.9.0
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64; DEB_ARCH=amd64 ;;
  aarch64) NODE_ARCH=arm64; DEB_ARCH=arm64 ;;
  *) echo "Unsupported processor: $(uname -m)" >&2; exit 1 ;;
esac
TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"

# Small servers need swap, or installing packages can run out of memory
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -y
apt-get install -y curl xz-utils unattended-upgrades libatomic1
systemctl enable --now unattended-upgrades

# Node, checked against the official checksums
if [ "$(/usr/local/bin/node -v 2>/dev/null || true)" != "v${NODE_VERSION}" ]; then
  work="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}" -o "${work}/${TARBALL}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${work}/SHASUMS256.txt"
  (cd "${work}" && grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "${work}/${TARBALL}" -C /usr/local --strip-components=1
  rm -rf "${work}"
fi

# The app runs as its own user, which can only write to its data and backup folders
id mathlens >/dev/null 2>&1 || useradd --system --home /var/lib/mathlens --shell /usr/sbin/nologin mathlens
install -d -o mathlens -g mathlens -m 700 /var/lib/mathlens /var/backups/mathlens
install -d -o root -g root -m 755 /opt/mathlens

# Cloudflare's tunnel program (connected later with the token from Cloudflare's dashboard)
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${DEB_ARCH}.deb
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi
echo "Server setup finished."
