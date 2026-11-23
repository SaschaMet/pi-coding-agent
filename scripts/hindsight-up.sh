#!/usr/bin/env bash
#
# hindsight-up.sh — start the Hindsight memory server before a PI session.
#
# Idempotent and FAST: if the server already answers on /health it returns immediately.
# Otherwise it starts the Docker container and returns without waiting for health:
# the server needs a while to boot, and PI must not wait for it.
#
# Non-blocking by design: memory is an optimization, not a hard dependency. If Docker,
# the iqRouter key, or the API token is missing, this prints one warning and exits 0
# so your PI session launches anyway.
#
# Usage:
#   scripts/hindsight-up.sh          # ensure up (npm run hindsight:up)
#   scripts/hindsight-up.sh --quiet  # only print on problems (predev / preagent)
#
set -uo pipefail

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/hindsight-compose.yml"
HEALTH_URL="http://127.0.0.1:8888/health"
MODELS_FILE="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/models.json"
HINDSIGHT_CONFIG_FILE="$HOME/.hindsight/coding-agent.json"

log()  { [[ "$QUIET" -eq 1 ]] || echo "hindsight-up: $*"; }
warn() { echo "hindsight-up: $*" >&2; }

# health_ok — true if the server answers /health with HTTP 2xx
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
  log "server already healthy at $HEALTH_URL"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found — skipping (PI will run without Hindsight memory)."
  exit 0
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  warn "compose file not found at $COMPOSE_FILE — skipping."
  exit 0
fi

# Secrets stay in their own files: exported for compose, never written or printed.
HINDSIGHT_LLM_BASE_URL="$(jq -r '.providers.iqRouter.baseUrl // empty' "$MODELS_FILE" 2>/dev/null)"
HINDSIGHT_LLM_API_KEY="$(jq -r '.providers.iqRouter.apiKey // empty' "$MODELS_FILE" 2>/dev/null)"
HINDSIGHT_API_TOKEN="$(jq -r '.apiToken // empty' "$HINDSIGHT_CONFIG_FILE" 2>/dev/null)"
# pi runs an apiKey that starts with `!` as a command; a start script never runs a command out of a config file.
if [[ "$HINDSIGHT_LLM_API_KEY" == '!'* ]]; then HINDSIGHT_LLM_API_KEY=""; fi
if [[ -z "$HINDSIGHT_LLM_BASE_URL" || -z "$HINDSIGHT_LLM_API_KEY" || -z "$HINDSIGHT_API_TOKEN" ]]; then
  warn "iqRouter baseUrl/apiKey or the Hindsight apiToken is missing — skipping (PI will run without Hindsight memory)."
  exit 0
fi
export HINDSIGHT_LLM_BASE_URL HINDSIGHT_LLM_API_KEY HINDSIGHT_API_TOKEN

log "starting Hindsight server via Docker (not waiting for health) ..."
if ! docker compose -f "$COMPOSE_FILE" up -d >/dev/null 2>&1; then
  warn "docker compose up failed (is the Docker daemon running?) — continuing without Hindsight."
  exit 0
fi
exit 0
