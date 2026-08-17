# AGENTS.md — .pi (project-local PI config)

Local work contract for `.pi/`. Parent contracts above still bind; this file controls local details.

## Purpose

The project-local PI config tree — the source of truth for the global PI runtime (`~/.pi/agent`). Holds settings, skills, agent role definitions, quality-gate extensions, and docs. Kept in bidirectional sync by `scripts/sync-pi-config.ts`.

## Ownership

- `.pi/settings.json` — local PI settings (tool-layer `ignorePatterns`, etc.).
- `.pi/SYSTEM.md` — durable agent rules (single origin; referenced by root `AGENTS.md`). Copied to `~/.claude/CLAUDE.md` on sync.
- `.pi/agents/` — subagent role definitions (`generic-readonly`, `generic-worker`) for `@tintinweb/pi-subagents`.
- `.pi/skills/` — project-local skills (`create-spec`, `code-review`, `graphify`, `init-project`, `add-coding-standard`, …).
- `.pi/extensions/` — quality-gate + boundary-guard extensions (see child).
- `.pi/mcp.json`, `.pi/models.json` — MCP + model config (merge-synced, never overwritten).
- `.pi/docs/` — agent docs (e.g. the debug-extension guide).

## Local Contracts

- This tree mirrors the global runtime. Personal/machine data (`auth.json`, `sessions/`, `npm/`, `models-store.json`, `trust.json`, `mcp-cache.json`, `pi-cache-optimizer-stats.json`) is excluded from sync — never commit or sync these.
- This file (`.pi/AGENTS.md`) itself is excluded from sync — it is a project-local navigation doc. Nested `AGENTS.md` files (e.g. `.pi/extensions/AGENTS.md`) still sync.
- `skills/` and `agents/` are content, not code. Editing them changes agent behavior on the next session start.
- `.pi/SYSTEM.md` is the single origin of durable rules; do not fork rules into other files.
- `mcp.json` is merge-synced (`mcpServers`), not overwritten — preserve the contract in `scripts/sync-pi-config.md`.

## Work Guidance

- To change agent behavior, edit the relevant skill/agent/extension here, then propagate to the global runtime with `npm run pi:sync-global`.
- New skills follow the `SKILL.md` + `references/` + `templates/` layout — mirror an existing skill as the reference.

## Verification

- `npm run smoke` — extension/resource discovery smoke check (validates `.pi/` wiring).
- `npm test` — `test/sync-pi-config.test.ts` covers the sync contract for this tree.

## Child DOX Index

- [.pi/extensions/AGENTS.md](extensions/AGENTS.md) — quality-gate + boundary-guard extensions
