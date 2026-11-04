#!/usr/bin/env bash
# Usage: wait-or-prompt.sh <token> <surface>  (WS defaults to $CMUX_WORKSPACE_ID)
# Exit: 0 signalled · 1 timed out · 2 approval prompt · 3 sandbox stop · 4 idle · 64 usage
set -u
WS=${WS:-${CMUX_WORKSPACE_ID:-}}
if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$WS" ]; then
  echo "usage: wait-or-prompt.sh <token> <surface>  (WS or CMUX_WORKSPACE_ID required)" >&2; exit 64
fi
TOKEN=$1; SURF=$2
IDLE=0
for _ in $(seq 1 36); do
  # 36 × 15 s stays under the bash tool timeout (600 s): exit 1, then wait again in a new call.
  cmux wait-for "$TOKEN" --timeout 15 && exit 0          # exits 1 on timeout
  SCR=$(cmux read-screen --workspace "$WS" --surface "$SURF" --lines 40)
  if printf '%s\n' "$SCR" | grep -qE 'Allow .*\?|Do you want to proceed|Trust project folder|→ Yes'; then
    echo "PROMPT on $SURF"; printf '%s\n' "$SCR" | tail -15; exit 2
  fi
  # A sandboxed worker that stopped or lost bash cannot signal. Anchor to line start (after the
  # TUI's left padding): this repo's sandbox files quote the same phrases mid-line, and a worker may display them.
  if printf '%s\n' "$SCR" | grep -qE '^[[:space:]]*(NEEDS_UNSANDBOXED|NEEDS_DOMAIN): ' || printf '%s\n' "$SCR" | grep -qE '^[[:space:]]*(bash blocked: sandbox unavailable|Refusing to run with the built-in defaults)'; then
    echo "SANDBOX STOP on $SURF"; printf '%s\n' "$SCR" | tail -15; exit 3
  fi
  # Idle without having signalled: a lost Enter, or the worker stopped early. Four idle slices in a row (about a minute) → report.
  if printf '%s\n' "$SCR" | grep -qE 'Working…|Thinking…'; then IDLE=0; else IDLE=$((IDLE + 1)); fi
  if [ "$IDLE" -ge 4 ]; then echo "IDLE on $SURF"; printf '%s\n' "$SCR" | tail -15; exit 4; fi
done
exit 1
