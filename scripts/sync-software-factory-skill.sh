#!/bin/bash
# Copies the software-factory operating skill from the software-factory repo
# into this repo's .pi/skills/ so the global sync (npm run pi:sync-global)
# propagates it to ~/.pi/agent/skills/. The copied skill is gitignored:
# the software-factory repo is the source of truth.
set -euo pipefail

SRC_REPO="${SF_REPO:-$HOME/Projects/Private/software-factory}"
SRC="$SRC_REPO/skill/SKILL.md"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/.pi/skills/software-factory"

if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_DIR/SKILL.md"
echo "copied $SRC -> $DEST_DIR/SKILL.md"
