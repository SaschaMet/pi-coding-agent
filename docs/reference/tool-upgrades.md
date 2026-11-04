# Upgrading graphify and the Headroom proxy

Runbook for bumping the two external tools this repo depends on. Write a plan per bump (`create-plan`); this page holds the steps and the traps that stay the same each time.

## Which step runs where

The agent's bash is sandboxed. It can edit files in the repo (through the edit tool for `.pi/`), run `graphify update .`, `graphify query`, and the npm gate. Everything below runs in **your normal terminal**. A `!` shell inside PI is sandboxed too.

| Step | Why the sandbox cannot |
| --- | --- |
| `uv tool upgrade graphifyy`, `pipx upgrade …` | Writes `~/.cache/uv`, `~/.local` |
| `graphify hook install` | Writes `.git/hooks` |
| `npm run pi:sync-global` | Writes `~/.pi/agent` |
| `docker …`, `curl http://127.0.0.1:8788/…` | No Docker socket, no local ports |

Release notes: read GitHub release pages through the fetch MCP. PyPI's robots.txt blocks automated fetches, and `raw.githubusercontent.com` returns 403 from the sandbox.

## graphify

`.pi/skills/graphify/` is a vendored copy of upstream's `skill-pi.md` plus `skills/pi/references/`, with local edits. A plain `graphify install` would overwrite them, so every upgrade is a 3-way merge.

1. **Save the old upstream skill before upgrading.** The upgrade replaces it, and it is the merge base. Copy `<site-packages>/graphify/skill-pi.md` and `skills/pi/references/` into the plan folder. `<site-packages>` is `~/.local/share/uv/tools/graphifyy/lib/python3.*/site-packages`.
2. (you) `uv tool upgrade graphifyy && graphify --version`. Stale-skill warnings on stderr are expected until step 6. The auto-refresh skips `~/.pi/agent/skills/graphify`, because `~/.claude`, `~/.codex`, and `~/.copilot` symlink to it; check for a `SKILL.md.bak` there anyway.
3. Merge per file: `git merge-file <ours> <old upstream> <new upstream>`. `references/extraction-spec.md` follows upstream's `skills/claude/references/` variant. `references/semantic-extraction.md` has no upstream file: it is Part B of upstream's SKILL.md, so slice that section out of both versions first.
4. Keep these local deviations:
   - Step B2 dispatches with the `Agent` tool and `subagent_type="general-purpose"`. Upstream's pi skill targets `npm:pi-subagents` (`delegate` agent), which this repo does not run.
   - The interpreter guard lives in `references/interpreter-guard.md`, and the update, add/watch, and hook pointers are one "Other subcommands" list. Both keep SKILL.md under the 580-line cap in `test/graphify-skill.test.ts`.
   - `references/hooks.md` keeps the `GIT_CONFIG_GLOBAL` prefix; `test/guard-check-skill-text.test.ts` requires it.
   - Our frontmatter `description`.
5. Set `.graphify_version` to the new version (no trailing newline) and run `npx vitest run test/graphify-skill.test.ts`.
6. (you) `graphify hook install`. From 0.9.102 it prints `refusing hooks path … (#3869)` and writes `.git/hooks`; that line is expected. Check: `grep -l graphify .git/hooks/post-*` lists four hooks and `~/.pi/agent/security/git-hooks/*` has none.
7. `graphify update .` (the agent can run it). Cache-schema bumps make it re-extract.
8. (you) `npm run pi:sync-global`, then `diff -r .pi/skills/graphify ~/.pi/agent/skills/graphify` is empty.

## Headroom proxy

The image pin lives in `headroom-compose.yml`. The native pipx CLI is a manual fallback only and is not upgraded with the image.

1. Read every release note between the pinned and the new tag. Check each env var, CLI flag, the entrypoint (`headroom proxy`), and the `/v1/compress` route the compose file relies on.
2. (you) Confirm the guard first: `cat ~/.pi/agent/headroom/settings.json` shows `"autoStart": false`. If not, run `npm run pi:sync-global`. Without it, a PI session started during the swap spawns a native proxy on 8788 that every later check talks to instead.
3. (you) Save the current reply: `curl -fsS -X POST http://127.0.0.1:8788/v1/compress -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"ping"}],"model":"gpt-4o"}' > "$TMPDIR/compress-before.json"`.
4. Pin the new tag (the Docker tag drops the release's `v`).
5. (you) `docker compose -f headroom-compose.yml pull && docker compose -f headroom-compose.yml up -d`, then check:
   - `docker inspect --format '{{.Config.Image}} {{.Config.Entrypoint}}' headroom` → new tag, `[headroom proxy]`; `docker ps` → `healthy`
   - `lsof -nP -iTCP:8788 -sTCP:LISTEN` → only `com.docker…`
   - `docker exec headroom headroom proxy --help` lists `--lossless`, `--no-cache`, `--log-file`, `--log-messages`, `--no-ccr-proactive-expansion`
   - the same `curl` piped to `jq -S keys` equals `jq -S keys "$TMPDIR/compress-before.json"`
   - after one PI turn with tool output: `docker exec headroom tail -3 /home/nonroot/.headroom/proxy.log` has a fresh `"provider": "compress"` line
6. Undo: pin the old tag and `up -d`; the old image stays on disk.

Upstream changes that already touch this config:

- v0.38.0 (PR #3605) adds a gateway contract to `/v1/compress`. It is non-breaking without a top-level `gateway` object, which the extension never sends. Kill switch: `HEADROOM_GATEWAY_CONTRACT=0`.
- v0.39.0 (PR #3715) also admits the Docker bridge gateway on `/v1/compress` when the Host header is loopback. `HEADROOM_COMPRESS_ALLOW_REMOTE` still short-circuits that guard and stays.
- v0.40.0 (PR #3852) refuses an unauthenticated non-loopback bind; that is why `HEADROOM_ALLOW_UNAUTHENTICATED_BIND=1` exists. The same release renamed `HEADROOM_LICENSE_KEY` to `HEADROOM_LICENSE`; we set neither.
