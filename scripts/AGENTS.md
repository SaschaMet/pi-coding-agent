# AGENTS.md — scripts

Local work contract for `scripts/`. Parent contracts above still bind; this file controls local details.

## Purpose

Dev utilities outside the runtime: bidirectional config sync (`.pi/` ↔ `~/.pi/agent`), an extension smoke check, and Docker-based headroom for token optimization.

## Ownership

- `patch-retry.ts` — re-applies the pi-ai retry-backoff cap (60s from 5th retry) after every `npm install`; runs as `postinstall` + `npm run pi:patch-retry`. See `test/patch-retry.test.ts`.
- `pi-package-patches.ts` — `check` / `apply` for the `.pi/patches/<pkg>/*.patch` files that re-apply local edits to packages under `<agentDir>/npm/node_modules`; exit 0 applied or absent, 1 needed, 2 conflict. Logic lives in `.pi/extensions/lib/package-patches.ts`. Separate from `patch-retry.ts` on purpose. See `test/package-patches.test.ts`.
- `sync-pi-config.ts` (+ `sync-pi-config.md`) — managed sync of the `.pi/` tree: exclusions, extension pruning, settings/mcp merge, `SYSTEM.md → CLAUDE.md` copy, file modes on push, and the security policy check before push.
- `smoke.ts` — extension/resource discovery smoke check.
- `headroom-up.sh` — brings up the Docker headroom service (`headroom-compose.yml`).
- `headroom-log-rotate.sh` — rotates the proxy log inside the headroom container (weekly cron); accepts a local directory argument for deterministic tests (`test/headroom-log-rotate.test.ts`).

## Local Contracts

- `sync-pi-config.ts`: `EXCLUDED_TOP_LEVEL_PATHS` (`auth.json`, `sessions`, `npm`, `models.json`, `trust.json`, `AGENTS.md` top-level) must never be synced or deleted. Keep the list fail-safe (personal/machine data and the project-local root `AGENTS.md` stay out; nested `AGENTS.md` files still sync).
- Extension directories are pruned from local **only** when the global extension carries a `.pi-managed` marker. Never prune unmarked directories.
- `settings.json` and `mcp.json` are merge-synced, never overwritten: settings keep target-only keys and merge `packages`; mcp merges `mcpServers`. Preserve this.
- Scripts are standalone and independently runnable; no cross-imports between scripts.
- `push` keeps file modes (synced git hooks need their exec bit) and refuses to run when `.pi/security/policy.ts` does not load. Sync never writes global git config or `~/.claude/settings.json`.

## Work Guidance

- Docs are colocated: `sync-pi-config.md` documents the sync contract. Keep doc and code consistent.
- When a new machine-generated/personal file appears, add it to `EXCLUDED_TOP_LEVEL_PATHS` and add a test (follow the `trust.json` test pattern in `test/sync-pi-config.test.ts`).

## Verification

- `npm run pi:pull-global` / `npm run pi:sync-global` — exercise sync in both directions.
- `npm run pi:patch-retry` — re-run the retry-backoff patch (also runs on `postinstall`).
- `npm run pi:package-patches -- check` — report patch state for `<agentDir>/patches` (`apply` applies clean ones).
- `npm test` — `test/sync-pi-config.test.ts`, `test/package-scripts.test.ts`, `test/patch-retry.test.ts`.
- `npm run smoke` — runs `smoke.ts`.
- `npm run headroom:up` / `headroom:down` — Docker headroom lifecycle.

## Child DOX Index

- None.
