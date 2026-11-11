# AGENTS.md — .pi/extensions

Local work contract for `.pi/extensions/`. Parent contracts above still bind; this file controls local details.

## Purpose

PI extensions that enforce quality and safety at the tool layer: session-end quality gates, read/write path-boundary guards, model whitelist, subagent delegation policy, and subagent rules injection. Fail-safe: when in doubt, block.

## Ownership

- `gates.ts` — session-end quality gates: require change-disclosure + verification-ran before completion.
- `read-boundary-guard.ts` — ask before read/write/edit/grep/find/ls outside the working directory. The prompt offers Yes once, this file for the session, everything under the folder for the session (never for a folder containing `$HOME`), or No. Grants live in memory and clear on `session_start`; the subagent prompt-forwarding patch in `.pi/patches/@tintinweb/pi-subagents/` must accept the same option list.
- `write-boundary-guard.ts` — block writes outside allowed boundaries (spec-scope aware; system tmpdir exempt while the working directory is outside it).
- `security-guard.ts` — PI adapter for the shared security policy in `.pi/security/`: blocks `.env`/credential paths, dangerous shell commands, protected and force pushes, hook bypasses, and secrets in prompts. Loads the core by dynamic import so a load failure blocks instead of skipping the extension. See `docs/reference/gates-and-guards.md`.
- `sandbox-bash.ts` — replaces the built-in `bash` tool and user `!` commands with one that runs each command inside `srt` (`@anthropic-ai/sandbox-runtime@0.0.79`, global install): file, network, env-var, and socket limits from `lib/sandbox-bash.ts` plus optional `~/.pi/agent/sandbox.json`. Fail-closed: a missing/wrong `srt`, failed probe, bad config, or cwd `$HOME`/`/` blocks bash. `--no-sandbox` opts out per session; `/sandbox` shows the policy. Project-only (`PROJECT_ONLY_EXTENSION_FILES` in `scripts/sync-pi-config.ts`): sync never copies it; removing the entries rolls it out. A missing settings file blocks bash until restart. Agent playbook: the `sandboxed-bash` skill.
- `tool-guards.ts` — blocks a tool call that keeps returning the same result (3rd identical call blocked, 4th aborts the run), and a `cmux send`/`send-key` whose `--surface`/`--workspace` is not a literal ref, `$CMUX_*`, or `${VAR:?}`. Logic in `lib/tool-guards.ts`.
- `degenerate-output.ts` — `iqRouter` only: replaces an unreadable final reply (leaked template marker, or no text) with a notice, keeps the original in a hidden entry, and retries once per run. Logic in `lib/degenerate-output.ts`.
- `model-whitelist.ts` — restrict which models may be selected.
- `subagent-delegation-policy.ts` — parse explicit delegation requests and route to the right subagent. In an interactive cmux session (`isInsideCmux()`: `CMUX_SURFACE_ID` plus a live `CMUX_SOCKET_PATH`) it adds a soft rule steering watch-worthy work to cmux pane workers and leaves spawn phrasing as plain text; no hard block.
- `subagent-rules-injection.ts` — inject `.pi/SYSTEM.md` into a subagent whose system prompt lacks it.
- `tools.ts` — `/tools` command to enable/disable tools interactively.
- `context-analyzer.ts` — `/context` command: context-usage overview + breakdown (system prompt, messages by role, tools by source) with scrollable skills/tools/files lists. Local re-implementation of the audited `pi-context-analyzer@0.1.1` (pure logic in `lib/context-analyzer.ts`; TUI + registration here).
- `notify.ts` — desktop notification on `agent_end` via OSC 777 (terminal-native, no dependencies). TUI-mode guard keeps subagent sessions silent. Local rebuild of the audited `mitsuhiko/agent-stuff` `notify.ts`.
- `cmux-status.ts` — cmux sidebar pills via the `cmux` CLI through `pi.exec` (serial queue, fire-and-forget, silent no-op outside cmux). Per-pane state pill `pi-<CMUX_SURFACE_ID>`: "idle" on `session_start` and `agent_end`, "working" on `agent_start` and `ui_prompt_end`, red "needs input" on `ui_prompt_start` while the agent runs (plus `trigger-flash` and `notify`). Workspace pill `pi-tabs` lists the tab names from `cmux tree`: sent on `session_start` and `set_pane_title` when changed, re-sent on every `agent_end` because a sibling session's shutdown clears it. Both pills cleared on `session_shutdown`. TUI-mode guard keeps subagent sessions silent. Stale pills after a crash: `cmux clear-status pi-<surface-id>` / `cmux clear-status pi-tabs`. Sidebar config: `docs/reference/cmux-sidebar.md`.
- `claude-usage.ts` — footer segment with the Claude plan's 5h/7d utilization, read from the `anthropic-ratelimit-unified-*` headers on `after_provider_response` (native `anthropic` subscription OAuth sends them directly; the `claude-bridge` provider forwards the same names; utilization is a 0..1 fraction, resets are epoch seconds; events arrive only when a window changes, and an event may carry one window, so the last value per window is kept until its reset time passes). The footer is restored from the agent-usage-bar snapshot at session start (expired windows dropped) and only cleared when the selected provider is neither `anthropic` nor `claude-bridge`. Every session mode writes the same numbers to the snapshot (`$AGENT_USAGE_BAR_SNAPSHOT`, else `${CLAUDE_CONFIG_DIR:-~/.claude}/usage-bar/usage.json`, schema 1, `0600` in a `0700` dir; write errors are swallowed). Only the TUI session draws the footer.
- `cache-clock.ts` — footer countdown (`cache-clock` key) to prompt-cache expiry, counted from the last assistant response; TTL per provider (`claude-bridge` 60 min, Anthropic 60 with `PI_CACHE_RETENTION=long` else 5, unknown 5). Auto-compacts an idle session once at minute 58 on a known 60-minute cache. Mirrors to a cmux sidebar pill when `CMUX_WORKSPACE_ID` is set. Pure logic lives in `lib/cache-clock.ts`. TUI-mode guard; the 15 s timer stops on `session_shutdown`.
- `package-patches.ts` — at TUI session start, auto-applies clean patches from `<agentDir>/patches/<pkg>/*.patch` to `<agentDir>/npm/node_modules/<pkg>` and notifies "restart Pi". A conflict, or an installed version differing from the patch's `Reviewed-Version`, goes to the agent as a `nextTurn` message pointing at the `package-patches` skill. Never throws. Logic in `lib/package-patches.ts`.
- `debug.ts` — debugging extension.
- `lib/pii-redaction.ts` — pure tag/restore logic for the `pii-redaction` package (`.pi/local-packages/`), which loads via `packages` so it runs before noheadroom. See `docs/reference/pii-redaction.md`.
- `lib/` — shared helpers (`extension-helpers`, `gate-checks`, `spec-scope`, `trust-loader`, `context-analyzer` core).

