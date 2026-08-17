# Architecture — pi-coding-agent

Structural overview of the system. Read before any change to understand component boundaries and dependencies.

## Tech Stack

- **Language(s):** TypeScript (ES2022)
- **Framework(s):** `@earendil-works/pi-*` packages (PI coding agent ecosystem)
- **Package Manager:** npm
- **Build Tool:** tsx (runtime execution), tsc (type checking)
- **Test Framework:** Vitest with v8 coverage provider
- **Runtime:** Node.js >=22.19.0

## Component Map

| Component | Location | Responsibility |
| --- | --- | --- |
| Application Entry | `src/main.ts` | PI runtime bootstrap: session creation, service wiring, extension binding, interactive mode launch |
| Environment Loading | `src/env.ts` | `.env` file parsing and `process.env` injection (no-op for existing keys) |
| Secrets Management | `src/secrets.ts` | Scoped secret resolution: checks `process.env` first, then falls back to cached `.env` parsing |
| Session Events | `src/session-established-event.ts` | Type augmentation for `session_established` events (new/resume) emitted by the extension runner |
| PI Configuration | `.pi/` | Project-local PI settings, skills, agents, extensions, and documentation |
| Subagent Roles | `.pi/agents/` | Role definitions for `@tintinweb/pi-subagents` (generic-readonly, generic-worker, etc.) |
| Skills | `.pi/skills/` | Project-local agent skills (`create-spec`, `code-review`, `create-plan`, `graphify`, `init-project`, `add-coding-standard`, …) |
| Quality-Gate Extensions | `.pi/extensions/` | Tool-layer guardrail extensions: `gates` (workflow gates), `read/write-boundary-guard` (path boundaries), `model-whitelist`, `subagent-delegation-policy`, `rtk` (token-saving bash rewrite), `tools`, `debug`; shared helpers in `lib/` |
| Config Sync | `scripts/sync-pi-config.ts` | Bidirectional sync of `.pi/` ↔ `~/.pi/agent/` with exclusions, managed-extension pruning, and `SYSTEM.md → CLAUDE.md` copy |
| Headroom | `headroom-compose.yml`, `scripts/headroom-up.sh` | Docker-based token-optimization service started before agent runs |
| Smoke Check | `scripts/smoke.ts` | Extension/resource discovery smoke check (`npm run smoke`) |
| Tests | `test/` | Unit and integration tests covering guards, secrets, sync, delegation, and quality gates; `helpers/fake-pi.ts` fake runtime |
| Documentation | `docs/` | Architecture overview and reference docs (implementation workflow, startup perf, trust.json) |

## Dependency Direction

```
src/main.ts
├── @earendil-works/pi-coding-agent (SessionManager, createAgentSession*, InteractiveMode, getAgentDir)
└── src/session-established-event.ts (type-only import)

src/secrets.ts
└── src/env.ts (parseEnvFile — utility chain; not imported by main.ts yet)

src/session-established-event.ts
└── @earendil-works/pi-coding-agent (SessionContext type for the event augmentation)

.pi/extensions/*.ts
├── @earendil-works/pi-coding-agent (ExtensionAPI, tool/message event types)
└── .pi/extensions/lib/* (shared helpers: gate-checks, spec-scope, trust-loader, …)

test/*
├── src/* (tested modules)
├── .pi/extensions/* (guard suites driven via helpers/fake-pi.ts)
└── scripts/sync-pi-config.ts (sync suites)

scripts/*
└── Independent utilities (no cross-imports)
```

Key: `src/` depends only on the PI packages. Extensions depend on the PI packages plus their own `lib/`. Tests import whatever they verify. Scripts are independent of everything else.

## Key Decisions

- **Local-first runtime**: `npm run agent` and `npm run dev` run against the current project filesystem for direct repository inspection and file edits — no remote service dependency
- **Session continuity**: `SessionManager.continueRecent()` resumes sessions based on working directory, enabling persistent context across invocations
- **Extension-based architecture**: Plugins for skills, subagents, tools, and diagnostics loaded dynamically via `resourceLoader.getExtensions()`
- **Bidirectional config sync**: `npm run pi:pull-global` (preferred) imports global `~/.pi/agent` into repo `.pi/`; `npm run pi:sync-global` (legacy) pushes repo config to global — personal data excluded
- **Symlink skill distribution**: Skills in `~/.pi/agent/skills/` are symlinked into Claude Code, Codex, and Copilot skill directories for cross-agent parity via `pisync`
- **Token-efficiency layering**: the `rtk` extension rewrites bash commands at the tool layer (rewrite logic lives in the `rtk` Rust registry, not in this repo); the Docker headroom service optimizes tokens further at runtime
- **Strict TypeScript**: `strict: true`, `skipLibCheck: true`, ES2022 target, NodeNext module resolution

## Data Flow

Typical session lifecycle:

1. `main.ts` starts → `SessionManager.continueRecent(cwd)` resolves the session file (new or resume)
2. `createAgentSessionRuntime()` bootstraps → `createAgentSessionServices()` wires providers, models, tools
3. `createAgentSessionFromServices()` creates the session → binds extensions
4. On first UI context: `session_established` event emitted via `extensionRunner.emit()`
5. `InteractiveMode` takes over → processes user input → routes to tools/subagents
6. Session state persisted to disk → available for resume via `continueRecent()`

## Architecture Diagram

```text
        npm run agent / npm run dev
                      │
                      ▼
            ┌──────────────────┐
            │    src/main.ts   │  bootstrap: session, services,
            └────────┬─────────┘  interactive mode
                     │ discovers + binds via resourceLoader
        ┌────────────┼──────────────────────────┐
        ▼            ▼                          ▼
  .pi/extensions  .pi/skills                .pi/agents
  (gates, guards, (agent skills)            (subagent roles)
   whitelist, rtk)
        │
        │ npm run pi:pull-global / pi:sync-global
        ▼
  ~/.pi/agent (global PI runtime; personal data excluded from sync)
```
