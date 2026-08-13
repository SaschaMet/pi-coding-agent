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
| Skills | `.pi/skills/` | Project-local agent skills (coding-standard, code-review, create-spec, graphify, etc.) |
| Extensions | `.pi/extensions/` | Custom PI extensions and their compiled libraries |
| Tests | `test/` | Unit and integration tests covering guards, secrets, sync, delegation, and quality gates |
| Scripts | `scripts/` | Development utilities: smoke tests, config sync, Docker headroom setup |
| Documentation | `docs/` | Plans, reference docs, research artifacts, and specifications |

## Dependency Direction

```
src/main.ts
├── @earendil-works/pi-coding-agent (core session, services, runtime)
├── @earendil-works/pi-agent-core
├── src/env.ts (via src/secrets.ts)
├── src/secrets.ts
└── src/session-established-event.ts (type augmentation)

test/*
├── src/* (tested modules)
└── @earendil-works/pi-* (mocked via test helpers)

scripts/*
└── Independent utilities (no cross-dependencies)

.pi/
└── Self-contained configuration (skills, agents, extensions)
```

Key: `src/` depends on PI core packages and its own modules. Tests depend on source. Scripts are independent. `.pi/` is self-contained configuration.

## Key Decisions

- **Local-first runtime**: `npm run agent` and `npm run dev` run against the current project filesystem for direct repository inspection and file edits — no remote service dependency
- **Session continuity**: `SessionManager.continueRecent()` resumes sessions based on working directory, enabling persistent context across invocations
- **Extension-based architecture**: Plugins for skills, subagents, tools, and diagnostics loaded dynamically via `resourceLoader.getExtensions()`
- **Bidirectional config sync**: `npm run pi:pull-global` (preferred) imports global `~/.pi/agent` into repo `.pi/`; `npm run pi:sync-global` (legacy) pushes repo config to global — personal data excluded
- **Symlink skill distribution**: Skills in `~/.pi/agent/skills/` are symlinked into Claude Code, Codex, and Copilot skill directories for cross-agent parity via `pisync`
- **Strict TypeScript**: `strict: true`, `skipLibCheck: true`, ES2022 target, NodeNext module resolution

## Data Flow

Typical session lifecycle:

1. `main.ts` starts → loads environment via `env.ts` → initializes `SessionManager` with CWD
2. `createAgentSessionRuntime()` bootstraps → `createAgentSessionServices()` wires providers, models, tools
3. `createAgentSessionFromServices()` creates the session → binds extensions
4. On first UI context: `session_established` event emitted via `extensionRunner.emit()`
5. `InteractiveMode` takes over → processes user input → routes to tools/subagents
6. Session state persisted to disk → available for resume via `continueRecent()`
