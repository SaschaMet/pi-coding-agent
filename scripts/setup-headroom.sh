#!/usr/bin/env bash
#
# setup-headroom.sh — install the Headroom pip package and start its proxy.
#
# Scope (intentionally minimal): this installs `headroom-ai` and launches a
# single proxy instance. Wiring PI providers to the proxy is a config change in
# `.pi/models.json` — see Headroom-Readme.md for the per-provider routing.
#
# IMPORTANT — a proxy needs an upstream. By itself `headroom proxy` defaults to
# OpenAI (api.openai.com) and authenticates upstream with ITS OWN credentials
# (OPENAI_API_KEY / ANTHROPIC_API_KEY / etc. in this script's environment), NOT
# the client's token. Point it elsewhere with passthrough flags after `--`:
#   --openai-api-url URL   forward OpenAI-format traffic to URL (e.g. LM Studio)
#   --backend NAME         bedrock | vertex_ai | azure | openrouter
# See Headroom-Readme.md for the per-provider routing and auth caveats.
#
# Usage:
#   scripts/setup-headroom.sh                              # install + proxy on :8787 (-> OpenAI)
#   scripts/setup-headroom.sh --port 8788                  # use a different port
#   scripts/setup-headroom.sh --no-start                   # install only, don't launch
#   scripts/setup-headroom.sh --extra all                  # pip extra (default: proxy)
#   scripts/setup-headroom.sh --port 8787 -- \
#       --openai-api-url http://127.0.0.1:1234/v1          # forward to LM Studio
#   scripts/setup-headroom.sh --port 8791 -- --backend vertex_ai
#
set -euo pipefail

PORT=8787
EXTRA="proxy"          # pip extra: proxy | all | mcp | ml | ...
START=1
PROXY_ARGS=()          # extra flags passed through to `headroom proxy`

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)     PORT="$2"; shift 2 ;;
    --extra)    EXTRA="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --)         shift; PROXY_ARGS=("$@"); break ;;
    -h|--help)
      # Print only the leading comment block (stop at the first non-comment line).
      sed -n '2,/^[^#]/{/^#/p;}' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2 ;;
  esac
done

# --- locate a Python/pip toolchain -------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Error: python3 not found. Install Python 3.10+ first." >&2
  exit 1
fi

echo "==> Using $($PY --version 2>&1) at $(command -v "$PY")"

# Headroom requires Python 3.10+. Warn (don't hard-fail) if older.
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
  echo "Warning: Headroom requires Python 3.10+. Your interpreter may be too old." >&2
fi

# --- install the package (idempotent: pip upgrades in place) -----------------
echo "==> Installing headroom-ai[$EXTRA] ..."
"$PY" -m pip install --upgrade "headroom-ai[$EXTRA]"

# --- verify ------------------------------------------------------------------
if ! command -v headroom >/dev/null 2>&1; then
  echo "Error: 'headroom' CLI not on PATH after install." >&2
  echo "       Ensure your Python bin dir is on PATH (e.g. ~/.local/bin)." >&2
  exit 1
fi
echo "==> Installed: $(headroom --version 2>&1 || echo 'headroom (version unknown)')"

# --- launch the proxy --------------------------------------------------------
if [[ "$START" -eq 1 ]]; then
  echo "==> Starting Headroom proxy on port $PORT (Ctrl-C to stop) ..."
  echo "    OpenAI-format clients -> http://127.0.0.1:$PORT/v1"
  echo "    Anthropic clients     -> http://127.0.0.1:$PORT"
  if [[ ${#PROXY_ARGS[@]} -gt 0 ]]; then
    echo "    Proxy flags: ${PROXY_ARGS[*]}"
  else
    echo "    No upstream flags given -> defaults to OpenAI (api.openai.com)."
    echo "    Needs OPENAI_API_KEY in env, or pass: -- --openai-api-url <url> / --backend <name>"
  fi
  exec headroom proxy --port "$PORT" ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"}
else
  echo "==> Install complete. Start the proxy later with:"
  echo "    headroom proxy --port $PORT [--openai-api-url <url>] [--backend <name>]"
fi
