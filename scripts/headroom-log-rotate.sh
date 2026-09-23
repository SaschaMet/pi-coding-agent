#!/usr/bin/env bash
#
# headroom-log-rotate.sh — rotate the Headroom proxy log (proxy.log).
#
# The proxy opens the log fresh for every entry (request_logger.py at v0.38.0),
# so a plain rename is safe: no restart, no lost writes.
#
# Usage:
#   scripts/headroom-log-rotate.sh          # rotate inside the running headroom container (cron default)
#   scripts/headroom-log-rotate.sh DIR      # rotate files directly in DIR (tests)
#
# Weekly cron: 0 12 * * 1 (Monday 12:00 — host is reliably on then)
#
set -uo pipefail

log()  { echo "headroom-log-rotate: $*"; }
warn() { echo "headroom-log-rotate: $*" >&2; }

# Rotate inside one directory: drop the 5th rotated file, shift proxy.log.N to
# N+1, move the live log to proxy.log.1. POSIX sh so the same snippet runs
# locally (tests) and inside the container (docker exec).
ROTATE_SH='
set -eu
cd "$1"
rm -f proxy.log.4
i=3
while [ "$i" -ge 1 ]; do
  if [ -f "proxy.log.$i" ]; then mv "proxy.log.$i" "proxy.log.$((i + 1))"; fi
  i=$((i - 1))
done
if [ -f proxy.log ]; then mv proxy.log proxy.log.1; fi
'

if [[ $# -ge 1 ]]; then
  # Local directory mode (tests): deterministic, no Docker.
  if [[ ! -d "$1" ]]; then
    warn "no such directory: $1 — nothing to rotate."
    exit 0
  fi
  sh -c "$ROTATE_SH" _ "$1"
  log "rotated $1 (keeping 4 rotated files)."
  exit 0
fi

# Container mode (cron default): rotate the live log inside the headroom container.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx headroom; then
  warn "headroom container not running — nothing to rotate."
  exit 0
fi
docker exec headroom sh -c "$ROTATE_SH" _ /home/nonroot/.headroom
log "rotated /home/nonroot/.headroom (keeping 4 rotated files)."
