#!/usr/bin/env bash
# Runs the repository linter/check when the agent session ends.
# Lint is informational at session end: this script always exits 0.

set -uo pipefail

INPUT="$(cat)"

payload_cwd="$(
  python3 -c 'import json,sys; d=json.loads(sys.stdin.read() or "{}"); print(d.get("cwd",""))' <<<"$INPUT" 2>/dev/null || true
)"

if [ -n "$payload_cwd" ] && [ -d "$payload_cwd" ]; then
  REPO_ROOT="$payload_cwd"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
else
  REPO_ROOT="$(pwd)"
fi

cd "$REPO_ROOT" || exit 0

echo "[lint-on-session-end] Looking for a lint/check command in $REPO_ROOT"

run_cmd() {
  echo "[lint-on-session-end] Running: $*"
  "$@"
}

if [ -n "${AGENT_LINT_COMMAND:-}" ]; then
  if bash -lc "$AGENT_LINT_COMMAND"; then
    echo "[lint-on-session-end] Lint passed."
  else
    echo "[lint-on-session-end] Lint finished with issues."
  fi
  exit 0
fi

if [ -f Makefile ] || [ -f makefile ]; then
  if make -n lint >/dev/null 2>&1; then
    if run_cmd make lint; then
      echo "[lint-on-session-end] Lint passed."
    else
      echo "[lint-on-session-end] Lint finished with issues."
    fi
    exit 0
  fi
fi

if [ -f package.json ]; then
  package_manager="npm"
  [ -f pnpm-lock.yaml ] && package_manager="pnpm"
  [ -f yarn.lock ] && package_manager="yarn"
  { [ -f bun.lock ] || [ -f bun.lockb ]; } && package_manager="bun"

  for script in lint check:fast check; do
    if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script'] ? 0 : 1)" 2>/dev/null; then
      if run_cmd "$package_manager" run "$script"; then
        echo "[lint-on-session-end] Lint passed."
      else
        echo "[lint-on-session-end] Lint finished with issues."
      fi
      exit 0
    fi
  done
fi

if [ -f pyproject.toml ] && grep -qE '^\[tool\.ruff(\.|])|\bruff\b' pyproject.toml; then
  if command -v uv >/dev/null 2>&1; then
    if run_cmd uv run ruff check .; then
      echo "[lint-on-session-end] Lint passed."
    else
      echo "[lint-on-session-end] Lint finished with issues."
    fi
  elif command -v ruff >/dev/null 2>&1; then
    if run_cmd ruff check .; then
      echo "[lint-on-session-end] Lint passed."
    else
      echo "[lint-on-session-end] Lint finished with issues."
    fi
  fi
  exit 0
fi

if [ -f .pre-commit-config.yaml ] || [ -f .pre-commit-config.yml ]; then
  if command -v pre-commit >/dev/null 2>&1; then
    if run_cmd pre-commit run --all-files; then
      echo "[lint-on-session-end] Lint passed."
    else
      echo "[lint-on-session-end] Lint finished with issues."
    fi
    exit 0
  fi
fi

echo "[lint-on-session-end] No lint/check command detected."
exit 0
