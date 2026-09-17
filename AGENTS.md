# AGENTS.md — pi-coding-agent

Binding work contract for the whole repository. Read this before any change. Child `AGENTS.md` files add local contracts for their subtrees; this root binds everywhere.

## Purpose

Project-local PI coding agent "parity stack". A git-tracked config + runtime that mirrors the global PI runtime (`~/.pi/agent`): it adds Claude Code-style subagents (`@tintinweb/pi-subagents`), shared skills, quality-gate extensions, and a local bootstrap (`src/`) that launches an interactive PI session. This is a dev/tooling repo, not a product library.

## Ownership

- `src/` — local PI runtime bootstrap (entry, env, secrets, session event).
- `.pi/` — project-local PI config: settings, skills, agents, extensions, docs. Source of truth for global parity; synced via `scripts/sync-pi-config.ts`.
- `scripts/` — dev utilities: config sync, smoke check, Docker headroom.
- `test/` — unit/integration tests for guards, secrets, sync, delegation.
- `docs/` — architecture + reference docs.

## Local Contracts

Durable rules, distilled from `.pi/SYSTEM.md` (the single origin — read it for the full source, do not duplicate):

- Communication: always English, ELI5, short concise bullets, no fluff/hedging, exact terms.
- Safety: ask approval before destructive ops (`rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, branch deletion). Ambiguous/incomplete/high-risk request → ask first, change nothing.
- Core: tight scope (smallest change that solves it), reuse before creating (YAGNI), never read `.env` files directly, graphify query is mandatory when `graphify-out/graph.json` exists.
- Principles: Secure by Default, Privacy by Design, Separation of Duties, Fail-Safe Defaults (fail to the most restrictive state), Simplicity/Minimization.
- Coding workflow (mandatory, every time): understand/research → spec/plan file (grill-me session, Grill Status table) → present plan + DoD → wait for explicit approval → implement (TDD, minimal edits) → validate → document → review → summarize → cleanup.

## Work Guidance

- Coding workflow: follow the 12-step spec-gated workflow in `.pi/SYSTEM.md`. No code before the spec or plan file is grilled and explicitly approved.
- Coding standard: the `npm` scripts are the quality gate — `npm run typecheck`, `npm test`, `npm run smoke`. No separate standard doc exists yet; use the `add-coding-standard` skill to install one if desired.
- Quality gates: `.pi/extensions/gates.ts` enforces change-disclosure + verification-ran before completion; `read-boundary-guard.ts` / `write-boundary-guard.ts` enforce path boundaries. Respect these guards; do not work around them.
- Skill location: third-party skills belong in the **project-local** `.pi/skill-library/` (source of truth), never directly in the global `~/.pi/agent/skill-library/`. The global directory is a synced copy managed by `scripts/sync-pi-config.ts` (`push` = project→global, `pull` = global→project). Add the skill to the project, then run `npm run pi:sync-global` to propagate.
- Debugging: use the extension in `.pi/extensions/debug.ts`; full guide in `.pi/docs/debug-extension-guide.md`.

## Verification

- `npm run typecheck` — fast `tsc --noEmit` type check.
- `npm test` — vitest unit + integration.
- `npm run test:coverage` — vitest with v8 coverage.
- `npm run smoke` — extension/resource discovery smoke check.
- For sync changes: `npm run pi:pull-global` / `npm run pi:sync-global`.

## Child DOX Index

- [src/AGENTS.md](src/AGENTS.md) — PI runtime bootstrap (entry, env, secrets, session event)
- [.pi/AGENTS.md](.pi/AGENTS.md) — project-local PI config (settings, skills, agents, extensions)
- [scripts/AGENTS.md](scripts/AGENTS.md) — dev utilities (config sync, smoke, headroom)
- [test/AGENTS.md](test/AGENTS.md) — test conventions (vitest + fake-PI harness)

## Documentation

- GitHub: <https://github.com/earendil-works/pi>
- Official Docs: <https://pi.dev/docs/latest>