## Local Contracts

- Fail-Safe Defaults: a guard must fail to the most restrictive state. Uncertain → block, never allow.
- Guards hook tool-call events (`ToolCallEvent` / `ToolResultEvent`) and message-end; keep handlers idempotent and side-effect-free beyond the guard decision.
- Do not bypass a guard in code or tests. The guards are the contract — they are pinned by `test/gates.test.ts`, `test/read-boundary-guard.test.ts`, `test/write-boundary-guard.test.ts`, `test/spec-scope.test.ts`, `test/trust-loader.test.ts`, `test/subagent-delegation-policy.test.ts`, `test/security-guard.test.ts`, `test/security-parity.test.ts`, `test/sandbox-bash.test.ts`, `test/sandbox-bash.integration.test.ts`, `test/tool-guards.test.ts`, `test/degenerate-output.test.ts`.
- Security rules live only in `.pi/security/policy.ts`. `security-guard.ts` maps events and holds no rule logic.
- Shared logic lives in `lib/`; do not duplicate path/trust/gate helpers across extension files.
- `resolveInputPath` must normalize a path the way pi's file tools do (leading `@`, `file://`), or a guard checks a different path than the tool opens.
- Accepted risk (2026-11-04, owner decision): a dangling symlink (target does not exist yet) is not followed by `resolvePathWithRealAncestor`, so a write through it can land outside the working directory, a session grant, or the read-only `~/.pi`. It needs a deliberate two-step setup (`ln -s` in bash, then a file-tool write), so it is not re-reported in reviews. Fix if the threat model changes: `lstat` + `readlink` on a failed `realpath`, else block.

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
