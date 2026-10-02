#!/usr/bin/env bash
#
# presidio-up.sh — ensure the Presidio analyzer for pii-redaction is running before a PI session.
#
# Idempotent and fast: returns at once when /health answers. Otherwise it builds (first
# run only) and starts the container, then waits up to 90 s, since loading two spaCy
# models takes a while.
#
# Non-blocking by design: it always exits 0. While the analyzer is down the pii-redaction
# package withholds content instead of sending it raw, so a late start is safe.
#
# Usage:
#   scripts/presidio-up.sh          # ensure up (npm run presidio:up)
#   scripts/presidio-up.sh --quiet  # only print on problems (predev / preagent)
#
set -uo pipefail

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/presidio-compose.yml"
HEALTH_URL="http://127.0.0.1:5002/health"

log()  { [[ "$QUIET" -eq 1 ]] || echo "presidio-up: $*"; }
warn() { echo "presidio-up: $*" >&2; }

health_ok() {
  command -v curl >/dev/null 2>&1 && curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1
}

if health_ok; then
  log "analyzer already healthy at $HEALTH_URL"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found — skipping (pii-redaction will withhold content until the analyzer runs)."
  exit 0
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  warn "compose file not found at $COMPOSE_FILE — skipping."
  exit 0
fi

log "starting Presidio analyzer via Docker ..."
if ! docker compose -f "$COMPOSE_FILE" up -d >/dev/null 2>&1; then
  warn "docker compose up failed (is the Docker daemon running?) — continuing."
  exit 0
fi

for _ in $(seq 1 90); do
  if health_ok; then
    log "analyzer healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

warn "analyzer did not become healthy in time — continuing; check 'docker compose -f $COMPOSE_FILE logs'."
exit 0
