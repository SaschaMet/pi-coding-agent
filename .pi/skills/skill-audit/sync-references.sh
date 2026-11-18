#!/usr/bin/env bash
# Refreshes the bundled OWASP copies; usage: sync-references.sh <path-to-www-project-agentic-skills-top-10>
set -euo pipefail
src="${1:?path to OWASP repo}"
dst="$(cd "$(dirname "$0")" && pwd)/references"
mkdir -p "$dst"
for f in ast01 ast02 ast03 ast04 ast05 ast06 ast07 ast08 ast09 ast10 checklist; do
  cp "$src/$f.md" "$dst/$f.md"
done
# The commit hash lets a reader see how far the copies lag the source.
printf 'source: OWASP Agentic Skills Top 10\ncommit: %s\ndate: %s\n' \
  "$(git -C "$src" rev-parse --short HEAD)" "$(date +%F)" > "$dst/SOURCE.md"
