# AGENTS.md — src

Local work contract for `src/`. Parent contracts above still bind; this file controls local details.

## Purpose

Local PI runtime bootstrap: entry point, environment/secrets loading, and the session-established event. A thin layer over `@earendil-works/pi-*` that creates an interactive PI session with extensions bound.

## Ownership

- `src/main.ts` — entry (`npm run agent` / `npm run dev`). Session creation, service wiring, extension binding, `InteractiveMode` launch.
- `src/env.ts` — `.env` parsing → `process.env` injection (existing keys win).
- `src/secrets.ts` — scoped secret resolution: `process.env` first, then cached `.env` parsing.
- `src/session-established-event.ts` — type augmentation for `session_established` (new/resume) events.

## Local Contracts

- Keep the bootstrap thin: `main.ts` wires services and launches `InteractiveMode`; no business logic here.
- `env.ts` / `secrets.ts` are pure utilities with no import-time side effects. `process.env` keys always win over `.env` values.
- `session-established-event.ts` is type-only (a declaration merge). It must not emit at runtime — the runtime emits via `session.extensionRunner.emit()`.
- Dependencies flow only into `@earendil-works/pi-*` and within `src/`. Do not import from `.pi/` or `scripts/`.

## Work Guidance

- Use `getScopedSecret(cwd, key)` for secrets and `parseEnvFile` / `loadEnvFile` for `.env`. Do not read `.env`-backed keys via `process.env` directly.
- Extensions are discovered via `resourceLoader.getExtensions()`; log load errors instead of hard-failing (see `main.ts`).

## Verification

- `npm run typecheck`
- `npm test` — `test/secrets.test.ts` and `test/agent-config.test.ts` cover this area.

## Child DOX Index

- None.
