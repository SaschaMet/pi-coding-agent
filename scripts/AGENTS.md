# AGENTS.md — scripts

Local work contract for `scripts/`. Parent contracts above still bind; this file controls local details.

## Purpose

Dev utilities outside the runtime: bidirectional config sync (`.pi/` ↔ `~/.pi/agent`), an extension smoke check, and Docker-based headroom for token optimization.

## Ownership

- `patch-retry.ts` — re-applies the pi-ai retry-backoff cap (60s from 5th retry) after every `npm install`; runs as `postinstall` + `npm run pi:patch-retry`. See `test/patch-retry.test.ts`.
- `sync-pi-config.ts` (+ `sync-pi-config.md`) — managed sync of the `.pi/` tree: exclusions, extension pruning, settings/mcp merge, and `SYSTEM.md → CLAUDE.md` copy.
- `smoke.ts` — extension/resource discovery smoke check.
- `headroom-up.sh` — brings up the Docker headroom service (`headroom-compose.yml`).

## Local Contracts

- `sync-pi-config.ts`: `EXCLUDED_TOP_LEVEL_PATHS` (`auth.json`, `sessions`, `npm`, `models.json`, `trust.json`, `AGENTS.md` top-level) must never be synced or deleted. Keep the list fail-safe (personal/machine data and the project-local root `AGENTS.md` stay out; nested `AGENTS.md` files still sync).
- Extension directories are pruned from local **only** when the global extension carries a `.pi-managed` marker. Never prune unmarked directories.
- `settings.json` and `mcp.json` are merge-synced (`packages` / `mcpServers`), never overwritten. Preserve this.
- Scripts are standalone and independently runnable; no cross-imports between scripts.

## Work Guidance

- Docs are colocated: `sync-pi-config.md` documents the sync contract. Keep doc and code consistent.
- When a new machine-generated/personal file appears, add it to `EXCLUDED_TOP_LEVEL_PATHS` and add a test (follow the `trust.json` test pattern in `test/sync-pi-config.test.ts`).

## Verification

- `npm run pi:pull-global` / `npm run pi:sync-global` — exercise sync in both directions.
- `npm run pi:patch-retry` — re-run the retry-backoff patch (also runs on `postinstall`).
- `npm test` — `test/sync-pi-config.test.ts`, `test/package-scripts.test.ts`, `test/patch-retry.test.ts`.
- `npm run smoke` — runs `smoke.ts`.
- `npm run headroom:up` / `headroom:down` — Docker headroom lifecycle.

## Child DOX Index

- None.
