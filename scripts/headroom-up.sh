#!/usr/bin/env bash
#
# headroom-up.sh — ensure the Headroom compression proxy is running before a PI session.
#
# Idempotent and FAST: if the proxy already answers on /health it returns immediately.
# Otherwise it brings up the Docker container and waits briefly for health.
#
# Non-blocking by design: Headroom is an optimization, not a hard dependency. If Docker
# is missing or the proxy won't come up, this prints a warning and still exits 0 so your
# PI session launches anyway.
#
# Usage:
#   scripts/headroom-up.sh          # ensure up (used by the pi launcher / npm run headroom:up)
#   scripts/headroom-up.sh --quiet  # only print on problems
#
set -uo pipefail

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/headroom-compose.yml"
HEALTH_URL="http://127.0.0.1:8788/health"

log()  { [[ "$QUIET" -eq 1 ]] || echo "headroom-up: $*"; }
warn() { echo "headroom-up: $*" >&2; }

# health_ok — true if the proxy answers /health with HTTP 2xx
health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$HEALTH_URL" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2)
PY
  else
    return 1
  fi
}

# Fast path: already running.
if health_ok; then
  log "proxy already healthy at $HEALTH_URL"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found — skipping (PI will run without Headroom compression)."
  exit 0
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  warn "compose file not found at $COMPOSE_FILE — skipping."
  exit 0
fi

log "starting Headroom proxy via Docker ..."
if ! docker compose -f "$COMPOSE_FILE" up -d >/dev/null 2>&1; then
  warn "docker compose up failed (is the Docker daemon running?) — continuing without Headroom."
  exit 0
fi

# Wait up to ~15s for health.
for _ in $(seq 1 15); do
  if health_ok; then
    log "proxy healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

warn "proxy did not become healthy in time — continuing; check 'docker compose -f $COMPOSE_FILE logs'."
exit 0
