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

Durable rules (communication, safety, research, the 10-step coding workflow, comments) live only in `.pi/SYSTEM.md`, which every session loads. Do not restate them here. Added for this repo:

- Language: always English.
- Principles: Secure by Default, Privacy by Design, Separation of Duties, Fail-Safe Defaults (fail to the most restrictive state), Simplicity/Minimization.

## Work Guidance

- Coding standard: the `npm` scripts are the quality gate — `npm run typecheck`, `npm test`, `npm run smoke`. No separate standard doc exists yet; use the `add-coding-standard` skill to install one if desired.
- Quality gates: `.pi/extensions/gates.ts` enforces change-disclosure + verification-ran before completion; `read-boundary-guard.ts` / `write-boundary-guard.ts` enforce path boundaries. Respect these guards; do not work around them.
- Skill location: third-party skills belong in the **project-local** `.pi/skill-library/` (source of truth), never directly in the global `~/.pi/agent/skill-library/`. The global directory is a synced copy managed by `scripts/sync-pi-config.ts` (`push` = project→global, `pull` = global→project). Add the skill to the project, then run `npm run pi:sync-global` to propagate. Sync is a human step: sandboxed bash cannot write `~/.pi/agent`, so run it in a normal terminal or a `pi --no-sandbox` session.
- UI/config changes (colors, footer, thinking): ask for a reference (hex or screenshot) first, then render in a pty and read the escape codes before reporting done. Copies of `zentui.json` and the theme live in `docs/reference/ui-config/`; see `docs/reference/ui-customization.md`.
- cmux shell: the `pi` on `PATH` is a shim that treats `update` and other subcommands as prompts. Call the real binary (`$(npm prefix -g)/bin/pi`) for `pi update`, `pi list`, and similar.
- Commits: the graphify git hook can leave a stale `.git/index.lock`. Check `git status` after each commit and retry once if it failed.
- Debugging: use the extension in `.pi/extensions/debug.ts`; full guide in `.pi/docs/debug-extension-guide.md`.
- Upgrading graphify or the Headroom proxy: follow `docs/reference/tool-upgrades.md` (save the old upstream skill before upgrading, keep the listed local deviations, sync the `autoStart` guard before the container swap).

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
