# Implementation Friction Notes

> Recorded on 2026-04-03
> Context: Codex-like TUI restyle implementation in this repo

This document captures the problems encountered during planning and implementation so they can be addressed later.

## Highest-Impact Frictions

### 1. Skill catalog and actual subagent availability were inconsistent

**Status:** Resolved

- The instructions referenced `interactive-planner` and `tdd-coding` as skill-backed subagents.
- In practice, the runtime only exposed:
  - `explorer`
  - `planner`
  - `reviewer`
  - `worker`
  - `tdd-red`
  - `tdd-green`
  - `tdd-refactor`
  - `gan-generator`
  - `gan-critic`
- Result:
  - `interactive-planner` could not be invoked; fallback to `planner` was required.
  - `tdd-coding` could not be invoked; the work had to be done manually in red/green style.
- Improvement ideas:
  - expose skill-backed subagents consistently
  - or document the real mapping from skill names to available agents
- Remediation artifacts:
  - Inline fallback table in `.pi/agents/AGENTS.md`
  - [README: Skill Routing](../../README.md#skill-routing)
  - [AGENTS: Step 0 — Route](../../.pi/agents/AGENTS.md#step-0--route)

### 2. Local pi docs under `node_modules` were not readable

**Status:** Resolved

- Direct `read` access to local pi docs and README in `node_modules/@mariozechner/...` was blocked as protected.
- Result:
  - package docs could not be read from the exact installed version
  - web-fetched GitHub/raw docs had to be used instead
- Improvement ideas:
  - allow read-only access to installed package docs
  - or copy required vendor docs into a repo-local readable location
- Remediation artifacts:
  - [Vendor mirror root](../vendor/pi-coding-agent/README.md)
  - [Sync script](../../scripts/sync-pi-docs.ts)
  - [Smoke check guard](../../scripts/smoke.ts)

### 3. Searching inside `node_modules` was blocked by policy

**Status:** Resolved

- Read-only `rg`/inspection of local package docs/sources was blocked.
- Result:
  - harder discovery of exact APIs and examples
  - forced use of external web docs instead of local installed sources
- Improvement ideas:
  - whitelist read-only inspection for package docs
  - or provide an internal mirrored docs folder
- Remediation artifacts:
  - [Vendor mirror root](../vendor/pi-coding-agent/README.md)
  - [Sync metadata](../vendor/pi-coding-agent/sync-metadata.json)

### 4. Coverage was not runnable

**Status:** Resolved

- `npm test -- --coverage` failed because `@vitest/coverage-v8` is missing.
- Result:
  - coverage could not be measured for changed paths
- Improvement ideas:
  - add/configure Vitest coverage once for the repo
  - or document that coverage is intentionally unavailable
- Remediation artifacts:
  - [package.json scripts](../../package.json)
  - [vitest coverage config](../../vitest.config.ts)

### 5. Type-checking was blocked by capability policy

**Status:** In Progress

- `tsc --noEmit` via the local binary was blocked.
- Result:
  - no final typecheck validation beyond what tests implicitly exercised
- Improvement ideas:
  - allow `npm run typecheck`
  - or explicitly allow `tsc --noEmit`
- Remediation artifacts:
  - [package.json scripts](../../package.json)
  - [Capability policy loader/evaluator](../../.pi/extensions/capability-policy.ts)
  - [Capability rules](../../.pi/security/capabilities.json)
- Remaining gap:
  - command is now allowlisted, but repo-wide TypeScript errors still fail the check and need a dedicated cleanup pass.

## Additional Frictions

### 6. Command allowlist was inconsistent

**Status:** In Progress

- `npm test ...` was allowed, while some adjacent commands like `npx vitest ...` were blocked.
- Result:
  - command shape had to be adapted to policy instead of using the most direct local command
- Improvement ideas:
  - standardize allowed test/dev commands
  - or document the approved command forms clearly

### 7. Test helpers did not cover the needed UI hooks

**Status:** Resolved

- `test/helpers/fake-pi.ts` had no mocks for:
  - `setHeader`
  - `setFooter`
  - `setEditorComponent`
- Result:
  - helper updates were required before the new extension could be properly tested
- Improvement ideas:
  - provide a richer shared fake UI helper for extension tests

### 8. No existing local test pattern for header/footer/editor overrides

**Status:** Resolved

- The repo already had patterns for widgets and statuses, but not for the specific TUI override APIs needed here.
- Result:
  - extra test design work was required
- Improvement ideas:
  - add one reference test for header/footer/editor customization

### 9. File contents changed relative to earlier research

**Status:** In Progress

- `.pi/settings.json` contents observed later did not match the earlier snapshot.
- Result:
  - assumptions from prior reads had to be revalidated
  - exact-text edit attempts became brittle
- Improvement ideas:
  - re-read fast-changing files immediately before editing
  - reduce concurrent/manual changes during an implementation session when possible

### 10. Exact-text file edit failed on `.pi/settings.json`

**Status:** In Progress

- A targeted `edit` failed because the file content/format no longer matched the earlier read.
- Result:
  - had to switch to rewriting the file
- Improvement ideas:
  - normalize formatting for small config files
  - or prefer a fresh re-read right before edit operations

## Requirement and API Ambiguity Frictions

### 11. The initial plan overclaimed unverified footer data

**Status:** Resolved

- The screenshot suggested a `100% left` style metric, but API availability for that was not verified.
- Result:
  - acceptance criteria had to be narrowed during grilling
- Improvement ideas:
  - distinguish screenshot inspiration from hard requirements early
  - treat unsupported metrics as opportunistic, not required

### 12. Cursor blink / typing feel is partly terminal-dependent

**Status:** Deferred

- A true blinking cursor is often controlled by the terminal rather than extension code.
- Result:
  - the implementation had to treat this as best-effort
- Improvement ideas:
  - identify the primary target terminal upfront
  - document graceful degradation expectations for others

### 13. The editor change had a larger blast radius than it first appeared

**Status:** Resolved

- “Make it look like Codex” sounds cosmetic, but the editor surface includes:
  - file references via `@`
  - Tab path completion
  - bash shortcuts via `!` / `!!`
  - multiline behavior
  - paste/attachments
  - cursor/focus behavior
- Result:
  - preservation requirements had to be made explicit during grilling
- Improvement ideas:
  - state editor affordance preservation explicitly in UI-change plans

## Process and Tooling Frictions

### 14. Skill instructions used tool names that do not match this harness

**Status:** Resolved

- The TDD skill references concepts like `apply_patch`, `shell_command`, and `update_plan`.
- This harness exposes `edit`, `write`, `bash`, etc.
- Result:
  - extra mental translation was required while following the skill workflow
- Improvement ideas:
  - adapt skill docs to the actual harness tools
  - or document the mapping clearly
- Remediation artifacts:
  - [Implementation Workflow (Checklist)](../reference/implementation-workflow.md)
  - [AGENTS: Step 4 — Plan & Implement](../../.pi/agents/AGENTS.md#step-4--plan--implement)

### 15. Work required bouncing between repo code, external docs, and policy boundaries

**Status:** In Progress

- Research and implementation were slowed by switching between:
  - repo-local code
  - web-fetched upstream docs/examples
  - capability/policy constraints
- Improvement ideas:
  - add a repo-local TUI customization reference doc with:
    - supported APIs
    - tested local patterns
    - test strategy
    - known policy limits
- Remediation artifacts:
  - [Implementation Workflow (Checklist)](../reference/implementation-workflow.md)
  - [README: Implementation Workflow](../../README.md#implementation-workflow)

## Recommended Follow-Ups (Highest ROI)

1. Expose `interactive-planner` and `tdd-coding` as real subagents, or document their agent equivalents.
2. Make installed pi docs readable/searchable locally.
3. Add Vitest coverage support.
4. Allow a repo-standard typecheck command.
5. Expand `test/helpers/fake-pi.ts` into a fuller UI testing helper baseline.
