# AGENTS.md — .pi/extensions

Local work contract for `.pi/extensions/`. Parent contracts above still bind; this file controls local details.

## Purpose

PI extensions that enforce quality and safety at the tool layer: session-end quality gates, read/write path-boundary guards, model whitelist, subagent delegation policy, and subagent rules injection. Fail-safe: when in doubt, block.

## Ownership

- `gates.ts` — session-end quality gates: require change-disclosure + verification-ran before completion.
- `read-boundary-guard.ts` — block reads outside the working directory.
- `write-boundary-guard.ts` — block writes outside allowed boundaries (spec-scope aware; system tmpdir exempt while the working directory is outside it).
- `security-guard.ts` — PI adapter for the shared security policy in `.pi/security/`: blocks `.env`/credential paths, dangerous shell commands, protected and force pushes, hook bypasses, and secrets in prompts. Loads the core by dynamic import so a load failure blocks instead of skipping the extension. See `docs/reference/gates-and-guards.md`.
- `sandbox-bash.ts` — replaces the built-in `bash` tool and user `!` commands with one that runs each command inside `srt` (`@anthropic-ai/sandbox-runtime@0.0.79`, global install): file, network, env-var, and socket limits from `lib/sandbox-bash.ts` plus optional `~/.pi/agent/sandbox.json`. Fail-closed: a missing/wrong `srt`, failed probe, bad config, or cwd `$HOME`/`/` blocks bash. `--no-sandbox` opts out per session; `/sandbox` shows the policy. Syncing makes it global.
- `model-whitelist.ts` — restrict which models may be selected.
- `subagent-delegation-policy.ts` — parse explicit delegation requests and route to the right subagent. In an interactive cmux session (`isInsideCmux()`: `CMUX_SURFACE_ID` plus a live `CMUX_SOCKET_PATH`) it adds a soft rule steering watch-worthy work to cmux pane workers and leaves spawn phrasing as plain text; no hard block.
- `subagent-rules-injection.ts` — inject `.pi/SYSTEM.md` into a subagent whose system prompt lacks it.
- `tools.ts` — `/tools` command to enable/disable tools interactively.
- `context-analyzer.ts` — `/context` command: context-usage overview + breakdown (system prompt, messages by role, tools by source) with scrollable skills/tools/files lists. Local re-implementation of the audited `pi-context-analyzer@0.1.1` (pure logic in `lib/context-analyzer.ts`; TUI + registration here).
- `notify.ts` — desktop notification on `agent_end` via OSC 777 (terminal-native, no dependencies). TUI-mode guard keeps subagent sessions silent. Local rebuild of the audited `mitsuhiko/agent-stuff` `notify.ts`.
- `cmux-status.ts` — per-pane badge in the cmux sidebar while the top-level agent loop is active: `agent_start` sets a "running" pill, `ui_prompt_start` swaps it for a red "needs input" pill (plus `trigger-flash` and `notify`, every prompt, only while the agent runs), `ui_prompt_end` restores "running", `agent_end` clears it, via the `cmux` CLI through `pi.exec` (serial queue, fire-and-forget, silent no-op outside cmux). Per-pane key `pi-<CMUX_SURFACE_ID>` (shared `pi` fallback) avoids cross-pane races. TUI-mode guard keeps subagent sessions silent. Stale badge after a crash: `cmux clear-status pi-<surface-id>`.
- `claude-usage.ts` — footer segment with the Claude plan's 5h/7d utilization, read from Headroom's local `/stats` (`127.0.0.1:8788`). Shown only after a `claude-bridge` turn; cleared on session start and on switching to another provider; any fetch/parse failure hides it. TUI-mode guard keeps subagent sessions silent.
- `package-patches.ts` — at TUI session start, auto-applies clean patches from `<agentDir>/patches/<pkg>/*.patch` to `<agentDir>/npm/node_modules/<pkg>` and notifies "restart Pi". A conflict, or an installed version differing from the patch's `Reviewed-Version`, goes to the agent as a `nextTurn` message pointing at the `package-patches` skill. Never throws. Logic in `lib/package-patches.ts`.
- `debug.ts` — debugging extension.
- `lib/pii-redaction.ts` — pure tag/restore logic for the `pii-redaction` package (`.pi/local-packages/`), which loads via `packages` so it runs before noheadroom. See `docs/reference/pii-redaction.md`.
- `lib/` — shared helpers (`extension-helpers`, `gate-checks`, `spec-scope`, `trust-loader`, `context-analyzer` core).

## Local Contracts

- Fail-Safe Defaults: a guard must fail to the most restrictive state. Uncertain → block, never allow.
- Guards hook tool-call events (`ToolCallEvent` / `ToolResultEvent`) and message-end; keep handlers idempotent and side-effect-free beyond the guard decision.
- Do not bypass a guard in code or tests. The guards are the contract — they are pinned by `test/gates.test.ts`, `test/read-boundary-guard.test.ts`, `test/write-boundary-guard.test.ts`, `test/spec-scope.test.ts`, `test/trust-loader.test.ts`, `test/subagent-delegation-policy.test.ts`, `test/security-guard.test.ts`, `test/security-parity.test.ts`, `test/sandbox-bash.test.ts`, `test/sandbox-bash.integration.test.ts`.
- Security rules live only in `.pi/security/policy.ts`. `security-guard.ts` maps events and holds no rule logic.
- Shared logic lives in `lib/`; do not duplicate path/trust/gate helpers across extension files.

## Work Guidance

- Canonical style references: `lib/gate-checks.ts` and `lib/spec-scope.ts` for the check/parse patterns.
- Use `createFakePi` from `test/helpers/fake-pi.ts` when adding extension tests.
- Model whitelist + delegation policy register via `Symbol.for` keys to stay idempotent — keep the dedup guards.

## Reference

- [docs/reference/gates-and-guards.md](../../docs/reference/gates-and-guards.md) — how each gate and guard decides.

## Verification

- `npm test` — per-guard suites (gates, read/write-boundary-guard, spec-scope, trust-loader, subagent-delegation-policy, context-analyzer).
- `npm run smoke` — confirms extensions load without errors.

## Child DOX Index

- None.
