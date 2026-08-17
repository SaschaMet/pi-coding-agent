# AGENTS.md — .pi/extensions

Local work contract for `.pi/extensions/`. Parent contracts above still bind; this file controls local details.

## Purpose

PI extensions that enforce quality and safety at the tool layer: session-end quality gates, read/write path-boundary guards, model whitelist, subagent delegation policy, and an RTK bash-rewrite for token savings. Fail-safe: when in doubt, block.

## Ownership

- `gates.ts` — session-end quality gates: require change-disclosure + verification-ran before completion.
- `read-boundary-guard.ts` — block reads outside the working directory.
- `write-boundary-guard.ts` — block writes outside allowed boundaries (spec-scope aware).
- `model-whitelist.ts` — restrict which models may be selected.
- `subagent-delegation-policy.ts` — parse explicit delegation requests and route to the right subagent.
- `rtk.ts` — thin delegating extension that rewrites bash to `rtk` for token savings (rewrite logic lives in the `rtk` Rust registry, not here).
- `tools.ts` — `/tools` command to enable/disable tools interactively.
- `context-analyzer.ts` — `/context` command: context-usage overview + breakdown (system prompt, messages by role, tools by source) with scrollable skills/tools/files lists. Local re-implementation of the audited `pi-context-analyzer@0.1.1` (pure logic in `lib/context-analyzer.ts`; TUI + registration here).
- `debug.ts` — debugging extension.
- `lib/` — shared helpers (`extension-helpers`, `gate-checks`, `spec-scope`, `trust-loader`, `context-analyzer` core).

## Local Contracts

- Fail-Safe Defaults: a guard must fail to the most restrictive state. Uncertain → block, never allow.
- Guards hook tool-call events (`ToolCallEvent` / `ToolResultEvent`) and message-end; keep handlers idempotent and side-effect-free beyond the guard decision.
- Do not bypass a guard in code or tests. The guards are the contract — they are pinned by `test/gates.test.ts`, `test/read-boundary-guard.test.ts`, `test/write-boundary-guard.test.ts`, `test/spec-scope.test.ts`, `test/trust-loader.test.ts`, `test/subagent-delegation-policy.test.ts`.
- `rtk.ts` is a delegation shell: rewrite rules belong in `rtk`'s Rust registry (`src/discover/registry.rs`), not here. Do not hardcode rewrite logic.
- Shared logic lives in `lib/`; do not duplicate path/trust/gate helpers across extension files.

## Work Guidance

- Canonical style references: `lib/gate-checks.ts` and `lib/spec-scope.ts` for the check/parse patterns.
- Use `createFakePi` from `test/helpers/fake-pi.ts` when adding extension tests.
- Model whitelist + delegation policy register via `Symbol.for` keys to stay idempotent — keep the dedup guards.

## Verification

- `npm test` — per-guard suites (gates, read/write-boundary-guard, spec-scope, trust-loader, subagent-delegation-policy, context-analyzer).
- `npm run smoke` — confirms extensions load without errors.

## Child DOX Index

- None.
